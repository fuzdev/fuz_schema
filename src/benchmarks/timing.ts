/**
 * The loops a function is called and timed from, shared by every script that
 * times in a process of its own: `timing_child.ts`, which `run.ts` and
 * `harvest.ts` start, and `grade_child.ts`, which loads this module once for
 * each arm, under the arm's URL, so each arm has loops of its own.
 *
 * **The loops have seen many functions before they see one.** A loop given a
 * single function is specialized to it by the engine, which inlines it, and
 * the function is then timed as code no caller has. When that inlining happens
 * is a matter of timing, and sets two copies of one function apart. So the
 * loops are run over several functions as the module loads, and call whatever
 * they are given from then on.
 *
 * **Warm by time with a floor of calls.** A count alone leaves a slow function
 * timed in code the engine has yet to optimize, and a time alone leaves it
 * nearly unrun. The warming goes through the loop the timing does.
 *
 * No collection is forced here or by anything that calls this: a forced
 * collection makes the engine throw optimized code away.
 *
 * This module imports nothing, so an instance of it holds nothing another
 * instance does.
 *
 * @module
 */

let sink = 0;

/** Calls `run` a number of times, untimed. */
export const call = (run: () => unknown, calls: number): void => {
	for (let i = 0; i < calls; i++) {
		if (run() !== undefined) sink++;
	}
};

/**
 * Times batches of calls, one after another, until `ms` have passed and
 * `min_batches` are taken.
 *
 * @returns the milliseconds each batch took
 */
export const time_slice = (
	run: () => unknown,
	batch: number,
	ms: number,
	min_batches: number
): Array<number> => {
	const samples: Array<number> = [];
	const until = performance.now() + ms;
	let now: number;
	do {
		const start = performance.now();
		for (let i = 0; i < batch; i++) {
			if (run() !== undefined) sink++;
		}
		now = performance.now();
		samples.push(now - start);
	} while (now < until || samples.length < min_batches);
	return samples;
};

const PRIMERS: Array<() => unknown> = [
	() => 1,
	() => 'a',
	() => null,
	() => undefined,
	() => true,
	() => 1.5
];
for (const primer of PRIMERS) {
	call(primer, 100);
	time_slice(primer, 100, 0, 3);
}

/** What the loops counted, read so that the engine can't drop the calls. */
export const read_sink = (): number => sink;

/** How a function is warmed, and the batch it is then timed at. */
export interface WarmOptions {
	/** The least time the function is run for, in milliseconds. */
	ms: number;
	/** The fewest calls it is given, however long they take. */
	min_calls: number;
	/** What one turn of the warming lasts, in milliseconds, after which the batch is sized again. */
	slice_ms: number;
	/** What a batch of calls aims to last, in milliseconds: well above the timer's resolution. */
	batch_ms: number;
	/** The most calls a batch holds, however fast one is: what a batch the timer read as nothing is set to. */
	batch_max: number;
}

/**
 * Runs `run` through `time_slice` until `options.ms` have passed and it has
 * had `options.min_calls`.
 *
 * @returns the batch to time it at, sized from its last turn
 */
export const warm = (run: () => unknown, options: WarmOptions): number => {
	const { ms, min_calls, slice_ms, batch_ms, batch_max } = options;
	const until = performance.now() + ms;
	let batch = 1;
	let calls = 0;
	do {
		const samples = time_slice(run, batch, slice_ms, 1);
		calls += batch * samples.length;
		let fastest = Infinity;
		for (const sample of samples) {
			if (sample < fastest) fastest = sample;
		}
		// a batch the timer read as nothing is far too small
		batch =
			fastest > 0
				? Math.max(1, Math.min(batch_max, Math.round((batch_ms * batch) / fastest)))
				: batch_max;
	} while (calls < min_calls || performance.now() < until);
	return batch;
};
