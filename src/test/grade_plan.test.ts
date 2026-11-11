import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { create_cases } from '../benchmarks/cases.ts';
import { CORE_SCENARIO } from '../benchmarks/grade_bytes.ts';
import { APART_CASES, COLDSTART_SCENARIOS, to_chunks } from '../benchmarks/grade_plan.ts';
import { SCENARIOS } from '../benchmarks/scenarios.ts';

// a name the grader leans on that names nothing drops out of what it reads
// without an error: a case out of the `apart` regime, a scenario out of cold
// start, the core scenario out of core, which leaves `parse` alone
describe('grade_plan', () => {
	const case_names = create_cases(s, true).map((c) => c.name);
	const scenario_names = SCENARIOS.map((scenario) => scenario.name);

	test('every case timed apart by default is a case of the matrix', () => {
		for (const name of APART_CASES) assert.include(case_names, name);
	});

	test('every scenario cold start samples is a scenario', () => {
		for (const name of COLDSTART_SCENARIOS) assert.include(scenario_names, name);
	});

	test('the core scenario is a scenario of one schema', () => {
		const core = SCENARIOS.find((scenario) => scenario.name === CORE_SCENARIO);
		assert(core);
		assert(!core.many_schemas);
	});

	test('chunks hold every item once, in order', () => {
		const items = Array.from({ length: 11 }, (_, i) => i);
		for (const count of [1, 2, 3, 6, 11, 20]) {
			const chunks = to_chunks(items, count);
			assert(chunks.length <= count);
			assert.deepEqual(chunks.flat(), items);
		}
	});
});
