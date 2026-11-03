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

export const scenario_extra_keys: ScenarioModule['scenario_extra_keys'] = scenario_object_flat;

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

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		z.array(
			z.strictObject({
				id: z.number(),
				name: z.string(),
				email: z.string(),
				active: z.boolean(),
				role: z.optional(z.string()),
				tags: z.array(z.string())
			})
		)
	);

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

// every schema parses its own key, whatever the others gave
const to_app_runner =
	(app: Record<string, z.ZodMiniType>): ScenarioRunner =>
	(value: any) => {
		let ok = true;
		for (const key in app) ok = z.safeParse(app[key]!, value[key]).success && ok;
		return ok;
	};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = z.int().check(z.gte(1));
	const count = z.int().check(z.gte(0));
	const money = z.number().check(z.gte(0));
	return to_app_runner({
		user: z.strictObject({
			id,
			name: z.string().check(z.minLength(1), z.maxLength(100)),
			email: z.string().check(z.regex(/^[^@\s]+@[^@\s]+$/)),
			role: z.enum(['member', 'admin', 'owner']),
			created_at: z.string(),
			avatar_url: z.optional(z.string())
		}),
		post: z.strictObject({
			id,
			author_id: id,
			title: z.string().check(z.minLength(1), z.maxLength(200)),
			body: z.string(),
			tags: z.array(z.string()),
			published: z.boolean(),
			published_at: z.nullable(z.string())
		}),
		comment: z.strictObject({
			id,
			post_id: id,
			author_id: id,
			body: z.string().check(z.minLength(1)),
			reply_to: z.optional(id)
		}),
		page: z.strictObject({
			page: id,
			per_page: z.int().check(z.gte(1), z.lte(100)),
			total: count,
			next_cursor: z.nullable(z.string())
		}),
		error: z.strictObject({
			error: z.strictObject({
				code: z.string(),
				message: z.string(),
				details: z.optional(
					z.array(z.strictObject({ path: z.array(z.string()), message: z.string() }))
				)
			})
		}),
		settings: z.strictObject({
			theme: z.enum(['light', 'dark', 'system']),
			language: z.string(),
			notifications: z.strictObject({
				email: z.boolean(),
				push: z.boolean(),
				digest: z.enum(['daily', 'weekly', 'never'])
			}),
			timezone: z.optional(z.string())
		}),
		address: z.strictObject({
			street: z.string(),
			city: z.string(),
			region: z.optional(z.string()),
			postal_code: z.string(),
			country: z.string().check(z.minLength(2), z.maxLength(2))
		}),
		product: z.strictObject({
			id: z.string(),
			name: z.string(),
			price: money,
			currency: z.enum(['usd', 'eur', 'gbp']),
			stock: count,
			categories: z.array(z.string())
		}),
		order: z.strictObject({
			id: z.string(),
			user_id: id,
			items: z.array(z.strictObject({ product_id: z.string(), quantity: id, unit_price: money })),
			status: z.enum(['pending', 'paid', 'shipped', 'cancelled']),
			total: money
		}),
		event: z.discriminatedUnion('type', [
			z.strictObject({ type: z.literal('login'), at: z.number(), ip: z.string() }),
			z.strictObject({ type: z.literal('logout'), at: z.number() }),
			z.strictObject({ type: z.literal('purchase'), at: z.number(), order_id: z.string() })
		])
	});
};
