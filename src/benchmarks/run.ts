/**
 * Runtime benchmark: every library on every scenario, valid and invalid input,
 * and each library's guard on the valid input, a library to a process.
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
 * **The guards** are the third table of a scenario: each library only answering
 * whether the valid input matches, by its own guard, which returns no output,
 * so a library that returns its input is compared with one that copies it on
 * the same question. Valibot's `is`, and Zod's `z.validate` where a schema has
 * no compiled path, run the parser, which still copies what it reads, and drop
 * the copy. A library's guards are a process of their own, beside the one
 * of its parses, so neither runs in code the other shaped. `--no-guard` leaves
 * them out.
 *
 * **`zod_compiled` has no figure where `z.compile` hands the root back**
 * uncompiled (`find_uncompiled_scenarios`): its process still builds and runs
 * that scenario, as every process holds every scenario, and times none of its
 * rows, which print `-`.
 *
 * Before anything is timed every library is held to the same answer on every
 * scenario's inputs, here and again in each process.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --scenario type_json --lib fuz_schema --lib valibot
 *   npm run benchmark -- --no-invalid --no-guard --duration 2000 --passes 9
 *   npm run benchmark -- --alone
 *
 * @module
 */

import { fileURLToPath } from 'node:url';

import {
	DataArg,
	LibNamesArg,
	ScenarioNamesArg,
	meta,
	parse_args,
	s,
	to_count_arg,
	to_duration_arg,
	write_benchmark_data
} from './args.ts';
import type { RunData } from './results_schema.ts';
import { SCENARIOS } from './scenarios.ts';
import { to_scenario_guard } from './scenario_schemas.ts';
import { find_uncompiled_scenarios } from './libs/schemas/zod_compiled.ts';
import { BASELINE_LIB, LIBS } from './libs.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import {
	format_number,
	format_seconds,
	format_table,
	refuse_timing_node_flags
} from './measure.ts';
import {
	RUN_VALIDITIES,
	to_guard_row_name,
	to_run_row_name,
	type RunRowsOf,
	type RunValidity
} from './run_rows.ts';
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
	guard: meta(s.with_default(s.boolean, true), {
		description: "also time each library's guard on the valid input"
	}),
	'no-guard': meta(s.with_default(s.boolean, false), { description: 'opt out of guard' }),
	duration: meta(to_duration_arg(500), {
		description: 'measurement ms per row of each library, shared out over the passes'
	}),
	passes: meta(to_count_arg(5), {
		description: 'how many times the whole is repeated, in fresh processes'
	}),
	alone: meta(s.with_default(s.boolean, false), {
		description: 'a process for each scenario and input, not one for each library'
	}),
	data: DataArg
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
		const guard = to_scenario_guard(lib.schemas, scenario);
		if (!guard(scenario.valid) || guard(scenario.invalid)) {
			throw new Error(`${to_guard_row_name(scenario.name)}: ${lib.name} gave the wrong verdict`);
		}
	}
}

const validities: ReadonlyArray<RunValidity> = args.invalid ? RUN_VALIDITIES : ['valid'];
const row_names = scenarios.flatMap((s) => validities.map((v) => to_run_row_name(s.name, v)));
const guard_row_names = args.guard ? scenarios.map((s) => to_guard_row_name(s.name)) : [];

// the scenarios `zod_compiled` has no figure of, whose rows it times none of
const uncompiled = libs.some((lib) => lib.name === 'zod_compiled')
	? find_uncompiled_scenarios().filter((name) => scenarios.some((s) => s.name === name))
	: [];
const uncompiled_rows: Set<string> = new Set(
	uncompiled.flatMap((name) => [
		...RUN_VALIDITIES.map((v) => to_run_row_name(name, v)),
		to_guard_row_name(name)
	])
);
// whether a library has a figure of a row
const has_figure = (lib: string, row: string): boolean =>
	lib !== 'zod_compiled' || !uncompiled_rows.has(row);

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

// a library's parses are a process and its guards another, or each row one alone
const to_unit_id = (lib: string, row: string, guard: boolean): string =>
	args.alone ? `${lib} ${row}` : guard ? `${lib} guard` : lib;

const units: Array<TimingUnit> = libs.flatMap((lib): Array<TimingUnit> => {
	const of_lib = row_names.filter((row) => has_figure(lib.name, row));
	const guards_of_lib = guard_row_names.filter((row) => has_figure(lib.name, row));
	if (!args.alone) {
		// a process holds every scenario, whichever are timed
		const parses: TimingUnit = {
			id: lib.name,
			of: { lib: lib.name } satisfies RunRowsOf,
			rows: of_lib
		};
		const guards: TimingUnit = {
			id: to_unit_id(lib.name, '', true),
			of: { lib: lib.name, guard: true } satisfies RunRowsOf,
			rows: guards_of_lib
		};
		// no process for a library with no row to time
		return [...(of_lib.length ? [parses] : []), ...(guards_of_lib.length ? [guards] : [])];
	}
	return [
		...of_lib.map((row): TimingUnit => ({
			id: to_unit_id(lib.name, row, false),
			of: { lib: lib.name, rows: [row] } satisfies RunRowsOf
		})),
		...guards_of_lib.map((row): TimingUnit => ({
			id: to_unit_id(lib.name, row, true),
			of: { lib: lib.name, rows: [row], guard: true } satisfies RunRowsOf
		}))
	];
});

// what a process takes to start and load a library, fitted to runs of this
const PROCESS_SECONDS = 0.25;
const row_seconds = (plan.warm_ms + plan.duration_ms) / 1000;
// a process also times a function that does nothing, as it does a row
const pass_seconds = args.alone
	? units.length * (PROCESS_SECONDS + 2 * row_seconds)
	: libs.length *
			(PROCESS_SECONDS +
				(SCENARIOS.length * RUN_VALIDITIES.length * TIMING_PRELUDE_MS) / 1000 +
				(row_names.length + 1) * row_seconds) +
		(guard_row_names.length
			? libs.length *
				(PROCESS_SECONDS +
					(SCENARIOS.length * TIMING_PRELUDE_MS) / 1000 +
					(guard_row_names.length + 1) * row_seconds)
			: 0);

const timed_rows = row_names.length + guard_row_names.length;
console.log(
	`\nruntime: ${libs.length} ${libs.length === 1 ? 'library' : 'libraries'} on ${timed_rows} ` +
		`${timed_rows === 1 ? 'row' : 'rows'}, ` +
		(args.alone
			? 'a process for each row of each library'
			: guard_row_names.length
				? "a process for each library's parses and one for its guards"
				: 'a process for each library') +
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
		'timing over\nits calls and `median` its median batch, pooled the same way: a wide gap between ' +
		'them is\ncollection time' +
		(has_baseline
			? `.\n\`vs ${BASELINE_LIB}\` is a library's \`ns\` over ${BASELINE_LIB}'s: under 1 it is faster`
			: '') +
		(guard_row_names.length
			? ".\nA scenario's third table, `guard`, is each library's guard on the valid input, which " +
				'returns a\nverdict and not the output: `is` in this library and Valibot, `z.validate` in ' +
				"Zod, TypeBox's `Check`,\nArkType's `allows`. Valibot's `is`, and Zod's where a schema " +
				'has no compiled path, run the parser,\nwhich still copies what it reads, and drop the copy'
			: '')
);
for (const scenario of scenarios) {
	const rows = [
		...validities.map((v) => ({ row: to_run_row_name(scenario.name, v), guard: false })),
		...(args.guard ? [{ row: to_guard_row_name(scenario.name), guard: true }] : [])
	];
	for (const { row, guard } of rows) {
		const to_passes = (lib: string): TimingRowPasses =>
			readings.get(to_unit_id(lib, row, guard))!.get(row)!;
		const baseline = has_baseline ? to_pooled_timing(to_passes(BASELINE_LIB).ns).median : undefined;
		const table = [
			['lib', 'ns', 'median', 'min', 'max', 'spread', has_baseline ? `vs ${BASELINE_LIB}` : '']
		];
		for (const lib of libs) {
			if (!has_figure(lib.name, row)) {
				table.push([lib.name, '-', '-', '-', '-', '-', has_baseline ? '-' : '']);
				continue;
			}
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
if (uncompiled.length) {
	console.log(
		'\n`-` is a row a library has no equivalent of. `zod_compiled` is each root through ' +
			`\`z.compile\`,\nwhich hands ${uncompiled.join(' and ')} back uncompiled: it times none of ` +
			'those rows.'
	);
}
if (libs.some((lib) => lib.name === 'typebox')) {
	console.log(
		"\nTypeBox's parse rows are its `Check` too, which stops at the first failure and builds no issues\n" +
			'and no output, so it is a guard in every table.'
	);
}
console.log(
	'\nA gap between two libraries inside their spreads is not a finding. ' +
		(args.alone
			? "Each row had a process of\nits own: the engine specialized the library to that row's schema."
			: "Each library's process ran every\nscenario before it timed any: `--alone` gives each row a process of its own.")
);

if (args.data !== undefined) {
	// what the tables above were printed from, unformatted
	type RunCell = RunData['rows'][number]['libs'][string];
	const to_cell = (lib: string, row: string, guard: boolean): RunCell => {
		if (!has_figure(lib, row)) {
			return { none: 'uncompiled', why: '`z.compile` hands the root back uncompiled' };
		}
		const { ns, median_ns } = readings.get(to_unit_id(lib, row, guard))!.get(row)!;
		const { median, spread } = to_pooled_timing(ns);
		return {
			ns: median,
			batch_ns: to_pooled_timing(median_ns).median,
			min_ns: Math.min(...ns),
			max_ns: Math.max(...ns),
			spread: Number.isNaN(spread) ? null : spread
		};
	};
	write_benchmark_data(args.data, 'run', {
		regime,
		passes: args.passes,
		duration_ms: args.duration,
		warm_ms: plan.warm_ms,
		call: { min_ns: Math.min(...call_ns), max_ns: Math.max(...call_ns) },
		rows: scenarios.flatMap((scenario) =>
			[
				...validities.map((input) => ({ input, row: to_run_row_name(scenario.name, input) })),
				...(args.guard ? [{ input: 'guard' as const, row: to_guard_row_name(scenario.name) }] : [])
			].map(({ input, row }) => ({
				scenario: scenario.name,
				input,
				libs: Object.fromEntries(
					libs.map((lib) => [lib.name, to_cell(lib.name, row, input === 'guard')])
				)
			}))
		)
	});
}
