/**
 * One arm of a grading process: the loops a version of the library is called
 * from, and its copy of the case matrix.
 *
 * `grade_child.ts` loads this module once for each arm, under a URL of the
 * arm's own, and its imports with it. So every arm has its own functions for
 * the cases and for the loops below, and the engine keeps what it learns about
 * one arm's calls apart from the next arm's. A loop shared by two arms is
 * specialized to the first it is given, and two arms holding the same library
 * then read apart, so each arm has its own.
 *
 * Nothing here is shared with another arm, so this module imports the cases
 * and nothing of the harness.
 *
 * @module
 */

import { CASE_GROUPS, create_case, create_cases, type Case, type SchemaLib } from './cases.ts';

let sink = 0;

/** Tells one arm's instance of the case matrix from another's. */
export const instance: unknown = CASE_GROUPS;

/** Builds every case the arm's library supports, for the matrix. With `strict`, a group that throws fails it. */
export const build_cases = (lib: SchemaLib, strict: boolean): Array<Case> =>
	create_cases(lib, strict);

/** Builds one case and as little else as it can, for a process that runs that case alone. With `strict`, a group that throws on the way fails it. */
export const build_case = (lib: SchemaLib, name: string, strict: boolean): Case | undefined =>
	create_case(lib, name, strict);

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
