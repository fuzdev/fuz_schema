import { describe, test, assert, vi } from 'vitest';

import * as s from '#lib/schema.ts';

import { SCENARIOS } from '../benchmarks/scenarios.ts';
import { LIBS } from '../benchmarks/libs.ts';
import * as fuz_schema_scenarios from '../benchmarks/libs/fuz_schema.ts';

// A scenario's runner answers yes or no, and its schema is in no export: a
// second export of it would be bytes in the bundles. So `parse` is wrapped to
// keep what it returns, for a test to read what a scenario's own schema gives.
const { outputs } = vi.hoisted(() => ({ outputs: [] as Array<unknown> }));
vi.mock('#lib/schema.ts', async (import_original) => {
	const original = await import_original<typeof import('#lib/schema.ts')>();
	const parse: typeof original.parse = (schema, value) => {
		const result = original.parse(schema, value);
		outputs.push(result.ok ? result.value : undefined);
		return result;
	};
	return { ...original, parse };
});

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

describe('benchmark scenario inputs', () => {
	// what `list` is there to measure: several issues, with paths two and three deep
	test('the invalid list fails at six places, two of them a level down', () => {
		const List = s.array(
			s.object({
				id: s.number,
				name: s.string,
				email: s.string,
				active: s.boolean,
				role: s.optional(s.string),
				tags: s.array(s.string)
			})
		);
		const { valid, invalid } = SCENARIOS.find((scenario) => scenario.name === 'list')!;
		assert.lengthOf(valid as Array<unknown>, 100);
		assert.strictEqual(s.parse(List, valid).ok, true);
		const result = s.parse(List, invalid);
		assert(!result.ok);
		assert.deepEqual(
			result.issues.map((issue) => issue.path),
			[
				[3, 'id'],
				[13, 'tags', 0],
				[40, 'active'],
				[58, 'role'],
				[71, 'tags', 1],
				[99, 'email']
			]
		);
	});

	// what `extra_keys` is there to measure: a copy without the keys the schema doesn't name
	test('the extra keys are dropped by the schema of object_flat', () => {
		const { valid } = SCENARIOS.find((scenario) => scenario.name === 'extra_keys')!;
		const run = fuz_schema_scenarios.scenario_extra_keys();
		outputs.length = 0;
		assert.strictEqual(run(valid), true);
		assert.lengthOf(outputs, 1);
		assert.deepEqual(outputs[0], {
			id: 1,
			name: 'Ada',
			email: 'ada@example.com',
			active: true
		});
		for (const lib of LIBS) {
			assert.strictEqual(lib.scenarios.scenario_extra_keys, lib.scenarios.scenario_object_flat);
		}
	});
});
