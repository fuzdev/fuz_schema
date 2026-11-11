/**
 * Grades a version of `schema.ts`, by default the working tree's, against
 * another, across every factor the acceptance rules weigh: time and allocation
 * per case, whether the output is the input itself, bundle size per scenario
 * and per export, priced by `grade_bytes.ts`, retained heap per scenario and
 * per export, priced by `grade_heap.ts`, and cold start.
 *
 * This module measures nothing itself. It plans the processes, runs them one
 * at a time where they are timed, and has `grade_read.ts` read the verdict
 * from all of them together. `grade_child.ts` is a process, and says how one
 * is timed. With `--replay <dir>` it runs no process, and reads again a grade
 * that finished, from the record and the jobs it left in that directory.
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
 *   npm run grade -- --replay .gro/grade/<start>
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { availableParallelism, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { map_concurrent } from '@fuzdev/fuz_util/async.ts';

import { meta, parse_args, s } from './args.ts';
import { create_cases, type SchemaLib } from './cases.ts';
import {
	format_machine_state,
	read_cpu_model,
	read_machine_state,
	read_package_versions
} from './machine.ts';
import { PROGRAM } from './program.ts';
import { SCENARIOS } from './scenarios.ts';
import { measure_bundle_size, measure_export_sizes } from './bundle_size.ts';
import { CHANGE_CLASSES } from './grade_bytes.ts';
import { BASELINE_LIB } from './libs.ts';
import { ENTRY_FORMS, start_child, type EntryVariant } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart,
	type ColdstartSummary
} from './coldstart.ts';
import {
	GRADE_APART_ROUNDS,
	GRADE_PRELUDE_MS,
	GRADE_WARM_MS,
	type GradeChildOutput,
	type GradeJob,
	type GradeJobArm
} from './grade_job.ts';
import {
	APART_CASES,
	APART_PROCESSES,
	COLDSTART_SCENARIOS,
	GRADE_LOCK_FILE,
	INSTANCES,
	to_apart_jobs,
	to_bytes_arms,
	to_chunks,
	to_grade_job,
	to_grade_lock_state,
	to_time_arms
} from './grade_plan.ts';
import {
	format_grade_record,
	format_grade_report,
	load_grade,
	read_grade,
	type GradeBundleMeasures,
	type GradeColdstartForm,
	type GradeHeapMeasures,
	type GradeJobsIndex,
	type GradeOutputs,
	type GradeRecord,
	type GradeSetup,
	type ScenarioLibsRow
} from './grade_read.ts';
import { measure_export_heap, measure_retained_heap } from './heap.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_seconds,
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
	}),
	replay: meta(s.optional(s.string), {
		description:
			'measure nothing, and read again the grade whose record and jobs are in this directory, ' +
			'by the rules as they are now, writing its report there as report_replay.json'
	})
});

const args = parse_args(Args);
if (args._.length) {
	console.error(
		`grade reads no positional args, and was given ${args._.map((a) => JSON.stringify(a)).join(' ')}: ` +
			'to grade the cases whose name includes a part, give it as --filter <part>'
	);
	process.exit(1);
}
if (args['against-libs-file'] && !args['against-file']) {
	console.error(
		'--against-libs-file goes with --against-file: a baseline from git (--against) brings ' +
			'its own scenario module from the same ref'
	);
	process.exit(1);
}

const COLDSTART_DISCARD = 2;
// how many byte processes run at once, of both regimes together: they are not
// timed, so they may share the machine
const BYTES_CONCURRENCY = Math.max(1, Math.min(6, availableParallelism() >> 1));

const LIB_MODULE = 'src/benchmarks/libs/fuz_schema.ts';
const WORK_DIR = resolve('.gro/grade');
const CHILD_PATH = fileURLToPath(new URL('./grade_child.ts', import.meta.url));

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

const LOCK_PATH = join(WORK_DIR, GRADE_LOCK_FILE);

// whether a process of the pid is alive, one this user may not signal among them
const is_pid_alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

const read_lock = (): string | undefined => {
	try {
		return readFileSync(LOCK_PATH, 'utf8');
	} catch {
		return undefined;
	}
};

/**
 * Takes the lock of the grader's directory for this process, or exits where
 * another grade holds it: two grades at once write the same copies of the two
 * versions, which each other's processes load. A lock whose pid is not alive
 * is taken over, with a note. It is let go as the process exits, however it
 * exits but by a signal, which leaves it stale.
 */
const take_lock = (): void => {
	for (;;) {
		try {
			writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
		const lock = to_grade_lock_state(read_lock(), is_pid_alive);
		if (lock.state === 'held') {
			console.error(
				`another grade is measuring in this checkout, process ${lock.pid}, which holds ${LOCK_PATH}: ` +
					"two at once would load each other's copies of the versions. Grade when it is done, " +
					`or remove ${LOCK_PATH} if process ${lock.pid} is not a grade`
			);
			process.exit(1);
		}
		if (lock.state === 'unreadable') {
			console.error(
				`${LOCK_PATH} names no process, ${JSON.stringify(lock.text)}: remove it if no grade is measuring`
			);
			process.exit(1);
		}
		if (lock.state === 'stale') {
			console.log(`taking over ${LOCK_PATH} from process ${lock.pid}, which is not running`);
			unlinkSync(LOCK_PATH);
		}
	}
	process.on('exit', () => {
		if (read_lock() !== String(process.pid)) return;
		try {
			unlinkSync(LOCK_PATH);
		} catch {
			// gone already, which leaves nothing to let go
		}
	});
};

/**
 * Runs every process of a grade and reads what each measured.
 *
 * @returns the record of the grade, what its jobs printed, and its own directory
 */
const measure_grade = async (): Promise<{
	record: GradeRecord;
	outputs: GradeOutputs;
	dir: string;
}> => {
	refuse_timing_node_flags('grade', true);
	mkdirSync(WORK_DIR, { recursive: true });
	// before either copy is written, which another grade's processes may be loading
	take_lock();

	//
	// The two versions
	//

	// Both versions are loaded from this directory, whatever file each came from.
	// The same bytes read apart by where their file sits: a file outside any
	// directory whose `package.json` gives a `type` took a tenth longer on a case,
	// in most processes, than a copy of it inside one.
	const baseline_path = join(WORK_DIR, 'against_schema.ts');
	const new_path = join(WORK_DIR, 'new_schema.ts');
	const paths = { baseline_path, new_path };
	// read before either copy is written: a file given may be a copy an earlier grade left here
	const new_source = readFileSync(resolve(args['new-file'] ?? 'src/lib/schema.ts'));

	let baseline_lib_path: string | undefined;
	let baseline_label: string;
	if (args['against-file']) {
		writeFileSync(baseline_path, readFileSync(resolve(args['against-file'])));
		baseline_lib_path = args['against-libs-file'] && resolve(args['against-libs-file']);
		baseline_label = args['against-file'];
	} else {
		writeFileSync(
			baseline_path,
			execFileSync('git', ['show', `${args.against}:src/lib/schema.ts`])
		);
		baseline_lib_path = join(WORK_DIR, 'against_libs_fuz_schema.ts');
		writeFileSync(
			baseline_lib_path,
			execFileSync('git', ['show', `${args.against}:${LIB_MODULE}`])
		);
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

	const TIME_ARMS = to_time_arms(paths);
	const BYTES_ARMS = to_bytes_arms(paths);

	let job_count = 0;

	// a job's output, and the number its files are under in the jobs directory
	const run_job = async (job: GradeJob): Promise<{ job: number; output: GradeChildOutput }> => {
		const number = job_count++;
		const path = join(jobs_dir, `${number}.json`);
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
		return { job: number, output: output as GradeChildOutput };
	};

	const to_job = (
		mode: GradeJob['mode'],
		regime: GradeJob['regime'],
		names: Array<string>,
		offset: number,
		arms: Array<GradeJobArm> = mode === 'time' ? TIME_ARMS : BYTES_ARMS
	): GradeJob => to_grade_job(mode, regime, names, offset, arms, args.slice);

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
		process: args.process ? 10 + args.samples * 1.4 : 0
	};
	const estimate_apart =
		args.runs * apart_cases.length * 2 * APART_PROCESSES * ESTIMATE.apart_process;
	const estimate_timing =
		args.runs * (ESTIMATE.matrix_run + alone_cases.length * ESTIMATE.alone_case) + estimate_apart;

	const read_grade_setup = (): GradeSetup => {
		const status = to_git(['status', '--porcelain']);
		return {
			hostname: hostname(),
			cpu_model: read_cpu_model(),
			node: process.versions.node,
			v8: process.versions.v8,
			packages: read_package_versions(COMPARED_PACKAGES),
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

	const machine_start = read_machine_state();
	const setup = read_grade_setup();
	const started_at = new Date();
	// the grade's own directory, named for its start: its jobs, its record, and a copy of its report
	const grade_dir = join(
		WORK_DIR,
		started_at
			.toISOString()
			.replace(/\.\d+Z$/, 'Z')
			.replaceAll(':', '-')
	);
	const jobs_dir = join(grade_dir, 'jobs');
	// not recursive: a grade started in the same second as the last fails here, and leaves its jobs
	mkdirSync(grade_dir);
	mkdirSync(jobs_dir);
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

	const started = performance.now();
	const to_elapsed = (since: number): string => format_seconds((performance.now() - since) / 1000);

	const jobs: GradeJobsIndex = {
		matrix: [],
		alone: [],
		apart: [],
		bytes_matrix: [],
		bytes_alone: []
	};
	const outputs: GradeOutputs = {
		matrix: [],
		alone: [],
		apart: [],
		bytes_matrix: [],
		bytes_alone: []
	};

	// times the cases of the `apart` regime for one run, each in the processes `to_apart_jobs` plans
	const time_apart = async (run: number): Promise<void> => {
		const run_jobs: GradeJobsIndex['apart'][number] = [];
		const run_outputs: GradeOutputs['apart'][number] = [];
		for (const [index, c] of apart_cases.entries()) {
			const case_jobs: GradeJobsIndex['apart'][number][number] = [];
			const case_outputs: GradeOutputs['apart'][number][number] = [];
			for (const { graded, job: planned } of to_apart_jobs(paths, c.name, run, index, args.slice)) {
				const { job, output } = await run_job(planned);
				case_jobs.push({ job, graded });
				case_outputs.push({ graded, output });
			}
			run_jobs.push(case_jobs);
			run_outputs.push(case_outputs);
		}
		jobs.apart.push(run_jobs);
		outputs.apart.push(run_outputs);
	};

	// timed, so one process at a time and nothing beside it
	for (let run = 0; run < args.runs; run++) {
		const since = performance.now();
		const matrix = await run_job(to_job('time', 'matrix', names, run));
		jobs.matrix.push(matrix.job);
		outputs.matrix.push(matrix.output);
		const run_jobs: Array<number> = [];
		const run_outputs: GradeOutputs['alone'][number] = [];
		for (const c of alone_cases) {
			const { job, output } = await run_job(to_job('time', 'alone', [c.name], run));
			run_jobs.push(job);
			run_outputs.push(output.cases[0]!);
		}
		jobs.alone.push(run_jobs);
		outputs.alone.push(run_outputs);
		await time_apart(run);
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
	for (const { job, output } of bytes_outputs.slice(0, matrix_chunks.length)) {
		jobs.bytes_matrix.push(job);
		outputs.bytes_matrix.push(...output.cases);
	}
	for (const { job, output } of bytes_outputs.slice(matrix_chunks.length)) {
		jobs.bytes_alone.push(job);
		outputs.bytes_alone.push(output.cases[0]!);
	}
	console.log(`bytes: ${to_elapsed(bytes_since)}`);

	//
	// Bundle size
	//

	// The bundles and the retained heap of the graded version are built from the
	// working tree's own file where no --new-file is given, read as it is when
	// they are measured, and not from the copy timed: a file changed since the
	// copy was taken would give the bytes and heap of another file than the rest.
	// Checked before each and after it, so a change while one is measured is seen too.
	const measured_path = new_variant?.schema_path ?? resolve('src/lib/schema.ts');
	const refuse_changed = (what: string): void => {
		const hash = to_file_hash(measured_path);
		if (hash === setup.new_hash) return;
		console.error(
			`${measured_path} changed during the grade: its SHA-256 begins ${hash} where the copy timed ` +
				`begins ${setup.new_hash}, so ${what} of another file than the timing. ` +
				(args['new-file']
					? `It is the grader's own copy of ${args['new-file']}, which changes only if something ` +
						`else writes to ${WORK_DIR}: grade again with nothing else writing there`
					: 'Grade again with the file left alone, or grade a copy of it with --new-file')
		);
		process.exit(1);
	};

	let bundle: GradeBundleMeasures | undefined;
	if (args.bundle) {
		refuse_changed('the bundles would be');
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
		// a scenario the baseline's module lacks, as a feature adds, beside other libraries' bundles of it
		const new_scenario_libs = [BASELINE_LIB, 'zod_mini'];
		const many_schemas = SCENARIOS.filter((s) => s.many_schemas).map((s) => s.name);
		const to_scenario_libs_row = async (name: string): Promise<ScenarioLibsRow> => ({
			name,
			gzip: scenario_rows.find((r) => r.name === name)!.new,
			libs: await Promise.all(
				new_scenario_libs.map(async (lib) => ({
					lib,
					gzip: (await measure_bundle_size(lib, [name])).gzip
				}))
			)
		});
		// a feature's scenario is the comparison of its export against other libraries
		const new_scenario_rows = await Promise.all(unshared_scenarios.map(to_scenario_libs_row));
		const many_schema_rows = await Promise.all(many_schemas.map(to_scenario_libs_row));
		const [base_exports, new_exports] = export_sizes;
		bundle = {
			scenarios: scenario_rows,
			unshared: unshared_scenarios,
			many_schemas,
			new_scenario_libs,
			all: { base: base_all, new_shared, new_every, valibot: valibot_all },
			base_exports,
			new_exports,
			new_scenario_rows,
			many_schema_rows
		};
		refuse_changed('the bundles were');
		console.log(`\nbundles: ${to_elapsed(since)}`);
	}

	//
	// Retained heap and cold start, in processes of their own
	//

	let heap: GradeHeapMeasures | undefined;
	let coldstart: Array<GradeColdstartForm> | undefined;
	if (args.process) {
		refuse_changed('the retained heap would be');
		const variant: EntryVariant = {
			id: 'base',
			schema_path: baseline_path,
			lib_path: baseline_lib_path
		};
		const since = performance.now();

		const heap_scenarios: GradeHeapMeasures['scenarios'] = [];
		for (const scenario of SCENARIOS) {
			const current = await measure_retained_heap('fuz_schema', scenario.name, new_variant);
			// a scenario the baseline's module lacks is compared on nothing
			const base = shared_scenarios.includes(scenario.name)
				? await measure_retained_heap('fuz_schema', scenario.name, variant)
				: { total_bytes: NaN, further_schema_bytes: NaN };
			heap_scenarios.push({
				name: scenario.name,
				base: { total_bytes: base.total_bytes, further_schema_bytes: base.further_schema_bytes },
				new: {
					total_bytes: current.total_bytes,
					further_schema_bytes: current.further_schema_bytes
				}
			});
		}
		// strict for the graded version, which has every export the program names
		const [base_exports, new_exports] = [
			await measure_export_heap(variant),
			await measure_export_heap(new_variant, true)
		];
		heap = { scenarios: heap_scenarios, base_exports, new_exports };
		refuse_changed('the retained heap was');
		console.log(`\nretained heap: ${to_elapsed(since)}`);

		// a baseline's module may be from before one of them
		const coldstart_scenarios = COLDSTART_SCENARIOS.filter((name) =>
			shared_scenarios.includes(name)
		);
		const plan = await plan_coldstart(
			// the new version as a variant too, so an unbundled entry of either is its stripped source,
			// where the working tree's would otherwise be its build
			[
				{ id: 'fuz_schema.new', lib: 'fuz_schema', variant: { id: 'new', schema_path: new_path } },
				{ id: 'fuz_schema.base', lib: 'fuz_schema', variant }
			],
			coldstart_scenarios,
			ENTRY_FORMS
		);
		sample_coldstart(plan, args.samples, COLDSTART_DISCARD);
		coldstart = coldstart_scenarios.flatMap((scenario) =>
			ENTRY_FORMS.map((form): GradeColdstartForm => {
				const of_stage = (target: string, stage: string): ColdstartSummary =>
					summarize_coldstart(
						plan.processes.find(
							(p) =>
								p.target === target &&
								p.scenario === scenario &&
								p.form === form &&
								p.stage === stage
						)!,
						plan.bare
					);
				return {
					scenario,
					form,
					stages: COLDSTART_STAGES.map((stage) => ({
						stage,
						base: of_stage('fuz_schema.base', stage),
						new: of_stage('fuz_schema.new', stage)
					}))
				};
			})
		);
	}

	const machine_end = read_machine_state();
	const record: GradeRecord = {
		graded: new_label,
		against: baseline_label,
		identical,
		args,
		dir: grade_dir,
		started_at: started_at.toISOString(),
		ended_at: new Date().toISOString(),
		elapsed_s: (performance.now() - started) / 1000,
		setup,
		machine: { start: machine_start, end: machine_end },
		instances: INSTANCES,
		apart_processes: APART_PROCESSES,
		program_entries: PROGRAM.length,
		cases: cases.map((c) => ({
			name: c.name,
			group: c.group,
			realistic: c.realistic,
			path: c.path,
			valid: c.valid
		})),
		realistic_total: all_cases.filter((c) => c.realistic).length,
		alone: alone_cases.map((c) => c.name),
		apart: apart_cases.map((c) => c.name),
		bundle,
		heap,
		coldstart,
		jobs
	};
	return { record, outputs, dir: grade_dir };
};

if (args.replay) {
	const dir = resolve(args.replay);
	if (!existsSync(dir)) {
		console.error(`--replay ${args.replay}: there is no ${dir}`);
		process.exit(1);
	}
	const loaded = load_grade((path) => {
		const file = join(dir, path);
		return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
	});
	if (!loaded.ok) {
		console.error(`--replay ${args.replay}: ${loaded.message}`);
		process.exit(1);
	}
	const { verdict, tables, report } = read_grade(loaded.record, loaded.outputs);
	console.log(verdict.join('\n'));
	console.log(tables.join('\n'));
	const replay_path = join(dir, 'report_replay.json');
	writeFileSync(replay_path, format_grade_report(report));
	console.log(`\nthe whole report of the replay, as JSON: ${replay_path}`);
} else {
	const { record, outputs, dir } = await measure_grade();
	// the record first, so a grade whose reading throws can be read again
	writeFileSync(join(dir, 'record.json'), format_grade_record(record));
	const { verdict, tables, report } = read_grade(record, outputs);
	console.log(verdict.join('\n'));
	console.log(tables.join('\n'));
	const REPORT_PATH = join(WORK_DIR, 'report.json');
	writeFileSync(REPORT_PATH, format_grade_report(report));
	// a copy under the time it started, so the next grade leaves this one's
	const report_copy = join(dir, 'report.json');
	copyFileSync(REPORT_PATH, report_copy);
	console.log(`\nthe whole report, as JSON: ${REPORT_PATH}, and a copy at ${report_copy}`);
	console.log(`\n${format_seconds(record.elapsed_s)}`);
}
