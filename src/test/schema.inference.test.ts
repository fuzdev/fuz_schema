import { describe, test, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta } from '#lib/meta.ts';

// Type inference by position: every schema and action the library exports,
// written inline in each position where an inferred type has been lost
// before, as a schema whose type parameters are inferred from what the
// position expects can be. Each position names its leaves by a key, and its
// assertion compares what each leaf inferred, `[output, input]`, against
// `Expected`. A leaf is read back out of its position through `def`, or, for a
// `pipe`, whose `def` keeps no types, from the pipe itself.

type Pair<T> = T extends s.AnySchema ? [s.Infer<T>, s.InferInput<T>] : never;
type Pairs<T> = { [K in keyof T]: Pair<T[K]> };
type Defs<T> = { [K in keyof T]: T[K] extends { def: infer D } ? D : never };
type Fields<T, F extends PropertyKey> = {
	[K in keyof T]: T[K] extends Record<F, infer D> ? D : never;
};
type Returns<T> = { [K in keyof T]: T[K] extends () => infer R ? R : never };

// a default of any type, for a leaf of any type
const nothing = undefined as never;

// what a length action outside a `pipe` is given. Named, as two of the same
// object literal in one tuple don't compare as identical to the inferred type
interface Lengthed {
	length: number;
}

// what each leaf infers wherever its type parameters are inferred from its arguments alone
interface Expected {
	string: [string, string];
	number: [number, number];
	boolean: [boolean, boolean];
	bigint: [bigint, bigint];
	unknown: [unknown, unknown];
	literal: ['a', 'a'];
	one_of: ['a' | 'b', 'a' | 'b'];
	optional: [string | undefined, string | undefined];
	nullable: [string | null, string | null];
	with_default: [string, string | undefined];
	with_default_fn: [string, string | undefined];
	lazy: [string, string];
	message: [string, string];
	flavor: [s.Flavored<string, 'F'>, string];
	brand: [s.Branded<string, 'B'>, string];
	object: [{ a: string }, { a: string }];
	strip_object: [{ a: string }, { a: string }];
	loose_object: [{ a: string } & Record<string, unknown>, { a: string } & Record<string, unknown>];
	object_with_rest: [
		{ a: string } & Record<string, number>,
		{ a: string } & Record<string, number>
	];
	record: [Record<string, number>, Record<string, number>];
	array: [Array<string>, Array<string>];
	union: [string | number, string | number];
	memo_union: [string | number, string | number];
	variant: [{ k: 'a' }, { k: 'a' }];
	pipe: [string, string];
	pipe_check: [string, string];
	pipe_steps: [string, string];
	pipe_transform: [number, string];
	integer: [number, number];
	safe_integer: [number, number];
	regex: [string, string];
	check: [unknown, unknown];
	check_typed: [string, string];
	transform: [Array<unknown>, unknown];
	transform_typed: [number, string];
	min_length: [Lengthed, Lengthed];
	max_length: [Lengthed, Lengthed];
	min_value: [number | bigint, number | bigint];
	max_value: [number | bigint, number | bigint];
}

// a `pipe` step after `string` or `number`: what each leaf infers given that
interface ExpectedStep {
	string: [string, string];
	lazy: [string, string];
	message: [string, string];
	flavor: [s.Flavored<string, 'F'>, string];
	brand: [s.Branded<string, 'B'>, string];
	pipe: [string, string];
	pipe_check: [string, string];
	pipe_steps: [string, string];
	pipe_transform: [number, string];
	regex: [string, string];
	check: [string, string];
	check_typed: [string, string];
	transform: [Array<string>, string];
	transform_typed: [number, string];
	min_length: [string, string];
	max_length: [string, string];
	integer: [number, number];
	safe_integer: [number, number];
	min_value: [number, number];
	max_value: [number, number];
}

describe('inference by position', () => {
	test('a pipe that ends in an unannotated check infers its type as an entry or an option', () => {
		const _Entry = s.object({
			name: s.pipe(
				s.string,
				s.check((v) => v.length > 0)
			)
		});
		expectTypeOf<s.Infer<typeof _Entry>>().toEqualTypeOf<{ name: string }>();
		const _Steps = s.object({
			name: s.pipe(
				s.string,
				s.min_length(1),
				s.check((v) => v.length > 0)
			)
		});
		expectTypeOf<s.Infer<typeof _Steps>>().toEqualTypeOf<{ name: string }>();
		const _Four = s.object({
			name: s.pipe(
				s.string,
				s.min_length(1),
				s.max_length(9),
				s.check((v) => v.length > 0)
			)
		});
		expectTypeOf<s.Infer<typeof _Four>>().toEqualTypeOf<{ name: string }>();
		const _Five = s.object({
			name: s.pipe(
				s.string,
				s.min_length(1),
				s.max_length(9),
				s.min_length(2),
				s.check((v) => v.length > 0)
			)
		});
		expectTypeOf<s.Infer<typeof _Five>>().toEqualTypeOf<{ name: string }>();
		const _Option = s.union([
			s.pipe(
				s.number,
				s.check((v) => v > 0)
			),
			s.string
		]);
		expectTypeOf<s.Infer<typeof _Option>>().toEqualTypeOf<number | string>();
		const _Variant = s.variant('k', [
			s.object({
				k: s.literal('a'),
				n: s.pipe(
					s.number,
					s.check((v) => v > 0)
				)
			})
		]);
		expectTypeOf<s.Infer<typeof _Variant>>().toEqualTypeOf<{ k: 'a'; n: number }>();
		// so a typo in the function is an error
		s.object({
			name: s.pipe(
				s.string,
				// @ts-expect-error `lenght` is not a property of a string
				s.check((v) => v.lenght > 0)
			)
		});
	});

	test('a bare action as an entry or an option is given `unknown`, not `any`', () => {
		// @ts-expect-error `v` is `unknown`
		s.object({ a: s.check((v) => v.foo) });
		// @ts-expect-error `v` is `unknown`
		s.strip_object({ a: s.transform((v) => v.foo) });
		// @ts-expect-error `v` is `unknown`
		s.union([s.check((v) => v.foo)]);
		s.object({
			a: meta(
				// @ts-expect-error `v` is `unknown`, through `meta` too
				s.check((v) => v.foo),
				{}
			)
		});
		s.variant('k', [
			// @ts-expect-error `v` is `unknown`
			s.object({ k: s.literal('a'), a: s.check((v) => v.foo) })
		]);
		s.object({
			a: s.message(
				// @ts-expect-error `v` is `unknown`
				s.check((v) => v.foo),
				'm'
			)
		});
		// as at top level
		s.parse(
			// @ts-expect-error `v` is `unknown`
			s.check((v) => v.foo),
			1
		);
		// and a length or value action is typed by what it reads
		const _O = s.object({ a: s.min_length(1), b: s.min_value(1) });
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{
			a: Lengthed;
			b: number | bigint;
		}>();
	});

	test('a pipe of a generic action or schema, in a generic function', () => {
		// a pipe of a generic action is assignable to the type it declares
		const _action = <O>(a: s.SchemaAction<string, O>): s.Schema<O, string> => s.pipe(s.string, a);
		expectTypeOf<ReturnType<typeof _action<number>>>().toEqualTypeOf<s.Schema<number, string>>();
		// and so is what it parses to, returned or held in a variable
		const _parsed = <O>(a: s.SchemaAction<string, O>): O => {
			const p = s.pipe(s.string, a);
			const v: O = s.parse_or_throw(p, '');
			return v;
		};
		expectTypeOf<ReturnType<typeof _parsed<number>>>().toEqualTypeOf<number>();
		// a generic schema through a `check` gives its own type, parsed
		const _schema = <T extends s.AnySchema>(t: T): s.Infer<T> =>
			s.parse_or_throw(
				s.pipe(
					t,
					s.check(() => true)
				),
				1
			);
		expectTypeOf<ReturnType<typeof _schema<typeof s.string>>>().toEqualTypeOf<string>();
		// and returned, through an annotated `check`
		const _annotated = <T extends s.AnySchema>(t: T): s.Schema<s.Infer<T>, s.InferInput<T>> =>
			s.pipe(
				t,
				s.check((v: s.Infer<T>) => v !== null)
			);
		expectTypeOf<ReturnType<typeof _annotated<typeof s.string>>>().toEqualTypeOf<
			s.Schema<string, string>
		>();
		// and so does one through a `check` that annotates nothing
		const _unannotated = <T extends s.AnySchema>(t: T): s.Schema<s.Infer<T>, s.InferInput<T>> =>
			s.pipe(
				t,
				s.check((v) => v !== null)
			);
		expectTypeOf<ReturnType<typeof _unannotated<typeof s.string>>>().toEqualTypeOf<
			s.Schema<string, string>
		>();
		// without a declared return type it infers
		const _inferred = <T extends s.AnySchema>(t: T) =>
			s.pipe(
				t,
				s.check((v) => v !== null)
			);
		expectTypeOf<s.Infer<ReturnType<typeof _inferred<typeof s.string>>>>().toEqualTypeOf<string>();
	});

	test('top level', () => {
		const _leaves = {
			string: s.string,
			number: s.number,
			boolean: s.boolean,
			bigint: s.bigint,
			unknown: s.unknown,
			literal: s.literal('a'),
			one_of: s.one_of(['a', 'b']),
			optional: s.optional(s.string),
			nullable: s.nullable(s.string),
			with_default: s.with_default(s.string, 'x'),
			with_default_fn: s.with_default_fn(s.string, () => 'x'),
			lazy: s.lazy(() => s.string),
			message: s.message(s.string, 'm'),
			flavor: s.flavor(s.string, 'F'),
			brand: s.brand(s.string, 'B'),
			object: s.object({ a: s.string }),
			strip_object: s.strip_object({ a: s.string }),
			loose_object: s.loose_object({ a: s.string }),
			object_with_rest: s.object_with_rest({ a: s.string }, s.number),
			record: s.record(s.number),
			array: s.array(s.string),
			union: s.union([s.string, s.number]),
			memo_union: s.memo_union([s.string, s.number]),
			variant: s.variant('k', [s.object({ k: s.literal('a') })]),
			pipe: s.pipe(s.string, s.min_length(1)),
			pipe_check: s.pipe(
				s.string,
				s.check((v) => v !== '')
			),
			pipe_steps: s.pipe(
				s.string,
				s.min_length(1),
				s.check((v) => v !== '')
			),
			pipe_transform: s.pipe(
				s.string,
				s.transform((v) => v.length)
			),
			integer: s.integer,
			safe_integer: s.safe_integer,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_typed: s.check((v: string) => v !== ''),
			transform: s.transform((v) => [v]),
			transform_typed: s.transform((v: string) => v.length),
			min_length: s.min_length(1),
			max_length: s.max_length(1),
			min_value: s.min_value(1),
			max_value: s.max_value(1)
		};
		expectTypeOf<Pairs<typeof _leaves>>().toEqualTypeOf<Expected>();
	});

	test('object entry', () => {
		const _O = s.object({
			string: s.string,
			number: s.number,
			boolean: s.boolean,
			bigint: s.bigint,
			unknown: s.unknown,
			literal: s.literal('a'),
			one_of: s.one_of(['a', 'b']),
			optional: s.optional(s.string),
			nullable: s.nullable(s.string),
			with_default: s.with_default(s.string, 'x'),
			with_default_fn: s.with_default_fn(s.string, () => 'x'),
			lazy: s.lazy(() => s.string),
			message: s.message(s.string, 'm'),
			flavor: s.flavor(s.string, 'F'),
			brand: s.brand(s.string, 'B'),
			object: s.object({ a: s.string }),
			strip_object: s.strip_object({ a: s.string }),
			loose_object: s.loose_object({ a: s.string }),
			object_with_rest: s.object_with_rest({ a: s.string }, s.number),
			record: s.record(s.number),
			array: s.array(s.string),
			union: s.union([s.string, s.number]),
			memo_union: s.memo_union([s.string, s.number]),
			variant: s.variant('k', [s.object({ k: s.literal('a') })]),
			pipe: s.pipe(s.string, s.min_length(1)),
			pipe_check: s.pipe(
				s.string,
				s.check((v) => v !== '')
			),
			pipe_steps: s.pipe(
				s.string,
				s.min_length(1),
				s.check((v) => v !== '')
			),
			pipe_transform: s.pipe(
				s.string,
				s.transform((v) => v.length)
			),
			integer: s.integer,
			safe_integer: s.safe_integer,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_typed: s.check((v: string) => v !== ''),
			transform: s.transform((v) => [v]),
			transform_typed: s.transform((v: string) => v.length),
			min_length: s.min_length(1),
			max_length: s.max_length(1),
			min_value: s.min_value(1),
			max_value: s.max_value(1)
		});
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<Expected>();
		// and the object's own type is built from them
		expectTypeOf<s.Infer<typeof _O>['pipe_steps']>().toEqualTypeOf<string>();
		expectTypeOf<s.InferInput<typeof _O>['with_default']>().toEqualTypeOf<string | undefined>();
	});

	test('strip_object entry', () => {
		const _O = s.strip_object({
			string: s.string,
			number: s.number,
			boolean: s.boolean,
			bigint: s.bigint,
			unknown: s.unknown,
			literal: s.literal('a'),
			one_of: s.one_of(['a', 'b']),
			optional: s.optional(s.string),
			nullable: s.nullable(s.string),
			with_default: s.with_default(s.string, 'x'),
			with_default_fn: s.with_default_fn(s.string, () => 'x'),
			lazy: s.lazy(() => s.string),
			message: s.message(s.string, 'm'),
			flavor: s.flavor(s.string, 'F'),
			brand: s.brand(s.string, 'B'),
			object: s.object({ a: s.string }),
			strip_object: s.strip_object({ a: s.string }),
			loose_object: s.loose_object({ a: s.string }),
			object_with_rest: s.object_with_rest({ a: s.string }, s.number),
			record: s.record(s.number),
			array: s.array(s.string),
			union: s.union([s.string, s.number]),
			memo_union: s.memo_union([s.string, s.number]),
			variant: s.variant('k', [s.object({ k: s.literal('a') })]),
			pipe: s.pipe(s.string, s.min_length(1)),
			pipe_check: s.pipe(
				s.string,
				s.check((v) => v !== '')
			),
			pipe_steps: s.pipe(
				s.string,
				s.min_length(1),
				s.check((v) => v !== '')
			),
			pipe_transform: s.pipe(
				s.string,
				s.transform((v) => v.length)
			),
			integer: s.integer,
			safe_integer: s.safe_integer,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_typed: s.check((v: string) => v !== ''),
			transform: s.transform((v) => [v]),
			transform_typed: s.transform((v: string) => v.length),
			min_length: s.min_length(1),
			max_length: s.max_length(1),
			min_value: s.min_value(1),
			max_value: s.max_value(1)
		});
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<Expected>();
	});

	test('loose_object entry', () => {
		const _O = s.loose_object({
			string: s.string,
			number: s.number,
			boolean: s.boolean,
			bigint: s.bigint,
			unknown: s.unknown,
			literal: s.literal('a'),
			one_of: s.one_of(['a', 'b']),
			optional: s.optional(s.string),
			nullable: s.nullable(s.string),
			with_default: s.with_default(s.string, 'x'),
			with_default_fn: s.with_default_fn(s.string, () => 'x'),
			lazy: s.lazy(() => s.string),
			message: s.message(s.string, 'm'),
			flavor: s.flavor(s.string, 'F'),
			brand: s.brand(s.string, 'B'),
			object: s.object({ a: s.string }),
			strip_object: s.strip_object({ a: s.string }),
			loose_object: s.loose_object({ a: s.string }),
			object_with_rest: s.object_with_rest({ a: s.string }, s.number),
			record: s.record(s.number),
			array: s.array(s.string),
			union: s.union([s.string, s.number]),
			memo_union: s.memo_union([s.string, s.number]),
			variant: s.variant('k', [s.object({ k: s.literal('a') })]),
			pipe: s.pipe(s.string, s.min_length(1)),
			pipe_check: s.pipe(
				s.string,
				s.check((v) => v !== '')
			),
			pipe_steps: s.pipe(
				s.string,
				s.min_length(1),
				s.check((v) => v !== '')
			),
			pipe_transform: s.pipe(
				s.string,
				s.transform((v) => v.length)
			),
			integer: s.integer,
			safe_integer: s.safe_integer,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_typed: s.check((v: string) => v !== ''),
			transform: s.transform((v) => [v]),
			transform_typed: s.transform((v: string) => v.length),
			min_length: s.min_length(1),
			max_length: s.max_length(1),
			min_value: s.min_value(1),
			max_value: s.max_value(1)
		});
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<Expected>();
	});

	test('object_with_rest entry', () => {
		const _O = s.object_with_rest(
			{
				string: s.string,
				number: s.number,
				boolean: s.boolean,
				bigint: s.bigint,
				unknown: s.unknown,
				literal: s.literal('a'),
				one_of: s.one_of(['a', 'b']),
				optional: s.optional(s.string),
				nullable: s.nullable(s.string),
				with_default: s.with_default(s.string, 'x'),
				with_default_fn: s.with_default_fn(s.string, () => 'x'),
				lazy: s.lazy(() => s.string),
				message: s.message(s.string, 'm'),
				flavor: s.flavor(s.string, 'F'),
				brand: s.brand(s.string, 'B'),
				object: s.object({ a: s.string }),
				strip_object: s.strip_object({ a: s.string }),
				loose_object: s.loose_object({ a: s.string }),
				object_with_rest: s.object_with_rest({ a: s.string }, s.number),
				record: s.record(s.number),
				array: s.array(s.string),
				union: s.union([s.string, s.number]),
				memo_union: s.memo_union([s.string, s.number]),
				variant: s.variant('k', [s.object({ k: s.literal('a') })]),
				pipe: s.pipe(s.string, s.min_length(1)),
				pipe_check: s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				pipe_steps: s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				pipe_transform: s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				integer: s.integer,
				safe_integer: s.safe_integer,
				regex: s.regex(/x/),
				check: s.check((v) => v !== null),
				check_typed: s.check((v: string) => v !== ''),
				transform: s.transform((v) => [v]),
				transform_typed: s.transform((v: string) => v.length),
				min_length: s.min_length(1),
				max_length: s.max_length(1),
				min_value: s.min_value(1),
				max_value: s.max_value(1)
			},
			s.unknown
		);
		expectTypeOf<Pairs<(typeof _O)['def']['entries']>>().toEqualTypeOf<Expected>();
	});

	test('object_with_rest rest', () => {
		const _leaves = {
			string: s.object_with_rest({}, s.string),
			number: s.object_with_rest({}, s.number),
			boolean: s.object_with_rest({}, s.boolean),
			bigint: s.object_with_rest({}, s.bigint),
			unknown: s.object_with_rest({}, s.unknown),
			literal: s.object_with_rest({}, s.literal('a')),
			one_of: s.object_with_rest({}, s.one_of(['a', 'b'])),
			optional: s.object_with_rest({}, s.optional(s.string)),
			nullable: s.object_with_rest({}, s.nullable(s.string)),
			with_default: s.object_with_rest({}, s.with_default(s.string, 'x')),
			with_default_fn: s.object_with_rest(
				{},
				s.with_default_fn(s.string, () => 'x')
			),
			lazy: s.object_with_rest(
				{},
				s.lazy(() => s.string)
			),
			message: s.object_with_rest({}, s.message(s.string, 'm')),
			flavor: s.object_with_rest({}, s.flavor(s.string, 'F')),
			brand: s.object_with_rest({}, s.brand(s.string, 'B')),
			object: s.object_with_rest({}, s.object({ a: s.string })),
			strip_object: s.object_with_rest({}, s.strip_object({ a: s.string })),
			loose_object: s.object_with_rest({}, s.loose_object({ a: s.string })),
			object_with_rest: s.object_with_rest({}, s.object_with_rest({ a: s.string }, s.number)),
			record: s.object_with_rest({}, s.record(s.number)),
			array: s.object_with_rest({}, s.array(s.string)),
			union: s.object_with_rest({}, s.union([s.string, s.number])),
			memo_union: s.object_with_rest({}, s.memo_union([s.string, s.number])),
			variant: s.object_with_rest({}, s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.object_with_rest({}, s.pipe(s.string, s.min_length(1))),
			pipe_check: s.object_with_rest(
				{},
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.object_with_rest(
				{},
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.object_with_rest(
				{},
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.object_with_rest({}, s.integer),
			safe_integer: s.object_with_rest({}, s.safe_integer),
			regex: s.object_with_rest({}, s.regex(/x/)),
			check: s.object_with_rest(
				{},
				s.check((v) => v !== null)
			),
			check_typed: s.object_with_rest(
				{},
				s.check((v: string) => v !== '')
			),
			transform: s.object_with_rest(
				{},
				s.transform((v) => [v])
			),
			transform_typed: s.object_with_rest(
				{},
				s.transform((v: string) => v.length)
			),
			min_length: s.object_with_rest({}, s.min_length(1)),
			max_length: s.object_with_rest({}, s.max_length(1)),
			min_value: s.object_with_rest({}, s.min_value(1)),
			max_value: s.object_with_rest({}, s.max_value(1))
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 'rest'>>>().toEqualTypeOf<Expected>();
	});

	test('union option', () => {
		const _leaves = {
			string: s.union([s.string]),
			number: s.union([s.number]),
			boolean: s.union([s.boolean]),
			bigint: s.union([s.bigint]),
			unknown: s.union([s.unknown]),
			literal: s.union([s.literal('a')]),
			one_of: s.union([s.one_of(['a', 'b'])]),
			optional: s.union([s.optional(s.string)]),
			nullable: s.union([s.nullable(s.string)]),
			with_default: s.union([s.with_default(s.string, 'x')]),
			with_default_fn: s.union([s.with_default_fn(s.string, () => 'x')]),
			lazy: s.union([s.lazy(() => s.string)]),
			message: s.union([s.message(s.string, 'm')]),
			flavor: s.union([s.flavor(s.string, 'F')]),
			brand: s.union([s.brand(s.string, 'B')]),
			object: s.union([s.object({ a: s.string })]),
			strip_object: s.union([s.strip_object({ a: s.string })]),
			loose_object: s.union([s.loose_object({ a: s.string })]),
			object_with_rest: s.union([s.object_with_rest({ a: s.string }, s.number)]),
			record: s.union([s.record(s.number)]),
			array: s.union([s.array(s.string)]),
			union: s.union([s.union([s.string, s.number])]),
			memo_union: s.union([s.memo_union([s.string, s.number])]),
			variant: s.union([s.variant('k', [s.object({ k: s.literal('a') })])]),
			pipe: s.union([s.pipe(s.string, s.min_length(1))]),
			pipe_check: s.union([
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			]),
			pipe_steps: s.union([
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			]),
			pipe_transform: s.union([
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			]),
			integer: s.union([s.integer]),
			safe_integer: s.union([s.safe_integer]),
			regex: s.union([s.regex(/x/)]),
			check: s.union([s.check((v) => v !== null)]),
			check_typed: s.union([s.check((v: string) => v !== '')]),
			transform: s.union([s.transform((v) => [v])]),
			transform_typed: s.union([s.transform((v: string) => v.length)]),
			min_length: s.union([s.min_length(1)]),
			max_length: s.union([s.max_length(1)]),
			min_value: s.union([s.min_value(1)]),
			max_value: s.union([s.max_value(1)])
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 0>>>().toEqualTypeOf<Expected>();
	});

	test('union option in an object entry', () => {
		const _O = s.object({
			string: s.union([s.string]),
			number: s.union([s.number]),
			boolean: s.union([s.boolean]),
			bigint: s.union([s.bigint]),
			unknown: s.union([s.unknown]),
			literal: s.union([s.literal('a')]),
			one_of: s.union([s.one_of(['a', 'b'])]),
			optional: s.union([s.optional(s.string)]),
			nullable: s.union([s.nullable(s.string)]),
			with_default: s.union([s.with_default(s.string, 'x')]),
			with_default_fn: s.union([s.with_default_fn(s.string, () => 'x')]),
			lazy: s.union([s.lazy(() => s.string)]),
			message: s.union([s.message(s.string, 'm')]),
			flavor: s.union([s.flavor(s.string, 'F')]),
			brand: s.union([s.brand(s.string, 'B')]),
			object: s.union([s.object({ a: s.string })]),
			strip_object: s.union([s.strip_object({ a: s.string })]),
			loose_object: s.union([s.loose_object({ a: s.string })]),
			object_with_rest: s.union([s.object_with_rest({ a: s.string }, s.number)]),
			record: s.union([s.record(s.number)]),
			array: s.union([s.array(s.string)]),
			union: s.union([s.union([s.string, s.number])]),
			memo_union: s.union([s.memo_union([s.string, s.number])]),
			variant: s.union([s.variant('k', [s.object({ k: s.literal('a') })])]),
			pipe: s.union([s.pipe(s.string, s.min_length(1))]),
			pipe_check: s.union([
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			]),
			pipe_steps: s.union([
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			]),
			pipe_transform: s.union([
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			]),
			integer: s.union([s.integer]),
			safe_integer: s.union([s.safe_integer]),
			regex: s.union([s.regex(/x/)]),
			check: s.union([s.check((v) => v !== null)]),
			check_typed: s.union([s.check((v: string) => v !== '')]),
			transform: s.union([s.transform((v) => [v])]),
			transform_typed: s.union([s.transform((v: string) => v.length)]),
			min_length: s.union([s.min_length(1)]),
			max_length: s.union([s.max_length(1)]),
			min_value: s.union([s.min_value(1)]),
			max_value: s.union([s.max_value(1)])
		});
		expectTypeOf<Pairs<Fields<Defs<(typeof _O)['def']>, 0>>>().toEqualTypeOf<Expected>();
	});

	test('variant option entry', () => {
		const _V = s.variant('k', [
			s.object({
				k: s.literal('a'),
				string: s.string,
				number: s.number,
				boolean: s.boolean,
				bigint: s.bigint,
				unknown: s.unknown,
				literal: s.literal('a'),
				one_of: s.one_of(['a', 'b']),
				optional: s.optional(s.string),
				nullable: s.nullable(s.string),
				with_default: s.with_default(s.string, 'x'),
				with_default_fn: s.with_default_fn(s.string, () => 'x'),
				lazy: s.lazy(() => s.string),
				message: s.message(s.string, 'm'),
				flavor: s.flavor(s.string, 'F'),
				brand: s.brand(s.string, 'B'),
				object: s.object({ a: s.string }),
				strip_object: s.strip_object({ a: s.string }),
				loose_object: s.loose_object({ a: s.string }),
				object_with_rest: s.object_with_rest({ a: s.string }, s.number),
				record: s.record(s.number),
				array: s.array(s.string),
				union: s.union([s.string, s.number]),
				memo_union: s.memo_union([s.string, s.number]),
				variant: s.variant('k', [s.object({ k: s.literal('a') })]),
				pipe: s.pipe(s.string, s.min_length(1)),
				pipe_check: s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				pipe_steps: s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				pipe_transform: s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				integer: s.integer,
				safe_integer: s.safe_integer,
				regex: s.regex(/x/),
				check: s.check((v) => v !== null),
				check_typed: s.check((v: string) => v !== ''),
				transform: s.transform((v) => [v]),
				transform_typed: s.transform((v: string) => v.length),
				min_length: s.min_length(1),
				max_length: s.max_length(1),
				min_value: s.min_value(1),
				max_value: s.max_value(1)
			})
		]);
		expectTypeOf<
			Pairs<Omit<(typeof _V)['def']['options'][0]['def'], 'k'>>
		>().toEqualTypeOf<Expected>();
	});

	test('pipe head, in an object entry that ends in an unannotated check', () => {
		const _O = s.object({
			string: s.pipe(
				s.string,
				s.check((v) => v !== undefined)
			),
			number: s.pipe(
				s.number,
				s.check((v) => v !== undefined)
			),
			boolean: s.pipe(
				s.boolean,
				s.check((v) => v !== undefined)
			),
			bigint: s.pipe(
				s.bigint,
				s.check((v) => v !== undefined)
			),
			unknown: s.pipe(
				s.unknown,
				s.check((v) => v !== undefined)
			),
			literal: s.pipe(
				s.literal('a'),
				s.check((v) => v !== undefined)
			),
			one_of: s.pipe(
				s.one_of(['a', 'b']),
				s.check((v) => v !== undefined)
			),
			optional: s.pipe(
				s.optional(s.string),
				s.check((v) => v !== undefined)
			),
			nullable: s.pipe(
				s.nullable(s.string),
				s.check((v) => v !== undefined)
			),
			with_default: s.pipe(
				s.with_default(s.string, 'x'),
				s.check((v) => v !== undefined)
			),
			with_default_fn: s.pipe(
				s.with_default_fn(s.string, () => 'x'),
				s.check((v) => v !== undefined)
			),
			lazy: s.pipe(
				s.lazy(() => s.string),
				s.check((v) => v !== undefined)
			),
			message: s.pipe(
				s.message(s.string, 'm'),
				s.check((v) => v !== undefined)
			),
			flavor: s.pipe(
				s.flavor(s.string, 'F'),
				s.check((v) => v !== undefined)
			),
			brand: s.pipe(
				s.brand(s.string, 'B'),
				s.check((v) => v !== undefined)
			),
			object: s.pipe(
				s.object({ a: s.string }),
				s.check((v) => v !== undefined)
			),
			strip_object: s.pipe(
				s.strip_object({ a: s.string }),
				s.check((v) => v !== undefined)
			),
			loose_object: s.pipe(
				s.loose_object({ a: s.string }),
				s.check((v) => v !== undefined)
			),
			object_with_rest: s.pipe(
				s.object_with_rest({ a: s.string }, s.number),
				s.check((v) => v !== undefined)
			),
			record: s.pipe(
				s.record(s.number),
				s.check((v) => v !== undefined)
			),
			array: s.pipe(
				s.array(s.string),
				s.check((v) => v !== undefined)
			),
			union: s.pipe(
				s.union([s.string, s.number]),
				s.check((v) => v !== undefined)
			),
			memo_union: s.pipe(
				s.memo_union([s.string, s.number]),
				s.check((v) => v !== undefined)
			),
			variant: s.pipe(
				s.variant('k', [s.object({ k: s.literal('a') })]),
				s.check((v) => v !== undefined)
			),
			pipe: s.pipe(
				s.pipe(s.string, s.min_length(1)),
				s.check((v) => v !== undefined)
			),
			pipe_check: s.pipe(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				s.check((v) => v !== undefined)
			),
			pipe_steps: s.pipe(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				s.check((v) => v !== undefined)
			),
			pipe_transform: s.pipe(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				s.check((v) => v !== undefined)
			),
			integer: s.pipe(
				s.integer,
				s.check((v) => v !== undefined)
			),
			safe_integer: s.pipe(
				s.safe_integer,
				s.check((v) => v !== undefined)
			),
			regex: s.pipe(
				s.regex(/x/),
				s.check((v) => v !== undefined)
			),
			check: s.pipe(
				s.check((v) => v !== null),
				s.check((v) => v !== undefined)
			),
			check_typed: s.pipe(
				s.check((v: string) => v !== ''),
				s.check((v) => v !== undefined)
			),
			transform: s.pipe(
				s.transform((v) => [v]),
				s.check((v) => v !== undefined)
			),
			transform_typed: s.pipe(
				s.transform((v: string) => v.length),
				s.check((v) => v !== undefined)
			),
			min_length: s.pipe(
				s.min_length(1),
				s.check((v) => v !== undefined)
			),
			max_length: s.pipe(
				s.max_length(1),
				s.check((v) => v !== undefined)
			),
			min_value: s.pipe(
				s.min_value(1),
				s.check((v) => v !== undefined)
			),
			max_value: s.pipe(
				s.max_value(1),
				s.check((v) => v !== undefined)
			)
		});
		// the check is given what the head gives, and is the pipe's output
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<Expected>();
	});

	test('pipe step, at top level and in an object entry', () => {
		const _leaves = {
			string: s.pipe(s.string, s.string),
			lazy: s.pipe(
				s.string,
				s.lazy(() => s.string)
			),
			message: s.pipe(s.string, s.message(s.string, 'm')),
			flavor: s.pipe(s.string, s.flavor(s.string, 'F')),
			brand: s.pipe(s.string, s.brand(s.string, 'B')),
			pipe: s.pipe(s.string, s.pipe(s.string, s.min_length(1))),
			pipe_check: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			regex: s.pipe(s.string, s.regex(/x/)),
			check: s.pipe(
				s.string,
				s.check((v) => v !== null)
			),
			check_typed: s.pipe(
				s.string,
				s.check((v: string) => v !== '')
			),
			transform: s.pipe(
				s.string,
				s.transform((v) => [v])
			),
			transform_typed: s.pipe(
				s.string,
				s.transform((v: string) => v.length)
			),
			min_length: s.pipe(s.string, s.min_length(1)),
			max_length: s.pipe(s.string, s.max_length(1)),
			integer: s.pipe(s.number, s.integer),
			safe_integer: s.pipe(s.number, s.safe_integer),
			min_value: s.pipe(s.number, s.min_value(1)),
			max_value: s.pipe(s.number, s.max_value(1))
		};
		expectTypeOf<Pairs<typeof _leaves>>().toEqualTypeOf<ExpectedStep>();
		const _O = s.object({
			string: s.pipe(s.string, s.string),
			lazy: s.pipe(
				s.string,
				s.lazy(() => s.string)
			),
			message: s.pipe(s.string, s.message(s.string, 'm')),
			flavor: s.pipe(s.string, s.flavor(s.string, 'F')),
			brand: s.pipe(s.string, s.brand(s.string, 'B')),
			pipe: s.pipe(s.string, s.pipe(s.string, s.min_length(1))),
			pipe_check: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.pipe(
				s.string,
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			regex: s.pipe(s.string, s.regex(/x/)),
			check: s.pipe(
				s.string,
				s.check((v) => v !== null)
			),
			check_typed: s.pipe(
				s.string,
				s.check((v: string) => v !== '')
			),
			transform: s.pipe(
				s.string,
				s.transform((v) => [v])
			),
			transform_typed: s.pipe(
				s.string,
				s.transform((v: string) => v.length)
			),
			min_length: s.pipe(s.string, s.min_length(1)),
			max_length: s.pipe(s.string, s.max_length(1)),
			integer: s.pipe(s.number, s.integer),
			safe_integer: s.pipe(s.number, s.safe_integer),
			min_value: s.pipe(s.number, s.min_value(1)),
			max_value: s.pipe(s.number, s.max_value(1))
		});
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<ExpectedStep>();
		// a step after another, and a step that would be given the wrong type
		const _After = s.object({
			a: s.pipe(
				s.string,
				s.min_length(1),
				s.transform((v) => [v])
			)
		});
		expectTypeOf<s.Infer<typeof _After>>().toEqualTypeOf<{ a: Array<string> }>();
		// @ts-expect-error a number's step after a string
		s.object({ a: s.pipe(s.string, s.min_value(1)) });
	});

	test('a pipe refuses an action whose input is narrower than the step before it', () => {
		// @ts-expect-error `null` would reach `min_value`
		s.pipe(s.nullable(s.number), s.min_value(0));
		// @ts-expect-error `undefined` would reach `min_length`, which reads its `length`
		s.pipe(s.optional(s.string), s.min_length(1));
		// @ts-expect-error any value would reach `min_value`
		s.pipe(s.unknown, s.min_value(0));
		// @ts-expect-error any value would reach `min_length`
		s.pipe(s.unknown, s.min_length(1));
		s.pipe(
			s.nullable(s.number),
			// @ts-expect-error nor does an annotated `check` take a value it doesn't say it takes
			s.check((n: number) => n > 0)
		);
		// @ts-expect-error nor a later step
		s.pipe(s.number, s.transform(String), s.integer);
		// @ts-expect-error through a `message` too
		s.pipe(s.nullable(s.number), s.message(s.min_value(0), 'm'));
		// @ts-expect-error and a `meta`
		s.pipe(s.nullable(s.number), meta(s.min_value(0), {}));
		// the pipe goes inside the `nullable` or the `optional` instead
		const _Nullable = s.nullable(s.pipe(s.number, s.min_value(0)));
		expectTypeOf<s.Infer<typeof _Nullable>>().toEqualTypeOf<number | null>();
		const _Optional = s.optional(s.pipe(s.string, s.min_length(1)));
		expectTypeOf<s.Infer<typeof _Optional>>().toEqualTypeOf<string | undefined>();
		// and an action is still typed from the step before it through `message` and `meta`
		const _Message = s.pipe(s.string, s.message(s.min_length(1), 'm'));
		expectTypeOf<s.Infer<typeof _Message>>().toEqualTypeOf<string>();
		const _Meta = s.pipe(s.string, meta(s.min_length(1), { description: 'd' }));
		expectTypeOf<s.Infer<typeof _Meta>>().toEqualTypeOf<string>();
		const _Both = s.pipe(
			s.number,
			meta(
				s.message(
					s.check((v) => v > 0),
					'm'
				),
				{}
			),
			s.max_value(9)
		);
		expectTypeOf<s.Infer<typeof _Both>>().toEqualTypeOf<number>();
		// a schema stays a schema through `message`, so it is checked by its input alone
		expectTypeOf(s.message(s.string, 'm')).toEqualTypeOf<typeof s.string>();
		s.pipe(s.nullable(s.string), s.message(s.string, 'm'));
		// @ts-expect-error `brand` keeps what an action takes, so `null` would reach `regex`
		s.pipe(s.nullable(s.string), s.brand(s.regex(/n/), 'R'));
		// @ts-expect-error and so does `flavor`
		s.pipe(s.nullable(s.string), s.flavor(s.min_length(1), 'F'));
		s.pipe(
			s.nullable(s.string),
			// @ts-expect-error an annotated `check` too
			s.brand(
				s.check((v: string) => v.length > 0),
				'C'
			)
		);
		// and the action is still typed from the step before it, with the output branded
		const _Brand = s.pipe(s.string, s.brand(s.regex(/x/), 'R'));
		expectTypeOf<s.Infer<typeof _Brand>>().toEqualTypeOf<s.Branded<string, 'R'>>();
		const _Flavor = s.pipe(s.string, s.flavor(s.min_length(1), 'F'), s.max_length(9));
		expectTypeOf<s.Infer<typeof _Flavor>>().toEqualTypeOf<s.Flavored<string, 'F'>>();
		const _Check = s.pipe(
			s.number,
			s.brand(
				s.check((v) => v > 0),
				'P'
			)
		);
		expectTypeOf<s.Infer<typeof _Check>>().toEqualTypeOf<s.Branded<number, 'P'>>();
		// a schema stays a schema through `brand` and `flavor`, checked by its input alone
		expectTypeOf(s.brand(s.string, 'B')).toEqualTypeOf<
			s.Schema<s.Branded<string, 'B'>, string, 'string', undefined>
		>();
		expectTypeOf(s.flavor(s.string, 'F')).toEqualTypeOf<
			s.Schema<s.Flavored<string, 'F'>, string, 'string', undefined>
		>();
		s.pipe(s.nullable(s.string), s.brand(s.string, 'B'));
		s.pipe(s.nullable(s.string), s.flavor(s.string, 'F'));
	});

	test('a pipe takes an action whose input is wider than the step before it, and a refinement keeps the narrower type', () => {
		const _Literal = s.pipe(s.literal('abc'), s.regex(/a/));
		expectTypeOf<s.Infer<typeof _Literal>>().toEqualTypeOf<'abc'>();
		const _Branded = s.pipe(s.brand(s.string, 'B'), s.regex(/a/));
		expectTypeOf<s.Infer<typeof _Branded>>().toEqualTypeOf<s.Branded<string, 'B'>>();
		const _Integer = s.pipe(s.one_of([1, 2]), s.integer);
		expectTypeOf<s.Infer<typeof _Integer>>().toEqualTypeOf<1 | 2>();
		const _Safe = s.pipe(s.one_of([1, 2]), s.safe_integer);
		expectTypeOf<s.Infer<typeof _Safe>>().toEqualTypeOf<1 | 2>();
		const _Unknown = s.pipe(
			s.string,
			s.check((v: unknown) => v !== '')
		);
		expectTypeOf<s.Infer<typeof _Unknown>>().toEqualTypeOf<string>();
		// through the steps after it, and as an entry
		const _Steps = s.pipe(s.one_of([1, 2]), s.integer, s.min_value(0), s.max_value(9));
		expectTypeOf<s.Infer<typeof _Steps>>().toEqualTypeOf<1 | 2>();
		const _Lengths = s.pipe(s.literal('abc'), s.min_length(1), s.regex(/a/));
		expectTypeOf<s.Infer<typeof _Lengths>>().toEqualTypeOf<'abc'>();
		const _Entry = s.object({ a: s.pipe(s.one_of([1, 2]), s.integer) });
		expectTypeOf<s.Infer<typeof _Entry>>().toEqualTypeOf<{ a: 1 | 2 }>();
		// a `flavor` of a refinement is kept too
		const _Flavored = s.pipe(s.flavor(s.number, 'F'), s.integer);
		expectTypeOf<s.Infer<typeof _Flavored>>().toEqualTypeOf<s.Flavored<number, 'F'>>();
		// a `transform` is not a refinement, so its output is its own
		const _Transform = s.pipe(
			s.literal('abc'),
			s.transform((v: string) => v.toUpperCase())
		);
		expectTypeOf<s.Infer<typeof _Transform>>().toEqualTypeOf<string>();
		// a refinement under `message` or `meta` is a refinement still
		const _Message = s.pipe(s.one_of([1, 2]), s.message(s.integer, 'm'));
		expectTypeOf<s.Infer<typeof _Message>>().toEqualTypeOf<1 | 2>();
		const _Meta = s.pipe(s.one_of([1, 2]), meta(s.integer, {}));
		expectTypeOf<s.Infer<typeof _Meta>>().toEqualTypeOf<1 | 2>();
		const _Both = s.pipe(
			s.literal('abc'),
			meta(
				s.message(
					s.check((v) => v.length > 0),
					'm'
				),
				{}
			),
			s.message(s.regex(/a/), 'm')
		);
		expectTypeOf<s.Infer<typeof _Both>>().toEqualTypeOf<'abc'>();
		expectTypeOf(s.message(s.integer, 'm')).toEqualTypeOf<typeof s.integer>();
		// and a `transform` under them is not
		const _MessageTransform = s.pipe(
			s.literal('abc'),
			s.message(
				s.transform((v) => v.length),
				'm'
			)
		);
		expectTypeOf<s.Infer<typeof _MessageTransform>>().toEqualTypeOf<number>();
		// a `brand` or a `flavor` of one gives an action back, its output branded
		const _BrandInteger = s.pipe(s.one_of([1, 2]), s.brand(s.integer, 'B'));
		expectTypeOf<s.Infer<typeof _BrandInteger>>().toEqualTypeOf<s.Branded<number, 'B'>>();
		// a `check` annotated wider still takes a value narrower than it says
		const _Wider = s.pipe(
			s.literal('abc'),
			s.check((v: string) => v !== '')
		);
		expectTypeOf<s.Infer<typeof _Wider>>().toEqualTypeOf<'abc'>();
		// and so does a `transform`
		const _WiderTransform = s.pipe(
			s.number,
			s.transform((v: unknown) => String(v))
		);
		expectTypeOf<s.Infer<typeof _WiderTransform>>().toEqualTypeOf<string>();
		// a schema as a step is checked by its input, as before, so one that holds
		// an action keeps the action's input
		const _Schema = s.pipe(s.string, s.union([s.literal('a'), s.literal('b')]));
		expectTypeOf<s.Infer<typeof _Schema>>().toEqualTypeOf<'a' | 'b'>();
		// @ts-expect-error `null` would reach `min_length`, which reads its `length`
		s.pipe(s.nullable(s.number), s.union([s.min_length(1)]));
		s.pipe(
			s.nullable(s.string),
			// @ts-expect-error and through a `lazy`
			s.lazy(() => s.min_length(1))
		);
		// @ts-expect-error and at the start of a `pipe` as a step
		s.pipe(s.nullable(s.string), s.pipe(s.min_length(1), s.max_length(3)));
		// @ts-expect-error a number would reach `regex`, and the pipe output a string
		s.pipe(s.number, s.union([s.regex(/a/)]));
		// @ts-expect-error a schema whose input is wider is refused, as before, though it would match
		s.pipe(s.string, s.union([s.string, s.number]));
		// a known limitation: a holder keeps its action's input, so one narrower than
		// what it is given compiles, and `null` reaches `regex`, which reads it as
		// `'null'`, and `min_length`, which throws on it
		const _HeldRegex = s.pipe(s.nullable(s.string), s.union([s.regex(/n/)]));
		expectTypeOf<s.Infer<typeof _HeldRegex>>().toEqualTypeOf<string>();
		const _HeldLength = s.pipe(
			s.nullable(s.string),
			s.lazy(() => s.min_length<string>(1))
		);
		expectTypeOf<s.Infer<typeof _HeldLength>>().toEqualTypeOf<string>();
		// outside a `pipe` each is typed as before
		expectTypeOf<s.Infer<typeof s.integer>>().toEqualTypeOf<number>();
		expectTypeOf<s.InferInput<typeof s.integer>>().toEqualTypeOf<number>();
		const _regex = s.regex(/a/);
		expectTypeOf<s.Infer<typeof _regex>>().toEqualTypeOf<string>();
		const _check = s.check((v: number) => v > 0);
		expectTypeOf<s.Infer<typeof _check>>().toEqualTypeOf<number>();
		expectTypeOf<s.InferInput<typeof _check>>().toEqualTypeOf<number>();
		// and a narrower input is still refused
		// @ts-expect-error `null` would reach `integer`
		s.pipe(s.nullable(s.number), s.integer);
		// @ts-expect-error `undefined` would reach `regex`, which reads it as `'undefined'`
		s.pipe(s.optional(s.string), s.regex(/a/));
		s.pipe(
			s.nullable(s.string),
			// @ts-expect-error `null` would reach a `check` that says it takes a string
			s.check((v: string) => v !== '')
		);
		// @ts-expect-error a string's step after a number
		s.pipe(s.number, s.regex(/a/));
		// @ts-expect-error a number's step after a refinement of a string
		s.pipe(s.literal('abc'), s.regex(/a/), s.integer);
		// a step that may be a refinement or not outputs its own type
		const either = Math.random() < 0.5 ? s.integer : s.transform((v: number) => v * 2);
		const _Either = s.pipe(s.one_of([1, 2]), either);
		expectTypeOf<s.Infer<typeof _Either>>().toEqualTypeOf<number>();
		const either_schema =
			Math.random() < 0.5
				? s.integer
				: s.pipe(
						s.literal(1),
						s.transform((): number => 5)
					);
		const _EitherSchema = s.pipe(s.one_of([1, 2]), either_schema);
		expectTypeOf<s.Infer<typeof _EitherSchema>>().toEqualTypeOf<number>();
		const takes_refinement = (_refinement: s.SchemaRefinement<string>) => {};
		// @ts-expect-error a `transform` is not a refinement
		takes_refinement(s.transform((v: string) => v.toUpperCase()));
	});

	test('optional', () => {
		const _leaves = {
			string: s.optional(s.string),
			number: s.optional(s.number),
			boolean: s.optional(s.boolean),
			bigint: s.optional(s.bigint),
			unknown: s.optional(s.unknown),
			literal: s.optional(s.literal('a')),
			one_of: s.optional(s.one_of(['a', 'b'])),
			optional: s.optional(s.optional(s.string)),
			nullable: s.optional(s.nullable(s.string)),
			with_default: s.optional(s.with_default(s.string, 'x')),
			with_default_fn: s.optional(s.with_default_fn(s.string, () => 'x')),
			lazy: s.optional(s.lazy(() => s.string)),
			message: s.optional(s.message(s.string, 'm')),
			flavor: s.optional(s.flavor(s.string, 'F')),
			brand: s.optional(s.brand(s.string, 'B')),
			object: s.optional(s.object({ a: s.string })),
			strip_object: s.optional(s.strip_object({ a: s.string })),
			loose_object: s.optional(s.loose_object({ a: s.string })),
			object_with_rest: s.optional(s.object_with_rest({ a: s.string }, s.number)),
			record: s.optional(s.record(s.number)),
			array: s.optional(s.array(s.string)),
			union: s.optional(s.union([s.string, s.number])),
			memo_union: s.optional(s.memo_union([s.string, s.number])),
			variant: s.optional(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.optional(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.optional(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.optional(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.optional(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.optional(s.integer),
			safe_integer: s.optional(s.safe_integer),
			regex: s.optional(s.regex(/x/)),
			check: s.optional(s.check((v) => v !== null)),
			check_typed: s.optional(s.check((v: string) => v !== '')),
			transform: s.optional(s.transform((v) => [v])),
			transform_typed: s.optional(s.transform((v: string) => v.length)),
			min_length: s.optional(s.min_length(1)),
			max_length: s.optional(s.max_length(1)),
			min_value: s.optional(s.min_value(1)),
			max_value: s.optional(s.max_value(1))
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('nullable', () => {
		const _leaves = {
			string: s.nullable(s.string),
			number: s.nullable(s.number),
			boolean: s.nullable(s.boolean),
			bigint: s.nullable(s.bigint),
			unknown: s.nullable(s.unknown),
			literal: s.nullable(s.literal('a')),
			one_of: s.nullable(s.one_of(['a', 'b'])),
			optional: s.nullable(s.optional(s.string)),
			nullable: s.nullable(s.nullable(s.string)),
			with_default: s.nullable(s.with_default(s.string, 'x')),
			with_default_fn: s.nullable(s.with_default_fn(s.string, () => 'x')),
			lazy: s.nullable(s.lazy(() => s.string)),
			message: s.nullable(s.message(s.string, 'm')),
			flavor: s.nullable(s.flavor(s.string, 'F')),
			brand: s.nullable(s.brand(s.string, 'B')),
			object: s.nullable(s.object({ a: s.string })),
			strip_object: s.nullable(s.strip_object({ a: s.string })),
			loose_object: s.nullable(s.loose_object({ a: s.string })),
			object_with_rest: s.nullable(s.object_with_rest({ a: s.string }, s.number)),
			record: s.nullable(s.record(s.number)),
			array: s.nullable(s.array(s.string)),
			union: s.nullable(s.union([s.string, s.number])),
			memo_union: s.nullable(s.memo_union([s.string, s.number])),
			variant: s.nullable(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.nullable(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.nullable(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.nullable(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.nullable(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.nullable(s.integer),
			safe_integer: s.nullable(s.safe_integer),
			regex: s.nullable(s.regex(/x/)),
			check: s.nullable(s.check((v) => v !== null)),
			check_typed: s.nullable(s.check((v: string) => v !== '')),
			transform: s.nullable(s.transform((v) => [v])),
			transform_typed: s.nullable(s.transform((v: string) => v.length)),
			min_length: s.nullable(s.min_length(1)),
			max_length: s.nullable(s.max_length(1)),
			min_value: s.nullable(s.min_value(1)),
			max_value: s.nullable(s.max_value(1))
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('with_default', () => {
		const _leaves = {
			string: s.with_default(s.string, nothing),
			number: s.with_default(s.number, nothing),
			boolean: s.with_default(s.boolean, nothing),
			bigint: s.with_default(s.bigint, nothing),
			unknown: s.with_default(s.unknown, nothing),
			literal: s.with_default(s.literal('a'), nothing),
			one_of: s.with_default(s.one_of(['a', 'b']), nothing),
			optional: s.with_default(s.optional(s.string), nothing),
			nullable: s.with_default(s.nullable(s.string), nothing),
			with_default: s.with_default(s.with_default(s.string, 'x'), nothing),
			with_default_fn: s.with_default(
				s.with_default_fn(s.string, () => 'x'),
				nothing
			),
			lazy: s.with_default(
				s.lazy(() => s.string),
				nothing
			),
			message: s.with_default(s.message(s.string, 'm'), nothing),
			flavor: s.with_default(s.flavor(s.string, 'F'), nothing),
			brand: s.with_default(s.brand(s.string, 'B'), nothing),
			object: s.with_default(s.object({ a: s.string }), nothing),
			strip_object: s.with_default(s.strip_object({ a: s.string }), nothing),
			loose_object: s.with_default(s.loose_object({ a: s.string }), nothing),
			object_with_rest: s.with_default(s.object_with_rest({ a: s.string }, s.number), nothing),
			record: s.with_default(s.record(s.number), nothing),
			array: s.with_default(s.array(s.string), nothing),
			union: s.with_default(s.union([s.string, s.number]), nothing),
			memo_union: s.with_default(s.memo_union([s.string, s.number]), nothing),
			variant: s.with_default(s.variant('k', [s.object({ k: s.literal('a') })]), nothing),
			pipe: s.with_default(s.pipe(s.string, s.min_length(1)), nothing),
			pipe_check: s.with_default(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				nothing
			),
			pipe_steps: s.with_default(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				nothing
			),
			pipe_transform: s.with_default(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				nothing
			),
			integer: s.with_default(s.integer, nothing),
			safe_integer: s.with_default(s.safe_integer, nothing),
			regex: s.with_default(s.regex(/x/), nothing),
			check: s.with_default(
				s.check((v) => v !== null),
				nothing
			),
			check_typed: s.with_default(
				s.check((v: string) => v !== ''),
				nothing
			),
			transform: s.with_default(
				s.transform((v) => [v]),
				nothing
			),
			transform_typed: s.with_default(
				s.transform((v: string) => v.length),
				nothing
			),
			min_length: s.with_default(s.min_length(1), nothing),
			max_length: s.with_default(s.max_length(1), nothing),
			min_value: s.with_default(s.min_value(1), nothing),
			max_value: s.with_default(s.max_value(1), nothing)
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('with_default_fn', () => {
		const _leaves = {
			string: s.with_default_fn(s.string, () => nothing),
			number: s.with_default_fn(s.number, () => nothing),
			boolean: s.with_default_fn(s.boolean, () => nothing),
			bigint: s.with_default_fn(s.bigint, () => nothing),
			unknown: s.with_default_fn(s.unknown, () => nothing),
			literal: s.with_default_fn(s.literal('a'), () => nothing),
			one_of: s.with_default_fn(s.one_of(['a', 'b']), () => nothing),
			optional: s.with_default_fn(s.optional(s.string), () => nothing),
			nullable: s.with_default_fn(s.nullable(s.string), () => nothing),
			with_default: s.with_default_fn(s.with_default(s.string, 'x'), () => nothing),
			with_default_fn: s.with_default_fn(
				s.with_default_fn(s.string, () => 'x'),
				() => nothing
			),
			lazy: s.with_default_fn(
				s.lazy(() => s.string),
				() => nothing
			),
			message: s.with_default_fn(s.message(s.string, 'm'), () => nothing),
			flavor: s.with_default_fn(s.flavor(s.string, 'F'), () => nothing),
			brand: s.with_default_fn(s.brand(s.string, 'B'), () => nothing),
			object: s.with_default_fn(s.object({ a: s.string }), () => nothing),
			strip_object: s.with_default_fn(s.strip_object({ a: s.string }), () => nothing),
			loose_object: s.with_default_fn(s.loose_object({ a: s.string }), () => nothing),
			object_with_rest: s.with_default_fn(
				s.object_with_rest({ a: s.string }, s.number),
				() => nothing
			),
			record: s.with_default_fn(s.record(s.number), () => nothing),
			array: s.with_default_fn(s.array(s.string), () => nothing),
			union: s.with_default_fn(s.union([s.string, s.number]), () => nothing),
			memo_union: s.with_default_fn(s.memo_union([s.string, s.number]), () => nothing),
			variant: s.with_default_fn(s.variant('k', [s.object({ k: s.literal('a') })]), () => nothing),
			pipe: s.with_default_fn(s.pipe(s.string, s.min_length(1)), () => nothing),
			pipe_check: s.with_default_fn(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				() => nothing
			),
			pipe_steps: s.with_default_fn(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				() => nothing
			),
			pipe_transform: s.with_default_fn(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				() => nothing
			),
			integer: s.with_default_fn(s.integer, () => nothing),
			safe_integer: s.with_default_fn(s.safe_integer, () => nothing),
			regex: s.with_default_fn(s.regex(/x/), () => nothing),
			check: s.with_default_fn(
				s.check((v) => v !== null),
				() => nothing
			),
			check_typed: s.with_default_fn(
				s.check((v: string) => v !== ''),
				() => nothing
			),
			transform: s.with_default_fn(
				s.transform((v) => [v]),
				() => nothing
			),
			transform_typed: s.with_default_fn(
				s.transform((v: string) => v.length),
				() => nothing
			),
			min_length: s.with_default_fn(s.min_length(1), () => nothing),
			max_length: s.with_default_fn(s.max_length(1), () => nothing),
			min_value: s.with_default_fn(s.min_value(1), () => nothing),
			max_value: s.with_default_fn(s.max_value(1), () => nothing)
		};
		expectTypeOf<Pairs<Fields<Defs<typeof _leaves>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('optional in an object entry', () => {
		const _O = s.object({
			string: s.optional(s.string),
			number: s.optional(s.number),
			boolean: s.optional(s.boolean),
			bigint: s.optional(s.bigint),
			unknown: s.optional(s.unknown),
			literal: s.optional(s.literal('a')),
			one_of: s.optional(s.one_of(['a', 'b'])),
			optional: s.optional(s.optional(s.string)),
			nullable: s.optional(s.nullable(s.string)),
			with_default: s.optional(s.with_default(s.string, 'x')),
			with_default_fn: s.optional(s.with_default_fn(s.string, () => 'x')),
			lazy: s.optional(s.lazy(() => s.string)),
			message: s.optional(s.message(s.string, 'm')),
			flavor: s.optional(s.flavor(s.string, 'F')),
			brand: s.optional(s.brand(s.string, 'B')),
			object: s.optional(s.object({ a: s.string })),
			strip_object: s.optional(s.strip_object({ a: s.string })),
			loose_object: s.optional(s.loose_object({ a: s.string })),
			object_with_rest: s.optional(s.object_with_rest({ a: s.string }, s.number)),
			record: s.optional(s.record(s.number)),
			array: s.optional(s.array(s.string)),
			union: s.optional(s.union([s.string, s.number])),
			memo_union: s.optional(s.memo_union([s.string, s.number])),
			variant: s.optional(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.optional(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.optional(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.optional(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.optional(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.optional(s.integer),
			safe_integer: s.optional(s.safe_integer),
			regex: s.optional(s.regex(/x/)),
			check: s.optional(s.check((v) => v !== null)),
			check_typed: s.optional(s.check((v: string) => v !== '')),
			transform: s.optional(s.transform((v) => [v])),
			transform_typed: s.optional(s.transform((v: string) => v.length)),
			min_length: s.optional(s.min_length(1)),
			max_length: s.optional(s.max_length(1)),
			min_value: s.optional(s.min_value(1)),
			max_value: s.optional(s.max_value(1))
		});
		expectTypeOf<Pairs<Fields<Defs<(typeof _O)['def']>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('with_default in an object entry', () => {
		const _O = s.object({
			string: s.with_default(s.string, nothing),
			number: s.with_default(s.number, nothing),
			boolean: s.with_default(s.boolean, nothing),
			bigint: s.with_default(s.bigint, nothing),
			unknown: s.with_default(s.unknown, nothing),
			literal: s.with_default(s.literal('a'), nothing),
			one_of: s.with_default(s.one_of(['a', 'b']), nothing),
			optional: s.with_default(s.optional(s.string), nothing),
			nullable: s.with_default(s.nullable(s.string), nothing),
			with_default: s.with_default(s.with_default(s.string, 'x'), nothing),
			with_default_fn: s.with_default(
				s.with_default_fn(s.string, () => 'x'),
				nothing
			),
			lazy: s.with_default(
				s.lazy(() => s.string),
				nothing
			),
			message: s.with_default(s.message(s.string, 'm'), nothing),
			flavor: s.with_default(s.flavor(s.string, 'F'), nothing),
			brand: s.with_default(s.brand(s.string, 'B'), nothing),
			object: s.with_default(s.object({ a: s.string }), nothing),
			strip_object: s.with_default(s.strip_object({ a: s.string }), nothing),
			loose_object: s.with_default(s.loose_object({ a: s.string }), nothing),
			object_with_rest: s.with_default(s.object_with_rest({ a: s.string }, s.number), nothing),
			record: s.with_default(s.record(s.number), nothing),
			array: s.with_default(s.array(s.string), nothing),
			union: s.with_default(s.union([s.string, s.number]), nothing),
			memo_union: s.with_default(s.memo_union([s.string, s.number]), nothing),
			variant: s.with_default(s.variant('k', [s.object({ k: s.literal('a') })]), nothing),
			pipe: s.with_default(s.pipe(s.string, s.min_length(1)), nothing),
			pipe_check: s.with_default(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				nothing
			),
			pipe_steps: s.with_default(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				nothing
			),
			pipe_transform: s.with_default(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				nothing
			),
			integer: s.with_default(s.integer, nothing),
			safe_integer: s.with_default(s.safe_integer, nothing),
			regex: s.with_default(s.regex(/x/), nothing),
			check: s.with_default(
				s.check((v) => v !== null),
				nothing
			),
			check_typed: s.with_default(
				s.check((v: string) => v !== ''),
				nothing
			),
			transform: s.with_default(
				s.transform((v) => [v]),
				nothing
			),
			transform_typed: s.with_default(
				s.transform((v: string) => v.length),
				nothing
			),
			min_length: s.with_default(s.min_length(1), nothing),
			max_length: s.with_default(s.max_length(1), nothing),
			min_value: s.with_default(s.min_value(1), nothing),
			max_value: s.with_default(s.max_value(1), nothing)
		});
		expectTypeOf<Pairs<Fields<Defs<(typeof _O)['def']>, 'schema'>>>().toEqualTypeOf<Expected>();
	});

	test('array item', () => {
		const _leaves = {
			string: s.array(s.string),
			number: s.array(s.number),
			boolean: s.array(s.boolean),
			bigint: s.array(s.bigint),
			unknown: s.array(s.unknown),
			literal: s.array(s.literal('a')),
			one_of: s.array(s.one_of(['a', 'b'])),
			optional: s.array(s.optional(s.string)),
			nullable: s.array(s.nullable(s.string)),
			with_default: s.array(s.with_default(s.string, 'x')),
			with_default_fn: s.array(s.with_default_fn(s.string, () => 'x')),
			lazy: s.array(s.lazy(() => s.string)),
			message: s.array(s.message(s.string, 'm')),
			flavor: s.array(s.flavor(s.string, 'F')),
			brand: s.array(s.brand(s.string, 'B')),
			object: s.array(s.object({ a: s.string })),
			strip_object: s.array(s.strip_object({ a: s.string })),
			loose_object: s.array(s.loose_object({ a: s.string })),
			object_with_rest: s.array(s.object_with_rest({ a: s.string }, s.number)),
			record: s.array(s.record(s.number)),
			array: s.array(s.array(s.string)),
			union: s.array(s.union([s.string, s.number])),
			memo_union: s.array(s.memo_union([s.string, s.number])),
			variant: s.array(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.array(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.array(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.array(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.array(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.array(s.integer),
			safe_integer: s.array(s.safe_integer),
			regex: s.array(s.regex(/x/)),
			check: s.array(s.check((v) => v !== null)),
			check_typed: s.array(s.check((v: string) => v !== '')),
			transform: s.array(s.transform((v) => [v])),
			transform_typed: s.array(s.transform((v: string) => v.length)),
			min_length: s.array(s.min_length(1)),
			max_length: s.array(s.max_length(1)),
			min_value: s.array(s.min_value(1)),
			max_value: s.array(s.max_value(1))
		};
		expectTypeOf<Pairs<Defs<typeof _leaves>>>().toEqualTypeOf<Expected>();
	});

	test('array item in an object entry', () => {
		const _O = s.object({
			string: s.array(s.string),
			number: s.array(s.number),
			boolean: s.array(s.boolean),
			bigint: s.array(s.bigint),
			unknown: s.array(s.unknown),
			literal: s.array(s.literal('a')),
			one_of: s.array(s.one_of(['a', 'b'])),
			optional: s.array(s.optional(s.string)),
			nullable: s.array(s.nullable(s.string)),
			with_default: s.array(s.with_default(s.string, 'x')),
			with_default_fn: s.array(s.with_default_fn(s.string, () => 'x')),
			lazy: s.array(s.lazy(() => s.string)),
			message: s.array(s.message(s.string, 'm')),
			flavor: s.array(s.flavor(s.string, 'F')),
			brand: s.array(s.brand(s.string, 'B')),
			object: s.array(s.object({ a: s.string })),
			strip_object: s.array(s.strip_object({ a: s.string })),
			loose_object: s.array(s.loose_object({ a: s.string })),
			object_with_rest: s.array(s.object_with_rest({ a: s.string }, s.number)),
			record: s.array(s.record(s.number)),
			array: s.array(s.array(s.string)),
			union: s.array(s.union([s.string, s.number])),
			memo_union: s.array(s.memo_union([s.string, s.number])),
			variant: s.array(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.array(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.array(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.array(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.array(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.array(s.integer),
			safe_integer: s.array(s.safe_integer),
			regex: s.array(s.regex(/x/)),
			check: s.array(s.check((v) => v !== null)),
			check_typed: s.array(s.check((v: string) => v !== '')),
			transform: s.array(s.transform((v) => [v])),
			transform_typed: s.array(s.transform((v: string) => v.length)),
			min_length: s.array(s.min_length(1)),
			max_length: s.array(s.max_length(1)),
			min_value: s.array(s.min_value(1)),
			max_value: s.array(s.max_value(1))
		});
		expectTypeOf<Pairs<Defs<(typeof _O)['def']>>>().toEqualTypeOf<Expected>();
	});

	test('record value', () => {
		const _leaves = {
			string: s.record(s.string),
			number: s.record(s.number),
			boolean: s.record(s.boolean),
			bigint: s.record(s.bigint),
			unknown: s.record(s.unknown),
			literal: s.record(s.literal('a')),
			one_of: s.record(s.one_of(['a', 'b'])),
			optional: s.record(s.optional(s.string)),
			nullable: s.record(s.nullable(s.string)),
			with_default: s.record(s.with_default(s.string, 'x')),
			with_default_fn: s.record(s.with_default_fn(s.string, () => 'x')),
			lazy: s.record(s.lazy(() => s.string)),
			message: s.record(s.message(s.string, 'm')),
			flavor: s.record(s.flavor(s.string, 'F')),
			brand: s.record(s.brand(s.string, 'B')),
			object: s.record(s.object({ a: s.string })),
			strip_object: s.record(s.strip_object({ a: s.string })),
			loose_object: s.record(s.loose_object({ a: s.string })),
			object_with_rest: s.record(s.object_with_rest({ a: s.string }, s.number)),
			record: s.record(s.record(s.number)),
			array: s.record(s.array(s.string)),
			union: s.record(s.union([s.string, s.number])),
			memo_union: s.record(s.memo_union([s.string, s.number])),
			variant: s.record(s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.record(s.pipe(s.string, s.min_length(1))),
			pipe_check: s.record(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.record(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.record(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.record(s.integer),
			safe_integer: s.record(s.safe_integer),
			regex: s.record(s.regex(/x/)),
			check: s.record(s.check((v) => v !== null)),
			check_typed: s.record(s.check((v: string) => v !== '')),
			transform: s.record(s.transform((v) => [v])),
			transform_typed: s.record(s.transform((v: string) => v.length)),
			min_length: s.record(s.min_length(1)),
			max_length: s.record(s.max_length(1)),
			min_value: s.record(s.min_value(1)),
			max_value: s.record(s.max_value(1))
		};
		expectTypeOf<Pairs<Defs<typeof _leaves>>>().toEqualTypeOf<Expected>();
	});

	test('lazy', () => {
		const _leaves = {
			string: s.lazy(() => s.string),
			number: s.lazy(() => s.number),
			boolean: s.lazy(() => s.boolean),
			bigint: s.lazy(() => s.bigint),
			unknown: s.lazy(() => s.unknown),
			literal: s.lazy(() => s.literal('a')),
			one_of: s.lazy(() => s.one_of(['a', 'b'])),
			optional: s.lazy(() => s.optional(s.string)),
			nullable: s.lazy(() => s.nullable(s.string)),
			with_default: s.lazy(() => s.with_default(s.string, 'x')),
			with_default_fn: s.lazy(() => s.with_default_fn(s.string, () => 'x')),
			lazy: s.lazy(() => s.lazy(() => s.string)),
			message: s.lazy(() => s.message(s.string, 'm')),
			flavor: s.lazy(() => s.flavor(s.string, 'F')),
			brand: s.lazy(() => s.brand(s.string, 'B')),
			object: s.lazy(() => s.object({ a: s.string })),
			strip_object: s.lazy(() => s.strip_object({ a: s.string })),
			loose_object: s.lazy(() => s.loose_object({ a: s.string })),
			object_with_rest: s.lazy(() => s.object_with_rest({ a: s.string }, s.number)),
			record: s.lazy(() => s.record(s.number)),
			array: s.lazy(() => s.array(s.string)),
			union: s.lazy(() => s.union([s.string, s.number])),
			memo_union: s.lazy(() => s.memo_union([s.string, s.number])),
			variant: s.lazy(() => s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.lazy(() => s.pipe(s.string, s.min_length(1))),
			pipe_check: s.lazy(() =>
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.lazy(() =>
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.lazy(() =>
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.lazy(() => s.integer),
			safe_integer: s.lazy(() => s.safe_integer),
			regex: s.lazy(() => s.regex(/x/)),
			check: s.lazy(() => s.check((v) => v !== null)),
			check_typed: s.lazy(() => s.check((v: string) => v !== '')),
			transform: s.lazy(() => s.transform((v) => [v])),
			transform_typed: s.lazy(() => s.transform((v: string) => v.length)),
			min_length: s.lazy(() => s.min_length(1)),
			max_length: s.lazy(() => s.max_length(1)),
			min_value: s.lazy(() => s.min_value(1)),
			max_value: s.lazy(() => s.max_value(1))
		};
		expectTypeOf<Pairs<Returns<Defs<typeof _leaves>>>>().toEqualTypeOf<Expected>();
	});

	test('lazy in an object entry', () => {
		const _O = s.object({
			string: s.lazy(() => s.string),
			number: s.lazy(() => s.number),
			boolean: s.lazy(() => s.boolean),
			bigint: s.lazy(() => s.bigint),
			unknown: s.lazy(() => s.unknown),
			literal: s.lazy(() => s.literal('a')),
			one_of: s.lazy(() => s.one_of(['a', 'b'])),
			optional: s.lazy(() => s.optional(s.string)),
			nullable: s.lazy(() => s.nullable(s.string)),
			with_default: s.lazy(() => s.with_default(s.string, 'x')),
			with_default_fn: s.lazy(() => s.with_default_fn(s.string, () => 'x')),
			lazy: s.lazy(() => s.lazy(() => s.string)),
			message: s.lazy(() => s.message(s.string, 'm')),
			flavor: s.lazy(() => s.flavor(s.string, 'F')),
			brand: s.lazy(() => s.brand(s.string, 'B')),
			object: s.lazy(() => s.object({ a: s.string })),
			strip_object: s.lazy(() => s.strip_object({ a: s.string })),
			loose_object: s.lazy(() => s.loose_object({ a: s.string })),
			object_with_rest: s.lazy(() => s.object_with_rest({ a: s.string }, s.number)),
			record: s.lazy(() => s.record(s.number)),
			array: s.lazy(() => s.array(s.string)),
			union: s.lazy(() => s.union([s.string, s.number])),
			memo_union: s.lazy(() => s.memo_union([s.string, s.number])),
			variant: s.lazy(() => s.variant('k', [s.object({ k: s.literal('a') })])),
			pipe: s.lazy(() => s.pipe(s.string, s.min_length(1))),
			pipe_check: s.lazy(() =>
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			),
			pipe_steps: s.lazy(() =>
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				)
			),
			pipe_transform: s.lazy(() =>
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				)
			),
			integer: s.lazy(() => s.integer),
			safe_integer: s.lazy(() => s.safe_integer),
			regex: s.lazy(() => s.regex(/x/)),
			check: s.lazy(() => s.check((v) => v !== null)),
			check_typed: s.lazy(() => s.check((v: string) => v !== '')),
			transform: s.lazy(() => s.transform((v) => [v])),
			transform_typed: s.lazy(() => s.transform((v: string) => v.length)),
			min_length: s.lazy(() => s.min_length(1)),
			max_length: s.lazy(() => s.max_length(1)),
			min_value: s.lazy(() => s.min_value(1)),
			max_value: s.lazy(() => s.max_value(1))
		});
		expectTypeOf<Pairs<Returns<Defs<(typeof _O)['def']>>>>().toEqualTypeOf<Expected>();
	});

	test('message', () => {
		const _leaves = {
			string: s.message(s.string, 'm'),
			number: s.message(s.number, 'm'),
			boolean: s.message(s.boolean, 'm'),
			bigint: s.message(s.bigint, 'm'),
			unknown: s.message(s.unknown, 'm'),
			literal: s.message(s.literal('a'), 'm'),
			one_of: s.message(s.one_of(['a', 'b']), 'm'),
			optional: s.message(s.optional(s.string), 'm'),
			nullable: s.message(s.nullable(s.string), 'm'),
			with_default: s.message(s.with_default(s.string, 'x'), 'm'),
			with_default_fn: s.message(
				s.with_default_fn(s.string, () => 'x'),
				'm'
			),
			lazy: s.message(
				s.lazy(() => s.string),
				'm'
			),
			message: s.message(s.message(s.string, 'm'), 'm'),
			flavor: s.message(s.flavor(s.string, 'F'), 'm'),
			brand: s.message(s.brand(s.string, 'B'), 'm'),
			object: s.message(s.object({ a: s.string }), 'm'),
			strip_object: s.message(s.strip_object({ a: s.string }), 'm'),
			loose_object: s.message(s.loose_object({ a: s.string }), 'm'),
			object_with_rest: s.message(s.object_with_rest({ a: s.string }, s.number), 'm'),
			record: s.message(s.record(s.number), 'm'),
			array: s.message(s.array(s.string), 'm'),
			union: s.message(s.union([s.string, s.number]), 'm'),
			memo_union: s.message(s.memo_union([s.string, s.number]), 'm'),
			variant: s.message(s.variant('k', [s.object({ k: s.literal('a') })]), 'm'),
			pipe: s.message(s.pipe(s.string, s.min_length(1)), 'm'),
			pipe_check: s.message(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				'm'
			),
			pipe_steps: s.message(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				'm'
			),
			pipe_transform: s.message(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				'm'
			),
			integer: s.message(s.integer, 'm'),
			safe_integer: s.message(s.safe_integer, 'm'),
			regex: s.message(s.regex(/x/), 'm'),
			check: s.message(
				s.check((v) => v !== null),
				'm'
			),
			check_typed: s.message(
				s.check((v: string) => v !== ''),
				'm'
			),
			transform: s.message(
				s.transform((v) => [v]),
				'm'
			),
			transform_typed: s.message(
				s.transform((v: string) => v.length),
				'm'
			),
			min_length: s.message(s.min_length(1), 'm'),
			max_length: s.message(s.max_length(1), 'm'),
			min_value: s.message(s.min_value(1), 'm'),
			max_value: s.message(s.max_value(1), 'm')
		};
		expectTypeOf<Pairs<typeof _leaves>>().toEqualTypeOf<Expected>();
	});

	test('message in an object entry', () => {
		const _O = s.object({
			string: s.message(s.string, 'm'),
			number: s.message(s.number, 'm'),
			boolean: s.message(s.boolean, 'm'),
			bigint: s.message(s.bigint, 'm'),
			unknown: s.message(s.unknown, 'm'),
			literal: s.message(s.literal('a'), 'm'),
			one_of: s.message(s.one_of(['a', 'b']), 'm'),
			optional: s.message(s.optional(s.string), 'm'),
			nullable: s.message(s.nullable(s.string), 'm'),
			with_default: s.message(s.with_default(s.string, 'x'), 'm'),
			with_default_fn: s.message(
				s.with_default_fn(s.string, () => 'x'),
				'm'
			),
			lazy: s.message(
				s.lazy(() => s.string),
				'm'
			),
			message: s.message(s.message(s.string, 'm'), 'm'),
			flavor: s.message(s.flavor(s.string, 'F'), 'm'),
			brand: s.message(s.brand(s.string, 'B'), 'm'),
			object: s.message(s.object({ a: s.string }), 'm'),
			strip_object: s.message(s.strip_object({ a: s.string }), 'm'),
			loose_object: s.message(s.loose_object({ a: s.string }), 'm'),
			object_with_rest: s.message(s.object_with_rest({ a: s.string }, s.number), 'm'),
			record: s.message(s.record(s.number), 'm'),
			array: s.message(s.array(s.string), 'm'),
			union: s.message(s.union([s.string, s.number]), 'm'),
			memo_union: s.message(s.memo_union([s.string, s.number]), 'm'),
			variant: s.message(s.variant('k', [s.object({ k: s.literal('a') })]), 'm'),
			pipe: s.message(s.pipe(s.string, s.min_length(1)), 'm'),
			pipe_check: s.message(
				s.pipe(
					s.string,
					s.check((v) => v !== '')
				),
				'm'
			),
			pipe_steps: s.message(
				s.pipe(
					s.string,
					s.min_length(1),
					s.check((v) => v !== '')
				),
				'm'
			),
			pipe_transform: s.message(
				s.pipe(
					s.string,
					s.transform((v) => v.length)
				),
				'm'
			),
			integer: s.message(s.integer, 'm'),
			safe_integer: s.message(s.safe_integer, 'm'),
			regex: s.message(s.regex(/x/), 'm'),
			check: s.message(
				s.check((v) => v !== null),
				'm'
			),
			check_typed: s.message(
				s.check((v: string) => v !== ''),
				'm'
			),
			transform: s.message(
				s.transform((v) => [v]),
				'm'
			),
			transform_typed: s.message(
				s.transform((v: string) => v.length),
				'm'
			),
			min_length: s.message(s.min_length(1), 'm'),
			max_length: s.message(s.max_length(1), 'm'),
			min_value: s.message(s.min_value(1), 'm'),
			max_value: s.message(s.max_value(1), 'm')
		});
		expectTypeOf<Pairs<(typeof _O)['def']>>().toEqualTypeOf<Expected>();
	});
});
