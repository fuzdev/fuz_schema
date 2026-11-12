/**
 * What a run of the whole suite is asked to do: the scripts it starts, in
 * order, with the args each kind of run gives them, the roster it records,
 * and where its results go. Everything here is a function of its arguments,
 * so `results_run.ts` holds only the parts that touch the machine.
 *
 * It names the scripts by their npm scripts and the libraries by
 * `lib_names.ts`, and loads no library under comparison.
 *
 * @module
 */

import { join } from 'node:path';

import { LIB_NAMES, type LibName } from './lib_names.ts';
import {
	BENCHMARK_FULL_ARGS,
	BENCHMARK_IDS,
	OPTIONAL_BENCHMARK_IDS,
	type BenchmarkId,
	type BenchmarkLib,
	type BenchmarkRunKind
} from './results_schema.ts';

/** The directory under the repository that results are written to. */
export const RESULTS_DIR_NAME = 'results';

/**
 * The directory under the results directory for runs that are not
 * publishable: smoke runs, narrowed ones, runs from a tree with uncommitted
 * changes, and runs a script failed in. Git ignores it.
 */
export const RESULTS_SCRATCH_DIR_NAME = 'scratch';

/** The name the published run has in the results directory. */
export const RESULTS_LATEST_FILE_NAME = 'latest.json';

/** What a step needs built before it can run. */
export type ResultsStepNeed = 'dist' | 'wasm';

/** What a run can be: every kind of file but the fixture, which no run writes. */
export type ResultsRunKind = Exclude<BenchmarkRunKind, 'fixture'>;

/**
 * One script of the suite, as a run starts it. A full run gives every script
 * `BENCHMARK_FULL_ARGS`, which is none, so each measures with its own defaults.
 */
export interface ResultsStep {
	/** The section of the results file it fills. */
	id: BenchmarkId;
	/** The npm script it is started through, so it runs under the flags that script gives it. */
	script: string;
	/** The args a smoke run gives it: as briefly as the script goes. */
	smoke_args: ReadonlyArray<string>;
	/** What it reads that a command outside the suite builds. */
	needs: ResultsStepNeed | null;
	/** Roughly how long it takes, in seconds: a figure fitted to runs of it, for the plan only. */
	estimate_s: Readonly<Record<ResultsRunKind, number>>;
}

/**
 * The scripts of the suite, in the order a run starts them: what is the same
 * on any machine first, then bytes, then time. Each is a process of its own,
 * started when the one before it has exited.
 */
export const RESULTS_STEPS: ReadonlyArray<ResultsStep> = [
	{
		id: 'bundle',
		script: 'benchmark:bundle',
		smoke_args: [],
		needs: null,
		estimate_s: { full: 10, smoke: 10 }
	},
	{
		id: 'types',
		script: 'benchmark:types',
		smoke_args: ['--runs', '1'],
		needs: 'dist',
		estimate_s: { full: 75, smoke: 30 }
	},
	{
		id: 'allocations',
		script: 'benchmark:allocations',
		smoke_args: [],
		needs: null,
		estimate_s: { full: 110, smoke: 110 }
	},
	{
		id: 'heap',
		script: 'benchmark:heap',
		smoke_args: [],
		needs: null,
		estimate_s: { full: 20, smoke: 20 }
	},
	{
		id: 'coldstart',
		script: 'benchmark:coldstart',
		smoke_args: ['--samples', '2', '--discard', '1'],
		needs: 'dist',
		estimate_s: { full: 300, smoke: 50 }
	},
	{
		id: 'run',
		script: 'benchmark',
		smoke_args: ['--passes', '1', '--duration', '50'],
		needs: null,
		estimate_s: { full: 240, smoke: 40 }
	},
	{
		id: 'survey',
		script: 'benchmark:survey',
		smoke_args: ['--passes', '1', '--duration', '20'],
		needs: null,
		estimate_s: { full: 230, smoke: 60 }
	},
	{
		id: 'harvest',
		script: 'benchmark:harvest',
		smoke_args: ['--passes', '1', '--duration', '100'],
		needs: null,
		estimate_s: { full: 340, smoke: 125 }
	},
	{
		id: 'wasm',
		script: 'benchmark:wasm',
		smoke_args: ['--rounds', '3', '--round-ms', '5'],
		needs: 'wasm',
		estimate_s: { full: 90, smoke: 25 }
	}
];

/** The arg every script takes its data path by, see `DataArg` in `args.ts`. */
export const RESULTS_DATA_FLAG = '--data';

/**
 * How the roster names each library, beside what `lib_names.ts` holds: its
 * label, the package its version is read from, what of that package was
 * measured where a reader would otherwise assume the package as it is
 * imported, and its notes, each with the kinds of figure it qualifies: what a
 * reader must know to set that figure beside another library's, said under
 * every chart and table of such a figure and under no other. Each is what
 * `docs/benchmarks.md` says under "Comparing like with like".
 */
export const RESULTS_LIB_INFO: Readonly<
	Record<LibName, Pick<BenchmarkLib, 'label' | 'package' | 'by_maintainer' | 'note' | 'notes'>>
> = {
	fuz_schema: {
		label: 'fuz_schema',
		package: '@fuzdev/fuz_schema',
		by_maintainer: true,
		note: "This repository's source at the run's commit, not the published package of that version.",
		notes: [
			{
				about: ['valid', 'allocation'],
				text: 'A strict or identity parse of valid input returns the input itself, where Valibot and Zod return a copy.'
			}
		]
	},
	valibot: {
		label: 'Valibot',
		package: 'valibot',
		by_maintainer: false,
		note: null,
		notes: [
			{
				about: ['guard'],
				text: 'Its guard, `is`, runs the parser, which copies what it reads, and drops the copy.'
			}
		]
	},
	zod: {
		label: 'Zod',
		package: 'zod',
		by_maintainer: false,
		note: null,
		notes: [
			{
				about: ['valid', 'invalid', 'coldstart'],
				text: 'Classic `zod` generates a parser for each object schema on its first parse where the environment allows eval.'
			},
			{
				about: ['guard'],
				text: 'Its guard, `z.validate`, runs the parser where a schema has no compiled path, which copies what it reads, and drops the copy.'
			}
		]
	},
	zod_compiled: {
		label: 'Zod compiled',
		package: 'zod',
		by_maintainer: false,
		note: 'Zod with each root through `z.compile`, its ahead-of-time mode.',
		notes: [
			{
				about: ['valid', 'guard'],
				text: 'Each root through `z.compile`, which generates its parser and its validator ahead of time. A root it hands back uncompiled has no timed figure.'
			},
			{
				about: ['invalid'],
				text: "Each root through `z.compile`, which hands an invalid input to Zod's regular parser. A root it hands back uncompiled has no timed figure."
			},
			{
				about: ['bundle', 'coldstart', 'creation', 'heap'],
				text: 'It carries the compiler `z.compile` needs, and compiles while the schema is built.'
			}
		]
	},
	zod_mini: {
		label: 'Zod Mini',
		package: 'zod',
		by_maintainer: false,
		note: '`zod/mini`.',
		notes: [
			{
				about: ['valid', 'invalid'],
				text: 'Its objects never compile: `zod/mini` has no generated parser.'
			},
			{
				about: ['guard'],
				text: 'Its guard, `z.validate`, runs the parser where a schema has no compiled path, which copies what it reads, and drops the copy.'
			}
		]
	},
	typebox: {
		label: 'TypeBox',
		package: 'typebox',
		by_maintainer: false,
		note: 'The `Check` of its compiled validator.',
		notes: [
			{
				about: ['valid', 'invalid', 'guard', 'allocation'],
				text: 'Every row is a `Check` of its compiled validator, which stops at the first failure and builds no issues and no output.'
			}
		]
	},
	arktype: {
		label: 'ArkType',
		package: 'arktype',
		by_maintainer: false,
		note: null,
		notes: [
			{
				about: ['valid', 'invalid', 'allocation'],
				text: 'A parse that drops keys deep-clones its input before it runs.'
			},
			{
				about: ['creation', 'heap'],
				text: 'It keeps one schema of a definition and hands it back when the same definition is built again, which a figure marked `†` is of.'
			}
		]
	}
};

/** The tools a script measures with, whose installed versions a run records. */
export const RESULTS_TOOL_PACKAGES: ReadonlyArray<string> = ['rolldown', 'typescript'];

/**
 * The roster a run records: every library of `LIB_NAMES`, in that order, each
 * with its installed version.
 *
 * @param versions - the installed version of each package, by name, `undefined` where one is missing
 */
export const to_results_libs = (
	versions: Readonly<Record<string, string | undefined>>
): Array<BenchmarkLib> =>
	LIB_NAMES.map((id) => {
		const info = RESULTS_LIB_INFO[id];
		return { id, ...info, version: versions[info.package] ?? 'missing' };
	});

/** The args `results_run.ts` takes, by name, besides `--help`. */
export const RESULTS_RUN_ARG_NAMES = ['machine', 'smoke', 'only', 'wasm', 'plan'] as const;

/** A run, as its args describe it. */
export interface ResultsRunOptions {
	kind: ResultsRunKind;
	/** The sections to run, `null` for all of them. */
	only: ReadonlyArray<BenchmarkId> | null;
	/** Whether the wasm section is part of the run. */
	wasm: boolean;
	/** The name the machine is recorded under, `null` to use the hostname. */
	machine: string | null;
}

/** A machine name is part of a file name. */
export const RESULTS_MACHINE_NAME_MATCHER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Makes a hostname usable as a machine name. */
export const to_results_machine_name = (hostname: string): string => {
	const name = hostname.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '');
	return name === '' ? 'machine' : name;
};

/** A step of a run: started with these args, or left out, with why. */
export type PlannedResultsStep =
	| { step: ResultsStep; run: true; args: ReadonlyArray<string> }
	| { step: ResultsStep; run: false; reason: string };

/**
 * Lists what a run does with each script of the suite: the args it starts it
 * with, or why it leaves it out. A section outside `only` is left out, and so
 * is an optional one the run didn't ask for.
 */
export const plan_results_steps = (options: ResultsRunOptions): Array<PlannedResultsStep> =>
	RESULTS_STEPS.map((step): PlannedResultsStep => {
		if (options.only && !options.only.includes(step.id)) {
			return { step, run: false, reason: `the run was narrowed to ${options.only.join(', ')}` };
		}
		if (OPTIONAL_BENCHMARK_IDS.includes(step.id) && !options.wasm && !options.only) {
			return { step, run: false, reason: 'not asked for: a run measures it with --wasm' };
		}
		return {
			step,
			run: true,
			args: options.kind === 'smoke' ? step.smoke_args : BENCHMARK_FULL_ARGS
		};
	});

/**
 * Why a run can't be published, from what is known before it measures: its
 * kind, what it was narrowed to, and the tree it starts from. A script that
 * fails makes one more, known only once it has.
 *
 * @returns each reason, none for a run that is publishable if every script succeeds
 */
export const find_unpublishable_reasons = (
	options: Pick<ResultsRunOptions, 'kind' | 'only'>,
	dirty: boolean
): Array<string> => {
	const reasons: Array<string> = [];
	if (options.kind === 'smoke') reasons.push('a smoke run measures nothing worth reading');
	if (options.only) reasons.push(`it is narrowed to ${options.only.join(', ')}`);
	if (dirty) reasons.push('the working tree has changes the commit does not record');
	return reasons;
};

/**
 * The path a run's results file is written to.
 *
 * - a publishable run: `results/<UTC date it started>_<machine>.json`
 * - any other: `results/scratch/<kind>_<machine>.json`, which git ignores
 *
 * @param run - the kind of run, the machine's name, when it started, and whether it is publishable
 * @param dir - the results directory
 */
export const to_results_path = (
	run: { kind: ResultsRunKind; machine: string; generated_at: string; publishable: boolean },
	dir: string
): string =>
	run.publishable
		? join(dir, `${run.generated_at.slice(0, 10)}_${run.machine}.json`)
		: join(dir, RESULTS_SCRATCH_DIR_NAME, `${run.kind}_${run.machine}.json`);

/**
 * The directory a run keeps what each script wrote in: its data, and the text
 * it printed. It is under the scratch directory whatever the run, and is
 * written over by the next run of the same kind on the same machine.
 */
export const to_results_steps_dir = (
	run: { kind: ResultsRunKind; machine: string },
	dir: string
): string => join(dir, RESULTS_SCRATCH_DIR_NAME, `${run.kind}_${run.machine}.steps`);

/** Roughly how long the planned steps take together, in seconds. */
export const estimate_results_seconds = (
	steps: ReadonlyArray<PlannedResultsStep>,
	kind: ResultsRunKind
): number =>
	steps.reduce((sum, planned) => sum + (planned.run ? planned.step.estimate_s[kind] : 0), 0);

/** Every section id, for an arg that names them. */
export const RESULTS_SECTION_IDS: ReadonlyArray<BenchmarkId> = BENCHMARK_IDS;
