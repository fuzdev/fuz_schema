/**
 * The rows of one library for `run.ts`, loaded by a process `timing_child.ts`
 * is: a row for each scenario on its valid input and on its invalid one.
 *
 * The library's module is imported by name, and no other library's, so the
 * process holds one library. A scenario's two rows share its schema, as a
 * consumer's valid and invalid inputs do.
 *
 * @module
 */

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
			rows.push({ name, run: () => (matches(input) ? input : undefined) });
		}
	}
	return rows;
};
