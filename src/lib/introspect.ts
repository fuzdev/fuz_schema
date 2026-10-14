/**
 * Reading a schema as data: walking through its wrappers to the schema they
 * hold, finding metadata and defaults on the way, listing an object's
 * entries, and rendering a schema's input type as text for help output.
 *
 * A module of its own, so a bundle that never reads a schema pays nothing,
 * and each export is dropped when unused. It reads schemas and makes none.
 *
 * The layers of a schema are the schemas a walk passes through to reach what
 * the value is: `optional`, `nullable`, and `with_default` lead to their
 * `def.schema`, a `pipe` to its first schema, and a `lazy` to the schema its
 * function returns, which is called to find it. `message`, `flavor`, and
 * `brand` are no layer: they keep the `kind` and `def` of what they were
 * given. Metadata is found on any layer, as `meta` attaches it to one object,
 * so `with_default(meta(s.boolean, {description}), true)` and
 * `meta(with_default(s.boolean, true), {description})` read the same. Metadata
 * attached inside a `message` is out of reach, as `message` holds no schema.
 *
 * Import by name: `import {get_schema_fields} from '@fuzdev/fuz_schema/introspect.ts'`.
 *
 * @module
 */

import type { AnySchema, SchemaNode } from './schema.ts';
import { get_meta, type SchemaMeta } from './meta.ts';

// the layers of `schema`, outermost first, ending at the first that isn't a
// wrapper. A `lazy` is followed by calling its function, so one that leads
// back to itself through wrappers alone, as `lazy(() => optional(L))` as `L`
// does, never ends and exhausts memory, where a parse of it on a value no
// wrapper answers throws a `RangeError`
const to_layers = (schema: AnySchema): Array<SchemaNode> => {
	const layers: Array<SchemaNode> = [];
	let s = schema as SchemaNode;
	for (;;) {
		layers.push(s);
		switch (s.kind) {
			case 'optional':
			case 'nullable':
			case 'with_default':
				s = s.def.schema;
				break;
			case 'pipe':
				s = s.def[0]!;
				break;
			case 'lazy':
				s = s.def();
				break;
			default:
				return layers;
		}
	}
};

/**
 * The innermost layer of `schema`, what the value is under its wrappers:
 * `string` for `optional(nullable(string))`, and `schema` itself when it is
 * no wrapper.
 */
export const unwrap_schema = (schema: AnySchema): SchemaNode => to_layers(schema).at(-1)!;

/**
 * The value of metadata `key` on the outermost layer of `schema` that has it
 * other than `undefined`. `get_meta` reads the one object it is given.
 *
 * @param key - a key of `SchemaMeta`, `description` or one added by declaration merging
 */
export const get_schema_meta = <TKey extends keyof SchemaMeta>(
	schema: AnySchema,
	key: TKey
): SchemaMeta[TKey] | undefined => {
	for (const layer of to_layers(schema)) {
		const value = get_meta(layer)?.[key];
		if (value !== undefined) return value;
	}
	return undefined;
};

/**
 * The entries of `schema` when its innermost layer is an object schema,
 * `object`, `loose_object`, or `strip_object`, and otherwise `undefined`.
 */
export const get_schema_entries = (
	schema: AnySchema
): Readonly<Record<string, SchemaNode>> | undefined => {
	const s = unwrap_schema(schema);
	return s.kind === 'object' || s.kind === 'loose_object' || s.kind === 'strip_object'
		? s.def
		: undefined;
};

/** What `get_schema_fields` reads of one entry of an object schema. */
export interface SchemaField {
	/** The entry's key. */
	name: string;
	/** The entry as given. */
	schema: SchemaNode;
	/**
	 * Whether the outermost layer that is an `optional` or a `with_default` is
	 * a `with_default`: an `optional` outside one answers `undefined` before the
	 * default is asked. `default` is then its value, even when that is
	 * `undefined`.
	 */
	has_default: boolean;
	/**
	 * The value of that `with_default`, before any step of a `pipe` it starts,
	 * and `undefined` when there is none.
	 */
	default: unknown;
	/** The `description` metadata, as `get_schema_meta` finds it. */
	description: string | undefined;
}

/**
 * Reads every entry of `schema`, in order, or none when it isn't an object
 * schema under its wrappers.
 */
export const get_schema_fields = (schema: AnySchema): Array<SchemaField> => {
	const fields: Array<SchemaField> = [];
	const entries = get_schema_entries(schema);
	for (const name in entries) {
		const entry = entries[name]!;
		// the outermost `optional` or `with_default`: a default under an `optional` is never asked
		let first: SchemaNode<'optional' | 'with_default'> | undefined;
		let description: string | undefined;
		for (const layer of to_layers(entry)) {
			if (layer.kind === 'optional' || layer.kind === 'with_default') first ??= layer;
			description ??= get_meta(layer)?.description;
		}
		fields.push({
			name,
			schema: entry,
			has_default: first?.kind === 'with_default',
			default: first?.kind === 'with_default' ? first.def.value : undefined,
			description
		});
	}
	return fields;
};

/**
 * Renders the type `schema` accepts as TypeScript-like text, for help output:
 * `Array<string> | null`, `{name: string; port?: number}`, `"a" | "b"`.
 *
 * - A `with_default` renders as its schema, leaving the default to be shown
 *   by its value, and an `optional` adds `| undefined`.
 * - An entry is marked `?` when a layer is an `optional` or a `with_default`.
 *   A `union` with an `optional` option lets the key be missing too, and
 *   isn't looked into.
 * - A `pipe` renders as its first schema, what it accepts.
 * - A `lazy` renders as the schema its function returns, once, and one
 *   that returns a `lazy` as what that returns: a `lazy` inside that renders
 *   as `...`, recursive or not. So a recursive schema shows one level of
 *   itself, whatever its functions build, short of a `lazy` that only
 *   returns a `lazy`, which a parse can't end either, and a `lazy` nested
 *   in another shows as `...` though it would end.
 * - A string literal is quoted as JSON, as the `expected` text of an issue
 *   has it, and a bigint ends in `n`.
 * - A kind with no text of its own, an action or one defined outside the
 *   library, renders as its kind.
 */
export const format_schema_type = (schema: AnySchema): string => to_type(schema as SchemaNode);

// `inside` says the walk is inside what a `lazy` returned, where a `lazy`
// renders as `...`, which bounds the text of any recursive schema short of
// a `lazy` that only returns a `lazy`
const to_type = (s: SchemaNode, inside?: boolean): string => {
	switch (s.kind) {
		case 'string':
		case 'number':
		case 'boolean':
		case 'bigint':
		case 'unknown':
			return s.kind;
		case 'literal':
			return format_literal(s.def);
		case 'one_of':
			return s.def.map(format_literal).join(' | ');
		case 'optional':
			return to_type(s.def.schema, inside) + ' | undefined';
		case 'nullable':
			return to_type(s.def.schema, inside) + ' | null';
		case 'with_default':
			return to_type(s.def.schema, inside);
		case 'pipe':
			return to_type(s.def[0]!, inside);
		case 'lazy':
			// a `lazy` it returns is rendered at the same level, as the one it defers to
			// eslint-disable-next-line no-param-reassign
			return inside ? '...' : to_type((s = s.def()), s.kind !== 'lazy');
		case 'array':
			return `Array<${to_type(s.def, inside)}>`;
		case 'record':
			return `Record<string, ${to_type(s.def, inside)}>`;
		case 'union':
			return s.def.map((o) => to_type(o, inside)).join(' | ');
		case 'variant':
			return s.def.options.map((o) => to_type(o, inside)).join(' | ');
		case 'object':
		case 'loose_object':
		case 'strip_object': {
			const parts: Array<string> = [];
			for (const key in s.def) {
				const entry = s.def[key]!;
				const optional = to_layers(entry).some(
					(l) => l.kind === 'optional' || l.kind === 'with_default'
				);
				parts.push(
					`${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}${optional ? '?' : ''}: ${to_type(entry, inside)}`
				);
			}
			if (s.kind === 'loose_object') parts.push('[key: string]: unknown');
			return `{${parts.join('; ')}}`;
		}
		default:
			return s.kind;
	}
};

const format_literal = (v: unknown): string =>
	typeof v === 'string' ? JSON.stringify(v) : typeof v === 'bigint' ? v + 'n' : String(v);
