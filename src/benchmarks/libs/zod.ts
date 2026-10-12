import * as z from 'zod';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: z.ZodType): ScenarioRunner =>
	(value) =>
		schema.safeParse(value).success;

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
			name: z.string().min(1).max(50),
			age: z.int().min(0).max(150),
			slug: z.string().regex(/^[a-z0-9-]+$/)
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(z.array(z.union([z.string(), z.number(), z.boolean()])));

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: z.ZodType = z.discriminatedUnion('kind', [
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
	const TupleElementJson: z.ZodType = z.strictObject({
		name: z.optional(z.string()),
		type: TypeJson,
		optional: z.optional(z.boolean()),
		rest: z.optional(z.boolean())
	});
	return to_runner(TypeJson);
};
