/**
 * The rows of one library for `run.ts`, loaded by a process `timing_child.ts`
 * is: a row for each scenario on its valid input and on its invalid one, or,
 * in a process of guards, a row for each scenario's guard on its valid input.
 *
 * The library's module is imported by name, and no other library's, so the
 * process holds one library. A scenario's two rows share its schema, as a
 * consumer's valid and invalid inputs do, and each cycles through copies of
 * its input (`inputs.ts`). A process of guards imports the library's schemas
 * module and not its scenario module, and runs no parse.
 *
 * @module
 */

import { to_input_copies } from './inputs.ts';
import { SCENARIOS, type ScenarioModule, type ScenarioRunner } from './scenarios.ts';
import { to_scenario_guard, type ScenarioSchemaModule } from './scenario_schemas.ts';
import type { LoadTimingRows, TimingRow } from './timing_job.ts';

export const RUN_VALIDITIES = ['valid', 'invalid'] as const;
export type RunValidity = (typeof RUN_VALIDITIES)[number];

/** What a process of `run.ts` holds. */
export interface RunRowsOf {
	/** The basename of a module in `libs/`. */
	lib: string;
	/** The rows to build, every scenario's when left out. */
	rows?: Array<string>;
	/** Whether the process holds the guards, each on its scenario's valid input, and no parse. */
	guard?: boolean;
}

export const to_run_row_name = (scenario: string, validity: RunValidity): string =>
	`${scenario}/${validity}`;

/** The row of a scenario's guard, on its valid input. */
export const to_guard_row_name = (scenario: string): string => `${scenario}/guard`;

// a row's call: `matches` on the next of the input's copies, and what it
// returns read, since a match is told from a miss by it
const to_row_run = (matches: ScenarioRunner, input: unknown): (() => unknown) => {
	const inputs = to_input_copies(input);
	const mask = inputs.length - 1;
	let at = 0;
	return () => {
		const given = inputs[(at = (at + 1) & mask)];
		return matches(given) ? given : undefined;
	};
};

export const load_rows: LoadTimingRows = async (of: RunRowsOf) => {
	if (of.guard) {
		const schemas: ScenarioSchemaModule = await import(`./libs/schemas/${of.lib}.ts`);
		return SCENARIOS.filter(
			(scenario) => !of.rows || of.rows.includes(to_guard_row_name(scenario.name))
		).map((scenario): TimingRow => {
			const name = to_guard_row_name(scenario.name);
			const guard = to_scenario_guard(schemas, scenario);
			if (!guard(scenario.valid) || guard(scenario.invalid)) {
				throw new Error(`${name}: ${of.lib} gave the wrong verdict`);
			}
			return { name, run: to_row_run(guard, scenario.valid) };
		});
	}
	const module: ScenarioModule = await import(`./libs/${of.lib}.ts`);
	const rows: Array<TimingRow> = [];
	for (const scenario of SCENARIOS) {
		const validities = RUN_VALIDITIES.filter(
			(validity) => !of.rows || of.rows.includes(to_run_row_name(scenario.name, validity))
		);
		if (!validities.length) continue;
		const matches = module[`scenario_${scenario.name}`]();
		for (const validity of validities) {
			const name = to_run_row_name(scenario.name, validity);
			const input = scenario[validity];
			const expected = validity === 'valid';
			if (matches(input) !== expected) {
				throw new Error(`${name}: ${of.lib} returned ${!expected}`);
			}
			rows.push({ name, run: to_row_run(matches, input) });
		}
	}
	return rows;
};
