/**
 * The committed snapshot of this library's bundle sizes, `sizes.json`: what
 * it holds, and how it is measured, read, and written. A change's diff of the
 * file is what the change costs in bytes, across the library.
 *
 * `gro task src/benchmarks/update_sizes.task.ts` regenerates the file, and
 * `src/test/sizes.test.ts` fails when it is stale.
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB } from './libs.ts';
import { measure_bundle_size, measure_library_sizes, type ExportSize } from './bundle_size.ts';

const SIZES_PATH = fileURLToPath(new URL('./sizes.json', import.meta.url));

/** The contents of `sizes.json`, every figure in minified and gzipped bytes. */
export interface Sizes {
	/** Each scenario's bundle. */
	scenarios: Record<string, number>;
	/** Every scenario bundled together. */
	all: number;
	/** Valibot's bundle of every scenario together. */
	valibot_all: number;
	/** Each scenario's bundle over Valibot's, which the backstop of `docs/grading.md` is read on. */
	vs_valibot: Record<string, number>;
	/** `parse` alone. */
	parse: number;
	/** Every runtime export of `schema.ts` together. */
	library: number;
	/** Each export's `last_in` and `alone`, see `ExportSize`, by name. */
	exports: Record<string, Omit<ExportSize, 'name'>>;
	/** What each module beside `schema.ts` adds to `library`. */
	modules: Record<string, number>;
}

/**
 * Measures what `sizes.json` holds, of the working tree.
 */
export const measure_sizes = async (): Promise<Sizes> => {
	const names = SCENARIOS.map((s) => s.name);
	const [scenarios, valibot, all, valibot_all, library] = await Promise.all([
		Promise.all(names.map((name) => measure_bundle_size('fuz_schema', [name]))),
		Promise.all(names.map((name) => measure_bundle_size(BASELINE_LIB, [name]))),
		measure_bundle_size('fuz_schema', names),
		measure_bundle_size(BASELINE_LIB, names),
		measure_library_sizes()
	]);
	return {
		scenarios: Object.fromEntries(names.map((name, i) => [name, scenarios[i]!.gzip])),
		all: all.gzip,
		valibot_all: valibot_all.gzip,
		vs_valibot: Object.fromEntries(
			names.map((name, i) => [name, Number((scenarios[i]!.gzip / valibot[i]!.gzip).toFixed(4))])
		),
		parse: library.parse,
		library: library.library,
		exports: Object.fromEntries(
			library.exports
				.map((e): [string, Omit<ExportSize, 'name'>] => [
					e.name,
					{ last_in: e.last_in, alone: e.alone }
				])
				.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		),
		modules: Object.fromEntries(library.modules.map((m) => [m.name, m.added]))
	};
};

/** The text of `sizes.json`. */
export const format_sizes = (sizes: Sizes): string => JSON.stringify(sizes, null, '\t') + '\n';

/**
 * Reads `sizes.json`.
 *
 * @returns its text, or `null` when there is no file
 */
export const read_sizes = async (): Promise<string | null> => {
	try {
		return await readFile(SIZES_PATH, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
};

/**
 * Writes `sizes.json` when what the working tree measures differs from it.
 *
 * @returns whether it was written
 */
export const update_sizes = async (): Promise<boolean> => {
	const text = format_sizes(await measure_sizes());
	if ((await read_sizes()) === text) return false;
	await writeFile(SIZES_PATH, text);
	return true;
};
