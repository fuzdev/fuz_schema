/**
 * What a script that times in processes (`timing_passes.ts`) and a process it
 * starts (`timing_child.ts`) share: the job a process is given, what it
 * prints, the rows a module hands it, and the constants of a timing.
 *
 * This module imports nothing, so a measured process gets none of the harness
 * through it.
 *
 * @module
 */

/** One thing a process measures: a function that takes nothing, and its name. */
export interface TimingRow {
	name: string;
	run: () => unknown;
}

/**
 * What a rows module exports as `load_rows`. It is given the job's `of`, loads
 * only what that names, and checks each row gives the answer it should before
 * returning it, throwing when one doesn't.
 */
export type LoadTimingRows = (of: any) => Array<TimingRow> | Promise<Array<TimingRow>>;

export interface TimingJob {
	/** `time` runs under Node's own flags and refuses the ones bytes need, which `bytes` requires. */
	mode: 'time' | 'bytes';
	/** The path of a module that exports `load_rows`. */
	module: string;
	/** What that `load_rows` is called with: what the process holds, one library's side of something. */
	of: unknown;
	/** The rows to measure, every row when left out. */
	rows?: Array<string>;
	/**
	 * Whether every row the process holds is run before any is measured, so each
	 * is measured in code that has seen them all, whichever are measured and in
	 * whatever order.
	 */
	prelude: boolean;
	/** The least a row is run for before it is measured, in milliseconds. */
	warm_ms: number;
	/** What the timing of a row lasts, in milliseconds. */
	duration_ms: number;
	/** Moves on which row is run and measured first, so passes differ in it. */
	offset: number;
}

export interface TimingChildRow {
	name: string;
	/** In `time` mode: nanoseconds per call, the whole of the timing over its calls. */
	ns?: number;
	/**
	 * In `time` mode: nanoseconds per call in the median batch of the timing. A
	 * collection falls in few batches, so this is the row nearly without them.
	 */
	median_ns?: number;
	/** In `bytes` mode: heap bytes per call. */
	bytes?: number;
}

export interface TimingChildOutput {
	rows: Array<TimingChildRow>;
	/**
	 * In `time` mode: nanoseconds per call of a function that does nothing,
	 * through the same loop. Every row's figure has it in it.
	 */
	call_ns?: number;
	sink: number;
}

/** What a batch of calls aims to last, in milliseconds: well above the timer's resolution. */
export const TIMING_BATCH_MS = 0.05;
/** The most calls a batch holds, however fast one is. */
export const TIMING_BATCH_MAX = 10_000;
/** The fewest batches a timing takes, however long one lasts. */
export const TIMING_MIN_BATCHES = 5;

/** The fewest calls a row is warmed with, however long they take. */
export const TIMING_WARM_CALLS = 30;
export const TIMING_WARM_SLICE_MS = 1;

/** What a prelude runs each row for, and the fewest calls it gives one. */
export const TIMING_PRELUDE_MS = 20;
export const TIMING_PRELUDE_CALLS = 30;
