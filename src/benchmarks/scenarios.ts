/**
 * The scenarios every library module in `libs/` implements, with their inputs.
 *
 * Each library module exports one `scenario_<name>` factory per scenario.
 * A factory builds its schema and returns a `ScenarioRunner`, so bundling a
 * single factory measures exactly what that schema costs to ship.
 *
 * `extra_keys` is the schema of `object_flat` on other inputs, so its factory
 * is that scenario's under a second name: its bundle is the same bytes, and
 * in a bundle of every scenario it adds a call and no definition.
 *
 * @module
 */

/** Validates `value` the way a caller would, returning whether it matched. */
export type ScenarioRunner = (value: unknown) => boolean;

export type ScenarioFactory = () => ScenarioRunner;

export interface Scenario {
	name: ScenarioName;
	valid: unknown;
	invalid: unknown;
}

export type ScenarioName =
	| 'string'
	| 'object_flat'
	| 'extra_keys'
	| 'strict_nested'
	| 'pipe'
	| 'union'
	| 'list'
	| 'type_json';

export type ScenarioModule = Record<`scenario_${ScenarioName}`, ScenarioFactory>;

// a tree for svelte-docinfo's recursive `TypeJson`, exercising every variant
const type_json = (leaf: unknown): unknown => ({
	kind: 'union',
	alias: 'Example',
	members: [
		{ kind: 'intrinsic', text: 'string' },
		{ kind: 'literal', value: 42, text: '42' },
		{
			kind: 'reference',
			name: 'Map',
			module: 'lib.es2015.collection.d.ts',
			typeArgs: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'array', element: { kind: 'reference', name: 'Item' }, readonly: true }
			]
		},
		{
			kind: 'tuple',
			elements: [
				{ name: 'first', type: { kind: 'intrinsic', text: 'number' } },
				{ type: { kind: 'literal', value: 'a', text: '"a"' }, optional: true },
				{ type: { kind: 'array', element: leaf }, rest: true }
			]
		},
		{
			kind: 'intersection',
			members: [
				{ kind: 'object', text: '{a: string}' },
				{ kind: 'function', text: '() => void' },
				{ kind: 'other', text: 'unique symbol' }
			]
		}
	]
});

const LIST_TAGS = ['math', 'engines', 'notes'];

// A hundred records, parsed as a response body is, so no object in it is
// shared with another. With `bad`, six of them are wrong, each at another
// field: four issues with a path of an index and a key, and two a level down,
// in `tags`.
const to_list = (bad: boolean): unknown => {
	const list: Array<Record<string, any>> = JSON.parse(
		JSON.stringify(
			Array.from({ length: 100 }, (_, i) => ({
				id: i,
				name: `user ${i}`,
				email: `user${i}@example.com`,
				active: i % 2 === 0,
				...(i % 3 ? { role: i % 3 === 1 ? 'admin' : 'member' } : {}),
				tags: LIST_TAGS.slice(0, i % 4)
			}))
		)
	);
	if (bad) {
		list[3]!.id = '3';
		list[13]!.tags[0] = null;
		list[40]!.active = 'yes';
		list[58]!.role = 5;
		list[71]!.tags[1] = 7;
		list[99]!.email = null;
	}
	return list;
};

// what `object_flat` matches, among keys its schema doesn't name
const to_extra_keys = (active: unknown): unknown => ({
	id: 1,
	created_at: '2024-01-01T00:00:00Z',
	name: 'Ada',
	email: 'ada@example.com',
	avatar_url: 'https://example.com/ada.png',
	active,
	followers: 12,
	settings: { theme: 'dark' },
	links: ['https://example.com/ada']
});

export const SCENARIOS: Array<Scenario> = [
	{ name: 'string', valid: 'hello', invalid: 42 },
	{
		name: 'object_flat',
		valid: { id: 1, name: 'Ada', email: 'ada@example.com', active: true },
		invalid: { id: '1', name: 'Ada', email: 'ada@example.com', active: 'yes' }
	},
	// the same schema, given keys it doesn't name, which it drops
	{ name: 'extra_keys', valid: to_extra_keys(true), invalid: to_extra_keys('yes') },
	{
		name: 'strict_nested',
		valid: {
			id: 1,
			name: 'Ada',
			tags: ['math', 'engines', 'notes'],
			address: { street: '12 St James Square', city: 'London', zip: 'SW1Y 4JH' }
		},
		invalid: {
			id: 1,
			name: 'Ada',
			tags: ['math', 7, 'notes'],
			address: { street: '12 St James Square', city: 'London', zip: 12345 }
		}
	},
	{
		name: 'pipe',
		valid: { name: 'Ada', age: 36, slug: 'ada-lovelace' },
		invalid: { name: '', age: 36.5, slug: 'Ada Lovelace' }
	},
	{
		name: 'union',
		valid: ['a', 1, true, 'b', 2, false, 'c', 3],
		invalid: ['a', 1, true, null, 2, false, 'c', {}]
	},
	// the commonest payload: many records, and issues with an index in their path
	{ name: 'list', valid: to_list(false), invalid: to_list(true) },
	{
		name: 'type_json',
		valid: type_json({ kind: 'intrinsic', text: 'boolean' }),
		invalid: type_json({ kind: 'bogus', text: 'boolean' })
	}
];
