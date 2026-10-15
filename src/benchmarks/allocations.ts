/**
 * Allocation profile across libraries: heap bytes each allocates per parse
 * and per schema creation, plus warm creation time. See `measure.ts` for the
 * method and its limits.
 *
 * Usage (`npm run benchmark:allocations` passes the node flags it needs):
 *   npm run benchmark:allocations -- --lib fuz_schema --lib valibot --scenario union
 *
 * @module
 */

import { meta, parse_args, s } from './args.ts';
import { SCENARIOS } from './scenarios.ts';
import { LIBS } from './libs.ts';
import {
	format_table,
	measure_bytes,
	measure_ms,
	require_allocation_node_flags
} from './measure.ts';

const Names = s.optional(
	s.pipe(
		s.union([s.string, s.array(s.string)]),
		s.transform((v: string | Array<string>) => (Array.isArray(v) ? v : [v]))
	)
);

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	scenario: meta(Names, { description: 'scenario names to run, defaulting to all' }),
	lib: meta(Names, { description: 'library names to run, defaulting to all' })
});

const args = parse_args(Args);

require_allocation_node_flags();

const format_number = (n: number): string =>
	Number.isNaN(n) ? '?' : n >= 100 ? n.toFixed(0) : n.toFixed(1);

const rows: Array<Array<string>> = [
	['scenario', 'lib', 'valid B/parse', 'invalid B/parse', 'create B', 'create μs']
];

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
			format_number(measure_bytes(() => run(valid))),
			format_number(measure_bytes(() => run(invalid))),
			format_number(measure_bytes(factory)),
			format_number(measure_ms(factory, 20) * 1000)
		]);
	}
}

console.log('\nallocations, heap bytes per call, and warm creation time\n');
console.log(format_table(rows, 2));
