/**
 * Metadata for schemas, kept beside them in a registry so a schema stays the
 * three-field object it is and a bundle that attaches none pays nothing.
 *
 * `meta` returns a copy of a schema with metadata attached, and `get_meta`
 * reads it back. The metadata belongs to that one object:
 *
 * - `flavor` and `brand` return the object they were given, so its metadata
 *   is still there.
 * - `message` builds a new schema, as does every wrapper and container, so
 *   what they return has none. Attach metadata last, outside `message`.
 * - A wrapper holds the schema it was given under `def.schema`, so metadata
 *   on a wrapped schema is found by walking to it.
 *
 * `SchemaMeta` has `description` built in and takes other keys by
 * declaration merging.
 *
 * The registry is one for the whole JS realm, on `globalThis` under
 * `Symbol.for('@fuzdev/fuz_schema/meta')`, so every copy of this module
 * shares it: a second install of the package, a bundler's duplicate, another
 * version that keeps it there. Metadata attached through one copy is read through any other.
 * That makes the registry's shape a contract between versions: a `WeakMap`
 * from schema object to its metadata object, which `meta` replaces with a
 * merged copy and never mutates. A version that changes it takes a new key.
 *
 * Import as a namespace or by name:
 * `import {meta, get_meta} from '@fuzdev/fuz_schema/meta.ts'`.
 *
 * @module
 */

import type { AnySchema, SchemaAction } from './schema.ts';

/**
 * What can be attached to a schema. Every key is optional.
 *
 * Add keys by declaration merging, naming the module as it is imported:
 *
 * ```ts
 * declare module '@fuzdev/fuz_schema/meta.ts' {
 * 	interface SchemaMeta {
 * 		aliases?: Array<string>;
 * 	}
 * }
 * ```
 */
export interface SchemaMeta {
	/** What the value is, for help text and generated docs. */
	description?: string;
}

type Registry = WeakMap<AnySchema, SchemaMeta>;

// held weakly, so metadata lives as long as its schema and no longer.
// The key holds the package's name, which no other package can publish under,
// and no version: the shape is the contract. The call is pure as far as a
// bundler needs: only this module reads what it writes, and a copy that is
// kept writes it when it runs, so dropping an unused one loses nothing.
const registry: Registry = /* @__PURE__ */ (() =>
	((globalThis as unknown as Record<symbol, Registry | undefined>)[
		Symbol.for('@fuzdev/fuz_schema/meta')
	] ??= new WeakMap()))();

/**
 * Attaches metadata to a copy of `schema`, leaving `schema` as it was: one
 * with no options is a constant every use shares. The copy has the same
 * `kind`, `def`, and `run`, so it is otherwise indistinguishable from
 * `schema` and can go anywhere `schema` can.
 *
 * Metadata `schema` already has is merged key by key, the new keys winning.
 * A key given as `undefined` wins too, which is how one is cleared.
 *
 * @param schema - the schema to copy
 * @param meta - copied one level deep, so changing its keys afterwards changes nothing
 */
// @__NO_SIDE_EFFECTS__
export const meta: {
	// an action first, so one built inside a `pipe` is typed from the step before it. Any other
	// schema fails the first, as its `~types` has no `action`, so the second takes it, unless it is
	// an object literal written in the call without a `~types`, which the first takes as an action
	<TInput, TOutput, TKind extends string, TDef>(
		schema: SchemaAction<TInput, TOutput, TKind, TDef>,
		meta: SchemaMeta
	): SchemaAction<TInput, TOutput, TKind, TDef>;
	<T extends AnySchema>(schema: T, meta: SchemaMeta): T;
} = <T extends AnySchema>(schema: T, meta: SchemaMeta): T => {
	const copy = { kind: schema.kind, def: schema.def, run: schema.run } as AnySchema as T;
	registry.set(copy, { ...registry.get(schema), ...meta });
	return copy;
};

/**
 * Reads the metadata attached to `schema` by `meta`, or `undefined` when it
 * has none. Only that object is looked at, not the schemas inside it.
 *
 * @returns the stored object, the same one on every call
 */
export const get_meta = (schema: AnySchema): Readonly<SchemaMeta> | undefined =>
	registry.get(schema);
