import * as v from '@badrap/valita';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

// valita takes what to do with a key the schema doesn't name as an option of a parse, and
// refuses one by default
const to_runner =
	(schema: v.Type): ScenarioRunner =>
	(value) =>
		schema.try(value).ok;

const STRIP: v.ParseOptions = { mode: 'strip' };

// the same for a schema whose scenario drops such a key
const to_strip_runner =
	(schema: v.Type): ScenarioRunner =>
	(value) =>
		schema.try(value, STRIP).ok;

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(v.string());

export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_strip_runner(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string(),
			active: v.boolean(),
			role: v.string().optional()
		})
	);

export const scenario_object_copy: ScenarioModule['scenario_object_copy'] = () =>
	to_strip_runner(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string().map((value) => value.toLowerCase()),
			role: v.union(v.literal('member'), v.literal('admin')).optional(() => 'member')
		})
	);

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		v.object({
			id: v.number(),
			name: v.string(),
			tags: v.array(v.string()),
			address: v.object({ street: v.string(), city: v.string(), zip: v.string() })
		})
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_strip_runner(
		v.object({
			name: v
				.string()
				.assert((value) => value.length >= 1)
				.assert((value) => value.length <= 50),
			age: v
				.number()
				.assert(Number.isInteger)
				.assert((value) => value >= 0)
				.assert((value) => value <= 150),
			slug: v.string().assert((value) => /^[a-z0-9-]+$/.test(value))
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(v.array(v.union(v.string(), v.number(), v.boolean())));

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		v.array(
			v.object({
				id: v.number(),
				name: v.string(),
				email: v.string(),
				active: v.boolean(),
				role: v.string().optional(),
				tags: v.array(v.string())
			})
		)
	);

// svelte-docinfo's `TypeJson` and `TupleElementJson`, verbatim: a `union` of objects told
// apart by a literal key finds its option by that key
export const scenario_type_json: ScenarioModule['scenario_type_json'] = () => {
	const TypeJson: v.Type = v.union(
		v.object({ kind: v.literal('intrinsic'), text: v.string() }),
		v.object({
			kind: v.literal('literal'),
			value: v.union(v.string(), v.number().assert(Number.isFinite), v.boolean()),
			text: v.string()
		}),
		v.object({
			kind: v.literal('reference'),
			name: v.string(),
			module: v.string().optional(),
			typeArgs: v.array(v.lazy(() => TypeJson)).optional()
		}),
		v.object({
			kind: v.literal('array'),
			element: v.lazy(() => TypeJson),
			readonly: v.boolean().optional()
		}),
		v.object({
			kind: v.literal('tuple'),
			elements: v.array(v.lazy(() => TupleElementJson)).optional(),
			readonly: v.boolean().optional()
		}),
		v.object({
			kind: v.literal('union'),
			alias: v.string().optional(),
			members: v.array(v.lazy(() => TypeJson))
		}),
		v.object({
			kind: v.literal('intersection'),
			alias: v.string().optional(),
			members: v.array(v.lazy(() => TypeJson))
		}),
		v.object({ kind: v.literal('function'), text: v.string() }),
		v.object({ kind: v.literal('object'), text: v.string() }),
		v.object({ kind: v.literal('other'), text: v.string() })
	);
	const TupleElementJson: v.Type = v.object({
		name: v.string().optional(),
		type: TypeJson,
		optional: v.boolean().optional(),
		rest: v.boolean().optional()
	});
	return to_runner(TypeJson);
};

// every schema parses its own key, whatever the others gave
const to_app_runner =
	(app: Record<string, v.Type>): ScenarioRunner =>
	(value: any) => {
		let ok = true;
		for (const key in app) ok = app[key]!.try(value[key]).ok && ok;
		return ok;
	};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
	const id = v
		.number()
		.assert(Number.isInteger)
		.assert((value) => value >= 1);
	const count = v
		.number()
		.assert(Number.isInteger)
		.assert((value) => value >= 0);
	const money = v.number().assert((value) => value >= 0);
	return to_app_runner({
		user: v.object({
			id,
			name: v
				.string()
				.assert((value) => value.length >= 1)
				.assert((value) => value.length <= 100),
			email: v.string().assert((value) => /^[^@\s]+@[^@\s]+$/.test(value)),
			role: v.union(v.literal('member'), v.literal('admin'), v.literal('owner')),
			created_at: v.string(),
			avatar_url: v.string().optional()
		}),
		post: v.object({
			id,
			author_id: id,
			title: v
				.string()
				.assert((value) => value.length >= 1)
				.assert((value) => value.length <= 200),
			body: v.string(),
			tags: v.array(v.string()),
			published: v.boolean(),
			published_at: v.string().nullable()
		}),
		comment: v.object({
			id,
			post_id: id,
			author_id: id,
			body: v.string().assert((value) => value.length >= 1),
			reply_to: id.optional()
		}),
		page: v.object({
			page: id,
			per_page: v
				.number()
				.assert(Number.isInteger)
				.assert((value) => value >= 1)
				.assert((value) => value <= 100),
			total: count,
			next_cursor: v.string().nullable()
		}),
		error: v.object({
			error: v.object({
				code: v.string(),
				message: v.string(),
				details: v.array(v.object({ path: v.array(v.string()), message: v.string() })).optional()
			})
		}),
		settings: v.object({
			theme: v.union(v.literal('light'), v.literal('dark'), v.literal('system')),
			language: v.string(),
			notifications: v.object({
				email: v.boolean(),
				push: v.boolean(),
				digest: v.union(v.literal('daily'), v.literal('weekly'), v.literal('never'))
			}),
			timezone: v.string().optional()
		}),
		address: v.object({
			street: v.string(),
			city: v.string(),
			region: v.string().optional(),
			postal_code: v.string(),
			country: v
				.string()
				.assert((value) => value.length >= 2)
				.assert((value) => value.length <= 2)
		}),
		product: v.object({
			id: v.string(),
			name: v.string(),
			price: money,
			currency: v.union(v.literal('usd'), v.literal('eur'), v.literal('gbp')),
			stock: count,
			categories: v.array(v.string())
		}),
		order: v.object({
			id: v.string(),
			user_id: id,
			items: v.array(v.object({ product_id: v.string(), quantity: id, unit_price: money })),
			status: v.union(
				v.literal('pending'),
				v.literal('paid'),
				v.literal('shipped'),
				v.literal('cancelled')
			),
			total: money
		}),
		event: v.union(
			v.object({ type: v.literal('login'), at: v.number(), ip: v.string() }),
			v.object({ type: v.literal('logout'), at: v.number() }),
			v.object({ type: v.literal('purchase'), at: v.number(), order_id: v.string() })
		)
	});
};
