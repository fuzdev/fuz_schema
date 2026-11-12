/**
 * The README's recipes, each as it is printed, between a `// recipe: <name>`
 * and a `// /recipe` line, and what the README says each gives. The README
 * marks each recipe's block with `<!-- recipe: <name> -->`, and the blocks
 * are held to the code here with whitespace taken out, as the formatter
 * spaces this file and not the README.
 *
 * @module
 */

import { assert, describe, test } from 'vitest';
import { readFileSync } from 'node:fs';

import * as s from '#lib/schema.ts';

// recipe: union_options
const Contact = s.union([
	s.object({ email: s.pipe(s.string, s.min_length(3)) }),
	s.object({ phone: s.pipe(s.string, s.min_length(7)) })
]);
const Form = s.object({ name: s.string, contact: Contact });

// each option's issues for the issue of a union the caller names, with paths from the root
const explain_union = (
	union: s.UnionSchema<ReadonlyArray<s.Schema>>,
	issue: s.SchemaIssue,
	input: unknown
): Array<Array<s.SchemaIssue>> | undefined => {
	const found = s.get_issue_value(issue, input);
	if (!found.ok) return undefined;
	return union.def.map((option) => {
		const result = s.parse(option, found.value);
		if (result.ok) return [];
		return result.issues.map((i) => ({ ...i, path: [...issue.path, ...i.path] }));
	});
};

const input = { name: 'x', contact: { phone: '12' } };
const result = s.parse(Form, input);
// result.issues: one issue, `contact: expected object, received object`
const per_option = !result.ok && explain_union(Contact, result.issues[0]!, input);
// per_option, as format_issue writes them:
// [['contact.email: expected string, received undefined',
//   'contact.phone: expected no unknown keys, received string'],
//  ['contact.phone: expected length >= 7, received string']]
// /recipe

// recipe: translating_issues
const Account = s.pipe(
	s.object({ username: s.pipe(s.string, s.min_length(3)), password: s.string, confirm: s.string }),
	s.message(
		s.check_at('confirm', (v) => v.password === v.confirm),
		'account.passwords_match'
	)
);

// a consumer's catalogue: its words for the types `expected` and `received` name,
// its labels for its fields, and the text of each key given to `message`.
// Maps, as a path's keys are the input's: a key named `constructor` finds nothing
const TYPES_ES = new Map([
	['string', 'texto'],
	['number', 'un número'],
	['undefined', 'nada']
]);
const FIELDS_ES = new Map([
	['username', 'el nombre'],
	['password', 'la contraseña']
]);
const MESSAGES_ES = new Map([['account.passwords_match', 'las contraseñas deben coincidir']]);

const translate_es = (issue: s.SchemaIssue): string => {
	if (issue.message !== undefined) return MESSAGES_ES.get(issue.message) ?? issue.message;
	const field = FIELDS_ES.get(String(issue.path.at(-1))) ?? 'el valor';
	const word = (type: string): string => TYPES_ES.get(type) ?? type;
	switch (issue.kind) {
		case 'min_length':
			return `${field} necesita al menos ${issue.expected.replace('length >= ', '')} caracteres`;
		case 'unknown_key':
			return `${field} no es un campo permitido`;
		default:
			return `${field}: se esperaba ${word(issue.expected)}, se recibió ${word(issue.received)}`;
	}
};

const short_name = s.parse(Account, { username: 'al', password: 'a', confirm: 'a' });
const short_name_es = short_name.ok ? [] : short_name.issues.map(translate_es);
// ['el nombre necesita al menos 3 caracteres']
const mismatched = s.parse(Account, { username: 'alice', password: 'a', confirm: 'b' });
const mismatched_es = mismatched.ok ? [] : mismatched.issues.map(translate_es);
// ['las contraseñas deben coincidir']
// /recipe

// recipe: async_checks
// an issue in the shape `fail` builds, so `format_issue` and a catalogue read it as any other
const issue_at = (path: Array<PropertyKey>, expected: string, received: string): s.SchemaIssue => ({
	kind: 'check',
	expected,
	received,
	path,
	message: undefined
});

// `parse`, then each check of the typed output in turn, awaited, stopping at the first that fails
const parse_then = async <T extends s.Schema>(
	schema: T,
	value: unknown,
	checks: ReadonlyArray<(output: s.Infer<T>) => Promise<Array<s.SchemaIssue>>>
): Promise<s.SchemaResult<s.Infer<T>>> => {
	const result = s.parse(schema, value);
	if (!result.ok) return result;
	for (const check of checks) {
		const issues = await check(result.value);
		if (issues.length) return { ok: false, issues };
	}
	return result;
};

const Signup = s.object({ username: s.pipe(s.string, s.min_length(3)), email: s.string });
const is_taken = async (username: string): Promise<boolean> => username === 'alice'; // a lookup
const username_free = async (output: s.Infer<typeof Signup>): Promise<Array<s.SchemaIssue>> =>
	(await is_taken(output.username)) ? [issue_at(['username'], 'an unused username', 'string')] : [];

const signup = parse_then(Signup, { username: 'alice', email: 'a@b.c' }, [username_free]);
// resolves to {ok: false, issues: [{kind: 'check', expected: 'an unused username',
//   received: 'string', path: ['username'], message: undefined}]}
// /recipe

const RECIPE_NAMES = ['union_options', 'translating_issues', 'async_checks'] as const;

// the code with its whitespace taken out, kept in a string, and collapsed in a comment,
// as the formatter spaces and wraps this file and not the README
const STRING_OR_COMMENT = /(\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/;
const without_whitespace = (text: string): string =>
	text
		.split(STRING_OR_COMMENT)
		.map((part, i) =>
			i % 2 === 0
				? part.replace(/\s+/g, '')
				: part.startsWith('//')
					? part.replace(/\s+/g, ' ').trimEnd()
					: part
		)
		.join('');

// the code of each recipe in this file, by name
const read_recipes_here = (): Map<string, string> => {
	const source = readFileSync(new URL(import.meta.url), 'utf8');
	const recipes: Map<string, string> = new Map();
	for (const match of source.matchAll(/^\/\/ recipe: (\w+)\n([\s\S]*?)^\/\/ \/recipe$/gm)) {
		recipes.set(match[1]!, match[2]!);
	}
	return recipes;
};

// the code of each block of the README marked as a recipe, by name
const read_recipes_in_readme = (): Map<string, string> => {
	const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
	const recipes: Map<string, string> = new Map();
	for (const match of readme.matchAll(/^<!-- recipe: (\w+) -->\n+```ts\n([\s\S]*?)^```$/gm)) {
		recipes.set(match[1]!, match[2]!);
	}
	return recipes;
};

describe('the README recipes', () => {
	test("each block of the README marked as a recipe is that recipe's code here", () => {
		const here = read_recipes_here();
		const readme = read_recipes_in_readme();
		assert.deepEqual([...here.keys()], [...RECIPE_NAMES], 'the recipes in this file');
		assert.deepEqual(
			[...readme.keys()].sort(),
			[...RECIPE_NAMES].sort(),
			'the recipes marked in README.md'
		);
		for (const name of RECIPE_NAMES) {
			assert.strictEqual(
				without_whitespace(readme.get(name)!),
				without_whitespace(here.get(name)!),
				`the README's block of the recipe ${name} is its code in readme_recipes.test.ts`
			);
		}
	});

	test("a failed union's options: each option's issues, from the root", () => {
		assert.ok(!result.ok);
		assert.deepEqual(result.issues.map(s.format_issue), [
			'contact: expected object, received object'
		]);
		assert.ok(per_option);
		assert.deepEqual(
			per_option.map((issues) => issues.map(s.format_issue)),
			[
				[
					'contact.email: expected string, received undefined',
					'contact.phone: expected no unknown keys, received string'
				],
				['contact.phone: expected length >= 7, received string']
			]
		);
	});

	test('a failed union of options that each have their own value: the value at the path', () => {
		const List = s.object({ items: s.array(s.union([s.number, s.object({ at: s.number })])) });
		const list_input = { items: [1, { at: 'no' }] };
		const listed = s.parse(List, list_input);
		assert.ok(!listed.ok);
		const union = List.def.items.def;
		assert.deepEqual(
			explain_union(union, listed.issues[0]!, list_input)?.map((issues) =>
				issues.map(s.format_issue)
			),
			[
				['items.1: expected number, received object'],
				['items.1.at: expected number, received string']
			]
		);
	});

	test('a failed union: what the recipe does not see', () => {
		// a missing key is parsed as `undefined`, so an option that needs its key matches it
		const Keyed = s.object({ a: s.union([s.unknown, s.string]) });
		const keyed = s.parse(Keyed, {});
		assert.ok(!keyed.ok);
		assert.strictEqual(keyed.issues[0]!.kind, 'union');
		assert.deepEqual(
			explain_union(Keyed.def.a, keyed.issues[0]!, {})?.map((issues) => issues.map(s.format_issue)),
			[[], ['a: expected string, received undefined']],
			'the `unknown` that refused the missing key matches the `undefined`'
		);

		// a step before the union that changes the value and keeps its type: the input's value is parsed
		const Options = s.union([s.literal('a'), s.literal('b')]);
		const Upper = s.pipe(
			s.string,
			s.transform((text) => text.toUpperCase()),
			Options
		);
		const upper = s.parse(Upper, 'a');
		assert.ok(!upper.ok);
		assert.deepEqual(
			explain_union(Options, upper.issues[0]!, 'a')?.map((issues) => issues.length),
			[0, 1],
			"the input's 'a', which the first option matches, and not the 'A' the union was given"
		);

		// a step before the union that changed the value's type: no value is found
		const Lengths = s.union([s.literal(1), s.literal(2)]);
		const Counted = s.pipe(
			s.string,
			s.transform((text) => text.length),
			Lengths
		);
		const counted = s.parse(Counted, 'abc');
		assert.ok(!counted.ok);
		assert.strictEqual(explain_union(Lengths, counted.issues[0]!, 'abc'), undefined);

		// a value at the path of another type than the issue's is refused
		assert.ok(!result.ok);
		assert.strictEqual(
			explain_union(Contact, { ...result.issues[0]!, received: 'string' }, input),
			undefined
		);
	});

	test('translating issues: a catalogue over the data, with `message` given keys', () => {
		assert.ok(!short_name.ok);
		assert.deepEqual(short_name_es, ['el nombre necesita al menos 3 caracteres']);
		assert.ok(!mismatched.ok);
		assert.deepEqual(mismatched_es, ['las contraseñas deben coincidir']);
		const other = s.parse(Account, { username: 1, confirm: 'a', extra: 1 });
		assert.ok(!other.ok);
		assert.deepEqual(other.issues.map(translate_es), [
			'el nombre: se esperaba texto, se recibió un número',
			'la contraseña: se esperaba texto, se recibió nada',
			'el valor no es un campo permitido'
		]);
	});

	test('translating issues: a key the input names finds nothing every object inherits', () => {
		for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
			const body = JSON.parse(
				`{"username": "alice", "password": "a", "confirm": "a", ${JSON.stringify(key)}: 1}`
			);
			const parsed = s.parse(Account, body);
			assert.ok(!parsed.ok, key);
			assert.deepEqual(parsed.issues.map(translate_es), ['el valor no es un campo permitido'], key);
		}
	});

	test('translating issues: what a catalogue cannot tell apart', () => {
		const expected_of = (schema: s.Schema, value: unknown): string => {
			const parsed = s.parse(schema, value);
			assert.ok(!parsed.ok);
			return parsed.issues[0]!.expected;
		};
		// a bigint and a number literal are written the same
		assert.strictEqual(expected_of(s.one_of([1n, 1]), 2), '1 | 1');
		assert.strictEqual(expected_of(s.literal(1n), 2), expected_of(s.literal(1), 2));
		// `-0` is written `0`
		assert.strictEqual(expected_of(s.literal(-0), 2), '0');
		assert.strictEqual(expected_of(s.pipe(s.number, s.min_value(-0)), -1), '>= 0');
		// a bound is a number inside the text, a bigint's without its `n`
		assert.strictEqual(expected_of(s.pipe(s.string, s.max_length(2)), 'abc'), 'length <= 2');
		assert.strictEqual(expected_of(s.pipe(s.bigint, s.min_value(1n)), 0n), '>= 1');
	});

	test('async checks: parse, then the checks awaited on the output', async () => {
		const taken = await signup;
		assert.deepEqual(taken, {
			ok: false,
			issues: [
				{
					kind: 'check',
					expected: 'an unused username',
					received: 'string',
					path: ['username'],
					message: undefined
				}
			]
		});
		assert.ok(!taken.ok);
		assert.strictEqual(
			s.format_issue(taken.issues[0]!),
			'username: expected an unused username, received string'
		);
		assert.deepEqual(
			await parse_then(Signup, { username: 'bob', email: 'b@c.d' }, [username_free]),
			{
				ok: true,
				value: { username: 'bob', email: 'b@c.d' }
			}
		);
		// a failed parse runs no check
		let checked = false;
		const parsed = await parse_then(Signup, { username: 'al', email: 'x' }, [
			async () => {
				checked = true;
				return [];
			}
		]);
		assert.ok(!parsed.ok);
		assert.strictEqual(checked, false);
	});

	test('async checks: a check given an async function always passes, and is a type error', () => {
		const is_free = async (name: string): Promise<boolean> => name !== 'alice';
		// @ts-expect-error a check's function returns a boolean, and a promise is not one
		const Free = s.pipe(s.string, s.check(is_free));
		assert.ok(s.parse(Free, 'alice').ok, 'its promise is truthy');
		assert.ok(s.is(Free, 'alice'));
	});

	test('async checks: a transform given an async function puts its promise in the output', async () => {
		const Upper = s.pipe(
			s.string,
			s.transform(async (text: string) => text.toUpperCase())
		);
		const parsed = s.parse(Upper, 'a');
		assert.ok(parsed.ok);
		assert.instanceOf(parsed.value, Promise);
		assert.strictEqual(await parsed.value, 'A');
	});
});
