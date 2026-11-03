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

export const scenario_extra_keys: ScenarioModule['scenario_extra_keys'] = scenario_object_flat;

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

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		s.array(
			s.object({
				id: s.number,
				name: s.string,
				email: s.string,
				active: s.boolean,
				role: s.optional(s.string),
				tags: s.array(s.string)
			})
		)
	);

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: s.Schema = s.variant('kind', [
		s.object({ kind: s.literal('intrinsic'), text: s.string }),
		s.object({
			kind: s.literal('literal'),
			value: s.union([s.string, s.number, s.boolean]),
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

// every schema parses its own key, whatever the others gave
const to_app_runner =
	(app: Record<string, s.AnySchema>): ScenarioRunner =>
	(value: any) => {
		let ok = true;
		for (const key in app) ok = s.parse(app[key]!, value[key]).ok && ok;
		return ok;
	};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = s.pipe(s.number, s.integer, s.min_value(1));
	const count = s.pipe(s.number, s.integer, s.min_value(0));
	const money = s.pipe(s.number, s.min_value(0));
	return to_app_runner({
		user: s.object({
			id,
			name: s.pipe(s.string, s.min_length(1), s.max_length(100)),
			email: s.pipe(s.string, s.regex(/^[^@\s]+@[^@\s]+$/)),
			role: s.one_of(['member', 'admin', 'owner']),
			created_at: s.string,
			avatar_url: s.optional(s.string)
		}),
		post: s.object({
			id,
			author_id: id,
			title: s.pipe(s.string, s.min_length(1), s.max_length(200)),
			body: s.string,
			tags: s.array(s.string),
			published: s.boolean,
			published_at: s.nullable(s.string)
		}),
		comment: s.object({
			id,
			post_id: id,
			author_id: id,
			body: s.pipe(s.string, s.min_length(1)),
			reply_to: s.optional(id)
		}),
		page: s.object({
			page: id,
			per_page: s.pipe(s.number, s.integer, s.min_value(1), s.max_value(100)),
			total: count,
			next_cursor: s.nullable(s.string)
		}),
		error: s.object({
			error: s.object({
				code: s.string,
				message: s.string,
				details: s.optional(s.array(s.object({ path: s.array(s.string), message: s.string })))
			})
		}),
		settings: s.object({
			theme: s.one_of(['light', 'dark', 'system']),
			language: s.string,
			notifications: s.object({
				email: s.boolean,
				push: s.boolean,
				digest: s.one_of(['daily', 'weekly', 'never'])
			}),
			timezone: s.optional(s.string)
		}),
		address: s.object({
			street: s.string,
			city: s.string,
			region: s.optional(s.string),
			postal_code: s.string,
			country: s.pipe(s.string, s.min_length(2), s.max_length(2))
		}),
		product: s.object({
			id: s.string,
			name: s.string,
			price: money,
			currency: s.one_of(['usd', 'eur', 'gbp']),
			stock: count,
			categories: s.array(s.string)
		}),
		order: s.object({
			id: s.string,
			user_id: id,
			items: s.array(s.object({ product_id: s.string, quantity: id, unit_price: money })),
			status: s.one_of(['pending', 'paid', 'shipped', 'cancelled']),
			total: money
		}),
		event: s.variant('type', [
			s.object({ type: s.literal('login'), at: s.number, ip: s.string }),
			s.object({ type: s.literal('logout'), at: s.number }),
			s.object({ type: s.literal('purchase'), at: s.number, order_id: s.string })
		])
	});
};
