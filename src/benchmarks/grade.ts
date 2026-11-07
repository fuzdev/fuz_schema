/**
 * Grades a version of `schema.ts`, by default the working tree's, against
 * another, across every factor the acceptance rules weigh: time and allocation
 * per case, whether the output is the input itself, bundle size per scenario
 * and per export, priced by `grade_bytes.ts`, retained heap per scenario and
 * per export, priced by `grade_heap.ts`, and cold start.
 *
 * This module measures nothing itself. It plans the processes, runs them one
 * at a time where they are timed, and reads the verdict from all of them
 * together. `grade_child.ts` is a process, and says how one is timed.
 *
 * **Every version is loaded several times over.** A process holds
 * `INSTANCES` module instances of the baseline and as many of the graded
 * version, each with its own functions. Two instances of one file do not read
 * the same: on a case here and there one settles several percent from the
 * other, for the life of the process, and the next process draws again. So
 * what two instances of one version differ by is the noise, measured in the
 * same process and the same moment as the difference between the versions,
 * and a difference is only read against it.
 *
 * **Three regimes**, each a different program and all real:
 *
 * - `matrix`: one process runs every case, so every call site in the library
 *   has seen many schemas, as in an app
 * - `alone`: one process per case, so the engine specializes the library to
 *   that schema, as where a program has one
 * - `apart`: a process holds one version, uses every kind of schema, and
 *   times one case. In the other two a process holds both versions, and what
 *   one does to the state a process shares, the other pays as well. Here a
 *   version's processes are its own, and what they differ by among
 *   themselves is the noise.
 *
 * **Runs.** The whole of them is repeated `--runs` times, each run in fresh
 * processes, and nothing is concluded from one.
 *
 * **Time and bytes come from different processes.** Time is taken under Node's
 * own flags, which are a consumer's. Bytes need a young generation sized by
 * flag, which moves what a parse takes.
 *
 * The baseline comes from git (`--against`, default `HEAD`) or from a file
 * (`--against-file`), and the graded version is the working tree's or a file
 * (`--new-file`). Both are copied into one directory and loaded from there:
 * the same bytes read apart by where their file sits. The baseline may have
 * another API. The cases reach renamed
 * exports through helpers in `cases.ts`; the bundle, heap, and cold-start
 * comparisons use the baseline's own scenario module, taken from the same git
 * ref or given with `--against-libs-file`. Without one they use the working
 * tree's, which is only right when the two versions share an API. A scenario
 * the baseline's module lacks is measured for the graded version alone.
 *
 * Usage:
 *   npm run grade
 *   npm run grade -- --against HEAD~3 --filter each/union
 *   npm run grade -- --against-file .gro/grade/snapshot.ts --runs 5
 *   npm run grade -- --new-file .gro/grade/variant.ts --alone object/
 *   npm run grade -- --apart each/ --no-alone
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, hostname, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { map_concurrent } from '@fuzdev/fuz_util/async.ts';

import { meta, parse_args, s } from './args.ts';
import { CASE_PATHS, create_cases, type Case, type SchemaLib } from './cases.ts';
import { PROGRAM } from './program.ts';
import { SCENARIOS } from './scenarios.ts';
import {
	measure_bundle_size,
	measure_export_sizes,
	type ExportSize,
	type ExportSizes
} from './bundle_size.ts';
import {
	BACKSTOP_VS_VALIBOT,
	CHANGE_CLASSES,
	CORE_SCENARIO,
	CORRECTNESS_PRICE,
	SIZE_JITTER,
	format_backstop_line,
	format_opt_in_line,
	format_size_delta,
	format_size_figures,
	judge_backstop,
	to_backstop_rows,
	judge_core_correctness,
	judge_core_feature,
	is_priced_as_correctness,
	to_core_delta,
	judge_opt_in,
	to_size_delta,
	to_vs_valibot,
	type BackstopRow,
	type SizeFigure
} from './grade_bytes.ts';
import {
	CASE_FLOOR_LEAST,
	CASE_FLOOR_SPREADS,
	RUNS_TO_CONFIRM,
	is_confirmable,
	is_outside,
	to_case_time,
	to_reading,
	to_runs_needed,
	to_summary,
	type CaseTime,
	type Reading,
	type ReadingSeries,
	type Summary
} from './grade_stats.ts';
import { BASELINE_LIB } from './libs.ts';
import { ENTRY_FORMS, start_child, type EntryVariant } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart
} from './coldstart.ts';
import {
	GRADE_APART_ROUNDS,
	GRADE_PRELUDE_MS,
	GRADE_WARM_MS,
	type GradeChildCase,
	type GradeChildOutput,
	type GradeJob,
	type GradeJobArm,
	type GradeRegime
} from './grade_job.ts';
import {
	HEAP_SETTLED_BELOW_BYTES,
	measure_export_heap,
	measure_retained_heap,
	type ExportHeap
} from './heap.ts';
import {
	HEAP_ALLOWANCE,
	HEAP_JITTER,
	format_heap_delta,
	format_heap_line,
	is_heap_compared,
	is_over_heap_allowance,
	judge_heap,
	to_heap_delta,
	type HeapFigure
} from './grade_heap.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_table,
	geometric_mean,
	hold_benchmark_lock,
	refuse_timing_node_flags,
	to_balanced_orders
} from './measure.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	against: meta(s.with_default(s.string, 'HEAD'), {
		description: 'git ref to take the baseline from'
	}),
	'against-file': meta(s.optional(s.string), {
		description: 'file to use as the baseline instead of a git ref'
	}),
	'against-libs-file': meta(s.optional(s.string), {
		description: "the baseline's scenario module, with --against-file"
	}),
	'new-file': meta(s.optional(s.string), {
		description: "file to grade instead of the working tree's schema.ts"
	}),
	filter: meta(s.optional(s.string), {
		description: 'only measure cases whose name includes this'
	}),
	runs: meta(s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(1)), 4), {
		description:
			'how many times the whole of the timing is repeated: an even count has each version load first equally often'
	}),
	alone: meta(s.with_default(s.union([s.string, s.boolean]), 'real/'), {
		description:
			'which cases also get processes of their own: those whose name includes this, ' +
			'by default the realistic ones, and every case when given with no value'
	}),
	'no-alone': meta(s.with_default(s.boolean, false), { description: 'opt out of alone' }),
	apart: meta(s.optional(s.union([s.string, s.boolean])), {
		description:
			'which cases are also timed a version to a process: those whose name includes this, ' +
			'by default a few, mostly ones the engine folds whole, and every case when given with no value'
	}),
	'no-apart': meta(s.with_default(s.boolean, false), { description: 'opt out of apart' }),
	slice: meta(
		s.with_default(
			s.pipe(
				s.number,
				s.check((n: number) => n > 0, '> 0')
			),
			1
		),
		{ description: 'milliseconds one timing slice of one instance lasts' }
	),
	class: meta(s.with_default(s.one_of(CHANGE_CLASSES), 'speed'), {
		description:
			'what the change is for, which sets the price of its bytes: speed, correctness ' +
			'for a fix of correctness or conformance, or security for a fix of over-acceptance, ' +
			'denial of service on data-shaped input, or input leaking into issues, priced as ' +
			'correctness with the backstop for the user to rule on, or feature for a new export, ' +
			'with core at +0, what the baseline has priced as correctness, and the new figures reported'
	}),
	bundle: meta(s.with_default(s.boolean, true), { description: 'also measure bundle sizes' }),
	'no-bundle': meta(s.with_default(s.boolean, false), { description: 'opt out of bundle' }),
	process: meta(s.with_default(s.boolean, true), {
		description: 'also measure retained heap and cold start, in processes of their own'
	}),
	'no-process': meta(s.with_default(s.boolean, false), { description: 'opt out of process' }),
	samples: meta(s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(1)), 15), {
		description: 'kept cold-start rounds'
	})
});

const args = parse_args(Args);
if (args['against-libs-file'] && !args['against-file']) {
	console.error(
		'--against-libs-file goes with --against-file: a baseline from git (--against) brings ' +
			'its own scenario module from the same ref'
	);
	process.exit(1);
}
refuse_timing_node_flags('grade', true);

hold_benchmark_lock('fuz_schema grade');

/** How many module instances of each version a timing process holds. */
const INSTANCES = 3;
/**
 * How many processes of each version a case of the `apart` regime is timed in,
 * a run. A process there stands where an instance does in the other regimes,
 * so it is the same count, and the same reading of them.
 */
const APART_PROCESSES = INSTANCES;
/**
 * The cases timed apart by default: mostly ones the engine folds whole in a
 * process that runs nothing else, each of another construction. Such a case is where
 * a change to the state a process shares shows, as little else is left of
 * the parse to hide it.
 *
 * - an array of primitives, small and large, where a parse is the array's
 *   loop and a call an item
 * - the same through a wrapper
 * - a flat object, its loop over its entries
 * - a recursive schema, which runs a `lazy` itself
 *
 * The recursive one is not folded. It is here as the case that uses a `lazy`
 * itself, so a change to `lazy` is read apart on what it is for.
 */
const APART_CASES: ReadonlyArray<string> = [
	'each/string/valid',
	'each/optional_present/valid',
	'scale/array_10_numbers/valid',
	'object/6_keys/valid',
	'real/docinfo_types/valid'
];
// what a case must allocate more by to be listed: a word or more, and on a
// large case the share two readings of one parse can differ by
const ALLOC_FLOOR = { bytes: 8, share: 0.002 };
const SPEEDUP_PER_CORE_BYTES = { speedup: 0.1, bytes: 50 };
// the least speedup any added core bytes need, the rule's second sentence
const LEAST_SPEEDUP_FOR_BYTES = 0.05;
// the scenarios cold start samples: one small schema, one large
const COLDSTART_SCENARIOS = ['object_flat', 'type_json'];
const COLDSTART_DISCARD = 2;
// what a cold-start stage must grow by to be listed
const PROCESS_FLOOR = 0.1;
// how many byte processes run at once, of both regimes together: they are not
// timed, so they may share the machine
const BYTES_CONCURRENCY = Math.max(1, Math.min(6, availableParallelism() >> 1));

//
// The two versions
//

const LIB_MODULE = 'src/benchmarks/libs/fuz_schema.ts';
const WORK_DIR = resolve('.gro/grade');
const JOBS_DIR = join(WORK_DIR, 'jobs');
const CHILD_PATH = fileURLToPath(new URL('./grade_child.ts', import.meta.url));
mkdirSync(JOBS_DIR, { recursive: true });

// Both versions are loaded from this directory, whatever file each came from.
// The same bytes read apart by where their file sits: a file outside any
// directory whose `package.json` gives a `type` took a tenth longer on a case,
// in most processes, than a copy of it inside one.
const baseline_path = join(WORK_DIR, 'against_schema.ts');
const new_path = join(WORK_DIR, 'new_schema.ts');
// read before either copy is written: a file given may be a copy an earlier grade left here
const new_source = readFileSync(resolve(args['new-file'] ?? 'src/lib/schema.ts'));

let baseline_lib_path: string | undefined;
let baseline_label: string;
if (args['against-file']) {
	writeFileSync(baseline_path, readFileSync(resolve(args['against-file'])));
	baseline_lib_path = args['against-libs-file'] && resolve(args['against-libs-file']);
	baseline_label = args['against-file'];
} else {
	writeFileSync(baseline_path, execFileSync('git', ['show', `${args.against}:src/lib/schema.ts`]));
	baseline_lib_path = join(WORK_DIR, 'against_libs_fuz_schema.ts');
	writeFileSync(baseline_lib_path, execFileSync('git', ['show', `${args.against}:${LIB_MODULE}`]));
	baseline_label = args.against;
}
writeFileSync(new_path, new_source);
const new_label = args['new-file'] ?? 'the working tree';
// the graded version as the bundle, heap, and cold-start builds take it
const new_variant: EntryVariant | undefined = args['new-file']
	? { id: 'new', schema_path: new_path }
	: undefined;
const identical = readFileSync(baseline_path).equals(readFileSync(new_path));
// The scenarios the baseline's module has a factory for, read from its source:
// one from before a scenario was added lacks it. Such a scenario is measured
// for the graded version alone, and compared on nothing.
const baseline_lib_source = baseline_lib_path && readFileSync(baseline_lib_path, 'utf8');
const shared_scenarios: Array<string> = SCENARIOS.map((s) => s.name).filter(
	(name) =>
		!baseline_lib_source ||
		new RegExp(String.raw`^export const scenario_${name}\b`, 'm').test(baseline_lib_source)
);
const unshared_scenarios: Array<string> = SCENARIOS.map((s) => s.name).filter(
	(name) => !shared_scenarios.includes(name)
);

const new_lib: SchemaLib = await import(pathToFileURL(new_path).href);
// strict: the graded version has every case, or the grade does not run
const all_cases = create_cases(new_lib, true);
const cases = all_cases.filter((c) => !args.filter || c.name.includes(args.filter));
if (!cases.length) {
	console.error('no cases matched');
	process.exit(1);
}
const alone = args['no-alone'] ? false : args.alone;
const alone_cases = cases.filter(
	(c) => alone === true || (alone !== false && c.name.includes(alone))
);
const apart = args['no-apart'] ? false : args.apart;
const apart_cases = cases.filter((c) =>
	apart === undefined
		? APART_CASES.includes(c.name)
		: apart === true || (apart !== false && c.name.includes(apart))
);

//
// The processes
//

// the versions in turn, so that neither's instances are all loaded first, and
// the graded one's last, which is where a process looks for it
const TIME_ARMS: GradeJob['arms'] = Array.from({ length: INSTANCES }, (_, i) => [
	{ id: `base${i}`, path: baseline_path, graded: false },
	{ id: `new${i}`, path: new_path, graded: true }
]).flat();
// two of each version, so that a case whose bytes are not settled shows as
// one, and a version allocates more only where both of its instances say so
const BYTES_ARMS: GradeJob['arms'] = [
	{ id: 'base0', path: baseline_path, graded: false },
	{ id: 'new0', path: new_path, graded: true },
	{ id: 'base1', path: baseline_path, graded: false },
	{ id: 'new1', path: new_path, graded: true }
];

// A process of the `apart` regime: one version, as an instance that uses the
// library and one that is timed.
const to_apart_arms = (graded: boolean): Array<GradeJobArm> => {
	const path = graded ? new_path : baseline_path;
	return [
		{ id: 'user', path, graded, program: true },
		{ id: graded ? 'new0' : 'base0', path, graded }
	];
};

let job_count = 0;

const run_job = async (job: GradeJob): Promise<GradeChildOutput> => {
	const path = join(JOBS_DIR, `${job_count++}.json`);
	writeFileSync(path, JSON.stringify(job));
	const start = (): Promise<unknown> =>
		// a timing gets none of this process's own flags either
		start_child(CHILD_PATH, {
			flags: job.mode === 'bytes' ? ALLOCATION_NODE_FLAGS.split(' ') : [],
			args: [path],
			label: `${job.regime} ${job.mode}` + (job.cases.length === 1 ? ` of ${job.cases[0]}` : '')
		});
	// a process of bytes now and then has a collection in too many samples, so
	// it gets one more process, and a timing never does
	const output =
		job.mode === 'bytes'
			? await start().catch((error: unknown) => {
					console.error(`${(error as Error).message.split('\n')[0]}: once more`);
					return start();
				})
			: await start();
	// kept beside its job, every round of every arm, for a reading the report doesn't make
	writeFileSync(path.replace(/\.json$/, '.out.json'), JSON.stringify(output));
	return output as GradeChildOutput;
};

const to_job = (
	mode: GradeJob['mode'],
	regime: GradeJob['regime'],
	names: Array<string>,
	offset: number,
	arms: Array<GradeJobArm> = mode === 'time' ? TIME_ARMS : BYTES_ARMS
): GradeJob => ({
	mode,
	regime,
	arms,
	cases: names,
	slice_ms: args.slice,
	offset
});

const to_chunks = <T>(items: Array<T>, count: number): Array<Array<T>> => {
	const size = Math.ceil(items.length / count);
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size)
	);
};

const format_seconds = (seconds: number): string =>
	seconds < 90 ? `${Math.round(seconds)}s` : `${(seconds / 60).toFixed(1)} min`;

// What the run will take, in seconds. A timing is its rounds and the one
// thrown away, each every arm once; the rest is fitted to runs of this.
const slice_seconds = args.slice / 1000;
const case_seconds =
	(to_balanced_orders(TIME_ARMS.length).length + 1) * TIME_ARMS.length * slice_seconds;
const ESTIMATE = {
	matrix_run:
		2 +
		(all_cases.length * TIME_ARMS.length * GRADE_PRELUDE_MS) / 1000 +
		cases.length * (GRADE_WARM_MS.matrix / 1000 + case_seconds) * 1.15,
	alone_case: 0.17 + GRADE_WARM_MS.alone / 1000 + case_seconds,
	// a process of one version, which a case has `APART_PROCESSES` of for each
	apart_process: 0.17 + GRADE_WARM_MS.apart / 1000 + (GRADE_APART_ROUNDS + 1) * slice_seconds,
	bytes: 2 + (cases.length * 3.1 + alone_cases.length * 5.1) / BYTES_CONCURRENCY,
	bundle: args.bundle ? 1 : 0,
	process: args.process ? 10 + args.samples * 0.6 : 0
};
const estimate_apart =
	args.runs * apart_cases.length * 2 * APART_PROCESSES * ESTIMATE.apart_process;
const estimate_timing =
	args.runs * (ESTIMATE.matrix_run + alone_cases.length * ESTIMATE.alone_case) + estimate_apart;

/** What the machine was doing, where it can be read: a timing taken under load reads wider. */
interface MachineState {
	node: string;
	/** The load average over 1, 5, and 15 minutes. */
	load: Array<number>;
	/** Each CPU's clock in MHz, from `/proc/cpuinfo`, where there is one. */
	cpu_mhz?: Array<number>;
	/** The first CPU's frequency governor, from `/sys`, where there is one. */
	governor?: string;
	/** Whether the CPUs may boost past their base clock, from `/sys`, where it says. */
	boost?: boolean;
}

// a file's text, trimmed, or `undefined` where it can't be read
const read_text = (path: string): string | undefined => {
	try {
		return readFileSync(path, 'utf8').trim();
	} catch {
		return undefined;
	}
};

const read_machine_state = (): MachineState => {
	const state: MachineState = { node: process.version, load: loadavg() };
	const mhz = [...(read_text('/proc/cpuinfo') ?? '').matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map(
		(m) => Number(m[1])
	);
	if (mhz.length) state.cpu_mhz = mhz;
	const governor = read_text('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor');
	if (governor) state.governor = governor;
	const boost = read_text('/sys/devices/system/cpu/cpufreq/boost');
	if (boost) state.boost = boost === '1';
	return state;
};

/** What a grade ran on and with, which is the same at its end, for the JSON report. */
interface GradeSetup {
	hostname: string;
	/** The CPU's model, from `/proc/cpuinfo`, where there is one. */
	cpu_model?: string;
	node: string;
	v8: string;
	/** The versions of the comparison libraries and of the bundler, from their `package.json`. */
	packages: Record<string, string | undefined>;
	/** The commit the working tree is on, and whether it has changes. */
	head: { sha?: string; dirty?: boolean };
	/** The commit `--against` resolved to, for a baseline from git. */
	against_sha?: string;
	/** The first 16 hex digits of the SHA-256 of each version's `schema.ts` as it was loaded. */
	base_hash: string;
	new_hash: string;
}

const COMPARED_PACKAGES = ['valibot', 'zod', 'typebox', 'arktype', 'rolldown'];

const to_git = (args: Array<string>): string | undefined => {
	try {
		return execFileSync('git', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return undefined;
	}
};

const to_file_hash = (path: string): string =>
	createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

const read_grade_setup = (): GradeSetup => {
	const status = to_git(['status', '--porcelain']);
	return {
		hostname: hostname(),
		cpu_model: /^model name\s*:\s*(.+)$/m.exec(read_text('/proc/cpuinfo') ?? '')?.[1],
		node: process.versions.node,
		v8: process.versions.v8,
		packages: Object.fromEntries(
			COMPARED_PACKAGES.map((name) => {
				const text = read_text(resolve('node_modules', name, 'package.json'));
				return [name, text && (JSON.parse(text) as { version?: string }).version];
			})
		),
		head: {
			sha: to_git(['rev-parse', 'HEAD']),
			dirty: status === undefined ? undefined : !!status
		},
		against_sha: args['against-file']
			? undefined
			: to_git(['rev-parse', `${args.against}^{commit}`]),
		base_hash: to_file_hash(baseline_path),
		new_hash: to_file_hash(new_path)
	};
};

const format_machine_state = (state: MachineState): string =>
	`node ${state.node}, load ${state.load.map((l) => l.toFixed(2)).join(' ')}` +
	(state.cpu_mhz
		? `, cpu ${Math.round(Math.min(...state.cpu_mhz))} to ${Math.round(Math.max(...state.cpu_mhz))} MHz, ` +
			`mean ${Math.round(state.cpu_mhz.reduce((sum, m) => sum + m, 0) / state.cpu_mhz.length)}`
		: '') +
	(state.governor ? `, governor ${state.governor}` : '') +
	(state.boost === undefined ? '' : `, boost ${state.boost ? 'on' : 'off'}`);

const machine_start = read_machine_state();
const setup = read_grade_setup();
const started_at = new Date();
console.log(
	`grading ${new_label} against ${baseline_label}: ${cases.length} cases, ` +
		`${alone_cases.length} of them also alone, ${apart_cases.length} apart, ` +
		`${args.runs} ${args.runs === 1 ? 'run' : 'runs'}, ${INSTANCES} instances a version`
);
console.log(`the machine at the start: ${format_machine_state(machine_start)}`);
if (identical) {
	console.log(
		'the two versions are the same file byte for byte: every difference below is noise, ' +
			'and what this run reads of it is what a real one is read against'
	);
}
console.log(
	`about ${format_seconds(estimate_timing + ESTIMATE.bytes + ESTIMATE.bundle + ESTIMATE.process)}: ` +
		`time ${format_seconds(estimate_timing)}` +
		(apart_cases.length ? `, ${format_seconds(estimate_apart)} of it apart` : '') +
		`, bytes ${format_seconds(ESTIMATE.bytes)}` +
		(args.bundle ? `, bundles ${format_seconds(ESTIMATE.bundle)}` : '') +
		(args.process ? `, retained heap and cold start ${format_seconds(ESTIMATE.process)}` : '') +
		'\n'
);

const names = cases.map((c) => c.name);

/** A case apart in one run: its reading of the median batch, and of the whole slice. */
interface ApartReading {
	reading: Reading;
	whole: Reading;
}
const started = performance.now();
const to_elapsed = (since: number): string => format_seconds((performance.now() - since) / 1000);

/**
 * Times the cases of the `apart` regime for one run: each in
 * `APART_PROCESSES` processes of each version, a process of one and then of
 * the other, and which goes first moves on by a process, a case, and a run.
 *
 * @returns by case, what the processes read: a figure a process, where the other regimes have one an instance, of the median batch and of the whole slice
 */
const time_apart = async (run: number): Promise<Array<ApartReading>> => {
	const of_run: Array<ApartReading> = [];
	for (const [index, c] of apart_cases.entries()) {
		const reading: Reading = { base: [], new: [] };
		const whole: Reading = { base: [], new: [] };
		for (let at = 0; at < APART_PROCESSES; at++) {
			for (const graded of (run + index + at) % 2 ? [true, false] : [false, true]) {
				const output = await run_job(
					to_job('time', 'apart', [c.name], run + at, to_apart_arms(graded))
				);
				if (!graded) apart_program_ran = Math.min(apart_program_ran, output.program_ran ?? 0);
				// a baseline that lacks the case, or disagrees on it, times nothing
				if (output.cases.length) {
					to_reading(output.cases[0]!, reading);
					to_reading(output.cases[0]!, whole, 'whole_ns');
				}
			}
		}
		of_run.push({ reading, whole });
	}
	return of_run;
};

// timed, so one process at a time and nothing beside it
const matrix_runs: Array<GradeChildOutput> = [];
const alone_runs: Array<Array<GradeChildCase>> = [];
// by run, then by case: what each process read, by version
const apart_runs: Array<Array<ApartReading>> = [];
// the fewest entries of the program a process of the baseline ran
let apart_program_ran = PROGRAM.length;
for (let run = 0; run < args.runs; run++) {
	const since = performance.now();
	matrix_runs.push(await run_job(to_job('time', 'matrix', names, run)));
	const of_run: Array<GradeChildCase> = [];
	for (const c of alone_cases) {
		of_run.push((await run_job(to_job('time', 'alone', [c.name], run))).cases[0]!);
	}
	alone_runs.push(of_run);
	apart_runs.push(await time_apart(run));
	console.log(`time, run ${run + 1} of ${args.runs}: ${to_elapsed(since)}`);
}

const bytes_since = performance.now();
const matrix_chunks = to_chunks(names, BYTES_CONCURRENCY);
const bytes_outputs = await map_concurrent(
	[
		...matrix_chunks.map((chunk) => to_job('bytes', 'matrix', chunk, 0)),
		...alone_cases.map((c) => to_job('bytes', 'alone', [c.name], 0))
	],
	BYTES_CONCURRENCY,
	run_job
);
const matrix_bytes = bytes_outputs.slice(0, matrix_chunks.length).flatMap((o) => o.cases);
const alone_bytes = bytes_outputs.slice(matrix_chunks.length).map((o) => o.cases[0]!);
console.log(`bytes: ${to_elapsed(bytes_since)}`);

//
// Reading the processes
//

const confirmable = is_confirmable(args.runs);
const runs_needed = to_runs_needed(args.runs);
const NOT_JUDGED = `not judged, fewer than ${RUNS_TO_CONFIRM} runs`;

/** A case's bytes in one regime: the first instance of each version, and the second beside it. */
interface CaseBytes {
	base: number;
	new: number;
	base1: number;
	new1: number;
	/** Whether the two instances of each version read the same. */
	settled: boolean;
}

// the rise is taken to the nearest byte: a reading is a median of samples less
// the sampler's own bytes, so a rise of one word can read a shade under one
const is_past_alloc_floor = (bytes: number, from: number): boolean =>
	Math.round(bytes - from) >= Math.max(ALLOC_FLOOR.bytes, from * ALLOC_FLOOR.share);

// whether two instances of one version read apart, where both were read
const is_apart = (a: number, b: number): boolean =>
	!Number.isNaN(a) && !Number.isNaN(b) && (is_past_alloc_floor(a, b) || is_past_alloc_floor(b, a));

const to_case_bytes = (c: GradeChildCase | undefined): CaseBytes => {
	const bytes = c?.bytes ?? {};
	const base = bytes.base0 ?? NaN;
	const base1 = bytes.base1 ?? NaN;
	const next = bytes.new0 ?? NaN;
	const new1 = bytes.new1 ?? NaN;
	return {
		base,
		new: next,
		base1,
		new1,
		settled: !is_apart(base, base1) && !is_apart(next, new1)
	};
};

// allocates more: both instances of the new version past the floor over both of the baseline's
const is_more_alloc = (b: CaseBytes): boolean =>
	b.settled &&
	is_past_alloc_floor(
		Math.min(b.new, b.new1),
		Math.max(b.base, Number.isNaN(b.base1) ? b.base : b.base1)
	);

interface Graded {
	c: Case;
	/**
	 * Whether the baseline was timed on the case in the matrix, in every run.
	 * One it lacks or gives another verdict on is reported on its own, and is
	 * in no summary, A/A, or rule.
	 */
	compared: boolean;
	matrix: CaseTime;
	alone: CaseTime | undefined;
	apart: CaseTime | undefined;
	/**
	 * The same of the whole slice, every batch over every call, so a collection
	 * is in it: read and reported beside the median batch's, and judged by no rule.
	 */
	whole: Record<GradeRegime, CaseTime | undefined>;
	bytes: CaseBytes;
	alone_bytes: CaseBytes | undefined;
	same: boolean;
	base_same: boolean | undefined;
}

// a process measures the cases every arm has before the rest, so not in the order asked
const to_case_of = (output: GradeChildOutput, name: string): GradeChildCase => {
	const found = output.cases.find((c) => c.name === name);
	if (!found) throw new Error(`expected ${name} in the output of a process`);
	return found;
};

const graded_all: Array<Graded> = cases.map((c) => {
	const of_runs = matrix_runs.map((run) => to_case_of(run, c.name));
	const first = of_runs[0]!;
	const alone_index = alone_cases.indexOf(c);
	const apart_index = apart_cases.indexOf(c);
	const to_alone = (series: ReadingSeries): CaseTime | undefined =>
		alone_index === -1
			? undefined
			: to_case_time(alone_runs.map((run) => to_reading(run[alone_index]!, undefined, series)));
	const to_apart = (key: keyof ApartReading): CaseTime | undefined =>
		apart_index === -1 ? undefined : to_case_time(apart_runs.map((run) => run[apart_index]![key]));
	return {
		c,
		compared: of_runs.every((r) => r.arms.some((arm) => arm.startsWith('base'))),
		matrix: to_case_time(of_runs.map((r) => to_reading(r))),
		alone: to_alone('ns'),
		apart: to_apart('reading'),
		whole: {
			matrix: to_case_time(of_runs.map((r) => to_reading(r, undefined, 'whole_ns'))),
			alone: to_alone('whole_ns'),
			apart: to_apart('whole')
		},
		bytes: to_case_bytes(matrix_bytes.find((b) => b.name === c.name)),
		alone_bytes: alone_index === -1 ? undefined : to_case_bytes(alone_bytes[alone_index]),
		same: first.same.new0!,
		base_same: first.same.base0
	};
});
// what the summaries, their A/A, the rules, and the lists read
const graded = graded_all.filter((g) => g.compared);
const uncompared = graded_all.filter((g) => !g.compared);
const disagreed = [...new Set(matrix_runs.flatMap((run) => run.disagreed))];

//
// Report
//

// The report is printed once it is whole, its verdict first and its tables after,
// and written whole as JSON beside the versions.
const report_tables: Array<string> = [];
const report_verdict: Array<string> = [];
const print_table = (text: string): void => {
	report_tables.push(text);
};
const print_verdict = (text: string): void => {
	report_verdict.push(text);
};

const format_number = (n: number): string =>
	Number.isNaN(n) ? '-' : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

const format_ratio = (ratio: number): string =>
	Number.isNaN(ratio) ? '-' : `${ratio.toFixed(2)}x`;

// nothing over nothing is no change
const to_bytes_ratio = (bytes: number, from: number): number => (bytes === from ? 1 : bytes / from);

// a time ratio from its logarithm, marked when the case is flagged or a candidate
const format_time = (log_ratio: number, mark = ' '): string =>
	Number.isNaN(log_ratio) ? '-' : `${Math.exp(log_ratio).toFixed(3)}x${mark}`;

// a floor or an A/A from its logarithm, as what a ratio may be from one
const format_band = (log_band: number): string =>
	Number.isNaN(log_band) ? '-' : `±${(Math.exp(log_band) - 1).toFixed(3)}`;

const format_bytes_ratio = (b: CaseBytes): string =>
	format_ratio(to_bytes_ratio(b.new, b.base)) + (b.settled ? ' ' : '~');

const format_same = (same: boolean | undefined, c?: Case): string =>
	same === undefined || c?.path === 'create' ? '-' : same ? 'input' : 'copy';

const to_mark = (t: CaseTime): string => (t.flag ? '*' : t.candidate ? '?' : ' ');

const to_time_cells = (t: CaseTime): Array<string> => [
	format_number(t.base_ns),
	format_number(t.new_ns),
	format_time(t.ratio, to_mark(t)),
	format_band(t.floor)
];

const to_bytes_cells = (b: CaseBytes): Array<string> => [
	format_number(b.base),
	format_number(b.new),
	format_bytes_ratio(b)
];

const marks_note =
	(confirmable
		? `* every instance of the new version was slower than every one of the baseline, or faster, by more\n  than the floor, in ${runs_needed === args.runs ? 'every one' : `at least ${runs_needed}`} of the ${args.runs} runs\n` +
			`? the same in ${runs_needed - 1} of them`
		: `no case is confirmed from fewer than ${RUNS_TO_CONFIRM} runs\n` +
			'? every instance of the new version was slower than every one of the baseline, or faster, by more\n' +
			`  than the floor, in ${args.runs === 1 ? 'the one run' : `every one of the ${args.runs} runs`}`) +
	'\na time outside its floor is not by itself a finding: the mark is';

print_table(
	`\ncases, in the matrix: a process runs them all, so each is timed in code that has seen every schema.\n` +
		`ns is per parse, the median of ${INSTANCES} instances and of the runs. time is new over base. floor is\n` +
		`what a run's time must be past to show a difference: ${CASE_FLOOR_SPREADS} times what an instance is from the median of its own version, and at least ` +
		`${format_band(CASE_FLOOR_LEAST)}.\nB is heap bytes per parse, ~ where two instances of one version differ. ` +
		`out is whether the output\nis the input itself.\n${marks_note}\n`
);
print_table(
	format_table([
		['case', 'path', 'base ns', 'new ns', 'time', 'floor', 'base B', 'new B', 'alloc', 'out'],
		...graded.map((g) => [
			g.c.name + (g.c.realistic ? ' †' : ''),
			g.c.path,
			...to_time_cells(g.matrix),
			...to_bytes_cells(g.bytes),
			g.base_same === undefined || g.base_same === g.same
				? format_same(g.same, g.c)
				: `${format_same(g.base_same)}→${format_same(g.same)}`
		])
	])
);
print_table('† realistic case, the ones the acceptance rules judge speed on');

const graded_alone = graded.filter((g) => g.alone);
if (graded_alone.length) {
	print_table(
		'\ncases, alone: a process runs one case and nothing else, so the engine specializes the library\n' +
			'to that schema. The columns are as above, with the matrix time beside for comparison.\n'
	);
	print_table(
		format_table([
			['case', 'path', 'matrix', 'base ns', 'new ns', 'time', 'floor', 'base B', 'new B', 'alloc'],
			...graded_alone.map((g) => [
				g.c.name + (g.c.realistic ? ' †' : ''),
				g.c.path,
				format_time(g.matrix.ratio, to_mark(g.matrix)),
				...to_time_cells(g.alone!),
				...to_bytes_cells(g.alone_bytes!)
			])
		])
	);
}

const graded_apart = graded.filter((g) => g.apart);
if (graded_apart.length) {
	print_table(
		'\ncases, apart: a process holds one version. It uses every kind of schema once, in an instance of\n' +
			'the library beside the one it times, and then runs one case and nothing else. What using a version\n' +
			`does to the state a process shares is then in its own processes alone. Each version has ${APART_PROCESSES}\n` +
			'processes a run, and a process is here what an instance is above: ns is their median, the floor is\n' +
			'from what the processes of one version differ by, and a mark is of every process of the new version\n' +
			'against every one of the baseline. The matrix and alone times are beside for comparison.\n'
	);
	print_table(
		format_table([
			['case', 'path', 'matrix', 'alone', 'base ns', 'new ns', 'time', 'floor'],
			...graded_apart.map((g) => [
				g.c.name + (g.c.realistic ? ' †' : ''),
				g.c.path,
				format_time(g.matrix.ratio, to_mark(g.matrix)),
				g.alone ? format_time(g.alone.ratio, to_mark(g.alone)) : '-',
				...to_time_cells(g.apart!)
			])
		])
	);
}

if (uncompared.length) {
	print_table(
		'\ncases not compared: the baseline has none of them, as a case of an export it lacks, or gives\n' +
			'another verdict. Each is measured for the new version alone, after every case both have, and\n' +
			"is in no summary, A/A, rule, or list below. ns and B are the new version's, matrix and alone.\n"
	);
	print_table(
		format_table([
			['case', 'path', 'why', 'new ns', 'alone ns', 'new B', 'alone B', 'out'],
			...uncompared.map((g) => [
				g.c.name + (g.c.realistic ? ' †' : ''),
				g.c.path,
				disagreed.includes(g.c.name) ? 'verdict' : 'new',
				format_number(g.matrix.new_ns),
				g.alone ? format_number(g.alone.new_ns) : '-',
				format_number(g.bytes.new),
				g.alone_bytes ? format_number(g.alone_bytes.new) : '-',
				format_same(g.same, g.c)
			])
		])
	);
}

type Regime = GradeRegime;
const REGIMES: ReadonlyArray<Regime> = ['matrix', 'alone', 'apart'];
// the regimes whose realistic cases the rules read as one figure: `apart` has
// a few chosen cases, read one at a time
const SUMMARY_RULE_REGIMES: ReadonlyArray<Regime> = ['matrix', 'alone'];

// bytes are read in the processes that hold both versions
const to_bytes_of = (g: Graded, regime: Regime): CaseBytes | undefined =>
	regime === 'matrix' ? g.bytes : regime === 'alone' ? g.alone_bytes : undefined;

// the ratio of summed bytes, `NaN` where no case has both
const to_alloc_sum = (gs: Array<Graded>, regime: Regime): number => {
	const compared = gs
		.map((g) => to_bytes_of(g, regime))
		.filter((b): b is CaseBytes => b !== undefined && !Number.isNaN(b.base));
	const sum = (key: 'base' | 'new'): number => compared.reduce((total, b) => total + b[key], 0);
	return compared.length ? to_bytes_ratio(sum('new'), sum('base')) : NaN;
};

const summarize = (gs: Array<Graded>, regime: Regime): Summary =>
	to_summary(gs.map((g) => g[regime]!));

// the same of the whole slice
const summarize_whole = (gs: Array<Graded>, regime: Regime): Summary =>
	to_summary(gs.map((g) => g.whole[regime]!));

/** A row of a summary table, for the JSON report: a group's, or a path's. */
interface SummaryReport {
	regime: Regime;
	table: 'group' | 'path';
	label: string;
	cases: number;
	/** A group's valid cases, and its invalid; a path has one, as `valid`. */
	valid: Summary;
	invalid?: Summary;
	/** The same of the whole slice. */
	valid_whole: Summary;
	invalid_whole?: Summary;
	/** The ratio of summed bytes. */
	alloc: number;
}
const summaries_report: Array<SummaryReport> = [];

for (const regime of REGIMES) {
	const of_regime = graded.filter((g) => g[regime] && !Number.isNaN(g[regime].ratio));
	if (!of_regime.length) continue;
	const to_group_row = (label: string, gs: Array<Graded>): Array<string> => {
		const valid_cases = gs.filter((g) => g.c.valid);
		const invalid_cases = gs.filter((g) => !g.c.valid);
		const valid = summarize(valid_cases, regime);
		const invalid = summarize(invalid_cases, regime);
		const valid_whole = summarize_whole(valid_cases, regime);
		const invalid_whole = summarize_whole(invalid_cases, regime);
		const alloc = to_alloc_sum(gs, regime);
		summaries_report.push({
			regime,
			table: 'group',
			label,
			cases: gs.length,
			valid,
			invalid,
			valid_whole,
			invalid_whole,
			alloc
		});
		return [
			label,
			String(gs.length),
			format_time(valid.ratio, ''),
			format_band(valid.band),
			format_time(valid_whole.ratio, ''),
			format_band(valid_whole.band),
			format_time(invalid.ratio, ''),
			format_band(invalid.band),
			format_time(invalid_whole.ratio, ''),
			format_band(invalid_whole.band),
			format_ratio(alloc)
		];
	};
	// a path's cases are of one validity, but for `probe`, so its row has one time
	const to_path_rows = (label: string, gs: Array<Graded>): Array<Array<string>> =>
		CASE_PATHS.map((path) => gs.filter((g) => g.c.path === path))
			.filter((of_path) => of_path.length)
			.map((of_path) => {
				const summary = summarize(of_path, regime);
				const whole = summarize_whole(of_path, regime);
				const alloc = to_alloc_sum(of_path, regime);
				summaries_report.push({
					regime,
					table: 'path',
					label: label + of_path[0]!.c.path,
					cases: of_path.length,
					valid: summary,
					valid_whole: whole,
					alloc
				});
				return [
					label + of_path[0]!.c.path,
					String(of_path.length),
					format_time(summary.ratio, ''),
					format_band(summary.band),
					format_time(whole.ratio, ''),
					format_band(whole.band),
					format_ratio(alloc)
				];
			});
	const realistic = of_regime.filter((g) => g.c.realistic);
	print_table(
		`\nsummary, ${regime}: time is the geometric mean of the cases' ratios, and the A/A beside it is from what\n` +
			(regime === 'apart'
				? 'the processes of one version differ by over the same cases, in the same runs: a time inside\n' +
					'it is no difference. Bytes are not read apart.\n'
				: 'the instances of one version differ by over the same cases, in the same processes: a time inside\n' +
					'it is no difference. alloc is the ratio of summed bytes.\n') +
			"time is the median over the rounds of a slice's median batch, which a collection is mostly not\n" +
			'in, and whole the mean over the rounds of the whole slice over its calls, collections and all,\n' +
			'with its own A/A. No rule reads whole yet.\n'
	);
	print_table(
		format_table([
			[
				'group',
				'cases',
				'valid time',
				'A/A',
				'whole',
				'A/A',
				'invalid time',
				'A/A',
				'whole',
				'A/A',
				'alloc'
			],
			...[...new Set(of_regime.map((g) => g.c.group))].map((group) =>
				to_group_row(
					group,
					of_regime.filter((g) => g.c.group === group)
				)
			),
			to_group_row('realistic †', realistic),
			// a creation is not a parse, and has its group's row alone
			to_group_row(
				'all',
				of_regime.filter((g) => g.c.path !== 'create')
			)
		])
	);
	print_table(`\nby path, ${regime}: what the parse does\n`);
	print_table(
		format_table([
			['path', 'cases', 'time', 'A/A', 'whole', 'A/A', 'alloc'],
			...to_path_rows('realistic † ', realistic),
			...to_path_rows('all ', of_regime)
		])
	);
}

//
// Bundle size
//

let core_delta = 0;
// the bundle of every export, reported beside the opt-in verdict
let library_delta = 0;
// every figure rules 4 and 5 read, and each scenario beside valibot's
let size_figures: Array<SizeFigure> = [];
let backstop_rows: Array<BackstopRow> = [];
// a scenario the baseline lacks, beside other libraries' bundles of it, for the JSON report
let new_scenario_report: Array<ScenarioLibsRow> = [];
// a scenario of many schemas, which the backstop doesn't read, beside other libraries' bundles of it
let many_schema_rows: Array<ScenarioLibsRow> = [];
let all_sizes = { new: NaN, valibot: NaN };
// a scenario the baseline's module lacks, as a feature adds, beside other libraries' bundles of it
const NEW_SCENARIO_LIBS = [BASELINE_LIB, 'zod_mini'];
const MANY_SCHEMA_SCENARIOS = SCENARIOS.filter((s) => s.many_schemas).map((s) => s.name);

/** A scenario's bundle in the graded version beside other libraries' bundles of it. */
interface ScenarioLibsRow {
	name: string;
	gzip: number;
	libs: Array<{ lib: string; gzip: number }>;
}

const format_scenario_libs = (r: ScenarioLibsRow): string =>
	`${r.name} ${r.gzip} gzip, ` +
	r.libs.map((l) => `${(r.gzip / l.gzip).toFixed(3)}x ${l.lib}'s ${l.gzip}`).join(', ');

if (args.bundle) {
	const since = performance.now();
	const all_names = SCENARIOS.map((s) => s.name);
	const measure_base = async (names: Array<string>): Promise<number> =>
		(
			await measure_bundle_size('fuz_schema', names, {
				schema_path: baseline_path,
				lib_path: baseline_lib_path
			})
		).gzip;
	const measure_new = async (names: Array<string>): Promise<number> =>
		(await measure_bundle_size('fuz_schema', names, { schema_path: new_variant?.schema_path }))
			.gzip;
	const measure_valibot = async (names: Array<string>): Promise<number> =>
		(await measure_bundle_size(BASELINE_LIB, names)).gzip;
	// `all` compares the two versions on the scenarios both have, so its delta
	// is the change's, and is read beside valibot's on every scenario
	const [scenario_rows, all_row, export_sizes] = await Promise.all([
		Promise.all(
			all_names.map(async (name) => ({
				name,
				base: shared_scenarios.includes(name) ? await measure_base([name]) : NaN,
				new: await measure_new([name]),
				valibot: await measure_valibot([name])
			}))
		),
		Promise.all([
			measure_base(shared_scenarios),
			measure_new(shared_scenarios),
			unshared_scenarios.length ? measure_new(all_names) : undefined,
			measure_valibot(all_names)
		]),
		Promise.all([
			measure_export_sizes(baseline_path),
			// the working tree's own file unless one is given, as `sizes.json` measures it
			measure_export_sizes(new_variant?.schema_path)
		])
	]);
	const [base_all, new_shared, new_every, valibot_all] = all_row;
	all_sizes = { new: new_every ?? new_shared, valibot: valibot_all };
	backstop_rows = to_backstop_rows(scenario_rows, MANY_SCHEMA_SCENARIOS);
	const backstop = judge_backstop(backstop_rows);
	const to_scenario_libs_row = async (name: string): Promise<ScenarioLibsRow> => ({
		name,
		gzip: scenario_rows.find((r) => r.name === name)!.new,
		libs: await Promise.all(
			NEW_SCENARIO_LIBS.map(async (lib) => ({
				lib,
				gzip: (await measure_bundle_size(lib, [name])).gzip
			}))
		)
	});
	// a feature's scenario is the comparison of its export against other libraries
	const new_scenario_rows = await Promise.all(unshared_scenarios.map(to_scenario_libs_row));
	many_schema_rows = await Promise.all(MANY_SCHEMA_SCENARIOS.map(to_scenario_libs_row));
	new_scenario_report = new_scenario_rows;
	const [base_exports, new_exports] = export_sizes;
	library_delta = new_exports.library - base_exports.library;
	const to_by_name = (sizes: ExportSizes): Map<string, ExportSize> =>
		new Map(sizes.exports.map((e) => [e.name, e]));
	const base_by_name = to_by_name(base_exports);
	const new_by_name = to_by_name(new_exports);
	const export_names = [...new Set([...new_by_name.keys(), ...base_by_name.keys()])];
	const scenario_figures: Array<SizeFigure> = scenario_rows.map((r) => ({
		name: r.name,
		kind: 'scenario',
		core: r.name === CORE_SCENARIO,
		base: r.base,
		new: r.new
	}));
	const export_figures: Array<SizeFigure> = [
		{ name: 'parse', kind: 'export', core: true, base: base_exports.parse, new: new_exports.parse },
		// each export's last in, then its alone, which sees a helper it shares
		...(['export', 'alone'] as const).flatMap((kind) =>
			export_names.map((name): SizeFigure => {
				const field = kind === 'export' ? 'last_in' : 'alone';
				return {
					name,
					kind,
					core: false,
					base: base_by_name.get(name)?.[field] ?? NaN,
					new: new_by_name.get(name)?.[field] ?? NaN
				};
			})
		)
	];
	// a scenario the baseline's module lacks is compared on nothing
	size_figures = [...scenario_figures.filter((f) => !Number.isNaN(f.base)), ...export_figures];
	core_delta = to_core_delta(size_figures);

	const format_size = (size: number): string => (Number.isNaN(size) ? '-' : String(size));
	const format_class = (f: SizeFigure): string => (f.core ? 'core' : 'opt-in');
	// under the correctness price, a figure over it, and under feature, core that grew
	const over_price = new Set(
		is_priced_as_correctness(args.class)
			? [
					...(args.class === 'feature'
						? judge_core_feature(size_figures)
						: judge_core_correctness(size_figures)),
					...judge_opt_in(size_figures, args.class).over
				]
			: []
	);
	const format_figure_delta = (f: SizeFigure): string =>
		(Number.isNaN(f.base) ? '-' : format_size_delta(to_size_delta(f))) +
		(over_price.has(f) ? '!' : ' ');
	const format_vs_valibot = (ratio: number, mark: string): string => `${ratio.toFixed(3)}x${mark}`;
	const to_backstop_mark = (row: BackstopRow): string =>
		backstop.over.includes(row) ? '*' : backstop.pinned.includes(row) ? 'p' : ' ';
	const to_scenario_mark = (f: SizeFigure, valibot: number): string => {
		const row = backstop_rows.find((r) => r.name === f.name);
		return row
			? format_vs_valibot(to_vs_valibot(row), to_backstop_mark(row))
			: format_vs_valibot(f.new / valibot, 'r');
	};

	print_table(
		'\nbundle size: minified + gzip bytes. Core is what every consumer pays, opt-in what one pays who uses it\n'
	);
	print_table(
		format_table([
			['scenario', 'class', 'base', 'new', 'delta', 'valibot', 'vs valibot'],
			...scenario_figures.map((f, i) => [
				f.name,
				format_class(f),
				format_size(f.base),
				format_size(f.new),
				format_figure_delta(f),
				String(scenario_rows[i]!.valibot),
				to_scenario_mark(f, scenario_rows[i]!.valibot)
			]),
			[
				'all',
				'reported',
				String(base_all),
				String(new_shared),
				format_size_delta(new_shared - base_all) + ' ',
				String(valibot_all),
				format_vs_valibot(all_sizes.new / valibot_all, ' ')
			]
		])
	);
	print_table(
		`* over ${BACKSTOP_VS_VALIBOT.toFixed(2)}x valibot's, the backstop` +
			(backstop.pinned.length ? ', p over it and within its pin' : '') +
			(many_schema_rows.length ? ', r many schemas, which it does not read' : '') +
			(args.class === 'feature'
				? ', ! over the price of a feature'
				: is_priced_as_correctness(args.class)
					? ', ! over the price of a correctness change'
					: '')
	);
	// the figures a reader needs: core, any that moved past the jitter, and any one side lacks,
	// each export's figures together
	const is_listed = (f: SizeFigure): boolean =>
		f.core ||
		Math.abs(to_size_delta(f)) > SIZE_JITTER ||
		Number.isNaN(f.base) ||
		Number.isNaN(f.new);
	const listed_names = new Set(export_figures.filter(is_listed).map((f) => f.name));
	const listed = [...listed_names].flatMap((name) =>
		export_figures.filter((f) => f.name === name && is_listed(f))
	);
	const format_figure_kind = (f: SizeFigure): string =>
		f.kind === 'alone' || f.core ? 'alone' : 'last in';
	print_table(
		`\nexports: \`parse\` alone, and each other's last in, what it costs a consumer who has the rest, and alone,\n` +
			`what it costs over \`parse\` a consumer who has only it, with the library whole. An opt-in figure that\n` +
			`moved by ${SIZE_JITTER} or less is gzip and not the change, and is not listed\n`
	);
	print_table(
		format_table([
			['export', 'figure', 'class', 'base', 'new', 'delta'],
			...listed.map((f) => [
				f.name,
				format_figure_kind(f),
				format_class(f),
				format_size(f.base),
				format_size(f.new),
				format_figure_delta(f)
			]),
			[
				'library',
				'every export',
				'reported',
				String(base_exports.library),
				String(new_exports.library),
				format_size_delta(library_delta) + ' '
			]
		])
	);
	print_table(
		`${export_names.length + 1 - listed_names.size} other exports within ±${SIZE_JITTER}, last in and alone`
	);
	if (unshared_scenarios.length) {
		print_table(
			`\nthe baseline's scenario module has no ${unshared_scenarios.join(', ')}: ` +
				`${unshared_scenarios.length === 1 ? 'it is' : 'they are'} measured for the new version alone. ` +
				'`all` is of the scenarios\n' +
				'both have, and its ratio of every scenario. Beside other libraries:\n'
		);
		print_table(
			format_table([
				['new scenario', 'new', ...NEW_SCENARIO_LIBS.flatMap((lib) => [lib, 'vs'])],
				...new_scenario_rows.map((r) => [
					r.name,
					String(r.gzip),
					...r.libs.flatMap((l) => [String(l.gzip), `${(r.gzip / l.gzip).toFixed(3)}x`])
				])
			])
		);
	}
	console.log(`\nbundles: ${to_elapsed(since)}`);
}

//
// Retained heap and cold start, in processes of their own
//

const heap_figures: Array<HeapFigure> = [];
// each scenario's total with one schema, for the JSON report
const heap_totals: Array<{ name: string; base: number; new: number; delta: number }> = [];
const heap_totals_grew: Array<string> = [];
const coldstart_slower: Array<string> = [];
// each stage's row of the table, for the JSON report
const coldstart_report: Array<Record<string, number | string | boolean>> = [];
let coldstart_ratio = NaN;

if (args.process) {
	const variant: EntryVariant = {
		id: 'base',
		schema_path: baseline_path,
		lib_path: baseline_lib_path
	};
	const since = performance.now();

	const format_kb = (bytes: number): string =>
		Number.isNaN(bytes) ? '-' : (bytes / 1024).toFixed(1);
	const format_bytes = (bytes: number): string => (Number.isNaN(bytes) ? '-' : String(bytes));
	const format_figure_delta = (f: HeapFigure): string =>
		(is_heap_compared(f) ? format_heap_delta(to_heap_delta(f)) : '-') +
		(is_over_heap_allowance(f) ? '!' : ' ');
	const heap_rows: Array<Array<string>> = [];
	for (const scenario of SCENARIOS) {
		const current = await measure_retained_heap('fuz_schema', scenario.name, new_variant);
		// a scenario the baseline's module lacks is compared on nothing
		const base = shared_scenarios.includes(scenario.name)
			? await measure_retained_heap('fuz_schema', scenario.name, variant)
			: { total_bytes: NaN, further_schema_bytes: NaN };
		const figure: HeapFigure = {
			name: scenario.name,
			kind: 'scenario',
			base: base.further_schema_bytes,
			new: current.further_schema_bytes
		};
		heap_figures.push(figure);
		const total_delta = current.total_bytes - base.total_bytes;
		heap_totals.push({
			name: scenario.name,
			base: base.total_bytes,
			new: current.total_bytes,
			delta: total_delta
		});
		heap_rows.push([
			scenario.name,
			format_kb(base.total_bytes),
			format_kb(current.total_bytes),
			Number.isNaN(total_delta) ? '-' : format_heap_delta(total_delta),
			format_bytes(figure.base),
			format_bytes(figure.new),
			format_figure_delta(figure)
		]);
		// a total repeats to about the size of a collection's jitter
		if (total_delta > HEAP_SETTLED_BELOW_BYTES) heap_totals_grew.push(scenario.name);
	}
	print_table(
		'\nretained heap: after building one schema and parsing once, over a bare process, reported,\n' +
			'and what each further schema holds, machine code and the trusted spaces beside it\n' +
			'(bytecode, deoptimization data) left out, priced\n'
	);
	print_table(
		format_table([
			['scenario', 'base KB', 'new KB', 'delta B', 'base B/schema', 'new B/schema', 'delta B'],
			...heap_rows
		])
	);

	// strict for the graded version, which has every export the program names
	const [base_exports, new_exports] = [
		await measure_export_heap(variant),
		await measure_export_heap(new_variant, true)
	];
	const base_by_name = new Map(base_exports.map((e) => [e.name, e]));
	const export_figures = new_exports.map((e: ExportHeap): HeapFigure => ({
		name: e.name,
		kind: 'export',
		base: base_by_name.get(e.name)?.further_schema_bytes ?? NaN,
		new: e.further_schema_bytes
	}));
	heap_figures.push(...export_figures);
	// the figures a reader needs: any that moved past the jitter, and any one side lacks
	const listed = export_figures.filter(
		(f) => !is_heap_compared(f) || Math.abs(to_heap_delta(f)) > HEAP_JITTER
	);
	print_table(
		'\nretained heap per further schema of each export alone, a schema of its entry in the program,\n' +
			`each action in a \`pipe\`, priced. A figure that moved by ${HEAP_JITTER} or less is not listed\n`
	);
	if (listed.length) {
		print_table(
			format_table([
				['export', 'base B/schema', 'new B/schema', 'delta B'],
				...listed.map((f) => [
					f.name,
					format_bytes(f.base),
					format_bytes(f.new),
					format_figure_delta(f)
				])
			])
		);
	}
	print_table(
		`${export_figures.length - listed.length} ${listed.length ? 'other ' : ''}exports within ±${HEAP_JITTER}` +
			(heap_figures.some(is_over_heap_allowance)
				? `, ! over the allowance of ${HEAP_ALLOWANCE}`
				: '')
	);
	console.log(`\nretained heap: ${to_elapsed(since)}`);

	// a baseline's module may be from before one of them
	const coldstart_scenarios = COLDSTART_SCENARIOS.filter((name) => shared_scenarios.includes(name));
	const plan = await plan_coldstart(
		[
			{ id: 'fuz_schema.new', lib: 'fuz_schema', variant: new_variant },
			{ id: 'fuz_schema.base', lib: 'fuz_schema', variant }
		],
		coldstart_scenarios,
		ENTRY_FORMS
	);
	sample_coldstart(plan, args.samples, COLDSTART_DISCARD);
	const coldstart_rows: Array<Array<string>> = [];
	const ratios: Array<number> = [];
	for (const scenario of coldstart_scenarios) {
		for (const form of ENTRY_FORMS) {
			for (const stage of COLDSTART_STAGES) {
				const find = (target: string): (typeof plan.processes)[number] =>
					plan.processes.find(
						(p) =>
							p.target === target && p.scenario === scenario && p.form === form && p.stage === stage
					)!;
				const base = summarize_coldstart(find('fuz_schema.base'), plan.bare);
				const current = summarize_coldstart(find('fuz_schema.new'), plan.bare);
				const ratio = current.work_ms / base.work_ms;
				// slower only when the medians differ by more than either's own spread
				const slower =
					ratio > 1 + PROCESS_FLOOR &&
					current.work_ms - base.work_ms > Math.max(base.work_band_ms, current.work_band_ms);
				const name = `${scenario}/${form}/${stage}`;
				if (stage === 'first_parse') ratios.push(ratio);
				if (slower) coldstart_slower.push(name);
				coldstart_report.push({
					name,
					base_ms: base.work_ms,
					new_ms: current.work_ms,
					ratio,
					slower,
					band_ms: Math.max(base.work_band_ms, current.work_band_ms),
					peak_kb_delta: current.added_rss_kb - base.added_rss_kb
				});
				coldstart_rows.push([
					name,
					base.work_ms.toFixed(2),
					current.work_ms.toFixed(2),
					format_ratio(ratio) + (slower ? '*' : ' '),
					`±${Math.max(base.work_band_ms, current.work_band_ms).toFixed(2)}`,
					`${current.added_rss_kb - base.added_rss_kb >= 0 ? '+' : ''}${Math.round(current.added_rss_kb - base.added_rss_kb)}`
				]);
			}
		}
	}
	coldstart_ratio = geometric_mean(ratios);
	print_table(
		`\ncold start: median ms of work inside a fresh process, ${args.samples} samples, each stage including\n` +
			'the ones before it; band is the wider p10 to p90 spread of the two; peak is KB of resident memory\n'
	);
	print_table(
		format_table([
			['scenario/form/stage', 'base ms', 'new ms', 'time', 'band', 'peak KB'],
			...coldstart_rows
		])
	);
}

//
// The rules
//

const format_percent = (n: number, digits = 1): string => {
	// rounded first, so a small loss reads `+0.0%` and not `-0.0%`
	const percent = Number((n * 100).toFixed(digits)) || 0;
	return `${percent >= 0 ? '+' : ''}${percent.toFixed(digits)}%`;
};

// a summary as a speed: positive is faster, and the A/A is what it may be from none
const to_speed = (s: Summary): number => 1 - Math.exp(s.ratio);
const format_speed = (s: Summary): string =>
	`${format_percent(to_speed(s))} (A/A ±${((Math.exp(s.band) - 1) * 100).toFixed(1)}%)`;
const format_standing = (s: Summary): string =>
	!is_outside(s) ? 'inside its A/A' : s.ratio < 0 ? 'faster, past its A/A' : 'slower, past its A/A';

const format_names = (gs: Array<Graded>): string =>
	gs.length ? gs.map((g) => g.c.name).join(', ') : 'none';

// by regime, what the valid path of the realistic cases reads, whole and by path
const valid_by_regime = SUMMARY_RULE_REGIMES.map((regime) => {
	const valid = graded.filter(
		(g) => g.c.realistic && g.c.valid && g[regime] && !Number.isNaN(g[regime].ratio)
	);
	return {
		regime,
		whole: summarize(valid, regime),
		whole_slice: summarize_whole(valid, regime),
		paths: CASE_PATHS.map((path) => ({
			path,
			summary: summarize(
				valid.filter((g) => g.c.path === path),
				regime
			)
		})).filter((p) => p.summary.cases)
	};
}).filter((v) => v.whole.cases);

print_verdict(
	`\nagainst the acceptance rules: time is of ${args.runs} ${args.runs === 1 ? 'run' : 'runs'} together, and every figure of it is beside its A/A\n`
);
if (!valid_by_regime.length) {
	print_verdict('realistic valid-path speed: no realistic valid cases in this run');
}
for (const { regime, whole, whole_slice, paths } of valid_by_regime) {
	print_verdict(
		`realistic valid-path speed, ${regime}: ${format_speed(whole)}: ${format_standing(whole)}\n` +
			`  by run: ${whole.runs.map((r) => format_percent(1 - Math.exp(r))).join(', ')}\n` +
			`  by path: ${paths.map((p) => `${p.path} ${format_speed(p.summary)}`).join(', ')}\n` +
			`  whole slice, collections in it, reported: ${format_speed(whole_slice)}`
	);
}
if (args.bundle) {
	print_verdict(
		args.class === 'feature'
			? 'bytes, priced as a feature (--class feature): core at +0, the figures the baseline has as a fix of correctness:'
			: args.class === 'security'
				? 'bytes, priced as a fix of security (--class security), as one of correctness with the backstop for the user:'
				: args.class === 'correctness'
					? 'bytes, priced as a fix of correctness or conformance (--class correctness):'
					: 'bytes, priced as a change for speed (--class correctness or --class security for a fix, --class feature for a new export):'
	);
	if (args.class === 'feature') {
		const grew = judge_core_feature(size_figures);
		print_verdict(
			`  core bytes (${CORE_SCENARIO} and parse): ${format_size_delta(core_delta)} gzip, ` +
				'which a feature may not add to: ' +
				(grew.length ? `FAIL, ${format_size_figures(grew)}` : 'pass')
		);
	} else if (is_priced_as_correctness(args.class)) {
		const over = judge_core_correctness(size_figures);
		print_verdict(
			`  core bytes (${CORE_SCENARIO} and parse, the more grown): ${format_size_delta(core_delta)} gzip, ` +
				`which may be up to +${CORRECTNESS_PRICE.core} with no return: ` +
				(over.length ? `ASK, ${format_size_figures(over)} over it, the user rules` : 'pass')
		);
	} else {
		const matrix_valid = valid_by_regime.find((v) => v.regime === 'matrix')?.whole;
		const required =
			core_delta > 0
				? Math.max(
						LEAST_SPEEDUP_FOR_BYTES,
						(core_delta / SPEEDUP_PER_CORE_BYTES.bytes) * SPEEDUP_PER_CORE_BYTES.speedup
					)
				: 0;
		// the return may be on the invalid cases when the valid path is not slower
		const matrix_invalid = summarize(
			graded.filter(
				(g) => g.c.realistic && !g.c.valid && g.matrix && !Number.isNaN(g.matrix.ratio)
			),
			'matrix'
		);
		const is_return = (s: Summary): boolean =>
			is_outside(s) && s.ratio < 0 && to_speed(s) >= required;
		let verdict: string;
		if (core_delta <= 0) verdict = 'pass, no bytes added';
		else if (!confirmable) verdict = NOT_JUDGED;
		else if (!matrix_valid) verdict = 'not judged, no realistic valid cases in this run';
		else if (is_return(matrix_valid)) verdict = `pass, valid ${format_speed(matrix_valid)}`;
		else if (is_outside(matrix_valid) && matrix_valid.ratio > 0) {
			verdict = `FAIL, valid ${format_speed(matrix_valid)} is slower past its A/A`;
		} else if (matrix_invalid.cases && is_return(matrix_invalid)) {
			verdict =
				`pass, invalid ${format_speed(matrix_invalid)}, ` +
				`with valid ${format_speed(matrix_valid)} ${format_standing(matrix_valid)}`;
		} else {
			const to_shortfall = (s: Summary): string =>
				`${format_speed(s)} is ${is_outside(s) && s.ratio < 0 ? 'short of it' : 'no speedup past its A/A'}`;
			verdict =
				`FAIL, valid ${to_shortfall(matrix_valid)}` +
				(matrix_invalid.cases
					? `, and invalid ${to_shortfall(matrix_invalid)}`
					: ', and there are no realistic invalid cases in this run');
		}
		print_verdict(
			`  core bytes (${CORE_SCENARIO} and parse, the more grown): ${format_size_delta(core_delta)} gzip, ` +
				`which needs ${format_percent(required)} realistic speed in the matrix, on the valid path ` +
				`or with it not slower on the invalid: ${verdict}`
		);
	}
	print_verdict(
		'  ' + format_opt_in_line(judge_opt_in(size_figures, args.class), args.class, library_delta)
	);
	print_verdict('  ' + format_backstop_line(backstop_rows, args.class));
	for (const r of many_schema_rows) {
		print_verdict(`  many schemas, reported and not priced: ${format_scenario_libs(r)}`);
	}
	print_verdict(
		`  all scenarios together, reported: ${all_sizes.new} gzip, ` +
			`${(all_sizes.new / all_sizes.valibot).toFixed(2)}x valibot's ${all_sizes.valibot}`
	);
}

const to_flagged = (regime: Regime, flag: CaseTime['flag'], valid?: boolean): Array<Graded> =>
	graded.filter((g) => g[regime]?.flag === flag && (valid === undefined || g.c.valid === valid));

// Rule 6 fails on a family of lines, and the more lines a family has the more
// often two copies of one file fail one of them, so it is kept to the lines
// that read most of the valid path: the realistic valid summary in `matrix` and
// `alone`, the summary of every valid case in `matrix`, and a valid case
// confirmed slower in any regime, `apart` among them. The realistic paths, as
// identity and copy, and the realistic invalid path warn: a path of a few cases
// reads past its A/A by its noise far more often than the whole does.
// TODO: read the whole slice too, once its A/A is calibrated on enough grades
const all_valid_matrix = summarize(
	graded.filter((g) => g.c.valid && g.c.path !== 'create' && !Number.isNaN(g.matrix.ratio)),
	'matrix'
);
const is_slower_past = (summary: Summary): boolean => is_outside(summary) && summary.ratio > 0;
const slowed = [
	...valid_by_regime
		.filter(({ whole }) => is_slower_past(whole))
		.map(({ regime, whole }) => `realistic valid ${regime} ${format_speed(whole)}`),
	...(all_valid_matrix.cases && is_slower_past(all_valid_matrix)
		? [`every valid case matrix ${format_speed(all_valid_matrix)}`]
		: []),
	...REGIMES.flatMap((regime) => {
		// a creation parses nothing, and is listed below
		const slower_cases = to_flagged(regime, 'slower', true).filter(
			(g) => g.c.path !== 'create'
		).length;
		return slower_cases
			? [`${slower_cases} valid ${slower_cases === 1 ? 'case' : 'cases'} slower ${regime}`]
			: [];
	})
];
print_verdict(
	`every valid case, matrix: ${all_valid_matrix.cases ? `${format_speed(all_valid_matrix)}: ${format_standing(all_valid_matrix)}` : 'none in this run'}`
);
print_verdict(
	'the valid path is not slowed: ' +
		(!confirmable ? NOT_JUDGED : slowed.length ? `FAIL: ${slowed.join(', ')}` : 'pass')
);
// what warns: a realistic path, valid or invalid, slower past its A/A
const warned = SUMMARY_RULE_REGIMES.flatMap((regime) => {
	const realistic = graded.filter(
		(g) => g.c.realistic && g[regime] && !Number.isNaN(g[regime].ratio)
	);
	const valid_paths =
		valid_by_regime
			.find((v) => v.regime === regime)
			?.paths.map((p) => ({
				label: p.path,
				summary: p.summary
			})) ?? [];
	const invalid = realistic.filter((g) => !g.c.valid);
	return [
		...valid_paths,
		{ label: 'invalid', summary: summarize(invalid, regime) },
		{
			label: 'issues',
			summary: summarize(
				invalid.filter((g) => g.c.path === 'issues'),
				regime
			)
		}
	]
		.filter((p) => p.summary.cases && is_slower_past(p.summary))
		.map((p) => `realistic ${p.label} ${regime} ${format_speed(p.summary)}`);
});
print_verdict(
	'a realistic path is not slowed, a warning: ' +
		(!confirmable ? NOT_JUDGED : warned.length ? `WARN: ${warned.join(', ')}` : 'none')
);

for (const regime of REGIMES) {
	if (!graded.some((g) => g[regime])) continue;
	print_verdict(`cases slower, ${regime}: ${format_names(to_flagged(regime, 'slower'))}`);
	print_verdict(`cases faster, ${regime}: ${format_names(to_flagged(regime, 'faster'))}`);
	print_verdict(
		`cases marked ?, ${regime}: ` + format_names(graded.filter((g) => g[regime]?.candidate))
	);
}
const to_more_alloc = (regime: Regime): Array<Graded> =>
	graded.filter((g) => {
		const bytes = g[regime] && to_bytes_of(g, regime);
		return !!bytes && is_more_alloc(bytes);
	});
const unsettled = graded.filter((g) => !g.bytes.settled || g.alone_bytes?.settled === false);
print_verdict(`cases allocating more, matrix: ${format_names(to_more_alloc('matrix'))}`);
if (graded_alone.length) {
	print_verdict(`cases allocating more, alone: ${format_names(to_more_alloc('alone'))}`);
}
print_verdict(
	`cases whose bytes two instances of one version differ on: ${format_names(unsettled)}`
);
print_verdict(
	`cases whose output identity changed: ${format_names(graded.filter((g) => g.base_same !== undefined && g.base_same !== g.same))}`
);
if (disagreed.length) {
	print_verdict(
		`cases the baseline gives another verdict on, not compared: ${disagreed.join(', ')}`
	);
}
if (apart_program_ran < PROGRAM.length) {
	print_verdict(
		`the program, apart: the baseline ran ${apart_program_ran} of its ${PROGRAM.length} entries, ` +
			'the rest throwing or giving another answer in it, where the new version ran them all'
	);
}
if (args.process) {
	print_verdict(
		`cold start, first parse: ${format_ratio(coldstart_ratio)} the baseline's; ` +
			`stages slower past their own spread: ${coldstart_slower.length ? coldstart_slower.join(', ') : 'none'}`
	);
	print_verdict(format_heap_line(judge_heap(heap_figures), heap_totals_grew));
}
const machine_end = read_machine_state();
print_verdict(`the machine at the end: ${format_machine_state(machine_end)}`);
console.log(report_verdict.join('\n'));
console.log(report_tables.join('\n'));
const REPORT_PATH = join(WORK_DIR, 'report.json');
const ended_at = new Date();
writeFileSync(
	REPORT_PATH,
	JSON.stringify(
		{
			note:
				"a case's ratio and floor, and a summary's ratio and band, are natural logarithms of new " +
				'over base: the printed time is exp(ratio), and a floor or an A/A ±(exp(floor) - 1). ' +
				'Every other figure is as printed, unrounded',
			graded: new_label,
			against: baseline_label,
			identical,
			args,
			started_at: started_at.toISOString(),
			ended_at: ended_at.toISOString(),
			setup,
			machine: { start: machine_start, end: machine_end },
			instances: INSTANCES,
			cases: graded_all.map((g) => ({
				name: g.c.name,
				group: g.c.group,
				path: g.c.path,
				valid: g.c.valid,
				realistic: g.c.realistic,
				compared: g.compared,
				matrix: g.matrix,
				alone: g.alone,
				apart: g.apart,
				whole: g.whole,
				bytes: g.bytes,
				alone_bytes: g.alone_bytes,
				same: g.same,
				base_same: g.base_same
			})),
			disagreed,
			summaries: summaries_report,
			apart_program_ran: { ran: apart_program_ran, of: PROGRAM.length },
			core_delta,
			library_delta,
			size_figures,
			backstop_rows,
			new_scenario_rows: new_scenario_report,
			many_schema_rows,
			all_sizes,
			heap_figures,
			heap_totals,
			heap_totals_grew,
			coldstart: coldstart_report,
			verdict: report_verdict,
			tables: report_tables,
			elapsed_s: (performance.now() - started) / 1000
		},
		(_, value: unknown) => (typeof value === 'number' && !Number.isFinite(value) ? null : value),
		'\t'
	) + '\n'
);
// a copy under the time it started, so the next grade leaves this one's
const report_copy = join(
	WORK_DIR,
	`report_${started_at
		.toISOString()
		.replace(/\.\d+Z$/, 'Z')
		.replaceAll(':', '-')}.json`
);
copyFileSync(REPORT_PATH, report_copy);
console.log(`\nthe whole report, as JSON: ${REPORT_PATH}, and a copy at ${report_copy}`);
console.log(`\n${to_elapsed(started)}`);
