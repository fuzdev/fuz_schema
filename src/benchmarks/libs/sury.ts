import * as S from 'sury';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

// sury compiles an operation of a schema the first time it is asked for, here as the
// schema is built, so no parse pays for it
const to_runner = (schema: S.Schema): ScenarioRunner => {
	const parse = S.parseAsResult(schema);
	return (value) => parse(value).success;
};

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(S.string);

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		S.schema({
			id: S.number,
			name: S.string,
			email: S.string,
			active: S.boolean,
			role: S.optional(S.string)
		})
	);

export const scenario_object_copy: ScenarioModule['scenario_object_copy'] = () =>
	to_runner(
		S.schema({
			id: S.number,
			name: S.string,
			email: S.string.with(S.to, S.string, {
				decode: (value) => value.toLowerCase(),
				encode: 'auto'
			}),
			role: S.optional(S.union(['member', 'admin']), 'member')
		})
	);

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		S.strict(
			S.schema({
				id: S.number,
				name: S.string,
				tags: S.array(S.string),
				address: S.strict(S.schema({ street: S.string, city: S.string, zip: S.string }))
			})
		)
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		S.schema({
			name: S.string.with(S.minLength, 1).with(S.maxLength, 50),
			age: S.integer.with(S.gte, 0).with(S.lte, 150),
			slug: S.string.with(S.pattern, /^[a-z0-9-]+$/)
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(S.array(S.union([S.string, S.number, S.boolean])));

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		S.array(
			S.strict(
				S.schema({
					id: S.number,
					name: S.string,
					email: S.string,
					active: S.boolean,
					role: S.optional(S.string),
					tags: S.array(S.string)
				})
			)
		)
	);

// svelte-docinfo's `TypeJson`, with its `TupleElementJson` written in place, as
// `recursive` hands back the one schema: a `union` of objects told apart by a literal key
// finds its option by that key
export const scenario_type_json: ScenarioModule['scenario_type_json'] = () =>
	to_runner(
		S.recursive('TypeJson', (TypeJson) =>
			S.union([
				S.strict(S.schema({ kind: 'intrinsic', text: S.string })),
				S.strict(
					S.schema({
						kind: 'literal',
						value: S.union([S.string, S.number.with(S.refine, Number.isFinite), S.boolean]),
						text: S.string
					})
				),
				S.strict(
					S.schema({
						kind: 'reference',
						name: S.string,
						module: S.optional(S.string),
						typeArgs: S.optional(S.array(TypeJson))
					})
				),
				S.strict(S.schema({ kind: 'array', element: TypeJson, readonly: S.optional(S.boolean) })),
				S.strict(
					S.schema({
						kind: 'tuple',
						elements: S.optional(
							S.array(
								S.strict(
									S.schema({
										name: S.optional(S.string),
										type: TypeJson,
										optional: S.optional(S.boolean),
										rest: S.optional(S.boolean)
									})
								)
							)
						),
						readonly: S.optional(S.boolean)
					})
				),
				S.strict(
					S.schema({ kind: 'union', alias: S.optional(S.string), members: S.array(TypeJson) })
				),
				S.strict(
					S.schema({
						kind: 'intersection',
						alias: S.optional(S.string),
						members: S.array(TypeJson)
					})
				),
				S.strict(S.schema({ kind: 'function', text: S.string })),
				S.strict(S.schema({ kind: 'object', text: S.string })),
				S.strict(S.schema({ kind: 'other', text: S.string }))
			])
		)
	);

// every schema parses its own key, whatever the others gave
const to_app_runner = (app: Record<string, S.Schema>): ScenarioRunner => {
	const parses = Object.entries(app).map(
		([key, schema]) => [key, S.parseAsResult(schema)] as const
	);
	return (value: any) => {
		let ok = true;
		for (const [key, parse] of parses) ok = parse(value[key]).success && ok;
		return ok;
	};
};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = S.integer.with(S.gte, 1);
	const count = S.integer.with(S.gte, 0);
	const money = S.number.with(S.gte, 0);
	return to_app_runner({
		user: S.strict(
			S.schema({
				id,
				name: S.string.with(S.minLength, 1).with(S.maxLength, 100),
				email: S.string.with(S.pattern, /^[^@\s]+@[^@\s]+$/),
				role: S.union(['member', 'admin', 'owner']),
				created_at: S.string,
				avatar_url: S.optional(S.string)
			})
		),
		post: S.strict(
			S.schema({
				id,
				author_id: id,
				title: S.string.with(S.minLength, 1).with(S.maxLength, 200),
				body: S.string,
				tags: S.array(S.string),
				published: S.boolean,
				published_at: S.nullable(S.string)
			})
		),
		comment: S.strict(
			S.schema({
				id,
				post_id: id,
				author_id: id,
				body: S.string.with(S.minLength, 1),
				reply_to: S.optional(id)
			})
		),
		page: S.strict(
			S.schema({
				page: id,
				per_page: S.integer.with(S.gte, 1).with(S.lte, 100),
				total: count,
				next_cursor: S.nullable(S.string)
			})
		),
		error: S.strict(
			S.schema({
				error: S.strict(
					S.schema({
						code: S.string,
						message: S.string,
						details: S.optional(
							S.array(S.strict(S.schema({ path: S.array(S.string), message: S.string })))
						)
					})
				)
			})
		),
		settings: S.strict(
			S.schema({
				theme: S.union(['light', 'dark', 'system']),
				language: S.string,
				notifications: S.strict(
					S.schema({
						email: S.boolean,
						push: S.boolean,
						digest: S.union(['daily', 'weekly', 'never'])
					})
				),
				timezone: S.optional(S.string)
			})
		),
		address: S.strict(
			S.schema({
				street: S.string,
				city: S.string,
				region: S.optional(S.string),
				postal_code: S.string,
				country: S.string.with(S.minLength, 2).with(S.maxLength, 2)
			})
		),
		product: S.strict(
			S.schema({
				id: S.string,
				name: S.string,
				price: money,
				currency: S.union(['usd', 'eur', 'gbp']),
				stock: count,
				categories: S.array(S.string)
			})
		),
		order: S.strict(
			S.schema({
				id: S.string,
				user_id: id,
				items: S.array(
					S.strict(S.schema({ product_id: S.string, quantity: id, unit_price: money }))
				),
				status: S.union(['pending', 'paid', 'shipped', 'cancelled']),
				total: money
			})
		),
		event: S.union([
			S.strict(S.schema({ type: 'login', at: S.number, ip: S.string })),
			S.strict(S.schema({ type: 'logout', at: S.number })),
			S.strict(S.schema({ type: 'purchase', at: S.number, order_id: S.string }))
		])
	});
};
