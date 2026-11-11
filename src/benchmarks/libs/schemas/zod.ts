/**
 * The schemas of `../zod.ts`, written again as builders a scenario's bundle
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

import * as z from 'zod';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';

/**
 * Whether a value matches, by `z.validate`, which returns a boolean and not
 * the output. These schemas are not through `z.compile`, so it runs the
 * parser, which still copies what it reads and drops the copy.
 */
export const to_guard =
	(schema: z.ZodType): ScenarioRunner =>
	(value) =>
		z.validate(schema, value);

/** What `safeParse` returns, for a test to hold the libraries to one output. */
export const to_output =
	(schema: z.ZodType) =>
	(value: unknown): ScenarioOutput => {
		const result = schema.safeParse(value);
		return result.success ? { ok: true, value: result.data } : { ok: false };
	};

export const schema_string = () => z.string();

export const schema_object_flat = () =>
	z.object({
		id: z.number(),
		name: z.string(),
		email: z.string(),
		active: z.boolean(),
		role: z.optional(z.string())
	});

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () =>
	z.strictObject({
		id: z.number(),
		name: z.string(),
		tags: z.array(z.string()),
		address: z.strictObject({ street: z.string(), city: z.string(), zip: z.string() })
	});

export const schema_pipe = () =>
	z.object({
		name: z.string().min(1).max(50),
		age: z.int().min(0).max(150),
		slug: z.string().regex(/^[a-z0-9-]+$/)
	});

export const schema_union = () => z.array(z.union([z.string(), z.number(), z.boolean()]));

export const schema_list = () =>
	z.array(
		z.strictObject({
			id: z.number(),
			name: z.string(),
			email: z.string(),
			active: z.boolean(),
			role: z.optional(z.string()),
			tags: z.array(z.string())
		})
	);

export const schema_type_json = () => {
	const TypeJson: z.ZodType = z.discriminatedUnion('kind', [
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
	const TupleElementJson: z.ZodType = z.strictObject({
		name: z.optional(z.string()),
		type: TypeJson,
		optional: z.optional(z.boolean()),
		rest: z.optional(z.boolean())
	});
	return TypeJson;
};

export const schema_app = () => {
	const id = z.int().min(1);
	const count = z.int().min(0);
	const money = z.number().min(0);
	return {
		user: z.strictObject({
			id,
			name: z.string().min(1).max(100),
			email: z.string().regex(/^[^@\s]+@[^@\s]+$/),
			role: z.enum(['member', 'admin', 'owner']),
			created_at: z.string(),
			avatar_url: z.optional(z.string())
		}),
		post: z.strictObject({
			id,
			author_id: id,
			title: z.string().min(1).max(200),
			body: z.string(),
			tags: z.array(z.string()),
			published: z.boolean(),
			published_at: z.nullable(z.string())
		}),
		comment: z.strictObject({
			id,
			post_id: id,
			author_id: id,
			body: z.string().min(1),
			reply_to: z.optional(id)
		}),
		page: z.strictObject({
			page: id,
			per_page: z.int().min(1).max(100),
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
			country: z.string().min(2).max(2)
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
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: z.infer<ReturnType<typeof schema_string>>;
	object_flat: z.infer<ReturnType<typeof schema_object_flat>>;
	strict_nested: z.infer<ReturnType<typeof schema_strict_nested>>;
	pipe: z.infer<ReturnType<typeof schema_pipe>>;
	union: z.infer<ReturnType<typeof schema_union>>;
	list: z.infer<ReturnType<typeof schema_list>>;
}
