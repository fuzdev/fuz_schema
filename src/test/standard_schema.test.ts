import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { to_standard_schema, type StandardSchemaV1 } from '#lib/standard_schema.ts';

describe('to_standard_schema', () => {
	const User = s.object({
		name: s.message(s.string, 'name must be text'),
		tags: s.array(s.string),
		age: s.with_default(s.number, 0)
	});
	const standard = to_standard_schema(User);

	test('declares version and vendor', () => {
		assert.strictEqual(standard['~standard'].version, 1);
		assert.strictEqual(standard['~standard'].vendor, 'fuz_schema');
	});

	test('returns the output on success', () => {
		assert.deepEqual(standard['~standard'].validate({ name: 'a', tags: [] }), {
			value: { name: 'a', tags: [], age: 0 }
		});
	});

	test('returns issues with messages and paths on failure', () => {
		assert.deepEqual(standard['~standard'].validate({ name: 1, tags: ['a', 2] }), {
			issues: [
				{ message: 'name must be text', path: ['name'] },
				{ message: 'expected string, received number', path: ['tags', 1] }
			]
		});
	});

	test('carries input and output types', () => {
		expectTypeOf(standard).toEqualTypeOf<
			StandardSchemaV1<
				{ name: string; tags: Array<string>; age?: number | undefined },
				{ name: string; tags: Array<string>; age: number }
			>
		>();
	});
});
