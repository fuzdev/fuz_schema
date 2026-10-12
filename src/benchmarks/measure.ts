/**
 * Measurement helpers shared by the benchmark scripts.
 *
 * Allocation is measured as the growth of V8's used heap across a batch of
 * calls. That only holds if no garbage collection runs mid-batch, so callers
 * need `--expose-gc` and a young generation large enough for a whole batch
 * (`--min-semi-space-size=64 --max-semi-space-size=64`); a round where the
 * heap shrank is thrown out. Optimized code can remove allocations entirely,
 * which is the real cost and is reported as such.
 *
 * @module
 */

import { getHeapStatistics } from 'node:v8';
import {
	benchmark_lock_acquire,
	benchmark_lock_format_refusal
} from '@fuzdev/fuz_util/benchmark_lock.ts';

/** The node flags scripts that measure allocation must run under. */
export const ALLOCATION_NODE_FLAGS =
	'--expose-gc --min-semi-space-size=64 --max-semi-space-size=64';

// the heap a single round may fill, well under the semi-space size
const ROUND_BYTES_TARGET = 4 * 1024 * 1024;

export const median = (values: Array<number>): number => {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[sorted.length >> 1]!;
};

export const geometric_mean = (values: Array<number>): number =>
	values.length ? Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length) : NaN;

const get_gc = (): (() => void) => {
	const { gc } = globalThis as { gc?: () => void };
	if (!gc) throw new Error(`allocation measurement needs node ${ALLOCATION_NODE_FLAGS}`);
	return gc;
};

const measure_round = (gc: () => void, fn: () => unknown, batch: number): number => {
	gc();
	const before = getHeapStatistics().used_heap_size;
	for (let i = 0; i < batch; i++) fn();
	return getHeapStatistics().used_heap_size - before;
};

const noop = (): void => {};

// what a round costs with nothing in it, mostly the statistics objects
let round_overhead: number | undefined;

/**
 * Returns the median heap bytes allocated per call of `fn`,
 * or `NaN` if every round was interrupted by a collection.
 *
 * @param batch - calls per round, chosen from a small trial when omitted
 * @throws Error when `gc` isn't exposed
 */
export const measure_bytes = (fn: () => unknown, batch?: number, rounds = 7): number => {
	const gc = get_gc();
	if (round_overhead === undefined) {
		for (let i = 0; i < 20; i++) measure_round(gc, noop, 0);
		round_overhead = median(Array.from({ length: 9 }, () => measure_round(gc, noop, 0)));
	}
	const overhead = round_overhead;
	let n = batch;
	if (n === undefined) {
		const trial = Math.max(1, measure_round(gc, fn, 1) - overhead);
		n = Math.max(1, Math.min(2000, Math.floor(ROUND_BYTES_TARGET / trial)));
	}
	const results: Array<number> = [];
	for (let r = 0; r < rounds; r++) {
		const grown = measure_round(gc, fn, n);
		if (grown >= 0) results.push(Math.max(0, grown - overhead) / n);
	}
	return results.length ? median(results) : NaN;
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
