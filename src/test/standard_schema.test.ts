import { describe, test, assert, expectTypeOf } from 'vitest';

import type {
	StandardSchemaV1 as SpecSchemaV1,
	StandardTypedV1 as SpecTypedV1
} from '@standard-schema/spec';

import * as s from '#lib/schema.ts';
import {
	to_standard_schema,
	type StandardSchemaV1,
	type StandardSchemaV1Issue,
	type StandardSchemaV1Options,
	type StandardSchemaV1Props,
	type StandardSchemaV1Result,
	type StandardTypedV1,
	type StandardTypedV1Props,
	type StandardTypedV1Types
} from '#lib/standard_schema.ts';

describe('to_standard_schema', () => {
	const User = s.strip_object({
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

	test('validate takes and ignores the options argument', () => {
		const { validate } = standard['~standard'];
		assert.deepEqual(validate({ name: 'a', tags: [] }, { libraryOptions: { anything: 1 } }), {
			value: { name: 'a', tags: [], age: 0 }
		});
		assert.deepEqual(
			validate({ name: 'a', tags: [] }, undefined),
			validate({ name: 'a', tags: [] })
		);
		assert.deepEqual(validate(1, {}), {
			issues: [{ message: 'expected object, received number', path: [] }]
		});
	});

	test('sets nothing but version, vendor, and validate', () => {
		assert.deepEqual(Object.keys(standard), ['~standard']);
		assert.deepEqual(Object.keys(standard['~standard']), ['version', 'vendor', 'validate']);
		assert.strictEqual(standard['~standard'].types, undefined);
	});

	test('is not a schema', () => {
		assert(!s.is_schema(standard));
		assert(!s.is_schema(standard['~standard']));
	});

	test('the vendored types and the spec are assignable to each other', () => {
		interface In {
			a?: string;
		}
		interface Out {
			a: string;
		}
		expectTypeOf<StandardSchemaV1<In, Out>>().toExtend<SpecSchemaV1<In, Out>>();
		expectTypeOf<SpecSchemaV1<In, Out>>().toExtend<StandardSchemaV1<In, Out>>();
		expectTypeOf<StandardSchemaV1>().toExtend<SpecSchemaV1>();
		expectTypeOf<SpecSchemaV1>().toExtend<StandardSchemaV1>();
		expectTypeOf<StandardTypedV1<In, Out>>().toExtend<SpecTypedV1<In, Out>>();
		expectTypeOf<SpecTypedV1<In, Out>>().toExtend<StandardTypedV1<In, Out>>();
		expectTypeOf<StandardSchemaV1Props<In, Out>>().toExtend<SpecSchemaV1.Props<In, Out>>();
		expectTypeOf<SpecSchemaV1.Props<In, Out>>().toExtend<StandardSchemaV1Props<In, Out>>();
		expectTypeOf<StandardTypedV1Props<In, Out>>().toExtend<SpecTypedV1.Props<In, Out>>();
		expectTypeOf<SpecTypedV1.Props<In, Out>>().toExtend<StandardTypedV1Props<In, Out>>();
		expectTypeOf<StandardTypedV1Types<In, Out>>().toEqualTypeOf<SpecTypedV1.Types<In, Out>>();
		expectTypeOf<StandardSchemaV1Options>().toEqualTypeOf<SpecSchemaV1.Options>();
		expectTypeOf<StandardSchemaV1Result<Out>>().toExtend<SpecSchemaV1.Result<Out>>();
		expectTypeOf<SpecSchemaV1.Result<Out>>().toExtend<StandardSchemaV1Result<Out>>();
		expectTypeOf<StandardSchemaV1Issue>().toExtend<SpecSchemaV1.Issue>();
		expectTypeOf<SpecSchemaV1.Issue>().toExtend<StandardSchemaV1Issue>();
		// a schema is a typed, as the spec has it
		expectTypeOf<StandardSchemaV1<In, Out>>().toExtend<StandardTypedV1<In, Out>>();
		expectTypeOf<StandardSchemaV1<In, Out>>().toExtend<SpecTypedV1<In, Out>>();
		// and the parameters match, which assignability alone lets a narrower one pass
		expectTypeOf<Parameters<StandardSchemaV1Props['validate']>>().toEqualTypeOf<
			Parameters<SpecSchemaV1.Props['validate']>
		>();
		expectTypeOf<keyof StandardSchemaV1Props>().toEqualTypeOf<keyof SpecSchemaV1.Props>();
		expectTypeOf<keyof StandardTypedV1Props>().toEqualTypeOf<keyof SpecTypedV1.Props>();
	});

	test("the spec's inference reads the input and output types", () => {
		interface Input {
			name: string;
			tags: Array<string>;
			age?: number | undefined;
		}
		interface Output {
			name: string;
			tags: Array<string>;
			age: number;
		}
		expectTypeOf<SpecSchemaV1.InferInput<typeof standard>>().toEqualTypeOf<Input>();
		expectTypeOf<SpecSchemaV1.InferOutput<typeof standard>>().toEqualTypeOf<Output>();
		expectTypeOf<SpecTypedV1.InferInput<typeof standard>>().toEqualTypeOf<Input>();
		expectTypeOf<SpecTypedV1.InferOutput<typeof standard>>().toEqualTypeOf<Output>();
		// what a library that accepts any Standard Schema does with one
		const validate_with = <T extends SpecSchemaV1>(
			schema: T,
			value: unknown
		): SpecSchemaV1.InferOutput<T> | undefined => {
			const result = schema['~standard'].validate(value, { libraryOptions: {} });
			if (result instanceof Promise || result.issues) return undefined;
			return result.value;
		};
		const output = validate_with(standard, { name: 'a', tags: [] });
		expectTypeOf(output).toEqualTypeOf<Output | undefined>();
		assert.deepEqual(output, { name: 'a', tags: [], age: 0 });
		// the types don't follow a transform backwards
		const _Length = to_standard_schema(
			s.pipe(
				s.string,
				s.transform((v) => v.length)
			)
		);
		expectTypeOf<SpecSchemaV1.InferInput<typeof _Length>>().toEqualTypeOf<string>();
		expectTypeOf<SpecSchemaV1.InferOutput<typeof _Length>>().toEqualTypeOf<number>();
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
