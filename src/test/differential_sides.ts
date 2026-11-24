/**
 * `differential_sides.json`: of the differential's cases at the fixed seeds of
 * `gro check`, each one zod and valibot disagree on, and whose side this
 * library is on. The table of `SIDES` holds the matrix's cases to a side, and
 * the generated cases have no rows: this file holds each to the side it was
 * last seen on, so a change that moves one, as a `number` that comes to take
 * an infinity moves every case with one, fails `schema.differential.test.ts`,
 * and what moved is the diff of the file regenerated, a case to a line.
 *
 * It is generated, by `update_differential_sides.task.ts`, and never
 * hand-edited. It moves too when the generator, an adapter, or the zod or
 * valibot installed changes what a case is or does.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	run_differential,
	type DifferentialReport,
	type DifferentialSide
} from './differential_classify.ts';

/** The seeds and the count of the differential `gro check` runs, the same on every run. */
export const DIFFERENTIAL_SEEDS = [1, 2, 3];
export const DIFFERENTIAL_COUNT = 5000;

/**
 * The cases of a seed zod and valibot disagree on, each by its place: this
 * library's side, and with neither, `neither` and then a digest of what this
 * library gave, as no other result says what that was.
 */
export type DifferentialSidesOfSeed = Record<string, string>;

/** The contents of `differential_sides.json`. */
export interface DifferentialSides {
	/** How many cases each seed runs. */
	count: number;
	seeds: Record<string, DifferentialSidesOfSeed>;
}

const digest = (text: string): string =>
	createHash('sha256').update(text).digest('hex').slice(0, 8);

// what the file holds of a case on `side`, where this library gave `ours`
const held_as = (side: DifferentialSide, ours: string): string =>
	side === 'neither' ? `neither ${digest(ours)}` : side;

const sides_path = join(import.meta.dirname, 'differential_sides.json');

/** The sides of a report's cases, as the file holds a seed's. */
export const to_differential_sides = (report: DifferentialReport): DifferentialSidesOfSeed => {
	const sides: DifferentialSidesOfSeed = {};
	for (const { n, side, ours } of report.sided) sides[n] = held_as(side, ours);
	return sides;
};

/** Runs the differential at each fixed seed. */
export const run_differential_seeds = (): Map<number, DifferentialReport> =>
	new Map(
		DIFFERENTIAL_SEEDS.map((seed) => [
			seed,
			run_differential({ seed, count: DIFFERENTIAL_COUNT, minimize_limit: 5 })
		])
	);

/** What the file holds of the reports of the fixed seeds. */
export const measure_differential_sides = (
	reports: Map<number, DifferentialReport> = run_differential_seeds()
): DifferentialSides => ({
	count: DIFFERENTIAL_COUNT,
	seeds: Object.fromEntries(
		[...reports].map(([seed, report]) => [seed, to_differential_sides(report)])
	)
});

/** The text of the file: a case to a line, so a diff of it is of the cases that moved. */
export const format_differential_sides = (sides: DifferentialSides): string => {
	const seeds = Object.entries(sides.seeds).map(
		([seed, cases]) =>
			`\t\t${JSON.stringify(seed)}: {\n` +
			Object.entries(cases)
				.map(([n, held]) => `\t\t\t${JSON.stringify(n)}: ${JSON.stringify(held)}`)
				.join(',\n') +
			'\n\t\t}'
	);
	return `{\n\t"count": ${sides.count},\n\t"seeds": {\n${seeds.join(',\n')}\n\t}\n}\n`;
};

/** Reads the file, or `null` when there is none. */
export const read_differential_sides = async (): Promise<string | null> => {
	try {
		return await readFile(sides_path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
};

/**
 * Regenerates the file.
 *
 * @returns whether it was written, which it is only when it changed
 */
export const update_differential_sides = async (): Promise<boolean> => {
	const text = format_differential_sides(measure_differential_sides());
	if ((await read_differential_sides()) === text) return false;
	await writeFile(sides_path, text);
	return true;
};

/**
 * The cases of `report` that are on another side than `held` has them, that
 * give another result with neither, or that one of the two lacks, each as a
 * line that shows the case.
 */
export const find_moved_differential_sides = (
	report: DifferentialReport,
	held: DifferentialSidesOfSeed | undefined
): Array<string> => {
	// what the file holds of each case: its side, and with neither, the digest after it
	const was: Map<number, string> = new Map(
		Object.entries(held ?? {}).map(([n, before]) => [Number(n), before])
	);
	const side_of = (before: string): string => before.split(' ', 1)[0]!;
	const moved: Array<string> = [];
	for (const { n, side, text, ours } of report.sided) {
		const before = was.get(n);
		was.delete(n);
		if (before === held_as(side, ours)) continue;
		moved.push(
			before !== undefined && side_of(before) === side
				? `case ${n}, with neither, gives another result, ${ours}: ${text}`
				: `case ${n}, ${before === undefined ? 'no disagreement' : side_of(before)} → ${side}, giving ${ours}: ${text}`
		);
	}
	for (const [n, before] of was) moved.push(`case ${n}, ${side_of(before)} → no disagreement`);
	return moved;
};
