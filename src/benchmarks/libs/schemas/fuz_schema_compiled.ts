/**
 * The schemas of `../fuz_schema_compiled.ts`: `schemas/fuz_schema.ts`'s builders,
 * which a compile reads and leaves as they are, with the compiled guard and
 * parse over a schema. A compile hands back a function and no schema, so the
 * builders are the interpreter's own and what differs is here: `to_guard` is
 * `compile_guard`, and `to_output` is `compile_parse`.
 *
 * @module
 */

// a builder's return type is what it infers, as a consumer's schema's is, which the type
// benchmark reads
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import type * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';
import * as fuz_schema from './fuz_schema.ts';

/**
 * Whether a value matches, by the guard `compile_guard` makes of the schema,
 * which gives what `is` gives and builds no issues and no output. The compile
 * is here, once a schema, and the guard is called as it is returned.
 */
export const to_guard = (schema: s.AnySchema): ScenarioRunner => compile_guard(schema);

/**
 * What the parse `compile_parse` makes of the schema returns, for a test to
 * hold the libraries to one output.
 */
export const to_output = (schema: s.AnySchema) => {
	const parse = compile_parse(schema);
	return (value: unknown): ScenarioOutput => {
		const result = parse(value);
		return result.ok ? { ok: true, value: result.value } : { ok: false };
	};
};

export const schema_string = () => fuz_schema.schema_string();

export const schema_object_flat = () => fuz_schema.schema_object_flat();

export const schema_object_copy = () => fuz_schema.schema_object_copy();

export const schema_strict_nested = () => fuz_schema.schema_strict_nested();

export const schema_pipe = () => fuz_schema.schema_pipe();

export const schema_union = () => fuz_schema.schema_union();

export const schema_list = () => fuz_schema.schema_list();

export const schema_type_json = () => fuz_schema.schema_type_json();

export const schema_app = () => fuz_schema.schema_app();

/**
 * What a compiled parse of a schema gives where the input matches, as a
 * consumer of the compiled mode reads it: through the type of the function
 * `compile_parse` returns.
 */
type CompiledOutput<T extends s.Schema> = Extract<
	ReturnType<ReturnType<typeof compile_parse<T>>>,
	{ ok: true }
>['value'];

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: CompiledOutput<ReturnType<typeof schema_string>>;
	object_flat: CompiledOutput<ReturnType<typeof schema_object_flat>>;
	strict_nested: CompiledOutput<ReturnType<typeof schema_strict_nested>>;
	pipe: CompiledOutput<ReturnType<typeof schema_pipe>>;
	union: CompiledOutput<ReturnType<typeof schema_union>>;
	list: CompiledOutput<ReturnType<typeof schema_list>>;
}
