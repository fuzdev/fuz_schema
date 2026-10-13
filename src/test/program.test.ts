import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';

import { PROGRAM, run_program } from '../benchmarks/program.ts';
import { SHAPE_SAMPLES } from './shape_test_helpers.ts';

// the program a process of `grade`'s `apart` regime runs before it times a
// case: it is there to use every kind of schema, so one it leaves out is a
// kind whose use that regime doesn't see
describe('program', () => {
	test('has an entry for every export that makes a schema', () => {
		assert.sameMembers(
			PROGRAM.map((entry) => entry.name),
			Object.keys(SHAPE_SAMPLES)
		);
	});

	test('every entry builds the kind it names', () => {
		const kindless = ['message', 'flavor', 'brand'];
		// an action is run inside a `pipe`, as it is used
		const kinds: Array<string> = PROGRAM.filter((entry) => !kindless.includes(entry.name)).map(
			(entry) => {
				const schema = entry.create(s);
				if (schema.kind !== 'pipe' || entry.name === 'pipe') return schema.kind;
				const steps = schema.def as ReadonlyArray<s.AnySchema>;
				return steps.some((step) => step.kind === entry.name) ? entry.name : schema.kind;
			}
		);
		assert.deepEqual(
			kinds,
			PROGRAM.filter((entry) => !kindless.includes(entry.name)).map((entry) => entry.name)
		);
	});

	test('every entry runs, and gives the answers it says', () => {
		assert.strictEqual(run_program(s, true), PROGRAM.length);
	});
});
