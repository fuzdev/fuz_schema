/**
 * Bundle-size benchmark: what each library costs to ship for each scenario.
 *
 * Each measurement bundles an entry that imports one scenario factory from one
 * library module and calls it, so the bundle holds the schema's definition
 * plus whatever library code it reaches after tree shaking. The `all` column
 * bundles every scenario together, showing how the shared cost amortizes.
 *
 * Then this library alone, whole and export by export, see `LibrarySizes`.
 *
 * The scenario table is printed in gzipped bytes, then again in brotli's, which
 * no rule reads and `sizes.json` doesn't keep.
 *
 * Usage:
 *   gro run src/benchmarks/bundle.ts
 *   gro run src/benchmarks/bundle.ts --raw   # minified bytes instead of gzip, and no brotli
 *
 * @module
 */

import { DataArg, meta, parse_args, s, write_benchmark_data } from './args.ts';
import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import {
	build_scenario_bundle,
	measure_library_sizes,
	to_brotli_size,
	to_bundle_size,
	type BundleSize
} from './bundle_size.ts';
import { format_table } from './measure.ts';
import type { BundleSizes } from './results_schema.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	raw: meta(s.with_default(s.boolean, false), {
		description: 'minified bytes in place of gzip, and no brotli table'
	}),
	data: DataArg
});

const { raw, data: data_path } = parse_args(Args);

console.log(format_benchmark_header([...COMPARED_LIB_PACKAGES, 'rolldown']));

const metric: keyof BundleSize = raw ? 'minified' : 'gzip';

const columns = [...SCENARIOS.map((s) => [s.name]), SCENARIOS.map((s) => s.name)];
const headers = [...SCENARIOS.map((s) => s.name), 'all'];

const rows: Array<{ lib: string; sizes: Array<number>; brotli: Array<number> }> = [];
// every measure of every bundle, by library then column, for `--data`
const measured: Record<string, Array<BundleSizes>> = {};
for (const lib of LIBS) {
	const sizes: Array<number> = [];
	const brotli: Array<number> = [];
	measured[lib.name] = [];
	for (const column of columns) {
		const code = await build_scenario_bundle(lib.name, column);
		const size = to_bundle_size(code);
		sizes.push(size[metric]);
		if (!raw) brotli.push(to_brotli_size(code));
		if (data_path !== undefined) {
			measured[lib.name]!.push({ ...size, brotli: raw ? to_brotli_size(code) : brotli.at(-1)! });
		}
	}
	rows.push({ lib: lib.name, sizes, brotli });
}

const baseline = rows.find((r) => r.lib === BASELINE_LIB)!;

const format_cell = (size: number, baseline_size: number): string =>
	`${size} (${(size / baseline_size).toFixed(2)}x)`;

console.log(`\nbundle size, ${raw ? 'minified' : 'minified + gzip'} bytes (vs ${BASELINE_LIB})\n`);
console.log(
	format_table([
		['lib', ...headers],
		...rows.map((r) => [r.lib, ...r.sizes.map((s, i) => format_cell(s, baseline.sizes[i]!))])
	])
);
if (!raw) {
	console.log(
		`\nthe same, minified + brotli at its highest quality, reported beside gzip (vs ${BASELINE_LIB})\n`
	);
	console.log(
		format_table([
			['lib', ...headers],
			...rows.map((r) => [r.lib, ...r.brotli.map((s, i) => format_cell(s, baseline.brotli[i]!))])
		])
	);
}

const format_signed = (bytes: number): string => `${bytes >= 0 ? '+' : ''}${bytes}`;

const library = await measure_library_sizes(metric);

console.log(
	`\nthis library, ${raw ? 'minified' : 'minified + gzip'} bytes: ` +
		`every export of schema.ts ${library.library}, parse alone ${library.parse}\n`
);
console.log(
	format_table([
		['export', 'alone', 'last in'],
		...library.exports.map((e) => [e.name, format_signed(e.alone), format_signed(e.last_in)])
	])
);
console.log(
	'\nalone: a bundle of parse and the export, over one of parse\n' +
		'last in: every export, over every export but it\n' +
		'added: every export of schema.ts and of the module, over every export of schema.ts\n'
);
console.log(
	format_table([
		['module', 'added'],
		...library.modules.map((m) => [m.name, format_signed(m.added)])
	])
);

if (data_path !== undefined) {
	// what the tables above were printed from, unformatted, in every measure
	const to_libs = (column: number): Record<string, BundleSizes> =>
		Object.fromEntries(LIBS.map((lib) => [lib.name, measured[lib.name]![column]!]));
	write_benchmark_data(data_path, 'bundle', {
		rows: SCENARIOS.map((scenario, i) => ({ scenario: scenario.name, libs: to_libs(i) })),
		all: to_libs(SCENARIOS.length),
		library: {
			measure: metric,
			parse: library.parse,
			library: library.library,
			exports: library.exports,
			modules: library.modules
		}
	});
}
