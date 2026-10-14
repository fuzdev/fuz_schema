/**
 * Retained heap across libraries. See `heap.ts` for the method.
 *
 * Usage:
 *   gro run src/benchmarks/run_heap.ts
 *   gro run src/benchmarks/run_heap.ts --lib fuz_schema --lib valibot --scenario type_json
 *
 * @module
 */

import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import { HEAP_COUNTS, measure_retained_heap } from './heap.ts';
import { format_table } from './measure.ts';

const LIB_NAMES = ['fuz_schema', 'valibot', 'zod', 'zod_mini', 'typebox', 'arktype'];

const Names = z
	.union([z.string(), z.array(z.string())])
	.transform((v) => (Array.isArray(v) ? v : [v]));

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	lib: Names.default(LIB_NAMES).meta({ description: 'library names to run' }),
	scenario: Names.default(['object_flat', 'type_json']).meta({
		description: 'scenario names to run'
	})
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const to_kb = (bytes: number): string => (bytes / 1024).toFixed(1);

const rows: Array<Array<string>> = [
	['scenario', 'lib', 'heap KB', 'code KB', 'external KB', 'total KB', 'B per further schema']
];

for (const scenario of args.scenario) {
	for (const lib of args.lib) {
		const heap = await measure_retained_heap(lib, scenario);
		rows.push([
			scenario,
			lib,
			to_kb(heap.heap_bytes),
			to_kb(heap.code_bytes),
			to_kb(heap.external_bytes),
			to_kb(heap.total_bytes),
			String(heap.further_schema_bytes)
		]);
	}
}

console.log(
	'\nretained heap after building one schema and parsing once, over a bare process;\n' +
		'the last column is what each further schema adds, read between processes holding ' +
		`${HEAP_COUNTS.few} and ${HEAP_COUNTS.many}, past the engine's tier-up,\n` +
		'machine code and the trusted spaces beside it (bytecode, deoptimization data) left out\n'
);
console.log(format_table(rows, 2));
