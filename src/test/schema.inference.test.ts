import { describe, test, assert, expectTypeOf } from 'vitest';

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

// what a `keyed_record` of the keys `a` and `b` gives, named for the same reason
interface KeysAB {
	a?: number;
	b?: number;
}

// what each leaf infers wherever its type parameters are inferred from its arguments alone
interface Expected {
	string: [string, string];
	number: [number, number];
	boolean: [boolean, boolean];
	bigint: [bigint, bigint];
	unknown: [unknown, unknown];
	literal: ['a', 'a'];
	void: [void, void];
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
	keyed_record: [KeysAB, KeysAB];
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
	uuid: [string, string];
	to_lower_case: [string, string];
	to_integer: [number, string];
	iso_datetime: [string, string];
	regex: [string, string];
	check: [unknown, unknown];
	check_at: [unknown, unknown];
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
	check_at: [string, string];
	check_typed: [string, string];
	transform: [Array<string>, string];
	transform_typed: [number, string];
	min_length: [string, string];
	max_length: [string, string];
	integer: [number, number];
	safe_integer: [number, number];
	uuid: [string, string];
	to_lower_case: [string, string];
	to_integer: [number, string];
	iso_datetime: [string, string];
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
			void: s.void,
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
			keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
			uuid: s.uuid,
			to_lower_case: s.to_lower_case,
			to_integer: s.to_integer(),
			iso_datetime: s.iso_datetime,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_at: s.check_at('k', (v) => v !== null),
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
			void: s.void,
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
			keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
			uuid: s.uuid,
			to_lower_case: s.to_lower_case,
			to_integer: s.to_integer(),
			iso_datetime: s.iso_datetime,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_at: s.check_at('k', (v) => v !== null),
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
			void: s.void,
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
			keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
			uuid: s.uuid,
			to_lower_case: s.to_lower_case,
			to_integer: s.to_integer(),
			iso_datetime: s.iso_datetime,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_at: s.check_at('k', (v) => v !== null),
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
			void: s.void,
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
			keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
			uuid: s.uuid,
			to_lower_case: s.to_lower_case,
			to_integer: s.to_integer(),
			iso_datetime: s.iso_datetime,
			regex: s.regex(/x/),
			check: s.check((v) => v !== null),
			check_at: s.check_at('k', (v) => v !== null),
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
				void: s.void,
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
				keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
				uuid: s.uuid,
				to_lower_case: s.to_lower_case,
				to_integer: s.to_integer(),
				iso_datetime: s.iso_datetime,
				regex: s.regex(/x/),
				check: s.check((v) => v !== null),
				check_at: s.check_at('k', (v) => v !== null),
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
			void: s.object_with_rest({}, s.void),
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
			keyed_record: s.object_with_rest({}, s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.object_with_rest({}, s.uuid),
			to_lower_case: s.object_with_rest({}, s.to_lower_case),
			to_integer: s.object_with_rest({}, s.to_integer()),
			iso_datetime: s.object_with_rest({}, s.iso_datetime),
			regex: s.object_with_rest({}, s.regex(/x/)),
			check: s.object_with_rest(
				{},
				s.check((v) => v !== null)
			),
			check_at: s.object_with_rest(
				{},
				s.check_at('k', (v) => v !== null)
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
			void: s.union([s.void]),
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
			keyed_record: s.union([s.keyed_record(s.one_of(['a', 'b']), s.number)]),
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
			uuid: s.union([s.uuid]),
			to_lower_case: s.union([s.to_lower_case]),
			to_integer: s.union([s.to_integer()]),
			iso_datetime: s.union([s.iso_datetime]),
			regex: s.union([s.regex(/x/)]),
			check: s.union([s.check((v) => v !== null)]),
			check_at: s.union([s.check_at('k', (v) => v !== null)]),
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
			void: s.union([s.void]),
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
			keyed_record: s.union([s.keyed_record(s.one_of(['a', 'b']), s.number)]),
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
			uuid: s.union([s.uuid]),
			to_lower_case: s.union([s.to_lower_case]),
			to_integer: s.union([s.to_integer()]),
			iso_datetime: s.union([s.iso_datetime]),
			regex: s.union([s.regex(/x/)]),
			check: s.union([s.check((v) => v !== null)]),
			check_at: s.union([s.check_at('k', (v) => v !== null)]),
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
				void: s.void,
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
				keyed_record: s.keyed_record(s.one_of(['a', 'b']), s.number),
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
				uuid: s.uuid,
				to_lower_case: s.to_lower_case,
				to_integer: s.to_integer(),
				iso_datetime: s.iso_datetime,
				regex: s.regex(/x/),
				check: s.check((v) => v !== null),
				check_at: s.check_at('k', (v) => v !== null),
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
			void: s.pipe(
				s.void,
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
			keyed_record: s.pipe(
				s.keyed_record(s.one_of(['a', 'b']), s.number),
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
			uuid: s.pipe(
				s.uuid,
				s.check((v) => v !== undefined)
			),
			to_lower_case: s.pipe(
				s.to_lower_case,
				s.check((v) => v !== undefined)
			),
			to_integer: s.pipe(
				s.to_integer(),
				s.check((v) => v !== undefined)
			),
			iso_datetime: s.pipe(
				s.iso_datetime,
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
			check_at: s.pipe(
				s.check_at('k', (v) => v !== null),
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
			check_at: s.pipe(
				s.string,
				s.check_at('length', (v) => v !== null)
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
			uuid: s.pipe(s.string, s.uuid),
			to_lower_case: s.pipe(s.string, s.to_lower_case),
			to_integer: s.pipe(s.string, s.to_integer()),
			iso_datetime: s.pipe(s.string, s.iso_datetime),
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
			check_at: s.pipe(
				s.string,
				s.check_at('length', (v) => v !== null)
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
			uuid: s.pipe(s.string, s.uuid),
			to_lower_case: s.pipe(s.string, s.to_lower_case),
			to_integer: s.pipe(s.string, s.to_integer()),
			iso_datetime: s.pipe(s.string, s.iso_datetime),
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
		const _Uuid = s.pipe(s.brand(s.string, 'B'), s.uuid, s.iso_datetime);
		expectTypeOf<s.Infer<typeof _Uuid>>().toEqualTypeOf<s.Branded<string, 'B'>>();
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
			void: s.optional(s.void),
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
			keyed_record: s.optional(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.optional(s.uuid),
			to_lower_case: s.optional(s.to_lower_case),
			to_integer: s.optional(s.to_integer()),
			iso_datetime: s.optional(s.iso_datetime),
			regex: s.optional(s.regex(/x/)),
			check: s.optional(s.check((v) => v !== null)),
			check_at: s.optional(s.check_at('k', (v) => v !== null)),
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
			void: s.nullable(s.void),
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
			keyed_record: s.nullable(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.nullable(s.uuid),
			to_lower_case: s.nullable(s.to_lower_case),
			to_integer: s.nullable(s.to_integer()),
			iso_datetime: s.nullable(s.iso_datetime),
			regex: s.nullable(s.regex(/x/)),
			check: s.nullable(s.check((v) => v !== null)),
			check_at: s.nullable(s.check_at('k', (v) => v !== null)),
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
			void: s.with_default(s.void, nothing),
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
			keyed_record: s.with_default(s.keyed_record(s.one_of(['a', 'b']), s.number), nothing),
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
			uuid: s.with_default(s.uuid, nothing),
			to_lower_case: s.with_default(s.to_lower_case, nothing),
			to_integer: s.with_default(s.to_integer(), nothing),
			iso_datetime: s.with_default(s.iso_datetime, nothing),
			regex: s.with_default(s.regex(/x/), nothing),
			check: s.with_default(
				s.check((v) => v !== null),
				nothing
			),
			check_at: s.with_default(
				s.check_at('k', (v) => v !== null),
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
			void: s.with_default_fn(s.void, () => nothing),
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
			keyed_record: s.with_default_fn(
				s.keyed_record(s.one_of(['a', 'b']), s.number),
				() => nothing
			),
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
			uuid: s.with_default_fn(s.uuid, () => nothing),
			to_lower_case: s.with_default_fn(s.to_lower_case, () => nothing),
			to_integer: s.with_default_fn(s.to_integer(), () => nothing),
			iso_datetime: s.with_default_fn(s.iso_datetime, () => nothing),
			regex: s.with_default_fn(s.regex(/x/), () => nothing),
			check: s.with_default_fn(
				s.check((v) => v !== null),
				() => nothing
			),
			check_at: s.with_default_fn(
				s.check_at('k', (v) => v !== null),
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
			void: s.optional(s.void),
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
			keyed_record: s.optional(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.optional(s.uuid),
			to_lower_case: s.optional(s.to_lower_case),
			to_integer: s.optional(s.to_integer()),
			iso_datetime: s.optional(s.iso_datetime),
			regex: s.optional(s.regex(/x/)),
			check: s.optional(s.check((v) => v !== null)),
			check_at: s.optional(s.check_at('k', (v) => v !== null)),
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
			void: s.with_default(s.void, nothing),
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
			keyed_record: s.with_default(s.keyed_record(s.one_of(['a', 'b']), s.number), nothing),
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
			uuid: s.with_default(s.uuid, nothing),
			to_lower_case: s.with_default(s.to_lower_case, nothing),
			to_integer: s.with_default(s.to_integer(), nothing),
			iso_datetime: s.with_default(s.iso_datetime, nothing),
			regex: s.with_default(s.regex(/x/), nothing),
			check: s.with_default(
				s.check((v) => v !== null),
				nothing
			),
			check_at: s.with_default(
				s.check_at('k', (v) => v !== null),
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
			void: s.array(s.void),
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
			keyed_record: s.array(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.array(s.uuid),
			to_lower_case: s.array(s.to_lower_case),
			to_integer: s.array(s.to_integer()),
			iso_datetime: s.array(s.iso_datetime),
			regex: s.array(s.regex(/x/)),
			check: s.array(s.check((v) => v !== null)),
			check_at: s.array(s.check_at('k', (v) => v !== null)),
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
			void: s.array(s.void),
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
			keyed_record: s.array(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.array(s.uuid),
			to_lower_case: s.array(s.to_lower_case),
			to_integer: s.array(s.to_integer()),
			iso_datetime: s.array(s.iso_datetime),
			regex: s.array(s.regex(/x/)),
			check: s.array(s.check((v) => v !== null)),
			check_at: s.array(s.check_at('k', (v) => v !== null)),
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
			void: s.record(s.void),
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
			keyed_record: s.record(s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.record(s.uuid),
			to_lower_case: s.record(s.to_lower_case),
			to_integer: s.record(s.to_integer()),
			iso_datetime: s.record(s.iso_datetime),
			regex: s.record(s.regex(/x/)),
			check: s.record(s.check((v) => v !== null)),
			check_at: s.record(s.check_at('k', (v) => v !== null)),
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
			void: s.lazy(() => s.void),
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
			keyed_record: s.lazy(() => s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.lazy(() => s.uuid),
			to_lower_case: s.lazy(() => s.to_lower_case),
			to_integer: s.lazy(() => s.to_integer()),
			iso_datetime: s.lazy(() => s.iso_datetime),
			regex: s.lazy(() => s.regex(/x/)),
			check: s.lazy(() => s.check((v) => v !== null)),
			check_at: s.lazy(() => s.check_at('k', (v) => v !== null)),
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
			void: s.lazy(() => s.void),
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
			keyed_record: s.lazy(() => s.keyed_record(s.one_of(['a', 'b']), s.number)),
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
			uuid: s.lazy(() => s.uuid),
			to_lower_case: s.lazy(() => s.to_lower_case),
			to_integer: s.lazy(() => s.to_integer()),
			iso_datetime: s.lazy(() => s.iso_datetime),
			regex: s.lazy(() => s.regex(/x/)),
			check: s.lazy(() => s.check((v) => v !== null)),
			check_at: s.lazy(() => s.check_at('k', (v) => v !== null)),
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
			void: s.message(s.void, 'm'),
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
			keyed_record: s.message(s.keyed_record(s.one_of(['a', 'b']), s.number), 'm'),
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
			uuid: s.message(s.uuid, 'm'),
			to_lower_case: s.message(s.to_lower_case, 'm'),
			to_integer: s.message(s.to_integer(), 'm'),
			iso_datetime: s.message(s.iso_datetime, 'm'),
			regex: s.message(s.regex(/x/), 'm'),
			check: s.message(
				s.check((v) => v !== null),
				'm'
			),
			check_at: s.message(
				s.check_at('k', (v) => v !== null),
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
			void: s.message(s.void, 'm'),
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
			keyed_record: s.message(s.keyed_record(s.one_of(['a', 'b']), s.number), 'm'),
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
			uuid: s.message(s.uuid, 'm'),
			to_lower_case: s.message(s.to_lower_case, 'm'),
			to_integer: s.message(s.to_integer(), 'm'),
			iso_datetime: s.message(s.iso_datetime, 'm'),
			regex: s.message(s.regex(/x/), 'm'),
			check: s.message(
				s.check((v) => v !== null),
				'm'
			),
			check_at: s.message(
				s.check_at('k', (v) => v !== null),
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

// object operations as spreads of `def`, which the library has no helper for
describe('key modifiers by wrapper', () => {
	// each entry's key in the input and the output: optional where the run
	// takes a missing key, and where it can leave one out, `?:` against `:`
	const passes = s.check((v: unknown) => v !== 0);
	const _O = s.object({
		string: s.string,
		unknown: s.unknown,
		void: s.void,
		optional: s.optional(s.string),
		optional_void: s.optional(s.void),
		with_default: s.with_default(s.string, 'd'),
		with_default_fn: s.with_default_fn(s.string, () => 'd'),
		nullable: s.nullable(s.string),
		nullable_unknown: s.nullable(s.unknown),
		nullable_optional: s.nullable(s.optional(s.string)),
		nullable_with_default: s.nullable(s.with_default(s.string, 'd')),
		lazy_unknown: s.lazy(() => s.unknown),
		lazy_optional: s.lazy(() => s.optional(s.string)),
		lazy_with_default: s.lazy(() => s.with_default(s.string, 'd')),
		nullable_lazy_optional: s.nullable(s.lazy(() => s.optional(s.string))),
		// under a `nullable` or a `lazy` a pipe's steps run on a missing key
		nullable_pipe_optional: s.nullable(s.pipe(s.optional(s.string), passes)),
		nullable_pipe_optional_transform: s.nullable(
			s.pipe(
				s.optional(s.string),
				s.transform((v) => v ?? 'x')
			)
		),
		lazy_pipe_optional_transform: s.lazy(() =>
			s.pipe(
				s.optional(s.string),
				s.transform((v) => v ?? 'x')
			)
		),
		pipe_unknown: s.pipe(s.unknown, passes),
		pipe_optional: s.pipe(s.optional(s.string), passes),
		pipe_optional_transform: s.pipe(
			s.optional(s.string),
			s.transform((v) => v ?? 'x')
		),
		pipe_pipe_optional: s.pipe(s.pipe(s.optional(s.string), passes), passes),
		pipe_with_default: s.pipe(s.with_default(s.string, 'd'), passes),
		pipe_nullable_optional: s.pipe(s.nullable(s.optional(s.string)), passes),
		union_unknown: s.union([s.string, s.unknown]),
		union_optional: s.union([s.number, s.optional(s.string)]),
		union_with_default: s.union([s.number, s.with_default(s.string, 'd')]),
		union_unknown_with_default: s.union([s.unknown, s.with_default(s.string, 'd')]),
		message_optional: s.message(s.optional(s.string), 'm'),
		message_pipe_optional: s.message(s.pipe(s.optional(s.string), passes), 'm'),
		meta_pipe_optional: meta(s.pipe(s.optional(s.string), passes), { description: 'd' }),
		brand_optional: s.brand(s.optional(s.string), 'B'),
		flavor_nullable_optional: s.flavor(s.nullable(s.optional(s.string)), 'F'),
		// a `brand` or `flavor` of a `pipe` keeps its first schema
		brand_pipe_optional: s.brand(s.pipe(s.optional(s.string), passes), 'B'),
		flavor_pipe_optional: s.flavor(s.pipe(s.optional(s.string), passes), 'F'),
		brand_pipe_pipe_optional: s.brand(s.pipe(s.pipe(s.optional(s.string), passes), passes), 'B'),
		brand_pipe_string: s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid'),
		flavor_pipe_unknown: s.flavor(s.pipe(s.unknown, passes), 'F'),
		with_default_optional: s.with_default(s.optional(s.string), 'd'),
		with_default_fn_optional: s.with_default_fn(s.optional(s.string), () => 'd')
	});

	test('the input', () => {
		expectTypeOf<s.InferInput<typeof _O>>().toEqualTypeOf<{
			string: string;
			unknown: unknown;
			void: void;
			nullable: string | null;
			nullable_unknown: unknown;
			lazy_unknown: unknown;
			pipe_unknown: unknown;
			union_unknown: unknown;
			brand_pipe_string: string;
			flavor_pipe_unknown: unknown;
			optional?: string | undefined;
			optional_void?: void | undefined;
			with_default?: string | undefined;
			with_default_fn?: string | undefined;
			nullable_optional?: string | null | undefined;
			nullable_with_default?: string | null | undefined;
			lazy_optional?: string | undefined;
			lazy_with_default?: string | undefined;
			nullable_lazy_optional?: string | null | undefined;
			nullable_pipe_optional?: string | null | undefined;
			nullable_pipe_optional_transform?: string | null | undefined;
			lazy_pipe_optional_transform?: string | undefined;
			pipe_optional?: string | undefined;
			pipe_optional_transform?: string | undefined;
			pipe_pipe_optional?: string | undefined;
			pipe_with_default?: string | undefined;
			pipe_nullable_optional?: string | null | undefined;
			union_optional?: string | number | undefined;
			union_with_default?: string | number | undefined;
			union_unknown_with_default?: unknown;
			message_optional?: string | undefined;
			message_pipe_optional?: string | undefined;
			meta_pipe_optional?: string | undefined;
			brand_optional?: string | undefined;
			flavor_nullable_optional?: string | null | undefined;
			brand_pipe_optional?: string | undefined;
			flavor_pipe_optional?: string | undefined;
			brand_pipe_pipe_optional?: string | undefined;
			with_default_optional?: string | undefined;
			with_default_fn_optional?: string | undefined;
		}>();
	});

	test('the output', () => {
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{
			string: string;
			unknown: unknown;
			void: void;
			with_default: string;
			with_default_fn: string;
			nullable: string | null;
			nullable_unknown: unknown;
			nullable_with_default: string | null;
			lazy_unknown: unknown;
			lazy_with_default: string;
			pipe_unknown: unknown;
			pipe_with_default: string;
			union_unknown: unknown;
			union_with_default: string | number;
			// the steps run on the `undefined` of a missing key, and the transform fills it
			nullable_pipe_optional_transform: string | null;
			lazy_pipe_optional_transform: string;
			brand_pipe_string: s.Branded<string, 'Uuid'>;
			flavor_pipe_unknown: s.Flavored<unknown, 'F'>;
			with_default_optional: string;
			with_default_fn_optional: string;
			optional?: string | undefined;
			optional_void?: void | undefined;
			nullable_optional?: string | null | undefined;
			lazy_optional?: string | undefined;
			nullable_lazy_optional?: string | null | undefined;
			nullable_pipe_optional?: string | null | undefined;
			pipe_optional?: string | undefined;
			// no step runs for a missing key, so the transform writes none
			pipe_optional_transform?: string;
			pipe_pipe_optional?: string | undefined;
			pipe_nullable_optional?: string | null | undefined;
			union_optional?: string | number | undefined;
			// the `unknown` matches a missing key again, and leaves it out
			union_unknown_with_default?: unknown;
			message_optional?: string | undefined;
			message_pipe_optional?: string | undefined;
			meta_pipe_optional?: string | undefined;
			brand_optional?: s.Branded<string | undefined, 'B'>;
			flavor_nullable_optional?: s.Flavored<string | null | undefined, 'F'>;
			brand_pipe_optional?: s.Branded<string | undefined, 'B'>;
			flavor_pipe_optional?: s.Flavored<string | undefined, 'F'>;
			brand_pipe_pipe_optional?: s.Branded<string | undefined, 'B'>;
		}>();
	});

	test('the runtime agrees', () => {
		// every key the input type lets be missing, a missing key matches
		const missing = [
			'optional',
			'optional_void',
			'with_default',
			'with_default_fn',
			'nullable_optional',
			'nullable_with_default',
			'lazy_optional',
			'lazy_with_default',
			'nullable_lazy_optional',
			'nullable_pipe_optional',
			'nullable_pipe_optional_transform',
			'lazy_pipe_optional_transform',
			'pipe_optional',
			'pipe_optional_transform',
			'pipe_pipe_optional',
			'pipe_with_default',
			'pipe_nullable_optional',
			'union_optional',
			'union_with_default',
			'union_unknown_with_default',
			'message_optional',
			'message_pipe_optional',
			'meta_pipe_optional',
			'brand_optional',
			'flavor_nullable_optional',
			'brand_pipe_optional',
			'flavor_pipe_optional',
			'brand_pipe_pipe_optional',
			'with_default_optional',
			'with_default_fn_optional'
		] as const;
		const required = Object.keys(_O.def).filter(
			(k) => !(missing as ReadonlyArray<string>).includes(k)
		);
		for (const key of missing) {
			const entry = s.object({ [key]: _O.def[key] });
			assert(s.is(entry, {}), key);
		}
		for (const key of required) {
			const entry = s.object({ [key]: _O.def[key as keyof typeof _O.def] });
			assert(!s.is(entry, {}), key);
		}
		// and a key the output type requires is there
		const output = s.parse_or_throw(
			s.object({
				with_default_optional: _O.def.with_default_optional,
				nullable_with_default: _O.def.nullable_with_default,
				pipe_with_default: _O.def.pipe_with_default,
				pipe_optional_transform: _O.def.pipe_optional_transform,
				nullable_pipe_optional_transform: _O.def.nullable_pipe_optional_transform,
				lazy_pipe_optional_transform: _O.def.lazy_pipe_optional_transform,
				brand_pipe_optional: _O.def.brand_pipe_optional
			}),
			{}
		);
		assert.deepEqual(output, {
			with_default_optional: 'd',
			nullable_with_default: 'd',
			pipe_with_default: 'd',
			nullable_pipe_optional_transform: 'x',
			lazy_pipe_optional_transform: 'x'
		});
	});
});

describe('defaults, the pipe cap, and generic helpers', () => {
	test('a default that is not undefined takes the undefined of an optional out of the output', () => {
		const _a = s.with_default(s.optional(s.string), 'd');
		expectTypeOf<s.Infer<typeof _a>>().toEqualTypeOf<string>();
		expectTypeOf<s.InferInput<typeof _a>>().toEqualTypeOf<string | undefined>();
		assert.strictEqual(s.parse_or_throw(_a, undefined), 'd');
		// a default of `undefined`, or of a type that may be, keeps it
		const _b = s.with_default(s.optional(s.string), undefined);
		expectTypeOf<s.Infer<typeof _b>>().toEqualTypeOf<string | undefined>();
		const maybe = 'd' as string | undefined;
		const _c = s.with_default(s.optional(s.string), maybe);
		expectTypeOf<s.Infer<typeof _c>>().toEqualTypeOf<string | undefined>();
		const _d = s.with_default_fn(s.optional(s.string), () => 'd');
		expectTypeOf<s.Infer<typeof _d>>().toEqualTypeOf<string>();
		const _e = s.with_default_fn(s.optional(s.string), () => maybe);
		expectTypeOf<s.Infer<typeof _e>>().toEqualTypeOf<string | undefined>();
		// a nullable keeps its null
		const _f = s.with_default(s.nullable(s.optional(s.string)), null);
		expectTypeOf<s.Infer<typeof _f>>().toEqualTypeOf<string | null>();
		const _g = s.with_default(s.nullable(s.optional(s.string)), 'd');
		expectTypeOf<s.Infer<typeof _g>>().toEqualTypeOf<string | null>();
		// any other schema keeps its output, as it can give `undefined` for a value
		// that isn't, as a `transform` can
		const maybe_out = s.pipe(
			s.string,
			s.transform((v: string): string | undefined => v || undefined)
		);
		const _h = s.with_default(maybe_out, 'd');
		expectTypeOf<s.Infer<typeof _h>>().toEqualTypeOf<string | undefined>();
		assert.strictEqual(s.parse_or_throw(_h, ''), undefined);
		const _i = s.with_default_fn(maybe_out, () => 'd');
		expectTypeOf<s.Infer<typeof _i>>().toEqualTypeOf<string | undefined>();
		// an `optional` of it gives what it gives
		const _j = s.with_default(s.optional(maybe_out), 'd');
		expectTypeOf<s.Infer<typeof _j>>().toEqualTypeOf<string | undefined>();
		assert.strictEqual(s.parse_or_throw(_j, ''), undefined);
		const _k = s.with_default(s.nullable(s.string), 'd');
		expectTypeOf<s.Infer<typeof _k>>().toEqualTypeOf<string | null>();
		// a brand or a flavor of the optional is kept, and refuses a plain default
		const Uuid = s.brand(s.optional(s.pipe(s.string, s.uuid)), 'Uuid');
		const _l = s.with_default(
			Uuid,
			'123e4567-e89b-42d3-a456-426614174000' as s.Branded<string, 'Uuid'>
		);
		expectTypeOf<s.Infer<typeof _l>>().toEqualTypeOf<s.Branded<string, 'Uuid'>>();
		// @ts-expect-error a default of the output, which is branded
		s.with_default(Uuid, 'not a uuid');
		// @ts-expect-error the same through a nullable
		s.with_default(s.nullable(Uuid), 'not a uuid');
		const _m = s.with_default(s.nullable(Uuid), null);
		expectTypeOf<s.Infer<typeof _m>>().toEqualTypeOf<s.Branded<string, 'Uuid'> | null>();
		const _n = s.with_default(s.flavor(s.optional(s.string), 'F'), 'd');
		expectTypeOf<s.Infer<typeof _n>>().toEqualTypeOf<s.Flavored<string, 'F'>>();
		const _o = s.with_default_fn(s.nullable(s.flavor(s.optional(s.string), 'F')), () => 'd');
		expectTypeOf<s.Infer<typeof _o>>().toEqualTypeOf<s.Flavored<string, 'F'> | null>();
		// a brand of an optional of what can give `undefined` keeps that `undefined`
		const _p = s.with_default(s.brand(s.optional(maybe_out), 'B'), 'd' as s.Branded<string, 'B'>);
		expectTypeOf<s.Infer<typeof _p>>().toEqualTypeOf<s.Branded<string, 'B'> | undefined>();
		// a generic schema's output may be `undefined`, so it is kept
		const _generic = <T extends s.Schema>(schema: T, value: s.Infer<T>) =>
			s.with_default(schema, value);
		expectTypeOf<s.Infer<ReturnType<typeof _generic<typeof _a>>>>().toEqualTypeOf<string>();
		// @ts-expect-error a default is of the schema's output
		s.with_default(s.optional(s.string), 1);
	});

	test('a pipe that starts with a pipe starts with what that one starts with', () => {
		const Digits = s.pipe(
			s.string,
			s.transform((v: string) => v.trim()),
			s.regex(/^\d+$/),
			s.transform(Number)
		);
		// a declared type of the pipe names its first schema, as the runtime reads it
		const env_integer = (min: number): s.PipeSchema<number, typeof s.string> =>
			s.pipe(Digits, s.safe_integer, s.min_value(min), s.max_value(9));
		const _integer = env_integer(0);
		expectTypeOf<NonNullable<(typeof _integer)['~types']>['first']>().toEqualTypeOf<
			typeof s.string
		>();
		const _nested = s.pipe(
			s.pipe(s.pipe(s.string, s.min_length(1)), s.max_length(9)),
			s.regex(/a/)
		);
		expectTypeOf<NonNullable<(typeof _nested)['~types']>['first']>().toEqualTypeOf<
			typeof s.string
		>();
		assert.strictEqual(s.parse_or_throw(env_integer(0), ' 7 '), 7);
	});

	test('a pipe takes one to four actions, and nests for more', () => {
		const a = s.min_length(1);
		const _four = s.pipe(s.string, a, a, a, a);
		expectTypeOf<s.Infer<typeof _four>>().toEqualTypeOf<string>();
		// @ts-expect-error a fifth action has no overload
		s.pipe(s.string, a, a, a, a, a);
		const _five = s.pipe(s.pipe(s.string, a, a, a, a), s.max_length(9));
		expectTypeOf<s.Infer<typeof _five>>().toEqualTypeOf<string>();
	});

	test('Infer of a bare Schema, AnySchema, and an intersection', () => {
		expectTypeOf<s.Infer<s.Schema>>().toEqualTypeOf<unknown>();
		expectTypeOf<s.InferInput<s.Schema>>().toEqualTypeOf<unknown>();
		expectTypeOf<s.Infer<s.AnySchema>>().toBeAny();
		expectTypeOf<s.InferInput<s.AnySchema>>().toBeAny();
		const _O = s.object({ a: s.string });
		// an intersection's `run` is an overload, and `ReturnType` reads its last, `Schema`'s
		expectTypeOf<s.Infer<typeof _O & s.Schema>>().toEqualTypeOf<unknown>();
		// a test reads the schema's own
		type Output<T> = T extends s.Schema ? s.Infer<T> : never;
		expectTypeOf<Output<typeof _O>>().toEqualTypeOf<{ a: string }>();
		expectTypeOf<Output<{ parse: () => 1 }>>().toBeNever();
	});
});

describe('composing object schemas', () => {
	const Base = s.object({ id: s.string, count: s.number, secret: s.string });

	test('extend, override, merge, omit, and pick', () => {
		const _Extended = s.object({ ...Base.def, label: s.optional(s.string) });
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<{
			id: string;
			count: number;
			secret: string;
			label?: string | undefined;
		}>();
		const _Overridden = s.object({ ...Base.def, count: s.string });
		expectTypeOf<s.Infer<typeof _Overridden>>().toEqualTypeOf<{
			id: string;
			count: string;
			secret: string;
		}>();
		const _Merged = s.object({ ...Base.def, ...s.object({ count: s.boolean }).def });
		expectTypeOf<s.Infer<typeof _Merged>>().toEqualTypeOf<{
			id: string;
			count: boolean;
			secret: string;
		}>();
		const { secret: _, ...rest } = Base.def;
		const _Omitted = s.object(rest);
		expectTypeOf<s.Infer<typeof _Omitted>>().toEqualTypeOf<{ id: string; count: number }>();
		const _Picked = s.object({ id: Base.def.id });
		expectTypeOf<s.Infer<typeof _Picked>>().toEqualTypeOf<{ id: string }>();
	});

	test('strictness, partial by hand, and object_with_rest', () => {
		const _Loose = s.loose_object(Base.def);
		expectTypeOf<s.Infer<typeof _Loose>>().toEqualTypeOf<
			{ id: string; count: number; secret: string } & Record<string, unknown>
		>();
		const Settings = s.object({ name: s.string, theme: s.with_default(s.string, 'dark') });
		const _Patch = s.object({ name: s.optional(Settings.def.name), theme: Settings.def.theme });
		// the default fills the key in, so the output still has it
		expectTypeOf<s.Infer<typeof _Patch>>().toEqualTypeOf<{
			name?: string | undefined;
			theme: string;
		}>();
		expectTypeOf<s.InferInput<typeof _Patch>>().toEqualTypeOf<{
			name?: string | undefined;
			theme?: string | undefined;
		}>();
		const Counts = s.object_with_rest({ id: s.string }, s.number);
		const _Extended = s.object_with_rest(
			{ ...Counts.def.entries, label: s.string },
			Counts.def.rest
		);
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<
			{ id: string; label: string } & Record<string, number>
		>();
		// @ts-expect-error its def is `{entries, rest}`, not entries
		s.object({ ...Counts.def, label: s.string });
	});

	test('a refined base has a pipe for its def, and is extended bare', () => {
		const Refined = s.pipe(
			Base,
			s.check((v) => v.id !== '')
		);
		// @ts-expect-error a pipe's def is not entries
		s.object({ ...Refined.def, label: s.string }); // eslint-disable-line @typescript-eslint/no-misused-spread
		const _Extended = s.pipe(
			s.object({ ...Base.def, label: s.string }),
			s.check((v) => v.id !== v.label)
		);
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<{
			id: string;
			count: number;
			secret: string;
			label: string;
		}>();
	});

	test('a brand on the base is not carried over', () => {
		const Branded = s.brand(Base, 'B');
		const _Extended = s.object({ ...Branded.def, label: s.string });
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<{
			id: string;
			count: number;
			secret: string;
			label: string;
		}>();
	});

	test('a generic extender types its entries as `Omit<T, keyof U> & U`', () => {
		// a generic spread types as `T & U`, so a key both have collapses
		const _with_count_spread = <T extends s.SchemaEntries>(base: s.Schema<any, any, 'object', T>) =>
			s.object({ ...base.def, count: s.boolean });
		expectTypeOf<s.Infer<ReturnType<typeof _with_count_spread<typeof Base.def>>>>().toEqualTypeOf<{
			id: string;
			count?: undefined;
			secret: string;
		}>();
		const extend = <T extends s.SchemaEntries, U extends s.SchemaEntries>(
			base: s.Schema<any, any, 'object', T>,
			entries: U
		) => {
			const merged: Omit<T, keyof U> & U = { ...base.def, ...entries };
			return s.object(merged);
		};
		const _Extended = extend(Base, { count: s.boolean });
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<{
			id: string;
			count: boolean;
			secret: string;
		}>();
	});
});

describe('empty object schemas', () => {
	// `{}` is any value but `null` and `undefined`, so an empty `object` or
	// `strip_object` infers a record with no keys instead
	const take = <T>(_value: T): void => {};
	// the entries of `object({})`, an empty object type on purpose
	type NoEntries = Record<never, never>; // eslint-disable-line @typescript-eslint/no-generated-empty-object-type

	test('object and strip_object output a record with no keys', () => {
		const _Object = s.object({});
		expectTypeOf<s.Infer<typeof _Object>>().toEqualTypeOf<Record<string, never>>();
		const _Strip = s.strip_object({});
		expectTypeOf<s.Infer<typeof _Strip>>().toEqualTypeOf<Record<string, never>>();
		// @ts-expect-error a number is not an empty object
		take<s.Infer<typeof _Object>>(5);
		// @ts-expect-error nor is an object with a key
		take<s.Infer<typeof _Strip>>({ a: 1 });
		take<s.Infer<typeof _Object>>({});
	});

	test('a union of entries keeps each member', () => {
		const _entries = {} as { a: typeof s.string } | { b: typeof s.number };
		expectTypeOf<s.Infer<ReturnType<typeof s.object<typeof _entries>>>>().toEqualTypeOf<
			{ a: string } | { b: number }
		>();
		expectTypeOf<s.InferInput<ReturnType<typeof s.strip_object<typeof _entries>>>>().toEqualTypeOf<
			{ a: string } | { b: number }
		>();
		expectTypeOf<s.InferInput<ReturnType<typeof s.object<typeof _entries>>>>().toEqualTypeOf<
			{ a: string } | { b: number }
		>();
		const _mixed = {} as { a: typeof s.string } | NoEntries;
		expectTypeOf<s.Infer<ReturnType<typeof s.object<typeof _mixed>>>>().toEqualTypeOf<
			{ a: string } | Record<string, never>
		>();
	});

	test('object takes no keys in, and strip_object takes any', () => {
		const _Object = s.object({});
		expectTypeOf<s.InferInput<typeof _Object>>().toEqualTypeOf<Record<string, never>>();
		const _Strip = s.strip_object({});
		expectTypeOf<s.InferInput<typeof _Strip>>().toEqualTypeOf<Record<string, unknown>>();
		// @ts-expect-error `object` refuses every key
		take<s.InferInput<typeof _Object>>({ a: 1 });
		// @ts-expect-error neither takes a number
		take<s.InferInput<typeof _Strip>>(5);
		take<s.InferInput<typeof _Strip>>({ a: 1 });
	});

	test('the runtime agrees', () => {
		assert(s.is(s.object({}), {}));
		assert(!s.is(s.object({}), { a: 1 }));
		assert(!s.is(s.object({}), 5));
		assert.deepEqual(s.parse(s.strip_object({}), { a: 1 }), { ok: true, value: {} });
		assert(!s.is(s.strip_object({}), 5));
		assert(!s.is(s.strip_object({}), []));
	});

	test('loose_object and object_with_rest are unchanged', () => {
		const _Loose = s.loose_object({});
		// the shared types, unspecialized
		expectTypeOf<s.Infer<typeof _Loose>>().toEqualTypeOf<
			s.SchemaObjectOutput<NoEntries> & Record<string, unknown>
		>();
		expectTypeOf<s.InferInput<typeof _Loose>>().toEqualTypeOf<
			s.SchemaObjectInput<NoEntries> & Record<string, unknown>
		>();
		expectTypeOf<s.Infer<typeof _Loose>>().not.toEqualTypeOf<Record<string, never>>();
		const _Rest = s.object_with_rest({}, s.number);
		expectTypeOf<s.Infer<typeof _Rest>>().toEqualTypeOf<
			s.SchemaObjectOutput<NoEntries> & Record<string, number>
		>();
		expectTypeOf<s.InferInput<typeof _Rest>>().toEqualTypeOf<
			s.SchemaObjectInput<NoEntries> & Record<string, number>
		>();
		const _RestKeyed = s.object_with_rest({ a: s.string }, s.number);
		expectTypeOf<s.Infer<typeof _RestKeyed>>().toEqualTypeOf<
			{ a: string } & Record<string, number>
		>();
	});

	test('a schema with entries is unchanged, all of them optional too', () => {
		const _Object = s.object({ a: s.optional(s.string) });
		expectTypeOf<s.Infer<typeof _Object>>().toEqualTypeOf<{ a?: string | undefined }>();
		expectTypeOf<s.InferInput<typeof _Object>>().toEqualTypeOf<{ a?: string | undefined }>();
		const _Strip = s.strip_object({ a: s.string });
		expectTypeOf<s.Infer<typeof _Strip>>().toEqualTypeOf<{ a: string }>();
		expectTypeOf<s.InferInput<typeof _Strip>>().toEqualTypeOf<{ a: string }>();
		// the entries of a bare `SchemaEntries` have keys
		expectTypeOf<s.Infer<s.Schema<s.SchemaStrictObjectOutput<s.SchemaEntries>>>>().toEqualTypeOf<
			Record<string, unknown>
		>();
	});

	test('as a field, and wrapped', () => {
		const _Nested = s.object({ a: s.object({}), b: s.strip_object({}) });
		expectTypeOf<s.Infer<typeof _Nested>>().toEqualTypeOf<{
			a: Record<string, never>;
			b: Record<string, never>;
		}>();
		expectTypeOf<s.InferInput<typeof _Nested>>().toEqualTypeOf<{
			a: Record<string, never>;
			b: Record<string, unknown>;
		}>();
		const _Optional = s.optional(s.object({}));
		expectTypeOf<s.Infer<typeof _Optional>>().toEqualTypeOf<Record<string, never> | undefined>();
		const _Default = s.with_default(s.object({}), {});
		expectTypeOf<s.Infer<typeof _Default>>().toEqualTypeOf<Record<string, never>>();
		expectTypeOf<s.InferInput<typeof _Default>>().toEqualTypeOf<
			Record<string, never> | undefined
		>();
		const _DefaultFn = s.with_default_fn(s.strip_object({}), () => ({}));
		expectTypeOf<s.Infer<typeof _DefaultFn>>().toEqualTypeOf<Record<string, never>>();
		const _Fields = s.object({ a: s.optional(s.object({})), b: s.with_default(s.object({}), {}) });
		expectTypeOf<s.Infer<typeof _Fields>>().toEqualTypeOf<{
			a?: Record<string, never> | undefined;
			b: Record<string, never>;
		}>();
		expectTypeOf<s.InferInput<typeof _Fields>>().toEqualTypeOf<{
			a?: Record<string, never> | undefined;
			b?: Record<string, never> | undefined;
		}>();
		const _Array = s.array(s.object({}));
		expectTypeOf<s.Infer<typeof _Array>>().toEqualTypeOf<Array<Record<string, never>>>();
	});

	test('a spread of an empty def composes to the keys spread beside it', () => {
		const Empty = s.object({});
		const _Extended = s.object({ ...Empty.def, x: s.string });
		expectTypeOf<s.Infer<typeof _Extended>>().toEqualTypeOf<{ x: string }>();
		expectTypeOf<s.InferInput<typeof _Extended>>().toEqualTypeOf<{ x: string }>();
		const _Stripped = s.strip_object({ ...s.strip_object({}).def, x: s.string });
		expectTypeOf<s.Infer<typeof _Stripped>>().toEqualTypeOf<{ x: string }>();
		expectTypeOf<s.InferInput<typeof _Stripped>>().toEqualTypeOf<{ x: string }>();
		const _Loose = s.loose_object(Empty.def);
		expectTypeOf<s.Infer<typeof _Loose>>().toEqualTypeOf<
			s.SchemaObjectOutput<NoEntries> & Record<string, unknown>
		>();
		// omitting every key leaves an empty object
		const Single = s.object({ a: s.string });
		const { a: _, ...rest } = Single.def;
		const _Omitted = s.object(rest);
		expectTypeOf<s.Infer<typeof _Omitted>>().toEqualTypeOf<Record<string, never>>();
	});

	test('a generic helper defers, and resolves at its call', () => {
		const _wrap = <T extends s.SchemaEntries>(entries: T) => s.object(entries);
		expectTypeOf<s.Infer<ReturnType<typeof _wrap<NoEntries>>>>().toEqualTypeOf<
			Record<string, never>
		>();
		expectTypeOf<s.Infer<ReturnType<typeof _wrap<{ a: typeof s.string }>>>>().toEqualTypeOf<{
			a: string;
		}>();
		const extend = <T extends s.SchemaEntries, U extends s.SchemaEntries>(
			base: s.Schema<any, any, 'object', T>,
			entries: U
		) => {
			const merged: Omit<T, keyof U> & U = { ...base.def, ...entries };
			return s.object(merged);
		};
		const _FromEmpty = extend(s.object({}), { x: s.string });
		expectTypeOf<s.Infer<typeof _FromEmpty>>().toEqualTypeOf<{ x: string }>();
		const _ToEmpty = extend(s.object({}), {});
		expectTypeOf<s.Infer<typeof _ToEmpty>>().toEqualTypeOf<Record<string, never>>();
	});
});

describe('object types of entries typed by hand', () => {
	type OptionalNumber = s.OptionalSchema<typeof s.number>;
	// a known key beside an index signature of entries that can leave a key out
	type Indexed = { a: typeof s.string } & Record<string, OptionalNumber>;
	// mapped, as a type literal can't hold a property its index signature refuses
	type IndexedOut = { [K in keyof Mixed]: Mixed[K] };
	type Mixed = { a: string } & Record<string, number | undefined>;
	// what `as const` and a `const` type parameter give
	type ReadonlyEntries = { readonly a: typeof s.string; readonly b: OptionalNumber };
	type Union = { a: typeof s.string } | { b: OptionalNumber };

	test('a known key beside an index signature is decided by its own entry', () => {
		expectTypeOf<s.Infer<s.ObjectSchema<Indexed>>>().toEqualTypeOf<IndexedOut>();
		expectTypeOf<s.InferInput<s.ObjectSchema<Indexed>>>().toEqualTypeOf<IndexedOut>();
		expectTypeOf<s.Infer<s.StripObjectSchema<Indexed>>>().toEqualTypeOf<IndexedOut>();
		expectTypeOf<s.InferInput<s.StripObjectSchema<Indexed>>>().toEqualTypeOf<IndexedOut>();
		expectTypeOf<s.Infer<s.LooseObjectSchema<Indexed>>>().toEqualTypeOf<
			IndexedOut & Record<string, unknown>
		>();
		expectTypeOf<s.InferInput<s.LooseObjectSchema<Indexed>>>().toEqualTypeOf<
			IndexedOut & Record<string, unknown>
		>();
		expectTypeOf<s.Infer<s.ObjectWithRestSchema<Indexed, typeof s.number>>>().toEqualTypeOf<
			IndexedOut & Record<string, number>
		>();
		expectTypeOf<s.InferInput<s.ObjectWithRestSchema<Indexed, typeof s.number>>>().toEqualTypeOf<
			IndexedOut & Record<string, number>
		>();
		// and so is one beside an index signature of required entries
		type Required = { error: typeof s.string } & s.SchemaEntries;
		expectTypeOf<s.Infer<s.ObjectSchema<Required>>>().toEqualTypeOf<{
			error: string;
			[k: string]: unknown;
		}>();
		expectTypeOf<s.InferInput<s.LooseObjectSchema<Required>>>().toEqualTypeOf<
			{ error: string; [k: string]: unknown } & Record<string, unknown>
		>();
		// and an optional entry beside an index signature of required entries stays optional
		type Reversed = { a: OptionalNumber } & Record<string, typeof s.string>;
		type ReversedOut = { [K in keyof ReversedMixed]: ReversedMixed[K] };
		type ReversedMixed = { a?: number | undefined } & Record<string, string>;
		expectTypeOf<s.Infer<s.ObjectSchema<Reversed>>>().toEqualTypeOf<ReversedOut>();
		expectTypeOf<s.InferInput<s.ObjectSchema<Reversed>>>().toEqualTypeOf<ReversedOut>();
		expectTypeOf<s.Infer<s.StripObjectSchema<Reversed>>>().toEqualTypeOf<ReversedOut>();
		expectTypeOf<s.InferInput<s.StripObjectSchema<Reversed>>>().toEqualTypeOf<ReversedOut>();
		expectTypeOf<s.Infer<s.LooseObjectSchema<Reversed>>>().toEqualTypeOf<
			ReversedOut & Record<string, unknown>
		>();
		expectTypeOf<s.InferInput<s.LooseObjectSchema<Reversed>>>().toEqualTypeOf<
			ReversedOut & Record<string, unknown>
		>();
		expectTypeOf<s.Infer<s.ObjectWithRestSchema<Reversed, typeof s.string>>>().toEqualTypeOf<
			ReversedOut & Record<string, string>
		>();
		expectTypeOf<s.InferInput<s.ObjectWithRestSchema<Reversed, typeof s.string>>>().toEqualTypeOf<
			ReversedOut & Record<string, string>
		>();
	});

	test('a known key is read in a generic function', () => {
		type Known = { error: typeof s.string };
		const read = <T extends s.SchemaEntries>(
			o: s.SchemaObjectOutput<Known & T>,
			i: s.SchemaObjectInput<Known & T>,
			l: s.Infer<s.LooseObjectSchema<Known & T>>
		): [string, string, string] => {
			expectTypeOf(o.error).toEqualTypeOf<string>();
			expectTypeOf(i.error).toEqualTypeOf<string>();
			expectTypeOf(l.error).toEqualTypeOf<string>();
			return [o.error, i.error, l.error];
		};
		assert.deepEqual(read({ error: 'e' }, { error: 'e' }, { error: 'e' }), ['e', 'e', 'e']);
		// through entries constrained to have it
		const constrained = <T extends Known>(o: s.SchemaObjectOutput<T>): string => {
			expectTypeOf(o.error).toEqualTypeOf<string>();
			return o.error;
		};
		assert.strictEqual(constrained<Known>({ error: 'e' }), 'e');
		// an entry that is itself a type parameter is read as `unknown`, as whether its key is
		// optional waits on it
		const parameter = <S extends s.Schema<string>, T extends s.SchemaEntries>(
			o: s.SchemaObjectOutput<{ error: S } & T>
		): unknown => {
			expectTypeOf(o.error).toEqualTypeOf<unknown>();
			return o.error;
		};
		assert.strictEqual(
			parameter<typeof s.string, { n: typeof s.number }>({ error: 'e', n: 1 }),
			'e'
		);
	});

	test('readonly entries give mutable properties', () => {
		type Out = { a: string; b?: number | undefined };
		expectTypeOf<s.Infer<s.ObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<Out>();
		expectTypeOf<s.InferInput<s.ObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<Out>();
		expectTypeOf<s.Infer<s.StripObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<Out>();
		expectTypeOf<s.InferInput<s.StripObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<Out>();
		expectTypeOf<s.Infer<s.LooseObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<
			Out & Record<string, unknown>
		>();
		expectTypeOf<s.InferInput<s.LooseObjectSchema<ReadonlyEntries>>>().toEqualTypeOf<
			Out & Record<string, unknown>
		>();
		expectTypeOf<
			s.Infer<s.ObjectWithRestSchema<ReadonlyEntries, typeof s.unknown>>
		>().toEqualTypeOf<Out & Record<string, unknown>>();
		expectTypeOf<
			s.InferInput<s.ObjectWithRestSchema<ReadonlyEntries, typeof s.unknown>>
		>().toEqualTypeOf<Out & Record<string, unknown>>();
		// so a parsed value is assigned into, from `as const` entries and a `const` type parameter
		const _Const = s.object({ a: s.string } as const);
		const make = <const T extends s.SchemaEntries>(entries: T) => s.loose_object(entries);
		const _Made = make({ a: s.string });
		const assign = (o: s.Infer<typeof _Const>, i: s.InferInput<typeof _Made>): void => {
			o.a = 'x';
			i.a = 'x';
		};
		assign({ a: '' }, { a: '' });
	});

	test('loose_object and object_with_rest over a union of entries give one member for each', () => {
		type Loose = ({ a: string } | { b?: number | undefined }) & Record<string, unknown>;
		expectTypeOf<s.Infer<s.LooseObjectSchema<Union>>>().toEqualTypeOf<Loose>();
		expectTypeOf<s.InferInput<s.LooseObjectSchema<Union>>>().toEqualTypeOf<Loose>();
		type Rest = ({ a: string } | { b?: number | undefined }) & Record<string, string>;
		expectTypeOf<s.Infer<s.ObjectWithRestSchema<Union, typeof s.string>>>().toEqualTypeOf<Rest>();
		expectTypeOf<
			s.InferInput<s.ObjectWithRestSchema<Union, typeof s.string>>
		>().toEqualTypeOf<Rest>();
		// as `object` and `strip_object` give
		type Strict = { a: string } | { b?: number | undefined };
		expectTypeOf<s.Infer<s.ObjectSchema<Union>>>().toEqualTypeOf<Strict>();
		expectTypeOf<s.InferInput<s.StripObjectSchema<Union>>>().toEqualTypeOf<Strict>();
	});
});

describe('brand and flavor of a branded or flavored schema', () => {
	type A = s.Branded<string, 'A'>;
	type FA = s.Flavored<string, 'A'>;

	test('compose, at top level and in an object entry', () => {
		const PathA = s.brand(s.pipe(s.string, s.min_length(1)), 'A');
		const _AB = s.brand(PathA, 'B');
		expectTypeOf<s.Infer<typeof _AB>>().not.toBeNever();
		expectTypeOf<s.Infer<typeof _AB>>().toEqualTypeOf<s.Branded<A, 'B'>>();
		expectTypeOf<s.InferInput<typeof _AB>>().toEqualTypeOf<string>();
		const _nested = s.brand(s.brand(s.pipe(s.string, s.min_length(1)), 'A'), 'B');
		expectTypeOf<s.Infer<typeof _nested>>().toEqualTypeOf<s.Branded<A, 'B'>>();
		const _ab: s.Infer<typeof _AB> = s.parse_or_throw(_AB, 'x');
		const _a: A = _ab;
		assert.strictEqual(_a, 'x');
		const FlavorA = s.flavor(s.string, 'A');
		const _FB = s.flavor(FlavorA, 'B');
		expectTypeOf<s.Infer<typeof _FB>>().toEqualTypeOf<s.Flavored<FA, 'B'>>();
		const _fa: FA = s.parse_or_throw(_FB, 'x');
		assert.strictEqual(_fa, 'x');
		const _BF = s.brand(FlavorA, 'B');
		expectTypeOf<s.Infer<typeof _BF>>().toEqualTypeOf<s.Branded<FA, 'B'>>();
		const _FBr = s.flavor(PathA, 'F');
		expectTypeOf<s.Infer<typeof _FBr>>().toEqualTypeOf<s.Flavored<A, 'F'>>();
		const _O = s.object({ ab: _AB, nullable: s.nullable(_AB), opt: s.optional(_FB) });
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{
			ab: s.Branded<A, 'B'>;
			nullable: s.Branded<A, 'B'> | null;
			opt?: s.Flavored<FA, 'B'> | undefined;
		}>();
		const _from_object: { ab: A; nullable: A | null } = s.parse_or_throw(_O, {
			ab: 'x',
			nullable: null
		});
		assert.deepEqual<unknown>(_from_object, { ab: 'x', nullable: null });
	});

	test('compose as a step of a pipe', () => {
		const _Step = s.pipe(s.brand(s.string, 'A'), s.brand(s.min_length(1), 'B'));
		expectTypeOf<s.Infer<typeof _Step>>().toEqualTypeOf<s.Branded<A, 'B'>>();
		const _Flavors = s.pipe(s.flavor(s.string, 'A'), s.flavor(s.min_length(1), 'B'));
		expectTypeOf<s.Infer<typeof _Flavors>>().toEqualTypeOf<s.Flavored<FA, 'B'>>();
		const _out: unknown = s.parse_or_throw(_Step, 'x');
		assert.strictEqual(_out, 'x');
	});
});

describe('the keys of a keyed_record', () => {
	const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
	type Uuid = s.Infer<typeof Uuid>;

	test('any string, a refined one included, keys a Record', () => {
		const _Any = s.keyed_record(s.string, s.number);
		expectTypeOf<s.Infer<typeof _Any>>().toEqualTypeOf<Record<string, number>>();
		expectTypeOf<s.InferInput<typeof _Any>>().toEqualTypeOf<Record<string, number>>();
		const _Name = s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.number);
		expectTypeOf<s.Infer<typeof _Name>>().toEqualTypeOf<Record<string, number>>();
		const _Lower = s.keyed_record(s.pipe(s.string, s.to_lower_case), s.optional(s.number));
		expectTypeOf<s.Infer<typeof _Lower>>().toEqualTypeOf<Record<string, number | undefined>>();
	});

	test('a finite key set has every key optional', () => {
		const _OneOf = s.keyed_record(s.one_of(['a', 'b']), s.number);
		expectTypeOf<s.Infer<typeof _OneOf>>().toEqualTypeOf<KeysAB>();
		expectTypeOf<s.InferInput<typeof _OneOf>>().toEqualTypeOf<KeysAB>();
		const _Literal = s.keyed_record(s.literal('x'), s.string);
		expectTypeOf<s.Infer<typeof _Literal>>().toEqualTypeOf<{ x?: string }>();
		// a default of the value is not of the key
		const _Default = s.keyed_record(s.one_of(['a', 'b']), s.with_default(s.number, 0));
		expectTypeOf<s.Infer<typeof _Default>>().toEqualTypeOf<KeysAB>();
		expectTypeOf<s.InferInput<typeof _Default>>().toEqualTypeOf<{
			a?: number | undefined;
			b?: number | undefined;
		}>();
	});

	test('a branded key types the output by the brand and the input by the string', () => {
		const _Covers = s.keyed_record(Uuid, s.number);
		expectTypeOf<s.Infer<typeof _Covers>>().toEqualTypeOf<Record<Uuid, number>>();
		expectTypeOf<s.InferInput<typeof _Covers>>().toEqualTypeOf<Record<string, number>>();
		const covers = {} as s.Infer<typeof _Covers>;
		// assigns to a record of plain strings
		expectTypeOf(covers).toExtend<Record<string, number>>();
		// @ts-expect-error a plain string is not a key of it
		const _plain = covers.abc;
		// a flavored key takes a plain string
		const _Emails = s.keyed_record(s.flavor(s.string, 'Email'), s.string);
		expectTypeOf({ 'a@b.c': 'x' }).toExtend<s.Infer<typeof _Emails>>();
	});

	test('a literal key with a brand or a flavor loses it, as a property name carries none', () => {
		const _Branded = s.keyed_record(s.brand(s.one_of(['a', 'b']), 'L'), s.number);
		expectTypeOf<s.Infer<typeof _Branded>>().toEqualTypeOf<KeysAB>();
		const _Flavored = s.keyed_record(s.flavor(s.one_of(['a', 'b']), 'L'), s.number);
		expectTypeOf<s.Infer<typeof _Flavored>>().toEqualTypeOf<KeysAB>();
		const _Literal = s.keyed_record(s.brand(s.literal('x'), 'L'), s.string);
		expectTypeOf<s.Infer<typeof _Literal>>().toEqualTypeOf<{ x?: string }>();
		// marks composed, of either kind
		const _Twice = s.keyed_record(
			s.flavor(s.brand(s.brand(s.literal('x'), 'A'), 'B'), 'C'),
			s.string
		);
		expectTypeOf<s.Infer<typeof _Twice>>().toEqualTypeOf<{ x?: string }>();
		// the input is of the literal, unmarked
		expectTypeOf<s.InferInput<typeof _Branded>>().toEqualTypeOf<KeysAB>();
	});

	test('a key of literals and every string beside them is an index signature that may be missing', () => {
		const _Mixed = s.keyed_record(s.union([s.literal('a'), s.string]), s.number);
		// `'a' | string` is `string`
		expectTypeOf<s.Infer<typeof _Mixed>>().toEqualTypeOf<Record<string, number>>();
		const Prefixed = null as unknown as s.Schema<'a' | `x-${string}`, string>;
		const _Template = s.keyed_record(Prefixed, s.number);
		expectTypeOf<s.Infer<typeof _Template>>().toEqualTypeOf<
			Partial<Record<'a' | `x-${string}`, number>>
		>();
	});

	test('a key schema that does not give a string is refused', () => {
		// @ts-expect-error a number
		s.keyed_record(s.number, s.string);
		// @ts-expect-error any value
		s.keyed_record(s.unknown, s.string);
		s.keyed_record(
			// @ts-expect-error a string made a number
			s.pipe(
				s.string,
				s.transform((k: string) => k.length)
			),
			s.string
		);
	});

	test('as an entry its type is held, and the key of the entry is needed', () => {
		const _O = s.object({ covers: s.keyed_record(Uuid, s.object({ cell_id: Uuid })) });
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{
			covers: Record<Uuid, { cell_id: Uuid }>;
		}>();
	});
});
