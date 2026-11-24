/**
 * What the tests of `compile.ts` share: the comparison of a compiled function
 * with the interpreter on one input, and the hand table of schemas and inputs.
 *
 * @module
 */

// the hand table's schemas hold functions of the tests' own, typed as loosely as a consumer's
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { isDeepStrictEqual } from 'node:util';

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';

const objects_of = (input: unknown): Set<object> => {
	const seen: Set<object> = new Set();
	const stack = [input];
	let next;
	while (stack.length) {
		next = stack.pop();
		if (next === null || typeof next !== 'object' || seen.has(next)) continue;
		seen.add(next);
		for (const key of Reflect.ownKeys(next)) {
			const d = Object.getOwnPropertyDescriptor(next, key)!;
			if ('value' in d) stack.push(d.value);
		}
		stack.push(Object.getPrototypeOf(next));
	}
	return seen;
};

/**
 * The first way `b`, another parse's output of `input`, differs from `a` in value, in key order,
 * in prototype, in which of its objects are the input's own, or in which of its places hold one
 * object, or `null`.
 */
export const find_sharing_difference = (a: unknown, b: unknown, input: unknown): string | null => {
	const of_input = objects_of(input);
	// each object of the one output that is no object of the other's, with the
	// object in its place there: one object in two places of `a` is one in `b`
	const paired: Map<object, object> = new Map();
	const paired_back: Map<object, object> = new Map();
	const walk = (x: any, y: any, at: string): string | null => {
		// the input's own object in both, one default in both, or one primitive
		if (Object.is(x, y)) return null;
		if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object')
			return `${at}: values differ`;
		if (of_input.has(x) || of_input.has(y))
			return `${at}: one is the input's own object and the other is not`;
		if (paired.has(x) || paired_back.has(y)) {
			return paired.get(x) === y && paired_back.get(y) === x
				? null
				: `${at}: one object in two places of the one output is two objects in the other`;
		}
		paired.set(x, y);
		paired_back.set(y, x);
		if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return `${at}: prototypes differ`;
		const kx = Reflect.ownKeys(x);
		const ky = Reflect.ownKeys(y);
		if (kx.length !== ky.length || kx.some((k, i) => k !== ky[i]))
			return `${at}: keys or their order differ: ${kx.map(String)} / ${ky.map(String)}`;
		for (const k of kx) {
			const dx = Object.getOwnPropertyDescriptor(x, k)!;
			const dy = Object.getOwnPropertyDescriptor(y, k)!;
			if (dx.enumerable !== dy.enumerable) return `${at}.${String(k)}: enumerable differs`;
			const found = walk(dx.value, dy.value, `${at}.${String(k)}`);
			if (found) return found;
		}
		return null;
	};
	return walk(a, b, '$');
};

// what a call did: its result, or the kind of error it threw
const attempt = (fn: () => unknown): { value: unknown } | { threw: string } => {
	try {
		return { value: fn() };
	} catch (error) {
		return { threw: (error as Error).constructor.name };
	}
};

/** A schema's compiled guard and parse, made once for many inputs. */
export interface CompiledPair {
	schema: s.AnySchema;
	guard: (value: unknown) => boolean;
	parse: (value: unknown) => s.SchemaResult<unknown>;
}

export const to_compiled_pair = (schema: s.AnySchema): CompiledPair => ({
	schema,
	guard: compile_guard(schema),
	parse: compile_parse(schema)
});

/**
 * The first way the compiled guard and parse of a schema differ from `is` and
 * `parse` on an input, or `null`: the verdict, the result, whether the output
 * is the input itself, and what the output shares with the input. The guards
 * get an input each, and the two parses one, which neither writes to.
 *
 * @param make - makes the input, a new one each call
 */
export const find_compile_difference = (pair: CompiledPair, make: () => unknown): string | null => {
	const { schema, guard, parse } = pair;
	const is_a = attempt(() => s.is(schema, make()));
	const is_b = attempt(() => guard(make()));
	if (!isDeepStrictEqual(is_a, is_b)) {
		return `guard: is ${JSON.stringify(is_a)}, compiled ${JSON.stringify(is_b)}`;
	}
	const input = make();
	const parse_a = attempt(() => s.parse(schema, input));
	const parse_b = attempt(() => parse(input));
	if ('threw' in parse_a || 'threw' in parse_b) {
		return isDeepStrictEqual(parse_a, parse_b)
			? null
			: `parse throws: interpreter ${JSON.stringify(parse_a)}, compiled ${JSON.stringify(parse_b)}`;
	}
	const a = parse_a.value as s.SchemaResult<unknown>;
	const b = parse_b.value as s.SchemaResult<unknown>;
	if (a.ok !== b.ok) return `parse: interpreter ok ${a.ok}, compiled ok ${b.ok}`;
	if (!a.ok || !b.ok) return isDeepStrictEqual(a, b) ? null : 'parse issues differ';
	if (Object.is(a.value, input) !== Object.is(b.value, input)) {
		return `parse identity: interpreter ${Object.is(a.value, input)}, compiled ${Object.is(b.value, input)}`;
	}
	if (!isDeepStrictEqual(a.value, b.value)) return 'parse output differs';
	const sharing = find_sharing_difference(a.value, b.value, input);
	return sharing && 'parse sharing: ' + sharing;
};

/** Every difference of a schema's compiled pair from the interpreter over inputs, as text. */
export const find_compile_differences = (
	schema: s.AnySchema,
	inputs: Array<() => unknown>
): Array<string> => {
	const pair = to_compiled_pair(schema);
	return inputs.flatMap((make, i) => {
		const found = find_compile_difference(pair, make);
		return found ? [`input ${i}: ${found}`] : [];
	});
};

//
// The hand table
//

const proto_json = (text: string): unknown => JSON.parse(text);
const hidden = (object: any, key: string, value: unknown): any =>
	Object.defineProperty(object, key, { value, enumerable: false });

const Node: s.Schema = s.object({ v: s.number, next: s.optional(s.lazy(() => Node)) });
const Memo: s.Schema = s.lazy(() =>
	s.memo_union([
		s.object({ args: s.array(Memo), op: s.literal('a') }),
		s.object({ args: s.array(Memo), op: s.literal('b') }),
		s.number
	])
);
const out_recursive: s.Schema = s.strip_object({
	v: s.with_default(s.number, 0),
	next: s.optional(s.lazy(() => out_recursive)),
	list: s.optional(s.array(s.lazy(() => out_recursive)))
});
const HOSTILE = 'a"]; return true; //';
const HOSTILE_2 = String.fromCharCode(0x2028, 0x2029) + '\\"\n\'`${x}';

/** The inputs of the hand table, each made afresh by a call. */
export const COMPILE_HAND_INPUTS: Array<() => unknown> = [
	() => undefined,
	() => null,
	() => 'ABC',
	() => 'abc',
	() => ' 12 ',
	() => '12',
	() => '-0',
	() => '9007199254740993',
	() => '\x8512',
	() => 0,
	() => -0,
	() => NaN,
	() => Infinity,
	() => 5,
	() => 5n,
	() => true,
	() => [],
	() => ['A', 'b'],
	() => [1, 2, 3],
	() => ({}),
	() => ({ a: undefined }),
	() => ({ a: 'A' }),
	() => ({ a: 'a' }),
	() => ({ a: 'x', b: 1 }),
	() => ({ a: 1, b: 'x' }),
	() => ({ A: 1 }),
	() => ({ a: 1 }),
	() => ({ a: '5' }),
	() => ({ b: 1 }),
	() => ({ a: null }),
	() => ({ a: ['x'] }),
	() => proto_json('{"__proto__": 1}'),
	() => proto_json('{"a": 1, "__proto__": {"x": 1}}'),
	() => proto_json('{"__proto__": {"x": 1}, "z": 1}'),
	() => proto_json('{"__proto__": "x", "a": "x"}'),
	() => Object.create({ a: 'x' }),
	() => Object.create({ z: 1 }),
	() => Object.assign(Object.create({ a: 1 }), { b: 1 }),
	() => hidden({ b: 1 }, 'a', 1),
	() => hidden({ z: 1 }, 'a', 1),
	() => hidden({ a: 1 }, 'z', 1),
	() => Object.create(null),
	() => Object.assign(Object.create(null), { a: 1 }),
	() =>
		new (class P {
			a = 1;
		})(),
	() => ({ a: 1, [Symbol.for('sym')]: 1 }),
	() => ({ v: 1, next: { v: 2, next: { v: 3 } } }),
	() => ({ next: { v: 2, next: {}, x: 1 }, list: [{ v: 1 }, {}, { list: [{}] }] }),
	() => ({ list: [{ a: 1 }, { a: 2, b: 3 }, { a: 4 }], d: 1 }),
	() => [{ a: 1 }, { a: 1, z: 1 }, {}],
	() => ({ a: { a: 1, z: 2 }, z: 1, b: undefined }),
	() => ({ k1: undefined, k2: 2, k3: { a: 1, z: 1 } }),
	() => ({ a: 'X', b: 'Y' }),
	() => ({ a: 'x', b: 'y' }),
	() => ({ a: { A: 1, b: 2 } }),
	() => ({ a: { a: 1, q: undefined, r: 2 } }),
	() => [{ a: 1, x: 1 }, { b: 2 }, 3, { a: 1 }],
	// eslint-disable-next-line no-sparse-arrays
	() => [, { a: 1 }, , { a: 1, z: 1 }, ,],
	() => Object.assign([{ a: 1, z: 1 }], { extra: 1 }),
	() => ({ a: 0 }),
	() => ({ a: NaN }),
	() => ({ a: -0 }),
	() =>
		new (class Q {
			a = 1;
			z = 2;
		})(),
	() => Object.assign(Object.create({ a: 1 }), { z: 1 }),
	() => ({ v: 1, next: { v: 2, next: { v: '3' } } }),
	() => ({ v: 1, next: { v: 2, x: 1 } }),
	() => ({ op: 'a', args: [1, { op: 'b', args: [] }] }),
	() => ({ op: 'a', args: [1, { op: 'c', args: [] }] }),
	() => ({ [HOSTILE]: 1 }),
	() => ({ [HOSTILE_2]: 1 }),
	() => ({ [HOSTILE]: 1, [HOSTILE_2]: 'x' }),
	() => HOSTILE,
	() => HOSTILE_2,
	() => '550e8400-e29b-41d4-a716-446655440000',
	() => '550E8400-E29B-41D4-A716-446655440000',
	() => '00000000-0000-0000-0000-000000000000',
	() => '550e8400-e29b-91d4-a716-446655440000',
	() => '2024-02-29T23:59:59.123Z',
	() => '2023-02-29T23:59:59Z',
	() => ({ id: '550e8400-e29b-41d4-a716-446655440000', at: '2024-02-29T23:59:59.123Z' })
];

const upper = (v: unknown): boolean => typeof v === 'string' && v === v.toUpperCase();
/**
 * The schemas of the hand table: what the differential's generator doesn't
 * draw, and the shapes a compiled copy has to get right.
 */
export const COMPILE_HAND_SCHEMAS: Record<string, s.AnySchema> = {
	lower: s.pipe(s.string, s.to_lower_case),
	lower_then_regex: s.pipe(s.string, s.to_lower_case, s.regex(/^[a-z]+$/)),
	lower_alone: s.to_lower_case,
	lower_entry: s.object({ a: s.pipe(s.string, s.to_lower_case) }),
	lower_strip_entry: s.strip_object({ a: s.pipe(s.string, s.to_lower_case, s.min_length(1)) }),
	lower_array: s.array(s.pipe(s.string, s.to_lower_case)),
	to_integer: s.pipe(s.string, s.to_integer()),
	to_integer_bounds: s.pipe(
		s.string,
		s.to_integer({ trim: true }),
		s.min_value(1),
		s.max_value(100)
	),
	to_integer_unsigned: s.pipe(s.string, s.to_integer({ unsigned: true })),
	to_integer_alone: s.to_integer({ unsigned: true, trim: true }),
	to_integer_entry: s.object({ a: s.pipe(s.string, s.to_integer(), s.min_value(1)) }),
	transform_alone: s.transform((v: any) => v),
	transform_entry: s.object({ a: s.transform((v: any) => (v === undefined ? 'd' : v)) }),
	check_alone_entry: s.object({ a: s.check((v: unknown) => v === undefined) }),
	check_at: s.pipe(
		s.loose_object({}),
		s.check_at('a', (v: any) => v.a === 1)
	),
	optional_pipe_entry: s.object({ a: s.pipe(s.optional(s.string), s.check(upper)) }),
	optional_pipe_transform_check: s.object({
		a: s.pipe(
			s.optional(s.string),
			s.transform((v) => String(v)),
			s.check((v) => v !== 'undefined')
		)
	}),
	optional_pipe_nested: s.object({
		a: s.pipe(s.pipe(s.optional(s.string), s.check(upper)), s.check(upper))
	}),
	optional_pipe_message: s.object({
		a: s.message(s.pipe(s.optional(s.string), s.check(upper)), 'm')
	}),
	optional_pipe_nullable: s.object({ a: s.nullable(s.pipe(s.optional(s.string), s.check(upper))) }),
	optional_pipe_lazy: s.object({ a: s.lazy(() => s.pipe(s.optional(s.string), s.check(upper))) }),
	optional_pipe_union: s.object({
		a: s.union([s.pipe(s.optional(s.string), s.check(upper)), s.number])
	}),
	optional_pipe_lower: s.object({
		a: s.pipe(
			s.optional(s.string),
			s.transform((v) => v ?? 'D'),
			s.to_lower_case,
			s.regex(/^d$/)
		)
	}),
	pipe_unknown: s.object({
		a: s.pipe(
			s.unknown,
			s.check(() => true)
		)
	}),
	pipe_pipe_unknown: s.object({
		a: s.pipe(
			s.pipe(
				s.unknown,
				s.check(() => true)
			),
			s.check(() => true)
		)
	}),
	pipe_step_unknown: s.object({ a: s.pipe(s.optional(s.number), s.unknown as any) }),
	pipe_step_pipe: s.object({
		a: s.pipe(
			s.check(() => true),
			s.pipe(s.optional(s.string), s.check(upper))
		)
	}),
	unknown_entry: s.object({ a: s.unknown }),
	unknown_message: s.object({ a: s.message(s.unknown, 'm') }),
	unknown_nullable: s.object({ a: s.nullable(s.unknown) }),
	unknown_lazy: s.object({ a: s.lazy(() => s.unknown) }),
	unknown_lazy_lazy: s.object({ a: s.lazy(() => s.lazy(() => s.nullable(s.unknown))) }),
	unknown_optional: s.object({ a: s.nullable(s.optional(s.unknown)) }),
	unknown_array: s.array(s.unknown),
	unknown_record: s.record(s.unknown),
	void_entry: s.object({ a: s.void }),
	one_of_undefined: s.object({ a: s.one_of([undefined, 1, 'x']) }),
	one_of_nan: s.object({ a: s.optional(s.one_of([NaN, 0, 'a'])) }),
	one_of_empty: s.one_of([]),
	one_of_many: s.one_of(Array.from({ length: 20 }, (_, i) => i)),
	literal_nan: s.literal(NaN),
	literal_zero: s.literal(-0),
	literal_bigint: s.literal(5n),
	union_unknown_default: s.object({ a: s.union([s.unknown, s.with_default(s.string, 'D')]) }),
	union_default_unknown: s.object({ a: s.union([s.with_default(s.string, 'D'), s.unknown]) }),
	union_pipe_default: s.object({
		a: s.union([
			s.pipe(
				s.unknown,
				s.check((v) => v === undefined)
			),
			s.with_default_fn(s.string, () => 'D')
		])
	}),
	union_strip_object: s.union([s.strip_object({ a: s.number }), s.loose_object({ b: s.number })]),
	union_strip_in_array: s.array(
		s.union([s.strip_object({ a: s.number }), s.object({ a: s.string, b: s.number })])
	),
	union_lower: s.union([s.pipe(s.string, s.to_lower_case, s.min_length(4)), s.string]),
	default_undefined: s.object({ a: s.with_default(s.string, undefined as any) }),
	default_late: s.object({ b: s.number, a: s.with_default(s.number, 7) }),
	default_fn: s.object({ a: s.with_default_fn(s.array(s.string), () => []) }),
	default_pipe: s.object({ a: s.pipe(s.with_default(s.string, 'x'), s.min_length(2)) }),
	strip_pipe_check: s.pipe(
		s.strip_object({ a: s.number }),
		s.check((v: any) => Object.keys(v).length === 1)
	),
	record_pipe_check: s.pipe(
		s.record(s.number),
		s.check((v: any) => Object.keys(v).length === 1)
	),
	rest: s.object_with_rest({ a: s.number }, s.string),
	rest_pipe: s.pipe(
		s.object_with_rest({}, s.number),
		s.check((v: any) => !Object.hasOwn(v, '__proto__'))
	),
	record: s.record(s.number),
	keyed_record: s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.number),
	keyed_record_lower: s.keyed_record(s.pipe(s.string, s.to_lower_case), s.unknown),
	keyed_record_one_of: s.keyed_record(s.one_of(['a', 'b']), s.optional(s.number)),
	loose: s.loose_object({ a: s.optional(s.number) }),
	loose_default: s.loose_object({ a: s.with_default(s.number, 1) }),
	strip: s.strip_object({ a: s.optional(s.number) }),
	strict_proto_entry: s.object({ constructor: s.optional(s.unknown) }),
	strict_tostring_entry: s.object({ toString: s.unknown }),
	strict_empty: s.object({}),
	copy_late_default: s.object({ b: s.optional(s.number), a: s.with_default(s.number, 7) }),
	copy_strip_default: s.strip_object({
		a: s.with_default(s.string, 'D'),
		b: s.optional(s.unknown),
		d: s.unknown
	}),
	copy_strip_order: s.strip_object({
		b: s.optional(s.number),
		a: s.unknown,
		c: s.nullable(s.optional(s.number))
	}),
	copy_default_object: s.object({ a: s.with_default(s.array(s.number), [1]) }),
	out_nested_default: s.object({
		list: s.array(s.object({ a: s.number, b: s.with_default(s.number, 2) })),
		d: s.optional(s.unknown)
	}),
	out_array_of_strip: s.array(s.strip_object({ a: s.optional(s.number) })),
	out_loose_default: s.loose_object({
		b: s.optional(s.unknown),
		a: s.with_default(s.unknown, 'D')
	}),
	out_loose_nested: s.loose_object({ a: s.optional(s.strip_object({ a: s.optional(s.number) })) }),
	out_record_of_defaults: s.record(s.with_default(s.number, 1)),
	out_record_of_strip: s.record(s.strip_object({ a: s.optional(s.unknown) })),
	out_variant_default: s.variant('a', [
		s.object({ a: s.literal(1), b: s.with_default(s.string, 'D') }),
		s.strip_object({ a: s.literal('x') })
	]),
	out_nullable_default: s.object({ a: s.nullable(s.with_default(s.number, 0)) }),
	out_optional_strip: s.object({ a: s.optional(s.strip_object({ a: s.optional(s.number) })) }),
	out_default_fn: s.object({
		a: s.with_default_fn(s.array(s.string), () => []),
		b: s.optional(s.number)
	}),
	out_default_fn_root: s.with_default_fn(s.loose_object({ a: s.optional(s.number) }), () => ({})),
	out_transform_entry: s.strip_object({
		a: s.pipe(
			s.optional(s.number),
			s.transform((v) => (v === undefined ? 'none' : v + 1))
		),
		b: s.optional(s.unknown)
	}),
	out_lower_entries: s.object({
		a: s.pipe(s.string, s.to_lower_case),
		b: s.optional(s.pipe(s.string, s.to_lower_case, s.min_length(1)))
	}),
	out_integer_entries: s.loose_object({ a: s.pipe(s.string, s.to_integer(), s.min_value(1)) }),
	out_pipe_strip_check: s.object({
		a: s.pipe(
			s.strip_object({ a: s.optional(s.number) }),
			s.check((v: any) => Object.keys(v).length < 2)
		)
	}),
	out_lazy_default: s.object({
		a: s.lazy(() => s.with_default(s.number, 3)),
		b: s.lazy(() => s.unknown)
	}),
	out_recursive_default: s.lazy(() => out_recursive),
	out_union_default: s.object({
		a: s.union([s.string, s.with_default(s.number, 1)]),
		b: s.optional(s.unknown)
	}),
	out_union_strip: s.array(
		s.union([s.strip_object({ a: s.number }), s.object({ b: s.number }), s.number])
	),
	out_keyed_record: s.object({
		a: s.keyed_record(s.pipe(s.string, s.to_lower_case), s.number),
		b: s.with_default(s.number, 1)
	}),
	out_rest: s.object({
		a: s.object_with_rest({ a: s.optional(s.number) }, s.with_default(s.number, 1))
	}),
	out_default_undefined: s.strip_object({
		a: s.with_default(s.string, undefined as any),
		b: s.pipe(
			s.with_default(s.string, 'x'),
			s.transform(() => undefined)
		)
	}),
	out_array_holes: s.array(s.optional(s.strip_object({ a: s.optional(s.number) }))),
	out_union_needs_key: s.object({
		a: s.union([s.unknown, s.strip_object({ x: s.optional(s.number) })])
	}),
	out_zero_nan: s.object({
		a: s.transform((v: unknown) => (v === 0 ? -0 : v)),
		b: s.optional(s.unknown)
	}),
	out_proto_entries: s.strip_object({
		constructor: s.optional(s.unknown),
		toString: s.with_default(s.unknown, 1)
	}),
	strip_empty: s.strip_object({}),
	variant: s.variant('a', [
		s.object({ a: s.literal('x'), b: s.number }),
		s.object({ a: s.literal(1), b: s.string }),
		s.strip_object({ a: s.literal(undefined) }),
		s.loose_object({ a: s.literal(null) }),
		s.object({ a: s.literal(NaN) })
	]),
	variant_dupe: s.variant('a', [
		s.object({ a: s.literal(1) }),
		s.object({ a: s.literal(1), b: s.string })
	]),
	recursive: Node,
	memo: Memo,
	hostile_key: s.object({ [HOSTILE]: s.number }),
	hostile_keys: s.object({ [HOSTILE]: s.number, [HOSTILE_2]: s.optional(s.string) }),
	hostile_literal: s.union([s.literal(HOSTILE), s.one_of([HOSTILE_2, '\\'])]),
	hostile_variant: s.variant(HOSTILE, [
		s.loose_object({ [HOSTILE]: s.literal(HOSTILE_2) }),
		s.loose_object({ [HOSTILE]: s.literal(1) })
	]),
	hostile_regex: s.pipe(s.string, s.regex(/"\]; return true; \/\//)),
	uuid: s.pipe(s.string, s.uuid),
	uuid_alone: s.uuid,
	iso: s.pipe(s.string, s.iso_datetime),
	formats: s.object({
		id: s.pipe(s.string, s.uuid, s.to_lower_case),
		at: s.pipe(s.string, s.iso_datetime)
	}),
	brand: s.brand(s.pipe(s.string, s.uuid), 'Uuid'),
	bigint_bounds: s.pipe(s.bigint, s.min_value(1n), s.max_value(10n)),
	array_length: s.pipe(s.array(s.unknown), s.min_length(1), s.max_length(2)),
	nullable_action: s.pipe(s.nullable(s.string), s.union([s.regex(/n/)]))
};

/**
 * The refusal of a `union` or a `pipe` the compiler can't bound, by the start
 * of its message, which names the kind and where it is.
 */
export const COMPILE_UNBOUNDED_REFUSAL =
	/^cannot compile `(union|pipe)` at \/.*: two or more of its /;
