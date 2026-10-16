/**
 * A seeded generator of random choices, shared by the differential and the
 * generated JSON fixtures, so a seed gives the same cases everywhere.
 *
 * @module
 */

/** What a generator draws from. */
export interface SeededRng {
	/** An integer from `0` to below `n`. */
	int: (n: number) => number;
	chance: (p: number) => boolean;
	pick: <T>(items: ReadonlyArray<T>) => T;
}

/** A seeded generator, mulberry32. */
export const create_seeded_rng = (seed: number): SeededRng => {
	let a = seed >>> 0;
	const next = (): number => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		int: (n: number): number => Math.floor(next() * n),
		chance: (p: number): boolean => next() < p,
		pick: <T>(items: ReadonlyArray<T>): T => items[Math.floor(next() * items.length)]!
	};
};
