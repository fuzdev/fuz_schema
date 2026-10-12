import * as z from 'zod/mini';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: z.ZodMiniType): ScenarioRunner =>
	(value) =>
		z.safeParse(schema, value).success;

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(z.string());

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		z.object({
			id: z.number(),
			name: z.string(),
			email: z.string(),
			active: z.boolean(),
			role: z.optional(z.string())
		})
	);

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		z.strictObject({
			id: z.number(),
			name: z.string(),
			tags: z.array(z.string()),
			address: z.strictObject({ street: z.string(), city: z.string(), zip: z.string() })
		})
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		z.object({
			name: z.string().check(z.minLength(1), z.maxLength(50)),
			age: z.int().check(z.gte(0), z.lte(150)),
			slug: z.string().check(z.regex(/^[a-z0-9-]+$/))
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(z.array(z.union([z.string(), z.number(), z.boolean()])));

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: z.ZodMiniType = z.discriminatedUnion('kind', [
		z.strictObject({ kind: z.literal('intrinsic'), text: z.string() }),
		z.strictObject({
			kind: z.literal('literal'),
			// zod's `number` is already finite
			value: z.union([z.string(), z.number(), z.boolean()]),
			text: z.string()
		}),
		z.strictObject({
			kind: z.literal('reference'),
			name: z.string(),
			module: z.optional(z.string()),
			typeArgs: z.optional(z.array(z.lazy(() => TypeJson)))
		}),
		z.strictObject({
			kind: z.literal('array'),
			element: z.lazy(() => TypeJson),
			readonly: z.optional(z.boolean())
		}),
		z.strictObject({
			kind: z.literal('tuple'),
			elements: z.optional(z.array(z.lazy(() => TupleElementJson))),
			readonly: z.optional(z.boolean())
		}),
		z.strictObject({
			kind: z.literal('union'),
			alias: z.optional(z.string()),
			members: z.array(z.lazy(() => TypeJson))
		}),
		z.strictObject({
			kind: z.literal('intersection'),
			alias: z.optional(z.string()),
			members: z.array(z.lazy(() => TypeJson))
		}),
		z.strictObject({ kind: z.literal('function'), text: z.string() }),
		z.strictObject({ kind: z.literal('object'), text: z.string() }),
		z.strictObject({ kind: z.literal('other'), text: z.string() })
	]);
	const TupleElementJson: z.ZodMiniType = z.strictObject({
		name: z.optional(z.string()),
		type: TypeJson,
		optional: z.optional(z.boolean()),
		rest: z.optional(z.boolean())
	});
	return to_runner(TypeJson);
};
