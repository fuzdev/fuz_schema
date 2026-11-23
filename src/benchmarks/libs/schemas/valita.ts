/**
 * The schemas of `../valita.ts`, written again as builders a scenario's bundle
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

import * as v from '@badrap/valita';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';

const STRIP: v.ParseOptions = { mode: 'strip' };

// the schemas whose scenario drops a key the schema doesn't name, which valita is told
// in each parse and not in the schema
const STRIPPED: WeakSet<v.Type> = new WeakSet();

/** Marks `schema` as one whose parses drop a key it doesn't name, as its factory's runner does. */
export const to_strip = <T extends v.Type>(schema: T): T => {
	STRIPPED.add(schema);
	return schema;
};

/**
 * Whether a value matches. valita has no guard apart from its parse, which
 * returns the input itself where nothing changed.
 */
export const to_guard = (schema: v.Type): ScenarioRunner => {
	const options = STRIPPED.has(schema) ? STRIP : undefined;
	return (value) => schema.try(value, options).ok;
};

/** What `try` returns, for a test to hold the libraries to one output. */
export const to_output = (schema: v.Type) => {
	const options = STRIPPED.has(schema) ? STRIP : undefined;
	return (value: unknown): ScenarioOutput => {
		const result = schema.try(value, options);
		return result.ok ? { ok: true, value: result.value } : { ok: false };
	};
};

export const schema_string = () => v.string();

export const schema_object_flat = () =>
	to_strip(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string(),
			active: v.boolean(),
			role: v.string().optional()
		})
	);

export const schema_object_copy = () =>
	to_strip(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string().map((value) => value.toLowerCase()),
			role: v.union(v.literal('member'), v.literal('admin')).optional(() => 'member')
		})
	);

export const schema_strict_nested = () =>
	v.object({
		id: v.number(),
		name: v.string(),
		tags: v.array(v.string()),
		address: v.object({ street: v.string(), city: v.string(), zip: v.string() })
	});

export const schema_pipe = () =>
	to_strip(
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

export const schema_union = () => v.array(v.union(v.string(), v.number(), v.boolean()));

export const schema_list = () =>
	v.array(
		v.object({
			id: v.number(),
			name: v.string(),
			email: v.string(),
			active: v.boolean(),
			role: v.string().optional(),
			tags: v.array(v.string())
		})
	);

// svelte-docinfo's `TypeJson` and `TupleElementJson`, verbatim: a `union` of objects told
// apart by a literal key finds its option by that key
export const schema_type_json = () => {
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
	return TypeJson;
};

export const schema_app = () => {
	const id = v
		.number()
		.assert(Number.isInteger)
		.assert((value) => value >= 1);
	const count = v
		.number()
		.assert(Number.isInteger)
		.assert((value) => value >= 0);
	const money = v.number().assert((value) => value >= 0);
	return {
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
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: v.Infer<ReturnType<typeof schema_string>>;
	object_flat: v.Infer<ReturnType<typeof schema_object_flat>>;
	strict_nested: v.Infer<ReturnType<typeof schema_strict_nested>>;
	pipe: v.Infer<ReturnType<typeof schema_pipe>>;
	union: v.Infer<ReturnType<typeof schema_union>>;
	list: v.Infer<ReturnType<typeof schema_list>>;
}
