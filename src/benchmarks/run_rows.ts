/**
 * The rows of one library for `run.ts`, loaded by a process `timing_child.ts`
 * is: a row for each scenario on its valid input and on its invalid one.
 *
 * The library's module is imported by name, and no other library's, so the
 * process holds one library. A scenario's two rows share its schema, as a
 * consumer's valid and invalid inputs do, and each cycles through copies of
 * its input (`inputs.ts`).
 *
 * @module
 */

import { to_input_copies } from './inputs.ts';
import { SCENARIOS, type ScenarioModule } from './scenarios.ts';
import type { LoadTimingRows, TimingRow } from './timing_job.ts';

export const RUN_VALIDITIES = ['valid', 'invalid'] as const;
export type RunValidity = (typeof RUN_VALIDITIES)[number];

/** What a process of `run.ts` holds. */
export interface RunRowsOf {
	/** The basename of a module in `libs/`. */
	lib: string;
	/** The rows to build, every scenario's when left out. */
	rows?: Array<string>;
}

export const to_run_row_name = (scenario: string, validity: RunValidity): string =>
	`${scenario}/${validity}`;

export const load_rows: LoadTimingRows = async (of: RunRowsOf) => {
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
			// a match is told from a miss by what is returned, so the answer is read
			const inputs = to_input_copies(input);
			const mask = inputs.length - 1;
			let at = 0;
			rows.push({
				name,
				run: () => {
					const given = inputs[(at = (at + 1) & mask)];
					return matches(given) ? given : undefined;
				}
			});
		}
	}
	return rows;
};
