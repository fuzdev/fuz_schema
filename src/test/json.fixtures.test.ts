import { describe, test, assert, beforeAll } from 'vitest';

import * as s from '#lib/schema.ts';
import {
	JSON_DIVERGENCES,
	format_json_fixture,
	generate_json_fixture,
	generate_json_fixture_case,
	generate_json_fixture_contract,
	load_json_fixture,
	load_json_fixture_names,
	read_json_fixture_contract,
	read_json_fixture_expected,
	type JsonFixtureExpected
} from './fixtures/json/json_test_helpers.ts';

let names: Array<string> = [];
const generated: Map<string, JsonFixtureExpected> = new Map();

beforeAll(async () => {
	names = await load_json_fixture_names();
	for (const name of names) {
		generated.set(name, generate_json_fixture(await load_json_fixture(name)));
	}
});

describe('json fixtures', () => {
	test('there are fixtures', () => {
		assert.isAbove(names.length, 0);
		for (const name of names) {
			assert.isAbove(generated.get(name)!.cases.length, 0, `group "${name}" has no cases`);
		}
	});

	test('every expected.json is what the library generates', async () => {
		for (const name of names) {
			assert.strictEqual(
				await read_json_fixture_expected(name),
				format_json_fixture(generated.get(name)!),
				`${name}/expected.json is stale, run \`gro src/test/fixtures/json/update\``
			);
		}
	});

	test('contract.json is what the library generates', async () => {
		assert.strictEqual(
			await read_json_fixture_contract(),
			format_json_fixture(generate_json_fixture_contract()),
			'contract.json is stale, run `gro src/test/fixtures/json/update`'
		);
	});

	test('an expected.json is plain JSON that reads back as it was generated', () => {
		for (const name of names) {
			const expected = generated.get(name)!;
			assert.deepEqual(JSON.parse(format_json_fixture(expected)), expected, name);
		}
	});

	test('a text that is JSON has a verdict and issues, and one that is not has neither', () => {
		for (const name of names) {
			for (const c of generated.get(name)!.cases) {
				const at = `${name}/${c.name}`;
				if (c.json) {
					assert.isBoolean(c.valid, at);
					assert.isArray(c.issues, at);
					assert.strictEqual(c.issues!.length === 0, c.valid, at);
				} else {
					assert.notProperty(c, 'valid', at);
					assert.notProperty(c, 'issues', at);
				}
			}
		}
	});

	test('a group with no fixture.ts says so', async () => {
		try {
			await load_json_fixture('no_such_group');
		} catch (error) {
			assert(error instanceof Error);
			assert.strictEqual(error.message, 'fixture group "no_such_group" has no fixture.ts');
			return;
		}
		assert.fail('expected a throw');
	});

	test('a case declares what its value has, and nothing it does not', () => {
		const deep = `${'['.repeat(128)}${']'.repeat(128)}`;
		const throws = (input: Parameters<typeof generate_json_fixture_case>[2], message: string) => {
			try {
				generate_json_fixture_case(s.unknown, 'c', input);
			} catch (error) {
				assert(error instanceof Error);
				assert.strictEqual(error.message, message);
				return;
			}
			assert.fail(`expected a throw: ${message}`);
		};
		const families = {
			number_overflow: ['1e400', '[{"a":[-1e400]}]'],
			lone_surrogate: [
				String.raw`"\ud800"`,
				String.raw`[{"a\udc00":1}]`,
				String.raw`{"a":["\ud800"]}`
			],
			depth_limit: [deep, `{"a":${deep}}`]
		};
		for (const family of ['number_overflow', 'lone_surrogate', 'depth_limit'] as const) {
			const texts = families[family];
			for (const text of texts) {
				// declared, in either form
				generate_json_fixture_case(s.unknown, 'c', { text, diverges: family });
				generate_json_fixture_case(s.unknown, 'c', { text, diverges: `${family}_unread` });
				// not declared, or declared as another
				throws(text, `case "c" must diverge as ${family} or ${family}_unread`);
				throws(
					{ text, diverges: 'duplicate_keys' },
					`case "c" must diverge as ${family} or ${family}_unread`
				);
			}
			// declared of a value with none
			for (const flag of [family, `${family}_unread`] as const) {
				throws(
					{ text: '[1e308,"a",[[]]]', diverges: flag },
					`case "c" has nothing to diverge as ${flag} by`
				);
			}
		}
		// the deepest the parser reads is not past it
		generate_json_fixture_case(s.unknown, 'c', deep.slice(1, -1));
	});

	test('every divergence is declared by some case', () => {
		const declared = new Set(
			names.flatMap((name) => generated.get(name)!.cases.map((c) => c.diverges))
		);
		for (const divergence of JSON_DIVERGENCES) {
			assert(declared.has(divergence), `no case diverges as ${divergence}`);
		}
	});
});
