/**
 * Runtime benchmark: every library on every scenario, valid and invalid input.
 *
 * Usage:
 *   gro run src/benchmarks/run.ts
 *   gro run src/benchmarks/run.ts --scenario type_json --lib fuz_schema --lib valibot
 *   gro run src/benchmarks/run.ts --no-invalid --duration 2000
 *
 * @module
 */

import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';
import { Benchmark } from '@fuzdev/fuz_util/benchmark.ts';
import type { BenchmarkGroup } from '@fuzdev/fuz_util/benchmark_types.ts';

import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	scenario: z
		.union([z.string(), z.array(z.string())])
		.transform((v) => (Array.isArray(v) ? v : [v]))
		.optional()
		.meta({ description: 'scenario names to run, defaulting to all' }),
	lib: z
		.union([z.string(), z.array(z.string())])
		.transform((v) => (Array.isArray(v) ? v : [v]))
		.optional()
		.meta({ description: 'library names to run, defaulting to all' }),
	invalid: z.boolean().default(true).meta({ description: 'also run invalid input' }),
	'no-invalid': z.boolean().default(false).meta({ description: 'opt out of invalid' }),
	duration: z.number().default(500).meta({ description: 'measurement ms per task' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const scenarios = SCENARIOS.filter((s) => !args.scenario || args.scenario.includes(s.name));
const libs = LIBS.filter((l) => !args.lib || args.lib.includes(l.name));
if (!scenarios.length || !libs.length) {
	console.error('no scenarios or libs matched');
	process.exit(1);
}

const bench = new Benchmark({
	duration_ms: args.duration,
	warmup_iterations: 1000,
	min_iterations: 100
});

const groups: Array<BenchmarkGroup> = [];

// each iteration loops so a single timing is well above timer resolution
const BATCH = 1000;

let sink = 0;

for (const scenario of scenarios) {
	for (const validity of args.invalid ? (['valid', 'invalid'] as const) : (['valid'] as const)) {
		const prefix = `${scenario.name}/${validity}/`;
		const input = scenario[validity];
		const expected = validity === 'valid';
		for (const lib of libs) {
			const run = lib.scenarios[`scenario_${scenario.name}`]();
			if (run(input) !== expected) {
				throw new Error(`${prefix}${lib.name} returned ${!expected}`);
			}
			bench.add(prefix + lib.name, () => {
				for (let i = 0; i < BATCH; i++) {
					if (run(input)) sink++;
				}
			});
		}
		groups.push({
			name: `${scenario.name} (${validity})`,
			filter: (r) => r.name.startsWith(prefix),
			baseline: libs.some((l) => l.name === BASELINE_LIB) ? prefix + BASELINE_LIB : undefined
		});
	}
}

await bench.run();

console.log(`\nruntime, ${BATCH} parses per iteration\n`);
console.log(bench.table({ groups }));
console.log(`\nsink: ${sink}`);
