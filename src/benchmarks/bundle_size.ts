/**
 * Bundles a library's scenarios and measures the result.
 *
 * @module
 */

import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const ENTRY_ID = 'virtual:entry';
const SCHEMA_ID = '#lib/schema.ts';

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
	const bundle = await rolldown({
		input: ENTRY_ID,
		platform: 'browser',
		logLevel: 'silent',
		plugins: [
			{
				name: 'virtual_entry',
				resolveId: (id) =>
					id === ENTRY_ID ? id : id === SCHEMA_ID && schema_path ? schema_path : null,
				load: (id) => (id === ENTRY_ID ? entry : null)
			}
		]
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	if (output.length !== 1) throw new Error(`expected one chunk for ${lib}, got ${output.length}`);
	return output[0].code;
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
