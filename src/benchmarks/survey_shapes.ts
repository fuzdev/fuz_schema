/**
 * The shapes of `survey.ts`: many small schemas, each written for this
 * library, Valibot, and Zod, with the inputs each is run on.
 *
 * The scenarios of `scenarios.ts` are a few schemas for every library. These
 * are many, for three, and each row is one thing a parse does: a primitive, a
 * wrapper, an object returned as it came or copied, a union, issues by how
 * many and how deep. A library that is ahead on one kind of work shows here
 * where a scenario's one figure would hide it.
 *
 * **A shape takes its library as a parameter**, so this module imports none,
 * and a process that times one library loads no other.
 *
 * **Every input names its verdict**, which every library must give, or the
 * shape says which doesn't and why (`differs`), and that row is not timed for
 * that library. The libraries that match an input must return one output,
 * and `differs` can't declare otherwise. A shape a library has no equivalent
 * of leaves it out and says why (`skips`). `src/test/survey.test.ts` holds
 * all of it.
 *
 * **Objects are matched by what they do with a key the schema doesn't name.**
 * This library's `object` rejects it, as Valibot's `strictObject` and Zod's
 * `z.strictObject` do. `strip_object` drops it, as Valibot's `object` and
 * Zod's `z.object` do. `loose_object` keeps it, as `looseObject` and
 * `z.looseObject` do.
 *
 * Inputs come from `JSON.parse`, as a consumer's do.
 *
 * @module
 */

import type * as fuz_schema from '#lib/schema.ts';
import type * as valibot from 'valibot';
import type * as zod from 'zod';

import type { ScenarioRunner } from './scenarios.ts';

type Fuz = typeof fuz_schema;
type Valibot = typeof valibot;
type Zod = typeof zod;

/** The libraries a shape is written for, this one first. */
export const SURVEY_LIBS = ['fuz_schema', 'valibot', 'zod'] as const;
export type SurveyLibName = (typeof SURVEY_LIBS)[number];

/** What a row does, which the summary of `survey.ts` groups rows by. */
export const SURVEY_DOES = [
	'primitive',
	'wrapper',
	'guard',
	'array',
	'record',
	'object identity',
	'object copy',
	'union',
	'variant',
	'pipe',
	'lazy',
	'issue at the root',
	'issue at depth 1',
	'issue at depth 2',
	'issue at depth 4',
	'issue at depth 8',
	'many issues'
] as const;
export type SurveyDoes = (typeof SURVEY_DOES)[number];

export interface SurveyInput {
	value: unknown;
	/** Whether it matches. */
	valid: boolean;
	/** What the parse of it does, in this library. */
	does: SurveyDoes;
	/** The libraries that give the other verdict, each with why. The row is not timed for them. */
	differs?: Partial<Record<SurveyLibName, string>>;
}

/** A shape built in one library. */
export interface SurveyRun {
	/** Whether a value matches, which is what is timed. */
	matches: ScenarioRunner;
	/** What a parse of a matching value returns, for the libraries to be held to one output. */
	output?: (value: unknown) => unknown;
	/** This library's schema, for a test to read the issues of. */
	schema?: fuz_schema.AnySchema;
}

export interface SurveyShape {
	name: string;
	fuz_schema: (s: Fuz) => SurveyRun;
	valibot?: (v: Valibot) => SurveyRun;
	zod?: (z: Zod) => SurveyRun;
	/** Why a library has no builder: what it has no equivalent of. */
	skips?: Partial<Record<SurveyLibName, string>>;
	/** Why the shape's builders give no `output`, where they don't: what it calls returns none. */
	no_output?: string;
	/** By name. A row is `<shape>/<input>`. */
	inputs: Record<string, SurveyInput>;
}

export const to_survey_row_name = (shape: string, input: string): string => `${shape}/${input}`;

const ok = (value: unknown, does: SurveyDoes): SurveyInput => ({ value, valid: true, does });
const bad = (value: unknown, does: SurveyDoes): SurveyInput => ({ value, valid: false, does });

// what a parsed response body is: fresh objects, no literals shared with the source
const j = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const range = (n: number): Array<number> => Array.from({ length: n }, (_, i) => i);

const fp = (s: Fuz, schema: fuz_schema.AnySchema): SurveyRun => ({
	matches: (value) => s.parse(schema, value).ok,
	output: (value) => s.parse_or_throw(schema, value),
	schema
});
const vp = (v: Valibot, schema: valibot.GenericSchema): SurveyRun => ({
	matches: (value) => v.safeParse(schema, value).success,
	output: (value) => v.parse(schema, value)
});
const zp = (schema: zod.ZodType): SurveyRun => ({
	matches: (value) => schema.safeParse(value).success,
	output: (value) => schema.parse(value)
});

const user = { id: 1, name: 'ada', email: 'a@b.c', active: true, role: 'admin', age: 36 };
const { role: _, ...user_no_role } = user;

const fuz_user_entries = (s: Fuz): fuz_schema.SchemaEntries => ({
	id: s.number,
	name: s.string,
	email: s.string,
	active: s.boolean,
	role: s.optional(s.string),
	age: s.number
});
const valibot_user_entries = (v: Valibot): valibot.ObjectEntries => ({
	id: v.number(),
	name: v.string(),
	email: v.string(),
	active: v.boolean(),
	role: v.optional(v.string()),
	age: v.number()
});
const zod_user_entries = (z: Zod): Record<string, zod.ZodType> => ({
	id: z.number(),
	name: z.string(),
	email: z.string(),
	active: z.boolean(),
	role: z.optional(z.string()),
	age: z.number()
});

// the inputs the three kinds of object share, but for the one with a key the
// schema doesn't name, which is what they differ on
const to_object_inputs = (extra_key: SurveyInput): SurveyShape['inputs'] => ({
	valid: ok(j(user), 'object identity'),
	optional_absent: ok(j(user_no_role), 'object identity'),
	reversed: ok(j(Object.fromEntries(Object.entries(user).reverse())), 'object identity'),
	extra_key,
	last_bad: bad(j({ ...user, age: 'x' }), 'issue at depth 1'),
	first_bad: bad(j({ ...user, id: 'x' }), 'issue at depth 1'),
	all_bad: bad(j({ id: 'x', name: 1, email: 2, active: 3, role: 4, age: 'y' }), 'many issues'),
	empty: bad({}, 'many issues'),
	not_object: bad('x', 'issue at the root'),
	null: bad(null, 'issue at the root')
});

// objects nested `depth` deep around a number, at the key `a`
const fuz_nested = (s: Fuz, depth: number): fuz_schema.AnySchema =>
	depth === 0 ? s.number : s.object({ a: fuz_nested(s, depth - 1) });
const valibot_nested = (v: Valibot, depth: number): valibot.GenericSchema =>
	depth === 0 ? v.number() : v.strictObject({ a: valibot_nested(v, depth - 1) });
const zod_nested = (z: Zod, depth: number): zod.ZodType =>
	depth === 0 ? z.number() : z.strictObject({ a: zod_nested(z, depth - 1) });
const to_nested = (depth: number, leaf: unknown): unknown =>
	depth === 0 ? leaf : { a: to_nested(depth - 1, leaf) };

const to_nested_shape = (depth: 1 | 2 | 4 | 8): SurveyShape => ({
	name: `nested_${depth}`,
	fuz_schema: (s) => fp(s, fuz_nested(s, depth)),
	valibot: (v) => vp(v, valibot_nested(v, depth)),
	zod: (z) => zp(zod_nested(z, depth)),
	inputs: {
		valid: ok(j(to_nested(depth, 1)), 'object identity'),
		leaf_bad: bad(j(to_nested(depth, 'x')), `issue at depth ${depth}`)
	}
});

// an object with one entry, a wrapper around `unknown`, which this library
// hands the object and the key
const to_unknown_entry_shape = (
	name: string,
	does: SurveyDoes,
	create: {
		fuz_schema: (s: Fuz) => fuz_schema.AnySchema;
		valibot: (v: Valibot) => valibot.GenericSchema;
		zod: (z: Zod) => zod.ZodType;
	}
): SurveyShape => ({
	name,
	fuz_schema: (s) => fp(s, s.object({ a: create.fuz_schema(s) })),
	valibot: (v) => vp(v, v.strictObject({ a: create.valibot(v) })),
	zod: (z) => zp(z.strictObject({ a: create.zod(z) })),
	inputs: { present: ok(j({ a: 1 }), does), missing: bad({}, 'issue at depth 1') }
});

const LETTERS = ['a', 'b', 'c', 'd', 'e'] as const;

interface Tree {
	value: number;
	children: Array<Tree>;
}

export const SURVEY_SHAPES: Array<SurveyShape> = [
	//
	// Primitives and wrappers
	//
	{
		name: 'string',
		fuz_schema: (s) => fp(s, s.string),
		valibot: (v) => vp(v, v.string()),
		zod: (z) => zp(z.string()),
		inputs: { valid: ok('abc', 'primitive'), invalid: bad(1, 'issue at the root') }
	},
	{
		name: 'number',
		fuz_schema: (s) => fp(s, s.number),
		valibot: (v) => vp(v, v.number()),
		zod: (z) => zp(z.number()),
		inputs: {
			valid: ok(1.5, 'primitive'),
			invalid: bad('a', 'issue at the root'),
			nan: bad(NaN, 'issue at the root')
		}
	},
	{
		name: 'boolean',
		fuz_schema: (s) => fp(s, s.boolean),
		valibot: (v) => vp(v, v.boolean()),
		zod: (z) => zp(z.boolean()),
		inputs: { valid: ok(true, 'primitive'), invalid: bad(null, 'issue at the root') }
	},
	{
		name: 'unknown',
		fuz_schema: (s) => fp(s, s.unknown),
		valibot: (v) => vp(v, v.unknown()),
		zod: (z) => zp(z.unknown()),
		inputs: { valid: ok(1, 'primitive') }
	},
	{
		name: 'literal',
		fuz_schema: (s) => fp(s, s.literal('a')),
		valibot: (v) => vp(v, v.literal('a')),
		zod: (z) => zp(z.literal('a')),
		inputs: { valid: ok('a', 'primitive'), invalid: bad('b', 'issue at the root') }
	},
	{
		// Valibot's `literal` takes no `undefined`, so its `undefined` schema stands in
		name: 'literal_undefined',
		fuz_schema: (s) => fp(s, s.literal(undefined)),
		valibot: (v) => vp(v, v.undefined()),
		zod: (z) => zp(z.literal(undefined)),
		inputs: { valid: ok(undefined, 'primitive'), invalid: bad(null, 'issue at the root') }
	},
	{
		name: 'one_of_5',
		fuz_schema: (s) => fp(s, s.one_of(LETTERS)),
		valibot: (v) => vp(v, v.picklist(LETTERS)),
		zod: (z) => zp(z.enum(LETTERS)),
		inputs: {
			first: ok('a', 'primitive'),
			last: ok('e', 'primitive'),
			invalid: bad('z', 'issue at the root')
		}
	},
	{
		name: 'optional_string',
		fuz_schema: (s) => fp(s, s.optional(s.string)),
		valibot: (v) => vp(v, v.optional(v.string())),
		zod: (z) => zp(z.optional(z.string())),
		inputs: {
			undefined: ok(undefined, 'wrapper'),
			valid: ok('a', 'wrapper'),
			invalid: bad(1, 'issue at the root')
		}
	},
	{
		name: 'nullable_string',
		fuz_schema: (s) => fp(s, s.nullable(s.string)),
		valibot: (v) => vp(v, v.nullable(v.string())),
		zod: (z) => zp(z.nullable(z.string())),
		inputs: {
			null: ok(null, 'wrapper'),
			valid: ok('a', 'wrapper'),
			invalid: bad(1, 'issue at the root')
		}
	},
	{
		name: 'default_string',
		fuz_schema: (s) => fp(s, s.with_default(s.string, 'x')),
		valibot: (v) => vp(v, v.optional(v.string(), 'x')),
		zod: (z) => zp(z.string().default('x')),
		inputs: { undefined: ok(undefined, 'wrapper'), valid: ok('a', 'wrapper') }
	},
	{
		name: 'message_string',
		fuz_schema: (s) => fp(s, s.message(s.string, 'must be text')),
		valibot: (v) => vp(v, v.string('must be text')),
		zod: (z) => zp(z.string('must be text')),
		inputs: { valid: ok('a', 'wrapper'), invalid: bad(1, 'issue at the root') }
	},
	{
		name: 'lazy_string',
		fuz_schema: (s) =>
			fp(
				s,
				s.lazy(() => s.string)
			),
		valibot: (v) =>
			vp(
				v,
				v.lazy(() => v.string())
			),
		zod: (z) => zp(z.lazy(() => z.string())),
		inputs: { valid: ok('a', 'lazy'), invalid: bad(1, 'issue at the root') }
	},
	{
		name: 'is_string',
		fuz_schema: (s) => ({ matches: (value) => s.is(s.string, value) }),
		valibot: (v: Valibot): SurveyRun => {
			const schema = v.string();
			return { matches: (value) => v.is(schema, value) };
		},
		skips: { zod: 'it has no guard that builds no issues' },
		no_output: 'a guard returns a verdict',
		inputs: { valid: ok('abc', 'guard'), invalid: bad(1, 'guard') }
	},
	{
		name: 'throw_string',
		fuz_schema: (s) => ({
			matches: (value) => typeof s.parse_or_throw(s.string, value) === 'string',
			output: (value) => s.parse_or_throw(s.string, value)
		}),
		valibot: (v: Valibot): SurveyRun => {
			const schema = v.string();
			return {
				matches: (value) => typeof v.parse(schema, value) === 'string',
				output: (value) => v.parse(schema, value)
			};
		},
		zod: (z: Zod): SurveyRun => {
			const schema = z.string();
			return {
				matches: (value) => typeof schema.parse(value) === 'string',
				output: (value) => schema.parse(value)
			};
		},
		inputs: { valid: ok('abc', 'primitive') }
	},
	//
	// Arrays and records
	//
	{
		name: 'array_numbers',
		fuz_schema: (s) => fp(s, s.array(s.number)),
		valibot: (v) => vp(v, v.array(v.number())),
		zod: (z) => zp(z.array(z.number())),
		inputs: {
			empty: ok([], 'array'),
			valid_10: ok(j(range(10)), 'array'),
			valid_100: ok(j(range(100)), 'array'),
			last_bad_100: bad(j([...range(99), 'x']), 'issue at depth 1'),
			all_bad_100: bad(j(range(100).map(String)), 'many issues'),
			not_array: bad({}, 'issue at the root')
		}
	},
	{
		name: 'array_strings',
		fuz_schema: (s) => fp(s, s.array(s.string)),
		valibot: (v) => vp(v, v.array(v.string())),
		zod: (z) => zp(z.array(z.string())),
		inputs: { valid_10: ok(j(range(10).map(String)), 'array') }
	},
	{
		name: 'array_message_string',
		fuz_schema: (s) => fp(s, s.array(s.message(s.string, 'must be text'))),
		valibot: (v) => vp(v, v.array(v.string('must be text'))),
		zod: (z) => zp(z.array(z.string('must be text'))),
		inputs: {
			valid_100: ok(j(range(100).map(String)), 'wrapper'),
			all_bad_100: bad(j(range(100)), 'many issues')
		}
	},
	{
		name: 'array_lazy_string',
		fuz_schema: (s) => fp(s, s.array(s.lazy(() => s.string))),
		valibot: (v) => vp(v, v.array(v.lazy(() => v.string()))),
		zod: (z) => zp(z.array(z.lazy(() => z.string()))),
		inputs: { valid_100: ok(j(range(100).map(String)), 'lazy') }
	},
	{
		name: 'array_nullable_number',
		fuz_schema: (s) => fp(s, s.array(s.nullable(s.number))),
		valibot: (v) => vp(v, v.array(v.nullable(v.number()))),
		zod: (z) => zp(z.array(z.nullable(z.number()))),
		inputs: {
			nulls_100: ok(j(range(100).map(() => null)), 'wrapper'),
			numbers_100: ok(j(range(100)), 'wrapper')
		}
	},
	{
		name: 'array_optional_number',
		fuz_schema: (s) => fp(s, s.array(s.optional(s.number))),
		valibot: (v) => vp(v, v.array(v.optional(v.number()))),
		zod: (z) => zp(z.array(z.optional(z.number()))),
		inputs: { numbers_100: ok(j(range(100)), 'wrapper') }
	},
	{
		name: 'array_union',
		fuz_schema: (s) => fp(s, s.array(s.union([s.string, s.number, s.boolean]))),
		valibot: (v) => vp(v, v.array(v.union([v.string(), v.number(), v.boolean()]))),
		zod: (z) => zp(z.array(z.union([z.string(), z.number(), z.boolean()]))),
		inputs: {
			mixed_30: ok(j(range(30).map((i) => (i % 3 === 0 ? 'a' : i % 3 === 1 ? i : true))), 'union')
		}
	},
	{
		name: 'record_numbers',
		fuz_schema: (s) => fp(s, s.record(s.number)),
		valibot: (v) => vp(v, v.record(v.string(), v.number())),
		zod: (z) => zp(z.record(z.string(), z.number())),
		inputs: {
			valid_10: ok(j(Object.fromEntries(range(10).map((i) => [`k${i}`, i]))), 'record'),
			valid_200: ok(j(Object.fromEntries(range(200).map((i) => [`k${i}`, i]))), 'record'),
			last_bad_10: bad(
				j({ ...Object.fromEntries(range(9).map((i) => [`k${i}`, i])), z: 'x' }),
				'issue at depth 1'
			)
		}
	},
	//
	// Objects
	//
	{
		name: 'object',
		fuz_schema: (s) => fp(s, s.object(fuz_user_entries(s))),
		valibot: (v) => vp(v, v.strictObject(valibot_user_entries(v))),
		zod: (z) => zp(z.strictObject(zod_user_entries(z))),
		inputs: to_object_inputs(bad(j({ ...user, extra: 1 }), 'issue at depth 1'))
	},
	{
		name: 'loose_object',
		fuz_schema: (s) => fp(s, s.loose_object(fuz_user_entries(s))),
		valibot: (v) => vp(v, v.looseObject(valibot_user_entries(v))),
		zod: (z) => zp(z.looseObject(zod_user_entries(z))),
		inputs: to_object_inputs(ok(j({ ...user, extra: 1 }), 'object identity'))
	},
	{
		name: 'strip_object',
		fuz_schema: (s) => fp(s, s.strip_object(fuz_user_entries(s))),
		valibot: (v) => vp(v, v.object(valibot_user_entries(v))),
		zod: (z) => zp(z.object(zod_user_entries(z))),
		inputs: {
			...to_object_inputs(ok(j({ ...user, extra: 1 }), 'object copy')),
			extra_keys_6: ok(
				j({ ...user, x0: 1, x1: 'a', x2: true, x3: null, x4: [1], x5: { a: 1 } }),
				'object copy'
			)
		}
	},
	{
		name: 'object_1_key',
		fuz_schema: (s) => fp(s, s.object({ a: s.string })),
		valibot: (v) => vp(v, v.strictObject({ a: v.string() })),
		zod: (z) => zp(z.strictObject({ a: z.string() })),
		inputs: {
			valid: ok(j({ a: 'x' }), 'object identity'),
			invalid: bad(j({ a: 1 }), 'issue at depth 1'),
			missing: bad({}, 'issue at depth 1')
		}
	},
	{
		name: 'object_empty',
		fuz_schema: (s) => fp(s, s.object({})),
		valibot: (v) => vp(v, v.strictObject({})),
		zod: (z) => zp(z.strictObject({})),
		inputs: { valid: ok({}, 'object identity') }
	},
	{
		name: 'object_defaults',
		fuz_schema: (s) =>
			fp(
				s,
				s.object({
					host: s.with_default(s.string, 'localhost'),
					port: s.with_default(s.number, 80),
					debug: s.with_default(s.boolean, false),
					name: s.string
				})
			),
		valibot: (v) =>
			vp(
				v,
				v.strictObject({
					host: v.optional(v.string(), 'localhost'),
					port: v.optional(v.number(), 80),
					debug: v.optional(v.boolean(), false),
					name: v.string()
				})
			),
		zod: (z) =>
			zp(
				z.strictObject({
					host: z.string().default('localhost'),
					port: z.number().default(80),
					debug: z.boolean().default(false),
					name: z.string()
				})
			),
		inputs: {
			all_defaulted: ok(j({ name: 'a' }), 'object copy'),
			none_defaulted: ok(j({ host: 'h', port: 1, debug: true, name: 'a' }), 'object identity')
		}
	},
	{
		name: 'object_transform',
		fuz_schema: (s) =>
			fp(
				s,
				s.object({
					a: s.string,
					b: s.pipe(
						s.string,
						s.transform((x: string) => x.length)
					),
					c: s.string
				})
			),
		valibot: (v) =>
			vp(
				v,
				v.strictObject({
					a: v.string(),
					b: v.pipe(
						v.string(),
						v.transform((x) => x.length)
					),
					c: v.string()
				})
			),
		zod: (z) =>
			zp(
				z.strictObject({ a: z.string(), b: z.string().transform((x) => x.length), c: z.string() })
			),
		inputs: { valid: ok(j({ a: 'a', b: 'bb', c: 'c' }), 'object copy') }
	},
	{
		// an entry that accepts `undefined` and still needs its key, in this library
		name: 'object_literal_undefined',
		fuz_schema: (s) => fp(s, s.object({ a: s.literal(undefined), b: s.string })),
		valibot: (v) => vp(v, v.strictObject({ a: v.undefined(), b: v.string() })),
		zod: (z) => zp(z.strictObject({ a: z.literal(undefined), b: z.string() })),
		inputs: {
			present: ok({ a: undefined, b: 'x' }, 'object identity'),
			missing: bad(j({ b: 'x' }), 'issue at depth 1')
		}
	},
	to_unknown_entry_shape('entry_unknown', 'object identity', {
		fuz_schema: (s) => s.unknown,
		valibot: (v) => v.unknown(),
		zod: (z) => z.unknown()
	}),
	to_unknown_entry_shape('entry_nullable_unknown', 'wrapper', {
		fuz_schema: (s) => s.nullable(s.unknown),
		valibot: (v) => v.nullable(v.unknown()),
		zod: (z) => z.nullable(z.unknown())
	}),
	to_unknown_entry_shape('entry_lazy_unknown', 'lazy', {
		fuz_schema: (s) => s.lazy(() => s.unknown),
		valibot: (v) => v.lazy(() => v.unknown()),
		zod: (z) => z.lazy(() => z.unknown())
	}),
	to_unknown_entry_shape('entry_union_unknown_last', 'union', {
		fuz_schema: (s) => s.union([s.string, s.unknown]),
		valibot: (v) => v.union([v.string(), v.unknown()]),
		zod: (z) => z.union([z.string(), z.unknown()])
	}),
	to_unknown_entry_shape('entry_pipe_unknown_check', 'pipe', {
		fuz_schema: (s) =>
			s.pipe(
				s.unknown,
				s.check((x: unknown) => x !== null)
			),
		valibot: (v) =>
			v.pipe(
				v.unknown(),
				v.check((x) => x !== null)
			),
		zod: (z) => z.unknown().refine((x) => x !== null)
	}),
	{
		name: 'wide_20',
		fuz_schema: (s) =>
			fp(s, s.object(Object.fromEntries(range(20).map((i) => [`k${i}`, s.number])))),
		valibot: (v) =>
			vp(v, v.strictObject(Object.fromEntries(range(20).map((i) => [`k${i}`, v.number()])))),
		zod: (z) => zp(z.strictObject(Object.fromEntries(range(20).map((i) => [`k${i}`, z.number()])))),
		inputs: {
			valid: ok(j(Object.fromEntries(range(20).map((i) => [`k${i}`, i]))), 'object identity'),
			all_bad: bad(j(Object.fromEntries(range(20).map((i) => [`k${i}`, 'x']))), 'many issues')
		}
	},
	//
	// Depth
	//
	to_nested_shape(1),
	to_nested_shape(2),
	to_nested_shape(4),
	to_nested_shape(8),
	{
		name: 'users_30',
		fuz_schema: (s) => fp(s, s.array(s.object(fuz_user_entries(s)))),
		valibot: (v) => vp(v, v.array(v.strictObject(valibot_user_entries(v)))),
		zod: (z) => zp(z.array(z.strictObject(zod_user_entries(z)))),
		inputs: {
			valid: ok(j(range(30).map((i) => ({ ...user, id: i }))), 'object identity'),
			one_bad: bad(
				j(range(30).map((i) => ({ ...user, id: i === 17 ? 'x' : i }))),
				'issue at depth 2'
			),
			each_bad: bad(j(range(30).map((i) => ({ ...user, id: String(i) }))), 'many issues'),
			each_two_bad: bad(
				j(range(30).map((i) => ({ ...user, id: String(i), age: 'x' }))),
				'many issues'
			)
		}
	},
	{
		// arrays and objects by turns, so a path of indexes and keys
		name: 'items_4_deep',
		fuz_schema: (s: Fuz): SurveyRun => {
			let schema: fuz_schema.AnySchema = s.object({ leaf: s.number });
			for (let i = 0; i < 4; i++) schema = s.object({ items: s.array(schema) });
			return fp(s, schema);
		},
		valibot: (v: Valibot): SurveyRun => {
			let schema: valibot.GenericSchema = v.strictObject({ leaf: v.number() });
			for (let i = 0; i < 4; i++) schema = v.strictObject({ items: v.array(schema) });
			return vp(v, schema);
		},
		zod: (z: Zod): SurveyRun => {
			let schema: zod.ZodType = z.strictObject({ leaf: z.number() });
			for (let i = 0; i < 4; i++) schema = z.strictObject({ items: z.array(schema) });
			return zp(schema);
		},
		inputs: {
			valid: ok(
				j({ items: [{ items: [{ items: [{ items: [{ leaf: 1 }] }] }] }] }),
				'object identity'
			),
			// the innermost item is no object, so the path ends at its index
			item_bad: bad(j({ items: [{ items: [{ items: [{ items: ['x'] }] }] }] }), 'issue at depth 8')
		}
	},
	//
	// Unions and variants
	//
	{
		name: 'union_3_primitives',
		fuz_schema: (s) => fp(s, s.union([s.string, s.number, s.boolean])),
		valibot: (v) => vp(v, v.union([v.string(), v.number(), v.boolean()])),
		zod: (z) => zp(z.union([z.string(), z.number(), z.boolean()])),
		inputs: {
			first: ok('a', 'union'),
			last: ok(true, 'union'),
			miss: bad(null, 'issue at the root')
		}
	},
	{
		name: 'union_3_objects',
		fuz_schema: (s) =>
			fp(
				s,
				s.union([
					s.object({ a: s.string, n: s.number }),
					s.object({ b: s.string, n: s.number }),
					s.object({ c: s.string, n: s.number })
				])
			),
		valibot: (v) =>
			vp(
				v,
				v.union([
					v.strictObject({ a: v.string(), n: v.number() }),
					v.strictObject({ b: v.string(), n: v.number() }),
					v.strictObject({ c: v.string(), n: v.number() })
				])
			),
		zod: (z) =>
			zp(
				z.union([
					z.strictObject({ a: z.string(), n: z.number() }),
					z.strictObject({ b: z.string(), n: z.number() }),
					z.strictObject({ c: z.string(), n: z.number() })
				])
			),
		inputs: {
			first: ok(j({ a: 'x', n: 1 }), 'union'),
			last: ok(j({ c: 'x', n: 1 }), 'union'),
			miss: bad(j({ d: 'x', n: 1 }), 'issue at the root')
		}
	},
	{
		name: 'union_5_literals',
		fuz_schema: (s) => fp(s, s.union(LETTERS.map((x) => s.literal(x)))),
		valibot: (v) => vp(v, v.union(LETTERS.map((x) => v.literal(x)))),
		zod: (z) => zp(z.union(LETTERS.map((x) => z.literal(x)))),
		inputs: {
			first: ok('a', 'union'),
			last: ok('e', 'union'),
			miss: bad('z', 'issue at the root')
		}
	},
	{
		name: 'variant_3',
		fuz_schema: (s) =>
			fp(
				s,
				s.variant('type', [
					s.object({ type: s.literal('a'), x: s.string }),
					s.object({ type: s.literal('b'), y: s.number }),
					s.object({ type: s.literal('c'), z: s.boolean })
				])
			),
		valibot: (v) =>
			vp(
				v,
				v.variant('type', [
					v.strictObject({ type: v.literal('a'), x: v.string() }),
					v.strictObject({ type: v.literal('b'), y: v.number() }),
					v.strictObject({ type: v.literal('c'), z: v.boolean() })
				])
			),
		zod: (z) =>
			zp(
				z.discriminatedUnion('type', [
					z.strictObject({ type: z.literal('a'), x: z.string() }),
					z.strictObject({ type: z.literal('b'), y: z.number() }),
					z.strictObject({ type: z.literal('c'), z: z.boolean() })
				])
			),
		inputs: {
			first: ok(j({ type: 'a', x: 'x' }), 'variant'),
			last: ok(j({ type: 'c', z: true }), 'variant'),
			unknown_tag: bad(j({ type: 'q' }), 'issue at depth 1'),
			entry_bad: bad(j({ type: 'b', y: 'no' }), 'issue at depth 1')
		}
	},
	//
	// Pipes
	//
	{
		name: 'pipe_string_lengths',
		fuz_schema: (s) => fp(s, s.pipe(s.string, s.min_length(1), s.max_length(50))),
		valibot: (v) => vp(v, v.pipe(v.string(), v.minLength(1), v.maxLength(50))),
		zod: (z) => zp(z.string().min(1).max(50)),
		inputs: {
			valid: ok('abc', 'pipe'),
			head_bad: bad(1, 'issue at the root'),
			action_bad: bad('', 'issue at the root')
		}
	},
	{
		name: 'pipe_number_4',
		fuz_schema: (s) => fp(s, s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150))),
		valibot: (v) => vp(v, v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150))),
		zod: (z) => zp(z.int().min(0).max(150)),
		inputs: {
			valid: ok(36, 'pipe'),
			last_bad: bad(200, 'issue at the root'),
			first_bad: bad(1.5, 'issue at the root')
		}
	},
	{
		name: 'pipe_regex',
		fuz_schema: (s) => fp(s, s.pipe(s.string, s.regex(/^[a-z0-9-]+$/))),
		valibot: (v) => vp(v, v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))),
		zod: (z) => zp(z.string().regex(/^[a-z0-9-]+$/)),
		inputs: { valid: ok('abc-1', 'pipe'), invalid: bad('A B', 'issue at the root') }
	},
	{
		name: 'pipe_check',
		fuz_schema: (s) =>
			fp(
				s,
				s.pipe(
					s.string,
					s.check((x: string) => x !== 'no')
				)
			),
		valibot: (v) =>
			vp(
				v,
				v.pipe(
					v.string(),
					v.check((x) => x !== 'no')
				)
			),
		zod: (z) => zp(z.string().refine((x) => x !== 'no')),
		inputs: { valid: ok('yes', 'pipe'), invalid: bad('no', 'issue at the root') }
	},
	{
		name: 'pipe_transform',
		fuz_schema: (s) =>
			fp(
				s,
				s.pipe(
					s.string,
					s.transform((x: string) => x.length)
				)
			),
		valibot: (v) =>
			vp(
				v,
				v.pipe(
					v.string(),
					v.transform((x) => x.length)
				)
			),
		zod: (z) => zp(z.string().transform((x) => x.length)),
		inputs: { valid: ok('yes', 'pipe') }
	},
	{
		name: 'form',
		fuz_schema: (s) =>
			fp(
				s,
				s.strip_object({
					name: s.pipe(s.string, s.min_length(1), s.max_length(50)),
					age: s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150)),
					slug: s.pipe(s.string, s.regex(/^[a-z0-9-]+$/))
				})
			),
		valibot: (v) =>
			vp(
				v,
				v.object({
					name: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
					age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
					slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))
				})
			),
		zod: (z) =>
			zp(
				z.object({
					name: z.string().min(1).max(50),
					age: z.int().min(0).max(150),
					slug: z.string().regex(/^[a-z0-9-]+$/)
				})
			),
		inputs: {
			valid: ok(j({ name: 'Ada', age: 36, slug: 'ada-lovelace' }), 'pipe'),
			all_bad: bad(j({ name: '', age: 36.5, slug: 'Ada Lovelace' }), 'many issues')
		}
	},
	//
	// Recursion
	//
	{
		name: 'lazy_tree',
		fuz_schema: (s: Fuz): SurveyRun => {
			const node: fuz_schema.Schema<Tree> = s.object({
				value: s.number,
				children: s.array(s.lazy(() => node))
			});
			return fp(s, node);
		},
		valibot: (v: Valibot): SurveyRun => {
			const node: valibot.GenericSchema<Tree> = v.strictObject({
				value: v.number(),
				children: v.array(v.lazy(() => node))
			});
			return vp(v, node);
		},
		zod: (z: Zod): SurveyRun => {
			const node: zod.ZodType<Tree> = z.strictObject({
				value: z.number(),
				children: z.array(z.lazy(() => node))
			});
			return zp(node);
		},
		inputs: {
			valid: ok(
				j({
					value: 1,
					children: range(4).map((i) => ({
						value: i,
						children: range(3).map((k) => ({ value: k, children: [] }))
					}))
				}),
				'lazy'
			),
			leaf_bad: bad(j({ value: 1, children: [{ value: 2, children: ['x'] }] }), 'issue at depth 4')
		}
	}
];
