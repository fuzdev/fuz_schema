/**
 * Bundle-size benchmark: what each library costs to ship for each scenario.
 *
 * Each measurement bundles an entry that imports one scenario factory from one
 * library module and calls it, so the bundle holds the schema's definition
 * plus whatever library code it reaches after tree shaking. The `all` column
 * bundles every scenario together, showing how the shared cost amortizes.
 *
 * Usage:
 *   gro run src/benchmarks/bundle.ts
 *   gro run src/benchmarks/bundle.ts --raw   # minified bytes instead of gzip
 *
 * @module
 */

import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';
import { measure_bundle_size, type BundleSize } from './bundle_size.ts';
import { format_table } from './measure.ts';

const raw = process.argv.includes('--raw');
const metric: keyof BundleSize = raw ? 'minified' : 'gzip';

const columns = [...SCENARIOS.map((s) => [s.name]), SCENARIOS.map((s) => s.name)];
const headers = [...SCENARIOS.map((s) => s.name), 'all'];

const rows: Array<{ lib: string; sizes: Array<number> }> = [];
for (const lib of LIBS) {
	const sizes: Array<number> = [];
	for (const column of columns) {
		sizes.push((await measure_bundle_size(lib.name, column))[metric]);
	}
	rows.push({ lib: lib.name, sizes });
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
