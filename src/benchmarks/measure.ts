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
 * Optimized code can remove allocations entirely, which is the real cost and
 * is reported as such.
 *
 * @module
 */

import { getHeapStatistics } from 'node:v8';
import {
	benchmark_lock_acquire,
	benchmark_lock_format_refusal
} from '@fuzdev/fuz_util/benchmark_lock.ts';

/** The node flags scripts that measure allocation must run under. */
export const ALLOCATION_NODE_FLAGS = '--min-semi-space-size=64 --max-semi-space-size=64';

const ALLOCATION_NODE_FLAGS_MESSAGE =
	`allocation measurement needs \`node ${ALLOCATION_NODE_FLAGS}\`, a young generation large ` +
	'enough that a collection falls in few samples: run the script with `npm run`, which passes them';

const has_allocation_node_flags = (): boolean =>
	ALLOCATION_NODE_FLAGS.split(' ').every((flag) =>
		process.execArgv.some((arg) => arg.startsWith(flag.slice(0, flag.indexOf('=') + 1)))
	);

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
	const raw = Array.from({ length: SAMPLES }, () => sample_heap(fn, calls));
	const collected = raw.filter((delta) => delta < 0).length;
	if (collected > raw.length * MAX_COLLECTED_SHARE) {
		throw new Error(
			`a collection fell in ${collected} of ${raw.length} samples: the young generation is ` +
				`smaller than \`node ${ALLOCATION_NODE_FLAGS}\` makes it, or a call allocates too large a share of it`
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

/**
 * Returns the median milliseconds per call of `fn`.
 */
export const measure_ms = (fn: () => unknown, batch: number, rounds = 7): number => {
	const results: Array<number> = [];
	for (let r = 0; r < rounds; r++) {
		const start = performance.now();
		for (let i = 0; i < batch; i++) fn();
		results.push((performance.now() - start) / batch);
	}
	return median(results);
};

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

/**
 * Takes the machine-wide benchmark lock for the life of the process, so a
 * timed benchmark never overlaps another that takes it. Exits with 2, saying
 * who holds it, when it is held.
 *
 * @param label - names this process to whoever is refused next
 */
export const hold_benchmark_lock = (label: string): void => {
	const acquired = benchmark_lock_acquire(label);
	if (!acquired.ok) {
		console.error(benchmark_lock_format_refusal(acquired));
		process.exit(2);
	}
	const { lock } = acquired;
	process.on('exit', () => lock.release());
};
