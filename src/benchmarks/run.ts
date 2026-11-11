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

import {
	LibNamesArg,
	ScenarioNamesArg,
	meta,
	parse_args,
	s,
	to_count_arg,
	to_duration_arg
} from './args.ts';
import { SCENARIOS } from './scenarios.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import {
	format_number,
	format_seconds,
	format_table,
	refuse_timing_node_flags
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

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	scenario: meta(s.optional(ScenarioNamesArg), {
		description: 'scenario names to run, defaulting to all'
	}),
	lib: meta(s.optional(LibNamesArg), { description: 'library names to run, defaulting to all' }),
	invalid: meta(s.with_default(s.boolean, true), { description: 'also time invalid input' }),
	'no-invalid': meta(s.with_default(s.boolean, false), { description: 'opt out of invalid' }),
	duration: meta(to_duration_arg(500), {
		description: 'measurement ms per row of each library, shared out over the passes'
	}),
	passes: meta(to_count_arg(5), {
		description: 'how many times the whole is repeated, in fresh processes'
	}),
	alone: meta(s.with_default(s.boolean, false), {
		description: 'a process for each scenario and input, not one for each library'
	})
});

const args = parse_args(Args);

const scenarios = SCENARIOS.filter((s) => !args.scenario || args.scenario.includes(s.name));
const libs = LIBS.filter((l) => !args.lib || args.lib.includes(l.name));
refuse_timing_node_flags('the benchmark', false);

console.log(format_benchmark_header(COMPARED_LIB_PACKAGES));

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
	`\nruntime: ${libs.length} ${libs.length === 1 ? 'library' : 'libraries'} on ${row_names.length} ` +
		`${row_names.length === 1 ? 'row' : 'rows'}, ` +
		(args.alone ? 'a process for each row of each library' : 'a process for each library') +
		`, ${args.passes} ${args.passes === 1 ? 'pass' : 'passes'}, ` +
		`about ${format_seconds(pass_seconds * args.passes)}\n`
);

const readings = await time_units(units, plan, args.passes, (pass, ms) => {
	console.log(`pass ${pass + 1} of ${args.passes}: ${format_seconds(ms / 1000)}`);
});

const has_baseline = libs.some((l) => l.name === BASELINE_LIB);

console.log(
	'\nruntime: nanoseconds per parse, the median of the passes, with the fastest and slowest ' +
		'pass\nand the spread, which is half of what the passes range over. `ns` is the whole of a ' +
		'timing over\nits calls and `median` its median batch, pooled the same way: a wide gap between them ' +
		'is collection time' +
		(has_baseline
			? `.\n\`vs ${BASELINE_LIB}\` is a library's \`ns\` over ${BASELINE_LIB}'s: under 1 it is faster`
			: '')
);
for (const scenario of scenarios) {
	for (const validity of validities) {
		const row = to_run_row_name(scenario.name, validity);
		const to_passes = (lib: string): TimingRowPasses =>
			readings.get(to_unit_id(lib, row))!.get(row)!;
		const baseline = has_baseline ? to_pooled_timing(to_passes(BASELINE_LIB).ns).median : undefined;
		const table = [
			['lib', 'ns', 'median', 'min', 'max', 'spread', has_baseline ? `vs ${BASELINE_LIB}` : '']
		];
		for (const lib of libs) {
			const { ns: passes, median_ns } = to_passes(lib.name);
			const { median, spread } = to_pooled_timing(passes);
			table.push([
				lib.name,
				format_number(median),
				format_number(to_pooled_timing(median_ns).median),
				format_number(Math.min(...passes)),
				format_number(Math.max(...passes)),
				format_spread(spread),
				baseline === undefined
					? ''
					: lib.name === BASELINE_LIB
						? 'baseline'
						: (median / baseline).toFixed(2) + 'x'
			]);
		}
		console.log(`\n${row}\n`);
		console.log(format_table(table));
	}
}

const call_ns = units.map(
	(unit) => to_pooled_timing(readings.get(unit.id)!.get(TIMING_CALL_ROW)!.ns).median
);
console.log(
	`\nEvery figure has a call in it: a function that does nothing takes ${format_number(Math.min(...call_ns))} to ` +
		`${format_number(Math.max(...call_ns))} ns\nthrough the loop the rows are timed in, across the processes. ` +
		'A row near that is mostly the call.'
);
console.log(
	'\nA gap between two libraries inside their spreads is not a finding. ' +
		(args.alone
			? "Each row had a process of\nits own: the engine specialized the library to that row's schema."
			: "Each library's process ran every\nscenario before it timed any: `--alone` gives each row a process of its own.")
);
