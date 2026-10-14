/**
 * The conformance matrix: cases written once and run through zod, valibot and
 * this library, with what each did reduced to a text that can be compared.
 * `schema.conformance.test.ts` holds the rule they are judged by and the
 * tables of what is declared.
 *
 * To add a case, add an entry to `CONFORMANCE_CASES`. The test then says what
 * it needs: nothing where the three agree, a side where zod and valibot
 * differ, and a declared difference where they agree and this library doesn't.
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
	/** A number with no fraction. */
	integer: any;
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
	lazy: (get: () => any) => any;
	union: (options: Array<any>) => any;
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
	strip: (entries: Record<string, any>) => any;
	strict: (entries: Record<string, any>) => any;
	loose: (entries: Record<string, any>) => any;
	record: (schema: any) => any;
	array: (schema: any) => any;
	parse: (schema: any, input: unknown) => ConformanceParsed;
}

export const CONFORMANCE_LIBS: Record<ConformanceLibName, ConformanceLib> = {
	zod: {
		string: z.string(),
		number: z.number(),
		integer: z.int(),
		boolean: z.boolean(),
		bigint: z.bigint(),
		unknown: z.unknown(),
		undef: z.undefined(),
		literal: (value) => z.literal(value),
		one_of: (values) => z.literal(values),
		optional: (schema) => schema.optional(),
		nullable: (schema) => schema.nullable(),
		with_default: (schema, value) => schema.default(value),
		lazy: (get) => z.lazy(get),
		union: (options) => z.union(options),
		variant: (key, options) => z.discriminatedUnion(key, options as any),
		refine: (schema, fn) => schema.refine(fn),
		map: (schema, fn) => schema.transform(fn),
		check: (fn) => z.custom(fn),
		transform: (fn) => z.transform(fn),
		// the text is an option of each factory, and nothing wraps a schema to set it
		message: (schema) => schema,
		strip: (entries) => z.object(entries),
		strict: (entries) => z.strictObject(entries),
		loose: (entries) => z.looseObject(entries),
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
		lazy: (get) => v.lazy(get),
		union: (options) => v.union(options),
		variant: (key, options) => v.variant(key, options),
		refine: (schema, fn) => v.pipe(schema, v.check(fn)),
		map: (schema, fn) => v.pipe(schema, v.transform(fn)),
		check: (fn) => v.custom(fn),
		// an action, which needs a schema before it: the nearest is one that takes anything
		transform: (fn) => v.pipe(v.unknown(), v.transform(fn)),
		message: (schema) => schema,
		strip: (entries) => v.object(entries),
		strict: (entries) => v.strictObject(entries),
		loose: (entries) => v.looseObject(entries),
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
		integer: s.pipe(s.number, s.integer),
		boolean: s.boolean,
		bigint: s.bigint,
		unknown: s.unknown,
		undef: s.literal(undefined),
		literal: (value) => s.literal(value),
		one_of: (values) => s.one_of(values),
		optional: (schema) => s.optional(schema),
		nullable: (schema) => s.nullable(schema),
		with_default: (schema, value) => s.with_default(schema, value),
		lazy: (get) => s.lazy(get),
		union: (options) => s.union(options),
		variant: (key, options) => s.variant(key, options),
		refine: (schema, fn) => s.pipe(schema, s.check(fn)),
		map: (schema, fn) => s.pipe(schema, s.transform(fn)),
		check: (fn) => s.check(fn),
		transform: (fn) => s.transform(fn),
		message: (schema) => s.message(schema, 'text'),
		strip: (entries) => s.strip_object(entries),
		strict: (entries) => s.object(entries),
		loose: (entries) => s.loose_object(entries),
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
	// unknown keys and no default
	typebox: {
		string: T.String(),
		number: T.Number(),
		unknown: T.Unknown(),
		optional: (schema) => ({ [OPTIONAL]: schema }),
		strict: (entries) => to_typebox_object(entries, { additionalProperties: false }),
		loose: (entries) => to_typebox_object(entries),
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

//
// Results as text
//

const render_key = (key: PropertyKey): string => String(key);

// a key of a path, an index told from the string of its digits
const render_path_key = (key: PropertyKey): string =>
	typeof key === 'number' ? `[${key}]` : String(key);

/**
 * Writes `value` as text that two values share only when they'd be told apart
 * by nothing a consumer reads: an object's own keys in the order
 * `Reflect.ownKeys` gives, each value, the keys that aren't enumerable, and
 * whether the prototype is `Object.prototype` (unmarked), `null`, or another.
 */
export const render_value = (value: unknown): string => {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
	if (typeof value === 'bigint') return value + 'n';
	if (typeof value === 'function') return 'fn';
	if (value === null || typeof value !== 'object') return String(value);
	const keys = Reflect.ownKeys(value);
	const entries = (list: Array<PropertyKey>): string =>
		list.map((key) => `${render_key(key)}: ${render_value((value as any)[key])}`).join(', ');
	if (!Array.isArray(value)) return `{${entries(keys)}}` + render_shape(value);
	const items = Array.from({ length: value.length }, (_, i) =>
		i in value ? render_value(value[i]) : '<hole>'
	);
	// an array's own keys past its items
	const rest = keys.filter((key) => key !== 'length' && !is_index(key));
	return (
		`[${items.join(', ')}]` + (rest.length ? ` with {${entries(rest)}}` : '') + render_shape(value)
	);
};

const is_index = (key: PropertyKey): boolean => typeof key === 'string' && /^\d+$/.test(key);

// what an object is past its keys and values: its prototype, when that isn't
// the plain one, and which keys aren't enumerable
const render_shape = (value: object): string => {
	const proto = Object.getPrototypeOf(value);
	const hidden = Reflect.ownKeys(value).filter(
		(key) =>
			!Object.prototype.propertyIsEnumerable.call(value, key) &&
			// every array has it
			!(key === 'length' && Array.isArray(value))
	);
	return (
		(proto === Object.prototype || proto === Array.prototype
			? ''
			: proto === null
				? ' proto=null'
				: ' proto=other') + (hidden.length ? ` hidden=${hidden.map(render_key).join(',')}` : '')
	);
};

/**
 * Writes what a library did as `ok` and the output, or `fail` and where.
 *
 * Of a refusal only this much compares honestly across the three: the paths
 * of the issues that aren't about an unknown key, and the paths of the objects
 * that had one, each once and sorted. An index of an array is written `[1]`,
 * so that it isn't the key `1`. Not compared, because the libraries count
 * differently: how many issues there are (zod reports every unknown key of an
 * object in one issue at the object's path, valibot the first alone at the
 * key's, this library each at its own), which keys were unknown, the kinds of
 * the issues, and their text.
 */
export const render_parsed = (parsed: ConformanceParsed): string => {
	if (parsed.ok) return 'ok ' + render_value(parsed.value);
	const render_paths = (list: Array<ReadonlyArray<PropertyKey>>): string =>
		[...new Set(list.map((path) => path.map(render_path_key).join('.') || '<root>'))]
			.sort()
			.join(', ');
	return (
		'fail' +
		(parsed.paths.length ? ' at ' + render_paths(parsed.paths) : '') +
		(parsed.unknown_keys.length ? ' +unknown keys in ' + render_paths(parsed.unknown_keys) : '')
	);
};

//
// Inputs
//

/** A class whose instances have the key `a`. */
export class ConformancePoint {
	a = 'x';
}

/** An `Array` subclass, whose `slice` makes one of itself. */
export class ConformanceList extends Array<string> {}

const with_hidden = (o: object, key: PropertyKey, value: unknown): object =>
	Object.defineProperty(o, key, { value, enumerable: false, configurable: true, writable: true });

const inheriting = (proto: object | null, own: object = {}): object =>
	Object.assign(Object.create(proto), own);

const SYMBOL = Symbol.for('sym');

//
// Cases
//

type Entries = (l: ConformanceLib) => Record<string, any>;

export interface ConformanceCase {
	name: string;
	/**
	 * The entries of an object schema, for a case about objects: it is run once
	 * through each flavor.
	 */
	entries?: Entries;
	/** A whole schema, for a case that isn't: it is run once. */
	schema?: (l: ConformanceLib) => any;
	/** Makes the input, a new one for every run. */
	input: () => unknown;
	/** The libraries to pin the results of as well, where they have the case's flavor. */
	also?: ReadonlyArray<InformationalLibName>;
}

const BOTH: ReadonlyArray<InformationalLibName> = ['arktype', 'typebox'];

const AB: Entries = (l) => ({ a: l.string, b: l.optional(l.string) });
const AD: Entries = (l) => ({ a: l.string, d: l.with_default(l.string, 'D') });
const B: Entries = (l) => ({ b: l.optional(l.string) });
const DB: Entries = (l) => ({ d: l.with_default(l.string, 'D'), b: l.optional(l.string) });

const NEGATED: Entries = (l) => ({ a: l.map(l.number, (x) => -x) });

// two strict objects told apart by the key `t`, the second with a default to fill
const VARIANT = (l: ConformanceLib): any =>
	l.variant('t', [
		l.strict({ t: l.literal('a'), x: l.string }),
		l.strict({ t: l.literal('b'), d: l.with_default(l.string, 'D') })
	]);

// the same with `undefined` as the first option's value of `t`
const VARIANT_UNDEFINED = (l: ConformanceLib): any =>
	l.variant('t', [l.strict({ t: l.undef, x: l.string }), l.strict({ t: l.literal('b') })]);

// an entry schema as the one key `a`, with the key missing and with it `undefined`
const missing_and_undefined = (
	name: string,
	entry: (l: ConformanceLib) => any
): Array<ConformanceCase> => [
	{ name: `${name}, key missing`, entries: (l) => ({ a: entry(l) }), input: () => ({}) },
	{
		name: `${name}, key undefined`,
		entries: (l) => ({ a: entry(l) }),
		input: () => ({ a: undefined })
	}
];

// the same entry with the key inherited as `undefined`, and with another value
const inherited_and_present = (
	name: string,
	entry: (l: ConformanceLib) => any
): Array<ConformanceCase> => [
	{
		name: `${name}, key inherited`,
		entries: (l) => ({ a: entry(l) }),
		input: () => inheriting({ a: undefined })
	},
	{ name: `${name}, key "x"`, entries: (l) => ({ a: entry(l) }), input: () => ({ a: 'x' }) }
];

// an entry for which a key that is missing is not one that is `undefined`:
// with the key missing, `undefined`, inherited as `undefined`, and another value
const needs_key = (name: string, entry: (l: ConformanceLib) => any): Array<ConformanceCase> => [
	...missing_and_undefined(name, entry),
	...inherited_and_present(name, entry)
];

export const CONFORMANCE_CASES: ReadonlyArray<ConformanceCase> = [
	// known keys
	{ name: 'exact', entries: AB, input: () => ({ a: 'x', b: 'y' }), also: BOTH },
	{ name: 'optional missing', entries: AB, input: () => ({ a: 'x' }), also: BOTH },
	{ name: 'optional undefined', entries: AB, input: () => ({ a: 'x', b: undefined }), also: BOTH },
	{ name: 'optional null', entries: AB, input: () => ({ a: 'x', b: null }) },
	{ name: 'input in another key order', entries: AB, input: () => ({ b: 'y', a: 'x' }) },
	{ name: 'required missing', entries: AB, input: () => ({ b: 'y' }), also: BOTH },
	{ name: 'required undefined', entries: AB, input: () => ({ a: undefined }) },
	{ name: 'required inherited', entries: AB, input: () => inheriting({ a: 'x' }) },
	{ name: 'required non-enumerable', entries: AB, input: () => with_hidden({}, 'a', 'x') },
	{
		name: 'required from a getter',
		entries: AB,
		input: () => ({
			get a() {
				return 'x';
			}
		})
	},
	{
		name: 'optional inherited undefined',
		entries: AB,
		input: () => inheriting({ b: undefined }, { a: 'x' })
	},
	{
		name: 'optional non-enumerable undefined',
		entries: AB,
		input: () => with_hidden({ a: 'x' }, 'b', undefined)
	},
	// the copy a strip object makes to drop a key, with nothing else changed
	{
		name: 'optional inherited undefined + unknown key',
		entries: AB,
		input: () => inheriting({ b: undefined }, { a: 'x', z: 1 })
	},
	{ name: 'two entries wrong', entries: AB, input: () => ({ a: 1, b: 2 }) },
	{ name: 'an entry wrong and an unknown key', entries: AB, input: () => ({ a: 1, z: 1 }) },

	// unknown keys
	{ name: 'unknown key', entries: AB, input: () => ({ a: 'x', z: 1 }), also: BOTH },
	{ name: 'two unknown keys', entries: AB, input: () => ({ a: 'x', z: 1, y: 2 }) },
	{ name: 'unknown key first', entries: AB, input: () => ({ z: 1, a: 'x' }) },
	{ name: 'unknown key undefined', entries: AB, input: () => ({ a: 'x', z: undefined }) },
	{ name: 'unknown symbol key', entries: AB, input: () => ({ a: 'x', [SYMBOL]: 1 }) },
	{
		name: 'unknown non-enumerable key',
		entries: AB,
		input: () => with_hidden({ a: 'x' }, 'z', 1)
	},
	{ name: 'unknown inherited key', entries: AB, input: () => inheriting({ z: 1 }, { a: 'x' }) },
	{
		name: 'unknown own __proto__ key',
		entries: AB,
		input: () => JSON.parse('{"a": "x", "__proto__": {"q": 1}}')
	},
	{ name: 'unknown key named toString', entries: AB, input: () => ({ a: 'x', toString: 1 }) },
	{ name: 'unknown key named constructor', entries: AB, input: () => ({ a: 'x', constructor: 1 }) },
	{ name: 'unknown key named prototype', entries: AB, input: () => ({ a: 'x', prototype: 1 }) },

	// inputs that aren't plain objects
	{ name: 'null prototype', entries: AB, input: () => inheriting(null, { a: 'x' }) },
	{ name: 'class instance', entries: AB, input: () => new ConformancePoint() },
	{
		name: 'class instance + unknown key',
		entries: AB,
		input: () => Object.assign(new ConformancePoint(), { z: 1 })
	},
	{ name: 'array', entries: AB, input: () => [], also: BOTH },
	{ name: 'array with the keys', entries: AB, input: () => Object.assign([], { a: 'x' }) },
	{ name: 'array, all entries optional', entries: B, input: () => [] },
	{ name: 'null', entries: AB, input: () => null },
	{ name: 'undefined', entries: AB, input: () => undefined },
	{ name: 'string', entries: B, input: () => 'x' },
	{ name: 'Date', entries: B, input: () => new Date(0) },
	{ name: 'Map', entries: B, input: () => new Map() },
	{
		name: 'function with the keys',
		entries: AB,
		input: () => Object.assign(() => {}, { a: 'x' })
	},
	{ name: 'empty schema, empty object', entries: () => ({}), input: () => ({}), also: BOTH },
	{ name: 'empty schema, array', entries: () => ({}), input: () => [] },
	{ name: 'empty schema, unknown key', entries: () => ({}), input: () => ({ z: 1 }) },
	{ name: 'schema names length, array', entries: (l) => ({ length: l.number }), input: () => [] },

	// a default makes a copy, which is where the flavors' copies show
	{ name: 'default missing', entries: AD, input: () => ({ a: 'x' }), also: ['arktype'] },
	{ name: 'default undefined', entries: AD, input: () => ({ a: 'x', d: undefined }) },
	{
		name: 'default + optional missing',
		entries: (l) => ({ b: l.optional(l.string), d: l.with_default(l.string, 'D') }),
		input: () => ({})
	},
	{
		name: 'default + optional undefined',
		entries: (l) => ({ b: l.optional(l.string), d: l.with_default(l.string, 'D') }),
		input: () => ({ b: undefined })
	},
	{
		name: 'default + key order',
		entries: (l) => ({ a: l.string, d: l.with_default(l.string, 'D'), c: l.string }),
		input: () => ({ c: 'z', a: 'x' })
	},
	{
		name: 'default + unknown key',
		entries: AD,
		input: () => ({ z: 1, a: 'x' }),
		also: ['arktype']
	},
	{
		name: 'default + unknown keys around the known',
		entries: AD,
		input: () => ({ z: 1, a: 'x', y: 2, d: 'd', x: 3 })
	},
	{ name: 'default + unknown key undefined', entries: AD, input: () => ({ a: 'x', z: undefined }) },
	{ name: 'default + unknown symbol key', entries: AD, input: () => ({ a: 'x', [SYMBOL]: 1 }) },
	{
		name: 'default + unknown non-enumerable key',
		entries: AD,
		input: () => with_hidden({ a: 'x' }, 'z', 1)
	},
	{
		name: 'default + unknown inherited key',
		entries: AD,
		input: () => inheriting({ z: 1 }, { a: 'x' })
	},
	{
		name: 'default + unknown own __proto__ key',
		entries: AD,
		input: () => JSON.parse('{"a": "x", "__proto__": {"q": 1}}')
	},
	{
		name: 'default + unknown key named constructor',
		entries: AD,
		input: () => ({ a: 'x', constructor: 1 })
	},
	{
		name: 'default + unknown key named prototype',
		entries: AD,
		input: () => ({ a: 'x', prototype: 1 })
	},
	{
		name: 'default + unknown key named toString',
		entries: AD,
		input: () => ({ a: 'x', toString: 1 })
	},
	{ name: 'default + required inherited', entries: AD, input: () => inheriting({ a: 'x' }) },
	// the keys of a copy before the entry that changed, and after it
	{
		name: 'default + two keys before it in another order',
		entries: (l) => ({ a: l.string, b: l.string, d: l.with_default(l.string, 'D') }),
		input: () => ({ b: 'y', a: 'x' })
	},
	{
		name: 'default + optional inherited undefined before it',
		entries: (l) => ({ b: l.optional(l.string), d: l.with_default(l.string, 'D') }),
		input: () => inheriting({ b: undefined })
	},
	{ name: 'default + optional missing after it', entries: DB, input: () => ({}) },
	{ name: 'default + optional undefined after it', entries: DB, input: () => ({ b: undefined }) },
	{
		name: 'default + optional inherited undefined after it',
		entries: DB,
		input: () => inheriting({ b: undefined })
	},
	{
		name: 'default + required non-enumerable',
		entries: AD,
		input: () => with_hidden({}, 'a', 'x')
	},
	{
		name: 'default + required from a getter',
		entries: AD,
		input: () => ({
			get a() {
				return 'x';
			}
		})
	},
	{ name: 'default + null prototype', entries: AD, input: () => inheriting(null, { a: 'x' }) },
	{ name: 'default + class instance', entries: AD, input: () => new ConformancePoint() },
	{
		name: 'default + class instance + unknown key',
		entries: AD,
		input: () => Object.assign(new ConformancePoint(), { z: 1 })
	},

	// which entries let their key be missing
	...missing_and_undefined('unknown entry', (l) => l.unknown),
	{
		name: 'unknown entry, key inherited',
		entries: (l) => ({ a: l.unknown }),
		input: () => inheriting({ a: undefined })
	},
	{
		name: 'unknown entry, key non-enumerable',
		entries: (l) => ({ a: l.unknown }),
		input: () => with_hidden({}, 'a', undefined)
	},
	{
		name: 'unknown entry, key missing, null prototype',
		entries: (l) => ({ a: l.unknown }),
		input: () => inheriting(null)
	},
	...missing_and_undefined('optional(unknown) entry', (l) => l.optional(l.unknown)),
	...missing_and_undefined('nullable(unknown) entry', (l) => l.nullable(l.unknown)),
	...missing_and_undefined('lazy(unknown) entry', (l) => l.lazy(() => l.unknown)),
	...missing_and_undefined('union[string, unknown] entry', (l) => l.union([l.string, l.unknown])),
	...missing_and_undefined('unknown then a check entry', (l) => l.refine(l.unknown, () => true)),
	...missing_and_undefined('unknown then a transform entry', (l) => l.map(l.unknown, (x) => x)),
	...missing_and_undefined('message(unknown) entry', (l) => l.message(l.unknown)),
	// an `unknown` under schemas that are one in another
	...missing_and_undefined('nullable(lazy(unknown)) entry', (l) =>
		l.nullable(l.lazy(() => l.unknown))
	),
	...missing_and_undefined('lazy(nullable(unknown)) entry', (l) =>
		l.lazy(() => l.nullable(l.unknown))
	),
	...missing_and_undefined('lazy(lazy(unknown)) entry', (l) =>
		l.lazy(() => l.lazy(() => l.unknown))
	),
	...missing_and_undefined('nullable(union[string, unknown]) entry', (l) =>
		l.nullable(l.union([l.string, l.unknown]))
	),
	...missing_and_undefined('union[number, nullable(unknown)] entry', (l) =>
		l.union([l.number, l.nullable(l.unknown)])
	),
	...missing_and_undefined('union[number, lazy(unknown)] entry', (l) =>
		l.union([l.number, l.lazy(() => l.unknown)])
	),
	...missing_and_undefined('union[unknown, optional(string)] entry', (l) =>
		l.union([l.unknown, l.optional(l.string)])
	),
	...missing_and_undefined('union[number, unknown then a check] entry', (l) =>
		l.union([l.number, l.refine(l.unknown, () => true)])
	),
	...missing_and_undefined('lazy(unknown) then a check entry', (l) =>
		l.refine(
			l.lazy(() => l.unknown),
			() => true
		)
	),
	...missing_and_undefined('nullable(unknown) then a transform to "T" entry', (l) =>
		l.map(l.nullable(l.unknown), () => 'T')
	),
	...missing_and_undefined('lazy(unknown then a check) entry', (l) =>
		l.lazy(() => l.refine(l.unknown, () => true))
	),
	...missing_and_undefined('unknown then a check, then a check entry', (l) =>
		l.refine(
			l.refine(l.unknown, () => true),
			() => true
		)
	),
	...missing_and_undefined('message(nullable(unknown)) entry', (l) =>
		l.message(l.nullable(l.unknown))
	),
	...missing_and_undefined('nullable(message(unknown)) entry', (l) =>
		l.nullable(l.message(l.unknown))
	),
	...missing_and_undefined('message(lazy(unknown)) entry', (l) =>
		l.message(l.lazy(() => l.unknown))
	),
	...missing_and_undefined('message(union[string, unknown]) entry', (l) =>
		l.message(l.union([l.string, l.unknown]))
	),
	...missing_and_undefined('message(unknown then a check) entry', (l) =>
		l.message(l.refine(l.unknown, () => true))
	),
	...missing_and_undefined('default(unknown) entry', (l) => l.with_default(l.unknown, 'D')),
	// a `literal` of `undefined` and a `one_of` with it need their key too, as
	// the entry and where another schema hands them the object
	...needs_key('literal(undefined) entry', (l) => l.undef),
	...needs_key('one_of with undefined entry', (l) => l.one_of(['x', undefined])),
	...needs_key('nullable(literal(undefined)) entry', (l) => l.nullable(l.undef)),
	...needs_key('lazy(literal(undefined)) entry', (l) => l.lazy(() => l.undef)),
	...needs_key('message(literal(undefined)) entry', (l) => l.message(l.undef)),
	...needs_key('literal(undefined) then a check entry', (l) => l.refine(l.undef, () => true)),
	...needs_key('literal(undefined) then a transform to "T" entry', (l) =>
		l.map(l.undef, () => 'T')
	),
	...needs_key('union[number, undefined] entry', (l) => l.union([l.number, l.undef])),
	...needs_key('nullable(one_of with undefined) entry', (l) =>
		l.nullable(l.one_of(['x', undefined]))
	),
	...needs_key('lazy(one_of with undefined) entry', (l) =>
		l.lazy(() => l.one_of(['x', undefined]))
	),
	...needs_key('union[number, one_of with undefined] entry', (l) =>
		l.union([l.number, l.one_of(['x', undefined])])
	),
	...needs_key('one_of with undefined then a check entry', (l) =>
		l.refine(l.one_of(['x', undefined]), () => true)
	),
	...missing_and_undefined('optional(literal(undefined)) entry', (l) => l.optional(l.undef)),
	...missing_and_undefined('union[literal(undefined), optional(string)] entry', (l) =>
		l.union([l.undef, l.optional(l.string)])
	),
	// an option that needs its key before a default that lets it be missing: the
	// key is optional, and the first option is tried on the `undefined`
	...missing_and_undefined('union[unknown, default] entry', (l) =>
		l.union([l.unknown, l.with_default(l.string, 'D')])
	),
	...missing_and_undefined('union[unknown then a transform to "U", default] entry', (l) =>
		l.union([l.map(l.unknown, (x) => x ?? 'U'), l.with_default(l.string, 'D')])
	),
	...missing_and_undefined(
		'union[unknown then a transform, default] then a check of defined entry',
		(l) =>
			l.refine(
				l.union([l.map(l.unknown, (x) => x), l.with_default(l.string, 'D')]),
				(x) => x !== undefined
			)
	),
	// before an option that leaves the key `undefined`, as an `optional` does, no
	// option is tried again: the first that matches is the union's
	...missing_and_undefined('union[unknown then a transform to "U", optional(string)] entry', (l) =>
		l.union([l.map(l.unknown, (x) => x ?? 'U'), l.optional(l.string)])
	),
	// where zod tries the options before again and this library doesn't: a
	// default after the option that matches, a transform after the union, a
	// default whose value is `undefined`, and a union that fills the key in
	// inside another, beside the same options in one union
	...missing_and_undefined(
		'union[unknown then a transform to "U", optional(string), default] entry',
		(l) =>
			l.union([
				l.map(l.unknown, (x) => x ?? 'U'),
				l.optional(l.string),
				l.with_default(l.string, 'D')
			])
	),
	...missing_and_undefined(
		'union[unknown then a transform to "U", optional(string)] then a transform entry',
		(l) => l.map(l.union([l.map(l.unknown, (x) => x ?? 'U'), l.optional(l.string)]), (x) => x)
	),
	...missing_and_undefined(
		'union[unknown then a transform to "U", default(optional(string), undefined)] entry',
		(l) =>
			l.union([l.map(l.unknown, (x) => x ?? 'U'), l.with_default(l.optional(l.string), undefined)])
	),
	...missing_and_undefined(
		'union[unknown then a transform to "U", union[string, unknown, default]] entry',
		(l) =>
			l.union([
				l.map(l.unknown, (x) => x ?? 'U'),
				l.union([l.string, l.unknown, l.with_default(l.string, 'D')])
			])
	),
	...missing_and_undefined(
		'union[unknown then a transform to "U", string, unknown, default] entry',
		(l) =>
			l.union([
				l.map(l.unknown, (x) => x ?? 'U'),
				l.string,
				l.unknown,
				l.with_default(l.string, 'D')
			])
	),
	...missing_and_undefined(
		'union[optional(string) then a transform to "T", optional(number)] entry',
		(l) => l.union([l.map(l.optional(l.string), () => 'T'), l.optional(l.number)])
	),
	...missing_and_undefined('bare check entry', (l) => l.check(() => true)),
	...missing_and_undefined('bare transform entry', (l) => l.transform((x) => x)),
	// a `check` that another schema holds: it is handed the object, and doesn't look
	...missing_and_undefined('nullable(check) entry', (l) => l.nullable(l.check(() => true))),
	...missing_and_undefined('lazy(check) entry', (l) => l.lazy(() => l.check(() => true))),
	...missing_and_undefined('union[string, check] entry', (l) =>
		l.union([l.string, l.check(() => true)])
	),
	...missing_and_undefined('bare transform to "T" entry', (l) => l.transform(() => 'T')),
	...missing_and_undefined('string entry', (l) => l.string),
	...missing_and_undefined('nullable(string) entry', (l) => l.nullable(l.string)),
	{
		name: 'nullable(string) entry, key null',
		entries: (l) => ({ a: l.nullable(l.string) }),
		input: () => ({ a: null })
	},
	...missing_and_undefined('optional(string) entry', (l) => l.optional(l.string)),
	...missing_and_undefined('union[string, undefined] entry', (l) => l.union([l.string, l.undef])),
	...missing_and_undefined('union[string, optional(number)] entry', (l) =>
		l.union([l.string, l.optional(l.number)])
	),
	...missing_and_undefined('nullable(optional(string)) entry', (l) =>
		l.nullable(l.optional(l.string))
	),
	...missing_and_undefined('optional(nullable(string)) entry', (l) =>
		l.optional(l.nullable(l.string))
	),
	...missing_and_undefined('lazy(optional(string)) entry', (l) =>
		l.lazy(() => l.optional(l.string))
	),
	...missing_and_undefined('optional(string) then a transform entry', (l) =>
		l.map(l.optional(l.string), (x) => x)
	),
	// a schema that lets its key be missing, with steps after it: with the key
	// missing, whether they run, and what is done with one that fails
	...needs_key('optional(string) then a transform to "T" entry', (l) =>
		l.map(l.optional(l.string), () => 'T')
	),
	...needs_key('optional(string) then a check that fails entry', (l) =>
		l.refine(l.optional(l.string), () => false)
	),
	...needs_key('optional(string) then a check entry', (l) =>
		l.refine(l.optional(l.string), () => true)
	),
	...needs_key('optional(unknown) then a check that fails entry', (l) =>
		l.refine(l.optional(l.unknown), () => false)
	),
	...needs_key('optional(nullable(string)) then a check that fails entry', (l) =>
		l.refine(l.optional(l.nullable(l.string)), () => false)
	),
	...needs_key('message(optional(string)) then a check that fails entry', (l) =>
		l.refine(l.message(l.optional(l.string)), () => false)
	),
	...needs_key('message(optional(string)) then a transform to "T" entry', (l) =>
		l.map(l.message(l.optional(l.string)), () => 'T')
	),
	// a pipe that starts with one that starts with an optional
	...needs_key('optional(string) then a check, then a check that fails entry', (l) =>
		l.refine(
			l.refine(l.optional(l.string), () => true),
			() => false
		)
	),
	...needs_key('optional(string) then a check, then a transform to "T" entry', (l) =>
		l.map(
			l.refine(l.optional(l.string), () => true),
			() => 'T'
		)
	),
	// the same pipe under a schema that hands it the object and the key
	...needs_key('nullable(optional(string) then a check that fails) entry', (l) =>
		l.nullable(l.refine(l.optional(l.string), () => false))
	),
	...needs_key('lazy(optional(string) then a transform to "T") entry', (l) =>
		l.lazy(() => l.map(l.optional(l.string), () => 'T'))
	),
	...needs_key('union[number, optional(string) then a check that fails] entry', (l) =>
		l.union([l.number, l.refine(l.optional(l.string), () => false)])
	),
	// and with a transform among its steps, beside one that fails: zod drops a
	// failed step only where no step is a transform, so both refuse
	...needs_key('nullable(optional(string) then a transform, then a check that fails) entry', (l) =>
		l.nullable(
			l.refine(
				l.map(l.optional(l.string), (x) => x),
				() => false
			)
		)
	),
	...needs_key('lazy(optional(string) then a check that fails, then a transform) entry', (l) =>
		l.lazy(() =>
			l.map(
				l.refine(l.optional(l.string), () => false),
				(x) => x
			)
		)
	),
	...needs_key(
		'union[number, optional(string) then a transform, then a check that fails] entry',
		(l) =>
			l.union([
				l.number,
				l.refine(
					l.map(l.optional(l.string), (x) => x),
					() => false
				)
			])
	),
	// and with the transform a step of a pipe around the nullable or the lazy,
	// which zod reports the failed step beside as well
	...needs_key(
		'nullable(optional(string) then a check that fails) then a transform to "T" entry',
		(l) => l.map(l.nullable(l.refine(l.optional(l.string), () => false)), () => 'T')
	),
	...needs_key(
		'lazy(optional(string) then a check that fails) then a transform to "T" entry',
		(l) =>
			l.map(
				l.lazy(() => l.refine(l.optional(l.string), () => false)),
				() => 'T'
			)
	),
	// under a `message`, which hands it that it is the entry itself, as the entry
	...needs_key('message(optional(string) then a transform, then a check that fails) entry', (l) =>
		l.message(
			l.refine(
				l.map(l.optional(l.string), (x) => x),
				() => false
			)
		)
	),
	// and under a `nullable` around a `message`, or a `message` around one, which don't
	...needs_key('nullable(message(optional(string) then a check that fails)) entry', (l) =>
		l.nullable(l.message(l.refine(l.optional(l.string), () => false)))
	),
	...needs_key('message(nullable(optional(string) then a check that fails)) entry', (l) =>
		l.message(l.nullable(l.refine(l.optional(l.string), () => false)))
	),
	...needs_key('union[number, optional(string) then a transform to "T"] entry', (l) =>
		l.union([l.number, l.map(l.optional(l.string), () => 'T')])
	),
	// which as the entry itself valibot leaves out
	...needs_key('optional(string) then a transform, then a check that fails entry', (l) =>
		l.refine(
			l.map(l.optional(l.string), (x) => x),
			() => false
		)
	),
	// an optional under another schema, with steps after that one
	...needs_key('nullable(optional(string)) then a check that fails entry', (l) =>
		l.refine(l.nullable(l.optional(l.string)), () => false)
	),
	...needs_key('nullable(optional(string)) then a transform to "T" entry', (l) =>
		l.map(l.nullable(l.optional(l.string)), () => 'T')
	),
	...needs_key('lazy(optional(string)) then a check that fails entry', (l) =>
		l.refine(
			l.lazy(() => l.optional(l.string)),
			() => false
		)
	),
	...needs_key('lazy(optional(string)) then a transform to "T" entry', (l) =>
		l.map(
			l.lazy(() => l.optional(l.string)),
			() => 'T'
		)
	),
	// a pipe that starts with one that starts with a lazy
	...needs_key('lazy(optional(string)) then a transform, then a check that fails entry', (l) =>
		l.refine(
			l.map(
				l.lazy(() => l.optional(l.string)),
				(x) => x
			),
			() => false
		)
	),
	...needs_key('union[number, optional(string)] then a check that fails entry', (l) =>
		l.refine(l.union([l.number, l.optional(l.string)]), () => false)
	),
	...needs_key('union[number, optional(string)] then a transform to "T" entry', (l) =>
		l.map(l.union([l.number, l.optional(l.string)]), () => 'T')
	),
	// a default before the steps, which is not `undefined` when they run
	...needs_key('default then a check that fails entry', (l) =>
		l.refine(l.with_default(l.string, 'D'), () => false)
	),
	...needs_key('default then a transform entry', (l) =>
		l.map(l.with_default(l.string, 'D'), (x) => x + '!')
	),
	...needs_key('optional(default) then a check that fails entry', (l) =>
		l.refine(l.optional(l.with_default(l.string, 'D')), () => false)
	),
	...needs_key('optional(default) then a transform to "T" entry', (l) =>
		l.map(l.optional(l.with_default(l.string, 'D')), () => 'T')
	),
	...needs_key('default of undefined then a check that fails entry', (l) =>
		l.refine(l.with_default(l.optional(l.string), undefined), () => false)
	),
	...needs_key('default of undefined then a transform to "T" entry', (l) =>
		l.map(l.with_default(l.optional(l.string), undefined), () => 'T')
	),
	...missing_and_undefined('optional(string then a transform to "T") entry', (l) =>
		l.optional(l.map(l.string, () => 'T'))
	),
	...missing_and_undefined('default entry', (l) => l.with_default(l.string, 'D')),
	// a default whose step gives `undefined`
	...missing_and_undefined('default then a transform to undefined entry', (l) =>
		l.map(l.with_default(l.string, 'D'), () => undefined)
	),
	...missing_and_undefined('optional(default) entry', (l) =>
		l.optional(l.with_default(l.string, 'D'))
	),
	...missing_and_undefined('nullable(default) entry', (l) =>
		l.nullable(l.with_default(l.string, 'D'))
	),
	...missing_and_undefined('lazy(default) entry', (l) =>
		l.lazy(() => l.with_default(l.string, 'D'))
	),
	...missing_and_undefined('default of undefined entry', (l) =>
		l.with_default(l.optional(l.string), undefined)
	),

	// entries named like what an object already has
	{
		name: 'entry named toString, optional, missing',
		entries: (l) => ({ toString: l.optional(l.string) }),
		input: () => ({})
	},
	{
		name: 'entry named toString, optional, missing, null prototype',
		entries: (l) => ({ toString: l.optional(l.string) }),
		input: () => inheriting(null)
	},
	{
		name: 'entry named toString, own',
		entries: (l) => ({ toString: l.string }),
		input: () => ({ toString: 'x' })
	},
	{
		name: 'entry named toString, required, missing',
		entries: (l) => ({ toString: l.string }),
		input: () => ({})
	},
	{
		name: 'entry named constructor, unknown, missing',
		entries: (l) => ({ constructor: l.unknown }),
		input: () => ({})
	},
	{
		name: 'entry named constructor, unknown, missing, null prototype',
		entries: (l) => ({ constructor: l.unknown }),
		input: () => inheriting(null)
	},
	{
		name: 'entry named constructor, unknown, missing, beside a default',
		entries: (l) => ({ constructor: l.unknown, d: l.with_default(l.string, 'D') }),
		input: () => ({})
	},
	{
		name: 'entry named hasOwnProperty, own',
		entries: (l) => ({ hasOwnProperty: l.string }),
		input: () => ({ hasOwnProperty: 'x' })
	},
	{
		name: 'entry named __proto__, own',
		entries: (l) => ({ ['__proto__']: l.optional(l.string), a: l.string }),
		input: () => JSON.parse('{"a": "x", "__proto__": "p"}')
	},
	{
		name: 'entry named __proto__, missing',
		entries: (l) => ({ ['__proto__']: l.optional(l.string), a: l.string }),
		input: () => ({ a: 'x' })
	},
	{
		name: 'entry named __proto__, missing, null prototype',
		entries: (l) => ({ ['__proto__']: l.optional(l.string), a: l.string }),
		input: () => inheriting(null, { a: 'x' })
	},
	{
		name: 'entry named __proto__, own object, beside a default',
		entries: (l) => ({ ['__proto__']: l.unknown, d: l.with_default(l.string, 'D') }),
		input: () => JSON.parse('{"__proto__": {"q": 1}}')
	},
	{
		name: 'entry named __proto__, own string, beside a default',
		entries: (l) => ({ ['__proto__']: l.unknown, d: l.with_default(l.string, 'D') }),
		input: () => JSON.parse('{"__proto__": "p"}')
	},

	// objects in objects, of the same flavor and of others
	{
		name: 'a strip object inside, unknown key in it',
		entries: (l) => ({ n: l.strip({ a: l.string }) }),
		input: () => ({ n: { a: 'x', z: 1 } })
	},
	{
		name: 'a strict object inside, unknown key in it',
		entries: (l) => ({ n: l.strict({ a: l.string }) }),
		input: () => ({ n: { a: 'x', z: 1 } })
	},
	{
		name: 'a loose object with a default inside, unknown key in it',
		entries: (l) => ({ n: l.loose({ a: l.string, d: l.with_default(l.string, 'D') }) }),
		input: () => ({ n: { z: 1, a: 'x' } })
	},
	{
		name: 'strip and loose inside strict, unknown key in each',
		schema: (l) => l.strict({ strip: l.strip({ a: l.string }), loose: l.loose({ a: l.string }) }),
		input: () => ({ strip: { a: 'x', z: 1 }, loose: { a: 'x', z: 1 } })
	},
	{
		name: 'a default beside a class instance inside',
		entries: (l) => ({ n: l.strict({ a: l.string }), d: l.with_default(l.string, 'D') }),
		input: () => ({ n: new ConformancePoint() })
	},
	{
		name: 'loose around strip, unknown key in both',
		schema: (l) => l.loose({ n: l.strip({ a: l.string }) }),
		input: () => ({ n: { a: 'x', z: 1 }, z: 1 })
	},
	{
		name: 'strip around loose, unknown key in both',
		schema: (l) => l.strip({ n: l.loose({ a: l.string }) }),
		input: () => ({ n: { a: 'x', z: 1 }, z: 1 })
	},
	{
		name: 'loose around loose with a default, unknown key in both',
		schema: (l) => l.loose({ n: l.loose({ a: l.string, d: l.with_default(l.string, 'D') }) }),
		input: () => ({ z: 1, n: { z: 1, a: 'x' } })
	},
	{
		name: 'nested, an entry wrong inside',
		schema: (l) => l.strict({ n: l.strict({ a: l.string }) }),
		input: () => ({ n: { a: 1 } })
	},
	{
		name: 'array of strip objects, unknown key in one',
		schema: (l) => l.array(l.strip({ a: l.string })),
		input: () => [{ a: 'x' }, { a: 'y', z: 1 }]
	},

	// records
	{ name: 'record', schema: (l) => l.record(l.number), input: () => ({ a: 1, b: 2 }) },
	{ name: 'record, a value wrong', schema: (l) => l.record(l.number), input: () => ({ a: 'x' }) },
	{
		name: 'record, own __proto__ key',
		schema: (l) => l.record(l.unknown),
		input: () => JSON.parse('{"a": 1, "__proto__": {"q": 1}}')
	},
	{
		name: 'record, own __proto__ key whose value is wrong',
		schema: (l) => l.record(l.number),
		input: () => JSON.parse('{"a": 1, "__proto__": "p"}')
	},
	{
		name: 'record of defaults, own __proto__ key',
		schema: (l) => l.record(l.with_default(l.number, 0)),
		input: () => Object.assign(JSON.parse('{"__proto__": 1}'), { a: undefined })
	},
	{
		name: 'record, symbol key',
		schema: (l) => l.record(l.number),
		input: () => ({ a: 1, [SYMBOL]: 'x' })
	},
	{
		name: 'record, symbol key whose value is right',
		schema: (l) => l.record(l.number),
		input: () => ({ a: 1, [SYMBOL]: 2 })
	},
	{
		name: 'record, non-enumerable key',
		schema: (l) => l.record(l.number),
		input: () => with_hidden({ a: 1 }, 'z', 'x')
	},
	{
		name: 'record, inherited key',
		schema: (l) => l.record(l.number),
		input: () => inheriting({ z: 'x' }, { a: 1 })
	},
	{
		name: 'record, null prototype',
		schema: (l) => l.record(l.number),
		input: () => inheriting(null, { a: 1 })
	},
	{
		name: 'record, class instance',
		schema: (l) => l.record(l.string),
		input: () => new ConformancePoint()
	},
	{ name: 'record, array', schema: (l) => l.record(l.unknown), input: () => [] },
	{
		name: 'record, key named toString',
		schema: (l) => l.record(l.number),
		input: () => ({ toString: 1 })
	},
	{
		name: 'record of defaults, an inherited key',
		schema: (l) => l.record(l.with_default(l.number, 0)),
		input: () => inheriting({ z: 'x' }, { a: 1, b: undefined })
	},
	{
		name: 'record of defaults, a value undefined',
		schema: (l) => l.record(l.with_default(l.number, 0)),
		input: () => ({ b: 1, a: undefined })
	},

	// arrays
	{ name: 'array of strings', schema: (l) => l.array(l.string), input: () => ['x', 'y'] },
	// eslint-disable-next-line no-sparse-arrays
	{ name: 'array of strings, a hole', schema: (l) => l.array(l.string), input: () => ['x', , 'y'] },
	{
		name: 'array of optionals, a hole',
		schema: (l) => l.array(l.optional(l.string)),
		// eslint-disable-next-line no-sparse-arrays
		input: () => ['x', , 'y']
	},
	{
		name: 'array of optionals, a hole before an item that changes',
		schema: (l) => l.array(l.optional(l.map(l.string, (x) => x + '!'))),
		// eslint-disable-next-line no-sparse-arrays
		input: () => [, 'x']
	},
	{
		name: 'array of optionals, a hole after an item that changes',
		schema: (l) => l.array(l.optional(l.map(l.string, (x) => x + '!'))),
		// eslint-disable-next-line no-sparse-arrays
		input: () => ['x', , 'y']
	},
	{
		name: 'array of defaults, a hole',
		schema: (l) => l.array(l.with_default(l.string, 'D')),
		// eslint-disable-next-line no-sparse-arrays
		input: () => ['x', , 'y']
	},
	{
		name: 'array with another key',
		schema: (l) => l.array(l.string),
		input: () => Object.assign(['x'], { z: 1 })
	},
	{
		name: 'array with another key, an item changes',
		schema: (l) => l.array(l.map(l.string, (x) => x + '!')),
		input: () => Object.assign(['x'], { z: 1 })
	},
	{
		name: 'array of a subclass',
		schema: (l) => l.array(l.string),
		input: () => ConformanceList.from(['x'])
	},
	{
		name: 'array of a subclass, an item changes',
		schema: (l) => l.array(l.map(l.string, (x) => x + '!')),
		input: () => ConformanceList.from(['x'])
	},
	{
		name: 'array, an object like one',
		schema: (l) => l.array(l.string),
		input: () => ({ 0: 'x', length: 1 })
	},
	{ name: 'array, an item wrong', schema: (l) => l.array(l.string), input: () => ['x', 1] },

	// a transform between the two zeros, and a `NaN` that passes, in each container
	{ name: 'entry negated, 0', entries: NEGATED, input: () => ({ a: 0 }) },
	{ name: 'entry negated, -0', entries: NEGATED, input: () => ({ a: -0 }) },
	{
		name: 'entry negated, 0 after one that changes',
		entries: (l) => ({ b: l.map(l.number, (x) => -x), a: l.map(l.number, (x) => -x) }),
		input: () => ({ b: 1, a: 0 })
	},
	{ name: 'entry unknown, NaN', entries: (l) => ({ a: l.unknown }), input: () => ({ a: NaN }) },
	{
		name: 'record negated, both zeros',
		schema: (l) => l.record(l.map(l.number, (x) => -x)),
		input: () => ({ a: 0, b: -0 })
	},
	{ name: 'record of unknown, NaN', schema: (l) => l.record(l.unknown), input: () => ({ a: NaN }) },
	{
		name: 'array negated, both zeros',
		schema: (l) => l.array(l.map(l.number, (x) => -x)),
		input: () => [0, -0]
	},
	{ name: 'array of unknown, NaN', schema: (l) => l.array(l.unknown), input: () => [NaN] },

	// primitives
	{ name: 'number, NaN', schema: (l) => l.number, input: () => NaN },
	{ name: 'number, Infinity', schema: (l) => l.number, input: () => Infinity },
	{ name: 'number, -Infinity', schema: (l) => l.number, input: () => -Infinity },
	// what `JSON.parse` reads a number too large for a double as
	{ name: 'number, 1e999 parsed', schema: (l) => l.number, input: () => JSON.parse('1e999') },
	{
		name: 'number entry, -1e999 parsed',
		entries: (l) => ({ a: l.number }),
		input: () => JSON.parse('{"a":-1e999}')
	},
	{
		name: 'array of numbers, an Infinity',
		schema: (l) => l.array(l.number),
		input: () => [1, Infinity]
	},
	{ name: 'number, the largest double', schema: (l) => l.number, input: () => Number.MAX_VALUE },
	{ name: 'number, the smallest double', schema: (l) => l.number, input: () => Number.MIN_VALUE },
	{ name: 'number, past the safe integers', schema: (l) => l.number, input: () => 2 ** 60 },
	{ name: 'number, -0', schema: (l) => l.number, input: () => -0 },
	{ name: 'number, a string of one', schema: (l) => l.number, input: () => '1' },
	{ name: 'number, a Number object', schema: (l) => l.number, input: () => Object(1) },
	{ name: 'integer, a fraction', schema: (l) => l.integer, input: () => 1.5 },
	{ name: 'integer, past the safe ones', schema: (l) => l.integer, input: () => 2 ** 53 },
	{ name: 'integer, Infinity', schema: (l) => l.integer, input: () => Infinity },
	{ name: 'integer, the largest double', schema: (l) => l.integer, input: () => Number.MAX_VALUE },
	{ name: 'integer, the last safe one', schema: (l) => l.integer, input: () => 2 ** 53 - 1 },
	{ name: 'string, a String object', schema: (l) => l.string, input: () => Object('x') },
	{ name: 'boolean, 0', schema: (l) => l.boolean, input: () => 0 },
	{ name: 'bigint, a number', schema: (l) => l.bigint, input: () => 1 },
	{ name: 'bigint, a bigint', schema: (l) => l.bigint, input: () => 1n },
	{ name: 'literal 0, -0', schema: (l) => l.literal(0), input: () => -0 },
	{ name: 'literal NaN, NaN', schema: (l) => l.literal(NaN), input: () => NaN },
	{ name: 'literal NaN, a number', schema: (l) => l.literal(NaN), input: () => 1 },
	{ name: 'literal 1, NaN', schema: (l) => l.literal(1), input: () => NaN },
	// a literal of an infinity is not a `number`
	{
		name: 'literal Infinity, Infinity',
		schema: (l) => l.literal(Infinity),
		input: () => Infinity
	},
	{
		name: 'literal Infinity, -Infinity',
		schema: (l) => l.literal(Infinity),
		input: () => -Infinity
	},
	{
		name: 'one_of with Infinity, Infinity',
		schema: (l) => l.one_of([Infinity, 1]),
		input: () => Infinity
	},
	{
		name: 'literal "x", a String object',
		schema: (l) => l.literal('x'),
		input: () => Object('x')
	},
	{ name: 'literal(undefined), null', schema: (l) => l.undef, input: () => null },
	{ name: 'one_of, a value not among them', schema: (l) => l.one_of(['x', 'y']), input: () => 'z' },
	{ name: 'one_of with NaN, NaN', schema: (l) => l.one_of([NaN, 1]), input: () => NaN },
	{ name: 'one_of with 0, -0', schema: (l) => l.one_of([0, 1]), input: () => -0 },
	{ name: 'unknown, undefined', schema: (l) => l.unknown, input: () => undefined },
	{ name: 'optional(string), null', schema: (l) => l.optional(l.string), input: () => null },
	{
		name: 'nullable(string), undefined',
		schema: (l) => l.nullable(l.string),
		input: () => undefined
	},
	{
		name: 'default, undefined',
		schema: (l) => l.with_default(l.string, 'D'),
		input: () => undefined
	},
	{ name: 'default, null', schema: (l) => l.with_default(l.string, 'D'), input: () => null },

	// unions, pipes, and the actions alone
	{
		name: 'union, no option',
		schema: (l) => l.union([l.string, l.number]),
		input: () => true
	},
	{
		name: 'union, one option near',
		schema: (l) => l.union([l.strict({ a: l.string }), l.string]),
		input: () => ({ a: 1 })
	},
	{
		name: 'union in an object, no option',
		schema: (l) => l.strict({ u: l.union([l.string, l.number]) }),
		input: () => ({ u: true })
	},
	{
		name: 'union, the first option that matches',
		schema: (l) => l.union([l.strip({ a: l.string }), l.loose({ a: l.string })]),
		input: () => ({ a: 'x', z: 1 })
	},
	{ name: 'variant, the first option', schema: VARIANT, input: () => ({ t: 'a', x: 'x' }) },
	{ name: 'variant, the second option, a default', schema: VARIANT, input: () => ({ t: 'b' }) },
	{ name: 'variant, no option has the value', schema: VARIANT, input: () => ({ t: 'c' }) },
	{ name: 'variant, key missing', schema: VARIANT, input: () => ({ x: 'x' }) },
	{
		name: 'variant, a literal(undefined) discriminator, key missing',
		schema: VARIANT_UNDEFINED,
		input: () => ({ x: 'x' })
	},
	{
		name: 'variant, a literal(undefined) discriminator, key undefined',
		schema: VARIANT_UNDEFINED,
		input: () => ({ t: undefined, x: 'x' })
	},
	{
		name: 'variant, a literal(undefined) discriminator, key inherited',
		schema: VARIANT_UNDEFINED,
		input: () => inheriting({ t: undefined }, { x: 'x' })
	},
	{
		name: 'variant, a literal(undefined) discriminator, the other option',
		schema: VARIANT_UNDEFINED,
		input: () => ({ t: 'b' })
	},
	{
		name: 'variant, a literal(undefined) discriminator, key missing, an entry wrong',
		schema: VARIANT_UNDEFINED,
		input: () => ({ x: 1 })
	},
	{ name: 'variant, key inherited', schema: VARIANT, input: () => inheriting({ t: 'b' }) },
	{ name: 'variant, an entry wrong', schema: VARIANT, input: () => ({ t: 'a', x: 1 }) },
	{ name: 'variant, unknown key', schema: VARIANT, input: () => ({ t: 'a', x: 'x', z: 1 }) },
	{ name: 'variant, null', schema: VARIANT, input: () => null },
	{ name: 'variant, array', schema: VARIANT, input: () => [] },
	{
		name: 'variant, array with the key',
		schema: VARIANT,
		input: () => Object.assign([], { t: 'b' })
	},
	{
		name: 'a check that fails',
		schema: (l) => l.refine(l.string, () => false),
		input: () => 'x'
	},
	{
		name: 'a check after a schema that fails',
		schema: (l) =>
			l.refine(l.string, (x) => {
				// reached only by a library that goes on after a failure
				if (typeof x !== 'string') throw new Error('ran on a value its schema refused');
				return true;
			}),
		input: () => 1
	},
	{ name: 'a transform', schema: (l) => l.map(l.string, (x) => x + '!'), input: () => 'x' },
	{ name: 'a bare check', schema: (l) => l.check(() => true), input: () => undefined },
	{ name: 'a bare transform', schema: (l) => l.transform(() => 'T'), input: () => undefined },
	{ name: 'lazy', schema: (l) => l.lazy(() => l.string), input: () => 1 }
];

//
// Running
//

/** What one library did with one case in one flavor. */
export interface ConformanceResult {
	/** `render_parsed` of the result, or `throws` and the error's first line. */
	text: string;
	ok: boolean;
	/** The output, when `ok`. */
	value: unknown;
	/** The input this run was given, which no other run was. */
	input: unknown;
	/** Whether the output is the input object itself. */
	is_input: boolean;
}

export interface ConformanceRow {
	/** The case's name, with the flavor after a slash when the case has flavors. */
	name: string;
	case: ConformanceCase;
	flavor: ConformanceFlavor | null;
	results: Record<ConformanceLibName, ConformanceResult>;
	/** `render_value` of the case's input. */
	input_text: string;
	/** `render_parsed` of what each library named in the case's `also` did. */
	informational: Partial<Record<InformationalLibName, string>>;
}

const is_object = (value: unknown): value is object => typeof value === 'object' && value !== null;

const run_one = (
	lib: Partial<ConformanceLib>,
	c: ConformanceCase,
	flavor: ConformanceFlavor | null
): ConformanceResult => {
	const input = c.input();
	try {
		const l = lib as ConformanceLib;
		const parsed = l.parse(flavor ? l[flavor](c.entries!(l)) : c.schema!(l), input);
		return {
			text: render_parsed(parsed),
			ok: parsed.ok,
			value: parsed.ok ? parsed.value : undefined,
			input,
			is_input: parsed.ok && parsed.value === input && is_object(input)
		};
	} catch (error) {
		return {
			text: 'throws: ' + (error as Error).message.split('\n')[0],
			ok: false,
			value: undefined,
			input,
			is_input: false
		};
	}
};

/** Runs every case, through every flavor where it has them, in every library. */
export const run_conformance = (
	cases: ReadonlyArray<ConformanceCase> = CONFORMANCE_CASES
): Array<ConformanceRow> => {
	const rows: Array<ConformanceRow> = [];
	for (const c of cases) {
		for (const flavor of c.entries ? CONFORMANCE_FLAVORS : [null]) {
			const informational: ConformanceRow['informational'] = {};
			for (const name of c.also ?? []) {
				const lib = INFORMATIONAL_LIBS[name];
				if (!flavor || lib[flavor]) informational[name] = run_one(lib, c, flavor).text;
			}
			rows.push({
				name: flavor ? `${c.name} / ${flavor}` : c.name,
				case: c,
				flavor,
				results: {
					zod: run_one(CONFORMANCE_LIBS.zod, c, flavor),
					valibot: run_one(CONFORMANCE_LIBS.valibot, c, flavor),
					fuz_schema: run_one(CONFORMANCE_LIBS.fuz_schema, c, flavor)
				},
				input_text: render_value(c.input()),
				informational
			});
		}
	}
	return rows;
};

//
// Comparing
//

// every object reachable from `value` through its own keys
const collect_objects = (value: unknown, found: Set<object> = new Set()): Set<object> => {
	if (is_object(value) && !found.has(value)) {
		found.add(value);
		for (const key of Reflect.ownKeys(value)) collect_objects((value as any)[key], found);
	}
	return found;
};

const same_output = (ours: unknown, theirs: unknown, of_input: Set<object>): boolean => {
	if (!is_object(ours) || !is_object(theirs)) return render_value(ours) === render_value(theirs);
	if (Array.isArray(ours) !== Array.isArray(theirs)) return false;
	const keys = Reflect.ownKeys(theirs);
	if (of_input.has(ours)) {
		// the input's own object: it has every key of theirs as its own, and no
		// enumerable string key past them, its own or one it inherits
		if (!keys.every((key) => Object.hasOwn(ours, key))) return false;
		for (const key in ours) {
			if (!Object.hasOwn(theirs, key)) return false;
		}
	} else {
		// one this library built: everything `render_value` writes
		const our_keys = Reflect.ownKeys(ours);
		if (
			render_shape(ours) !== render_shape(theirs) ||
			keys.length !== our_keys.length ||
			keys.some((key, i) => key !== our_keys[i])
		) {
			return false;
		}
	}
	return keys.every((key) => same_output((ours as any)[key], (theirs as any)[key], of_input));
};

/**
 * Whether this library's result is another's, with the one difference that
 * isn't a row of any table allowed for: this library returns its input, or a
 * part of it, where nothing in it changed, and the others always copy.
 *
 * So an object of the output that is the input's own is held to less than a
 * copy is: it must have every key of the other library's copy as an own key,
 * with the same value, and no enumerable string key past those, whether its
 * own or one it inherits, as either is read through it. What else it has is
 * the input's and not this library's doing: its key order, its prototype and
 * what of it isn't enumerable, its symbol keys, and which of its keys are
 * enumerable. An object this library built is compared in full, as the texts
 * are.
 */
export const is_same_result = (ours: ConformanceResult, theirs: ConformanceResult): boolean =>
	ours.text === theirs.text ||
	(ours.ok && theirs.ok && same_output(ours.value, theirs.value, collect_objects(ours.input)));
