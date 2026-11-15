/**
 * What the benchmarks that measure in processes share: the entries a
 * cold-start or retained-heap process imports, and running a process.
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
 * bundler does. This repo's library is then its built `dist/schema.js`, what
 * the package publishes, with `dist/compile.js` beside it for the module that
 * compiles, and a version given as a variant is its `schema.ts` with the types
 * stripped, there being no build of it.
 *
 * @module
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// Node warns once a process that `stripTypeScriptTypes` is experimental, on
// stderr between a script's tables. That one warning is dropped, by its type and
// its text, and every other goes on as it would.
const strip_types = (path: string): string => {
	const emit_warning = process.emitWarning;
	process.emitWarning = function (this: unknown, warning: string | Error, ...rest: Array<any>) {
		const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
		if (type === 'ExperimentalWarning' && String(warning).includes('stripTypeScriptTypes')) return;
		(emit_warning as (...args: Array<any>) => void).call(this, warning, ...rest);
	} as typeof process.emitWarning;
	try {
		return stripTypeScriptTypes(readFileSync(path, 'utf8'));
	} finally {
		process.emitWarning = emit_warning;
	}
};

const LIB_DIR = fileURLToPath(new URL('../lib/', import.meta.url));
const DIST_DIR = fileURLToPath(new URL('../../dist/', import.meta.url));

/**
 * The modules of this library a library module in `libs/` imports, by the
 * specifier it imports each by, each with its name in `src/lib/` and in the
 * build: `schema.ts`, and `compile.ts` for the library compiled.
 */
export const BUILT_LIB_MODULES: Readonly<Record<string, string>> = {
	'#lib/schema.ts': 'schema',
	'#lib/compile.ts': 'compile'
};

// A file of the build, or the script says to build it and exits, which is no
// error of the harness. A build writes every module, so a file older than the
// source of any of them is of a build before a change.
const to_built_path = (file: string, reader: string): string => {
	const path = DIST_DIR + file;
	const built = existsSync(path) && statSync(path).mtimeMs;
	const newer =
		built &&
		Object.values(BUILT_LIB_MODULES).find(
			(module) => built < statSync(`${LIB_DIR}${module}.ts`).mtimeMs
		);
	if (!built || newer) {
		console.error(
			`${reader} the built \`dist/${file}\`, which is ${newer ? `older than \`src/lib/${newer}.ts\`` : 'missing'}: ` +
				'run `gro build` first'
		);
		process.exit(1);
	}
	return path;
};

/**
 * A built module of the library, `dist/<module>.js`, which an unbundled entry
 * of the working tree's library loads, as a consumer's server does the
 * published package. When it is missing or older than `src/lib/schema.ts` or
 * `src/lib/compile.ts` the script says to build it and exits, which is no
 * error of the harness.
 *
 * @param module - a value of `BUILT_LIB_MODULES`
 */
export const to_built_module_path = (module: string): string =>
	to_built_path(`${module}.js`, 'the unbundled entry loads');

/**
 * The built declarations of a module of the library, `dist/<module>.d.ts`,
 * what a consumer's compiler reads of it, which the type benchmark checks this
 * library against, as it checks every other library against its declarations.
 * Missing or older than `src/lib/schema.ts` or `src/lib/compile.ts`, the
 * script says to build it and exits.
 *
 * @param module - a value of `BUILT_LIB_MODULES`
 */
export const to_built_declarations_path = (module: string): string =>
	to_built_path(`${module}.d.ts`, 'the type benchmark reads');

/**
 * Another version of this repo's library to build an entry against, for
 * measuring a change.
 */
export interface EntryVariant {
	/** Names the variant in file paths, lowercase with no separators. */
	id: string;
	/** The file `#lib/schema.ts` resolves to. */
	schema_path: string;
	/** The scenario module written for that version, when its API differs. */
	lib_path?: string;
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
				schema_path: variant?.schema_path,
				lib_path: variant?.lib_path
			})
		);
		return path;
	}
	const path = join(CHILD_DIR, 'unbundled', `${name}.mjs`);
	let source = strip_types(
		variant?.lib_path ?? fileURLToPath(new URL(`./libs/${lib}.ts`, import.meta.url))
	);
	// this repo's own library is its build, and a variant, which has none, its stripped source
	for (const [specifier, module] of Object.entries(BUILT_LIB_MODULES)) {
		if (!source.includes(specifier)) continue;
		let built_specifier: string;
		if (!variant) {
			built_specifier = pathToFileURL(to_built_module_path(module)).href;
		} else if (module === 'schema') {
			const schema_name = `schema.lib.${variant.id}.mjs`;
			write_if_changed(join(CHILD_DIR, 'unbundled', schema_name), strip_types(variant.schema_path));
			built_specifier = `./${schema_name}`;
		} else {
			// a variant is a version of `schema.ts` alone, and a module beside it imports the working tree's
			throw new Error(`${lib} imports ${specifier}, which a variant of the library has none of`);
		}
		source = source.replaceAll(specifier, built_specifier);
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

export interface StartChildOptions {
	/** Node flags, none for a process that should be a consumer's. */
	flags?: ReadonlyArray<string>;
	/** What follows the module's path on the command line. */
	args?: ReadonlyArray<string>;
	/** The process's environment, this one's when left out. */
	env?: NodeJS.ProcessEnv;
	/** Names the process in an error, its path when left out. */
	label?: string;
	/**
	 * The milliseconds after which the process is killed, `START_CHILD_TIMEOUT_MS`
	 * when left out: far more than a healthy one takes.
	 */
	timeout_ms?: number;
}

/**
 * How long `start_child` gives a process by default, in milliseconds. It is a
 * bound on a process that hangs, not on one that measures: no healthy process
 * of a benchmark comes near it.
 */
export const START_CHILD_TIMEOUT_MS = 30 * 60_000;

// the processes `start_child` has started and not yet seen close
const started_children: Set<ChildProcess> = new Set();

let is_watching_exit = false;

// A process started here is killed when this one exits, whether it ends, throws
// with others still running, or is told to stop. A signal with a listener no
// longer ends the process, so the listener exits, which runs the `exit`
// listeners.
const kill_children_on_exit = (): void => {
	if (is_watching_exit) return;
	is_watching_exit = true;
	process.on('exit', () => {
		for (const child of started_children) child.kill('SIGKILL');
	});
	process.once('SIGINT', () => process.exit(130));
	process.once('SIGTERM', () => process.exit(143));
};

/**
 * Starts a module in a fresh Node process and resolves to the JSON it printed,
 * without blocking this one, so processes that are not timed can run several
 * at once. The process gets none of this one's node flags. It is killed when
 * it outlasts `options.timeout_ms`, and when this process exits or is sent
 * `SIGINT` or `SIGTERM`.
 *
 * @throws Error when the process fails, is killed, outlasts its timeout, or prints anything but JSON
 */
export const start_child = (path: string, options: StartChildOptions = {}): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const {
			flags = [],
			args = [],
			env,
			label = path,
			timeout_ms = START_CHILD_TIMEOUT_MS
		} = options;
		kill_children_on_exit();
		const child = spawn(process.execPath, [...flags, path, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env
		});
		started_children.add(child);
		let timed_out = false;
		const timeout = setTimeout(() => {
			timed_out = true;
			child.kill('SIGKILL');
		}, timeout_ms);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', (error) => {
			clearTimeout(timeout);
			started_children.delete(child);
			reject(error);
		});
		child.on('close', (code, signal) => {
			clearTimeout(timeout);
			started_children.delete(child);
			if (timed_out) {
				reject(
					new Error(`${label}: killed after ${Math.round(timeout_ms / 1000)}s without finishing`)
				);
				return;
			}
			if (code !== 0) {
				reject(new Error(`${label}: exited with ${code ?? signal}\n${stderr}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch {
				reject(new Error(`${label}: printed other than JSON:\n${stdout}`));
			}
		});
	});

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
