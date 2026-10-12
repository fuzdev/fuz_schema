import * as s from '#lib/schema.ts';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: s.AnySchema): ScenarioRunner =>
	(value) =>
		s.parse(schema, value).ok;

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(s.string);

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		s.strip_object({
			id: s.number,
			name: s.string,
			email: s.string,
			active: s.boolean,
			role: s.optional(s.string)
		})
	);

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		s.object({
			id: s.number,
			name: s.string,
			tags: s.array(s.string),
			address: s.object({ street: s.string, city: s.string, zip: s.string })
		})
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		s.strip_object({
			name: s.pipe(s.string, s.min_length(1), s.max_length(50)),
			age: s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150)),
			slug: s.pipe(s.string, s.regex(/^[a-z0-9-]+$/))
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(s.array(s.union([s.string, s.number, s.boolean])));

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: s.Schema = s.variant('kind', [
		s.object({ kind: s.literal('intrinsic'), text: s.string }),
		s.object({
			kind: s.literal('literal'),
			value: s.union([s.string, s.pipe(s.number, s.finite), s.boolean]),
			text: s.string
		}),
		s.object({
			kind: s.literal('reference'),
			name: s.string,
			module: s.optional(s.string),
			typeArgs: s.optional(s.array(s.lazy(() => TypeJson)))
		}),
		s.object({
			kind: s.literal('array'),
			element: s.lazy(() => TypeJson),
			readonly: s.optional(s.boolean)
		}),
		s.object({
			kind: s.literal('tuple'),
			elements: s.optional(s.array(s.lazy(() => TupleElementJson))),
			readonly: s.optional(s.boolean)
		}),
		s.object({
			kind: s.literal('union'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		s.object({
			kind: s.literal('intersection'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		s.object({ kind: s.literal('function'), text: s.string }),
		s.object({ kind: s.literal('object'), text: s.string }),
		s.object({ kind: s.literal('other'), text: s.string })
	]);
	const TupleElementJson: s.Schema = s.object({
		name: s.optional(s.string),
		type: TypeJson,
		optional: s.optional(s.boolean),
		rest: s.optional(s.boolean)
	});
	return to_runner(TypeJson);
};
