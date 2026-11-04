/**
 * Writes a schema as JSON Schema, draft 2020-12, in the shapes zod's
 * `toJSONSchema` writes where the two libraries express the same schema.
 *
 * What a schema does that JSON Schema can't say is unrepresentable: a
 * `bigint`, a `check`, a `transform` on the output side, a `literal` of
 * `undefined`, a `bigint`, or a number past the finite ones, an action outside
 * a `pipe` or of another type than its step, a step after a `transform` on
 * the input side, a `regex` with flags beyond `d` and `u` or whose source is
 * no pattern under `u` or means something else there, a bound that isn't
 * finite, and a kind defined outside the library.
 * By default it throws, naming the kind and where in the document, and with
 * `unrepresentable: 'any'` it writes `{}` there, or leaves the keyword out.
 * Some things are refused in both modes, as they are the schema's author's
 * mistakes: an entry named like a member of `Object.prototype`, a schema that
 * comes back to itself without reading into the value, metadata that isn't
 * JSON, and a metadata key that is a keyword of JSON Schema other than an
 * annotation.
 *
 * It is a module of its own, so a bundle that writes no JSON Schema carries
 * none of it. It reads schemas and makes none, and calls nothing but a
 * `lazy`'s function, once each.
 *
 * @module
 */

import { is_schema, type AnySchema, type SchemaNode } from './schema.ts';
import { get_meta } from './meta.ts';
import { SCHEMA_JSON_REFUSED_KEYS } from './schema_json.ts';

/** The values of the keyword `type`. */
export type JsonSchemaType =
	'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';

/**
 * A JSON Schema document or subschema, typed by the keywords `to_json_schema`
 * writes. Metadata adds any other key.
 */
export interface JsonSchema {
	$schema?: string;
	$ref?: string;
	$defs?: Record<string, JsonSchema>;
	type?: JsonSchemaType | Array<JsonSchemaType>;
	const?: unknown;
	enum?: Array<unknown>;
	not?: JsonSchema;
	anyOf?: Array<JsonSchema>;
	oneOf?: Array<JsonSchema>;
	allOf?: Array<JsonSchema>;
	properties?: Record<string, JsonSchema>;
	required?: Array<string>;
	additionalProperties?: JsonSchema | false;
	propertyNames?: JsonSchema;
	items?: JsonSchema;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	minimum?: number;
	maximum?: number;
	format?: string;
	pattern?: string;
	default?: unknown;
	[key: string]: unknown;
}

/** Options of `to_json_schema`. */
export interface JsonSchemaOptions {
	/**
	 * Which side of a parse to describe: `'output'`, what it returns, or
	 * `'input'`, what it accepts. They differ where a default fills a key in,
	 * which is required of the output and optional in the input, where
	 * `strip_object` drops unknown keys, and where a `transform` runs, which
	 * has no output to write and whose input is the steps before it.
	 *
	 * @default 'output'
	 */
	io?: 'input' | 'output';
	/**
	 * What to do with what JSON Schema can't say: `'throw'`, or `'any'`, which
	 * writes `{}` for it, or leaves out the keyword for a step of a `pipe`.
	 *
	 * @default 'throw'
	 */
	unrepresentable?: 'throw' | 'any';
}

// `uuid` and `iso_datetime` as `schema.ts` tests them, which a test holds to
// that module's source
const UUID_PATTERN =
	/^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$/
		.source;
const ISO_DATETIME_PATTERN =
	/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/
		.source;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// read at an index by `lastIndex`: what follows a `\` that means something else
// under `u`, and an `(` that opens a group folding case
const ESCAPE_ELSE = /[upP]\{|u[dD][89a-fA-F]/y;
const GROUP_I = /\(\?[ms]*i/y;

/**
 * Whether a regex source that compiles with and without the flag `u` matches
 * other strings under it, beyond the astral characters each reads otherwise:
 * a `\u{`, `\p{`, or `\P{`, in a class or out of one, is a code point or a
 * property under `u` and letters and a quantifier or braces without it, an
 * `(?i:` group folds case by Unicode's tables under `u` only, where `k` also
 * matches the Kelvin sign, and a surrogate, written or escaped, can be half of
 * an astral character, which under `u` a quantifier or a range takes whole.
 */
const reads_else_under_u = (source: string): boolean => {
	let in_class = false;
	for (let i = 0; i < source.length; i++) {
		const c = source[i]!;
		if (c >= '\uD800' && c <= '\uDFFF') return true;
		if (c === '\\') {
			ESCAPE_ELSE.lastIndex = ++i;
			if (ESCAPE_ELSE.test(source)) return true;
		} else if (in_class) {
			in_class = c !== ']';
		} else if (c === '[') {
			in_class = true;
		} else if (c === '(') {
			GROUP_I.lastIndex = i;
			if (GROUP_I.test(source)) return true;
		}
	}
	return false;
};

/** A key as a reference token of a JSON Pointer. */
const token = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Why `value` is not JSON, when it is not. */
const json_refusal = (value: unknown, open: Set<unknown> = new Set()): string | undefined => {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number')
		return Number.isFinite(value) ? undefined : 'a number past the finite ones';
	if (typeof value !== 'object')
		return value === undefined ? 'an `undefined`' : `a ${typeof value}`;
	if (open.has(value)) return 'a value that holds itself';
	const proto = Object.getPrototypeOf(value);
	const array = Array.isArray(value);
	if (!array && proto !== Object.prototype && proto !== null) return 'an object that is not plain';
	open.add(value);
	const keys = Object.keys(value);
	// a hole reads as `undefined`, and a key that isn't an item is dropped
	if (array && (keys.length !== value.length || keys.some((k, i) => k !== String(i)))) {
		return 'an array with a hole, or a key that is not an item';
	}
	for (const key of keys) {
		const v = (value as Record<string, unknown>)[key];
		const refusal = v === undefined ? 'an `undefined`' : json_refusal(v, open);
		if (refusal) return refusal;
	}
	open.delete(value);
	return undefined;
};

type Node = JsonSchema;

// the keys of `JsonSchema` that aren't its index signature
type WrittenKey = keyof { [K in keyof JsonSchema as string extends K ? never : K]: 0 };

/**
 * The keywords of JSON Schema that metadata can't write, in either mode: each
 * that asserts, applies a subschema, or is the document's structure, in draft
 * 2020-12, and those of an older draft or OpenAPI that some validators still apply
 * in a 2020-12 document, as each changes what the document accepts.
 * Annotations, such as `title`, `description`, `examples`, and `default`, and
 * every other key are copied. Every keyword this module writes is one, but
 * `default`.
 */
const KEYWORDS = {
	$schema: 1,
	$id: 1,
	$ref: 1,
	$defs: 1,
	$anchor: 1,
	$dynamicRef: 1,
	$dynamicAnchor: 1,
	$vocabulary: 1,
	$recursiveRef: 1,
	$recursiveAnchor: 1,
	type: 1,
	enum: 1,
	const: 1,
	not: 1,
	anyOf: 1,
	oneOf: 1,
	allOf: 1,
	if: 1,
	then: 1,
	else: 1,
	properties: 1,
	required: 1,
	additionalProperties: 1,
	propertyNames: 1,
	patternProperties: 1,
	dependentRequired: 1,
	dependentSchemas: 1,
	dependencies: 1,
	unevaluatedProperties: 1,
	minProperties: 1,
	maxProperties: 1,
	items: 1,
	prefixItems: 1,
	additionalItems: 1,
	unevaluatedItems: 1,
	contains: 1,
	minContains: 1,
	maxContains: 1,
	minItems: 1,
	maxItems: 1,
	uniqueItems: 1,
	minLength: 1,
	maxLength: 1,
	pattern: 1,
	format: 1,
	minimum: 1,
	maximum: 1,
	exclusiveMinimum: 1,
	exclusiveMaximum: 1,
	multipleOf: 1,
	// OpenAPI's, which validators such as Ajv apply beside `type`
	nullable: 1
} satisfies Record<Exclude<WrittenKey, 'default'>, 1> & Record<string, 1>;

// sets an own key, a `__proto__` one included, which an assignment would make the prototype
const put = (node: Node, key: string, value: unknown): void => {
	Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * Writes `schema` as a JSON Schema document, with `$schema` naming draft
 * 2020-12.
 *
 * - An object schema is `{type: 'object', properties, required}`: `object`
 *   closes it with `additionalProperties: false`, `strip_object` too on the
 *   output side, `loose_object` writes `{}` there, and `object_with_rest`
 *   its `rest`. An entry is optional where its key may be missing: under an
 *   `optional`, or a default on the input side, through a `nullable`, a
 *   `lazy`, the first schema of a `pipe`, or any option of a `union`.
 * - A `nullable` and a `union` are `anyOf`, folded into a `type` array where
 *   every option is a bare `type`, and a `variant` is `oneOf`.
 * - The actions of a `pipe` are keywords of its first schema's node: lengths,
 *   bounds, `integer`, formats, and patterns, the tightest bound winning.
 * - A `with_default` writes `default`, unless its schema transforms on the
 *   input side. A `with_default_fn` writes none, as its `make` is never called,
 *   and drops one of the schema it holds.
 * - A `lazy` is written in place, unless the schema comes back to itself, when
 *   it is in `$defs` and referred to, or is `#` when it is the root.
 * - The metadata of every layer is copied into the node it is written in,
 *   the outer layer winning, a `with_default`'s `default` included, and
 *   `undefined` clearing a key. A key that is a keyword of JSON Schema, but
 *   an annotation, is refused, as it would change what the document accepts.
 *
 * @param schema - the schema to write
 * @param options - which side of a parse, and what to do with what can't be written
 * @throws Error naming the kind and the place in the document of what can't be written, or is refused
 */
export const to_json_schema = (schema: AnySchema, options?: JsonSchemaOptions): JsonSchema => {
	const input = options?.io === 'input';
	const any = options?.unrepresentable === 'any';
	// what each schema object was written as, the ones being written, the
	// order they were first met in, and the ones that came back to themselves
	const done: Map<SchemaNode, Node> = new Map();
	const open: Set<SchemaNode> = new Set();
	const order: Array<SchemaNode> = [];
	const recursive: Set<SchemaNode> = new Set();
	// the object each `$ref` holds until the end, and the schema it is of
	const markers: Map<SchemaNode, object> = new Map();
	// what each `lazy`'s function returned, which is called once
	const targets: Map<unknown, unknown> = new Map();
	// the schemas being written for the value the innermost open one is for,
	// which reading into the value starts again
	let chain: Set<SchemaNode> = new Set();
	const root = schema as SchemaNode;

	const error = (kind: string, path: string, reason: string): never => {
		throw Error(`cannot express \`${kind}\` at ${path}: ${reason}`);
	};
	// returns only with `unrepresentable: 'any'`
	const unrepresentable = (kind: string, path: string, reason: string): void => {
		if (!any) error(kind, path, reason);
	};

	// a copy of `node`, which may be another's
	const copy = (node: Node): Node => {
		const c: Node = {};
		for (const key of Object.keys(node)) put(c, key, node[key]);
		return c;
	};

	// copies the metadata of `s` into `node`, over what inner layers wrote,
	// and a `default` over the keyword, as zod does
	const with_meta = (inner: Node, s: SchemaNode, path: string): Node => {
		const m = get_meta(s);
		if (!m) return inner;
		const node = copy(inner);
		const drop = input && transforms(s);
		for (const key of Object.keys(m)) {
			const value: unknown = (m as Record<string, unknown>)[key];
			if (Object.hasOwn(KEYWORDS, key)) {
				error(s.kind, path, `the metadata key ${JSON.stringify(key)} is a keyword of JSON Schema`);
			}
			if (value === undefined) {
				Reflect.deleteProperty(node, key);
				continue;
			}
			const refusal = json_refusal(value);
			if (refusal) error(s.kind, path, `the metadata ${JSON.stringify(key)} holds ${refusal}`);
			// as zod does, the input of a transform has no output's examples or default
			if (drop && (key === 'examples' || key === 'default')) continue;
			put(node, key, value);
		}
		return node;
	};

	const target = (s: SchemaNode<'lazy'>): unknown => {
		if (!targets.has(s.def)) targets.set(s.def, s.def());
		return targets.get(s.def);
	};

	// whether a parse of `s` runs a `transform`, as zod reads it
	const transforms = (s: SchemaNode, seen: Set<SchemaNode> = new Set()): boolean => {
		if (!is_schema(s) || seen.has(s)) return false;
		seen.add(s);
		const t = (x: unknown): boolean => transforms(x as SchemaNode, seen);
		switch (s.kind) {
			case 'transform':
				return true;
			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return t(s.def.schema);
			case 'lazy':
				return t(target(s));
			case 'array':
			case 'record':
				return t(s.def);
			case 'pipe':
			case 'union':
				return s.def.some(t);
			case 'variant':
				return s.def.options.some(t);
			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.values(s.def).some(t);
			case 'object_with_rest':
				return Object.values(s.def.entries).some(t) || t(s.def.rest);
			default:
				return false;
		}
	};

	// whether an entry of `s` lets its key be missing on this side. `entry` says
	// `s` is the entry itself, which a `nullable`, a `lazy`, and a `union` don't pass on
	const optional_key = (
		s: SchemaNode,
		entry: boolean,
		seen: Set<SchemaNode> = new Set()
	): boolean => {
		if (!is_schema(s) || seen.has(s)) return false;
		seen.add(s);
		switch (s.kind) {
			case 'optional':
				return true;
			case 'with_default':
				// a default of `undefined` leaves the key out
				return input || s.def.value === undefined;
			case 'with_default_fn':
			case 'transform':
				return input;
			case 'nullable':
				return optional_key(s.def.schema, false, seen);
			case 'lazy':
				return optional_key(target(s) as SchemaNode, false, seen);
			case 'pipe': {
				if (input || !s.def.some((step) => step.kind === 'transform')) {
					return optional_key(s.def[0]!, entry, seen);
				}
				// what a transform gives is written, unless the pipe is the entry and
				// starts with an `optional`, when no step runs for a missing key
				let head = s.def[0]!;
				while (head.kind === 'pipe') head = head.def[0]!;
				return entry && head.kind === 'optional';
			}
			case 'union':
				return s.def.some((o) => optional_key(o, false, seen));
			default:
				return false;
		}
	};

	// folds `anyOf` options that are each a bare `type` into one `type`, as zod does
	// TODO: an error names the path of an option, `anyOf/N`, which the document
	// written with `unrepresentable: 'any'` folds away when the option is left bare
	const compact = (node: Node): Node => {
		const types: Array<unknown> = [];
		for (const option of node.anyOf!) {
			const keys = Object.keys(option);
			if (keys.length !== 1 || keys[0] !== 'type') return node;
			for (const t of ([] as Array<unknown>).concat(option.type)) {
				if (!types.includes(t)) types.push(t);
			}
		}
		return { type: (types.length === 1 ? types[0] : types) as JsonSchemaType };
	};

	const literals = (kind: string, values: ReadonlyArray<unknown>, path: string): Node => {
		if (!values.length) return { not: {} };
		const vals: Array<unknown> = [];
		for (const v of values) {
			if (
				v === null ||
				typeof v === 'string' ||
				typeof v === 'boolean' ||
				(typeof v === 'number' && Number.isFinite(v))
			) {
				vals.push(v);
			} else {
				unrepresentable(
					kind,
					path,
					`a literal of ${typeof v === 'number' ? String(v) : typeof v} is not JSON`
				);
			}
		}
		const types = new Set(vals.map((v) => (v === null ? 'null' : typeof v)));
		const type = (types.size === 1 ? [...types][0] : undefined) as JsonSchemaType | undefined;
		if (vals.length === 1) return { type, const: vals[0] };
		const node: Node = vals.length ? { enum: vals } : {};
		return type ? { type, ...node } : node;
	};

	const object = (
		kind: string,
		entries: Readonly<Record<string, SchemaNode>>,
		path: string,
		rest?: () => Node | false
	): Node => {
		const properties: Record<string, Node> = {};
		const required: Array<string> = [];
		for (const key of Object.keys(entries)) {
			const at = `${path}/properties/${token(key)}`;
			if (SCHEMA_JSON_REFUSED_KEYS.includes(key)) {
				error(kind, at, 'the entry is named like a member of Object.prototype');
			}
			properties[key] = into(entries[key], at);
			if (!optional_key(entries[key]!, true)) required.push(key);
		}
		const node: Node = { type: 'object', properties };
		if (required.length) node.required = required;
		const additional = rest?.();
		if (additional !== undefined) node.additionalProperties = additional;
		return node;
	};

	const pipe = (s: SchemaNode<'pipe'>, path: string): Node => {
		// a pipe that starts with a pipe is one pipe, whose layers' metadata comes after
		let head: unknown = s.def[0];
		let steps: Array<unknown> = s.def.slice(1);
		const layers: Array<SchemaNode> = [];
		while (is_schema(head) && head.kind === 'pipe') {
			layers.unshift(head);
			steps = [...head.def.slice(1), ...steps];
			head = head.def[0];
		}
		const base = emit(head, path);
		const kind = (head as SchemaNode).kind;
		const type =
			kind === 'string' || kind === 'uuid' || kind === 'iso_datetime'
				? 'string'
				: kind === 'number' || kind === 'integer' || kind === 'safe_integer'
					? 'number'
					: kind === 'array'
						? 'array'
						: undefined;
		let node = copy(base);
		const patterns: Array<unknown> =
			node.pattern !== undefined
				? [node.pattern]
				: node.allOf
					? node.allOf.map((p) => p.pattern)
					: [];
		delete node.pattern;
		delete node.allOf;
		const narrow = (key: string, value: number, lower: boolean): void => {
			const current = node[key] as number | undefined;
			if (current === undefined || (lower ? value > current : value < current)) node[key] = value;
		};
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			const at = path;
			if (!is_schema(step)) error('pipe', at, 'a step is not a schema');
			const action = step as SchemaNode;
			// whether the step before it fixes the type the action is for
			const fits = (t: string): boolean => {
				if (type === t) return true;
				unrepresentable(
					action.kind,
					at,
					type ? `the action is not for ${type}s` : 'the schema before it fixes no type'
				);
				return false;
			};
			switch (action.kind) {
				case 'transform':
					// the input is the steps before it, and the output not known, which
					// the steps after it read
					if (input) {
						if (i + 1 < steps.length) {
							const next = steps[i + 1];
							unrepresentable(
								is_schema(next) ? next.kind : 'pipe',
								at,
								'it reads the output of a transform, which is not known'
							);
						}
						steps.length = i;
						break;
					}
					unrepresentable('transform', at, 'its output is not known');
					return {};
				case 'check':
					unrepresentable('check', at, 'it holds a function');
					break;
				case 'min_length':
				case 'max_length': {
					const bound = action.def;
					if (!Number.isInteger(bound) || bound < 0) {
						unrepresentable(action.kind, at, 'the bound is not a whole number');
					} else if (type === 'string' || type === 'array') {
						const lower = action.kind === 'min_length';
						narrow(
							(lower ? 'min' : 'max') + (type === 'string' ? 'Length' : 'Items'),
							bound,
							lower
						);
					} else {
						fits('string');
					}
					break;
				}
				case 'min_value':
				case 'max_value': {
					const bound = action.def;
					if (typeof bound !== 'number' || !Number.isFinite(bound)) {
						unrepresentable(action.kind, at, 'the bound is not a finite number');
					} else if (fits('number')) {
						const lower = action.kind === 'min_value';
						narrow(lower ? 'minimum' : 'maximum', bound, lower);
					}
					break;
				}
				case 'integer':
				case 'safe_integer':
					if (fits('number')) {
						node.type = 'integer';
						if (action.kind === 'safe_integer') {
							narrow('minimum', -MAX_SAFE, true);
							narrow('maximum', MAX_SAFE, false);
						}
					}
					break;
				case 'uuid':
				case 'iso_datetime':
				case 'regex': {
					if (!fits('string')) break;
					if (action.kind === 'regex') {
						const re = action.def;
						if (/[^du]/.test(re.flags)) {
							unrepresentable(
								'regex',
								at,
								`its flags ${JSON.stringify(re.flags)} are not JSON Schema's`
							);
							break;
						}
						if (!re.unicode) {
							// a validator reads a pattern as a `u` regex
							let reason: string | undefined;
							try {
								RegExp(re.source, 'u');
								if (reads_else_under_u(re.source)) reason = 'means something else';
							} catch {
								reason = 'is not a pattern';
							}
							if (reason) {
								unrepresentable('regex', at, `its source ${reason} under the flag u`);
								break;
							}
						}
						// as zod has it, the last format wins and a regex has none, and a
						// regex object is written once
						delete node.format;
						if (!patterns.includes(re)) patterns.push(re);
					} else {
						node.format = action.kind === 'uuid' ? 'uuid' : 'date-time';
						patterns.push(action.kind === 'uuid' ? UUID_PATTERN : ISO_DATETIME_PATTERN);
					}
					break;
				}
				default:
					unrepresentable(action.kind, at, "only actions follow a pipe's first schema");
			}
		}
		const sources = patterns.map((p) => (typeof p === 'string' ? p : (p as RegExp).source));
		if (sources.length === 1) node.pattern = sources[0];
		else if (sources.length) node.allOf = sources.map((pattern) => ({ pattern }));
		for (const step of steps) if (is_schema(step)) node = with_meta(node, step, path);
		for (const layer of layers) node = with_meta(node, layer, path);
		return node;
	};

	const build = (s: SchemaNode, path: string): Node => {
		switch (s.kind) {
			case 'string':
			case 'number':
			case 'boolean':
				return { type: s.kind };
			case 'integer':
				return { type: 'integer' };
			case 'safe_integer':
				return { type: 'integer', minimum: -MAX_SAFE, maximum: MAX_SAFE };
			case 'uuid':
				return { type: 'string', format: 'uuid', pattern: UUID_PATTERN };
			case 'iso_datetime':
				return { type: 'string', format: 'date-time', pattern: ISO_DATETIME_PATTERN };
			case 'unknown':
				return {};
			case 'literal':
				return literals(s.kind, [s.def], path);
			case 'one_of':
				return literals(s.kind, s.def, path);
			case 'optional':
				return emit(s.def.schema, path);
			case 'with_default_fn': {
				// nor a default of what it holds, which its `make` replaces
				const node = copy(emit(s.def.schema, path));
				delete node.default;
				return node;
			}
			case 'nullable':
				return compact({ anyOf: [emit(s.def.schema, `${path}/anyOf/0`), { type: 'null' }] });
			case 'with_default': {
				const inner = emit(s.def.schema, path);
				if (s.def.value === undefined || (input && transforms(s.def.schema))) return inner;
				const refusal = json_refusal(s.def.value);
				if (refusal) {
					unrepresentable(s.kind, path, `the default is ${refusal}`);
					return inner;
				}
				const node = copy(inner);
				// over a `default` of an inner layer, as zod has it
				node.default = s.def.value;
				return node;
			}
			case 'lazy':
				return emit(target(s), path);
			case 'object':
				return object(s.kind, s.def, path, () => false);
			case 'strip_object':
				return object(s.kind, s.def, path, () => (input ? undefined : false) as Node | false);
			case 'loose_object':
				return object(s.kind, s.def, path, () => ({}));
			case 'object_with_rest':
				return object(s.kind, s.def.entries, path, () =>
					into(s.def.rest, `${path}/additionalProperties`)
				);
			case 'record':
				return {
					type: 'object',
					propertyNames: { type: 'string' },
					additionalProperties: into(s.def, `${path}/additionalProperties`)
				};
			case 'array':
				return { type: 'array', items: into(s.def, `${path}/items`) };
			case 'union':
				return compact({ anyOf: s.def.map((o, i) => emit(o, `${path}/anyOf/${i}`)) });
			case 'variant':
				return { oneOf: s.def.options.map((o, i) => into(o, `${path}/oneOf/${i}`)) };
			case 'pipe':
				return pipe(s, path);
			case 'bigint':
				unrepresentable(s.kind, path, 'a bigint is not JSON');
				return {};
			case 'min_length':
			case 'max_length':
			case 'min_value':
			case 'max_value':
			case 'regex':
			case 'check':
			case 'transform':
				unrepresentable(s.kind, path, 'it means something only in a pipe after a schema it fits');
				return {};
			default:
				unrepresentable((s as AnySchema).kind, path, 'it is a kind defined outside the library');
				return {};
		}
	};

	const ref = (s: SchemaNode): Node => {
		let marker = markers.get(s);
		if (!marker) markers.set(s, (marker = {}));
		return { $ref: marker as unknown as string };
	};

	const emit = (value: unknown, path: string): Node => {
		if (!is_schema(value)) throw Error(`cannot express at ${path}: not a schema`);
		const known = done.get(value);
		if (known) return known;
		if (open.has(value)) {
			if (chain.has(value)) {
				error(value.kind, path, 'the schema comes back to itself without reading into the value');
			}
			recursive.add(value);
			return ref(value);
		}
		open.add(value);
		chain.add(value);
		order.push(value);
		let node = with_meta(build(value, path), value, path);
		open.delete(value);
		chain.delete(value);
		if (recursive.has(value) && value !== root) {
			defs.set(value, node);
			node = ref(value);
		}
		done.set(value, node);
		return node;
	};
	const defs: Map<SchemaNode, Node> = new Map();
	// writes what reads into the value, an entry or an item, which starts the chain again
	const into = (value: unknown, path: string): Node => {
		const outer = chain;
		chain = new Set();
		const node = emit(value, path);
		chain = outer;
		return node;
	};

	const body = emit(root, '#');
	// a `$ref` names its definition in the order the schemas were first met, as zod's do
	const names: Map<object, string> = new Map();
	const $defs: Record<string, Node> = {};
	let count = 0;
	for (const s of order) {
		const node = defs.get(s);
		if (s === root && recursive.has(s)) names.set(markers.get(s)!, '#');
		if (!node) continue;
		const name = `__schema${count++}`;
		names.set(markers.get(s)!, `#/$defs/${name}`);
		$defs[name] = node;
	}
	const document: Node = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...body };
	if (count) document.$defs = $defs;
	// a fresh tree of plain JSON, which also makes each `-0` a `0`
	return JSON.parse(
		JSON.stringify(document, (_key, value: unknown) =>
			typeof value === 'object' && value !== null ? (names.get(value) ?? value) : value
		)
	);
};
