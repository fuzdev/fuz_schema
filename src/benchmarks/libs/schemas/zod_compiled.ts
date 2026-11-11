/**
 * The schemas of `../zod_compiled.ts`: `schemas/zod.ts`'s builders, each
 * scenario's root through `z.compile`, with Zod's guard and parse. A root
 * `z.compile` can't compile it hands back unchanged, and `zod_compiled` has no
 * figure there, see `find_uncompiled_scenarios`.
 *
 * @module
 */

// a builder's return type is what it infers, as a consumer's schema's is, which the type
// benchmark reads
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import * as z from 'zod';

import { SCENARIOS, type ScenarioName, type ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';
import { compile_zod_root } from '../../zod_compile.ts';
import * as zod from './zod.ts';

/**
 * Whether a value matches, by `z.validate`, which returns a boolean and not
 * the output: on a compiled schema through the assert-only validator compiled
 * beside its parser, and otherwise through the parser, which still copies what
 * it reads and drops the copy.
 */
export const to_guard =
	(schema: z.ZodType): ScenarioRunner =>
	(value) =>
		z.validate(schema, value);

/** What `safeParse` returns, for a test to hold the libraries to one output. */
export const to_output =
	(schema: z.ZodType) =>
	(value: unknown): ScenarioOutput => {
		const result = schema.safeParse(value);
		return result.success ? { ok: true, value: result.data } : { ok: false };
	};

// each schema of an app compiled, as each is a root a payload's key is parsed by
const compile_each = <T extends Record<string, z.ZodType>>(schemas: T): T =>
	Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, z.compile(schema)])) as T;

export const schema_string = () => z.compile(zod.schema_string());

export const schema_object_flat = () => z.compile(zod.schema_object_flat());

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () => z.compile(zod.schema_strict_nested());

export const schema_pipe = () => z.compile(zod.schema_pipe());

export const schema_union = () => z.compile(zod.schema_union());

export const schema_list = () => z.compile(zod.schema_list());

export const schema_type_json = () => z.compile(zod.schema_type_json());

export const schema_app = () => compile_each(zod.schema_app());

/**
 * The scenarios with a root `z.compile` hands back uncompiled, by
 * `compile_zod_root`: `zod_compiled` has no parse or guard figure of them.
 */
export const find_uncompiled_scenarios = (): Array<ScenarioName> =>
	SCENARIOS.filter((scenario) => {
		const schema: z.ZodType | Record<string, z.ZodType> = zod[`schema_${scenario.name}`]();
		const roots = schema instanceof z.ZodType ? [schema] : Object.values(schema);
		return roots.some((root) => !compile_zod_root(z, root));
	}).map((scenario) => scenario.name);

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: z.infer<ReturnType<typeof schema_string>>;
	object_flat: z.infer<ReturnType<typeof schema_object_flat>>;
	strict_nested: z.infer<ReturnType<typeof schema_strict_nested>>;
	pipe: z.infer<ReturnType<typeof schema_pipe>>;
	union: z.infer<ReturnType<typeof schema_union>>;
	list: z.infer<ReturnType<typeof schema_list>>;
}
