/**
 * The case matrix: many small schema-and-input pairs, each isolating one
 * behavior, so a change shows where it helps and where it costs.
 *
 * Cases take the library as a parameter so `grade.ts` can build the same
 * matrix against two versions of it. Where the cross-library scenarios in
 * `scenarios.ts` answer "how do we compare", these answer "what does this
 * code path cost".
 *
 * The `scale` group repeats shapes from the other groups at sizes and input
 * mixes where a different cost takes over: wide and sparse objects, long
 * arrays, inputs of many shapes, a change late in a large value, and failures
 * at different rates.
 *
 * Naming is `group/shape/outcome`. A case's `run` returns the parse result so
 * the caller can check it and see whether the output is the input itself.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

export type SchemaLib = typeof schema_lib;

// these exist so a baseline from before the `parse` rename, where `safe_parse`
// returned the result and `parse` threw, can still be graded
type ParseResult = (
	schema: schema_lib.AnySchema,
	value: unknown
) => schema_lib.SchemaResult<unknown>;
type ParseThrowing = (schema: schema_lib.AnySchema, value: unknown) => unknown;

const to_parse = (s: SchemaLib): ParseResult =>
	'parse_or_throw' in s ? s.parse : (s as unknown as { safe_parse: ParseResult }).safe_parse;

const to_parse_or_throw = (s: SchemaLib): ParseThrowing =>
	'parse_or_throw' in s ? s.parse_or_throw : (s as unknown as { parse: ParseThrowing }).parse;

type ObjectFactory = (entries: schema_lib.SchemaEntries) => schema_lib.AnySchema;

// and these so a baseline from before the object rename, where `strict_object`
// rejected unknown keys and `object` dropped them, can still be graded
const to_object = (s: SchemaLib): ObjectFactory =>
	'strip_object' in s ? s.object : (s as unknown as { strict_object: ObjectFactory }).strict_object;

const to_strip_object = (s: SchemaLib): ObjectFactory =>
	'strip_object' in s ? s.strip_object : (s as unknown as { object: ObjectFactory }).object;

type OneOfFactory = (values: ReadonlyArray<schema_lib.Literal>) => schema_lib.AnySchema;

// and this so a baseline from before `picklist` was renamed `one_of` can still be graded
const to_one_of = (s: SchemaLib): OneOfFactory =>
	'one_of' in s ? s.one_of : (s as unknown as { picklist: OneOfFactory }).picklist;

export interface Case {
	name: string;
	group: string;
	/**
	 * Whether the case resembles real consumer usage. The acceptance rules
	 * judge speed on these, not on the micro cases.
	 */
	realistic: boolean;
	/** Whether the input should match. */
	valid: boolean;
	input: unknown;
	/** Parses `input`, returning the output, or `undefined` when it didn't match. */
	run: () => unknown;
	/** Whether the call succeeded, checked once against `valid` before measuring. */
	ok: () => boolean;
}

type CaseGroup = (s: SchemaLib) => Array<Case>;

const to_case = (
	s: SchemaLib,
	name: string,
	schema: schema_lib.AnySchema,
	input: unknown,
	valid: boolean,
	realistic = false
): Case => ({
	name,
	group: name.slice(0, name.indexOf('/')),
	realistic,
	valid,
	input,
	run: () => {
		const result = to_parse(s)(schema, input);
		return result.ok ? result.value : undefined;
	},
	ok: () => to_parse(s)(schema, input).ok
});

const range = (n: number): Array<number> => Array.from({ length: n }, (_, i) => i);

// `n` string entries `k0`..`k{n-1}`
const to_entries = (
	n: number,
	schema: schema_lib.AnySchema
): Record<string, schema_lib.AnySchema> =>
	Object.fromEntries(range(n).map((i) => [`k${i}`, schema]));

const to_record = (n: number, value: unknown = 'v'): Record<string, unknown> =>
	Object.fromEntries(range(n).map((i) => [`k${i}`, value]));

const to_user = (i: number): Record<string, unknown> => ({
	id: i,
	name: `user ${i}`,
	email: `user${i}@example.com`,
	active: i % 2 === 0,
	tags: ['a', 'b'],
	address: { street: `${i} Main St`, city: 'Springfield', zip: '12345' }
});

// what a parsed response body is: fresh objects, no literals shared with the source
const to_json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// the same user with its keys inserted in a different order per `i`, so a
// list of them holds several object shapes, as data from mixed sources does
const to_user_shaped = (i: number): Record<string, unknown> => {
	const entries = Object.entries(to_user(i));
	const shift = i % entries.length;
	return Object.fromEntries([...entries.slice(shift), ...entries.slice(0, shift)]);
};

const create_user = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({
		id: s.number,
		name: s.string,
		email: s.string,
		active: s.boolean,
		tags: s.array(s.string),
		address: to_object(s)({ street: s.string, city: s.string, zip: s.string })
	});

// svelte-docinfo's recursive `TypeJson`, as in `libs/fuz_schema.ts`
const create_type_json = (s: SchemaLib): schema_lib.AnySchema => {
	const TypeJson: schema_lib.Schema = s.variant('kind', [
		to_object(s)({ kind: s.literal('intrinsic'), text: s.string }),
		to_object(s)({
			kind: s.literal('literal'),
			value: s.union([s.string, s.pipe(s.number, s.finite), s.boolean]),
			text: s.string
		}),
		to_object(s)({
			kind: s.literal('reference'),
			name: s.string,
			module: s.optional(s.string),
			typeArgs: s.optional(s.array(s.lazy(() => TypeJson)))
		}),
		to_object(s)({
			kind: s.literal('array'),
			element: s.lazy(() => TypeJson),
			readonly: s.optional(s.boolean)
		}),
		to_object(s)({
			kind: s.literal('tuple'),
			elements: s.optional(s.array(s.lazy(() => TupleElementJson))),
			readonly: s.optional(s.boolean)
		}),
		to_object(s)({
			kind: s.literal('union'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		to_object(s)({
			kind: s.literal('intersection'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		to_object(s)({ kind: s.literal('function'), text: s.string }),
		to_object(s)({ kind: s.literal('object'), text: s.string }),
		to_object(s)({ kind: s.literal('other'), text: s.string })
	]);
	const TupleElementJson: schema_lib.Schema = to_object(s)({
		name: s.optional(s.string),
		type: TypeJson,
		optional: s.optional(s.boolean),
		rest: s.optional(s.boolean)
	});
	return TypeJson;
};

// a `TypeJson` tree `depth` levels deep with `width` members per union,
// the first `branch` of which go a level deeper
const to_type_json = (depth: number, width: number, leaf: unknown, branch = 1): unknown =>
	depth === 0
		? leaf
		: {
				kind: 'union',
				members: range(width).map((i) =>
					i < branch
						? to_type_json(depth - 1, width, leaf, branch)
						: i % 3 === 0
							? { kind: 'reference', name: 'T', typeArgs: [{ kind: 'intrinsic', text: 'string' }] }
							: i % 3 === 1
								? { kind: 'literal', value: i, text: String(i) }
								: { kind: 'array', element: { kind: 'intrinsic', text: 'number' } }
				)
			};

const primitive: CaseGroup = (s) => [
	to_case(s, 'primitive/string/valid', s.string, 'hello', true),
	to_case(s, 'primitive/string/invalid', s.string, 42, false),
	to_case(s, 'primitive/number/valid', s.number, 42, true),
	to_case(s, 'primitive/literal/valid', s.literal('a'), 'a', true),
	to_case(s, 'primitive/literal/invalid', s.literal('a'), 'b', false),
	to_case(s, 'primitive/one_of_20_last/valid', to_one_of(s)(range(20)), 19, true),
	to_case(s, 'primitive/one_of_20/invalid', to_one_of(s)(range(20)), 20, false)
];

const strip: CaseGroup = (s) => [
	to_case(s, 'strip/1_key/valid', to_strip_object(s)(to_entries(1, s.string)), to_record(1), true),
	to_case(s, 'strip/5_keys/valid', to_strip_object(s)(to_entries(5, s.string)), to_record(5), true),
	to_case(
		s,
		'strip/20_keys/valid',
		to_strip_object(s)(to_entries(20, s.string)),
		to_record(20),
		true
	),
	// unknown keys must be dropped, so this one has to build an output
	to_case(
		s,
		'strip/5_of_8_keys/valid',
		to_strip_object(s)(to_entries(5, s.string)),
		to_record(8),
		true
	),
	// far more unknown keys than known ones
	to_case(
		s,
		'strip/5_of_20_keys/valid',
		to_strip_object(s)(to_entries(5, s.string)),
		to_record(20),
		true
	),
	// the unknown key comes first, and the input has no more keys than the schema
	to_case(
		s,
		'strip/4_of_5_keys_1_unknown_first/valid',
		to_strip_object(s)({ ...to_entries(4, s.string), k4: s.optional(s.string) }),
		{ x: 1, ...to_record(4) },
		true
	),
	// a key to drop and an entry that changes
	to_case(
		s,
		'strip/5_of_8_keys_last_defaulted/valid',
		to_strip_object(s)({ ...to_entries(5, s.string), last: s.with_default(s.string, 'd') }),
		to_record(8),
		true
	),
	to_case(
		s,
		'strip/5_optional_absent/valid',
		to_strip_object(s)(to_entries(5, s.optional(s.string))),
		{},
		true
	),
	// defaults change the value, so this one has to build an output too
	to_case(
		s,
		'strip/5_defaults_absent/valid',
		to_strip_object(s)(to_entries(5, s.with_default(s.string, 'd'))),
		{},
		true
	),
	to_case(
		s,
		'strip/5_keys_first_bad/invalid',
		to_strip_object(s)(to_entries(5, s.string)),
		{ ...to_record(5), k0: 1 },
		false
	),
	to_case(
		s,
		'strip/5_keys_all_bad/invalid',
		to_strip_object(s)(to_entries(5, s.string)),
		to_record(5, 1),
		false
	),
	to_case(
		s,
		'strip/5_of_8_keys_first_bad/invalid',
		to_strip_object(s)(to_entries(5, s.string)),
		{ ...to_record(8), k0: 1 },
		false
	),
	to_case(s, 'strip/not_object/invalid', to_strip_object(s)(to_entries(5, s.string)), 'x', false)
];

const object: CaseGroup = (s) => [
	to_case(s, 'object/5_keys/valid', to_object(s)(to_entries(5, s.string)), to_record(5), true),
	to_case(s, 'object/20_keys/valid', to_object(s)(to_entries(20, s.string)), to_record(20), true),
	to_case(
		s,
		'object/5_optional_absent/valid',
		to_object(s)(to_entries(5, s.optional(s.string))),
		{},
		true
	),
	// the input's keys in another order than the schema's
	to_case(
		s,
		'object/5_keys_reversed/valid',
		to_object(s)(to_entries(5, s.string)),
		Object.fromEntries(Object.entries(to_record(5)).reverse()),
		true
	),
	// an absent optional key ahead of the rest
	to_case(
		s,
		'object/6_keys_first_optional_absent/valid',
		to_object(s)({ first: s.optional(s.string), ...to_entries(5, s.string) }),
		to_record(5),
		true
	),
	// the same at a width where every later key misses its position
	to_case(
		s,
		'object/21_keys_first_optional_absent/valid',
		to_object(s)({ first: s.optional(s.string), ...to_entries(20, s.string) }),
		to_record(20),
		true
	),
	to_case(
		s,
		'object/unknown_key/invalid',
		to_object(s)(to_entries(5, s.string)),
		to_record(6),
		false
	),
	// an array is not an object, whatever its length
	to_case(s, 'object/array_100/invalid', to_object(s)(to_entries(5, s.string)), range(100), false),
	to_case(s, 'object/user/valid', create_user(s), to_user(1), true, true),
	to_case(
		s,
		'object/user/invalid',
		create_user(s),
		{ ...to_user(1), address: { street: 1, city: 'x', zip: 2 } },
		false,
		true
	)
];

const loose: CaseGroup = (s) => [
	to_case(s, 'loose/5_keys/valid', s.loose_object(to_entries(5, s.string)), to_record(5), true),
	to_case(s, 'loose/20_keys/valid', s.loose_object(to_entries(20, s.string)), to_record(20), true),
	// unknown keys are never looked at, so they cost nothing
	to_case(
		s,
		'loose/5_of_8_keys/valid',
		s.loose_object(to_entries(5, s.string)),
		to_record(8),
		true
	),
	// a default changes the value, so this one copies the whole input
	to_case(
		s,
		'loose/5_defaults_absent_3_unknown/valid',
		s.loose_object(to_entries(5, s.with_default(s.string, 'd'))),
		{ x: 1, y: 2, z: 3 },
		true
	),
	to_case(
		s,
		'loose/5_keys_first_bad/invalid',
		s.loose_object(to_entries(5, s.string)),
		{ ...to_record(5), k0: 1 },
		false
	)
];

const nested: CaseGroup = (s) => {
	const to_schema = (depth: number): schema_lib.AnySchema =>
		depth === 0 ? s.string : to_object(s)({ a: s.number, next: to_schema(depth - 1) });
	const to_input = (depth: number, leaf: unknown): unknown =>
		depth === 0 ? leaf : { a: depth, next: to_input(depth - 1, leaf) };
	return [
		to_case(s, 'nested/depth_2/valid', to_schema(2), to_input(2, 'x'), true),
		to_case(s, 'nested/depth_8/valid', to_schema(8), to_input(8, 'x'), true),
		// one issue whose path is prefixed at every level on the way out
		to_case(s, 'nested/depth_8_leaf_bad/invalid', to_schema(8), to_input(8, 1), false)
	];
};

const array: CaseGroup = (s) => [
	to_case(s, 'array/0_numbers/valid', s.array(s.number), [], true),
	to_case(s, 'array/10_numbers/valid', s.array(s.number), range(10), true),
	to_case(s, 'array/1000_numbers/valid', s.array(s.number), range(1000), true),
	to_case(s, 'array/100_users/valid', s.array(create_user(s)), range(100).map(to_user), true, true),
	// a transform changes every item, so this one has to build an output
	to_case(
		s,
		'array/100_transformed/valid',
		s.array(
			s.pipe(
				s.number,
				s.transform((v: number) => v + 1)
			)
		),
		range(100),
		true
	),
	to_case(s, 'array/1000_last_bad/invalid', s.array(s.number), [...range(999), 'x'], false),
	to_case(s, 'array/100_all_bad/invalid', s.array(s.number), range(100).map(String), false)
];

const union: CaseGroup = (s) => {
	const primitives = s.union([s.string, s.number, s.boolean]);
	const literals = s.union([s.literal('a'), s.literal('b'), s.literal('c'), s.literal('d')]);
	const objects = s.union([
		to_object(s)({ a: s.string }),
		to_object(s)({ b: s.string }),
		to_object(s)({ c: s.string, d: s.array(s.number) })
	]);
	return [
		to_case(s, 'union/3_primitives_first/valid', primitives, 'x', true),
		to_case(s, 'union/3_primitives_last/valid', primitives, true, true),
		to_case(s, 'union/3_primitives/invalid', primitives, null, false),
		// each miss builds the literal's `expected` text before failing
		to_case(s, 'union/4_literals_last/valid', literals, 'd', true),
		to_case(s, 'union/3_objects_last/valid', objects, { c: 'x', d: [1, 2] }, true),
		to_case(s, 'union/3_objects/invalid', objects, { c: 'x', d: [1, 'x'] }, false)
	];
};

const variant: CaseGroup = (s) => {
	const V = s.variant(
		'kind',
		range(10).map((i) => to_object(s)({ kind: s.literal(`k${i}`), value: s.number }))
	);
	return [
		to_case(s, 'variant/10_first/valid', V, { kind: 'k0', value: 1 }, true),
		to_case(s, 'variant/10_last/valid', V, { kind: 'k9', value: 1 }, true),
		to_case(s, 'variant/10_unknown_kind/invalid', V, { kind: 'zz', value: 1 }, false)
	];
};

const pipe: CaseGroup = (s) => {
	const Name = s.pipe(s.string, s.min_length(1), s.max_length(50), s.regex(/^[a-z ]+$/));
	const Age = s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150));
	return [
		to_case(s, 'pipe/string_3_actions/valid', Name, 'ada lovelace', true),
		to_case(s, 'pipe/string_first_action_bad/invalid', Name, '', false),
		to_case(s, 'pipe/string_last_action_bad/invalid', Name, 'Ada', false),
		to_case(s, 'pipe/number_3_actions/valid', Age, 36, true),
		to_case(
			s,
			'pipe/form/valid',
			to_strip_object(s)({ name: Name, age: Age }),
			{ name: 'ada lovelace', age: 36 },
			true,
			true
		)
	];
};

const record: CaseGroup = (s) => [
	to_case(s, 'record/20_keys/valid', s.record(s.string), to_record(20), true),
	to_case(
		s,
		'record/20_keys_last_bad/invalid',
		s.record(s.string),
		{ ...to_record(19), z: 1 },
		false
	)
];

const wrapper: CaseGroup = (s) => [
	to_case(s, 'wrapper/optional_present/valid', s.optional(s.string), 'x', true),
	to_case(s, 'wrapper/optional_absent/valid', s.optional(s.string), undefined, true),
	to_case(s, 'wrapper/nullable_null/valid', s.nullable(s.string), null, true),
	to_case(s, 'wrapper/default_absent/valid', s.with_default(s.string, 'd'), undefined, true),
	to_case(
		s,
		'wrapper/lazy/valid',
		s.lazy(() => s.string),
		'x',
		true
	)
];

const message: CaseGroup = (s) => {
	const O = to_strip_object(s)(to_entries(5, s.message(s.string, 'must be text')));
	return [
		to_case(s, 'message/5_keys/valid', O, to_record(5), true),
		to_case(s, 'message/5_keys_all_bad/invalid', O, to_record(5, 1), false)
	];
};

const recursive: CaseGroup = (s) => {
	const TypeJson = create_type_json(s);
	const leaf = { kind: 'intrinsic', text: 'boolean' };
	return [
		to_case(s, 'recursive/type_json_small/valid', TypeJson, to_type_json(2, 4, leaf), true, true),
		to_case(s, 'recursive/type_json_large/valid', TypeJson, to_type_json(5, 6, leaf), true, true),
		to_case(
			s,
			'recursive/type_json_large_leaf_bad/invalid',
			TypeJson,
			to_type_json(5, 6, { kind: 'bogus' }),
			false,
			true
		)
	];
};

const scale: CaseGroup = (s) => {
	const User = create_user(s);
	const Defaulted = s.array(s.with_default(s.number, 0));
	const sparse = { ...to_entries(20, s.optional(s.string)) };
	const TypeJson = create_type_json(s);
	const to_bad_every = (n: number, every: number): Array<unknown> =>
		range(n).map((i) => (i % every === 0 ? 'x' : i));
	const to_nested_schema = (depth: number): schema_lib.AnySchema =>
		depth === 0 ? s.string : to_object(s)({ next: to_nested_schema(depth - 1) });
	const to_nested_input = (depth: number): unknown =>
		depth === 0 ? 'x' : { next: to_nested_input(depth - 1) };
	const objects = s.union(range(10).map((i) => to_object(s)({ [`k${i}`]: s.string })));
	return [
		// wide objects, which V8 may hold as dictionaries
		to_case(
			s,
			'scale/strip_100_keys/valid',
			to_strip_object(s)(to_entries(100, s.string)),
			to_record(100),
			true
		),
		to_case(
			s,
			'scale/object_100_keys/valid',
			to_object(s)(to_entries(100, s.string)),
			to_record(100),
			true
		),
		to_case(s, 'scale/record_1000_keys/valid', s.record(s.string), to_record(1000), true),
		// a config-like object: many optional keys, few given
		to_case(
			s,
			'scale/20_optional_2_present/valid',
			to_strip_object(s)(sparse),
			{ k3: 'a', k17: 'b' },
			true
		),
		to_case(s, 'scale/array_10000_numbers/valid', s.array(s.number), range(10_000), true),
		to_case(
			s,
			'scale/array_1000_users/valid',
			s.array(User),
			to_json(range(1000).map(to_user)),
			true,
			true
		),
		to_case(
			s,
			'scale/array_1000_users_mixed_shapes/valid',
			s.array(User),
			range(1000).map(to_user_shaped),
			true,
			true
		),
		// one change in a large value: copy-on-write copies from the change on
		to_case(
			s,
			'scale/array_1000_first_defaulted/valid',
			Defaulted,
			[undefined, ...range(999)],
			true
		),
		to_case(
			s,
			'scale/array_1000_last_defaulted/valid',
			Defaulted,
			[...range(999), undefined],
			true
		),
		to_case(
			s,
			'scale/strip_20_keys_first_defaulted/valid',
			to_strip_object(s)({ first: s.with_default(s.string, 'd'), ...to_entries(19, s.string) }),
			to_record(19),
			true
		),
		to_case(
			s,
			'scale/strip_20_keys_middle_defaulted/valid',
			to_strip_object(s)({
				...to_entries(10, s.string),
				middle: s.with_default(s.string, 'd'),
				...Object.fromEntries(range(9).map((i) => [`k${i + 10}`, s.string]))
			}),
			to_record(19),
			true
		),
		to_case(
			s,
			'scale/strip_20_keys_last_defaulted/valid',
			to_strip_object(s)({ ...to_entries(19, s.string), last: s.with_default(s.string, 'd') }),
			to_record(19),
			true
		),
		// the same with an absent optional key first, so the input's keys
		// stop lining up with the schema's
		to_case(
			s,
			'scale/strip_21_keys_first_optional_absent_last_defaulted/valid',
			to_strip_object(s)({
				first: s.optional(s.string),
				...to_entries(19, s.string),
				last: s.with_default(s.string, 'd')
			}),
			to_record(19),
			true
		),
		to_case(
			s,
			'scale/object_20_keys_last_defaulted/valid',
			to_object(s)({ ...to_entries(19, s.string), last: s.with_default(s.string, 'd') }),
			to_record(19),
			true
		),
		// failures at different rates, each one an issue with a path
		to_case(
			s,
			'scale/array_1000_1pct_bad/invalid',
			s.array(s.number),
			to_bad_every(1000, 100),
			false
		),
		to_case(
			s,
			'scale/array_1000_half_bad/invalid',
			s.array(s.number),
			to_bad_every(1000, 2),
			false
		),
		to_case(s, 'scale/nested_depth_64/valid', to_nested_schema(64), to_nested_input(64), true),
		to_case(s, 'scale/union_10_objects_last/valid', objects, { k9: 'x' }, true),
		to_case(
			s,
			'scale/type_json_huge/valid',
			TypeJson,
			to_json(to_type_json(6, 6, { kind: 'intrinsic', text: 'boolean' }, 3)),
			true,
			true
		)
	];
};

// the same schema and input through each entry point
const api: CaseGroup = (s) => {
	const User = create_user(s);
	const valid = to_user(1);
	const invalid = { ...to_user(1), id: 'x', address: null };
	const to_api_case = (name: string, input: unknown, ok: boolean, run: () => unknown): Case => ({
		name,
		group: 'api',
		realistic: false,
		valid: ok,
		input,
		run,
		ok: () => to_parse(s)(User, input).ok
	});
	return [
		to_api_case('api/parse_or_throw/valid', valid, true, () => to_parse_or_throw(s)(User, valid)),
		to_api_case('api/is/valid', valid, true, () => (s.is(User, valid) ? valid : undefined)),
		to_api_case('api/is/invalid', invalid, false, () =>
			s.is(User, invalid) ? invalid : undefined
		),
		to_api_case('api/parse/invalid', invalid, false, () => {
			const result = to_parse(s)(User, invalid);
			return result.ok ? result.value : undefined;
		})
	];
};

/**
 * Every group, each built separately so a library version missing an export
 * loses only the groups that need it.
 */
export const CASE_GROUPS: Array<CaseGroup> = [
	primitive,
	object,
	loose,
	strip,
	nested,
	array,
	union,
	variant,
	pipe,
	record,
	wrapper,
	message,
	recursive,
	scale,
	api
];

/**
 * Builds every case the given library version supports.
 */
export const create_cases = (s: SchemaLib): Array<Case> =>
	CASE_GROUPS.flatMap((group) => {
		try {
			return group(s);
		} catch {
			return [];
		}
	});
