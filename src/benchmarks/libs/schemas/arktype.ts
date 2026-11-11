/**
 * The schemas of `../arktype.ts`, written again as builders a scenario's bundle
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

import { scope, type, type Type } from 'arktype';

import type { ScenarioRunner } from '../../scenarios.ts';
import type { ScenarioOutput } from '../../scenario_schemas.ts';

/** Whether a value matches, by `allows`, which returns a boolean and no errors or output. */
export const to_guard =
	(schema: Type): ScenarioRunner =>
	(value) =>
		schema.allows(value);

/** What a call of the type returns, for a test to hold the libraries to one output. */
export const to_output =
	(schema: Type) =>
	(value: unknown): ScenarioOutput => {
		const result = schema(value);
		return result instanceof type.errors ? { ok: false } : { ok: true, value: result };
	};

export const schema_string = () => type('string');

// arktype keeps a key the schema doesn't name by default, and with
// `'+': 'delete'` drops it, as the others' objects here do. That makes the
// type a morph, and a morph's call deep-clones its input before it runs
// (`@ark/schema`'s `clone` default), so these rows are a clone and a parse:
// its guard, `allows`, clones nothing, and is where its speed on the shape shows
export const schema_object_flat = () =>
	type({
		'+': 'delete',
		id: 'number',
		name: 'string',
		email: 'string',
		active: 'boolean',
		'role?': 'string'
	});

export const schema_extra_keys = schema_object_flat;

export const schema_strict_nested = () =>
	type({
		'+': 'reject',
		id: 'number',
		name: 'string',
		tags: 'string[]',
		address: { '+': 'reject', street: 'string', city: 'string', zip: 'string' }
	});

export const schema_pipe = () =>
	type({
		'+': 'delete',
		name: '1 <= string <= 50',
		age: '0 <= number.integer <= 150',
		slug: /^[a-z0-9-]+$/
	});

export const schema_union = () => type('(string | number | boolean)[]');

export const schema_list = () =>
	type({
		'+': 'reject',
		id: 'number',
		name: 'string',
		email: 'string',
		active: 'boolean',
		'role?': 'string',
		tags: 'string[]'
	}).array();

export const schema_type_json = () =>
	scope({
		type_json:
			'intrinsic | literal | reference | array | tuple | union | intersection | function | object | other',
		intrinsic: { '+': 'reject', kind: "'intrinsic'", text: 'string' },
		literal: {
			'+': 'reject',
			kind: "'literal'",
			value: 'string | number | boolean',
			text: 'string'
		},
		reference: {
			'+': 'reject',
			kind: "'reference'",
			name: 'string',
			'module?': 'string',
			'typeArgs?': 'type_json[]'
		},
		array: { '+': 'reject', kind: "'array'", element: 'type_json', 'readonly?': 'boolean' },
		tuple: {
			'+': 'reject',
			kind: "'tuple'",
			'elements?': 'tuple_element[]',
			'readonly?': 'boolean'
		},
		union: { '+': 'reject', kind: "'union'", 'alias?': 'string', members: 'type_json[]' },
		intersection: {
			'+': 'reject',
			kind: "'intersection'",
			'alias?': 'string',
			members: 'type_json[]'
		},
		function: { '+': 'reject', kind: "'function'", text: 'string' },
		object: { '+': 'reject', kind: "'object'", text: 'string' },
		other: { '+': 'reject', kind: "'other'", text: 'string' },
		tuple_element: {
			'+': 'reject',
			'name?': 'string',
			type: 'type_json',
			'optional?': 'boolean',
			'rest?': 'boolean'
		}
	}).export().type_json as unknown as Type;

export const schema_app = () => {
	const app = scope({
		id: 'number.integer >= 1',
		count: 'number.integer >= 0',
		money: 'number >= 0',
		user: {
			'+': 'reject',
			id: 'id',
			name: '1 <= string <= 100',
			email: /^[^@\s]+@[^@\s]+$/,
			role: "'member' | 'admin' | 'owner'",
			created_at: 'string',
			'avatar_url?': 'string'
		},
		post: {
			'+': 'reject',
			id: 'id',
			author_id: 'id',
			title: '1 <= string <= 200',
			body: 'string',
			tags: 'string[]',
			published: 'boolean',
			published_at: 'string | null'
		},
		comment: {
			'+': 'reject',
			id: 'id',
			post_id: 'id',
			author_id: 'id',
			body: 'string >= 1',
			'reply_to?': 'id'
		},
		page: {
			'+': 'reject',
			page: 'id',
			per_page: '1 <= number.integer <= 100',
			total: 'count',
			next_cursor: 'string | null'
		},
		detail: { '+': 'reject', path: 'string[]', message: 'string' },
		error: {
			'+': 'reject',
			error: { '+': 'reject', code: 'string', message: 'string', 'details?': 'detail[]' }
		},
		settings: {
			'+': 'reject',
			theme: "'light' | 'dark' | 'system'",
			language: 'string',
			notifications: {
				'+': 'reject',
				email: 'boolean',
				push: 'boolean',
				digest: "'daily' | 'weekly' | 'never'"
			},
			'timezone?': 'string'
		},
		address: {
			'+': 'reject',
			street: 'string',
			city: 'string',
			'region?': 'string',
			postal_code: 'string',
			country: 'string == 2'
		},
		product: {
			'+': 'reject',
			id: 'string',
			name: 'string',
			price: 'money',
			currency: "'usd' | 'eur' | 'gbp'",
			stock: 'count',
			categories: 'string[]'
		},
		item: { '+': 'reject', product_id: 'string', quantity: 'id', unit_price: 'money' },
		order: {
			'+': 'reject',
			id: 'string',
			user_id: 'id',
			items: 'item[]',
			status: "'pending' | 'paid' | 'shipped' | 'cancelled'",
			total: 'money'
		},
		login: { '+': 'reject', type: "'login'", at: 'number', ip: 'string' },
		logout: { '+': 'reject', type: "'logout'", at: 'number' },
		purchase: { '+': 'reject', type: "'purchase'", at: 'number', order_id: 'string' },
		event: 'login | logout | purchase'
	}).export() as unknown as Record<string, Type>;
	// the aliases the others are built of are no schema of the app
	const { user, post, comment, page, error, settings, address, product, order, event } = app;
	return {
		user: user!,
		post: post!,
		comment: comment!,
		page: page!,
		error: error!,
		settings: settings!,
		address: address!,
		product: product!,
		order: order!,
		event: event!
	};
};

/**
 * What a consumer infers of the schemas that are typed by what they are
 * built of, which the type benchmark reads properties of. `type_json` is
 * declared with a wide type to be recursive, and `app` is left out.
 */
export interface ScenarioTypes {
	string: ReturnType<typeof schema_string>['infer'];
	object_flat: ReturnType<typeof schema_object_flat>['infer'];
	strict_nested: ReturnType<typeof schema_strict_nested>['infer'];
	pipe: ReturnType<typeof schema_pipe>['infer'];
	union: ReturnType<typeof schema_union>['infer'];
	list: ReturnType<typeof schema_list>['infer'];
}
