/**
 * A JSON Schema validator for exactly the keywords `to_json_schema` writes,
 * by draft 2020-12, for the JSON Schema differential to hold a document's
 * verdict to the library's. It throws on a keyword it doesn't know, so a new
 * keyword of the emitter fails the differential until the checker learns it,
 * and on a document it can't read: a `$ref` other than `#` or into the root's
 * `$defs`, a pattern that is no regex under `u`, a malformed keyword value, or
 * a `$ref` that comes back to itself without reading into the value.
 *
 * `format` is an annotation here, as the emitter writes a `pattern` beside each
 * `uuid` and `date-time` that carries the assertion, so a format is checked
 * only to be one the emitter writes. The other annotations are read past.
 *
 * Its options relax it, each in one way the differential declares a
 * disagreement through: lengths in UTF-16 code units, patterns read without
 * `u`, an own `__proto__` key that an object's schema of other keys skips, and
 * a `default` that fills in as it is.
 *
 * @module
 */

import type { JsonSchema } from '#lib/json_schema.ts';

/** How `check_json_schema` reads a document, by default as draft 2020-12 does. */
export interface JsonSchemaCheckOptions {
	/** Count `minLength` and `maxLength` in UTF-16 code units, as the library does, not code points. */
	code_unit_lengths?: boolean;
	/** Read a `pattern` as a regex without the flag `u`, where it is one. */
	pattern_without_u?: boolean;
	/**
	 * Skip an own `__proto__` key in `additionalProperties` where the node has
	 * `properties` too, as `object_with_rest` drops one unread, and not where it
	 * has `propertyNames`, as a `record` validates one.
	 */
	rest_skips_proto?: boolean;
	/** Take a value equal to a node's `default`, as the library fills it in, whether it matches or not. */
	default_fills?: boolean;
}

/** The draft every document names. */
export const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/** The formats the emitter writes, each beside a `pattern`. */
const FORMATS = new Set(['uuid', 'date-time']);

// the annotations of draft 2020-12, none of which asserts
const ANNOTATIONS = new Set([
	'title',
	'description',
	'default',
	'examples',
	'deprecated',
	'readOnly',
	'writeOnly',
	'$comment',
	'contentMediaType',
	'contentEncoding'
]);

// every keyword the checker applies, and the ones it reads only at the root
const KEYWORDS = new Set([
	'$ref',
	'type',
	'const',
	'enum',
	'not',
	'anyOf',
	'oneOf',
	'allOf',
	'properties',
	'required',
	'additionalProperties',
	'propertyNames',
	'items',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'pattern',
	'format'
]);
const ROOT_KEYWORDS = new Set(['$schema', '$defs']);

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);

/** Whether two JSON values are equal as JSON Schema's `const` and `enum` compare them. */
export const json_equal = (a: unknown, b: unknown): boolean => {
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every(
		(k) =>
			Object.hasOwn(b, k) &&
			json_equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
	);
};

const json_type = (v: unknown): string =>
	v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

const is_plain = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const malformed = (at: string, what: string): never => {
	throw Error(`json_schema_check: ${what} at ${at}`);
};

const count_code_points = (text: string): number => {
	let n = 0;
	for (const _ of text) n++;
	return n;
};

/** The reference token `token` of a JSON Pointer, decoded. */
const decode_token = (token: string): string => token.replaceAll('~1', '/').replaceAll('~0', '~');

// the documents whose every node has been read for keywords
const known: WeakSet<object> = new WeakSet();

/**
 * Throws on a keyword of `doc` the checker doesn't know, anywhere in it, so
 * one on a branch a value never reaches is found too.
 */
const assert_known = (doc: JsonSchema): void => {
	if (known.has(doc)) return;
	const walk = (s: unknown, at: string, root: boolean): void => {
		if (!is_plain(s)) return malformed(at, 'a subschema that is no object');
		for (const key of Object.keys(s)) {
			if (KEYWORDS.has(key) || ANNOTATIONS.has(key)) continue;
			if (root && ROOT_KEYWORDS.has(key)) continue;
			malformed(at, `the keyword ${JSON.stringify(key)}, which the checker doesn't know`);
		}
		for (const key of ['not', 'items', 'propertyNames'] as const) {
			if (s[key] !== undefined) walk(s[key], `${at}/${key}`, false);
		}
		if (s.additionalProperties !== undefined && s.additionalProperties !== false) {
			walk(s.additionalProperties, at + '/additionalProperties', false);
		}
		for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
			const list = s[key];
			if (list === undefined) continue;
			if (!Array.isArray(list)) {
				return malformed(`${at}/${key}`, 'a list of subschemas that is no array');
			}
			list.forEach((o, i) => walk(o, `${at}/${key}/${i}`, false));
		}
		for (const key of ['properties', '$defs'] as const) {
			const map = s[key];
			if (map === undefined) continue;
			if (!is_plain(map)) return malformed(`${at}/${key}`, `a ${key} that is no object`);
			for (const [k, sub] of Object.entries(map)) walk(sub, `${at}/${key}/${k}`, false);
		}
	};
	walk(doc, '#', true);
	known.add(doc);
};

/**
 * Whether the JSON value `value` is valid against `doc`.
 *
 * @param doc - a document `to_json_schema` wrote
 * @param value - a JSON value
 * @param options - the relaxations to read it with
 * @throws Error - on a keyword the checker doesn't know or a document it can't read
 */
export const check_json_schema = (
	doc: JsonSchema,
	value: unknown,
	options: JsonSchemaCheckOptions = {}
): boolean => {
	if (!is_plain(doc)) malformed('#', 'a document that is not an object');
	if (doc.$schema !== JSON_SCHEMA_DRAFT) malformed('#', `a $schema of ${String(doc.$schema)}`);
	const defs = doc.$defs;
	if (defs !== undefined && !is_plain(defs)) malformed('#/$defs', 'a $defs that is no object');
	assert_known(doc);
	const patterns: Map<string, RegExp> = new Map();
	// the (node, value) pairs being checked, so a `$ref` loop that doesn't read
	// into the value throws instead of recursing forever
	const open: Map<object, Set<unknown>> = new Map();

	const resolve = (ref: unknown, at: string): JsonSchema => {
		if (ref === '#') return doc;
		if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) {
			return malformed(at, `a $ref of ${JSON.stringify(ref)}`);
		}
		const token = ref.slice('#/$defs/'.length);
		const name = decode_token(token);
		if (!defs || token.includes('/') || !Object.hasOwn(defs, name)) {
			return malformed(at, `a $ref to no definition, ${ref}`);
		}
		return defs[name]!;
	};

	const regex = (source: unknown, at: string): RegExp => {
		if (typeof source !== 'string') return malformed(at, 'a pattern that is no string');
		const key = (options.pattern_without_u ? '-' : 'u') + source;
		let re = patterns.get(key);
		if (!re) {
			try {
				re = RegExp(source, 'u');
			} catch {
				return malformed(at, `a pattern that is no regex under u, ${JSON.stringify(source)}`);
			}
			if (options.pattern_without_u) {
				try {
					re = RegExp(source);
				} catch {
					// read under `u`, where it is no regex without it
				}
			}
			patterns.set(key, re);
		}
		return re;
	};

	const count = (n: unknown, at: string): number => {
		if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
			return malformed(at, `a count of ${JSON.stringify(n)}`);
		}
		return n;
	};
	const bound = (n: unknown, at: string): number => {
		if (typeof n !== 'number' || !Number.isFinite(n)) {
			return malformed(at, `a bound of ${JSON.stringify(n)}`);
		}
		return n;
	};
	const list = (l: unknown, at: string): Array<JsonSchema> => {
		if (!Array.isArray(l) || !l.length)
			return malformed(at, 'a list of subschemas that is empty or no array');
		return l;
	};

	const check = (s: unknown, v: unknown, at: string): boolean => {
		if (!is_plain(s)) return malformed(at, 'a subschema that is no object');
		const seen = open.get(s);
		if (seen?.has(v)) {
			return malformed(at, 'a $ref that comes back to itself without reading into the value');
		}
		if (seen) seen.add(v);
		else open.set(s, new Set([v]));
		try {
			const ok = check_node(s, v, at);
			if (ok || !options.default_fills || !Object.hasOwn(s, 'default')) return ok;
			// a default fills in as it is
			return json_equal(v, s.default);
		} finally {
			open.get(s)!.delete(v);
		}
	};

	const check_node = (s: JsonSchema, v: unknown, at: string): boolean => {
		const t = json_type(v);
		if (s.$ref !== undefined && !check(resolve(s.$ref, at), v, at + '/$ref')) {
			return false;
		}
		if (s.type !== undefined) {
			const types: Array<unknown> = Array.isArray(s.type) ? s.type : [s.type];
			if (!types.length) malformed(at, 'an empty type');
			let ok = false;
			for (const type of types) {
				if (typeof type !== 'string' || !TYPES.has(type))
					malformed(at, `a type of ${String(type)}`);
				if (type === t || (type === 'integer' && t === 'number' && Number.isInteger(v))) ok = true;
			}
			if (!ok) return false;
		}
		if (Object.hasOwn(s, 'const') && !json_equal(s.const, v)) return false;
		if (s.enum !== undefined) {
			if (!Array.isArray(s.enum)) malformed(at, 'an enum that is no array');
			if (!s.enum.some((e) => json_equal(e, v))) return false;
		}
		if (s.not !== undefined && check(s.not, v, at + '/not')) return false;
		if (s.anyOf !== undefined) {
			const options = list(s.anyOf, at + '/anyOf');
			if (!options.some((o, i) => check(o, v, `${at}/anyOf/${i}`))) return false;
		}
		if (s.oneOf !== undefined) {
			const options = list(s.oneOf, at + '/oneOf');
			if (options.filter((o, i) => check(o, v, `${at}/oneOf/${i}`)).length !== 1) return false;
		}
		if (s.allOf !== undefined) {
			const options = list(s.allOf, at + '/allOf');
			if (!options.every((o, i) => check(o, v, `${at}/allOf/${i}`))) return false;
		}
		if (s.format !== undefined && (typeof s.format !== 'string' || !FORMATS.has(s.format))) {
			malformed(at, `a format of ${JSON.stringify(s.format)}`);
		}
		if (t === 'string') {
			const text = v as string;
			const n = options.code_unit_lengths ? text.length : count_code_points(text);
			if (s.minLength !== undefined && n < count(s.minLength, at + '/minLength')) return false;
			if (s.maxLength !== undefined && n > count(s.maxLength, at + '/maxLength')) return false;
			if (s.pattern !== undefined && !regex(s.pattern, at + '/pattern').test(text)) return false;
		}
		if (t === 'number') {
			const n = v as number;
			if (s.minimum !== undefined && n < bound(s.minimum, at + '/minimum')) return false;
			if (s.maximum !== undefined && n > bound(s.maximum, at + '/maximum')) return false;
			if (
				s.exclusiveMinimum !== undefined &&
				n <= bound(s.exclusiveMinimum, at + '/exclusiveMinimum')
			) {
				return false;
			}
			if (
				s.exclusiveMaximum !== undefined &&
				n >= bound(s.exclusiveMaximum, at + '/exclusiveMaximum')
			) {
				return false;
			}
		}
		if (t === 'array') {
			const items = v as Array<unknown>;
			if (s.minItems !== undefined && items.length < count(s.minItems, at + '/minItems')) {
				return false;
			}
			if (s.maxItems !== undefined && items.length > count(s.maxItems, at + '/maxItems')) {
				return false;
			}
			if (s.items !== undefined && !items.every((item) => check(s.items, item, at + '/items'))) {
				return false;
			}
		}
		if (t === 'object') {
			const o = v as Record<string, unknown>;
			const properties = s.properties;
			if (properties !== undefined && !is_plain(properties)) {
				malformed(at, 'a properties that is no object');
			}
			if (s.required !== undefined) {
				if (!Array.isArray(s.required) || s.required.some((k) => typeof k !== 'string')) {
					malformed(at, 'a required that is no array of strings');
				}
				if (new Set(s.required).size !== s.required.length) malformed(at, 'a required key twice');
				for (const key of s.required) {
					if (!Object.hasOwn(o, key)) return false;
				}
			}
			const additional = s.additionalProperties;
			if (additional !== undefined && additional !== false && !is_plain(additional)) {
				malformed(at, 'an additionalProperties that is neither false nor a subschema');
			}
			const skip_proto =
				options.rest_skips_proto && properties !== undefined && s.propertyNames === undefined;
			for (const key of Object.keys(o)) {
				if (s.propertyNames !== undefined && !check(s.propertyNames, key, at + '/propertyNames')) {
					return false;
				}
				if (properties && Object.hasOwn(properties, key)) {
					if (!check(properties[key], o[key], `${at}/properties/${key}`)) return false;
				} else if (additional === false) {
					return false;
				} else if (additional !== undefined && !(skip_proto && key === '__proto__')) {
					if (!check(additional, o[key], at + '/additionalProperties')) return false;
				}
			}
		}
		return true;
	};

	return check(doc, value, '#');
};
