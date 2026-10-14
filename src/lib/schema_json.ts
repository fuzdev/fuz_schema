/**
 * Serializes a schema to the interchange form the Rust crate loads.
 *
 * A node is `{kind, def}` as `SchemaDefs` has it, with `def` left out where it
 * is `undefined`. A `lazy` holds a function there, so its `def` becomes a name,
 * and the document is an envelope, `{schema, defs}`, whose `defs` are what the
 * names stand for.
 *
 * The crate refuses what it can't carry across, and so does this: it throws,
 * naming the kind and the path, on anything `Schema::from_json` would reject,
 * and on what the crate's parser would not read of the document itself: a
 * string that is not well-formed Unicode, and nesting deeper than
 * `SCHEMA_JSON_MAX_DEPTH`. A schema that serializes is one the crate loads.
 * The reverse does not hold: schemas are counted through every `lazy`, so
 * that a function making a new `lazy` each call ends, and a schema more than
 * `SCHEMA_JSON_MAX_DEPTH` schemas deep that way is refused though its
 * document would load.
 *
 * It is a module of its own, so a bundle that serializes no schema carries
 * none of it. It needs `String.prototype.isWellFormed`.
 *
 * @module
 */

import { is_schema, type AnySchema } from './schema.ts';

/** A schema in the interchange form. */
export interface SchemaJson {
	schema: SchemaJsonNode;
	/** What each `lazy` names, by name. Left out when there is no `lazy`. */
	defs?: Record<string, SchemaJsonNode>;
}

/** A node of the interchange form. */
export interface SchemaJsonNode {
	kind: string;
	def?: unknown;
}

/**
 * The most wrappers, `lazy`, `union` options, and starts of a `pipe` around
 * one value. The crate's `MAX_NESTING`.
 */
export const SCHEMA_JSON_MAX_NESTING = 16;

/**
 * The deepest that arrays and objects can be nested in a text the crate reads,
 * a document in the interchange form included. The crate's `MAX_DEPTH`.
 */
export const SCHEMA_JSON_MAX_DEPTH = 127;

/**
 * The names of the members of `Object.prototype`. The library reads an
 * object's entries through the prototype, so an entry with one of these names
 * sees the member when the input lacks the key, and is refused. So is a
 * `variant` whose key is one.
 */
export const SCHEMA_JSON_REFUSED_KEYS: ReadonlyArray<string> = [
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
	'__proto__',
	'constructor',
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'toLocaleString',
	'toString',
	'valueOf'
];

/** The kinds that hold nothing. */
const BARE_KINDS: ReadonlySet<string> = new Set([
	'string',
	'number',
	'boolean',
	'bigint',
	'unknown',
	'integer',
	'safe_integer'
]);

/**
 * The kinds that hold a JavaScript value, which the form has no way to write,
 * and which the crate refuses by name. `with_default_fn` holds one too and is
 * refused the same way here, and the crate refuses it as a kind it doesn't
 * know.
 */
export const SCHEMA_JSON_UNSUPPORTED_KINDS: ReadonlyArray<string> = ['regex', 'check', 'transform'];

const OBJECT_KINDS: ReadonlySet<string> = new Set(['object', 'loose_object', 'strip_object']);

/** The actions that take a length, which a string or an array has. */
const LENGTH_ACTIONS: ReadonlySet<string> = new Set(['min_length', 'max_length']);

/** The actions that take a number. */
const NUMBER_ACTIONS: ReadonlySet<string> = new Set([
	'min_value',
	'max_value',
	'integer',
	'safe_integer'
]);

/** The actions that mean something only in a `pipe`, where the library would coerce or throw. */
const PIPE_ONLY_ACTIONS: ReadonlySet<string> = new Set([
	'min_length',
	'max_length',
	'min_value',
	'max_value'
]);

/** A key as a reference token of a JSON Pointer. */
const pointer_token = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** What the first schema of a pipe fixes its value to be, when it fixes one. */
const value_type = (schema: AnySchema): 'string' | 'number' | 'array' | undefined => {
	switch (schema.kind) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
		case 'safe_integer':
			return 'number';
		case 'array':
			return 'array';
		case 'pipe':
			return is_schema(schema.def[0]) ? value_type(schema.def[0]) : undefined;
		default:
			return undefined;
	}
};

const ILL_FORMED = 'a string that is not well-formed Unicode, which the crate does not read';

/**
 * Why `value` is not a default the crate loads, when it is not: it must be
 * what `JSON.parse` could have returned, of well-formed strings and keys, and
 * nested no deeper than `SCHEMA_JSON_MAX_DEPTH`, which a value that holds
 * itself is.
 */
const default_refusal = (value: unknown): string | undefined => {
	const stack: Array<[value: unknown, depth: number]> = [[value, 0]];
	let next;
	while ((next = stack.pop())) {
		const [v, depth] = next;
		if (v === null || typeof v === 'boolean') continue;
		if (typeof v === 'string') {
			if (!v.isWellFormed()) return `the default holds ${ILL_FORMED}`;
			continue;
		}
		if (typeof v === 'number') {
			if (!Number.isFinite(v)) return 'the default is not a JSON value';
			continue;
		}
		if (typeof v !== 'object') return 'the default is not a JSON value';
		if (depth >= SCHEMA_JSON_MAX_DEPTH) {
			return `the default nests deeper than ${SCHEMA_JSON_MAX_DEPTH}`;
		}
		if (Array.isArray(v)) {
			// a hole reads as `undefined`
			for (let i = 0; i < v.length; i++) stack.push([v[i], depth + 1]);
			continue;
		}
		const proto = Object.getPrototypeOf(v);
		if (proto !== Object.prototype && proto !== null) return 'the default is not a JSON value';
		for (const key of Object.keys(v)) {
			if (!key.isWellFormed()) return `the default holds ${ILL_FORMED}`;
			stack.push([(v as Record<string, unknown>)[key], depth + 1]);
		}
	}
	return undefined;
};

/**
 * Where a document first nests deeper than `SCHEMA_JSON_MAX_DEPTH`, as a JSON
 * Pointer, when it does.
 */
const too_deep_at = (document: unknown): string | undefined => {
	const stack: Array<[value: unknown, depth: number, path: string]> = [[document, 0, '']];
	let next;
	while ((next = stack.pop())) {
		const [value, depth, path] = next;
		if (value === null || typeof value !== 'object') continue;
		if (depth >= SCHEMA_JSON_MAX_DEPTH) return path;
		for (const key of Object.keys(value)) {
			stack.push([
				(value as Record<string, unknown>)[key],
				depth + 1,
				`${path}/${pointer_token(key)}`
			]);
		}
	}
	return undefined;
};

/**
 * Serializes `schema` to the interchange form.
 *
 * A `lazy` is named by what it defers to, `$0`, `$1`, and so on in the order
 * they are met, so two `lazy` that return the same schema share a name. Each
 * function a `lazy` holds is called once, however many schemas hold it.
 *
 * @throws Error naming the kind and the path of anything the Rust crate refuses
 */
export const to_schema_json = (schema: AnySchema): SchemaJson => {
	const defs: Record<string, SchemaJsonNode> = {};
	// the name each lazy holds, by its function, which `message` and the like
	// copy to a new schema, and the name of each schema one defers to. They are
	// kept apart because a lazy can defer to a lazy.
	const lazies: Map<unknown, string> = new Map();
	const targets: Map<AnySchema, string> = new Map();

	const refuse = (kind: string, path: string, reason: string): never => {
		throw Error(`cannot serialize \`${kind}\` at ${path}: ${reason}`);
	};

	// a schema held by another, which a bound or a length can't be outside a pipe
	const child = (value: unknown, path: string, depth: number): SchemaJsonNode => {
		if (is_schema(value) && PIPE_ONLY_ACTIONS.has(value.kind)) {
			refuse(value.kind, path, 'it means something only in a pipe');
		}
		return node(value, path, depth);
	};

	const literal = (value: unknown, path: string): unknown => {
		if (
			value === null ||
			typeof value === 'string' ||
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value))
		) {
			if (typeof value === 'string' && !value.isWellFormed()) refuse('literal', path, ILL_FORMED);
			// `-0` is `0` in JSON, and equal to it
			return value === 0 ? 0 : value;
		}
		return refuse(
			'literal',
			path,
			`a literal must be a string, a finite number, a boolean, or null, not ${typeof value === 'number' ? String(value) : typeof value}`
		);
	};

	const entries = (
		kind: string,
		def: unknown,
		path: string,
		depth: number
	): Record<string, SchemaJsonNode> => {
		if (def === null || typeof def !== 'object')
			return refuse(kind, path, 'its def is not entries');
		const out: Record<string, SchemaJsonNode> = {};
		for (const key of Object.keys(def)) {
			if (!key.isWellFormed()) {
				// the key is not written into the message, which must be well-formed too
				refuse(kind, path, `an entry is named by ${ILL_FORMED}`);
			}
			if (SCHEMA_JSON_REFUSED_KEYS.includes(key)) {
				refuse(
					kind,
					`${path}/${pointer_token(key)}`,
					'the entry is named like a member of Object.prototype'
				);
			}
			out[key] = child(
				(def as Record<string, unknown>)[key],
				`${path}/${pointer_token(key)}`,
				depth
			);
		}
		return out;
	};

	// `depth` is how many schemas are around this one, through every lazy
	const node = (value: unknown, path: string, depth: number): SchemaJsonNode => {
		if (!is_schema(value)) throw Error(`cannot serialize at ${path}: not a schema`);
		// read as data, whatever the kind turns out to be
		const kind: string = value.kind;
		const def: any = value.def;
		// a function that makes a new schema each time it is called never ends
		if (depth > SCHEMA_JSON_MAX_DEPTH) {
			return refuse(
				kind,
				path,
				`more than ${SCHEMA_JSON_MAX_DEPTH} schemas around it, through every lazy`
			);
		}
		const inner = depth + 1;
		if (SCHEMA_JSON_UNSUPPORTED_KINDS.includes(kind)) {
			return refuse(kind, path, 'it holds a JavaScript value and is not portable');
		}
		if (BARE_KINDS.has(kind)) return { kind };
		switch (kind) {
			case 'literal':
				return { kind, def: literal(def, `${path}/def`) };
			case 'one_of':
				if (!Array.isArray(def)) return refuse(kind, path, 'its def is not an array');
				return { kind, def: def.map((v: unknown, i: number) => literal(v, `${path}/def/${i}`)) };
			case 'optional':
			case 'nullable':
				return { kind, def: { schema: child(def?.schema, `${path}/def/schema`, inner) } };
			case 'with_default': {
				const refusal = default_refusal(def?.value);
				if (refusal !== undefined) refuse(kind, `${path}/def/value`, refusal);
				return {
					kind,
					// as JSON holds it, which a `-0` in it differs by
					def: {
						schema: child(def.schema, `${path}/def/schema`, inner),
						value: JSON.parse(JSON.stringify(def.value))
					}
				};
			}
			// not among the kinds the crate names, which it refuses as one it doesn't know
			case 'with_default_fn':
				return refuse(kind, path, 'it holds a JavaScript value and is not portable');
			case 'lazy': {
				let name = lazies.get(def);
				if (name === undefined) {
					if (typeof def !== 'function') return refuse(kind, path, 'its def is not a function');
					const target: unknown = def();
					if (!is_schema(target)) return refuse(kind, path, 'it does not return a schema');
					name = targets.get(target);
					if (name === undefined) {
						name = `$${targets.size}`;
						// named before it is serialized, which is where it comes back to itself
						targets.set(target, name);
						lazies.set(def, name);
						// reserves its place, so the names are in the order they were met
						defs[name] = { kind: 'unknown' };
						defs[name] = child(target, `/defs/${pointer_token(name)}`, inner);
					} else {
						lazies.set(def, name);
					}
				}
				return { kind, def: name };
			}
			case 'object':
			case 'loose_object':
			case 'strip_object':
				return { kind, def: entries(kind, def, `${path}/def`, inner) };
			case 'record':
			case 'array':
				return { kind, def: child(def, `${path}/def`, inner) };
			case 'union':
				if (!Array.isArray(def)) return refuse(kind, path, 'its def is not an array');
				return {
					kind,
					def: def.map((v: unknown, i: number) => child(v, `${path}/def/${i}`, inner))
				};
			case 'variant': {
				const key: unknown = def?.key;
				const options: unknown = def?.options;
				if (typeof key !== 'string' || !Array.isArray(options)) {
					return refuse(kind, path, 'its def is not a key and options');
				}
				if (!key.isWellFormed()) refuse(kind, `${path}/def/key`, `its key is ${ILL_FORMED}`);
				// with options the key is an entry of each, and refused there
				if (!options.length && SCHEMA_JSON_REFUSED_KEYS.includes(key)) {
					refuse(kind, `${path}/def/key`, 'the key is named like a member of Object.prototype');
				}
				return {
					kind,
					def: {
						key,
						options: options.map((option: unknown, i: number) => {
							const at = `${path}/def/options/${i}`;
							if (!is_schema(option) || !OBJECT_KINDS.has(option.kind)) {
								return refuse(kind, at, 'an option must be an object schema');
							}
							const entry: unknown = Object.hasOwn(option.def as object, key)
								? (option.def as Record<string, unknown>)[key]
								: undefined;
							if (!is_schema(entry) || entry.kind !== 'literal') {
								refuse(kind, at, `an option needs a \`literal\` entry at ${JSON.stringify(key)}`);
							}
							return node(option, at, inner);
						})
					}
				};
			}
			case 'pipe': {
				if (!Array.isArray(def) || !def.length) return refuse(kind, path, 'it has no schema');
				const head: unknown = def[0];
				const type = is_schema(head) ? value_type(head) : undefined;
				if (type === undefined) {
					return refuse(
						kind,
						`${path}/def/0`,
						'a pipe must start with a schema that fixes the type of its value'
					);
				}
				return {
					kind,
					def: def.map((step: unknown, i: number) => {
						const at = `${path}/def/${i}`;
						// the first was looked at above, and what isn't portable says so itself
						if (i === 0 || (is_schema(step) && SCHEMA_JSON_UNSUPPORTED_KINDS.includes(step.kind))) {
							return node(step, at, inner);
						}
						const length = is_schema(step) && LENGTH_ACTIONS.has(step.kind);
						const number = is_schema(step) && NUMBER_ACTIONS.has(step.kind);
						if (!length && !number) {
							return refuse(kind, at, "only actions follow a pipe's first schema");
						}
						if (length ? type === 'number' : type !== 'number') {
							refuse(kind, at, `the action is not for a ${type}`);
						}
						return node(step, at, inner);
					})
				};
			}
			case 'min_length':
			case 'max_length':
			case 'min_value':
			case 'max_value':
				if (typeof def !== 'number' || !Number.isFinite(def)) {
					return refuse(kind, `${path}/def`, 'the bound is not a finite number');
				}
				// `-0` is `0` in JSON, and compares as it
				return { kind, def: def === 0 ? 0 : def };
			default:
				throw Error(`cannot serialize at ${path}: unknown kind ${JSON.stringify(kind)}`);
		}
	};

	if (is_schema(schema) && PIPE_ONLY_ACTIONS.has(schema.kind)) {
		refuse(schema.kind, '/schema', 'it means something only in a pipe');
	}
	const root = node(schema, '/schema', 0);
	const json: SchemaJson = Object.keys(defs).length ? { schema: root, defs } : { schema: root };
	check_nesting(json);
	const deep = too_deep_at(json);
	if (deep !== undefined) {
		throw Error(
			`cannot serialize at ${deep}: the document nests deeper than ${SCHEMA_JSON_MAX_DEPTH}, which is as deep as the crate reads`
		);
	}
	return json;
};

/**
 * Refuses a schema that comes back to itself without reading into the value,
 * and one that nests further than `SCHEMA_JSON_MAX_NESTING`.
 *
 * What nests is what steps to another schema for the same value: a wrapper,
 * a `lazy`, the options of a `union`, and the first schema of a `pipe`.
 */
const check_nesting = (json: SchemaJson): void => {
	const depths: Map<SchemaJsonNode, number> = new Map();
	const open: Set<SchemaJsonNode> = new Set();

	const nesting = (node: SchemaJsonNode): Array<SchemaJsonNode> => {
		const def: any = node.def;
		switch (node.kind) {
			case 'optional':
			case 'nullable':
			case 'with_default':
				return [def.schema];
			case 'lazy':
				return [json.defs![def]!];
			case 'union':
				return def;
			case 'pipe':
				return [def[0]];
			default:
				return [];
		}
	};

	// every schema held by `node`, to find the ones nesting starts again at
	const held = (node: SchemaJsonNode): Array<SchemaJsonNode> => {
		const def: any = node.def;
		switch (node.kind) {
			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.values(def);
			case 'record':
			case 'array':
				return [def];
			case 'variant':
				return def.options;
			case 'pipe':
				return def;
			default:
				return nesting(node);
		}
	};

	const depth_of = (node: SchemaJsonNode, path: string): number => {
		const known = depths.get(node);
		if (known !== undefined) return known;
		if (open.has(node)) {
			throw Error(
				`cannot serialize \`${node.kind}\` at ${path}: the schema comes back to itself without reading into the value`
			);
		}
		open.add(node);
		let depth = 0;
		for (const next of nesting(node)) depth = Math.max(depth, depth_of(next, path) + 1);
		open.delete(node);
		if (depth > SCHEMA_JSON_MAX_NESTING) {
			throw Error(
				`cannot serialize \`${node.kind}\` at ${path}: more than ${SCHEMA_JSON_MAX_NESTING} wrappers, lazies, unions, and pipes around one value`
			);
		}
		depths.set(node, depth);
		return depth;
	};

	const seen: Set<SchemaJsonNode> = new Set();
	const visit = (node: SchemaJsonNode, path: string): void => {
		if (seen.has(node)) return;
		seen.add(node);
		depth_of(node, path);
		// a lazy's target is visited under its own name
		if (node.kind !== 'lazy') for (const next of held(node)) visit(next, path);
	};
	visit(json.schema, '/schema');
	for (const name in json.defs) visit(json.defs[name]!, `/defs/${pointer_token(name)}`);
};
