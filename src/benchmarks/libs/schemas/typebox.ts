/**
 * The schemas of `../typebox.ts`, written again as builders a scenario's bundle
 * never reaches, with the library's guard over a schema and its parse where it
 * returns an output: what the guard regime of `npm run benchmark` runs, what
 * the type benchmark reads the inferred types of, and what
 * `src/test/benchmarks.test.ts` holds to the factories' verdicts, and to
 * their text. The factories keep their own text, so a scenario's bundle is its
 * schema and its one runner, and no bundle reaches a builder.
 *
 * @module
 */

// a builder's return type is what it infers, as a consumer's schema's is, which the type
// benchmark reads
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import Type, { type Static, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { ScenarioRunner } from '../../scenarios.ts';

/**
 * Whether a value matches, by the compiled validator's `Check`, which is what
 * the scenarios run too: it builds no issues and no output, so TypeBox has no
 * `to_output`.
 */
export const to_guard = (schema: TSchema): ScenarioRunner => {
	const validator = Compile(schema);
	return (value) => validator.Check(value);
};

const STRICT = { additionalProperties: false };

export const schema_string = () => Type.String();

export const schema_object_flat = () =>
	Type.Object({
		id: Type.Number(),
		name: Type.String(),
		email: Type.String(),
		active: Type.Boolean(),
		role: Type.Optional(Type.String())
	});

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () =>
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
	);

export const schema_pipe = () =>
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 50 }),
		age: Type.Integer({ minimum: 0, maximum: 150 }),
		slug: Type.String({ pattern: '^[a-z0-9-]+$' })
	});

export const schema_union = () =>
	Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]));

export const schema_list = () =>
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
	);

export const schema_type_json = () => {
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
	return Type.Cyclic(
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
	);
};

export const schema_app = () => {
	const id = Type.Integer({ minimum: 1 });
	const count = Type.Integer({ minimum: 0 });
	const money = Type.Number({ minimum: 0 });
	const nullable_string = Type.Union([Type.String(), Type.Null()]);
	const one_of = (values: Array<string>): TSchema =>
		Type.Union(values.map((value) => Type.Literal(value)));
	return {
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
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: Static<ReturnType<typeof schema_string>>;
	object_flat: Static<ReturnType<typeof schema_object_flat>>;
	strict_nested: Static<ReturnType<typeof schema_strict_nested>>;
	pipe: Static<ReturnType<typeof schema_pipe>>;
	union: Static<ReturnType<typeof schema_union>>;
	list: Static<ReturnType<typeof schema_list>>;
}
