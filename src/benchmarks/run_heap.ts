/**
 * Retained heap across libraries. See `heap.ts` for the method.
 *
 * Usage:
 *   gro run src/benchmarks/run_heap.ts
 *   gro run src/benchmarks/run_heap.ts --lib fuz_schema --lib valibot --scenario type_json
 *
 * @module
 */

import { meta, parse_args, s } from './args.ts';
import { HEAP_COUNTS, measure_retained_heap } from './heap.ts';
import { format_table } from './measure.ts';

const LIB_NAMES = ['fuz_schema', 'valibot', 'zod', 'zod_mini', 'typebox', 'arktype'];

const Names = s.pipe(
	s.union([s.string, s.array(s.string)]),
	s.transform((v: string | Array<string>) => (Array.isArray(v) ? v : [v]))
);

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	lib: meta(
		s.with_default_fn(Names, () => [...LIB_NAMES]),
		{ description: 'library names to run' }
	),
	scenario: meta(
		s.with_default_fn(Names, () => ['object_flat', 'type_json']),
		{ description: 'scenario names to run' }
	)
});

const args = parse_args(Args);

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
