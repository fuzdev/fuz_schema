/**
 * Type-checking cost: what each library's scenario module costs `tsc`, and
 * what a consumer's reads of the types its schemas infer cost on top.
 *
 * Runs the compiler over one file per library and reads its extended
 * diagnostics, twice for each library: its scenario module in `libs/`, and a
 * file that reads properties of the types its schemas module in
 * `libs/schemas/` infers, `ScenarioTypes`, as a consumer's code reads a value
 * of `Infer<typeof Schema>`. Instantiations is the steadiest signal of how
 * hard a library's types make the checker work, and is the same on every run;
 * check time is what an editor feels and moves from run to run, so it is the
 * median of `--runs` runs. The scenarios are small, so this ranks libraries,
 * it doesn't predict a large codebase.
 *
 * **This library as a consumer's compiler reads it.** Every other library is
 * read from the declarations it publishes, so this one is too: its modules are
 * checked against the built `dist/schema.d.ts`, through copies whose import of
 * `#lib/schema.ts` is the build, and the script refuses to run when the build
 * is missing or older than `src/lib/schema.ts`. Its source would have `tsc`
 * check the library's function bodies as well, which no consumer pays.
 *
 * Usage:
 *   gro run src/benchmarks/types.ts
 *   gro run src/benchmarks/types.ts --lib fuz_schema --lib valibot --runs 5
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LibNamesArg, meta, parse_args, s, to_count_arg } from './args.ts';
import { to_built_schema_declarations_path } from './child.ts';
import { LIB_NAMES } from './lib_names.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import { format_table, median } from './measure.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	lib: meta(
		s.with_default_fn(LibNamesArg, () => [...LIB_NAMES]),
		{ description: 'library names to check' }
	),
	runs: meta(to_count_arg(3), {
		description: 'times each file is checked, the median check time is reported'
	})
});

const args = parse_args(Args);

const declarations_path = to_built_schema_declarations_path();

console.log(format_benchmark_header([...COMPARED_LIB_PACKAGES, 'typescript']));

const METRICS = ['Instantiations', 'Types', 'Memory used', 'Check time'];

const dir = resolve('.gro/types');
mkdirSync(dir, { recursive: true });

// what the compiler costs before it sees any library
const EMPTY = 'empty';
writeFileSync(resolve(dir, 'empty.ts'), 'export {};\n');

const BENCHMARKS_DIR = resolve('src/benchmarks');

// the reads a consumer makes of what the schemas infer, one of each scenario typed by its schema
const READS = [
	't.string.length',
	't.object_flat.name',
	't.object_flat.role',
	't.strict_nested.address.city',
	't.strict_nested.tags[0]',
	't.pipe.slug',
	't.union[0]',
	't.list[0]?.email'
];

/**
 * The file `tsc` checks for a module: the module itself, or for this library
 * a copy whose `#lib/schema.ts` is the build's declarations and whose relative
 * imports are absolute.
 */
const to_checked_module = (lib: string, path: string, name: string): string => {
	if (lib !== 'fuz_schema') return path;
	const source = readFileSync(path, 'utf8')
		.replaceAll("'#lib/schema.ts'", JSON.stringify(declarations_path.replace(/\.d\.ts$/, '.js')))
		.replace(/'(\.\.?\/[^']+)'/g, (_, relative: string) =>
			JSON.stringify(resolve(path, '..', relative))
		);
	const copy = resolve(dir, `${name}.ts`);
	writeFileSync(copy, source);
	return copy;
};

// a file that reads a library's inferred types as a consumer does
const to_reads_file = (lib: string): string => {
	const schemas = to_checked_module(
		lib,
		resolve(BENCHMARKS_DIR, 'libs/schemas', `${lib}.ts`),
		`${lib}.schemas`
	);

	const path = resolve(dir, `${lib}.reads.ts`);
	writeFileSync(
		path,
		`import type { ScenarioTypes } from ${JSON.stringify(schemas)};\n\n` +
			'declare const t: ScenarioTypes;\n\n' +
			`export const reads = [\n\t${READS.join(',\n\t')}\n];\n`
	);
	return path;
};

const check = (name: string, file: string): Map<string, string> => {
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
	return new Map(
		METRICS.map((metric) => [
			metric,
			new RegExp(`^${metric}:\\s+(.+)$`, 'm').exec(output)?.[1] ?? '?'
		])
	);
};

// every run's figures, the check time the median of the runs, and every other
// figure the first run's, the instantiations checked to be the same in every run
const measure = (name: string, file: string): Array<string> => {
	const runs = Array.from({ length: args.runs }, () => check(name, file));
	const instantiations = new Set(runs.map((run) => run.get('Instantiations')));
	if (instantiations.size > 1) {
		throw new Error(
			`${name}: the instantiations differ between runs: ${[...instantiations].join(', ')}`
		);
	}
	const times = runs.map((run) => Number.parseFloat(run.get('Check time')!));
	return METRICS.map((metric) =>
		metric === 'Check time' ? `${median(times).toFixed(2)}s` : runs[0]!.get(metric)!
	);
};

const header = ['lib', ...METRICS.map((m) => m.toLowerCase())];
const empty = [EMPTY, ...measure(EMPTY, resolve(dir, 'empty.ts'))];

console.log(
	`\ntype-checking cost of each scenario module, check time the median of ${args.runs} ` +
		`${args.runs === 1 ? 'run' : 'runs'}; this library read from its built declarations\n`
);
console.log(
	format_table([
		header,
		empty,
		...args.lib.map((lib) => [
			lib,
			...measure(lib, to_checked_module(lib, resolve(BENCHMARKS_DIR, 'libs', `${lib}.ts`), lib))
		])
	])
);

console.log(
	"\nthe same of each schemas module with a consumer's reads of the types its schemas infer,\n" +
		`${READS.join(', ')},\nand what the reads add to the instantiations of the schemas module alone\n`
);
console.log(
	format_table([
		[...header.slice(0, 2), 'reads add', ...header.slice(2)],
		[...empty.slice(0, 2), '', ...empty.slice(2)],
		...args.lib.map((lib) => {
			const reads = measure(`${lib}.reads`, to_reads_file(lib));
			const alone = measure(
				`${lib}.schemas`,
				to_checked_module(
					lib,
					resolve(BENCHMARKS_DIR, 'libs/schemas', `${lib}.ts`),
					`${lib}.schemas`
				)
			);
			return [lib, reads[0]!, String(Number(reads[0]) - Number(alone[0])), ...reads.slice(1)];
		})
	])
);
