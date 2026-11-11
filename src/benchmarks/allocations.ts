/**
 * Allocation profile across libraries: heap bytes each allocates per parse
 * and per schema creation, plus warm creation time. See `measure.ts` for the
 * method and its limits.
 *
 * Every library and scenario is measured in this one process, in order, so a
 * row's library code has seen the scenarios before it and no other. Creation
 * is timed after every row's bytes are read.
 *
 * Usage (`npm run benchmark:allocations` passes the node flags it needs):
 *   npm run benchmark:allocations -- --lib fuz_schema --lib valibot --scenario union
 *
 * @module
 */

import { LibNamesArg, ScenarioNamesArg, meta, parse_args, s } from './args.ts';
import { SCENARIOS } from './scenarios.ts';
import { LIBS } from './libs.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import {
	format_bytes,
	format_number,
	format_table,
	measure_bytes,
	measure_ms,
	require_allocation_node_flags
} from './measure.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	scenario: meta(s.optional(ScenarioNamesArg), {
		description: 'scenario names to run, defaulting to all'
	}),
	lib: meta(s.optional(LibNamesArg), { description: 'library names to run, defaulting to all' })
});

const args = parse_args(Args);

require_allocation_node_flags();

console.log(format_benchmark_header(COMPARED_LIB_PACKAGES));

const rows: Array<Array<string>> = [
	['scenario', 'lib', 'valid B/parse', 'invalid B/parse', 'create B', 'create ns']
];

// the factories measured, a row each, timed once every row's bytes are read
const factories: Array<() => unknown> = [];

for (const scenario of SCENARIOS) {
	if (args.scenario && !args.scenario.includes(scenario.name)) continue;
	for (const lib of LIBS) {
		if (args.lib && !args.lib.includes(lib.name)) continue;
		const factory = lib.scenarios[`scenario_${scenario.name}`];
		const run = factory();
		const { valid, invalid } = scenario;
		// reach optimized code before measuring
		for (let i = 0; i < 20_000; i++) {
			run(valid);
			run(invalid);
		}
		for (let i = 0; i < 50; i++) factory();
		rows.push([
			scenario.name,
			lib.name,
			format_bytes(measure_bytes(() => run(valid))),
			format_bytes(measure_bytes(() => run(invalid))),
			format_bytes(measure_bytes(factory))
		]);
		factories.push(factory);
	}
}

// Timed after every row's bytes, so the calls a timing makes are in no row's
// history when its bytes are read.
for (const [i, factory] of factories.entries()) {
	rows[i + 1]!.push(format_number(measure_ms(factory) * 1e6));
}

console.log(
	'\nallocations: heap bytes per call, and warm creation time, every row in this one process\n'
);
console.log(format_table(rows, 2));
