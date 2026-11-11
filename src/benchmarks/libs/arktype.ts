import { scope, type, type Type } from 'arktype';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: Type): ScenarioRunner =>
	(value) =>
		!(schema(value) instanceof type.errors);

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(type('string'));

// arktype keeps a key the schema doesn't name by default, and with
// `'+': 'delete'` drops it, as the others' objects here do. That makes the
// type a morph, and a morph's call deep-clones its input before it runs
// (`@ark/schema`'s `clone` default), so these rows are a clone and a parse:
// its guard, `allows`, clones nothing, and is where its speed on the shape shows
export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		type({
			'+': 'delete',
			id: 'number',
			name: 'string',
			email: 'string',
			active: 'boolean',
			'role?': 'string'
		})
	);

export const scenario_extra_keys: ScenarioModule['scenario_extra_keys'] = scenario_object_flat;

export const scenario_strict_nested: ScenarioModule['scenario_strict_nested'] = () =>
	to_runner(
		type({
			'+': 'reject',
			id: 'number',
			name: 'string',
			tags: 'string[]',
			address: { '+': 'reject', street: 'string', city: 'string', zip: 'string' }
		})
	);

export const scenario_pipe: ScenarioModule['scenario_pipe'] = () =>
	to_runner(
		type({
			'+': 'delete',
			name: '1 <= string <= 50',
			age: '0 <= number.integer <= 150',
			slug: /^[a-z0-9-]+$/
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(type('(string | number | boolean)[]'));

export const scenario_list: ScenarioModule['scenario_list'] = () =>
	to_runner(
		type({
			'+': 'reject',
			id: 'number',
			name: 'string',
			email: 'string',
			active: 'boolean',
			'role?': 'string',
			tags: 'string[]'
		}).array()
	);

export const scenario_type_json: ScenarioModule['scenario_type_json'] = () =>
	to_runner(
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
		}).export().type_json as unknown as Type
	);

// every schema parses its own key, whatever the others gave
const to_app_runner =
	(app: Record<string, Type>): ScenarioRunner =>
	(value: any) => {
		let ok = true;
		for (const key in app) ok = !(app[key]!(value[key]) instanceof type.errors) && ok;
		return ok;
	};

export const scenario_app: ScenarioModule['scenario_app'] = () => {
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
	return to_app_runner({
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
	});
};
