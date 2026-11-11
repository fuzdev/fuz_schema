/**
 * How `grade` reads what its processes measured: the cases by regime, the
 * summaries and their A/As, the verdict on the rules, the lists, and the
 * tables, from a `GradeRecord` and the outputs of its jobs. Kept apart from
 * `grade.ts`, which measures, so a test can read a grade made up for it and
 * `npm run grade -- --replay` can read a finished one again without measuring.
 *
 * Nothing here reads a file, starts a process, or looks at the clock: every
 * figure, time, and state it prints is in what it is given.
 *
 * @module
 */

import type { CasePath } from './cases.ts';
import type { ExportSize, ExportSizes } from './bundle_size.ts';
import type { ColdstartStage, ColdstartSummary } from './coldstart.ts';
import { HEAP_SETTLED_BELOW_BYTES, type ExportHeap, type RetainedHeap } from './heap.ts';
import { format_machine_state, type MachineState } from './machine.ts';
import {
	BACKSTOP_VS_VALIBOT,
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
	type ChangeClass,
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
import type { GradeChildCase, GradeChildOutput, GradeRegime } from './grade_job.ts';
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
import { format_table, geometric_mean } from './measure.ts';

// the paths in the order the tables list them, as `CASE_PATHS` of `cases.ts`,
// which this module imports for its types alone so a test loads no case
const PATHS: ReadonlyArray<CasePath> = ['identity', 'copy', 'issues', 'probe', 'create'];

/**
 * What a case's allocation must rise by to be listed: a word or more, and on
 * a large case the share two readings of one parse can differ by.
 */
export const ALLOC_FLOOR = { bytes: 8, share: 0.002 };
/** Rule 4's price of core bytes in speed: this speedup per this many gzipped bytes. */
export const SPEEDUP_PER_CORE_BYTES = { speedup: 0.1, bytes: 50 };
/** The least speedup any added core bytes need, the second sentence of rule 4. */
export const LEAST_SPEEDUP_FOR_BYTES = 0.05;
/** What a cold-start stage must grow by to be listed. */
export const PROCESS_FLOOR = 0.1;

/** What a case is to the reading: its name and what it says of itself. */
export interface GradeCase {
	name: string;
	group: string;
	realistic: boolean;
	path: CasePath;
	valid: boolean;
}

/** What a grade ran on and with, which is the same at its end, for the JSON report. */
export interface GradeSetup {
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

/** The args of a grade the reading reads. The whole of them is in the report. */
export interface GradeArgs {
	runs: number;
	class: ChangeClass;
	samples: number;
	bundle: boolean;
	process: boolean;
}

/** A scenario's bundle in the graded version beside other libraries' bundles of it. */
export interface ScenarioLibsRow {
	name: string;
	gzip: number;
	libs: Array<{ lib: string; gzip: number }>;
}

/** What the bundles of a grade measured. */
export interface GradeBundleMeasures {
	/** Every scenario, its bundle in both versions and Valibot's: `base` is `NaN` where the baseline's module lacks it. */
	scenarios: Array<{ name: string; base: number; new: number; valibot: number }>;
	/** The scenarios the baseline's module lacks. */
	unshared: Array<string>;
	/** The scenarios of many schemas, which the backstop doesn't read. */
	many_schemas: Array<string>;
	/** The libraries a scenario the baseline lacks is beside. */
	new_scenario_libs: Array<string>;
	/**
	 * The scenarios together: both versions on those both have, the graded
	 * one on every scenario where the baseline lacks some, and Valibot's.
	 */
	all: { base: number; new_shared: number; new_every?: number; valibot: number };
	base_exports: ExportSizes;
	new_exports: ExportSizes;
	/** Each scenario the baseline lacks, beside other libraries. */
	new_scenario_rows: Array<ScenarioLibsRow>;
	/** Each scenario of many schemas, beside other libraries. */
	many_schema_rows: Array<ScenarioLibsRow>;
}

/** What the retained heap of a grade measured. */
export interface GradeHeapMeasures {
	/** Every scenario in both versions: the baseline's figures are `NaN` where its module lacks it. */
	scenarios: Array<{
		name: string;
		base: Pick<RetainedHeap, 'total_bytes' | 'further_schema_bytes'>;
		new: Pick<RetainedHeap, 'total_bytes' | 'further_schema_bytes'>;
	}>;
	base_exports: Array<ExportHeap>;
	new_exports: Array<ExportHeap>;
}

/** What cold start measured of one scenario in one form: each stage of both versions. */
export interface GradeColdstartForm {
	scenario: string;
	form: string;
	stages: Array<{ stage: ColdstartStage; base: ColdstartSummary; new: ColdstartSummary }>;
}

/**
 * What a grade was and what it measured but its jobs: what `grade.ts` writes
 * to the grade's directory, and `--replay` reads back.
 */
export interface GradeRecord {
	/** The graded version, as the header names it. */
	graded: string;
	/** The baseline, as the header names it. */
	against: string;
	/** Whether the two versions are one file byte for byte. */
	identical: boolean;
	/** The parsed args, every one, as the report writes them. */
	args: GradeArgs;
	started_at: string;
	ended_at: string;
	/** How long the grade took to the end of its measuring, in seconds. */
	elapsed_s: number;
	setup: GradeSetup;
	machine: { start: MachineState; end: MachineState };
	/** How many module instances of each version a timing process held. */
	instances: number;
	/** How many processes of each version a case apart had a run. */
	apart_processes: number;
	/** How many entries the program of the `apart` regime has. */
	program_entries: number;
	/** The cases measured, in the order of the matrix. */
	cases: Array<GradeCase>;
	/** The names of the cases also timed alone, and apart, in the same order. */
	alone: Array<string>;
	apart: Array<string>;
	/** What bundle size measured, where `args.bundle`. */
	bundle?: GradeBundleMeasures;
	/** What retained heap and cold start measured, where `args.process`. */
	heap?: GradeHeapMeasures;
	coldstart?: Array<GradeColdstartForm>;
	/** Which job printed what, by its number in the grade's jobs directory. */
	jobs: GradeJobsIndex;
}

/** The jobs of a grade by what each was, as numbers of the files in its jobs directory. */
export interface GradeJobsIndex {
	/** The matrix's timing, a job a run. */
	matrix: Array<number>;
	/** By run, then in the order of `GradeRecord.alone`. */
	alone: Array<Array<number>>;
	/** By run, then in the order of `GradeRecord.apart`, then in the order they ran, each with the version it held. */
	apart: Array<Array<Array<{ job: number; graded: boolean }>>>;
	/** The bytes of the matrix, a job a chunk of cases. */
	bytes_matrix: Array<number>;
	/** In the order of `GradeRecord.alone`. */
	bytes_alone: Array<number>;
}

/** One process of the `apart` regime: which version it held, and what it printed. */
export interface GradeApartOutput {
	graded: boolean;
	output: GradeChildOutput;
}

/** What the jobs of a grade printed, by what each job was. */
export interface GradeOutputs {
	/** The matrix's timing, a process a run. */
	matrix: Array<GradeChildOutput>;
	/** By run, then in the order of `GradeRecord.alone`: each case's own timing process. */
	alone: Array<Array<GradeChildCase>>;
	/** By run, then in the order of `GradeRecord.apart`, then in the order they ran: each case's processes. */
	apart: Array<Array<Array<GradeApartOutput>>>;
	/** The bytes of the matrix, every case of every chunk. */
	bytes_matrix: Array<GradeChildCase>;
	/** In the order of `GradeRecord.alone`: each case's bytes alone. */
	bytes_alone: Array<GradeChildCase>;
}

/**
 * The outputs of a grade's jobs, by what each was.
 *
 * @param read_output - what the job of a number printed
 */
export const to_grade_outputs = (
	jobs: GradeJobsIndex,
	read_output: (job: number) => GradeChildOutput
): GradeOutputs => ({
	matrix: jobs.matrix.map(read_output),
	alone: jobs.alone.map((run) => run.map((job) => read_output(job).cases[0]!)),
	apart: jobs.apart.map((run) =>
		run.map((of_case) => of_case.map(({ job, graded }) => ({ graded, output: read_output(job) })))
	),
	bytes_matrix: jobs.bytes_matrix.flatMap((job) => read_output(job).cases),
	bytes_alone: jobs.bytes_alone.map((job) => read_output(job).cases[0]!)
});

/** What the reading made: the verdict, the tables, and the whole JSON report. */
export interface GradeReading {
	verdict: Array<string>;
	tables: Array<string>;
	report: Record<string, unknown>;
}

/** A case's bytes in one regime: the first instance of each version, and the second beside it. */
export interface CaseBytes {
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
const is_instances_apart = (a: number, b: number): boolean =>
	!Number.isNaN(a) && !Number.isNaN(b) && (is_past_alloc_floor(a, b) || is_past_alloc_floor(b, a));

/** A case's bytes from what a bytes process printed of it, `NaN` where a version wasn't read. */
export const to_case_bytes = (c: GradeChildCase | undefined): CaseBytes => {
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
		settled: !is_instances_apart(base, base1) && !is_instances_apart(next, new1)
	};
};

/** Whether a case allocates more: both instances of the new version past the floor over both of the baseline's. */
export const is_more_alloc = (b: CaseBytes): boolean =>
	b.settled &&
	is_past_alloc_floor(
		Math.min(b.new, b.new1),
		Math.max(b.base, Number.isNaN(b.base1) ? b.base : b.base1)
	);

/** A case apart in one run: its reading of the median batch, and of the whole slice. */
interface ApartReading {
	reading: Reading;
	whole: Reading;
}

/** A case as the reading has it, every regime and its bytes. */
export interface Graded {
	c: GradeCase;
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

// what the processes of a case apart read in one run, by version, a process
// where an instance is elsewhere, in the order they ran
const to_apart_reading = (outputs: Array<GradeApartOutput>): ApartReading => {
	const reading: Reading = { base: [], new: [] };
	const whole: Reading = { base: [], new: [] };
	for (const { output } of outputs) {
		// a baseline that lacks the case, or disagrees on it, times nothing
		if (output.cases.length) {
			to_reading(output.cases[0]!, reading);
			to_reading(output.cases[0]!, whole, 'whole_ns');
		}
	}
	return { reading, whole };
};

/**
 * Reads every case of a grade in every regime it was measured in.
 *
 * @returns each case of the record, in its order
 */
export const to_graded = (record: GradeRecord, outputs: GradeOutputs): Array<Graded> => {
	const apart_runs = outputs.apart.map((run) => run.map(to_apart_reading));
	return record.cases.map((c) => {
		const of_runs = outputs.matrix.map((run) => to_case_of(run, c.name));
		const first = of_runs[0]!;
		const alone_index = record.alone.indexOf(c.name);
		const apart_index = record.apart.indexOf(c.name);
		const to_alone = (series: ReadingSeries): CaseTime | undefined =>
			alone_index === -1
				? undefined
				: to_case_time(
						outputs.alone.map((run) => to_reading(run[alone_index]!, undefined, series))
					);
		const to_apart = (key: keyof ApartReading): CaseTime | undefined =>
			apart_index === -1
				? undefined
				: to_case_time(apart_runs.map((run) => run[apart_index]![key]));
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
			bytes: to_case_bytes(outputs.bytes_matrix.find((b) => b.name === c.name)),
			alone_bytes: alone_index === -1 ? undefined : to_case_bytes(outputs.bytes_alone[alone_index]),
			same: first.same.new0!,
			base_same: first.same.base0
		};
	});
};

/**
 * The fewest entries of the program a process of the baseline ran apart, the
 * program's whole where none did.
 */
export const to_apart_program_ran = (record: GradeRecord, outputs: GradeOutputs): number =>
	outputs.apart
		.flat(2)
		.filter((o) => !o.graded)
		.reduce((fewest, o) => Math.min(fewest, o.output.program_ran ?? 0), record.program_entries);

export const REGIMES: ReadonlyArray<GradeRegime> = ['matrix', 'alone', 'apart'];
/**
 * The regimes whose realistic cases the rules read as one figure: `apart` has
 * a few chosen cases, read one at a time.
 */
export const SUMMARY_RULE_REGIMES: ReadonlyArray<GradeRegime> = ['matrix', 'alone'];

// bytes are read in the processes that hold both versions
const to_bytes_of = (g: Graded, regime: GradeRegime): CaseBytes | undefined =>
	regime === 'matrix' ? g.bytes : regime === 'alone' ? g.alone_bytes : undefined;

// nothing over nothing is no change
const to_bytes_ratio = (bytes: number, from: number): number => (bytes === from ? 1 : bytes / from);

// the ratio of summed bytes, `NaN` where no case has both
const to_alloc_sum = (gs: Array<Graded>, regime: GradeRegime): number => {
	const compared = gs
		.map((g) => to_bytes_of(g, regime))
		.filter((b): b is CaseBytes => b !== undefined && !Number.isNaN(b.base));
	const sum = (key: 'base' | 'new'): number => compared.reduce((total, b) => total + b[key], 0);
	return compared.length ? to_bytes_ratio(sum('new'), sum('base')) : NaN;
};

/** The summary of cases in one regime. */
export const summarize = (gs: Array<Graded>, regime: GradeRegime): Summary =>
	to_summary(gs.map((g) => g[regime]!));

/** The same of the whole slice. */
export const summarize_whole = (gs: Array<Graded>, regime: GradeRegime): Summary =>
	to_summary(gs.map((g) => g.whole[regime]!));

/** A row of a summary table, for the JSON report: a group's, or a path's. */
export interface SummaryReport {
	regime: GradeRegime;
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

const format_number = (n: number): string =>
	Number.isNaN(n) ? '-' : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

const format_ratio = (ratio: number): string =>
	Number.isNaN(ratio) ? '-' : `${ratio.toFixed(2)}x`;

// a time ratio from its logarithm, marked when the case is flagged or a candidate
const format_time = (log_ratio: number, mark = ' '): string =>
	Number.isNaN(log_ratio) ? '-' : `${Math.exp(log_ratio).toFixed(3)}x${mark}`;

// a floor or an A/A from its logarithm, as what a ratio may be from one
const format_band = (log_band: number): string =>
	Number.isNaN(log_band) ? '-' : `±${(Math.exp(log_band) - 1).toFixed(3)}`;

const format_bytes_ratio = (b: CaseBytes): string =>
	format_ratio(to_bytes_ratio(b.new, b.base)) + (b.settled ? ' ' : '~');

const format_same = (same: boolean | undefined, c?: GradeCase): string =>
	same === undefined || c?.path === 'create' ? '-' : same ? 'input' : 'copy';

/** A case's mark: `*` confirmed, `?` one run short of it, or none. */
export const to_mark = (t: CaseTime): string => (t.flag ? '*' : t.candidate ? '?' : ' ');

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

/**
 * A fraction as a signed percent, rounded first, so a small loss reads
 * `+0.0%` and not `-0.0%`.
 */
export const format_percent = (n: number, digits = 1): string => {
	const percent = Number((n * 100).toFixed(digits)) || 0;
	return `${percent >= 0 ? '+' : ''}${percent.toFixed(digits)}%`;
};

/** A summary as a speed: positive is faster. */
export const to_speed = (s: Summary): number => 1 - Math.exp(s.ratio);

/** A summary as a speed beside its A/A, what it may be from none. */
export const format_speed = (s: Summary): string =>
	`${format_percent(to_speed(s))} (A/A ±${((Math.exp(s.band) - 1) * 100).toFixed(1)}%)`;

const format_standing = (s: Summary): string =>
	!is_outside(s) ? 'inside its A/A' : s.ratio < 0 ? 'faster, past its A/A' : 'slower, past its A/A';

const format_names = (gs: Array<Graded>): string =>
	gs.length ? gs.map((g) => g.c.name).join(', ') : 'none';

/** Whether a summary is slower past its A/A. */
export const is_slower_past = (summary: Summary): boolean =>
	is_outside(summary) && summary.ratio > 0;

/** What the valid path of the realistic cases reads in one regime, whole and by path. */
export interface ValidByRegime {
	regime: GradeRegime;
	whole: Summary;
	whole_slice: Summary;
	paths: Array<{ path: CasePath; summary: Summary }>;
}

/**
 * By regime rule 6 reads a summary in, what the valid path of the realistic
 * cases reads, whole and by path. A regime with no such case is left out.
 */
export const to_valid_by_regime = (graded: Array<Graded>): Array<ValidByRegime> =>
	SUMMARY_RULE_REGIMES.map((regime) => {
		const valid = graded.filter(
			(g) => g.c.realistic && g.c.valid && g[regime] && !Number.isNaN(g[regime].ratio)
		);
		return {
			regime,
			whole: summarize(valid, regime),
			whole_slice: summarize_whole(valid, regime),
			paths: PATHS.map((path) => ({
				path,
				summary: summarize(
					valid.filter((g) => g.c.path === path),
					regime
				)
			})).filter((p) => p.summary.cases)
		};
	}).filter((v) => v.whole.cases);

/** The summary of every valid case through a parse in the matrix, which rule 6 fails on. */
export const to_all_valid_matrix = (graded: Array<Graded>): Summary =>
	summarize(
		graded.filter((g) => g.c.valid && g.c.path !== 'create' && !Number.isNaN(g.matrix.ratio)),
		'matrix'
	);

/** The cases of a regime flagged one way, of one validity or either. */
export const to_flagged = (
	graded: Array<Graded>,
	regime: GradeRegime,
	flag: CaseTime['flag'],
	valid?: boolean
): Array<Graded> =>
	graded.filter((g) => g[regime]?.flag === flag && (valid === undefined || g.c.valid === valid));

/**
 * What rule 6 fails on: the realistic valid summary in `matrix` and `alone`
 * slower past its A/A, the summary of every valid case in `matrix`, and a
 * valid case through a parse confirmed slower in any regime.
 *
 * @returns each line that failed, as the verdict names it, none on a pass
 */
export const to_slowed = (graded: Array<Graded>): Array<string> => {
	const all_valid_matrix = to_all_valid_matrix(graded);
	return [
		...to_valid_by_regime(graded)
			.filter(({ whole }) => is_slower_past(whole))
			.map(({ regime, whole }) => `realistic valid ${regime} ${format_speed(whole)}`),
		...(all_valid_matrix.cases && is_slower_past(all_valid_matrix)
			? [`every valid case matrix ${format_speed(all_valid_matrix)}`]
			: []),
		...REGIMES.flatMap((regime) => {
			// a creation parses nothing, and is listed below
			const slower_cases = to_flagged(graded, regime, 'slower', true).filter(
				(g) => g.c.path !== 'create'
			).length;
			return slower_cases
				? [`${slower_cases} valid ${slower_cases === 1 ? 'case' : 'cases'} slower ${regime}`]
				: [];
		})
	];
};

/**
 * What warns: a realistic path, valid or invalid, slower past its A/A, in
 * `matrix` or `alone`.
 *
 * @returns each line that warned, as the verdict names it
 */
export const to_warned = (graded: Array<Graded>): Array<string> => {
	const valid_by_regime = to_valid_by_regime(graded);
	return SUMMARY_RULE_REGIMES.flatMap((regime) => {
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
};

/**
 * Rule 4's verdict for a change of the speed class: no core bytes added
 * passes, and added ones pass on a return on the valid path, or on the
 * invalid one with the valid path not slower past its A/A.
 *
 * @param core_delta - what core grew by, `to_core_delta`
 * @returns the verdict text, and the speedup the bytes need
 */
export const judge_core_speed = (
	graded: Array<Graded>,
	core_delta: number,
	runs: number
): { verdict: string; required: number } => {
	const matrix_valid = to_valid_by_regime(graded).find((v) => v.regime === 'matrix')?.whole;
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
	else if (!is_confirmable(runs)) verdict = to_not_judged();
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
	return { verdict, required };
};

const to_not_judged = (): string => `not judged, fewer than ${RUNS_TO_CONFIRM} runs`;

const format_scenario_libs = (r: ScenarioLibsRow): string =>
	`${r.name} ${r.gzip} gzip, ` +
	r.libs.map((l) => `${(r.gzip / l.gzip).toFixed(3)}x ${l.lib}'s ${l.gzip}`).join(', ');

/** What the bundle tables and rules 4 and 5 read, from what the bundles measured. */
interface BundleReading {
	core_delta: number;
	library_delta: number;
	size_figures: Array<SizeFigure>;
	backstop_rows: Array<BackstopRow>;
	new_scenario_rows: Array<ScenarioLibsRow>;
	many_schema_rows: Array<ScenarioLibsRow>;
	all_sizes: { new: number; valibot: number };
}

// the bundle tables, printed through `print_table`, and the figures the rules read
const read_bundle = (
	bundle: GradeBundleMeasures,
	change_class: ChangeClass,
	print_table: (text: string) => void
): BundleReading => {
	const scenario_rows = bundle.scenarios;
	const { base: base_all, new_shared, new_every, valibot: valibot_all } = bundle.all;
	const unshared_scenarios = bundle.unshared;
	const all_sizes = { new: new_every ?? new_shared, valibot: valibot_all };
	const backstop_rows = to_backstop_rows(scenario_rows, bundle.many_schemas);
	const backstop = judge_backstop(backstop_rows);
	const new_scenario_rows = bundle.new_scenario_rows;
	const many_schema_rows = bundle.many_schema_rows;
	const { base_exports, new_exports } = bundle;
	const library_delta = new_exports.library - base_exports.library;
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
	const size_figures = [
		...scenario_figures.filter((f) => !Number.isNaN(f.base)),
		...export_figures
	];
	const core_delta = to_core_delta(size_figures);

	const format_size = (size: number): string => (Number.isNaN(size) ? '-' : String(size));
	const format_class = (f: SizeFigure): string => (f.core ? 'core' : 'opt-in');
	// under the correctness price, a figure over it, and under feature, core that grew
	const over_price = new Set(
		is_priced_as_correctness(change_class)
			? [
					...(change_class === 'feature'
						? judge_core_feature(size_figures)
						: judge_core_correctness(size_figures)),
					...judge_opt_in(size_figures, change_class).over
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
			(change_class === 'feature'
				? ', ! over the price of a feature'
				: is_priced_as_correctness(change_class)
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
				['new scenario', 'new', ...bundle.new_scenario_libs.flatMap((lib) => [lib, 'vs'])],
				...new_scenario_rows.map((r) => [
					r.name,
					String(r.gzip),
					...r.libs.flatMap((l) => [String(l.gzip), `${(r.gzip / l.gzip).toFixed(3)}x`])
				])
			])
		);
	}
	return {
		core_delta,
		library_delta,
		size_figures,
		backstop_rows,
		new_scenario_rows,
		many_schema_rows,
		all_sizes
	};
};

/** What the heap tables and rule 9 read, from what the processes of retained heap measured. */
interface HeapReading {
	heap_figures: Array<HeapFigure>;
	heap_totals: Array<{ name: string; base: number; new: number; delta: number }>;
	heap_totals_grew: Array<string>;
}

const format_kb = (bytes: number): string =>
	Number.isNaN(bytes) ? '-' : (bytes / 1024).toFixed(1);

// the heap tables, printed through `print_table`, and the figures rule 9 reads
const read_heap = (heap: GradeHeapMeasures, print_table: (text: string) => void): HeapReading => {
	const heap_figures: Array<HeapFigure> = [];
	const heap_totals: Array<{ name: string; base: number; new: number; delta: number }> = [];
	const heap_totals_grew: Array<string> = [];
	const format_bytes = (bytes: number): string => (Number.isNaN(bytes) ? '-' : String(bytes));
	const format_figure_delta = (f: HeapFigure): string =>
		(is_heap_compared(f) ? format_heap_delta(to_heap_delta(f)) : '-') +
		(is_over_heap_allowance(f) ? '!' : ' ');
	const heap_rows: Array<Array<string>> = [];
	for (const { name, base, new: current } of heap.scenarios) {
		const figure: HeapFigure = {
			name,
			kind: 'scenario',
			base: base.further_schema_bytes,
			new: current.further_schema_bytes
		};
		heap_figures.push(figure);
		const total_delta = current.total_bytes - base.total_bytes;
		heap_totals.push({
			name,
			base: base.total_bytes,
			new: current.total_bytes,
			delta: total_delta
		});
		heap_rows.push([
			name,
			format_kb(base.total_bytes),
			format_kb(current.total_bytes),
			Number.isNaN(total_delta) ? '-' : format_heap_delta(total_delta),
			format_bytes(figure.base),
			format_bytes(figure.new),
			format_figure_delta(figure)
		]);
		// a total repeats to about the size of a collection's jitter
		if (total_delta > HEAP_SETTLED_BELOW_BYTES) heap_totals_grew.push(name);
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

	const base_by_name = new Map(heap.base_exports.map((e) => [e.name, e]));
	const export_figures = heap.new_exports.map((e: ExportHeap): HeapFigure => ({
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
	return { heap_figures, heap_totals, heap_totals_grew };
};

/** What the cold-start table and its verdict line read. */
interface ColdstartReading {
	coldstart_report: Array<Record<string, number | string | boolean>>;
	coldstart_slower: Array<string>;
	coldstart_ratio: number;
	lukewarm_ratio: number;
}

// the cold-start table, printed through `print_table`, and what its verdict line reads
const read_coldstart = (
	forms: Array<GradeColdstartForm>,
	samples: number,
	print_table: (text: string) => void
): ColdstartReading => {
	const coldstart_slower: Array<string> = [];
	const coldstart_report: Array<Record<string, number | string | boolean>> = [];
	const coldstart_rows: Array<Array<string>> = [];
	const ratios: Array<number> = [];
	const lukewarm_ratios: Array<number> = [];
	for (const { scenario, form, stages } of forms) {
		// what parses 2 to 100 took, read within each process
		const parse_100 = stages.find((s) => s.stage === 'parse_100')!;
		lukewarm_ratios.push(parse_100.new.later_ms / parse_100.base.later_ms);
		for (const { stage, base, new: current } of stages) {
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
				stage,
				base_ms: base.work_ms,
				new_ms: current.work_ms,
				ratio,
				slower,
				band_ms: Math.max(base.work_band_ms, current.work_band_ms),
				peak_kb_delta: current.added_rss_kb - base.added_rss_kb,
				// the parses after the first, in the same processes
				...(Number.isNaN(base.later_ms)
					? {}
					: { later_base_ms: base.later_ms, later_new_ms: current.later_ms })
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
	print_table(
		`\ncold start: median ms of work inside a fresh process, ${samples} samples, each stage including\n` +
			'the ones before it, parse_10 and parse_100 the tenth parse and the hundredth, each of a copy of the\n' +
			'input; band is the wider p10 to p90 spread of the two; peak is KB of resident memory. The verdict\n' +
			"reads parses 2 to 100 within each process: parse_100's clock after its first parse\n"
	);
	print_table(
		format_table([
			['scenario/form/stage', 'base ms', 'new ms', 'time', 'band', 'peak KB'],
			...coldstart_rows
		])
	);
	return {
		coldstart_report,
		coldstart_slower,
		coldstart_ratio: geometric_mean(ratios),
		lukewarm_ratio: geometric_mean(lukewarm_ratios)
	};
};

/**
 * Reads a grade: every case in every regime, the summaries, the bundles, the
 * retained heap, and cold start, into the verdict, its rules and lists first,
 * the tables, and the JSON report, all of it from what it is given.
 */
export const read_grade = (record: GradeRecord, outputs: GradeOutputs): GradeReading => {
	const { args } = record;
	const confirmable = is_confirmable(args.runs);
	const runs_needed = to_runs_needed(args.runs);
	const NOT_JUDGED = to_not_judged();

	const graded_all = to_graded(record, outputs);
	// what the summaries, their A/A, the rules, and the lists read
	const graded = graded_all.filter((g) => g.compared);
	const uncompared = graded_all.filter((g) => !g.compared);
	const disagreed = [...new Set(outputs.matrix.flatMap((run) => run.disagreed))];
	const apart_program_ran = to_apart_program_ran(record, outputs);

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
			`ns is per parse, the median of ${record.instances} instances and of the runs. time is new over base. floor is\n` +
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
				[
					'case',
					'path',
					'matrix',
					'base ns',
					'new ns',
					'time',
					'floor',
					'base B',
					'new B',
					'alloc'
				],
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
				`does to the state a process shares is then in its own processes alone. Each version has ${record.apart_processes}\n` +
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
			PATHS.map((path) => gs.filter((g) => g.c.path === path))
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

	const bundle = record.bundle
		? read_bundle(record.bundle, args.class, print_table)
		: {
				core_delta: 0,
				library_delta: 0,
				size_figures: [],
				backstop_rows: [],
				new_scenario_rows: [],
				many_schema_rows: [],
				all_sizes: { new: NaN, valibot: NaN }
			};
	const heap = record.heap
		? read_heap(record.heap, print_table)
		: { heap_figures: [], heap_totals: [], heap_totals_grew: [] };
	const coldstart = record.coldstart
		? read_coldstart(record.coldstart, args.samples, print_table)
		: {
				coldstart_report: [],
				coldstart_slower: [],
				coldstart_ratio: NaN,
				lukewarm_ratio: NaN
			};
	const { core_delta, library_delta, size_figures, backstop_rows, many_schema_rows, all_sizes } =
		bundle;

	//
	// The rules
	//

	const valid_by_regime = to_valid_by_regime(graded);

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
			const { verdict, required } = judge_core_speed(graded, core_delta, args.runs);
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

	// Rule 6 fails on a family of lines, and the more lines a family has the more
	// often two copies of one file fail one of them, so it is kept to the lines
	// that read most of the valid path: the realistic valid summary in `matrix` and
	// `alone`, the summary of every valid case in `matrix`, and a valid case
	// confirmed slower in any regime, `apart` among them. The realistic paths, as
	// identity and copy, and the realistic invalid path warn: a path of a few cases
	// reads past its A/A by its noise far more often than the whole does.
	// TODO: read the whole slice too, once its A/A is calibrated on enough grades
	const all_valid_matrix = to_all_valid_matrix(graded);
	const slowed = to_slowed(graded);
	print_verdict(
		`every valid case, matrix: ${all_valid_matrix.cases ? `${format_speed(all_valid_matrix)}: ${format_standing(all_valid_matrix)}` : 'none in this run'}`
	);
	print_verdict(
		'the valid path is not slowed: ' +
			(!confirmable ? NOT_JUDGED : slowed.length ? `FAIL: ${slowed.join(', ')}` : 'pass')
	);
	const warned = to_warned(graded);
	print_verdict(
		'a realistic path is not slowed, a warning: ' +
			(!confirmable ? NOT_JUDGED : warned.length ? `WARN: ${warned.join(', ')}` : 'none')
	);

	for (const regime of REGIMES) {
		if (!graded.some((g) => g[regime])) continue;
		print_verdict(`cases slower, ${regime}: ${format_names(to_flagged(graded, regime, 'slower'))}`);
		print_verdict(`cases faster, ${regime}: ${format_names(to_flagged(graded, regime, 'faster'))}`);
		print_verdict(
			`cases marked ?, ${regime}: ` + format_names(graded.filter((g) => g[regime]?.candidate))
		);
	}
	const to_more_alloc = (regime: GradeRegime): Array<Graded> =>
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
	if (apart_program_ran < record.program_entries) {
		print_verdict(
			`the program, apart: the baseline ran ${apart_program_ran} of its ${record.program_entries} entries, ` +
				'the rest throwing or giving another answer in it, where the new version ran them all'
		);
	}
	if (args.process) {
		print_verdict(
			`cold start, first parse: ${format_ratio(coldstart.coldstart_ratio)} the baseline's; ` +
				`parses 2 to 100 of a fresh process, reported: ${format_ratio(coldstart.lukewarm_ratio)}; ` +
				`stages slower past their own spread: ${coldstart.coldstart_slower.length ? coldstart.coldstart_slower.join(', ') : 'none'}`
		);
		print_verdict(format_heap_line(judge_heap(heap.heap_figures), heap.heap_totals_grew));
	}
	print_verdict(`the machine at the end: ${format_machine_state(record.machine.end)}`);

	const report: Record<string, unknown> = {
		note:
			"a case's ratio and floor, and a summary's ratio and band, are natural logarithms of new " +
			'over base: the printed time is exp(ratio), and a floor or an A/A ±(exp(floor) - 1). ' +
			'Every other figure is as printed, unrounded',
		graded: record.graded,
		against: record.against,
		identical: record.identical,
		args: record.args,
		started_at: record.started_at,
		ended_at: record.ended_at,
		setup: record.setup,
		machine: record.machine,
		instances: record.instances,
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
		apart_program_ran: { ran: apart_program_ran, of: record.program_entries },
		core_delta,
		library_delta,
		size_figures,
		backstop_rows,
		new_scenario_rows: bundle.new_scenario_rows,
		many_schema_rows,
		all_sizes,
		heap_figures: heap.heap_figures,
		heap_totals: heap.heap_totals,
		heap_totals_grew: heap.heap_totals_grew,
		coldstart: coldstart.coldstart_report,
		coldstart_ratio: coldstart.coldstart_ratio,
		lukewarm_ratio: coldstart.lukewarm_ratio,
		verdict: report_verdict,
		tables: report_tables,
		elapsed_s: record.elapsed_s
	};
	return { verdict: report_verdict, tables: report_tables, report };
};

/** The report as its JSON text: a figure that is not finite as `null`. */
export const format_grade_report = (report: Record<string, unknown>): string =>
	JSON.stringify(
		report,
		(_, value: unknown) => (typeof value === 'number' && !Number.isFinite(value) ? null : value),
		'\t'
	) + '\n';

// the strings a figure that is not finite is written as in a record, which
// keeps them where the report writes `null`
const NOT_FINITE: Record<string, number> = {
	NaN,
	Infinity,
	'-Infinity': -Infinity
};

/** A record, or the outputs of jobs, as JSON text that keeps a figure that is not finite. */
export const format_grade_record = (value: unknown): string =>
	JSON.stringify(
		value,
		(_, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v),
		'\t'
	) + '\n';

/** Reads the text `format_grade_record` wrote. */
export const parse_grade_record = <T>(text: string): T =>
	JSON.parse(text, (_, v: unknown) =>
		typeof v === 'string' && v in NOT_FINITE ? NOT_FINITE[v] : v
	) as T;
