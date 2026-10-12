/**
 * What the cold-start and retained-heap benchmarks share: the entries a
 * measured process imports, and running that process.
 *
 * A measured process is a generated module that holds one scenario and
 * nothing of the harness, so its time and memory are the library's. The
 * method follows syntax-highlighter-bench's cold-start and retained-heap
 * harnesses.
 *
 * **Two forms of entry.** `bundled` is the minified chunk a bundler makes of
 * one scenario, what a web page loads. `unbundled` is the library module
 * with its types stripped, importing its package from `node_modules`, so Node
 * resolves and loads every file the package reaches, as a server without a
 * bundler does.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build_scenario_bundle } from './bundle_size.ts';

/**
 * Where generated modules are written: under `node_modules`, so an unbundled
 * entry's bare specifiers resolve as they do from anywhere in this repo, and
 * no tool of the repo sweeps the files.
 */
export const CHILD_DIR = fileURLToPath(
	new URL('../../node_modules/.cache/fuz_schema/', import.meta.url)
);

export const ENTRY_FORMS = ['bundled', 'unbundled'] as const;
export type EntryForm = (typeof ENTRY_FORMS)[number];

const CHILD_TIMEOUT_MS = 60_000;

/**
 * Writes `content` to `path` unless it already holds it, by rename so a
 * process never reads half a file.
 */
export const write_if_changed = (path: string, content: string): void => {
	if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
	mkdirSync(dirname(path), { recursive: true });
	const temp_path = `${path}.${process.pid}.tmp`;
	writeFileSync(temp_path, content);
	renameSync(temp_path, path);
};

const strip_types = (path: string): string => stripTypeScriptTypes(readFileSync(path, 'utf8'));

/**
 * Another version of this repo's library to build an entry against, for
 * measuring a change.
 */
export interface EntryVariant {
	/** Names the variant in file paths, lowercase with no separators. */
	id: string;
	/** The file `#lib/schema.ts` resolves to. */
	schema_path: string;
}

/**
 * Writes the entry module a measured process imports and returns its path.
 * The entry exports the scenario's `scenario_<name>` factory.
 *
 * @param lib - basename of a module in `libs/`
 * @param variant - builds against another version of this repo's library
 */
export const prepare_entry = async (
	lib: string,
	scenario: string,
	form: EntryForm,
	variant?: EntryVariant
): Promise<string> => {
	const name = variant ? `${lib}.${variant.id}` : lib;
	if (form === 'bundled') {
		const path = join(CHILD_DIR, 'bundled', name, `${scenario}.mjs`);
		write_if_changed(
			path,
			await build_scenario_bundle(lib, [scenario], {
				call: false,
				schema_path: variant?.schema_path
			})
		);
		return path;
	}
	const path = join(CHILD_DIR, 'unbundled', `${name}.mjs`);
	let source = strip_types(fileURLToPath(new URL(`./libs/${lib}.ts`, import.meta.url)));
	if (source.includes('#lib/schema.ts')) {
		// this repo's own library has no built output, so its stripped source stands in for one
		const schema_name = variant ? `schema.lib.${variant.id}.mjs` : 'schema.lib.mjs';
		write_if_changed(
			join(CHILD_DIR, 'unbundled', schema_name),
			strip_types(
				variant?.schema_path ?? fileURLToPath(new URL('../lib/schema.ts', import.meta.url))
			)
		);
		source = source.replace('#lib/schema.ts', `./${schema_name}`);
	}
	write_if_changed(path, source);
	return path;
};

/**
 * The environment of a measured process: this one's, with V8's compile cache
 * off. With the cache a second process would not compile what it loads, and
 * would not be cold.
 */
export const to_child_env = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
	const { NODE_COMPILE_CACHE: _, ...rest } = env;
	return { ...rest, NODE_DISABLE_COMPILE_CACHE: '1' };
};

/**
 * The lines that end a generated module: print `fields` as one line of JSON
 * and exit once it is written, whatever handle the library left open.
 *
 * @param fields - source text of an object literal's properties
 */
export const to_child_report_source = (fields: Array<string>): Array<string> => [
	'process.stdout.write(',
	`\tJSON.stringify({ ${fields.join(', ')} }) + '\\n',`,
	'\t(error) => process.exit(error ? 1 : 0)',
	');',
	''
];

/**
 * Runs a generated module in a fresh Node process and returns the JSON it printed.
 *
 * @param flags - node flags, none for a process that should be a consumer's
 * @throws Error when the process fails, is killed, or prints anything but one line of JSON
 */
export const run_child = (path: string, flags: ReadonlyArray<string> = []): unknown => {
	const child = spawnSync(process.execPath, [...flags, path], {
		env: to_child_env(process.env),
		encoding: 'utf8',
		timeout: CHILD_TIMEOUT_MS
	});
	if (child.error) throw new Error(`${path}: ${child.error.message}`);
	if (child.status !== 0) {
		throw new Error(`${path}: exited with ${child.status ?? child.signal}\n${child.stderr}`);
	}
	try {
		return JSON.parse(child.stdout);
	} catch {
		throw new Error(`${path}: printed something other than one line of JSON:\n${child.stdout}`);
	}
};
