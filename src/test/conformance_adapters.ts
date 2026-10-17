/**
 * The libraries the conformance matrix is run through: each adapter gives zod,
 * valibot, and this library the same constructors, and reduces what a parse
 * did to a `ConformanceParsed`. `arktype` and `typebox` are pinned for the
 * cases that name them, and their adapters are partial. The matrix is in
 * `conformance_cases.ts`, and the running and the comparison in
 * `conformance_test_helpers.ts`.
 *
 * @module
 */

import * as z from 'zod';
import * as v from 'valibot';
import { type } from 'arktype';
import { Type as T } from 'typebox';
import { Value } from 'typebox/value';

import * as s from '#lib/schema.ts';

/** What an object schema does with the keys it doesn't name. */
export type ConformanceFlavor = 'strip' | 'strict' | 'loose';

export const CONFORMANCE_FLAVORS: ReadonlyArray<ConformanceFlavor> = ['strip', 'strict', 'loose'];

/** The libraries the rule is about. */
export type ConformanceLibName = 'zod' | 'valibot' | 'fuz_schema';

/** The libraries whose results are pinned and not judged. */
export type InformationalLibName = 'arktype' | 'typebox';

export type ConformanceParsed =
	| { ok: true; value: unknown }
	| {
			ok: false;
			/** The path of every issue that isn't about an unknown key. */
			paths: Array<ReadonlyArray<PropertyKey>>;
			/** The path of every object an issue about an unknown key was in. */
			unknown_keys: Array<ReadonlyArray<PropertyKey>>;
	  };

/**
 * One library's way of writing each schema a case uses. A schema is `any`:
 * a case is written once, against whichever library it is handed.
 */
export interface ConformanceLib {
	string: any;
	/** The library's own `number`, whatever it does with `NaN` and the infinities. */
	number: any;
	/** A number with no fraction, of any size. */
	integer: any;
	/** An integer from `-(2 ** 53 - 1)` to `2 ** 53 - 1`, each a double of its own. */
	safe_integer: any;
	boolean: any;
	bigint: any;
	unknown: any;
	/** The schema of `undefined` alone. */
	undef: any;
	literal: (value: any) => any;
	one_of: (values: Array<any>) => any;
	optional: (schema: any) => any;
	nullable: (schema: any) => any;
	with_default: (schema: any, value: any) => any;
	/** A default made by calling `make` for each value it fills in. */
	with_default_fn: (schema: any, make: () => any) => any;
	lazy: (get: () => any) => any;
	union: (options: Array<any>) => any;
	/** A `union` that keeps what it gives each object or array it is probed with: the others' `union`. */
	memo_union: (options: Array<any>) => any;
	/** The object in `options` whose `key` is a literal of the input's value there. */
	variant: (key: string, options: Array<any>) => any;
	/** `schema`, then a check of its output. */
	refine: (schema: any, fn: (value: any) => boolean) => any;
	/** `schema`, then its output replaced. */
	map: (schema: any, fn: (value: any) => any) => any;
	/** A check with no schema before it. */
	check: (fn: (value: any) => boolean) => any;
	/** A transform with no schema before it. */
	transform: (fn: (value: any) => any) => any;
	/** `schema` with the text of its issues set, which changes no verdict. */
	message: (schema: any) => any;
	/** `schema`, then a check that the output's `length` is at least `min`. */
	min_length: (schema: any, min: number) => any;
	/** `schema`, then a check that the output's `length` is at most `max`. */
	max_length: (schema: any, max: number) => any;
	/** `schema`, then a check that the output is at least `min`, a number or a bigint. */
	min_value: (schema: any, min: number | bigint) => any;
	/** `schema`, then a check that the output is at most `max`, a number or a bigint. */
	max_value: (schema: any, max: number | bigint) => any;
	/** `schema`, then a test of `pattern` on the output, a string. */
	regex: (schema: any, pattern: RegExp) => any;
	strip: (entries: Record<string, any>) => any;
	strict: (entries: Record<string, any>) => any;
	loose: (entries: Record<string, any>) => any;
	/** An object with `entries`, whose every other key's value is validated by `rest`. */
	rest: (entries: Record<string, any>, rest: any) => any;
	record: (schema: any) => any;
	array: (schema: any) => any;
	parse: (schema: any, input: unknown) => ConformanceParsed;
}

export const CONFORMANCE_LIBS: Record<ConformanceLibName, ConformanceLib> = {
	zod: {
		string: z.string(),
		number: z.number(),
		// zod has no check of an integer of any size: `z.int()` and `.int()` are of
		// the safe ones, and `.multipleOf(1)` takes a fraction near enough to an
		// integer, as `2 ** 51 + 0.5`
		integer: z.number().refine(Number.isInteger),
		safe_integer: z.int(),
		boolean: z.boolean(),
		bigint: z.bigint(),
		unknown: z.unknown(),
		undef: z.undefined(),
		literal: (value) => z.literal(value),
		one_of: (values) => z.literal(values),
		optional: (schema) => schema.optional(),
		nullable: (schema) => schema.nullable(),
		with_default: (schema, value) => schema.default(value),
		with_default_fn: (schema, make) => schema.default(make),
		lazy: (get) => z.lazy(get),
		union: (options) => z.union(options),
		memo_union: (options) => z.union(options),
		variant: (key, options) => z.discriminatedUnion(key, options as any),
		refine: (schema, fn) => schema.refine(fn),
		map: (schema, fn) => schema.transform(fn),
		check: (fn) => z.custom(fn),
		transform: (fn) => z.transform(fn),
		// the text is an option of each factory, and nothing wraps a schema to set it
		message: (schema) => schema,
		min_length: (schema, min) => schema.check(z.minLength(min)),
		max_length: (schema, max) => schema.check(z.maxLength(max)),
		min_value: (schema, min) => schema.check(z.gte(min)),
		max_value: (schema, max) => schema.check(z.lte(max)),
		regex: (schema, pattern) => schema.check(z.regex(pattern)),
		strip: (entries) => z.object(entries),
		strict: (entries) => z.strictObject(entries),
		loose: (entries) => z.looseObject(entries),
		rest: (entries, rest) => z.object(entries).catchall(rest),
		record: (schema) => z.record(z.string(), schema),
		array: (schema) => z.array(schema),
		parse: (schema, input) => {
			const result = schema.safeParse(input);
			if (result.success) return { ok: true, value: result.data };
			const issues: Array<any> = result.error.issues;
			return {
				ok: false,
				paths: issues.filter((i) => i.code !== 'unrecognized_keys').map((i) => i.path),
				unknown_keys: issues.filter((i) => i.code === 'unrecognized_keys').map((i) => i.path)
			};
		}
	},
	valibot: {
		string: v.string(),
		number: v.number(),
		integer: v.pipe(v.number(), v.integer()),
		safe_integer: v.pipe(v.number(), v.safeInteger()),
		boolean: v.boolean(),
		bigint: v.bigint(),
		unknown: v.unknown(),
		undef: v.undefined(),
		literal: (value) => v.literal(value),
		// typed for strings, numbers and bigints, and compares any value
		one_of: (values) => v.picklist(values),
		optional: (schema) => v.optional(schema),
		nullable: (schema) => v.nullable(schema),
		with_default: (schema, value) => v.optional(schema, value),
		with_default_fn: (schema, make) => v.optional(schema, make),
		lazy: (get) => v.lazy(get),
		union: (options) => v.union(options),
		memo_union: (options) => v.union(options),
		variant: (key, options) => v.variant(key, options),
		refine: (schema, fn) => v.pipe(schema, v.check(fn)),
		map: (schema, fn) => v.pipe(schema, v.transform(fn)),
		check: (fn) => v.custom(fn),
		// an action, which needs a schema before it: the nearest is one that takes anything
		transform: (fn) => v.pipe(v.unknown(), v.transform(fn)),
		message: (schema) => schema,
		min_length: (schema, min) => v.pipe(schema, v.minLength(min)),
		max_length: (schema, max) => v.pipe(schema, v.maxLength(max)),
		min_value: (schema, min) => v.pipe(schema, v.minValue(min)),
		max_value: (schema, max) => v.pipe(schema, v.maxValue(max)),
		regex: (schema, pattern) => v.pipe(schema, v.regex(pattern)),
		strip: (entries) => v.object(entries),
		strict: (entries) => v.strictObject(entries),
		loose: (entries) => v.looseObject(entries),
		rest: (entries, rest) => v.objectWithRest(entries, rest),
		record: (schema) => v.record(v.string(), schema),
		array: (schema) => v.array(schema),
		parse: (schema, input) => {
			const result = v.safeParse(schema, input);
			if (result.success) return { ok: true, value: result.output };
			// an unknown key is the one issue of a strict object that expected nothing
			const is_unknown_key = (i: any): boolean =>
				i.type === 'strict_object' && i.expected === 'never';
			const issues: Array<any> = result.issues;
			return {
				ok: false,
				paths: issues
					.filter((i) => !is_unknown_key(i))
					.map((i) => (i.path ?? []).map((item: any) => item.key)),
				unknown_keys: issues
					.filter(is_unknown_key)
					.map((i) => i.path.slice(0, -1).map((item: any) => item.key))
			};
		}
	},
	fuz_schema: {
		string: s.string,
		number: s.number,
		integer: s.integer,
		safe_integer: s.safe_integer,
		boolean: s.boolean,
		bigint: s.bigint,
		unknown: s.unknown,
		undef: s.literal(undefined),
		literal: (value) => s.literal(value),
		one_of: (values) => s.one_of(values),
		optional: (schema) => s.optional(schema),
		nullable: (schema) => s.nullable(schema),
		with_default: (schema, value) => s.with_default(schema, value),
		with_default_fn: (schema, make) => s.with_default_fn(schema, make),
		lazy: (get) => s.lazy(get),
		union: (options) => s.union(options),
		memo_union: (options) => s.memo_union(options),
		variant: (key, options) => s.variant(key, options),
		refine: (schema, fn) => s.pipe(schema, s.check(fn)),
		map: (schema, fn) => s.pipe(schema, s.transform(fn)),
		check: (fn) => s.check(fn),
		transform: (fn) => s.transform(fn),
		message: (schema) => s.message(schema, 'text'),
		min_length: (schema, min) => s.pipe(schema, s.min_length(min)),
		max_length: (schema, max) => s.pipe(schema, s.max_length(max)),
		min_value: (schema, min) => s.pipe(schema, s.min_value(min)),
		max_value: (schema, max) => s.pipe(schema, s.max_value(max)),
		regex: (schema, pattern) => s.pipe(schema, s.regex(pattern)),
		strip: (entries) => s.strip_object(entries),
		strict: (entries) => s.object(entries),
		loose: (entries) => s.loose_object(entries),
		rest: (entries, rest) => s.object_with_rest(entries, rest),
		record: (schema) => s.record(schema),
		array: (schema) => s.array(schema),
		parse: (schema, input) => {
			const result = s.parse(schema, input);
			if (result.ok) return result;
			return {
				ok: false,
				paths: result.issues.filter((i) => i.kind !== 'unknown_key').map((i) => i.path),
				unknown_keys: result.issues
					.filter((i) => i.kind === 'unknown_key')
					.map((i) => i.path.slice(0, -1))
			};
		}
	}
};

// a key of an arktype or typebox object that may be missing, until the object is built
const OPTIONAL = Symbol('optional');

const to_arktype_object = (unknown_keys: string, entries: Record<string, any>): any => {
	const def: Record<string, any> = { '+': unknown_keys };
	for (const [key, entry] of Object.entries(entries)) {
		if (entry?.[OPTIONAL]) def[key + '?'] = entry[OPTIONAL];
		else def[key] = entry;
	}
	return type(def as any);
};

const to_typebox_object = (entries: Record<string, any>, options?: any): any =>
	T.Object(
		Object.fromEntries(
			Object.entries(entries).map(([key, entry]) => [
				key,
				entry?.[OPTIONAL] ? T.Optional(entry[OPTIONAL]) : entry
			])
		),
		options
	);

// only a verdict and an output: their issues are not compared
const informational_fail: ConformanceParsed = { ok: false, paths: [], unknown_keys: [] };

/**
 * The two libraries whose results are pinned without being held to the rule,
 * each with only what it has an honest form of. A case that uses a missing
 * member, or a flavor one doesn't have, can't name that library in `also`.
 */
export const INFORMATIONAL_LIBS: Record<InformationalLibName, Partial<ConformanceLib>> = {
	arktype: {
		string: type.string,
		number: type.number,
		unknown: type.unknown,
		optional: (schema) => ({ [OPTIONAL]: schema }),
		with_default: (schema, value) => schema.default(value),
		strip: (entries) => to_arktype_object('delete', entries),
		strict: (entries) => to_arktype_object('reject', entries),
		loose: (entries) => to_arktype_object('ignore', entries),
		parse: (schema, input) => {
			const value = schema(input);
			return value instanceof type.errors ? informational_fail : { ok: true, value };
		}
	},
	// `Value.Parse` checks and returns its input, so it has no object that drops
	// unknown keys and no default. Its `rest` is an object's `additionalProperties`
	typebox: {
		string: T.String(),
		number: T.Number(),
		unknown: T.Unknown(),
		optional: (schema) => ({ [OPTIONAL]: schema }),
		strict: (entries) => to_typebox_object(entries, { additionalProperties: false }),
		loose: (entries) => to_typebox_object(entries),
		rest: (entries, rest) => to_typebox_object(entries, { additionalProperties: rest }),
		parse: (schema, input) => {
			// tells a value that doesn't match by throwing
			try {
				return { ok: true, value: Value.Parse(schema, input) };
			} catch {
				return informational_fail;
			}
		}
	}
};
