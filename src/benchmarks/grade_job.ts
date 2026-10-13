/**
 * What `grade.ts` and the processes it runs (`grade_child.ts`) share: the job a
 * process is given, what it prints, and the constants of a timing, which the
 * parent estimates a run from.
 *
 * @module
 */

export interface GradeJob {
	mode: 'time' | 'bytes';
	regime: 'matrix' | 'alone';
	/**
	 * The instances to load, a version's file once for each of its. The last is
	 * of the version graded, and the cases are its. An arm that is `graded` must
	 * build every group of cases, where another loses the groups its API lacks.
	 */
	arms: Array<{ id: string; path: string; graded: boolean }>;
	/** The cases to measure, exactly one in the `alone` regime. */
	cases: Array<string>;
	/** What one timing of one arm aims to last, in milliseconds. */
	slice_ms: number;
	/** Moves on which arm is loaded first and which order leads, so runs differ in both. */
	offset: number;
}

export interface GradeChildCase {
	name: string;
	/** The arms measured: those that have the case and agree on it. */
	arms: Array<string>;
	/** By arm, in `time` mode: nanoseconds per call, a figure a round. */
	ns?: Record<string, Array<number>>;
	/** By arm, in `bytes` mode: heap bytes per call. */
	bytes?: Record<string, number>;
	/** By arm: whether the output is the input itself. */
	same: Record<string, boolean>;
}

export interface GradeChildOutput {
	cases: Array<GradeChildCase>;
	/** Cases an arm of another version than the graded one disagrees on, which is left out of those. */
	disagreed: Array<string>;
	sink: number;
}

/** What a batch of calls aims to last, in milliseconds: well above the timer's resolution. */
export const GRADE_BATCH_MS = 0.05;
export const GRADE_BATCH_MAX = 10_000;
/** The fewest batches a timing takes, however long one lasts. */
export const GRADE_MIN_BATCHES = 5;

/**
 * A case is run this long over its arms, and `GRADE_WARM_CALLS` times an arm,
 * before it is timed, whichever is more: a count alone leaves a slow case
 * timed in code the engine has yet to optimize, and a time alone leaves it
 * nearly unrun. A process that runs one case has everything still to compile,
 * so it warms for longer.
 */
export const GRADE_WARM_MS = { matrix: 60, alone: 400 };
export const GRADE_WARM_CALLS = 30;
export const GRADE_WARM_SLICE_MS = 1;

/** What the matrix regime runs every case of every arm for, before any is measured. */
export const GRADE_PRELUDE_MS = 4;
export const GRADE_PRELUDE_CALLS = 30;

/**
 * What a case is run for between two medians of its bytes. It has been warmed
 * by then, so this is short: the bytes read the same at a tenth of it and at
 * five times it.
 */
export const GRADE_BYTES_SETTLE_MS = 50;
