import { test, assert, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';

import * as s from '#lib/schema.ts';
import * as docinfo_valibot from '../benchmarks/docinfo/docinfo_valibot.ts';
import { create_docinfo } from '../benchmarks/docinfo/docinfo_fuz_schema.ts';

interface DocinfoFixture {
	name: string;
	value: Record<string, unknown>;
}

const fixtures: Array<DocinfoFixture> = JSON.parse(
	readFileSync(new URL('../benchmarks/docinfo/docinfo_fixtures.json', import.meta.url), 'utf8')
).fixtures;

// a whole library's analysis, as svelte-docinfo wrote it
const library: Array<Record<string, unknown>> = JSON.parse(
	readFileSync(new URL('../benchmarks/docinfo/docinfo_fuz_ui.json', import.meta.url), 'utf8')
).modules;

const docinfo = create_docinfo(s);

// every object and array in `value`, with the keys that lead to it
const walk = (
	value: unknown,
	path: Array<PropertyKey> = [],
	found: Array<{ at: any; path: Array<PropertyKey> }> = []
): Array<{ at: any; path: Array<PropertyKey> }> => {
	if (value !== null && typeof value === 'object') {
		found.push({ at: value, path });
		for (const [key, child] of Object.entries(value)) {
			walk(child, [...path, Array.isArray(value) ? Number(key) : key], found);
		}
	}
	return found;
};

// a value of each JSON type but an array: valibot's `strictObject` takes an
// array for an object and reports its missing keys, where this library
// reports the array, so an array in an object's place gives other paths
const WRONG: ReadonlyArray<unknown> = [1, 'x', true, null, {}];

// numbers at the edge of each check on one: `min_value`, `safe_integer` twice
// over, and `finite`, which a JSON text reaches as `1e999`. Each fails one
// check at most: valibot runs every check of a pipe and this library stops at
// the first to fail, so a number that fails two gives two issues there
const NUMBERS: ReadonlyArray<number> = [0, 1.5, 2 ** 53, Infinity];

// copies of `value`, each changed in one place, for every place: an unknown
// key on each object, each key gone, each value replaced by one of every other
// type, each number by the ones in `NUMBERS`, and each array emptied and cut
// short by one. Not every change is wrong: a key may be optional.
const to_changed = (value: unknown): Array<{ label: string; value: unknown }> => {
	const changed: Array<{ label: string; value: unknown }> = [];
	for (const site of walk(value)) {
		const where = site.path.join('.') || 'the root';
		const change = (label: string, fn: (at: any) => void): void => {
			const copy = structuredClone(value);
			let at: any = copy;
			for (const key of site.path) at = at[key];
			fn(at);
			changed.push({ label: `${label} at ${where}`, value: copy });
		};
		const is_array = Array.isArray(site.at);
		if (!is_array) change('an unknown key', (at) => (at.unknown_key = 1));
		else if (site.at.length) {
			change('no items', (at) => (at.length = 0));
			if (site.at.length > 1) change('an item fewer', (at) => at.pop());
		}
		for (const key of Object.keys(site.at)) {
			const original: unknown = site.at[key];
			if (!is_array) change(`no ${key}`, (at) => delete at[key]);
			for (const wrong of WRONG) {
				if (typeof wrong === typeof original && (wrong === null) === (original === null)) continue;
				change(`${JSON.stringify(wrong)} for ${key}`, (at) => (at[key] = wrong));
			}
			if (typeof original === 'number') {
				for (const n of NUMBERS) change(`${n} for ${key}`, (at) => (at[key] = n));
			}
		}
	}
	return changed;
};

const DIAGNOSTIC = { file: 'src/lib/a.ts', line: 1, column: 2, message: 'm', severity: 'warning' };

// what the fixtures don't have: a diagnostic of every kind, and the
// declarations, re-exports, and records svelte-docinfo's fixtures for one
// module never produce
const EXTRA: Array<DocinfoFixture> = [
	{
		name: 'every diagnostic',
		value: {
			path: 'a.ts',
			diagnostics: [
				{ kind: 'type_extraction_failed', ...DIAGNOSTIC, symbolName: 'a' },
				{ kind: 'signature_analysis_failed', ...DIAGNOSTIC, functionName: 'a' },
				{ kind: 'class_member_failed', ...DIAGNOSTIC, className: 'A', memberName: 'a' },
				{ kind: 'svelte_prop_failed', ...DIAGNOSTIC, componentName: 'A', propName: 'a' },
				{ kind: 'legacy_props', ...DIAGNOSTIC, componentName: 'A', propNames: ['a'] },
				{ kind: 'module_skipped', ...DIAGNOSTIC, reason: 'no_analyzer' },
				{ kind: 'module_unreadable', ...DIAGNOSTIC },
				{ kind: 'import_parse_failed', ...DIAGNOSTIC },
				{ kind: 'duplicate_comment', ...DIAGNOSTIC, commentType: 'doc_comment' },
				{ kind: 'misplaced_tag', ...DIAGNOSTIC, tagName: 'nodocs', functionName: 'a' },
				{ kind: 'unknown_param', ...DIAGNOSTIC, paramName: 'a', functionName: 'a' },
				{ kind: 'source_map_failed', ...DIAGNOSTIC },
				{
					kind: 'duplicate_declaration',
					...DIAGNOSTIC,
					declarationName: 'a',
					modules: ['a.ts', 'b.ts']
				},
				{ kind: 'transform_failed', ...DIAGNOSTIC },
				{ kind: 'resolver_failed', ...DIAGNOSTIC, specifier: 'a' },
				{ kind: 'alias_lost', ...DIAGNOSTIC, aliasName: 'A' }
			]
		}
	},
	{
		name: 'every declaration the fixtures lack',
		value: {
			path: 'b.ts',
			declarations: [
				{ name: 'ns', kind: 'namespace', module: 'a.ts', aliasOf: { module: 'a.ts', name: 'a' } },
				{
					name: 'snippet',
					kind: 'snippet',
					modifiers: ['abstract'],
					mutates: { a: 'b' },
					parameters: [
						{
							name: 'a',
							type: '[a: string, ...b: number[]]',
							rest: true,
							propertyDescriptions: { a: 'b' },
							typeInfo: {
								kind: 'tuple',
								readonly: true,
								elements: [
									{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
									{
										type: { kind: 'array', element: { kind: 'literal', value: 1, text: '1' } },
										rest: true
									}
								]
							}
						}
					]
				},
				{
					name: 'A',
					kind: 'class',
					implements: ['B'],
					members: [
						{ name: '(construct)', kind: 'constructor' },
						{ name: 'a', kind: 'variable', reactivity: '$derived.by' }
					]
				},
				{ name: 'B', kind: 'component', lang: 'js', acceptsChildren: true },
				{
					name: 'f',
					kind: 'function',
					throws: [{ description: 'a' }, { type: 'Error', description: 'b' }]
				}
			],
			reExports: [{ name: 'a', module: 'a.ts', typeOnly: true, sourceLine: 1 }],
			externalReExports: [{ name: 'a', specifier: 'a', originalName: 'b', sourceLine: 1 }],
			partial: true
		}
	}
];

const to_paths = (issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): Array<string> =>
	issues.map((issue) => issue.path.join('.')).sort();

describe("svelte-docinfo's schemas, in valibot and in this library", () => {
	test('there are fixtures, each named once', () => {
		assert(fixtures.length > 0);
		assert.strictEqual(new Set(fixtures.map((f) => f.name)).size, fixtures.length);
	});

	test('both accept every fixture and give the same output', () => {
		for (const fixture of fixtures) {
			const expected = v.safeParse(docinfo_valibot.ModuleFixtureJson, fixture.value);
			assert(expected.success, fixture.name);
			const result = s.parse(docinfo.ModuleFixtureJson, fixture.value);
			assert(result.ok, fixture.name);
			assert.deepEqual(result.value, expected.output, fixture.name);
			// a fixture is stored without its defaults, and the output has them: parsed
			// again it has nothing to change, and comes back as it is
			const full = JSON.parse(JSON.stringify(result.value));
			const again = s.parse(docinfo.ModuleFixtureJson, full);
			assert(again.ok, fixture.name);
			assert.strictEqual(again.value, full, fixture.name);
			assert(s.is(docinfo.ModuleFixtureJson, full), fixture.name);
		}
	});

	test('both accept a whole library and give the same output', () => {
		assert(library.length > 0);
		const expected = v.safeParse(v.array(docinfo_valibot.ModuleJson), library);
		assert(expected.success);
		const result = s.parse(s.array(docinfo.ModuleJson), library);
		assert(result.ok);
		assert.deepEqual(result.value, expected.output);
	});

	test('both reject an unknown key on a module', () => {
		// `ModuleFixtureJson` is built from the entries of `ModuleJson` and is not it
		const value = { ...library[0], unknown_key: 1 };
		assert(!v.is(docinfo_valibot.ModuleJson, value));
		assert(!s.is(docinfo.ModuleJson, value));
		assert(!s.parse(docinfo.ModuleJson, value).ok);
	});

	test('both give the same answer for every fixture changed in one place', () => {
		let rejected = 0;
		for (const fixture of [...fixtures, ...EXTRA]) {
			assert(v.is(docinfo_valibot.ModuleFixtureJson, fixture.value), fixture.name);
			for (const { label, value } of to_changed(fixture.value)) {
				const message = `${fixture.name}: ${label}`;
				const expected = v.safeParse(docinfo_valibot.ModuleFixtureJson, value);
				const result = s.parse(docinfo.ModuleFixtureJson, value);
				assert.strictEqual(result.ok, expected.success, message);
				assert.strictEqual(s.is(docinfo.ModuleFixtureJson, value), result.ok, message);
				if (result.ok) {
					assert.deepEqual(result.value, expected.output, message);
				} else {
					assert.deepEqual(
						to_paths(result.issues),
						to_paths(
							expected.issues!.map((issue) => ({
								path: (issue.path ?? []).map((item) => item.key as PropertyKey)
							}))
						),
						message
					);
					rejected++;
				}
			}
		}
		assert(rejected > fixtures.length);
	});

	test('a type is the same value out as in', () => {
		const types = walk([fixtures.map((f) => f.value), library])
			.filter(({ path }) => path.at(-1) === 'typeInfo' || path.at(-1) === 'returnTypeInfo')
			.map(({ at }) => at);
		assert(types.length > 0);
		for (const type of types) {
			assert.strictEqual(s.parse_or_throw(docinfo.TypeJson, type), type);
			assert(v.is(docinfo_valibot.TypeJson, type));
		}
	});
});
