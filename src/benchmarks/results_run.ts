/**
 * A run of the whole suite into one results file: every script in turn, each
 * in a process of its own through its npm script, so under the node flags that
 * script gives it, each writing what it measured with `--data`, composed with
 * where and when the run was made and validated through `results_schema.ts`.
 *
 * ```bash
 * npm run results -- --machine <name>          # a full run, every script at its own defaults
 * npm run results -- --machine <name> --plan   # what a run would do, measuring nothing
 * npm run results -- --smoke                   # every script as briefly as it goes
 * npm run results -- --smoke --only bundle --only run
 * ```
 *
 * This process measures nothing. It starts one script at a time with a
 * blocking call, the script's output going to a file, so it does no work
 * while a script measures, and reads the script's data only once it has
 * exited. A script that fails doesn't stop the run: its section says so, and
 * the run is then not publishable.
 *
 * The commit and the state of the working tree are read as the run starts and
 * again as it ends, and the file records both: a run takes long enough for an
 * edit or a commit to land in it, and a commit records what ran only when the
 * tree was clean at it both times.
 *
 * A run is written to `results/<UTC date>_<machine>.json` exactly when it is
 * publishable, and otherwise under `results/scratch/`, which git ignores. It
 * never writes `results/latest.json`: `results_publish.ts` does.
 *
 * @module
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { read_cpu_model, read_machine_state, read_package_versions } from './machine.ts';
import { format_seconds } from './measure.ts';
import {
	RESULTS_DATA_FLAG,
	RESULTS_DIR_NAME,
	RESULTS_MACHINE_NAME_MATCHER,
	RESULTS_RUN_ARG_NAMES,
	RESULTS_SECTION_IDS,
	RESULTS_STEPS,
	RESULTS_TOOL_PACKAGES,
	estimate_results_seconds,
	find_unpublishable_reasons,
	plan_results_steps,
	to_results_libs,
	to_results_machine_name,
	to_results_path,
	to_results_steps_dir,
	type PlannedResultsStep,
	type ResultsRunOptions,
	type ResultsStepNeed
} from './results_plan.ts';
import {
	benchmark_results_is_publishable,
	describe_benchmark_run,
	parse_benchmark_data,
	parse_benchmark_results,
	serialize_benchmark_results,
	type BenchmarkId,
	type BenchmarkResults,
	type BenchmarkSection
} from './results_schema.ts';

const REPO_DIR = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A run that can't go on. `exit_code` is 2 when the caller has to change
 * something first, and 1 otherwise.
 */
export class ResultsRunError extends Error {
	readonly exit_code: number;

	constructor(message: string, exit_code: number = 1) {
		super(message);
		this.name = 'ResultsRunError';
		this.exit_code = exit_code;
	}
}

/** How a script's process ended. */
export interface ResultsStepOutcome {
	/** Its exit code, `null` when a signal ended it. */
	status: number | null;
	signal: string | null;
	/** Why the process couldn't be started, if it couldn't. */
	error: string | null;
}

/** What a run is given in place of the machine's own, for tests. */
export interface ResultsRunDeps {
	/** The repository root, which the results directory and the builds are under. */
	dir: string;
	/** The scripts of `package.json`, by name. */
	scripts: Readonly<Record<string, string>>;
	/**
	 * The commit the tree is at, and whether it has changes the commit doesn't
	 * record. A run calls it as it starts and again as it ends.
	 */
	read_commit: () => { commit: string; dirty: boolean };
	/**
	 * Starts a script through its npm script and blocks until it exits, its
	 * output going to `log_path`.
	 */
	run_step: (script: string, args: ReadonlyArray<string>, log_path: string) => ResultsStepOutcome;
	/** Receives progress and notes. */
	log: (line: string) => void;
}

/**
 * Reads the commit a run is at, and whether the working tree has changes the
 * commit doesn't record. Results files don't count: a run's own output changes
 * nothing that is measured. Git is asked without its optional locks, so
 * reading the state writes nothing to the index.
 *
 * @param dir - the root of the checkout
 * @throws ResultsRunError if `dir` isn't in a git checkout, since a run must say what produced it
 */
export const read_results_commit = (dir: string): { commit: string; dirty: boolean } => {
	const git = (args: Array<string>): string =>
		execFileSync('git', ['--no-optional-locks', ...args], {
			cwd: dir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
	try {
		const commit = git(['rev-parse', 'HEAD']).trim();
		const changes = git([
			'status',
			'--porcelain',
			'--',
			'.',
			`:(exclude)${RESULTS_DIR_NAME}`
		]).trim();
		return { commit, dirty: changes !== '' };
	} catch (error) {
		throw new ResultsRunError(
			`a run records the commit it ran at, and git couldn't say: ${(error as Error).message}`
		);
	}
};

// starts an npm script and blocks until it exits, with everything it prints in a file
const run_npm_script = (
	dir: string,
	script: string,
	args: ReadonlyArray<string>,
	log_path: string
): ResultsStepOutcome => {
	const fd = openSync(log_path, 'w');
	try {
		const child = spawnSync('npm', ['run', script, '--', ...args], {
			cwd: dir,
			stdio: ['ignore', fd, fd]
		});
		return { status: child.status, signal: child.signal, error: child.error?.message ?? null };
	} finally {
		closeSync(fd);
	}
};

/** The machine's own: the repository this module is in, its scripts, git, and npm. */
export const create_results_run_deps = (): ResultsRunDeps => ({
	dir: REPO_DIR,
	scripts: (
		JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		}
	).scripts,
	read_commit: () => read_results_commit(REPO_DIR),
	run_step: (script, args, log_path) => run_npm_script(REPO_DIR, script, args, log_path),
	log: (line) => console.log(line)
});

/** What each kind of need reads, and the command that builds it. */
const NEEDS: Record<ResultsStepNeed, { files: Array<string>; build: string; newer_than?: string }> =
	{
		dist: {
			files: ['dist/schema.js', 'dist/schema.d.ts'],
			build: 'gro build',
			newer_than: 'src/lib/schema.ts'
		},
		wasm: { files: ['target/fuz_schema_wasm/fuz_schema_wasm_bg.wasm'], build: 'npm run build:wasm' }
	};

/**
 * Says what a planned step needs built that isn't: a file that is missing, or
 * older than the source it is built from. The scripts refuse the same, each
 * once it is reached, which in a run is after the scripts before it have
 * measured.
 *
 * @returns what to build and why, or `null` when the step has what it reads
 */
export const find_missing_need = (need: ResultsStepNeed, dir: string): string | null => {
	const { files, build, newer_than } = NEEDS[need];
	const source = newer_than === undefined ? 0 : statSync(join(dir, newer_than)).mtimeMs;
	for (const file of files) {
		const path = join(dir, file);
		if (!existsSync(path)) return `${file} is missing: run \`${build}\` first`;
		if (statSync(path).mtimeMs < source) {
			return `${file} is older than ${newer_than}: run \`${build}\` first`;
		}
	}
	return null;
};

/** Everything a run is decided to be before it measures. */
export interface ResultsRunPlan {
	options: ResultsRunOptions;
	/** The machine's name: the one given, or the hostname. */
	machine: string;
	commit: string;
	dirty: boolean;
	generated_at: string;
	steps: Array<PlannedResultsStep>;
	/** Why the run can't be published, as far as is known before it measures. */
	unpublishable: Array<string>;
	/** Where the results are written when every planned script succeeds. */
	path: string;
	/** Where each script's data and output are kept. */
	steps_dir: string;
}

/**
 * Decides everything about a run that can be decided before measuring, and
 * refuses what would only fail later. It changes nothing on disk.
 *
 * @throws ResultsRunError with exit code 2 if a full run of everything isn't
 * given a machine name, a script of the suite is not in `package.json`, a
 * planned step reads a build that is missing or stale, or a publishable run of
 * the same UTC date and machine is already there
 */
export const plan_results_run = (
	options: ResultsRunOptions,
	deps: ResultsRunDeps,
	now: Date = new Date()
): ResultsRunPlan => {
	if (process.env.NODE_OPTIONS?.trim()) {
		throw new ResultsRunError(
			`every script of a run would inherit NODE_OPTIONS, here \`${process.env.NODE_OPTIONS.trim()}\`, and the ones that time refuse it: unset it`,
			2
		);
	}
	if (options.machine === null && options.kind === 'full' && !options.only) {
		throw new ResultsRunError(
			'name the machine with --machine <name>: a full run is recorded and published under that name',
			2
		);
	}
	if (options.machine !== null && !RESULTS_MACHINE_NAME_MATCHER.test(options.machine)) {
		throw new ResultsRunError(
			`--machine: "${options.machine}" is part of a file name, so letters, digits, ".", "_", and "-" only`,
			2
		);
	}
	const steps = plan_results_steps(options);
	for (const planned of steps) {
		if (!planned.run) continue;
		const { step } = planned;
		if (!Object.hasOwn(deps.scripts, step.script)) {
			throw new ResultsRunError(
				`package.json has no script "${step.script}", which ${step.id} runs`,
				2
			);
		}
		const missing = step.needs && find_missing_need(step.needs, deps.dir);
		if (missing) throw new ResultsRunError(`${step.id} can't run: ${missing}`, 2);
	}
	const machine = options.machine ?? to_results_machine_name(hostname());
	const { commit, dirty } = deps.read_commit();
	const generated_at = now.toISOString();
	const unpublishable = find_unpublishable_reasons(options, dirty);
	const results_dir = join(deps.dir, RESULTS_DIR_NAME);
	const path = to_results_path(
		{ kind: options.kind, machine, generated_at, publishable: unpublishable.length === 0 },
		results_dir
	);
	if (unpublishable.length === 0 && existsSync(path)) {
		throw new ResultsRunError(
			`${to_display_path(path)} exists: a run of this date and machine was already written. Move it, or delete it if it is not one to keep`,
			2
		);
	}
	return {
		options,
		machine,
		commit,
		dirty,
		generated_at,
		steps,
		unpublishable,
		path,
		steps_dir: to_results_steps_dir({ kind: options.kind, machine }, results_dir)
	};
};

const to_display_path = (path: string): string => {
	const relative_path = relative(process.cwd(), path);
	return relative_path.startsWith('..') ? path : relative_path;
};

// the command a planned step is started with, as a reader would type it
const format_step_command = (planned: PlannedResultsStep & { run: true }): string =>
	`npm run ${planned.step.script}${planned.args.length ? ` -- ${planned.args.join(' ')}` : ''}`;

/**
 * Describes a run that `plan_results_run` accepted, for `--plan`: what it
 * would start, where it would write, and roughly how long it would take.
 */
export const format_results_plan = (plan: ResultsRunPlan): string => {
	const { options, steps } = plan;
	const rows: Array<[string, string]> = [
		...steps.map((planned): [string, string] => [
			planned.step.id,
			planned.run
				? `${format_step_command(planned)}, about ${format_seconds(planned.step.estimate_s[options.kind])}`
				: `left out: ${planned.reason}`
		]),
		['machine', plan.machine],
		['commit', `${plan.commit}${plan.dirty ? ', with changes it does not record' : ', clean'}`],
		[
			'publishable',
			plan.unpublishable.length
				? `no: ${plan.unpublishable.join('; ')}`
				: 'yes, if every script succeeds'
		],
		['output', to_display_path(plan.path)],
		['kept', `each script's data and output, in ${to_display_path(plan.steps_dir)}`],
		[
			'estimate',
			`about ${format_seconds(estimate_results_seconds(steps, options.kind))}: rough figures fitted to runs of each script, not a measurement`
		]
	];
	return [
		`the plan of a ${options.kind} run on ${plan.machine}: nothing is measured`,
		...rows.map(([name, value]) => `  ${name.padEnd(12)} ${value}`)
	].join('\n');
};

// how a script that didn't succeed ended, in words
const format_outcome = (outcome: ResultsStepOutcome): string =>
	outcome.error !== null
		? `it could not be started: ${outcome.error}`
		: outcome.signal !== null
			? `it was ended by ${outcome.signal}`
			: `it exited with ${outcome.status}`;

/**
 * Runs one planned step and reads what it wrote.
 *
 * @returns the section: measured, with its data, or failed, with how
 */
const run_results_step = <TId extends BenchmarkId>(
	planned: PlannedResultsStep & { run: true },
	plan: ResultsRunPlan,
	deps: ResultsRunDeps
): BenchmarkSection<TId> => {
	const { step, args } = planned;
	const data_path = join(plan.steps_dir, `${step.id}.json`);
	const log_path = join(plan.steps_dir, `${step.id}.txt`);
	rmSync(data_path, { force: true });
	const since = performance.now();
	const outcome = deps.run_step(step.script, [...args, RESULTS_DATA_FLAG, data_path], log_path);
	const command = {
		script: step.script,
		command: deps.scripts[step.script]!,
		args: [...args],
		duration_ms: Math.round(performance.now() - since)
	};
	const failed = (error: string): BenchmarkSection<TId> => ({
		status: 'failed',
		...command,
		error
	});
	if (outcome.error !== null || outcome.status !== 0) return failed(format_outcome(outcome));
	try {
		const data = parse_benchmark_data(step.id, JSON.parse(readFileSync(data_path, 'utf8')));
		return { status: 'measured', ...command, data } as BenchmarkSection<TId>;
	} catch (error) {
		return failed(`it exited cleanly and its data could not be read: ${(error as Error).message}`);
	}
};

/** What a run comes to. */
export interface ResultsRun {
	results: BenchmarkResults;
	/** Where the file was written. */
	path: string;
	publishable: boolean;
}

/**
 * Runs the suite and writes the results file.
 *
 * @returns the validated results, where they were written, and whether they can be published
 * @throws ResultsRunError if the run can't start, as `plan_results_run` says, or what
 * it composed is not a results file
 */
export const run_results = (options: ResultsRunOptions, deps: ResultsRunDeps): ResultsRun => {
	const plan = plan_results_run(options, deps);
	const { steps, machine } = plan;
	mkdirSync(plan.steps_dir, { recursive: true });
	const since = performance.now();
	const machine_start = read_machine_state();
	const versions = read_package_versions([
		...new Set(to_results_libs({}).map((lib) => lib.package)),
		...RESULTS_TOOL_PACKAGES
	]);
	// this library is the tree, whose version is the package's own
	const own = JSON.parse(readFileSync(join(deps.dir, 'package.json'), 'utf8')) as {
		name: string;
		version: string;
	};
	versions[own.name] = own.version;

	const sections: Partial<Record<BenchmarkId, BenchmarkSection>> = {};
	const running = steps.filter((planned) => planned.run);
	for (const planned of steps) {
		const { step } = planned;
		if (!planned.run) {
			sections[step.id] = { status: 'skipped', reason: planned.reason };
			continue;
		}
		deps.log(
			`${step.id} (${running.indexOf(planned) + 1} of ${running.length}): ${format_step_command(planned)}, ` +
				`about ${format_seconds(step.estimate_s[options.kind])}, its output in ${to_display_path(join(plan.steps_dir, `${step.id}.txt`))}`
		);
		const section = run_results_step(planned, plan, deps);
		sections[step.id] = section;
		deps.log(
			section.status === 'measured'
				? `  measured in ${format_seconds(section.duration_ms / 1000)}`
				: section.status === 'failed'
					? `  FAILED after ${format_seconds(section.duration_ms / 1000)}: ${section.error}`
					: ''
		);
	}

	// read again: an edit or a commit made while the scripts ran is in what they measured
	const tree_end = deps.read_commit();
	let results: BenchmarkResults;
	try {
		results = parse_benchmark_results({
			meta: {
				generated_at: plan.generated_at,
				kind: options.kind,
				only: options.only ? [...options.only] : null,
				machine: { name: machine, cpu: read_cpu_model() ?? 'unknown' },
				machine_start,
				machine_end: read_machine_state(),
				node: process.version,
				v8: process.versions.v8,
				commit: plan.commit,
				dirty: plan.dirty,
				commit_end: tree_end.commit,
				dirty_end: tree_end.dirty,
				duration_ms: Math.round(performance.now() - since),
				libs: to_results_libs(versions),
				tools: Object.fromEntries(
					RESULTS_TOOL_PACKAGES.map((name) => [name, versions[name] ?? 'missing'])
				)
			},
			...(sections as Record<BenchmarkId, BenchmarkSection>)
		});
	} catch (error) {
		throw new ResultsRunError(
			`what the run composed is not a results file, so nothing was written; each script's data is kept in ${to_display_path(plan.steps_dir)}\n${(error as Error).message}`
		);
	}
	const publishable = benchmark_results_is_publishable(results);
	// a script that failed makes a run unpublishable that was planned to be published
	const path = to_results_path(
		{ kind: options.kind, machine, generated_at: plan.generated_at, publishable },
		join(deps.dir, RESULTS_DIR_NAME)
	);
	mkdirSync(dirname(path), { recursive: true });
	// whole or not at all: a reader never sees half a file
	const temp_path = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temp_path, serialize_benchmark_results(results));
		renameSync(temp_path, path);
	} finally {
		rmSync(temp_path, { force: true });
	}
	return { results, path, publishable };
};

/** Summarizes a run for the terminal: what each section came to, and whether it can be published. */
export const format_results_summary = (run: ResultsRun): string => {
	const { results } = run;
	const lines = [
		`${results.meta.kind} run on ${results.meta.machine.name} in ${format_seconds(results.meta.duration_ms / 1000)}`
	];
	for (const { id } of RESULTS_STEPS) {
		const section = results[id];
		lines.push(
			`  ${id.padEnd(12)} ${
				section.status === 'measured'
					? `measured in ${format_seconds(section.duration_ms / 1000)}`
					: section.status === 'failed'
						? `FAILED: ${section.error}`
						: `skipped: ${section.reason}`
			}`
		);
	}
	lines.push(
		`wrote ${to_display_path(run.path)}`,
		run.publishable
			? `it is publishable: check it, then \`npm run results:publish -- ${to_display_path(run.path)}\``
			: `it is not publishable: ${describe_benchmark_run(results)}`
	);
	return lines.join('\n');
};

/**
 * The command: parses the args, runs, and prints the summary. The args are
 * parsed as every script's are, through `args.ts`, which is loaded here and
 * not with the module, so a test of the run loads no instance of the library
 * for it.
 *
 * @returns the exit code: 2 when the caller has to change something first, and
 * 1 when the run was written and a script failed in it
 */
export const main = async (): Promise<number> => {
	const { meta, parse_args, s, to_names_arg } = await import('./args.ts');
	const entries = {
		_: s.with_default_fn(s.array(s.string), () => []),
		machine: meta(s.optional(s.string), {
			description:
				'the name the machine is recorded under; required for a full run of everything, otherwise the hostname'
		}),
		smoke: meta(s.with_default(s.boolean, false), {
			description:
				'run every script as briefly as it goes, to prove the suite works; the numbers mean nothing'
		}),
		only: meta(s.optional(to_names_arg('section', 'sections', RESULTS_SECTION_IDS)), {
			description: 'run only these sections, which is not a run to publish'
		}),
		wasm: meta(s.with_default(s.boolean, false), {
			description: 'also run the wasm section, which needs `npm run build:wasm`'
		}),
		plan: meta(s.with_default(s.boolean, false), {
			description:
				'print what the run would start, where it would write, and roughly how long it would take, and measure nothing'
		})
		// exactly the args `RESULTS_RUN_ARG_NAMES` lists, which the publishing page is held to
	} satisfies Record<(typeof RESULTS_RUN_ARG_NAMES)[number] | '_', unknown>;
	const args = parse_args(s.object(entries));
	const options: ResultsRunOptions = {
		kind: args.smoke ? 'smoke' : 'full',
		only: args.only ?? null,
		wasm: args.wasm,
		machine: args.machine ?? null
	};
	const deps = create_results_run_deps();
	try {
		if (args.plan) {
			console.log(format_results_plan(plan_results_run(options, deps)));
			return 0;
		}
		const run = run_results(options, deps);
		console.log(format_results_summary(run));
		return RESULTS_STEPS.some(({ id }) => run.results[id].status === 'failed') ? 1 : 0;
	} catch (error) {
		if (!(error instanceof ResultsRunError)) throw error;
		console.error(error.message);
		return error.exit_code;
	}
};

if (import.meta.main) {
	process.exitCode = await main();
}
