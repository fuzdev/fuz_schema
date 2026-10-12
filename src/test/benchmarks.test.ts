import { describe, test, assert } from 'vitest';

import { SCENARIOS } from '../benchmarks/scenarios.ts';
import { LIBS } from '../benchmarks/libs.ts';

// a benchmark only compares like with like if every library
// agrees on which inputs match
describe('benchmark scenario parity', () => {
	for (const lib of LIBS) {
		describe(lib.name, () => {
			for (const scenario of SCENARIOS) {
				test(scenario.name, () => {
					const run = lib.scenarios[`scenario_${scenario.name}`]();
					assert.strictEqual(run(scenario.valid), true, 'valid input');
					assert.strictEqual(run(scenario.invalid), false, 'invalid input');
				});
			}
		});
	}
});
