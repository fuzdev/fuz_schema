import Type, { type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

// typebox is a different category: `Compile` generates a validator with
// `new Function`, and `Check` answers yes or no without building an output
// or issues, so it's near the floor for runtime cost on most scenarios, not
// a like-for-like parser
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

// every schema checks its own key, whatever the others gave
const to_app_runner = (app: Record<string, TSchema>): ScenarioRunner => {
	const validators = Object.entries(app).map(([key, schema]) => [key, Compile(schema)] as const);
	return (value: any) => {
		let ok = true;
		for (const [key, validator] of validators) ok = validator.Check(value[key]) && ok;
		return ok;
	};
};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = Type.Integer({ minimum: 1 });
	const count = Type.Integer({ minimum: 0 });
	const money = Type.Number({ minimum: 0 });
	const nullable_string = Type.Union([Type.String(), Type.Null()]);
	const one_of = (values: Array<string>): TSchema =>
		Type.Union(values.map((value) => Type.Literal(value)));
	return to_app_runner({
		user: Type.Object(
			{
				id,
				name: Type.String({ minLength: 1, maxLength: 100 }),
				email: Type.String({ pattern: '^[^@\\s]+@[^@\\s]+$' }),
				role: one_of(['member', 'admin', 'owner']),
				created_at: Type.String(),
				avatar_url: Type.Optional(Type.String())
			},
			STRICT
		),
		post: Type.Object(
			{
				id,
				author_id: id,
				title: Type.String({ minLength: 1, maxLength: 200 }),
				body: Type.String(),
				tags: Type.Array(Type.String()),
				published: Type.Boolean(),
				published_at: nullable_string
			},
			STRICT
		),
		comment: Type.Object(
			{
				id,
				post_id: id,
				author_id: id,
				body: Type.String({ minLength: 1 }),
				reply_to: Type.Optional(id)
			},
			STRICT
		),
		page: Type.Object(
			{
				page: id,
				per_page: Type.Integer({ minimum: 1, maximum: 100 }),
				total: count,
				next_cursor: nullable_string
			},
			STRICT
		),
		error: Type.Object(
			{
				error: Type.Object(
					{
						code: Type.String(),
						message: Type.String(),
						details: Type.Optional(
							Type.Array(
								Type.Object({ path: Type.Array(Type.String()), message: Type.String() }, STRICT)
							)
						)
					},
					STRICT
				)
			},
			STRICT
		),
		settings: Type.Object(
			{
				theme: one_of(['light', 'dark', 'system']),
				language: Type.String(),
				notifications: Type.Object(
					{
						email: Type.Boolean(),
						push: Type.Boolean(),
						digest: one_of(['daily', 'weekly', 'never'])
					},
					STRICT
				),
				timezone: Type.Optional(Type.String())
			},
			STRICT
		),
		address: Type.Object(
			{
				street: Type.String(),
				city: Type.String(),
				region: Type.Optional(Type.String()),
				postal_code: Type.String(),
				country: Type.String({ minLength: 2, maxLength: 2 })
			},
			STRICT
		),
		product: Type.Object(
			{
				id: Type.String(),
				name: Type.String(),
				price: money,
				currency: one_of(['usd', 'eur', 'gbp']),
				stock: count,
				categories: Type.Array(Type.String())
			},
			STRICT
		),
		order: Type.Object(
			{
				id: Type.String(),
				user_id: id,
				items: Type.Array(
					Type.Object({ product_id: Type.String(), quantity: id, unit_price: money }, STRICT)
				),
				status: one_of(['pending', 'paid', 'shipped', 'cancelled']),
				total: money
			},
			STRICT
		),
		event: Type.Union([
			Type.Object({ type: Type.Literal('login'), at: Type.Number(), ip: Type.String() }, STRICT),
			Type.Object({ type: Type.Literal('logout'), at: Type.Number() }, STRICT),
			Type.Object(
				{ type: Type.Literal('purchase'), at: Type.Number(), order_id: Type.String() },
				STRICT
			)
		])
	});
};
