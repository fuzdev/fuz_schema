/**
 * Retained heap across libraries. See `heap.ts` for the method.
 *
 * Usage:
 *   gro run src/benchmarks/run_heap.ts
 *   gro run src/benchmarks/run_heap.ts --lib fuz_schema --lib valibot --scenario type_json
 *
 * @module
 */

import {
	DataArg,
	LibNamesArg,
	ScenarioNamesArg,
	meta,
	parse_args,
	s,
	write_benchmark_data
} from './args.ts';
import { HEAP_COUNTS, measure_retained_heap, type RetainedHeap } from './heap.ts';
import { INTERNED_MARK, INTERNING_LIBS, LIB_NAMES, format_interned_figure } from './lib_names.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import { format_table } from './measure.ts';
import { SCENARIOS, type ScenarioName } from './scenarios.ts';
import { is_scenario_schema_kept, type ScenarioSchemaModule } from './scenario_schemas.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	lib: meta(
		s.with_default_fn(LibNamesArg, () => [...LIB_NAMES]),
		{ description: 'library names to run' }
	),
	scenario: meta(
		s.with_default_fn(ScenarioNamesArg, (): Array<ScenarioName> => ['object_flat', 'type_json']),
		{ description: 'scenario names to run' }
	),
	data: DataArg
});

const args = parse_args(Args);

console.log(format_benchmark_header([...COMPARED_LIB_PACKAGES, 'rolldown']));

const to_kb = (bytes: number): string => (bytes / 1024).toFixed(1);

const rows: Array<Array<string>> = [
	['scenario', 'lib', 'heap KB', 'code KB', 'external KB', 'total KB', 'B per further schema']
];

// The libraries that may keep a definition's schema, each asked here, in a
// process that measures nothing, whether it hands back the one built before.
const kept: Set<string> = new Set();
for (const lib of args.lib.filter((name) => INTERNING_LIBS.includes(name))) {
	const schemas: ScenarioSchemaModule = await import(`./libs/schemas/${lib}.ts`);
	for (const scenario of SCENARIOS.filter((s) => args.scenario.includes(s.name))) {
		if (is_scenario_schema_kept(schemas, scenario)) kept.add(`${lib} ${scenario.name}`);
	}
}

// every reading, by scenario then library, for `--data`
const measured: Record<string, Record<string, RetainedHeap>> = {};

for (const scenario of args.scenario) {
	measured[scenario] = {};
	for (const lib of args.lib) {
		const heap = await measure_retained_heap(lib, scenario);
		measured[scenario][lib] = heap;
		rows.push([
			scenario,
			lib,
			to_kb(heap.heap_bytes),
			to_kb(heap.code_bytes),
			to_kb(heap.external_bytes),
			to_kb(heap.total_bytes),
			format_interned_figure(lib, String(heap.further_schema_bytes), kept.has(`${lib} ${scenario}`))
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
console.log(
	"\nEvery further schema is built from the scenario's one definition again, which is not what an\n" +
		"app's distinct schemas are: a library that keeps the schema of a definition and hands it back\n" +
		'for the same one reads far lower in the last column than for distinct ones' +
		(kept.size
			? `, and its figures\nthere are marked ${INTERNED_MARK}, where ${INTERNING_LIBS.join(', ')} hands back the schema it built before.`
			: '.')
);

if (args.data !== undefined) {
	// what the table above was printed from, unformatted
	write_benchmark_data(args.data, 'heap', {
		counts: HEAP_COUNTS,
		rows: args.scenario.map((scenario) => ({
			scenario,
			libs: Object.fromEntries(
				args.lib.map((lib) => [
					lib,
					{ ...measured[scenario]![lib]!, interned: kept.has(`${lib} ${scenario}`) }
				])
			)
		}))
	});
}
