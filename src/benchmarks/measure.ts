/**
 * Measurement helpers shared by the benchmark scripts.
 *
 * Allocation is measured as the growth of V8's used heap across a sample of
 * calls, with no collection forced. A forced collection clears the maps
 * optimized code holds weakly, the code that held them is thrown away, and the
 * calls sampled after it run in code the engine has yet to optimize again,
 * which allocates more. So a sample is kept a small share of a young
 * generation large enough that a collection falls in few
 * (`ALLOCATION_NODE_FLAGS`), one that a collection fell in is left to the
 * median, and a function is sampled until two medians in a row agree.
 *
 * A young generation that is full is not collected at once while the engine
 * compiles on another thread, and until it is, the used heap moves up and
 * down by tens of kilobytes from one sample to the next whatever the calls
 * allocate. So a median starts with much of the young generation free:
 * `ensure_young_generation_free` allocates until it is collected when it
 * isn't, which is the collection the samples would have run into, taken
 * before them and not forced.
 * Optimized code can remove allocations entirely, which is the real cost and
 * is reported as such.
 *
 * @module
 */

import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

/** The node flags scripts that measure allocation must run under. */
export const ALLOCATION_NODE_FLAGS = '--min-semi-space-size=64 --max-semi-space-size=64';

const ALLOCATION_NODE_FLAGS_MESSAGE =
	`allocation measurement needs \`node ${ALLOCATION_NODE_FLAGS}\`, a young generation large ` +
	'enough that a collection falls in few samples: run the script with `npm run`, which passes them';

// by flag of `ALLOCATION_NODE_FLAGS`, whether the process was given it, on the
// command line or in `NODE_OPTIONS`
const to_allocation_node_flags_given = (): Array<boolean> => {
	// V8 reads a flag's underscores as dashes
	const given = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)].map((arg) =>
		arg.replaceAll('_', '-')
	);
	return ALLOCATION_NODE_FLAGS.split(' ').map((flag) =>
		given.some((arg) => arg.startsWith(flag.slice(0, flag.indexOf('=') + 1)))
	);
};

/**
 * Whether the process runs under every one of `ALLOCATION_NODE_FLAGS`, given
 * on the command line or in `NODE_OPTIONS`, which is what a byte reading needs.
 */
export const has_allocation_node_flags = (): boolean =>
	to_allocation_node_flags_given().every((given) => given);

/**
 * Whether the process runs under any of `ALLOCATION_NODE_FLAGS`, given on the
 * command line or in `NODE_OPTIONS`, which is what a timing refuses: one of
 * them alone moves what a parse takes, and is not what a consumer runs under.
 */
export const has_some_allocation_node_flag = (): boolean =>
	to_allocation_node_flags_given().some((given) => given);

/**
 * Exits with 1, saying why, unless a script that times may start: under no
 * `NODE_OPTIONS`, which every process it starts would inherit, a timing among
 * them, and with none of `ALLOCATION_NODE_FLAGS` on its command line. A
 * process that measures bytes is given those on its command line.
 *
 * @param script - names the script in the message
 * @param gives_bytes_flags - whether the script starts processes that measure bytes, which the message says
 */
export const refuse_timing_node_flags = (script: string, gives_bytes_flags: boolean): void => {
	const options = process.env.NODE_OPTIONS?.trim();
	if (options) {
		console.error(
			`${script} times under the flags a consumer has, and every process it starts would ` +
				`inherit NODE_OPTIONS, here \`${options}\`: unset it`
		);
		process.exit(1);
	}
	if (has_some_allocation_node_flag()) {
		console.error(
			`${script} times under the flags a consumer has: take \`${ALLOCATION_NODE_FLAGS}\` off ` +
				'the command line' +
				(gives_bytes_flags ? ', the processes that measure bytes are given them' : '')
		);
		process.exit(1);
	}
};

/**
 * Exits with 1, saying which node flags it needs, unless the process has
 * the ones `measure_bytes` needs. For a script to call before it does any
 * work, where `measure_bytes` would throw only once it is reached.
 */
export const require_allocation_node_flags = (): void => {
	if (has_allocation_node_flags()) return;
	console.error(ALLOCATION_NODE_FLAGS_MESSAGE);
	process.exit(1);
};

// what a sample aims to allocate, a small share of the young generation, so
// that a collection falls in few samples and the median is of those it didn't
const SAMPLE_BYTES = 1024 * 1024;
const SAMPLE_CALLS_MAX = 2000;
const SAMPLES = 15;
// A function is run for a time between two medians, by default this long, and
// they are taken until one is within `SETTLED_WITHIN` of the one before it.
// After `SETTLE_TRIES` that were not, past the first, the bytes did not settle
// and the measurement throws.
const SETTLE_MS = 250;
const SETTLE_TRIES = 20;
const SETTLED_WITHIN = 0.005;
// the share of a median's samples a collection may fall in before the measurement throws
const MAX_COLLECTED_SHARE = 1 / 3;
// what of the young generation is free when a median starts, twice what its
// samples aim to allocate
const MEDIAN_YOUNG_FREE = 2 * SAMPLES * SAMPLE_BYTES;
// what `ensure_young_generation_free` allocates at a time, an array of this
// length, small enough to be made in the young generation
const YOUNG_FILLER_LENGTH = 1024;
// how many times the young generation's size it allocates before it throws
const YOUNG_FILLS_MAX = 4;

/**
 * What the young generation holds, used and free together, and what of it is
 * free, from V8's `new_space`. Its `space_size` is the memory reserved for it,
 * which is not what it holds.
 */
export const get_young_generation = (): { size: number; free: number } => {
	for (const space of getHeapSpaceStatistics()) {
		if (space.space_name === 'new_space') {
			return {
				size: space.space_used_size + space.space_available_size,
				free: space.space_available_size
			};
		}
	}
	throw new Error('V8 reports no `new_space`');
};

// what the filler arrays are written to, so that no compiler drops them
const young_filler: Array<unknown> = [null];

/**
 * Allocates until at least `bytes` of the young generation are free, which
 * means until it is collected when they are not. The collection is the one
 * the allocation brings on, not a forced one, and of the young generation
 * alone, see the module comment.
 *
 * @param bytes - what of the young generation must be free
 * @throws Error when the young generation is not that free after allocating several times its size
 */
export const ensure_young_generation_free = (bytes: number): void => {
	let young = get_young_generation();
	const max = YOUNG_FILLS_MAX * Math.max(young.size, bytes);
	let allocated = 0;
	while (young.free < bytes) {
		if (allocated > max) {
			throw new Error(
				`the young generation has ${young.free} bytes free of ${young.size} after ` +
					`${allocated} were allocated, not the ${bytes} a median needs: it is smaller than ` +
					`\`node ${ALLOCATION_NODE_FLAGS}\` makes it, or what survives fills it`
			);
		}
		for (let i = 0; i < 64; i++) young_filler[0] = new Array(YOUNG_FILLER_LENGTH);
		allocated += 64 * 8 * YOUNG_FILLER_LENGTH;
		young = get_young_generation();
	}
	young_filler[0] = null;
};

export const median = (values: Array<number>): number => {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[sorted.length >> 1]!;
};

export const geometric_mean = (values: Array<number>): number =>
	values.length ? Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length) : NaN;

const sample_heap = (fn: () => unknown, calls: number): number => {
	const before = getHeapStatistics().used_heap_size;
	for (let i = 0; i < calls; i++) fn();
	return getHeapStatistics().used_heap_size - before;
};

const noop = (): void => {};

const measure_bytes_median = (fn: () => unknown, calls: number): number => {
	ensure_young_generation_free(MEDIAN_YOUNG_FREE);
	const raw = Array.from({ length: SAMPLES }, () => sample_heap(fn, calls));
	const collected = raw.filter((delta) => delta < 0).length;
	if (collected > raw.length * MAX_COLLECTED_SHARE) {
		throw new Error(
			`the used heap fell in ${collected} of ${raw.length} samples of ${calls} calls, which ` +
				`started with ${MEDIAN_YOUNG_FREE} bytes of the young generation free: a call ` +
				'allocates too large a share of it'
		);
	}
	// what a sample grows the heap by with nothing in it, the statistics objects,
	// read beside the samples because it falls as the engine optimizes the sampling
	const overhead = median(Array.from({ length: SAMPLES }, () => sample_heap(noop, 0)));
	return median(raw.map((delta) => Math.max(0, delta - overhead) / calls));
};

// The sampling loops are the engine's code too. While they have been given one
// function the engine inlines it into them, and it is measured as code no caller
// has: the loop keeps nothing a call returns, so an object that is only returned
// is never allocated and reads as zero. A second function ends the inlining, so
// the first function a process measured read differently from the same function
// measured later. So two functions are measured and thrown away before the first
// that is kept, which leaves the loops calling whatever they are given.
const SAMPLER_PRIMERS: Array<() => unknown> = [() => ({ primer: 1 }), () => [1]];
const SAMPLER_PRIMER_SETTLE_MS = 20;
let sampler_primed = false;

/**
 * Returns the median heap bytes a call of `fn` allocates, once two medians in
 * a row agree. No collection is forced, see the module comment.
 *
 * @param settle_ms - how long `fn` is run between two medians, which is the time the engine has to finish optimizing it. The default suits a function called only a little before; one already run for a second or more settles in far less.
 * @throws Error when the process lacks `ALLOCATION_NODE_FLAGS`, a collection fell in too many samples, or the bytes did not settle
 */
export const measure_bytes = (fn: () => unknown, settle_ms = SETTLE_MS): number => {
	if (!has_allocation_node_flags()) throw new Error(ALLOCATION_NODE_FLAGS_MESSAGE);
	if (!sampler_primed) {
		sampler_primed = true;
		for (const primer of SAMPLER_PRIMERS) measure_bytes(primer, SAMPLER_PRIMER_SETTLE_MS);
	}
	let bytes = measure_bytes_median(fn, 1);
	for (let tries = 0; tries < SETTLE_TRIES; tries++) {
		const until = performance.now() + settle_ms;
		do fn();
		while (performance.now() < until);
		const calls = Math.max(1, Math.min(SAMPLE_CALLS_MAX, Math.floor(SAMPLE_BYTES / bytes)));
		const next = measure_bytes_median(fn, calls);
		const settled = Math.abs(next - bytes) <= bytes * SETTLED_WITHIN;
		bytes = next;
		if (settled) return bytes;
	}
	throw new Error(`the bytes did not settle within ${SETTLE_TRIES} tries`);
};

// what `measure_ms` writes each call's result to, so that no compiler drops the call
const measure_ms_sink: Array<unknown> = [undefined];

// The timing loop is the engine's code too, as the sampling loops are: while it
// has been given one function the engine inlines it, and can remove what the
// function only returns. So it times two functions and throws them away first.
const MEASURE_MS_PRIMERS: Array<() => unknown> = [() => ({ primer: 1 }), () => [1]];
let measure_ms_primed = false;

/**
 * Returns the median milliseconds per call of `fn`, over `rounds` batches of
 * calls, each batch as many calls as last `batch_ms` or more, so a cheap call
 * is timed far above the timer's resolution. Each call's result is kept until
 * the next, so none is dropped as unused.
 *
 * @param batch_ms - the least a batch lasts, in milliseconds
 */
export const measure_ms = (fn: () => unknown, batch_ms = 2, rounds = 7): number => {
	if (!measure_ms_primed) {
		measure_ms_primed = true;
		for (const primer of MEASURE_MS_PRIMERS) measure_ms(primer, batch_ms, 1);
	}
	let batch = 1;
	for (;;) {
		const start = performance.now();
		for (let i = 0; i < batch; i++) measure_ms_sink[0] = fn();
		if (performance.now() - start >= batch_ms) break;
		batch *= 2;
	}
	const results: Array<number> = [];
	for (let r = 0; r < rounds; r++) {
		const start = performance.now();
		for (let i = 0; i < batch; i++) measure_ms_sink[0] = fn();
		results.push((performance.now() - start) / batch);
	}
	measure_ms_sink[0] = undefined;
	return median(results);
};

/**
 * The orders to time `count` things in, an order a round, so that position
 * favors none of them: the rotations of one order and of its reverse. Across
 * the rounds each is in every position equally often, and with three, each
 * follows each other equally often inside a round.
 *
 * @returns the orders, each a list of indexes
 */
export const to_balanced_orders = (count: number): Array<Array<number>> => {
	const forward = Array.from({ length: count }, (_, i) => i);
	const orders: Array<Array<number>> = [];
	for (const base of [forward, forward.toReversed()]) {
		for (let shift = 0; shift < count; shift++) {
			const order = base.map((_, i) => base[(i + shift) % count]!);
			if (!orders.some((o) => o.every((v, i) => v === order[i]))) orders.push(order);
		}
	}
	return orders;
};

/**
 * Formats a figure to about three significant digits: whole from 100, one
 * decimal from 10, two under that. What the timing tables print a time in.
 */
export const format_number = (n: number): string =>
	n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

/**
 * Formats heap bytes per call: whole from 10, and zero as `0`, one decimal
 * under 10, and `?` for `NaN`. A median of bytes over calls is a fraction
 * only where the calls of a sample didn't all allocate alike.
 */
export const format_bytes = (n: number): string =>
	Number.isNaN(n) ? '?' : n >= 10 || n === 0 ? n.toFixed(0) : n.toFixed(1);

/** Formats a duration in seconds as `12s`, or in minutes past 90 seconds. */
export const format_seconds = (seconds: number): string =>
	seconds < 90 ? `${Math.round(seconds)}s` : `${(seconds / 60).toFixed(1)} min`;

/**
 * Prints rows as a padded table, the first `left` columns left-aligned.
 */
export const format_table = (rows: Array<Array<string>>, left = 1): string => {
	const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]?.length ?? 0)));
	return rows
		.map((row) =>
			row
				.map((cell, i) => (i < left ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
				.join('  ')
				.trimEnd()
		)
		.join('\n');
};
