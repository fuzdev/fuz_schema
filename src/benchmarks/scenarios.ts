/**
 * The scenarios every library module in `libs/` implements, with their inputs.
 *
 * Each library module exports one `scenario_<name>` factory per scenario.
 * A factory builds its schema and returns a `ScenarioRunner`, so bundling a
 * single factory measures exactly what that schema costs to ship.
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
	'string' | 'object_flat' | 'strict_nested' | 'pipe' | 'union' | 'type_json';

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

export const SCENARIOS: Array<Scenario> = [
	{ name: 'string', valid: 'hello', invalid: 42 },
	{
		name: 'object_flat',
		valid: { id: 1, name: 'Ada', email: 'ada@example.com', active: true },
		invalid: { id: '1', name: 'Ada', email: 'ada@example.com', active: 'yes' }
	},
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
	{
		name: 'type_json',
		valid: type_json({ kind: 'intrinsic', text: 'boolean' }),
		invalid: type_json({ kind: 'bogus', text: 'boolean' })
	}
];
