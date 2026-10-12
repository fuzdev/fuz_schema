/**
 * Type-checking cost: what each library's scenario module costs `tsc`.
 *
 * Runs the compiler once per library over just that module and reads its
 * extended diagnostics. Instantiations is the steadiest signal of how hard a
 * library's types make the checker work; check time is noisier but is what an
 * editor feels. The scenarios are small, so this ranks libraries, it doesn't
 * predict a large codebase.
 *
 * Usage:
 *   gro run src/benchmarks/types.ts
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { format_table } from './measure.ts';

// not imported from `libs.ts`, which would load every library just to list them
const LIB_NAMES = ['fuz_schema', 'valibot', 'zod', 'zod_mini', 'typebox', 'arktype'];

const METRICS = ['Instantiations', 'Types', 'Memory used', 'Check time'];

const dir = resolve('.gro/types');
mkdirSync(dir, { recursive: true });

// what the compiler costs before it sees any library
const EMPTY = 'empty';
writeFileSync(resolve(dir, 'empty.ts'), 'export {};\n');

const measure = (name: string, file: string): Array<string> => {
	const tsconfig_path = resolve(dir, `tsconfig.${name}.json`);
	writeFileSync(
		tsconfig_path,
		JSON.stringify({
			extends: resolve('tsconfig.json'),
			// the config sits outside the sources, and `rootDir` defaults to its directory
			compilerOptions: { rootDir: resolve('.') },
			include: [],
			files: [file]
		})
	);
	let output: string;
	try {
		output = execFileSync(
			resolve('node_modules/.bin/tsc'),
			['-p', tsconfig_path, '--noEmit', '--extendedDiagnostics'],
			{ encoding: 'utf8' }
		);
	} catch (error) {
		// a type error would skew the figures, so it stops the run
		const { stdout } = error as { stdout?: unknown };
		throw new Error(`tsc failed on ${name}:\n${typeof stdout === 'string' ? stdout : ''}`);
	}
	return METRICS.map((metric) => new RegExp(`^${metric}:\\s+(.+)$`, 'm').exec(output)?.[1] ?? '?');
};

const rows = [
	['lib', ...METRICS.map((m) => m.toLowerCase())],
	[EMPTY, ...measure(EMPTY, resolve(dir, 'empty.ts'))],
	...LIB_NAMES.map((name) => [name, ...measure(name, resolve(`src/benchmarks/libs/${name}.ts`))])
];

console.log('\ntype-checking cost of each scenario module\n');
console.log(format_table(rows));
