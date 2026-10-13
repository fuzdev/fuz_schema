/**
 * Bundles a library's scenarios, and this library's exports, and measures the
 * result.
 *
 * @module
 */

import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const ENTRY_ID = 'virtual:entry';
const SCHEMA_ID = '#lib/schema.ts';
const LIB_DIR = fileURLToPath(new URL('../lib/', import.meta.url));
const SCHEMA_PATH = `${LIB_DIR}schema.ts`;

/** The library's modules beside `schema.ts`, each a cost a consumer opts into. */
export const LIBRARY_MODULES = ['meta.ts', 'standard_schema.ts', 'schema_json.ts'];

export interface BundleSize {
	minified: number;
	gzip: number;
}

export interface BuildScenarioBundleOptions {
	/**
	 * Whether the entry calls the factories (what a page that uses the schemas
	 * ships) or only exports them (what a process that wants to time the calls
	 * itself imports).
	 */
	call?: boolean;
	/** A file to resolve `#lib/schema.ts` to, for building against another version of it. */
	schema_path?: string;
	/**
	 * A file to use as the library's scenario module. Another version of the
	 * library may have another API, so it needs the scenario module written for it.
	 */
	lib_path?: string;
}

/**
 * Measures the code of a bundle.
 */
export const to_bundle_size = (code: string): BundleSize => ({
	minified: Buffer.byteLength(code),
	gzip: gzipSync(code, { level: 9 }).length
});

/**
 * Bundles and minifies the module `entry` is the source of.
 *
 * @param entry - the source of the entry module
 * @param schema_path - a file to resolve `#lib/schema.ts` to, by default the working tree's
 * @param label - names the bundle in the error when it isn't one chunk
 * @returns the code of the one chunk
 */
export const build_bundle = async (
	entry: string,
	schema_path: string = SCHEMA_PATH,
	label = 'the entry'
): Promise<string> => {
	const bundle = await rolldown({
		input: ENTRY_ID,
		platform: 'browser',
		logLevel: 'silent',
		plugins: [
			{
				name: 'virtual_entry',
				resolveId: (id) => (id === ENTRY_ID ? id : id === SCHEMA_ID ? schema_path : null),
				load: (id) => (id === ENTRY_ID ? entry : null)
			}
		]
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	if (output.length !== 1) throw new Error(`expected one chunk for ${label}, got ${output.length}`);
	return output[0].code;
};

/**
 * Bundles and minifies an entry that imports the named scenario factories
 * from one library module, so the bundle holds the schemas' definitions plus
 * whatever library code they reach after tree shaking.
 *
 * @param lib - basename of a module in `libs/`
 * @returns the code of the one chunk
 */
export const build_scenario_bundle = async (
	lib: string,
	scenario_names: Array<string>,
	options: BuildScenarioBundleOptions = {}
): Promise<string> => {
	const { call = true, schema_path } = options;
	const lib_path = options.lib_path ?? fileURLToPath(new URL(`./libs/${lib}.ts`, import.meta.url));
	const names = scenario_names.map((n) => `scenario_${n}`);
	const entry = call
		? `import {${names.join(', ')}} from ${JSON.stringify(lib_path)};
export const runners = [${names.map((n) => `${n}()`).join(', ')}];`
		: `export {${names.join(', ')}} from ${JSON.stringify(lib_path)};`;
	return build_bundle(entry, schema_path, lib);
};

/**
 * Measures the bundle `build_scenario_bundle` builds with the factories called.
 *
 * @param lib - basename of a module in `libs/`
 */
export const measure_bundle_size = async (
	lib: string,
	scenario_names: Array<string>,
	options: Pick<BuildScenarioBundleOptions, 'schema_path' | 'lib_path'> = {}
): Promise<BundleSize> => {
	return to_bundle_size(await build_scenario_bundle(lib, scenario_names, options));
};

/**
 * Measures every runtime export of a version of `schema.ts` bundled together:
 * the whole library, as no consumer has it.
 *
 * @param schema_path - the version's file, by default the working tree's
 */
export const measure_library_size = async (schema_path?: string): Promise<BundleSize> =>
	to_bundle_size(await build_bundle(`export * from '${SCHEMA_ID}';`, schema_path, 'the library'));

/** What one export of `schema.ts` costs, in bytes of one of `BundleSize`'s measures. */
export interface ExportSize {
	name: string;
	/** A bundle of `parse` and the export, less one of `parse`. */
	alone: number;
	/**
	 * A bundle of every export, less one of every export but it: what it costs
	 * a consumer who has the rest, and so what nothing else shares.
	 */
	last_in: number;
}

export interface LibrarySizes {
	/** A bundle of `parse`, which every other figure of an export has in it. */
	parse: number;
	/** A bundle of every runtime export of `schema.ts`. */
	library: number;
	/** Every runtime export but `parse`, the largest `last_in` first, then by name. */
	exports: Array<ExportSize>;
	/** What every export of each of `LIBRARY_MODULES` adds to `library`. */
	modules: Array<{ name: string; added: number }>;
}

/**
 * Measures this library export by export, in the working tree: every bundle
 * is built at once.
 */
export const measure_library_sizes = async (
	metric: keyof BundleSize = 'gzip'
): Promise<LibrarySizes> => {
	const names = Object.keys(await import(SCHEMA_PATH)).filter((n) => n !== 'parse');
	const measure = async (entry: string): Promise<number> =>
		to_bundle_size(await build_bundle(entry))[metric];
	const measure_exports = (list: Array<string>): Promise<number> =>
		measure(`export {${['parse', ...list].join(', ')}} from '${SCHEMA_ID}';`);
	const [parse, library, alone, without, modules] = await Promise.all([
		measure_exports([]),
		measure_exports(names),
		Promise.all(names.map((name) => measure_exports([name]))),
		Promise.all(names.map((name) => measure_exports(names.filter((n) => n !== name)))),
		Promise.all(
			LIBRARY_MODULES.map((name) =>
				measure(`export * from '${SCHEMA_ID}';\nexport * from ${JSON.stringify(LIB_DIR + name)};`)
			)
		)
	]);
	return {
		parse,
		library,
		exports: names
			.map((name, i) => ({ name, alone: alone[i]! - parse, last_in: library - without[i]! }))
			.sort((a, b) => b.last_in - a.last_in || (a.name < b.name ? -1 : 1)),
		modules: LIBRARY_MODULES.map((name, i) => ({ name, added: modules[i]! - library }))
	};
};
