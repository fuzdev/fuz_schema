import { describe, test, assert } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import * as z from 'zod';

import * as s from '#lib/schema.ts';
import { meta, type SchemaMeta } from '#lib/meta.ts';
import { to_json_schema, type JsonSchemaOptions } from '#lib/json_schema.ts';
import {
	CONFORMANCE_FLAVORS,
	CONFORMANCE_LIBS,
	type ConformanceLib
} from './conformance_adapters.ts';
import { CONFORMANCE_CASES } from './conformance_cases.ts';

// The rule: where zod's `toJSONSchema` writes a schema the conformance matrix
// builds, `to_json_schema` writes the same document, deep equal, unless the
// difference is declared in `DIFFERENCES` and in `docs/design.md`. Each case of
// the matrix is written from both libraries, on both sides of a parse and in
// both modes, and so are the cases below, which the matrix has no need of. A
// difference is declared as a rewrite of the documents that removes it, or as
// a refusal of one side, and a declared one that is no longer needed fails.
//
// Where zod's adapter writes a schema that the declaration can't recognize in
// its document, the adapter here marks it with metadata, a key that starts
// with `MARK`, which every comparison deletes after the rewrites.

const MARK = 'x-declared-';
// what zod's adapter makes for a `with_default_fn`, a default no case writes
const MADE = MARK + 'made';

// metadata that marks a node of zod's document
const mark = (name: string): Record<string, true> => ({ [MARK + name]: true });

type Doc = Record<string, any>;
type Side = 'ours' | 'zod';

interface JsonSchemaDifference {
	/** What this library does, in a line. */
	reason: string;
	/** Words of `docs/design.md` that declare it, whatever the line breaks. */
	docs: string;
	/** Rewrites a node of either document, in place, so that the difference is gone. */
	rewrite?: (node: Doc, side: Side, options: Required<JsonSchemaOptions>) => void;
	/** A refusal of one side, where the other writes a document. */
	refusal?: { side: Side; message: RegExp };
}

// the patterns of the formats, each library's
const PATTERNS: Record<string, string> = {
	[(z.toJSONSchema(z.uuid()) as Doc).pattern]: '<uuid>',
	[to_json_schema(s.uuid).pattern!]: '<uuid>',
	[(z.toJSONSchema(z.iso.datetime()) as Doc).pattern]: '<date-time>',
	[to_json_schema(s.iso_datetime).pattern!]: '<date-time>'
};

// the shape of the pattern a `to_integer` writes on the input side: white space
// or none, then a group of a branch of a `+` or a `-`, then zeros
const INTEGER_PATTERN = /^\^(?:\[\\t-\\r [^\]]*\]\*)?\(\?:(?:\\\+\?|-)0\*\(\?:/;

const DIFFERENCES: Record<string, JsonSchemaDifference> = {
	formats: {
		reason: "the patterns of `uuid` and `iso_datetime` are this library's grammars",
		docs: "`uuid` and `iso_datetime` write this library's grammars as their `pattern`",
		rewrite: (node) => {
			if (typeof node.pattern === 'string') node.pattern = PATTERNS[node.pattern] ?? node.pattern;
		}
	},
	with_default_fn: {
		reason: 'a `with_default_fn` writes no `default`, as its `make` is never called',
		docs: 'a `with_default_fn` writes no `default`',
		rewrite: (node, side) => {
			// zod's adapter makes a sentinel no outer layer can write, so only its own goes
			if (side === 'zod' && node.default === MADE) delete node.default;
		}
	},
	integer: {
		reason: "`integer` writes `type: 'integer'`, where zod's adapter is a refined number",
		docs: "`integer` writes `type: 'integer'`",
		rewrite: (node, side) => {
			if (side === 'zod' && node[MARK + 'integer']) node.type = 'integer';
		}
	},
	optional_then_transform: {
		reason:
			'a `pipe` that is the entry and starts with an `optional` leaves its key out of `required` on the output side, where zod requires what the transform gives',
		docs: 'a `pipe` that is the entry and starts with an `optional` leaves its key optional on the output side',
		rewrite: (node, side, options) => {
			if (side !== 'zod' || options.io !== 'output' || !node.properties) return;
			const marked = Object.keys(node.properties).filter(
				// a `lazy` holds it as a step, which zod writes in the same node
				(key) =>
					node.properties[key][MARK + 'optional_then_transform'] &&
					!node.properties[key][MARK + 'lazy']
			);
			if (!marked.length || !node.required) return;
			node.required = node.required.filter((key: string) => !marked.includes(key));
			if (!node.required.length) delete node.required;
		}
	},
	union_fills_key: {
		reason:
			'a `union` entry that holds a default or a transform has its key required on the output side by what its run does with a missing key, which tries the options before one that fills the key in again, where zod requires it by its options',
		docs: 'a `union` entry that holds a default or a transform has its key required on the output side where its run gives a value for a missing key',
		// zod's document only, its key required as this library's parse of `{}`
		// gives it, which `compare` writes into the mark
		rewrite: (node, side, options) => {
			if (side !== 'zod' || options.io !== 'output' || !node.properties) return;
			const keys = Object.keys(node.properties);
			const as = (key: string): unknown => node.properties[key][MARK + 'union_fills_key'];
			const required = keys.filter((key) =>
				as(key) === 'required'
					? true
					: as(key) === 'optional'
						? false
						: node.required?.includes(key)
			);
			if (required.length) node.required = required;
			else delete node.required;
		}
	},
	check_key: {
		reason:
			"a `check` leaves its key optional with `'any'`, as it can take a missing key, where zod requires it",
		docs: "a `check` leaves its key optional with `'any'`",
		rewrite: (node, side, options) => {
			if (side !== 'zod' || options.unrepresentable !== 'any' || !node.properties) return;
			if (!node.required) return;
			node.required = node.required.filter(
				(key: string) => !holds_mark(node.properties[key], 'check_key')
			);
			if (!node.required.length) delete node.required;
		}
	},
	variant_any_of: {
		reason:
			"a `variant` whose discriminator is written as other than a `const`, as with `'any'`, is `anyOf`, where zod writes `oneOf`",
		docs: 'a `variant` whose discriminator is written as other than a `const` is `anyOf`',
		rewrite: (node, side) => {
			const key = node[MARK + 'variant_key'];
			if (side !== 'zod' || typeof key !== 'string' || !Array.isArray(node.oneOf)) return;
			if (node.oneOf.every((o: Doc) => o.properties && 'const' in o.properties[key])) return;
			node.anyOf = node.oneOf;
			delete node.oneOf;
		}
	},
	non_finite_literal: {
		reason:
			'a `literal` or a `one_of` value past the finite numbers is refused, or dropped, where zod writes `null`',
		docs: 'a `literal` or a `one_of` value past the finite numbers is refused',
		rewrite: (node, side) => {
			if (side !== 'zod' || node.type !== 'number') return;
			if (node.const === null) {
				delete node.type;
				delete node.const;
			} else if (Array.isArray(node.enum) && node.enum.includes(null)) {
				const values = node.enum.filter((v: unknown) => v !== null);
				delete node.enum;
				if (values.length === 1) node.const = values[0];
				else node.enum = values;
			}
		}
	},
	non_finite_literal_refused: {
		reason: 'a `literal` or a `one_of` value past the finite numbers is refused',
		docs: 'a `literal` or a `one_of` value past the finite numbers is refused',
		refusal: {
			side: 'ours',
			message: /^cannot express `(literal|one_of)` .*: a literal of -?(NaN|Infinity)/
		}
	},
	non_finite_bound: {
		reason:
			'a bound that is not finite is refused, or dropped, where zod writes it, which JSON text writes as `null`',
		docs: 'a bound that is not finite is refused',
		rewrite: (node, side) => {
			// a document is compared as JSON text reads it back, where the bound is `null`
			if (side !== 'zod') return;
			for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
				if (node[key] === null) delete node[key];
			}
		}
	},
	non_finite_bound_refused: {
		reason: 'a bound that is not finite is refused',
		docs: 'a bound that is not finite is refused',
		refusal: { side: 'ours', message: /: the bound is not a finite number$/ }
	},
	check: {
		reason: 'a `check` is refused, where zod leaves out a refinement',
		docs: 'a `check` is refused',
		refusal: { side: 'ours', message: /^cannot express `check` at .*: it holds a function$/ }
	},
	refused_keys: {
		reason: 'an entry named like a member of `Object.prototype` is refused',
		docs: 'an entry named like a member of `Object.prototype` is refused',
		refusal: { side: 'ours', message: /: the entry is named like a member of Object\.prototype$/ }
	},
	default_undefined: {
		reason: 'a `with_default` of `undefined` writes no `default`, where zod throws',
		docs: 'a `with_default` of `undefined` writes no `default`',
		refusal: { side: 'zod', message: /^"undefined" is not valid JSON$/ }
	},
	regex_flags: {
		reason:
			'a `regex` with flags other than `d` and `u` is refused, or dropped, where zod writes its source',
		docs: 'a `regex` with flags other than `d` and `u` is refused',
		rewrite: (node, side) => {
			if (side === 'zod' && node[MARK + 'regex_flags']) delete node.pattern;
		}
	},
	regex_flags_refused: {
		reason: 'a `regex` with flags other than `d` and `u` is refused',
		docs: 'a `regex` with flags other than `d` and `u` is refused',
		refusal: { side: 'ours', message: /^cannot express `regex` at .*: its flags / }
	},
	regex_u: {
		reason:
			'a `regex` whose source is no pattern under the flag `u`, or means something else there, is refused, or dropped, where zod writes it',
		docs: 'a `regex` whose source is no pattern under the flag `u`, or means something else there, is refused',
		rewrite: (node, side) => {
			if (side === 'zod' && node[MARK + 'regex_u']) delete node.pattern;
		}
	},
	regex_u_refused: {
		reason:
			'a `regex` whose source is no pattern under the flag `u`, or means something else there, is refused',
		docs: 'a `regex` whose source is no pattern under the flag `u`, or means something else there, is refused',
		refusal: {
			side: 'ours',
			message:
				/^cannot express `regex` at .*: its source (is not a pattern|means something else) under the flag u$/
		}
	},
	bigint_literal: {
		reason:
			'a `literal` or a `one_of` value that is a `bigint` is dropped with `any`, where zod writes it as a number',
		docs: "a `bigint` value is dropped with `'any'`, where zod writes it as a number",
		rewrite: (node, side) => {
			const at: Array<number> | undefined = node[MARK + 'bigint_literal'];
			if (side !== 'zod' || !at) return;
			const values = ('const' in node ? [node.const] : node.enum).filter(
				(_: unknown, i: number) => !at.includes(i)
			);
			delete node.type;
			delete node.const;
			delete node.enum;
			const types = new Set(values.map((v: unknown) => (v === null ? 'null' : typeof v)));
			if (types.size === 1) node.type = [...types][0];
			if (values.length === 1) node.const = values[0];
			else if (values.length) node.enum = values;
		}
	},
	meta_keyword: {
		reason:
			'a metadata key that is a keyword of JSON Schema, but an annotation, is refused, where zod writes it over the keyword',
		docs: 'a metadata key that is a keyword of JSON Schema, but an annotation, is refused',
		refusal: { side: 'ours', message: /: the metadata key ".*" is a keyword of JSON Schema$/ }
	},
	meta_id: {
		reason:
			'an `id` of metadata is copied as any other key, where zod moves the node into `$defs` under it and refers to it',
		docs: 'an `id` of metadata is copied as any other key',
		rewrite: (node, side) => {
			// zod's document, inlined: each definition it names by an `id` in place of its `$ref`
			const defs: Doc | undefined = node.$defs;
			if (side !== 'zod' || node.$schema === undefined || !defs) return;
			const named: Doc = {};
			for (const name of Object.keys(defs)) {
				if (/^__schema\d+$/.test(name)) continue;
				named[name] = defs[name];
				delete defs[name];
			}
			if (!Object.keys(named).length) return;
			if (!Object.keys(defs).length) delete node.$defs;
			const inline = (n: unknown): void => {
				if (n === null || typeof n !== 'object') return;
				for (const value of Object.values(n)) inline(value);
				const at = (n as Doc).$ref;
				if (typeof at !== 'string' || !at.startsWith('#/$defs/')) return;
				// a name with a `/` or a `~` is escaped in the pointer, and not looked up
				// here, so its `$ref` stays and the comparison fails loudly
				const name = at.slice('#/$defs/'.length);
				if (!Object.hasOwn(named, name)) return;
				// the referring node's own keys are an outer layer's, and win
				delete (n as Doc).$ref;
				const own: Doc = { ...n };
				Object.assign(n, structuredClone(named[name]), own, { id: name });
			};
			inline(node);
		}
	},
	lower_case_step: {
		reason:
			"a step but a `uuid` after a `to_lower_case` is dropped on the input side with `'any'`, and one before it on the output side, where zod writes its keyword",
		docs: 'a step but a `uuid` after a `to_lower_case` is refused on the input side, and one before it on the output side',
		// zod's document, without the keywords its adapter marked on that side
		rewrite: (node, side, options) => {
			const marked: Array<[string, unknown]> | undefined = node[MARK + 'lower_' + options.io];
			if (side !== 'zod' || options.unrepresentable !== 'any' || !marked) return;
			for (const [keyword, value] of marked) {
				if (keyword !== 'pattern') {
					if (node[keyword] === value) delete node[keyword];
				} else if (node.pattern === value) {
					delete node.pattern;
				} else if (Array.isArray(node.allOf)) {
					node.allOf = node.allOf.filter((p: Doc) => p.pattern !== value);
					if (node.allOf.length === 1) node.pattern = node.allOf[0].pattern;
					if (node.allOf.length < 2) delete node.allOf;
				}
			}
		}
	},
	lower_case_step_refused: {
		reason:
			'a step but a `uuid` after a `to_lower_case` is refused on the input side, and one before it on the output side',
		docs: 'a step but a `uuid` after a `to_lower_case` is refused on the input side, and one before it on the output side',
		refusal: {
			side: 'ours',
			message: /: it reads (the lowercase of the input|what the output is the lowercase of)$/
		}
	},
	step_after_transform: {
		reason:
			'a step after a `transform` is refused on the input side, or dropped, where zod drops it',
		docs: 'a step after a `transform` is refused on the input side',
		refusal: {
			side: 'ours',
			message: /: it reads the output of a transform, which is not known$/
		}
	},
	to_integer_pattern: {
		reason:
			"a `to_integer` writes on the input side the pattern of exactly the strings it reads within the bounds after it, where zod writes the string's node and leaves the bounds out",
		docs: 'a `to_integer` writes on the input side the pattern of exactly the strings it reads',
		// this library's document, without the pattern of the integer, or the `not` of an empty range
		rewrite: (node, side, options) => {
			if (side !== 'ours' || options.io !== 'input' || node.type !== 'string') return;
			if (typeof node.pattern === 'string' && INTEGER_PATTERN.test(node.pattern)) {
				delete node.pattern;
			} else if (Array.isArray(node.allOf)) {
				node.allOf = node.allOf.filter((p: Doc) => !INTEGER_PATTERN.test(p.pattern));
				if (node.allOf.length === 1) node.pattern = node.allOf[0].pattern;
				if (node.allOf.length < 2) delete node.allOf;
			}
			// the `not` of an empty range, on a node of nothing else
			const keys = Object.keys(node).filter((key) => key !== '$schema');
			if (keys.length === 2 && keys.includes('type') && node.not && !Object.keys(node.not).length) {
				delete node.not;
			}
		}
	},
	to_integer_default: {
		reason:
			"a default of a `to_integer` is left out on the input side, as it is of the integer and not of the string read, where zod writes it on the string's node",
		docs: 'a default of a `to_integer` is left out on the input side',
		rewrite: (node, side, options) => {
			if (side === 'zod' && options.io === 'input' && node[MARK + 'integer_default']) {
				delete node.default;
			}
		}
	},
	to_integer_string_step: {
		reason:
			'a step that asserts something of the string before a `to_integer` is refused on the output side, where zod writes the integer alone',
		docs: 'a step that asserts something of the string before a `to_integer` is refused on the output side',
		refusal: { side: 'ours', message: /: it reads the string the integer was read from$/ }
	},
	finite_record: {
		reason:
			"a `keyed_record` of a finite key set writes no `required`, as it needs none of its keys, where zod's `record` of an enum requires every key",
		docs: 'a `keyed_record` of a finite key set writes no `required`',
		rewrite: (node, side) => {
			if (side === 'zod' && node[MARK + 'finite_record']) delete node.required;
		}
	}
};

// whether `node` has the mark `name`, or an option of it, through `anyOf` and `oneOf`
const holds_mark = (node: Doc | undefined, name: string): boolean =>
	!!node &&
	(node[MARK + name] !== undefined ||
		[node.anyOf, node.oneOf].some(
			(options) => Array.isArray(options) && options.some((o: Doc) => holds_mark(o, name))
		));

// whether a union's options hold a default or a transform, through the unions
// among them: the unions whose key the two libraries require by different
// rules, marked in zod's schemas
const zod_union_fills = (options: ReadonlyArray<any>): boolean =>
	options.some(
		(o) =>
			o instanceof z.ZodDefault ||
			o instanceof z.ZodPipe ||
			(o instanceof z.ZodUnion && zod_union_fills(o.options))
	);

const starts_optional = (schema: any): boolean =>
	schema instanceof z.ZodOptional || (schema instanceof z.ZodPipe && starts_optional(schema.in));

// what the cases below write metadata with, beside the matrix's adapters
// and a `keyed_record` of a finite key set to write against zod's `record` of one,
// which needs every key, where the matrix's adapter is zod's `partialRecord`
type JsonSchemaLib = ConformanceLib & {
	meta: (schema: any, data: Record<string, unknown>) => any;
	finite_record: (key: any, value: any) => any;
};

// the indices of the bigints of `values`, which zod writes as numbers
const bigints = (values: ReadonlyArray<unknown>): Array<number> =>
	values.flatMap((v, i) => (typeof v === 'bigint' ? [i] : []));

// the keywords of string steps each zod schema has written, and those written
// after its first `toLowerCase`, which this library leaves out of a document
// with `'any'`: those before its last on the output side, and those after its
// first on the input side
interface Lowered {
	lowered: boolean;
	all: Array<[string, unknown]>;
	after: Array<[string, unknown]>;
}
const LOWERED: WeakMap<object, Lowered> = new WeakMap();
const lowered_of = (schema: any): Lowered =>
	LOWERED.get(schema) ?? { lowered: false, all: [], after: [] };
const lower_case = (schema: any): any => {
	const before = lowered_of(schema);
	const out = schema.check(z.toLowerCase()).meta({ [MARK + 'lower_output']: [...before.all] });
	LOWERED.set(out, { lowered: true, all: [...before.all], after: [...before.after] });
	return out;
};
// `out`, `schema` with a step that writes `keyword` as `value`
const lower_step = (schema: any, out: any, keyword: string, value: unknown): any => {
	const before = lowered_of(schema);
	const state: Lowered = {
		lowered: before.lowered,
		all: [...before.all, [keyword, value]],
		after: before.lowered ? [...before.after, [keyword, value]] : before.after
	};
	const marked = state.lowered ? out.meta({ [MARK + 'lower_input']: state.after }) : out;
	LOWERED.set(marked, state);
	return marked;
};
const zod_regex = (schema: any, pattern: RegExp): any => {
	const checked = schema.check(z.regex(pattern));
	if (/[^du]/.test(pattern.flags)) return checked.meta(mark('regex_flags'));
	if (pattern.unicode) return checked;
	try {
		RegExp(pattern.source, 'u');
	} catch {
		return checked.meta(mark('regex_u'));
	}
	// a `\u{`, `\p{`, `\P{`, or a surrogate's `\u` after an odd run of backslashes,
	// a surrogate, or an `(?i:` group outside a class, which the cases have none of
	return /(?:^|[^\\])(?:\\\\)*\\(?:[uPp]\{|u[dD][89a-fA-F])/.test(pattern.source) ||
		/[\uD800-\uDFFF]/.test(pattern.source) ||
		/(?:^|[^\\])(?:\\\\)*\(\?[ms]*i/.test(pattern.source)
		? checked.meta(mark('regex_u'))
		: checked;
};

// the pipes of zod's adapter of `to_integer`, whose bounds go in the pipe's
// `out`, where zod writes them: the matrix's adapter checks the pipe, which zod
// leaves out of a document
const INTEGER_PIPES: WeakSet<object> = new WeakSet();
const integer_pipe = (pipe: any): any => {
	INTEGER_PIPES.add(pipe);
	return pipe;
};
const zod_bound = (schema: any, check: any): any =>
	INTEGER_PIPES.has(schema)
		? integer_pipe(schema.in.pipe(schema.out.check(check)))
		: schema.check(check);

// zod's adapter, marking what a declared difference needs to find in its document
const ZOD: JsonSchemaLib = {
	...CONFORMANCE_LIBS.zod,
	to_integer: (schema, options) => integer_pipe(CONFORMANCE_LIBS.zod.to_integer(schema, options)),
	// marked where it holds an integer pipe, whose default zod writes on the input side too
	with_default: (schema, value) =>
		INTEGER_PIPES.has(schema)
			? schema.default(value).meta(mark('integer_default'))
			: schema.default(value),
	min_value: (schema, min) => zod_bound(schema, z.gte(min)),
	max_value: (schema, max) => zod_bound(schema, z.lte(max)),
	meta: (schema, data) => schema.meta(data),
	literal: (value) => {
		const schema = z.literal(value);
		return typeof value === 'bigint' ? schema.meta({ [MARK + 'bigint_literal']: [0] }) : schema;
	},
	one_of: (values) => {
		const schema = z.literal(values);
		const at = bigints(values);
		return at.length ? schema.meta({ [MARK + 'bigint_literal']: at }) : schema;
	},
	integer: z.number().refine(Number.isInteger).meta(mark('integer')),
	check: (fn) => z.custom(fn).meta(mark('check_key')),
	variant: (key, options) =>
		z.discriminatedUnion(key, options as any).meta({ [MARK + 'variant_key']: key }),
	union: (options) => {
		const union = z.union(options as any);
		return zod_union_fills(options) ? union.meta(mark('union_fills_key')) : union;
	},
	memo_union: (options) => {
		const union = z.union(options as any);
		return zod_union_fills(options) ? union.meta(mark('union_fills_key')) : union;
	},
	// zod writes what `make` gives as the `default`, here a sentinel the rewrite removes
	with_default_fn: (schema) => schema.default(() => MADE),
	map: (schema, fn) => {
		const piped = schema.transform(fn);
		return starts_optional(schema) ? piped.meta(mark('optional_then_transform')) : piped;
	},
	// marked, as zod writes it in the node of what it holds
	lazy: (get) => z.lazy(get).meta(mark('lazy')),
	regex: (schema, pattern) =>
		lower_step(schema, zod_regex(schema, pattern), 'pattern', pattern.source),
	to_lower_case: lower_case,
	min_length: (schema, min) =>
		lower_step(schema, CONFORMANCE_LIBS.zod.min_length(schema, min), 'minLength', min),
	max_length: (schema, max) =>
		lower_step(schema, CONFORMANCE_LIBS.zod.max_length(schema, max), 'maxLength', max),
	finite_record: (key, value) => z.record(key, value).meta(mark('finite_record'))
};

const OURS: JsonSchemaLib = {
	...CONFORMANCE_LIBS.fuz_schema,
	meta: (schema, data) => meta(schema, data as SchemaMeta),
	finite_record: (key, value) => s.keyed_record(key, value)
};

interface JsonSchemaCase {
	name: string;
	schema: (l: JsonSchemaLib) => any;
}

// a regex without `u` of a source TypeScript refuses in a literal without it
const no_u = (source: string): RegExp => RegExp(source);

// what the matrix has no need of, written through the same adapters
const CASES: Array<JsonSchemaCase> = [
	{ name: 'string, lengths', schema: (l) => l.max_length(l.min_length(l.string, 2), 5) },
	{
		name: 'string, the tightest lengths',
		schema: (l) => l.max_length(l.max_length(l.min_length(l.min_length(l.string, 4), 2), 9), 5)
	},
	{ name: 'array, lengths', schema: (l) => l.max_length(l.min_length(l.array(l.number), 1), 3) },
	{ name: 'number, bounds', schema: (l) => l.max_value(l.min_value(l.number, -1.5), 7) },
	{
		name: 'number, bounds that are not finite',
		schema: (l) => l.max_value(l.min_value(l.number, -Infinity), Infinity)
	},
	{
		name: 'number, a bound that is not finite and one that is',
		schema: (l) => l.max_value(l.min_value(l.number, NaN), 7)
	},
	{ name: 'safe_integer, a bound', schema: (l) => l.min_value(l.safe_integer, 3) },
	{ name: 'safe_integer, a bound past it', schema: (l) => l.min_value(l.safe_integer, -1e20) },
	{ name: 'regex', schema: (l) => l.regex(l.string, /^a+$/u) },
	{ name: 'regex twice', schema: (l) => l.regex(l.regex(l.string, /a/), /b/) },
	{ name: 'regex with a flag', schema: (l) => l.regex(l.string, /a/i) },
	// eslint-disable-next-line no-useless-escape
	{ name: 'regex, no pattern under u', schema: (l) => l.regex(l.string, /^\-$/) },
	{
		name: 'regex, a code point escape',
		schema: (l) => l.regex(l.string, no_u(String.raw`^\u{2}$`))
	},
	{ name: 'regex, a property', schema: (l) => l.regex(l.string, no_u(String.raw`^[\p{L}]$`)) },
	{
		name: 'regex, a negated property',
		schema: (l) => l.regex(l.string, no_u(String.raw`^\P{L}$`))
	},
	{ name: 'regex, an astral character', schema: (l) => l.regex(l.string, /^a\u{1F600}?$/u) },
	{
		name: 'regex, an astral character without u',
		schema: (l) => l.regex(l.string, no_u('^a\u{1F600}?$'))
	},
	{
		name: 'regex, a surrogate escape',
		schema: (l) => l.regex(l.string, no_u(String.raw`^[a-\uD83D\uDE00]$`))
	},
	{ name: 'regex, a low surrogate', schema: (l) => l.regex(l.string, no_u(String.raw`^\uDE00$`)) },
	{ name: 'regex, a case-folding group', schema: (l) => l.regex(l.string, /^(?i:k)$/) },
	{ name: 'regex, a property under u', schema: (l) => l.regex(l.string, /^\p{L}$/u) },
	{ name: 'regex, an escaped backslash', schema: (l) => l.regex(l.string, /^\\p{1}$/) },
	{
		name: 'regex, the same object twice',
		schema: (l) => {
			const re = /a/;
			return l.regex(l.regex(l.string, re), re);
		}
	},
	{ name: 'regex, the same source twice', schema: (l) => l.regex(l.regex(l.string, /a/), /a/) },
	{ name: 'uuid then a regex', schema: (l) => l.regex(l.uuid, /0/) },
	{ name: 'nullable(nullable(string))', schema: (l) => l.nullable(l.nullable(l.string)) },
	{
		name: 'nullable(nullable(object))',
		schema: (l) => l.nullable(l.nullable(l.strict({ a: l.string })))
	},
	{ name: 'union of the same type', schema: (l) => l.union([l.string, l.string]) },
	{ name: 'union of a union', schema: (l) => l.union([l.union([l.string, l.number]), l.boolean]) },
	{ name: 'one_of, one value', schema: (l) => l.one_of(['a']) },
	{ name: 'one_of, none', schema: (l) => l.one_of([]) },
	{ name: 'one_of, mixed', schema: (l) => l.one_of(['a', 1, null]) },
	{ name: 'one_of, booleans', schema: (l) => l.one_of([true, false]) },
	{ name: 'literal, -0', schema: (l) => l.literal(-0) },
	{ name: 'literal, null', schema: (l) => l.literal(null) },
	{ name: 'literal, a bigint', schema: (l) => l.literal(1n) },
	{ name: 'one_of, a bigint', schema: (l) => l.one_of(['a', 1n]) },
	{ name: 'one_of, bigints', schema: (l) => l.one_of([1n, 'a', 2n, 'b']) },
	{ name: 'meta, an annotation', schema: (l) => l.meta(l.string, { title: 't', other: 1 }) },
	{
		name: 'meta, a keyword over a pipe',
		schema: (l) => l.min_length(l.meta(l.string, { minLength: 5 }), 3)
	},
	{ name: 'meta, a keyword written nowhere', schema: (l) => l.meta(l.string, { $schema: 'x' }) },
	{
		name: 'meta, a default over a default',
		schema: (l) => l.meta(l.with_default(l.string, 'b'), { default: 'a' })
	},
	{
		name: 'meta, a default under a default',
		schema: (l) => l.with_default(l.meta(l.string, { default: 'a' }), 'b')
	},
	{
		name: 'a step after a transform',
		schema: (l) =>
			l.min_value(
				l.map(l.string, (x) => x.length),
				2
			)
	},
	{
		name: 'with_default_fn over a default',
		schema: (l) => l.with_default_fn(l.with_default(l.string, 'a'), () => 'b')
	},
	{
		name: 'with_default_fn over a default of metadata',
		schema: (l) => l.with_default_fn(l.meta(l.string, { default: 'a' }), () => 'b')
	},
	{
		name: 'a default over with_default_fn',
		schema: (l) =>
			l.with_default(
				l.with_default_fn(l.string, () => 'b'),
				'c'
			)
	},
	{
		name: 'a default over with_default_fn, equal to what it makes',
		schema: (l) =>
			l.with_default(
				l.with_default_fn(l.string, () => 'b'),
				'b'
			)
	},
	{
		name: 'a default of metadata over with_default_fn',
		schema: (l) =>
			l.meta(
				l.with_default_fn(l.string, () => 'b'),
				{ default: 'c' }
			)
	},
	{ name: 'meta, an id', schema: (l) => l.meta(l.string, { id: 'x', title: 't' }) },
	{
		name: 'meta, a description over an id',
		schema: (l) =>
			l.meta(l.meta(l.string, { id: 'x', description: 'inner' }), { description: 'outer' })
	},
	{
		name: 'meta, an id inside',
		schema: (l) => l.strict({ a: l.meta(l.string, { id: 'x' }), b: l.number })
	},
	{
		name: 'to_integer, bounds',
		schema: (l) => l.max_value(l.min_value(l.to_integer(l.string), 1), 1000)
	},
	{
		name: 'to_integer unsigned with trim, bounds',
		schema: (l) =>
			l.max_value(l.min_value(l.to_integer(l.string, { unsigned: true, trim: true }), 1), 65535)
	},
	{
		name: 'to_integer, an empty range',
		schema: (l) => l.max_value(l.min_value(l.to_integer(l.string), 5), 3)
	},
	{ name: 'to_integer, a length before', schema: (l) => l.to_integer(l.max_length(l.string, 4)) },
	{
		name: 'to_integer, metadata of the string',
		schema: (l) => l.max_value(l.to_integer(l.meta(l.string, { description: 'd' })), 9)
	},
	{
		name: 'to_integer entries with defaults',
		schema: (l) =>
			l.strict({
				offset: l.with_default(l.min_value(l.to_integer(l.string), 0), 0),
				limit: l.meta(l.with_default(l.max_value(l.to_integer(l.string), 1000), 100), {
					description: 'd'
				})
			})
	},
	{ name: 'record of optional', schema: (l) => l.record(l.optional(l.string)) },
	{
		name: 'keyed_record of one_of keys, against a record of an enum',
		schema: (l) => l.finite_record(l.one_of(['a', 'b']), l.number)
	},
	{
		name: 'keyed_record of a literal key, against a record of it, of optionals',
		schema: (l) => l.finite_record(l.literal('x'), l.optional(l.string))
	},
	{
		name: 'keyed_record of described keys and defaults',
		schema: (l) =>
			l.keyed_record(
				l.meta(l.min_length(l.string, 1), { description: 'k' }),
				l.with_default(l.number, 0)
			)
	},
	{
		name: 'keyed_record of transformed keys',
		schema: (l) =>
			l.keyed_record(
				l.map(l.string, (k) => k.trim()),
				l.number
			)
	},
	{
		name: 'keyed_record of keyed_records, nested in an object',
		schema: (l) =>
			l.strict({
				m: l.keyed_record(
					l.regex(l.string, /^[a-z]+$/),
					l.keyed_record(l.one_of(['x', 'y']), l.array(l.string))
				)
			})
	},
	{ name: 'array of optional', schema: (l) => l.array(l.optional(l.number)) },
	{
		name: 'default of an object',
		schema: (l) => l.with_default(l.strict({ b: l.string }), { b: 'x' })
	},
	{ name: 'default, -0', schema: (l) => l.with_default(l.number, -0) },
	{
		name: 'default of a transform',
		schema: (l) =>
			l.strict({
				a: l.with_default(
					l.map(l.string, (x) => x),
					'x'
				)
			})
	},
	{
		name: 'default of an object with a transform',
		schema: (l) =>
			l.strict({ a: l.with_default(l.strict({ b: l.map(l.string, (x) => x) }), { b: 'q' }) })
	},
	{
		name: 'optional(default)',
		schema: (l) => l.strict({ a: l.optional(l.with_default(l.string, 'x')) })
	},
	{
		name: 'nullable(default)',
		schema: (l) => l.strict({ a: l.nullable(l.with_default(l.string, 'x')) })
	},
	{ name: 'lazy(optional)', schema: (l) => l.strict({ a: l.lazy(() => l.optional(l.string)) }) },
	{
		name: 'lazy, not recursive, twice',
		schema: (l) => {
			const inner = l.lazy(() => l.strict({ a: l.string }));
			return l.strict({ x: inner, y: inner });
		}
	},
	{
		name: 'lazy, recursive at the root',
		schema: (l) => {
			const node: any = l.lazy(() => l.strict({ a: l.array(node) }));
			return node;
		}
	},
	{
		name: 'lazy, recursive inside',
		schema: (l) => {
			const tree: any = l.lazy(() => l.union([l.string, l.array(tree)]));
			return l.strict({ t: tree });
		}
	},
	{
		name: 'lazy, two recursive',
		schema: (l) => {
			const a: any = l.lazy(() => l.union([l.number, l.array(a)]));
			const b: any = l.lazy(() => l.union([l.string, l.array(b)]));
			return l.strict({ b, a, again: a });
		}
	},
	{
		name: 'lazy, recursive through an object',
		schema: (l) => {
			const node: any = l.strict({ kids: l.array(l.lazy(() => node)) });
			return l.strict({ root: node });
		}
	}
];

// what each library writes, or the first line of what it throws
type Written = { ok: true; doc: Doc } | { ok: false; message: string };

const write = (f: () => unknown): Written => {
	try {
		return { ok: true, doc: JSON.parse(JSON.stringify(f())) };
	} catch (error) {
		return { ok: false, message: (error as Error).message.split('\n')[0]! };
	}
};

// folds `anyOf` options that are each a bare `type`, as both libraries do, once a rewrite has made them so
const compact = (node: Doc): void => {
	if (!Array.isArray(node.anyOf) || node.type !== undefined) return;
	const types: Array<unknown> = [];
	for (const option of node.anyOf) {
		const keys = Object.keys(option);
		if (keys.length !== 1 || keys[0] !== 'type') return;
		for (const t of [option.type].flat()) if (!types.includes(t)) types.push(t);
	}
	delete node.anyOf;
	node.type = types.length === 1 ? types[0] : types;
};

// the document with the rewrites of `rows` applied, its marks deleted, and recompacted
const explain = (
	doc: Doc,
	side: Side,
	options: Required<JsonSchemaOptions>,
	rows: ReadonlyArray<JsonSchemaDifference>
): Doc => {
	const copy = structuredClone(doc);
	const visit = (node: unknown): void => {
		if (node === null || typeof node !== 'object') return;
		if (!Array.isArray(node)) for (const row of rows) row.rewrite?.(node, side, options);
		for (const value of Object.values(node)) visit(value);
		if (!Array.isArray(node)) {
			for (const key of Object.keys(node)) if (key.startsWith(MARK)) delete (node as Doc)[key];
			compact(node);
		}
	};
	visit(copy);
	return copy;
};

interface Comparison {
	name: string;
	options: Required<JsonSchemaOptions>;
	zod: Written;
	ours: Written;
}

const OPTIONS: Array<Required<JsonSchemaOptions>> = [
	{ io: 'output', unrepresentable: 'throw' },
	{ io: 'input', unrepresentable: 'throw' },
	{ io: 'output', unrepresentable: 'any' },
	{ io: 'input', unrepresentable: 'any' }
];

// this library's adapter with a `transform` or a `make` that gives `undefined`
// giving a value instead, as the emitter takes either to fill a missing key in
const FILLED_VALUE = 'x-filled';
const filled =
	(fn: (x?: any) => any) =>
	(x?: any): any => {
		const out = fn(x);
		return out === undefined ? FILLED_VALUE : out;
	};
const FILLED: JsonSchemaLib = {
	...OURS,
	with_default_fn: (schema, make) => s.with_default_fn(schema, filled(make)),
	map: (schema, fn) => s.pipe(schema, s.transform(filled(fn))),
	transform: (fn) => s.transform(filled(fn))
};

// the keys of `{}` this library's parse of `schema` gives, or `null` where it fails
const keys_of_empty = (schema: s.AnySchema): Set<string> | null => {
	const result = s.parse(schema, {});
	if (!result.ok) return null;
	const output: unknown = JSON.parse(JSON.stringify(result.value) ?? 'null');
	return typeof output === 'object' && output !== null && !Array.isArray(output)
		? new Set(Object.keys(output))
		: null;
};

const comparisons: Array<Comparison> = [];
const compare = (name: string, build: (l: JsonSchemaLib) => any): void => {
	for (const options of OPTIONS) {
		const zod = write(() => z.toJSONSchema(build(ZOD), options));
		// each top-level key zod's union is marked on, as this library's parse
		// gives it, a `transform` or a `make` taken to give a value as the emitter
		// takes it
		const properties: Doc | undefined = zod.ok ? zod.doc.properties : undefined;
		const marked = properties
			? Object.keys(properties).filter((key) => properties[key][MARK + 'union_fills_key'])
			: [];
		if (marked.length && options.io === 'output') {
			const keys = keys_of_empty(build(FILLED));
			if (keys) {
				for (const key of marked) {
					properties![key][MARK + 'union_fills_key'] = keys.has(key) ? 'required' : 'optional';
				}
			}
		}
		comparisons.push({
			name: `${name} (${options.io}, ${options.unrepresentable})`,
			options,
			zod,
			ours: write(() => to_json_schema(build(OURS), options))
		});
	}
};
for (const c of CONFORMANCE_CASES) {
	if (c.entries) {
		for (const flavor of CONFORMANCE_FLAVORS) {
			compare(`${c.name} / ${flavor}`, (l) => l[flavor](c.entries!(l)));
		}
	} else {
		compare(c.name, c.schema!);
	}
}
for (const c of CASES) compare(c.name, c.schema);

const rows = Object.values(DIFFERENCES);

// whether `rows` explain the comparison, and so which refusal does when one side throws
const explained = (c: Comparison, with_rows: ReadonlyArray<JsonSchemaDifference>): boolean => {
	const { zod, ours } = c;
	if (!zod.ok && !ours.ok) return true;
	if (!zod.ok || !ours.ok) {
		const side: Side = ours.ok ? 'zod' : 'ours';
		const message = ours.ok
			? (zod as { message: string }).message
			: (ours as { message: string }).message;
		return with_rows.some((row) => row.refusal?.side === side && row.refusal.message.test(message));
	}
	return isDeepStrictEqual(
		explain(ours.doc, 'ours', c.options, with_rows),
		explain(zod.doc, 'zod', c.options, with_rows)
	);
};

const describe_comparison = (c: Comparison): string =>
	`\n  zod         ${c.zod.ok ? JSON.stringify(c.zod.doc) : 'throws: ' + c.zod.message}` +
	`\n  fuz_schema  ${c.ours.ok ? JSON.stringify(c.ours.doc) : 'throws: ' + c.ours.message}\n`;

describe('to_json_schema against zod', { timeout: 30_000 }, () => {
	test('writes what zod writes, or the difference is declared', () => {
		const undeclared = comparisons.filter((c) => !explained(c, rows));
		assert.ok(
			!undeclared.length,
			`${undeclared.length} undeclared differences, the first:\n` +
				undeclared
					.slice(0, 5)
					.map((c) => `"${c.name}"${describe_comparison(c)}`)
					.join('') +
				'Conform, or declare the difference in DIFFERENCES and in docs/design.md.'
		);
	});

	test('most comparisons need no declared difference', () => {
		const plain = comparisons.filter((c) => explained(c, [])).length;
		assert.ok(plain > comparisons.length / 2, `${plain} of ${comparisons.length}`);
	});

	test('every declared difference is still needed', () => {
		for (const [name, row] of Object.entries(DIFFERENCES)) {
			const others = rows.filter((r) => r !== row);
			const needed = comparisons.some((c) => explained(c, rows) && !explained(c, others));
			assert.ok(needed, `DIFFERENCES.${name} explains no comparison: ${row.reason}. Remove it.`);
		}
	});

	test('every declared difference is in docs/design.md', () => {
		const docs = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8').replace(
			/\s+/g,
			' '
		);
		for (const row of rows) assert.include(docs, row.docs, row.reason);
	});

	test('metadata is copied as zod copies it', () => {
		const zod = z.toJSONSchema(
			z.strictObject({
				a: z.string().meta({ description: 'inner' }).optional().meta({ description: 'outer' }),
				b: z.string().nullable().meta({ title: 't' })
			})
		);
		const ours = to_json_schema(
			s.object({
				a: meta(s.optional(meta(s.string, { description: 'inner' })), { description: 'outer' }),
				b: meta(s.nullable(s.string), { title: 't' } as SchemaMeta)
			})
		);
		assert.deepEqual(ours, JSON.parse(JSON.stringify(zod)));
	});
});
