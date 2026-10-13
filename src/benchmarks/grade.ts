/**
 * Grades a version of `schema.ts`, by default the working tree's, against
 * another, across every factor the acceptance rules weigh: time and allocation
 * per case, whether the output is the input itself, bundle size per scenario
 * and of every export together, retained heap, and cold start.
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
 * **Two regimes**, each a different program and both real:
 *
 * - `matrix`: one process runs every case, so every call site in the library
 *   has seen many schemas, as in an app
 * - `alone`: one process per case, so the engine specializes the library to
 *   that schema, as where a program has one
 *
 * **Runs.** The whole of both is repeated `--runs` times, each run in fresh
 * processes, and nothing is concluded from one.
 *
 * **Time and bytes come from different processes.** Time is taken under Node's
 * own flags, which are a consumer's. Bytes need a young generation sized by
 * flag, which moves what a parse takes.
 *
 * The baseline comes from git (`--against`, default `HEAD`) or from a file
 * (`--against-file`), and the graded version is the working tree's or a file
 * (`--new-file`). The baseline may have another API. The cases reach renamed
 * exports through helpers in `cases.ts`; the bundle, heap, and cold-start
 * comparisons use the baseline's own scenario module, taken from the same git
 * ref or given with `--against-libs-file`. Without one they use the working
 * tree's, which is only right when the two versions share an API.
 *
 * Usage:
 *   npm run grade
 *   npm run grade -- --against HEAD~3 --filter each/union
 *   npm run grade -- --against-file .gro/grade/snapshot.ts --runs 5
 *   npm run grade -- --new-file .gro/grade/variant.ts --alone object/
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';
import { map_concurrent } from '@fuzdev/fuz_util/async.ts';
import { stats_median } from '@fuzdev/fuz_util/stats.ts';

import { CASE_PATHS, create_cases, type Case, type SchemaLib } from './cases.ts';
import { SCENARIOS } from './scenarios.ts';
import { measure_bundle_size, measure_library_size } from './bundle_size.ts';
import { ENTRY_FORMS, start_child, type EntryVariant } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart
} from './coldstart.ts';
import {
	GRADE_PRELUDE_MS,
	GRADE_WARM_MS,
	type GradeChildCase,
	type GradeChildOutput,
	type GradeJob
} from './grade_job.ts';
import { HEAP_SETTLED_BELOW_BYTES, measure_retained_heap } from './heap.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_table,
	geometric_mean,
	has_some_allocation_node_flag,
	hold_benchmark_lock,
	to_balanced_orders
} from './measure.ts';

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	against: z.string().default('HEAD').meta({ description: 'git ref to take the baseline from' }),
	'against-file': z
		.string()
		.optional()
		.meta({ description: 'file to use as the baseline instead of a git ref' }),
	'against-libs-file': z
		.string()
		.optional()
		.meta({ description: "the baseline's scenario module, with --against-file" }),
	'new-file': z
		.string()
		.optional()
		.meta({ description: "file to grade instead of the working tree's schema.ts" }),
	filter: z
		.string()
		.optional()
		.meta({ description: 'only measure cases whose name includes this' }),
	runs: z
		.number()
		.int()
		.positive()
		.default(3)
		.meta({ description: 'how many times the whole of the timing is repeated' }),
	alone: z
		.union([z.string(), z.boolean()])
		.default('real/')
		.meta({
			description:
				'which cases also get processes of their own: those whose name includes this, ' +
				'by default the realistic ones, and every case when given with no value'
		}),
	'no-alone': z.boolean().default(false).meta({ description: 'opt out of alone' }),
	slice: z
		.number()
		.positive()
		.default(1)
		.meta({ description: 'milliseconds one timing slice of one instance lasts' }),
	bundle: z.boolean().default(true).meta({ description: 'also measure bundle sizes' }),
	'no-bundle': z.boolean().default(false).meta({ description: 'opt out of bundle' }),
	process: z
		.boolean()
		.default(true)
		.meta({ description: 'also measure retained heap and cold start, in processes of their own' }),
	'no-process': z.boolean().default(false).meta({ description: 'opt out of process' }),
	samples: z.number().int().positive().default(15).meta({ description: 'kept cold-start rounds' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;
if (args['against-libs-file'] && !args['against-file']) {
	console.error(
		'--against-libs-file goes with --against-file: a baseline from git (--against) brings ' +
			'its own scenario module from the same ref'
	);
	process.exit(1);
}
if (has_some_allocation_node_flag()) {
	console.error(
		`grade times under the flags a consumer has: take \`${ALLOCATION_NODE_FLAGS}\` off the ` +
			'command line and out of NODE_OPTIONS, the processes that measure bytes are given them'
	);
	process.exit(1);
}

hold_benchmark_lock('fuz_schema grade');

/** How many module instances of each version a timing process holds. */
const INSTANCES = 3;
// A case's floor, in the logarithm of a time ratio: this many times what two
// instances of one version differ by on it, and never under the least. A
// spread read from a few instances can be near nothing, and a floor of nothing
// would flag anything.
const CASE_FLOOR_SPREADS = 2;
const CASE_FLOOR_LEAST = Math.log(1.01);
// The fewest runs a difference can be confirmed or a rule on time judged from,
// and how many of the runs a case must show a difference in: every one below
// `RUNS_ALL_BELOW` runs, and this share of them, rounded up, from there. A
// share of so few runs would ask less of four than of three.
const RUNS_TO_CONFIRM = 3;
const RUNS_ALL_BELOW = 5;
const RUNS_SHARE = 0.75;
// A summary's A/A is this, over the root of the runs, times the standard
// deviation of one version's instances over the summary's cases. The figure
// it stands beside is a median over runs of a difference of medians over
// instances, which moves by about a third of this, so the A/A is near three
// of its standard errors: two copies of one file read past it on about one
// line in a hundred, at three runs.
const SUMMARY_BAND_DEVIATIONS = 3.3;
// what a case must allocate more by to be listed: a word or more, and on a
// large case the share two readings of one parse can differ by
const ALLOC_FLOOR = { bytes: 8, share: 0.002 };
const SPEEDUP_PER_CORE_BYTES = { speedup: 0.1, bytes: 50 };
// the least speedup any added core bytes need, the rule's second sentence
const LEAST_SPEEDUP_FOR_BYTES = 0.05;
// of all the scenarios bundled together, this library's gzip bytes over valibot's
const CEILING_VS_VALIBOT = 0.72;
// the scenario standing in for "what `parse` plus an object schema reaches":
// the one built from `object`, the default object schema
const CORE_SCENARIO = 'strict_nested';
// the scenarios cold start samples: one small schema, one large
const COLDSTART_SCENARIOS = ['object_flat', 'type_json'];
const COLDSTART_DISCARD = 2;
// what a cold-start stage or a schema's retained bytes must grow by to be listed
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

let baseline_path: string;
let baseline_lib_path: string | undefined;
let baseline_label: string;
if (args['against-file']) {
	baseline_path = resolve(args['against-file']);
	baseline_lib_path = args['against-libs-file'] && resolve(args['against-libs-file']);
	baseline_label = args['against-file'];
} else {
	baseline_path = join(WORK_DIR, 'against_schema.ts');
	writeFileSync(baseline_path, execFileSync('git', ['show', `${args.against}:src/lib/schema.ts`]));
	baseline_lib_path = join(WORK_DIR, 'against_libs_fuz_schema.ts');
	writeFileSync(baseline_lib_path, execFileSync('git', ['show', `${args.against}:${LIB_MODULE}`]));
	baseline_label = args.against;
}
const new_path = resolve(args['new-file'] ?? 'src/lib/schema.ts');
const new_label = args['new-file'] ?? 'the working tree';
// the graded version as the bundle, heap, and cold-start builds take it
const new_variant: EntryVariant | undefined = args['new-file']
	? { id: 'new', schema_path: new_path }
	: undefined;
const identical = readFileSync(baseline_path).equals(readFileSync(new_path));

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

//
// The processes
//

// the versions in turn, so that neither's instances are all loaded first, and
// the graded one's last, which is where a process looks for it
const TIME_ARMS: GradeJob['arms'] = Array.from({ length: INSTANCES }, (_, i) => [
	{ id: `base${i}`, path: baseline_path, graded: false },
	{ id: `new${i}`, path: new_path, graded: true }
]).flat();
// two of the baseline, so that a case whose bytes are not settled shows as one
const BYTES_ARMS: GradeJob['arms'] = [
	{ id: 'base0', path: baseline_path, graded: false },
	{ id: 'base1', path: baseline_path, graded: false },
	{ id: 'new0', path: new_path, graded: true }
];

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
	return output as GradeChildOutput;
};

const to_job = (
	mode: GradeJob['mode'],
	regime: GradeJob['regime'],
	names: Array<string>,
	offset: number
): GradeJob => ({
	mode,
	regime,
	arms: mode === 'time' ? TIME_ARMS : BYTES_ARMS,
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
	bytes: 2 + (cases.length * 2.3 + alone_cases.length * 3.8) / BYTES_CONCURRENCY,
	bundle: args.bundle ? 1 : 0,
	process: args.process ? 4 + args.samples * 0.6 : 0
};
const estimate_timing =
	args.runs * (ESTIMATE.matrix_run + alone_cases.length * ESTIMATE.alone_case);

console.log(
	`grading ${new_label} against ${baseline_label}: ${cases.length} cases, ` +
		`${alone_cases.length} of them also alone, ${args.runs} ${args.runs === 1 ? 'run' : 'runs'}, ` +
		`${INSTANCES} instances a version`
);
if (identical) {
	console.log(
		'the two versions are the same file byte for byte: every difference below is noise, ' +
			'and what this run reads of it is what a real one is read against'
	);
}
console.log(
	`about ${format_seconds(estimate_timing + ESTIMATE.bytes + ESTIMATE.bundle + ESTIMATE.process)}: ` +
		`time ${format_seconds(estimate_timing)}, bytes ${format_seconds(ESTIMATE.bytes)}` +
		(args.bundle ? `, bundles ${format_seconds(ESTIMATE.bundle)}` : '') +
		(args.process ? `, retained heap and cold start ${format_seconds(ESTIMATE.process)}` : '') +
		'\n'
);

const names = cases.map((c) => c.name);
const started = performance.now();
const to_elapsed = (since: number): string => format_seconds((performance.now() - since) / 1000);

// timed, so one process at a time and nothing beside it
const matrix_runs: Array<GradeChildOutput> = [];
const alone_runs: Array<Array<GradeChildCase>> = [];
for (let run = 0; run < args.runs; run++) {
	const since = performance.now();
	matrix_runs.push(await run_job(to_job('time', 'matrix', names, run)));
	const of_run: Array<GradeChildCase> = [];
	for (const c of alone_cases) {
		of_run.push((await run_job(to_job('time', 'alone', [c.name], run))).cases[0]!);
	}
	alone_runs.push(of_run);
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

/** One case in one process: the logarithm of each instance's nanoseconds per call, by version. */
interface Reading {
	base: Array<number>;
	new: Array<number>;
}

const to_reading = (c: GradeChildCase): Reading => {
	const reading: Reading = { base: [], new: [] };
	for (const arm of c.arms) {
		reading[arm.startsWith('base') ? 'base' : 'new'].push(Math.log(stats_median(c.ns![arm]!)));
	}
	return reading;
};

const mean = (values: Array<number>): number =>
	values.reduce((sum, v) => sum + v, 0) / values.length;

// what the instances of one version are from their median, the median itself left out
const to_deviations = (values: Array<number>): Array<number> => {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = stats_median(sorted);
	return sorted
		.filter((_, i) => sorted.length % 2 === 0 || i !== sorted.length >> 1)
		.map((v) => Math.abs(v - middle));
};

const confirmable = args.runs >= RUNS_TO_CONFIRM;
const runs_needed = args.runs < RUNS_ALL_BELOW ? args.runs : Math.ceil(args.runs * RUNS_SHARE);
const NOT_JUDGED = `not judged, fewer than ${RUNS_TO_CONFIRM} runs`;

/** A case's time in one regime, over the runs. */
interface CaseTime {
	readings: Array<Reading>;
	base_ns: number;
	new_ns: number;
	/** The logarithm of new over base: the median over the runs of each run's. */
	ratio: number;
	/** The logarithm a run's ratio must be past for the run to show a difference. */
	floor: number;
	/** How many runs showed the new version slower, and faster. */
	slower_runs: number;
	faster_runs: number;
	/** Confirmed: shown in `runs_needed` of the runs, where there are enough runs to confirm from. */
	flag: 'slower' | 'faster' | undefined;
	/** Shown in one run fewer than confirms it, or, with too few runs to confirm from, in every one. */
	candidate: boolean;
}

/**
 * Reads a case's runs together.
 *
 * A run shows the case slower when every instance of the new version took
 * longer than every instance of the baseline, and the medians of the two
 * differ by more than the case's floor. Faster is the same the other way. The
 * floor is `CASE_FLOOR_SPREADS` times what an instance is from the median of
 * its own version, at its median over both versions and every run, and never
 * under `CASE_FLOOR_LEAST`.
 */
const to_case_time = (readings: Array<Reading>): CaseTime => {
	const new_ns = Math.exp(stats_median(readings.map((r) => stats_median(r.new))));
	if (!readings.every((r) => r.base.length)) {
		return {
			readings,
			base_ns: NaN,
			new_ns,
			ratio: NaN,
			floor: NaN,
			slower_runs: 0,
			faster_runs: 0,
			flag: undefined,
			candidate: false
		};
	}
	const deviations = readings.flatMap((r) => [...to_deviations(r.base), ...to_deviations(r.new)]);
	const floor = Math.max(
		CASE_FLOOR_LEAST,
		CASE_FLOOR_SPREADS * (deviations.length ? stats_median(deviations) : 0)
	);
	const deltas = readings.map((r) => stats_median(r.new) - stats_median(r.base));
	const slower_runs = readings.filter(
		(r, i) => deltas[i]! > floor && Math.min(...r.new) > Math.max(...r.base)
	).length;
	const faster_runs = readings.filter(
		(r, i) => deltas[i]! < -floor && Math.max(...r.new) < Math.min(...r.base)
	).length;
	const ratio = stats_median(deltas);
	const shown =
		slower_runs >= runs_needed ? 'slower' : faster_runs >= runs_needed ? 'faster' : undefined;
	const flag = confirmable ? shown : undefined;
	return {
		readings,
		base_ns: Math.exp(stats_median(readings.map((r) => stats_median(r.base)))),
		new_ns,
		ratio,
		floor,
		slower_runs,
		faster_runs,
		flag,
		candidate: confirmable
			? !flag && Math.max(slower_runs, faster_runs) === runs_needed - 1
			: Math.max(slower_runs, faster_runs) === args.runs
	};
};

/** A mean over cases of their time ratios, beside what the instances of one version differ by on the same cases. */
interface Summary {
	cases: number;
	/** The logarithm of new over base, a mean over the cases: the median of the runs'. */
	ratio: number;
	/** Each run's. */
	runs: Array<number>;
	/** The A/A of the same cases in the same processes, as a logarithm. */
	band: number;
}

const to_variance = (values: Array<number>): number => {
	const middle = mean(values);
	return values.reduce((sum, v) => sum + (v - middle) ** 2, 0) / (values.length - 1);
};

/**
 * Reads a set of cases together.
 *
 * A run's figure is the mean over the cases of the logarithm of the new
 * version's median instance over the baseline's, and the summary's is the
 * median of the runs'. Its A/A is taken from the same cases in the same
 * processes: each instance's mean over the cases, the variance of those among
 * the instances of one version, pooled over the versions and the runs, and
 * `SUMMARY_BAND_DEVIATIONS` of its root over the root of the runs.
 */
const to_summary = (times: Array<CaseTime>): Summary => {
	const compared = times.filter((t) => !Number.isNaN(t.ratio));
	if (!compared.length) return { cases: 0, ratio: NaN, runs: [], band: NaN };
	const runs: Array<number> = [];
	const variances: Array<number> = [];
	for (let run = 0; run < args.runs; run++) {
		const readings = compared.map((t) => t.readings[run]!);
		runs.push(mean(readings.map((r) => stats_median(r.new) - stats_median(r.base))));
		for (const version of ['base', 'new'] as const) {
			variances.push(
				to_variance(readings[0]![version].map((_, i) => mean(readings.map((r) => r[version][i]!))))
			);
		}
	}
	return {
		cases: compared.length,
		ratio: stats_median(runs),
		runs,
		band: (SUMMARY_BAND_DEVIATIONS * Math.sqrt(mean(variances))) / Math.sqrt(args.runs)
	};
};

const is_outside = (s: Summary): boolean => Math.abs(s.ratio) > s.band;

/** A case's bytes in one regime. */
interface CaseBytes {
	base: number;
	new: number;
	/** Whether two instances of the baseline read the same. */
	settled: boolean;
}

// the rise is taken to the nearest byte: a reading is a median of samples less
// the sampler's own bytes, so a rise of one word can read a shade under one
const is_past_alloc_floor = (bytes: number, from: number): boolean =>
	Math.round(bytes - from) >= Math.max(ALLOC_FLOOR.bytes, from * ALLOC_FLOOR.share);

const to_case_bytes = (c: GradeChildCase | undefined): CaseBytes => {
	const bytes = c?.bytes ?? {};
	const base = bytes.base0 ?? NaN;
	const other = bytes.base1 ?? NaN;
	return {
		base,
		new: bytes.new0 ?? NaN,
		settled:
			Number.isNaN(base) || !(is_past_alloc_floor(other, base) || is_past_alloc_floor(base, other))
	};
};

interface Graded {
	c: Case;
	matrix: CaseTime;
	alone: CaseTime | undefined;
	bytes: CaseBytes;
	alone_bytes: CaseBytes | undefined;
	same: boolean;
	base_same: boolean | undefined;
}

const graded: Array<Graded> = cases.map((c, i) => {
	const first = matrix_runs[0]!.cases[i]!;
	if (first.name !== c.name) throw new Error(`expected ${c.name} and was given ${first.name}`);
	const alone_index = alone_cases.indexOf(c);
	return {
		c,
		matrix: to_case_time(matrix_runs.map((run) => to_reading(run.cases[i]!))),
		alone:
			alone_index === -1
				? undefined
				: to_case_time(alone_runs.map((run) => to_reading(run[alone_index]!))),
		bytes: to_case_bytes(matrix_bytes.find((b) => b.name === c.name)),
		alone_bytes: alone_index === -1 ? undefined : to_case_bytes(alone_bytes[alone_index]),
		same: first.same.new0!,
		base_same: first.same.base0
	};
});

//
// Report
//

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

const format_same = (same: boolean | undefined): string =>
	same === undefined ? '-' : same ? 'input' : 'copy';

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

console.log(
	`\ncases, in the matrix: a process runs them all, so each is timed in code that has seen every schema.\n` +
		`ns is per parse, the median of ${INSTANCES} instances and of the runs. time is new over base. floor is\n` +
		`what a run's time must be past to show a difference: ${CASE_FLOOR_SPREADS} times what an instance is from the median of its own version, and at least ` +
		`${format_band(CASE_FLOOR_LEAST)}.\nB is heap bytes per parse, ~ where two instances of the baseline differ. ` +
		`out is whether the output\nis the input itself.\n${marks_note}\n`
);
console.log(
	format_table([
		['case', 'path', 'base ns', 'new ns', 'time', 'floor', 'base B', 'new B', 'alloc', 'out'],
		...graded.map((g) => [
			g.c.name + (g.c.realistic ? ' †' : ''),
			g.c.path,
			...to_time_cells(g.matrix),
			...to_bytes_cells(g.bytes),
			g.base_same === undefined || g.base_same === g.same
				? format_same(g.same)
				: `${format_same(g.base_same)}→${format_same(g.same)}`
		])
	])
);
console.log('† realistic case, the ones the acceptance rules judge speed on');

const graded_alone = graded.filter((g) => g.alone);
if (graded_alone.length) {
	console.log(
		'\ncases, alone: a process runs one case and nothing else, so the engine specializes the library\n' +
			'to that schema. The columns are as above, with the matrix time beside for comparison.\n'
	);
	console.log(
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

type Regime = 'matrix' | 'alone';
const REGIMES: ReadonlyArray<Regime> = ['matrix', 'alone'];

const to_bytes_of = (g: Graded, regime: Regime): CaseBytes =>
	regime === 'matrix' ? g.bytes : g.alone_bytes!;

const format_alloc_sum = (gs: Array<Graded>, regime: Regime): string => {
	const compared = gs.map((g) => to_bytes_of(g, regime)).filter((b) => !Number.isNaN(b.base));
	const sum = (key: 'base' | 'new'): number => compared.reduce((total, b) => total + b[key], 0);
	return compared.length ? format_ratio(to_bytes_ratio(sum('new'), sum('base'))) : '-';
};

const summarize = (gs: Array<Graded>, regime: Regime): Summary =>
	to_summary(gs.map((g) => g[regime]!));

for (const regime of REGIMES) {
	const of_regime = graded.filter((g) => g[regime] && !Number.isNaN(g[regime].ratio));
	if (!of_regime.length) continue;
	const to_group_row = (label: string, gs: Array<Graded>): Array<string> => {
		const valid = summarize(
			gs.filter((g) => g.c.valid),
			regime
		);
		const invalid = summarize(
			gs.filter((g) => !g.c.valid),
			regime
		);
		return [
			label,
			String(gs.length),
			format_time(valid.ratio, ''),
			format_band(valid.band),
			format_time(invalid.ratio, ''),
			format_band(invalid.band),
			format_alloc_sum(gs, regime)
		];
	};
	// a path's cases are of one validity, but for `probe`, so its row has one time
	const to_path_rows = (label: string, gs: Array<Graded>): Array<Array<string>> =>
		CASE_PATHS.map((path) => gs.filter((g) => g.c.path === path))
			.filter((of_path) => of_path.length)
			.map((of_path) => {
				const summary = summarize(of_path, regime);
				return [
					label + of_path[0]!.c.path,
					String(of_path.length),
					format_time(summary.ratio, ''),
					format_band(summary.band),
					format_alloc_sum(of_path, regime)
				];
			});
	const realistic = of_regime.filter((g) => g.c.realistic);
	console.log(
		`\nsummary, ${regime}: time is the geometric mean of the cases' ratios, and the A/A beside it is from what\n` +
			'the instances of one version differ by over the same cases, in the same processes: a time inside\n' +
			'it is no difference. alloc is the ratio of summed bytes.\n'
	);
	console.log(
		format_table([
			['group', 'cases', 'valid time', 'A/A', 'invalid time', 'A/A', 'alloc'],
			...[...new Set(of_regime.map((g) => g.c.group))].map((group) =>
				to_group_row(
					group,
					of_regime.filter((g) => g.c.group === group)
				)
			),
			to_group_row('realistic †', realistic),
			to_group_row('all', of_regime)
		])
	);
	console.log(`\nby path, ${regime}: what the parse does\n`);
	console.log(
		format_table([
			['path', 'cases', 'time', 'A/A', 'alloc'],
			...to_path_rows('realistic † ', realistic),
			...to_path_rows('all ', of_regime)
		])
	);
}

//
// Bundle size
//

let core_delta = 0;
let all_vs_valibot = NaN;

if (args.bundle) {
	const columns = [...SCENARIOS.map((s) => [s.name]), SCENARIOS.map((s) => s.name)];
	const headers = [...SCENARIOS.map((s) => s.name), 'all'];
	const base_sizes: Array<number> = [];
	const sizes: Array<number> = [];
	for (const column of columns) {
		base_sizes.push(
			(
				await measure_bundle_size('fuz_schema', column, {
					schema_path: baseline_path,
					lib_path: baseline_lib_path
				})
			).gzip
		);
		sizes.push(
			(await measure_bundle_size('fuz_schema', column, { schema_path: new_variant?.schema_path }))
				.gzip
		);
	}
	const valibot_all = (await measure_bundle_size('valibot', columns.at(-1)!)).gzip;
	const core_index = headers.indexOf(CORE_SCENARIO);
	core_delta = sizes[core_index]! - base_sizes[core_index]!;
	all_vs_valibot = sizes.at(-1)! / valibot_all;
	// every export of each version's own module, which no rule reads
	headers.push('library');
	base_sizes.push((await measure_library_size(baseline_path)).gzip);
	sizes.push((await measure_library_size(new_path)).gzip);

	console.log('\nbundle size: minified + gzip bytes per scenario, and of every export together\n');
	console.log(
		format_table([
			['', ...headers],
			['base', ...base_sizes.map(String)],
			['new', ...sizes.map(String)],
			[
				'delta',
				...sizes.map((s, i) => `${s - base_sizes[i]! >= 0 ? '+' : ''}${s - base_sizes[i]!}`)
			]
		])
	);
}

//
// Retained heap and cold start, in processes of their own
//

const heap_grew: Array<string> = [];
const coldstart_slower: Array<string> = [];
let coldstart_ratio = NaN;

if (args.process) {
	const variant: EntryVariant = {
		id: 'base',
		schema_path: baseline_path,
		lib_path: baseline_lib_path
	};

	const heap_rows: Array<Array<string>> = [];
	for (const scenario of SCENARIOS) {
		const base = await measure_retained_heap('fuz_schema', scenario.name, variant);
		const current = await measure_retained_heap('fuz_schema', scenario.name, new_variant);
		const format_delta = (delta: number): string => `${delta >= 0 ? '+' : ''}${delta}`;
		heap_rows.push([
			scenario.name,
			(base.total_bytes / 1024).toFixed(1),
			(current.total_bytes / 1024).toFixed(1),
			format_delta(current.total_bytes - base.total_bytes),
			String(base.further_schema_bytes),
			String(current.further_schema_bytes),
			format_delta(current.further_schema_bytes - base.further_schema_bytes)
		]);
		// a reading repeats to about the size of a collection's jitter
		if (
			current.total_bytes - base.total_bytes > HEAP_SETTLED_BELOW_BYTES ||
			current.further_schema_bytes > base.further_schema_bytes * (1 + PROCESS_FLOOR)
		) {
			heap_grew.push(scenario.name);
		}
	}
	console.log(
		'\nretained heap: after building one schema and parsing once, over a bare process,\n' +
			'and what each schema past the first adds\n'
	);
	console.log(
		format_table([
			['scenario', 'base KB', 'new KB', 'delta B', 'base B/schema', 'new B/schema', 'delta B'],
			...heap_rows
		])
	);

	const plan = await plan_coldstart(
		[
			{ id: 'fuz_schema.new', lib: 'fuz_schema', variant: new_variant },
			{ id: 'fuz_schema.base', lib: 'fuz_schema', variant }
		],
		COLDSTART_SCENARIOS,
		ENTRY_FORMS
	);
	sample_coldstart(plan, args.samples, COLDSTART_DISCARD);
	const coldstart_rows: Array<Array<string>> = [];
	const ratios: Array<number> = [];
	for (const scenario of COLDSTART_SCENARIOS) {
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
	console.log(
		`\ncold start: median ms of work inside a fresh process, ${args.samples} samples, each stage including\n` +
			'the ones before it; band is the wider p10 to p90 spread of the two; peak is KB of resident memory\n'
	);
	console.log(
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
const valid_by_regime = REGIMES.map((regime) => {
	const valid = graded.filter(
		(g) => g.c.realistic && g.c.valid && g[regime] && !Number.isNaN(g[regime].ratio)
	);
	return {
		regime,
		whole: summarize(valid, regime),
		paths: CASE_PATHS.map((path) => ({
			path,
			summary: summarize(
				valid.filter((g) => g.c.path === path),
				regime
			)
		})).filter((p) => p.summary.cases)
	};
}).filter((v) => v.whole.cases);

console.log(
	`\nagainst the acceptance rules: time is of ${args.runs} ${args.runs === 1 ? 'run' : 'runs'} together, and every figure of it is beside its A/A\n`
);
if (!valid_by_regime.length) {
	console.log('realistic valid-path speed: no realistic valid cases in this run');
}
for (const { regime, whole, paths } of valid_by_regime) {
	console.log(
		`realistic valid-path speed, ${regime}: ${format_speed(whole)}: ${format_standing(whole)}\n` +
			`  by run: ${whole.runs.map((r) => format_percent(1 - Math.exp(r))).join(', ')}\n` +
			`  by path: ${paths.map((p) => `${p.path} ${format_speed(p.summary)}`).join(', ')}`
	);
}
if (args.bundle) {
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
		graded.filter((g) => g.c.realistic && !g.c.valid && g.matrix && !Number.isNaN(g.matrix.ratio)),
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
	console.log(
		`core bytes (${CORE_SCENARIO}): ${core_delta >= 0 ? '+' : ''}${core_delta} gzip, ` +
			`which needs ${format_percent(required)} realistic speed in the matrix, on the valid path ` +
			`or with it not slower on the invalid: ${verdict}`
	);
	console.log(
		`size ceiling: all scenarios are ${all_vs_valibot.toFixed(2)}x valibot, ` +
			`limit ${CEILING_VS_VALIBOT.toFixed(2)}x: ${all_vs_valibot <= CEILING_VS_VALIBOT ? 'pass' : 'FAIL'}`
	);
}

const to_flagged = (regime: Regime, flag: CaseTime['flag'], valid?: boolean): Array<Graded> =>
	graded.filter((g) => g[regime]?.flag === flag && (valid === undefined || g.c.valid === valid));

// what of the valid path reads slower past its A/A: a summary, or cases, which are named below
// the cases are counted in every regime, whether or not it has a realistic valid one
const slowed = [
	...valid_by_regime.flatMap(({ regime, whole, paths }) =>
		[{ path: 'valid', summary: whole }, ...paths]
			.filter((p) => is_outside(p.summary) && p.summary.ratio > 0)
			.map((p) => `realistic ${p.path} ${regime} ${format_speed(p.summary)}`)
	),
	...REGIMES.flatMap((regime) => {
		const slower_cases = to_flagged(regime, 'slower', true).length;
		return slower_cases
			? [`${slower_cases} valid ${slower_cases === 1 ? 'case' : 'cases'} slower ${regime}`]
			: [];
	})
];
console.log(
	'the valid path is not slowed: ' +
		(!confirmable ? NOT_JUDGED : slowed.length ? `FAIL: ${slowed.join(', ')}` : 'pass')
);

for (const regime of REGIMES) {
	if (!graded.some((g) => g[regime])) continue;
	console.log(`cases slower, ${regime}: ${format_names(to_flagged(regime, 'slower'))}`);
	console.log(`cases faster, ${regime}: ${format_names(to_flagged(regime, 'faster'))}`);
	console.log(
		`cases marked ?, ${regime}: ` + format_names(graded.filter((g) => g[regime]?.candidate))
	);
}
const to_more_alloc = (regime: Regime): Array<Graded> =>
	graded.filter((g) => {
		const bytes = g[regime] && to_bytes_of(g, regime);
		return bytes && bytes.settled && is_past_alloc_floor(bytes.new, bytes.base);
	});
const unsettled = graded.filter((g) => !g.bytes.settled || g.alone_bytes?.settled === false);
console.log(`cases allocating more, matrix: ${format_names(to_more_alloc('matrix'))}`);
if (graded_alone.length) {
	console.log(`cases allocating more, alone: ${format_names(to_more_alloc('alone'))}`);
}
console.log(
	`cases whose bytes two instances of the baseline differ on: ${format_names(unsettled)}`
);
console.log(
	`cases whose output identity changed: ${format_names(graded.filter((g) => g.base_same !== undefined && g.base_same !== g.same))}`
);
const disagreed = [...new Set(matrix_runs.flatMap((run) => run.disagreed))];
if (disagreed.length) {
	console.log(`cases the baseline gives another verdict on, not compared: ${disagreed.join(', ')}`);
}
if (args.process) {
	console.log(
		`cold start, first parse: ${format_ratio(coldstart_ratio)} the baseline's; ` +
			`stages slower past their own spread: ${coldstart_slower.length ? coldstart_slower.join(', ') : 'none'}`
	);
	console.log(`scenarios retaining more: ${heap_grew.length ? heap_grew.join(', ') : 'none'}`);
}
console.log(`\n${to_elapsed(started)}`);
