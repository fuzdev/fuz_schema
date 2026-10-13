/**
 * Runtime benchmark: every library on every scenario, valid and invalid input,
 * a library to a process.
 *
 * **A process holds one library**, so what a library takes is not moved by
 * which libraries ran before it. The whole is repeated in passes of fresh
 * processes, and a figure is the median of its passes beside their spread:
 * see `timing_passes.ts`.
 *
 * **Two regimes**, the first two of `grade`. By default a library's process holds all of
 * its scenarios and runs every one, on both inputs, before it times any: each
 * is timed in library code that has seen several schemas, as in an app, and
 * reads the same whichever scenarios are asked for. With `--alone` every
 * scenario on every input gets a process of its own, where the engine
 * specializes the library to that one schema: what a program with one schema
 * pays, and many more processes.
 *
 * Before anything is timed every library is held to the same answer on every
 * scenario's inputs, here and again in each process.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --scenario type_json --lib fuz_schema --lib valibot
 *   npm run benchmark -- --no-invalid --duration 2000 --passes 9
 *   npm run benchmark -- --alone
 *
 * @module
 */

import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_table,
	has_some_allocation_node_flag,
	hold_benchmark_lock
} from './measure.ts';
import { RUN_VALIDITIES, to_run_row_name, type RunRowsOf, type RunValidity } from './run_rows.ts';
import { TIMING_PRELUDE_MS } from './timing_job.ts';
import {
	TIMING_CALL_ROW,
	format_spread,
	time_units,
	to_pooled_timing,
	type TimingPlan,
	type TimingRowPasses,
	type TimingUnit
} from './timing_passes.ts';

const Names = z
	.union([z.string(), z.array(z.string())])
	.transform((v) => (Array.isArray(v) ? v : [v]));

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	scenario: Names.optional().meta({ description: 'scenario names to run, defaulting to all' }),
	lib: Names.optional().meta({ description: 'library names to run, defaulting to all' }),
	invalid: z.boolean().default(true).meta({ description: 'also time invalid input' }),
	'no-invalid': z.boolean().default(false).meta({ description: 'opt out of invalid' }),
	duration: z
		.number()
		.positive()
		.default(500)
		.meta({ description: 'measurement ms per task, shared out over the passes' }),
	passes: z
		.number()
		.int()
		.positive()
		.default(5)
		.meta({ description: 'how many times the whole is repeated, in fresh processes' }),
	alone: z
		.boolean()
		.default(false)
		.meta({ description: 'a process for each scenario and input, not one for each library' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const unknown = [
	...(args.scenario ?? []).filter((name) => !SCENARIOS.some((s) => s.name === name)),
	...(args.lib ?? []).filter((name) => !LIBS.some((l) => l.name === name))
];
if (unknown.length) {
	console.error(
		`no scenario or library ${unknown.join(', ')}: the scenarios are ` +
			`${SCENARIOS.map((s) => s.name).join(', ')}, the libraries ${LIBS.map((l) => l.name).join(', ')}`
	);
	process.exit(1);
}
const scenarios = SCENARIOS.filter((s) => !args.scenario || args.scenario.includes(s.name));
const libs = LIBS.filter((l) => !args.lib || args.lib.includes(l.name));
if (!scenarios.length || !libs.length) {
	console.error('no scenarios or libs matched');
	process.exit(1);
}
if (has_some_allocation_node_flag()) {
	console.error(
		`the benchmark times under the flags a consumer has: take \`${ALLOCATION_NODE_FLAGS}\` off ` +
			'the command line and out of NODE_OPTIONS'
	);
	process.exit(1);
}

hold_benchmark_lock('fuz_schema benchmark');

// a benchmark only compares like with like if every library agrees on which
// inputs match
for (const lib of libs) {
	for (const scenario of SCENARIOS) {
		const matches = lib.scenarios[`scenario_${scenario.name}`]();
		for (const validity of RUN_VALIDITIES) {
			const expected = validity === 'valid';
			if (matches(scenario[validity]) !== expected) {
				throw new Error(
					`${to_run_row_name(scenario.name, validity)}: ${lib.name} returned ${!expected}`
				);
			}
		}
	}
}

const validities: ReadonlyArray<RunValidity> = args.invalid ? RUN_VALIDITIES : ['valid'];
const row_names = scenarios.flatMap((s) => validities.map((v) => to_run_row_name(s.name, v)));

// A row is warmed this long before its timing. A process that holds one row
// has everything still to compile, so it warms for longer.
const WARM_MS = { shared: 100, alone: 400 };
const regime = args.alone ? 'alone' : 'shared';
const plan: TimingPlan = {
	module: fileURLToPath(new URL('./run_rows.ts', import.meta.url)),
	prelude: !args.alone,
	warm_ms: WARM_MS[regime],
	duration_ms: args.duration / args.passes
};

const to_unit_id = (lib: string, row: string): string => (args.alone ? `${lib} ${row}` : lib);

const units: Array<TimingUnit> = libs.flatMap((lib): Array<TimingUnit> => {
	if (!args.alone) {
		// the process holds every scenario, whichever are timed
		const of: RunRowsOf = { lib: lib.name };
		return [{ id: lib.name, of, rows: row_names }];
	}
	return row_names.map((row) => {
		const of: RunRowsOf = { lib: lib.name, rows: [row] };
		return { id: to_unit_id(lib.name, row), of };
	});
});

const format_seconds = (seconds: number): string =>
	seconds < 90 ? `${Math.round(seconds)}s` : `${(seconds / 60).toFixed(1)} min`;

// what a process takes to start and load a library, fitted to runs of this
const PROCESS_SECONDS = 0.25;
const row_seconds = (plan.warm_ms + plan.duration_ms) / 1000;
// a process also times a function that does nothing, as it does a row
const pass_seconds = args.alone
	? units.length * (PROCESS_SECONDS + 2 * row_seconds)
	: units.length *
		(PROCESS_SECONDS +
			(SCENARIOS.length * RUN_VALIDITIES.length * TIMING_PRELUDE_MS) / 1000 +
			(row_names.length + 1) * row_seconds);

console.log(
	`runtime: ${libs.length} ${libs.length === 1 ? 'library' : 'libraries'} on ${row_names.length} ` +
		`${row_names.length === 1 ? 'row' : 'rows'}, ` +
		(args.alone ? 'a process for each row of each library' : 'a process for each library') +
		`, ${args.passes} ${args.passes === 1 ? 'pass' : 'passes'}, ` +
		`about ${format_seconds(pass_seconds * args.passes)}\n`
);

const readings = await time_units(units, plan, args.passes, (pass, ms) => {
	console.log(`pass ${pass + 1} of ${args.passes}: ${format_seconds(ms / 1000)}`);
});

const format_ns = (ns: number): string =>
	ns >= 100 ? ns.toFixed(0) : ns >= 10 ? ns.toFixed(1) : ns.toFixed(2);

const has_baseline = libs.some((l) => l.name === BASELINE_LIB);

console.log(
	'\nruntime: nanoseconds per parse, the median of the passes, with the fastest and slowest ' +
		'pass\nand the spread, which is half of what the passes range over. `ns` is the whole of a ' +
		'timing over\nits calls and `median` its median batch, pooled the same way: a wide gap between them ' +
		'is collection time'
);
for (const scenario of scenarios) {
	for (const validity of validities) {
		const row = to_run_row_name(scenario.name, validity);
		const to_passes = (lib: string): TimingRowPasses =>
			readings.get(to_unit_id(lib, row))!.get(row)!;
		const baseline = has_baseline ? to_pooled_timing(to_passes(BASELINE_LIB).ns).median : undefined;
		const table = [
			[
				'Task Name',
				'ops/sec',
				'ns',
				'median',
				'min',
				'max',
				'spread',
				has_baseline ? `vs ${BASELINE_LIB}` : ''
			]
		];
		for (const lib of libs) {
			const { ns: passes, median_ns } = to_passes(lib.name);
			const { median, spread } = to_pooled_timing(passes);
			table.push([
				`${row}/${lib.name}`,
				Math.round(1e9 / median).toLocaleString('en-US'),
				format_ns(median),
				format_ns(to_pooled_timing(median_ns).median),
				format_ns(Math.min(...passes)),
				format_ns(Math.max(...passes)),
				format_spread(spread),
				baseline === undefined
					? ''
					: lib.name === BASELINE_LIB
						? 'baseline'
						: (median / baseline).toFixed(2) + 'x'
			]);
		}
		console.log(`\n${scenario.name} (${validity})\n`);
		console.log(format_table(table));
	}
}

const call_ns = units.map(
	(unit) => to_pooled_timing(readings.get(unit.id)!.get(TIMING_CALL_ROW)!.ns).median
);
console.log(
	`\nEvery figure has a call in it: a function that does nothing takes ${format_ns(Math.min(...call_ns))} to ` +
		`${format_ns(Math.max(...call_ns))} ns\nthrough the loop the rows are timed in, across the processes. ` +
		'A row near that is mostly the call.'
);
console.log(
	'\nA gap between two libraries inside their spreads is not a finding. ' +
		(args.alone
			? "Each row had a process of\nits own: the engine specialized the library to that row's schema."
			: "Each library's process ran every\nscenario before it timed any: `--alone` gives each row a process of its own.")
);
