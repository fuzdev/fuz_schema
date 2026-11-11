/**
 * The schemas of `../fuz_schema.ts`, written again as builders a scenario's bundle
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

import * as s from '#lib/schema.ts';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';

/** Whether a value matches, by `is`, which builds no issues and no output. */
export const to_guard =
	(schema: s.AnySchema): ScenarioRunner =>
	(value) =>
		s.is(schema, value);

/** What `parse` returns, for a test to hold the libraries to one output. */
export const to_output =
	(schema: s.AnySchema) =>
	(value: unknown): ScenarioOutput => {
		const result = s.parse(schema, value);
		return result.ok ? { ok: true, value: result.value } : { ok: false };
	};

export const schema_string = () => s.string;

export const schema_object_flat = () =>
	s.strip_object({
		id: s.number,
		name: s.string,
		email: s.string,
		active: s.boolean,
		role: s.optional(s.string)
	});

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () =>
	s.object({
		id: s.number,
		name: s.string,
		tags: s.array(s.string),
		address: s.object({ street: s.string, city: s.string, zip: s.string })
	});

export const schema_pipe = () =>
	s.strip_object({
		name: s.pipe(s.string, s.min_length(1), s.max_length(50)),
		age: s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150)),
		slug: s.pipe(s.string, s.regex(/^[a-z0-9-]+$/))
	});

export const schema_union = () => s.array(s.union([s.string, s.number, s.boolean]));

export const schema_list = () =>
	s.array(
		s.object({
			id: s.number,
			name: s.string,
			email: s.string,
			active: s.boolean,
			role: s.optional(s.string),
			tags: s.array(s.string)
		})
	);

export const schema_type_json = () => {
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
	return TypeJson;
};

export const schema_app = () => {
	const id = s.pipe(s.number, s.integer, s.min_value(1));
	const count = s.pipe(s.number, s.integer, s.min_value(0));
	const money = s.pipe(s.number, s.min_value(0));
	return {
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
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: s.Infer<ReturnType<typeof schema_string>>;
	object_flat: s.Infer<ReturnType<typeof schema_object_flat>>;
	strict_nested: s.Infer<ReturnType<typeof schema_strict_nested>>;
	pipe: s.Infer<ReturnType<typeof schema_pipe>>;
	union: s.Infer<ReturnType<typeof schema_union>>;
	list: s.Infer<ReturnType<typeof schema_list>>;
}
