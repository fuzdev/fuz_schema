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
 * read from the declarations it publishes, so this one is too, as it is
 * imported and compiled: a module that imports `#lib/schema.ts` or
 * `#lib/compile.ts` is checked against the built `dist/schema.d.ts` and
 * `dist/compile.d.ts`, through a copy whose imports of them are the build, and
 * the script refuses to run when the build is missing or older than its
 * source. The source would have `tsc` check the library's function bodies as
 * well, which no consumer pays.
 *
 * **`fuz_schema_compiled` is this library's schemas through `compile.ts`.** Its
 * scenario module calls `compile_parse` on each schema, and its reads are of
 * what the function `compile_parse` returns gives for a match, so its figures
 * are the interpreter's and what the compile's types add.
 *
 * Usage:
 *   gro run src/benchmarks/types.ts
 *   gro run src/benchmarks/types.ts --lib fuz_schema --lib valibot --runs 5
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
	DataArg,
	LibNamesArg,
	meta,
	parse_args,
	s,
	to_count_arg,
	write_benchmark_data
} from './args.ts';
import type { TypeCost } from './results_schema.ts';
import { BUILT_LIB_MODULES, to_built_declarations_path } from './child.ts';
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
	}),
	data: DataArg
});

const args = parse_args(Args);

// what a module of this library is checked against, by the specifier it is imported
// by: the build's module, which `tsc` reads the declarations beside. Each is asked
// for here, so a build that is missing or stale stops the script before it measures.
const built_specifiers: Record<string, string> = Object.fromEntries(
	Object.entries(BUILT_LIB_MODULES).map(([specifier, module]) => [
		specifier,
		to_built_declarations_path(module).replace(/\.d\.ts$/, '.js')
	])
);

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

const LIB_IMPORT_MATCHER = /'(#lib\/[^']+)'/g;

// whether a module imports this repo's library, and so is checked through a copy
const imports_lib = (path: string): boolean => readFileSync(path, 'utf8').includes("'#lib/");

// the name of a module's copy: a library's name, with `.schemas` for its schemas module
const to_copy_name = (path: string): string =>
	basename(path, '.ts') + (basename(dirname(path)) === 'schemas' ? '.schemas' : '');

/**
 * The file `tsc` checks for a module: the module itself, or for a module of
 * this library a copy whose imports of the library are the build's
 * declarations and whose relative imports are absolute. A relative import of
 * another module of this library, as the schemas of the library compiled
 * import the interpreter's, is that module's copy, so both read one build.
 */
const to_checked_module = (path: string): string => {
	if (!imports_lib(path)) return path;
	const source = readFileSync(path, 'utf8')
		.replace(LIB_IMPORT_MATCHER, (_, specifier: string) => {
			const built = built_specifiers[specifier];
			if (!built)
				throw new Error(`${path} imports ${specifier}, which the build has no module for`);
			return JSON.stringify(built);
		})
		.replace(/'(\.\.?\/[^']+)'/g, (_, relative: string) =>
			JSON.stringify(to_checked_module(resolve(path, '..', relative)))
		);
	const copy = resolve(dir, `${to_copy_name(path)}.ts`);
	writeFileSync(copy, source);
	return copy;
};

// a file that reads a library's inferred types as a consumer does
const to_reads_file = (lib: string): string => {
	const schemas = to_checked_module(resolve(BENCHMARKS_DIR, 'libs/schemas', `${lib}.ts`));

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

// what a row of figures holds, as numbers: in the order of `METRICS`, the memory
// in kilobytes with its `K` and the check time in seconds with its `s`
const to_type_cost = (figures: Array<string>): TypeCost => ({
	instantiations: Number(figures[0]),
	types: Number(figures[1]),
	memory_kb: Number.parseInt(figures[2]!, 10),
	check_s: Number.parseFloat(figures[3]!)
});
// every row of both tables, by library, for `--data`
const measured_modules: Record<string, Array<string>> = {};
const measured_reads: Record<string, { reads: Array<string>; alone: Array<string> }> = {};

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
			...(measured_modules[lib] = measure(
				lib,
				to_checked_module(resolve(BENCHMARKS_DIR, 'libs', `${lib}.ts`))
			))
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
				to_checked_module(resolve(BENCHMARKS_DIR, 'libs/schemas', `${lib}.ts`))
			);
			measured_reads[lib] = { reads, alone };
			return [lib, reads[0]!, String(Number(reads[0]) - Number(alone[0])), ...reads.slice(1)];
		})
	])
);

if (args.data !== undefined) {
	// what the tables above were printed from, as numbers
	write_benchmark_data(args.data, 'types', {
		runs: args.runs,
		empty: to_type_cost(empty.slice(1)),
		modules: Object.fromEntries(args.lib.map((lib) => [lib, to_type_cost(measured_modules[lib]!)])),
		reads: READS,
		with_reads: Object.fromEntries(
			args.lib.map((lib) => {
				const { reads, alone } = measured_reads[lib]!;
				return [lib, { ...to_type_cost(reads), reads_add: Number(reads[0]) - Number(alone[0]) }];
			})
		)
	});
}
