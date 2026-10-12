import * as v from 'valibot';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: v.GenericSchema): ScenarioRunner =>
	(value) =>
		v.safeParse(schema, value).success;

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(v.string());

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string(),
			active: v.boolean(),
			role: v.optional(v.string())
		})
	);

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		v.strictObject({
			id: v.number(),
			name: v.string(),
			tags: v.array(v.string()),
			address: v.strictObject({ street: v.string(), city: v.string(), zip: v.string() })
		})
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		v.object({
			name: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
			age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
			slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(v.array(v.union([v.string(), v.number(), v.boolean()])));

// svelte-docinfo's `TypeJson` and `TupleElementJson`, verbatim
export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: v.GenericSchema = v.variant('kind', [
		v.strictObject({ kind: v.literal('intrinsic'), text: v.string() }),
		v.strictObject({
			kind: v.literal('literal'),
			value: v.union([v.string(), v.pipe(v.number(), v.finite()), v.boolean()]),
			text: v.string()
		}),
		v.strictObject({
			kind: v.literal('reference'),
			name: v.string(),
			module: v.optional(v.string()),
			typeArgs: v.optional(v.array(v.lazy(() => TypeJson)))
		}),
		v.strictObject({
			kind: v.literal('array'),
			element: v.lazy(() => TypeJson),
			readonly: v.optional(v.boolean())
		}),
		v.strictObject({
			kind: v.literal('tuple'),
			elements: v.optional(v.array(v.lazy(() => TupleElementJson))),
			readonly: v.optional(v.boolean())
		}),
		v.strictObject({
			kind: v.literal('union'),
			alias: v.optional(v.string()),
			members: v.array(v.lazy(() => TypeJson))
		}),
		v.strictObject({
			kind: v.literal('intersection'),
			alias: v.optional(v.string()),
			members: v.array(v.lazy(() => TypeJson))
		}),
		v.strictObject({ kind: v.literal('function'), text: v.string() }),
		v.strictObject({ kind: v.literal('object'), text: v.string() }),
		v.strictObject({ kind: v.literal('other'), text: v.string() })
	] as any);
	const TupleElementJson: v.GenericSchema = v.strictObject({
		name: v.optional(v.string()),
		type: TypeJson,
		optional: v.optional(v.boolean()),
		rest: v.optional(v.boolean())
	});
	return to_runner(TypeJson);
};
