import { assert, describe, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;

/** Every source file under a directory of `src/`, as paths relative to `src/`. */
const list_files = (dir: string): Array<string> =>
	readdirSync(join(SRC, dir), { recursive: true, encoding: 'utf8' })
		.filter((file) => /\.(ts|svelte)$/.test(file))
		.map((file) => join(dir, file));

/**
 * The module specifiers a file loads at runtime: every static import and
 * `export … from` but the type-only ones, and every dynamic import. A type
 * written as `import('…')` reads as a dynamic import here, which errs on the
 * side of catching too much.
 */
const to_runtime_imports = (file: string): Array<string> => {
	const source = readFileSync(join(SRC, file), 'utf8');
	return [
		...source.matchAll(/^\s*import\s+(?!type\b)(?:[^'"`]*?\bfrom\s+)?['"`]([^'"`]+)['"`]/gm),
		...source.matchAll(/^\s*export\s+(?!type\b)[^'"`;]*?\bfrom\s+['"`]([^'"`]+)['"`]/gm),
		...source.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g)
	].map((match) => match[1]!);
};

/** Every module specifier a file names at all, type-only ones included. */
const to_imports = (file: string): Array<string> => {
	const source = readFileSync(join(SRC, file), 'utf8');
	return [
		...source.matchAll(/\bfrom\s+['"`]([^'"`]+)['"`]/g),
		...source.matchAll(/\bimport\s*\(?\s*['"`]([^'"`]+)['"`]/g)
	].map((match) => match[1]!);
};

const ROUTE_FILES = list_files('routes');
const LIB_FILES = list_files('lib');

/** The modules that only a server load runs, at build time. */
const is_server_only = (file: string): boolean => file.endsWith('.server.ts');

/** The one module of the benchmarks the site may name: the schema of the file it renders. */
const RESULTS_SCHEMA = /\/benchmarks\/results_schema\.ts$/;

describe('what the site and the library import', () => {
	test('the runtime imports of a file include its dynamic imports and its re-exports', () => {
		const dir = mkdtempSync(join(tmpdir(), 'site_imports_'));
		try {
			writeFileSync(
				join(dir, 'probe.ts'),
				[
					"import type { A } from './type_only.ts';",
					"import { b } from './static.ts';",
					"import './side_effect.ts';",
					"export { c } from './reexport.ts';",
					"export type { D } from './type_reexport.ts';",
					"export const e = (): Promise<unknown> => import('./dynamic.ts');"
				].join('\n')
			);
			const probe = relative(SRC, join(dir, 'probe.ts'));
			assert.deepStrictEqual(to_runtime_imports(probe).sort(), [
				'./dynamic.ts',
				'./reexport.ts',
				'./side_effect.ts',
				'./static.ts'
			]);
			assert.includeMembers(to_imports(probe), [
				'./type_only.ts',
				'./type_reexport.ts',
				'./static.ts'
			]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test('finds the files and their imports', () => {
		assert.include(ROUTE_FILES, 'routes/docs/benchmarks/+page.svelte');
		assert.include(ROUTE_FILES, 'routes/docs/benchmarks/site_benchmarks.server.ts');
		assert.include(
			to_runtime_imports('routes/docs/benchmarks/site_benchmarks.server.ts'),
			'../../../benchmarks/results_schema.ts'
		);
		assert.include(
			to_imports('routes/docs/benchmarks/benchmark_sections.ts'),
			'../../../benchmarks/results_schema.ts'
		);
		assert.notInclude(
			to_runtime_imports('routes/docs/benchmarks/benchmark_sections.ts'),
			'../../../benchmarks/results_schema.ts'
		);
	});

	test('the library imports nothing of the benchmarks or the site', () => {
		for (const file of LIB_FILES) {
			for (const specifier of to_imports(file)) {
				assert.notMatch(specifier, /benchmarks\/|routes\/|#routes/, `${file}: ${specifier}`);
			}
		}
	});

	test('the site names nothing of the benchmarks but the results schema', () => {
		let named = 0;
		for (const file of ROUTE_FILES) {
			for (const specifier of to_imports(file)) {
				if (!specifier.startsWith('.')) continue;
				// where the specifier leads, relative to `src/`: a route's own modules are in
				// `routes/docs/benchmarks/`, which is not `benchmarks/`
				const target = join(dirname(file), specifier);
				if (!target.startsWith('benchmarks/')) continue;
				named++;
				assert.strictEqual(target, 'benchmarks/results_schema.ts', `${file}: ${specifier}`);
			}
		}
		assert.isAbove(named, 0);
	});

	test('only a server load loads the schema, a results file, or the fixture', () => {
		for (const file of ROUTE_FILES) {
			if (is_server_only(file)) continue;
			const source = readFileSync(join(SRC, file), 'utf8');
			assert.notMatch(source, /fixture_run|node:fs/, file);
			for (const specifier of to_runtime_imports(file)) {
				assert.notMatch(specifier, RESULTS_SCHEMA, `${file}: ${specifier}`);
				assert.notMatch(
					specifier,
					/\.server\.ts$|\/test\/|#lib\/schema\.ts/,
					`${file}: ${specifier}`
				);
				// `virtual:pkg.json` is a build-time module, not a file
				assert.ok(
					specifier.startsWith('virtual:') || !specifier.endsWith('.json'),
					`${file}: ${specifier}`
				);
			}
		}
	});

	test('a server-only module is imported at runtime only by a server load or another one', () => {
		for (const file of ROUTE_FILES) {
			if (is_server_only(file)) continue;
			for (const specifier of to_runtime_imports(file)) {
				assert.notMatch(specifier, /\.server(\.ts)?$/, `${file}: ${specifier}`);
			}
		}
		// the loads are where the file is read
		for (const load of [
			'routes/+layout.server.ts',
			'routes/+page.server.ts',
			'routes/docs/benchmarks/+page.server.ts'
		]) {
			assert.ok(
				to_runtime_imports(load).some((specifier) =>
					specifier.endsWith('site_benchmarks.server.ts')
				),
				load
			);
		}
	});
});
