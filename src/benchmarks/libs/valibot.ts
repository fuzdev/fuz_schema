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

export const scenario_extra_keys: ScenarioModule['scenario_extra_keys'] = scenario_object_flat;

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

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		v.array(
			v.strictObject({
				id: v.number(),
				name: v.string(),
				email: v.string(),
				active: v.boolean(),
				role: v.optional(v.string()),
				tags: v.array(v.string())
			})
		)
	);

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

// every schema parses its own key, whatever the others gave
const to_app_runner =
	(app: Record<string, v.GenericSchema>): ScenarioRunner =>
	(value: any) => {
		let ok = true;
		for (const key in app) ok = v.safeParse(app[key]!, value[key]).success && ok;
		return ok;
	};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = v.pipe(v.number(), v.integer(), v.minValue(1));
	const count = v.pipe(v.number(), v.integer(), v.minValue(0));
	const money = v.pipe(v.number(), v.minValue(0));
	return to_app_runner({
		user: v.strictObject({
			id,
			name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
			email: v.pipe(v.string(), v.regex(/^[^@\s]+@[^@\s]+$/)),
			role: v.picklist(['member', 'admin', 'owner']),
			created_at: v.string(),
			avatar_url: v.optional(v.string())
		}),
		post: v.strictObject({
			id,
			author_id: id,
			title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
			body: v.string(),
			tags: v.array(v.string()),
			published: v.boolean(),
			published_at: v.nullable(v.string())
		}),
		comment: v.strictObject({
			id,
			post_id: id,
			author_id: id,
			body: v.pipe(v.string(), v.minLength(1)),
			reply_to: v.optional(id)
		}),
		page: v.strictObject({
			page: id,
			per_page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
			total: count,
			next_cursor: v.nullable(v.string())
		}),
		error: v.strictObject({
			error: v.strictObject({
				code: v.string(),
				message: v.string(),
				details: v.optional(
					v.array(v.strictObject({ path: v.array(v.string()), message: v.string() }))
				)
			})
		}),
		settings: v.strictObject({
			theme: v.picklist(['light', 'dark', 'system']),
			language: v.string(),
			notifications: v.strictObject({
				email: v.boolean(),
				push: v.boolean(),
				digest: v.picklist(['daily', 'weekly', 'never'])
			}),
			timezone: v.optional(v.string())
		}),
		address: v.strictObject({
			street: v.string(),
			city: v.string(),
			region: v.optional(v.string()),
			postal_code: v.string(),
			country: v.pipe(v.string(), v.minLength(2), v.maxLength(2))
		}),
		product: v.strictObject({
			id: v.string(),
			name: v.string(),
			price: money,
			currency: v.picklist(['usd', 'eur', 'gbp']),
			stock: count,
			categories: v.array(v.string())
		}),
		order: v.strictObject({
			id: v.string(),
			user_id: id,
			items: v.array(v.strictObject({ product_id: v.string(), quantity: id, unit_price: money })),
			status: v.picklist(['pending', 'paid', 'shipped', 'cancelled']),
			total: money
		}),
		event: v.variant('type', [
			v.strictObject({ type: v.literal('login'), at: v.number(), ip: v.string() }),
			v.strictObject({ type: v.literal('logout'), at: v.number() }),
			v.strictObject({ type: v.literal('purchase'), at: v.number(), order_id: v.string() })
		])
	});
};
