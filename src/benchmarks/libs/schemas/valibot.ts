/**
 * The schemas of `../valibot.ts`, written again as builders a scenario's bundle
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

import * as v from 'valibot';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';

/**
 * Whether a value matches, by `is`, which runs the parser to its first issue
 * and returns whether there was one: the copy it builds is dropped.
 */
export const to_guard =
	(schema: v.GenericSchema): ScenarioRunner =>
	(value) =>
		v.is(schema, value);

/** What `safeParse` returns, for a test to hold the libraries to one output. */
export const to_output =
	(schema: v.GenericSchema) =>
	(value: unknown): ScenarioOutput => {
		const result = v.safeParse(schema, value);
		return result.success ? { ok: true, value: result.output } : { ok: false };
	};

export const schema_string = () => v.string();

export const schema_object_flat = () =>
	v.object({
		id: v.number(),
		name: v.string(),
		email: v.string(),
		active: v.boolean(),
		role: v.optional(v.string())
	});

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () =>
	v.strictObject({
		id: v.number(),
		name: v.string(),
		tags: v.array(v.string()),
		address: v.strictObject({ street: v.string(), city: v.string(), zip: v.string() })
	});

export const schema_pipe = () =>
	v.object({
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
		age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
		slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))
	});

export const schema_union = () => v.array(v.union([v.string(), v.number(), v.boolean()]));

export const schema_list = () =>
	v.array(
		v.strictObject({
			id: v.number(),
			name: v.string(),
			email: v.string(),
			active: v.boolean(),
			role: v.optional(v.string()),
			tags: v.array(v.string())
		})
	);

// svelte-docinfo's `TypeJson` and `TupleElementJson`, verbatim
export const schema_type_json = () => {
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
	return TypeJson;
};

export const schema_app = () => {
	const id = v.pipe(v.number(), v.integer(), v.minValue(1));
	const count = v.pipe(v.number(), v.integer(), v.minValue(0));
	const money = v.pipe(v.number(), v.minValue(0));
	return {
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
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: v.InferOutput<ReturnType<typeof schema_string>>;
	object_flat: v.InferOutput<ReturnType<typeof schema_object_flat>>;
	strict_nested: v.InferOutput<ReturnType<typeof schema_strict_nested>>;
	pipe: v.InferOutput<ReturnType<typeof schema_pipe>>;
	union: v.InferOutput<ReturnType<typeof schema_union>>;
	list: v.InferOutput<ReturnType<typeof schema_list>>;
}
