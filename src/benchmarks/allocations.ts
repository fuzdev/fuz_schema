/**
 * Allocation profile across libraries: heap bytes each allocates per parse
 * and per schema creation, plus warm creation time. See `measure.ts` for the
 * method and its limits.
 *
 * **A library is a process.** This script starts itself again for each
 * library, under `ALLOCATION_NODE_FLAGS`, and the process imports that
 * library's scenario module and no other. In one process of every library,
 * Valibot's and Zod's `app` rows read a couple of kilobytes more than in a
 * process of their own, which loads no other library. Every scenario asked
 * for is measured in its library's process, in order, so a row's library code
 * has seen the scenarios before it and no other. Creation is timed after every
 * row's bytes are read.
 *
 * Usage (`npm run benchmark:allocations` passes the node flags it needs):
 *   npm run benchmark:allocations -- --lib fuz_schema --lib valibot --scenario union
 *
 * @module
 */

import { fileURLToPath } from 'node:url';

import { LibNamesArg, ScenarioNamesArg, meta, parse_args, s } from './args.ts';
import {
	INTERNED_MARK,
	INTERNING_LIBS,
	LIB_NAMES,
	format_interned_figure,
	type LibName
} from './lib_names.ts';
import { SCENARIOS, type ScenarioModule } from './scenarios.ts';
import { is_scenario_schema_kept, type ScenarioSchemaModule } from './scenario_schemas.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import {
	ALLOCATION_NODE_FLAGS,
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
	lib: meta(s.optional(LibNamesArg), { description: 'library names to run, defaulting to all' }),
	child: meta(s.with_default(s.boolean, false), {
		description:
			'measure the one library `--lib` names and print its rows as JSON: the process this ' +
			'script starts for each library'
	})
});

const args = parse_args(Args);

require_allocation_node_flags();

const scenarios = SCENARIOS.filter((s) => !args.scenario || args.scenario.includes(s.name));
const libs = LIB_NAMES.filter((name) => !args.lib || args.lib.includes(name));

/** What one library's process read of one scenario. */
interface AllocationRow {
	scenario: string;
	lib: LibName;
	valid_bytes: number;
	invalid_bytes: number;
	create_bytes: number;
	create_ns: number;
	/** Whether the library hands back the schema it built before, `is_scenario_schema_kept`. */
	kept: boolean;
}

// every scenario asked for, in this process's one library
const measure_lib = async (lib: LibName): Promise<Array<AllocationRow>> => {
	const module: ScenarioModule = await import(`./libs/${lib}.ts`);
	const rows: Array<AllocationRow> = [];
	// the factories measured, a row each, timed once every row's bytes are read
	const factories: Array<() => unknown> = [];
	for (const scenario of scenarios) {
		const factory = module[`scenario_${scenario.name}`];
		const run = factory();
		const { valid, invalid } = scenario;
		// reach optimized code before measuring
		for (let i = 0; i < 20_000; i++) {
			run(valid);
			run(invalid);
		}
		for (let i = 0; i < 50; i++) factory();
		rows.push({
			scenario: scenario.name,
			lib,
			valid_bytes: measure_bytes(() => run(valid)),
			invalid_bytes: measure_bytes(() => run(invalid)),
			create_bytes: measure_bytes(factory),
			create_ns: 0,
			kept: false
		});
		factories.push(factory);
	}
	// Timed after every row's bytes, so the calls a timing makes are in no row's
	// history when its bytes are read.
	for (const [i, factory] of factories.entries()) {
		rows[i]!.create_ns = measure_ms(factory) * 1e6;
	}
	// asked of the library's builders once nothing more is measured, and only of
	// a library that may keep a definition's schema, as building one is no row's
	if (INTERNING_LIBS.includes(lib)) {
		const schemas: ScenarioSchemaModule = await import(`./libs/schemas/${lib}.ts`);
		for (const [i, scenario] of scenarios.entries()) {
			rows[i]!.kept = is_scenario_schema_kept(schemas, scenario);
		}
	}
	return rows;
};

if (args.child) {
	if (libs.length !== 1) throw new Error('--child measures one library, named by --lib');
	const rows = await measure_lib(libs[0]!);
	process.stdout.write(JSON.stringify(rows) + '\n', (error) => process.exit(error ? 1 : 0));
} else {
	console.log(format_benchmark_header(COMPARED_LIB_PACKAGES));
	// imported here, as the processes it starts measure in this module and load none of it
	const { start_child, to_child_env } = await import('./child.ts');
	const script = fileURLToPath(import.meta.url);
	const scenario_args = scenarios.flatMap((scenario) => ['--scenario', scenario.name]);
	const measured: Array<AllocationRow> = [];
	for (const lib of libs) {
		measured.push(
			...((await start_child(script, {
				flags: ALLOCATION_NODE_FLAGS.split(' '),
				args: ['--child', '--lib', lib, ...scenario_args],
				env: to_child_env(process.env),
				label: `allocations, ${lib}`
			})) as Array<AllocationRow>)
		);
	}
	const rows: Array<Array<string>> = [
		['scenario', 'lib', 'valid B/parse', 'invalid B/parse', 'create B', 'create ns']
	];
	for (const scenario of scenarios) {
		for (const lib of libs) {
			const row = measured.find((r) => r.scenario === scenario.name && r.lib === lib)!;
			rows.push([
				scenario.name,
				lib,
				format_bytes(row.valid_bytes),
				format_bytes(row.invalid_bytes),
				format_interned_figure(lib, format_bytes(row.create_bytes), row.kept),
				format_interned_figure(lib, format_number(row.create_ns), row.kept)
			]);
		}
	}
	console.log(
		'\nallocations: heap bytes per call, and warm creation time, each library in a process of its own\n'
	);
	console.log(format_table(rows, 2));
	console.log(
		"\n`create` builds a scenario's schema from its one definition again and again, which is not what\n" +
			"an app's distinct schemas are: a library that keeps the schema of a definition and hands it\n" +
			'back for the same one reads far lower there than for distinct ones' +
			(measured.some((row) => row.kept)
				? `, and its figures are\nmarked ${INTERNED_MARK}, where ${INTERNING_LIBS.join(', ')} hands back the schema it built before.`
				: '.')
	);
}
