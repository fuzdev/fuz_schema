import Type, { type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

// typebox is a different category: `Compile` generates a validator with
// `new Function`, and `Check` answers yes or no without building an output
// or issues, so it's the floor for runtime cost, not a like-for-like parser
const to_runner = (schema: TSchema): ScenarioRunner => {
	const validator = Compile(schema);
	return (value) => validator.Check(value);
};

const STRICT = { additionalProperties: false };

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(Type.String());

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		Type.Object({
			id: Type.Number(),
			name: Type.String(),
			email: Type.String(),
			active: Type.Boolean(),
			role: Type.Optional(Type.String())
		})
	);

export const scenario_extra_keys: ScenarioModule['scenario_extra_keys'] = scenario_object_flat;

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		Type.Object(
			{
				id: Type.Number(),
				name: Type.String(),
				tags: Type.Array(Type.String()),
				address: Type.Object(
					{ street: Type.String(), city: Type.String(), zip: Type.String() },
					STRICT
				)
			},
			STRICT
		)
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		Type.Object({
			name: Type.String({ minLength: 1, maxLength: 50 }),
			age: Type.Integer({ minimum: 0, maximum: 150 }),
			slug: Type.String({ pattern: '^[a-z0-9-]+$' })
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()])));

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		Type.Array(
			Type.Object(
				{
					id: Type.Number(),
					name: Type.String(),
					email: Type.String(),
					active: Type.Boolean(),
					role: Type.Optional(Type.String()),
					tags: Type.Array(Type.String())
				},
				STRICT
			)
		)
	);

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const text = (kind: string): TSchema =>
		Type.Object({ kind: Type.Literal(kind), text: Type.String() }, STRICT);
	const members = (kind: string): TSchema =>
		Type.Object(
			{
				kind: Type.Literal(kind),
				alias: Type.Optional(Type.String()),
				members: Type.Array(Type.Ref('TypeJson'))
			},
			STRICT
		);
	return to_runner(
		Type.Cyclic(
			{
				TypeJson: Type.Union([
					text('intrinsic'),
					Type.Object(
						{
							kind: Type.Literal('literal'),
							value: Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
							text: Type.String()
						},
						STRICT
					),
					Type.Object(
						{
							kind: Type.Literal('reference'),
							name: Type.String(),
							module: Type.Optional(Type.String()),
							typeArgs: Type.Optional(Type.Array(Type.Ref('TypeJson')))
						},
						STRICT
					),
					Type.Object(
						{
							kind: Type.Literal('array'),
							element: Type.Ref('TypeJson'),
							readonly: Type.Optional(Type.Boolean())
						},
						STRICT
					),
					Type.Object(
						{
							kind: Type.Literal('tuple'),
							elements: Type.Optional(Type.Array(Type.Ref('TupleElementJson'))),
							readonly: Type.Optional(Type.Boolean())
						},
						STRICT
					),
					members('union'),
					members('intersection'),
					text('function'),
					text('object'),
					text('other')
				]),
				TupleElementJson: Type.Object(
					{
						name: Type.Optional(Type.String()),
						type: Type.Ref('TypeJson'),
						optional: Type.Optional(Type.Boolean()),
						rest: Type.Optional(Type.Boolean())
					},
					STRICT
				)
			},
			'TypeJson'
		)
	);
};
