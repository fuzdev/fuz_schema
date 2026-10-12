import { scope, type, type Type } from 'arktype';

import type { ScenarioModule, ScenarioRunner } from '../scenarios.ts';

const to_runner =
	(schema: Type): ScenarioRunner =>
	(value) =>
		!(schema(value) instanceof type.errors);

export const scenario_string: ScenarioModule['scenario_string'] = () => to_runner(type('string'));

// arktype keeps unknown keys by default where the others drop them
export const scenario_object_flat: ScenarioModule['scenario_object_flat'] = () =>
	to_runner(
		type({
			id: 'number',
			name: 'string',
			email: 'string',
			active: 'boolean',
			'role?': 'string'
		})
	);

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
			name: '1 <= string <= 50',
			age: '0 <= number.integer <= 150',
			slug: /^[a-z0-9-]+$/
		})
	);

export const scenario_union: ScenarioModule['scenario_union'] = () =>
	to_runner(type('(string | number | boolean)[]'));

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
