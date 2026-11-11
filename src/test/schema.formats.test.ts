import { readFileSync } from 'node:fs';

import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

describe('uuid', () => {
	// the grammar of `docs/formats.md`, which `uuid` reads by char codes
	const formats = readFileSync(new URL('../../docs/formats.md', import.meta.url), 'utf8');
	const GRAMMAR = RegExp(/### `uuid`\n\n```\n(.*)\n```/.exec(formats)![1]!);
	const BASES = [
		'123e4567-e89b-42d3-a456-426614174000',
		'ABCDEF01-2345-1789-BABC-DEF012345678',
		'01890a5d-ac96-774b-bcce-b302099a8057',
		'00000000-0000-0000-0000-000000000000',
		'ffffffff-ffff-ffff-ffff-ffffffffffff',
		'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
		'fFfFfFfF-FfFf-fFfF-FFff-ffffFFFFffff'
	];
	// every char of ASCII and Latin-1 and past, so either side of each range
	// the scan reads, and the codes below `0` that setting bit 5 makes digits,
	// and past them the lone surrogates and digits and letters of other scripts
	const CHARS = [
		...Array.from({ length: 0x180 }, (_, c) => String.fromCharCode(c)),
		...['\u0130', '\u212a', '\uff10', '\uff21', '\uff41', '\u0660', '\ud800', '\udc00', '\uffff'],
		String.fromCodePoint(0x1d7ce)
	];
	const assert_as_grammar = (value: string): void => {
		assert.strictEqual(s.is(s.uuid, value), GRAMMAR.test(value), JSON.stringify(value));
	};

	test('matches as its grammar with any char at any position', () => {
		for (const base of BASES) {
			assert(s.is(s.uuid, base), base);
			for (let i = 0; i <= base.length; i++) {
				for (const c of CHARS) {
					assert_as_grammar(base.slice(0, i) + c + base.slice(i + 1));
					assert_as_grammar(base.slice(0, i) + c + base.slice(i));
				}
				assert_as_grammar(base.slice(0, i) + base.slice(i + 1));
			}
		}
	});

	test('matches as its grammar with every UTF-16 code unit at any position', () => {
		const base = BASES[0]!;
		const wrong: Array<string> = [];
		for (let i = 0; i < 36; i++) {
			for (let c = 0; c <= 0xffff; c++) {
				const value = base.slice(0, i) + String.fromCharCode(c) + base.slice(i + 1);
				if (s.is(s.uuid, value) !== GRAMMAR.test(value)) wrong.push(JSON.stringify(value));
			}
		}
		assert.deepEqual(wrong, []);
	});

	test('matches as its grammar on every version and variant', () => {
		const hex = '0123456789abcdefABCDEF';
		for (const base of BASES) {
			for (const version of hex) {
				for (const variant of hex) {
					assert_as_grammar(
						base.slice(0, 14) + version + base.slice(15, 19) + variant + base.slice(20)
					);
				}
			}
		}
	});

	test('fails a length but 36, and a value that is not a string', () => {
		const base = BASES[0]!;
		for (const value of [
			base.slice(1),
			base + '0',
			'0' + base,
			base.slice(0, 35),
			'',
			base.repeat(2)
		]) {
			assert(!s.is(s.uuid, value), value);
		}
		for (const value of [1, null, undefined, {}, [base], { length: 36 }, Object(base)]) {
			assert(!s.is(s.uuid, value));
		}
	});

	test('the nil and the max UUID only whole', () => {
		const nil = BASES[3]!;
		for (let i = 0; i < 36; i++) {
			if (nil[i] === '-') continue;
			for (const c of ['1', 'f', 'F']) {
				const value = nil.slice(0, i) + c + nil.slice(i + 1);
				assert_as_grammar(value);
				assert_as_grammar(value.replaceAll('0', 'f'));
				assert_as_grammar(value.replaceAll('0', 'F'));
			}
		}
	});
});

describe('pipe and actions', () => {
	test('uuid', () => {
		const Uuid = s.pipe(s.string, s.uuid);
		for (const [value, ok] of [
			['123e4567-e89b-12d3-a456-426614174000', true],
			['123E4567-E89B-42D3-A456-426614174000', true],
			['00000000-0000-8000-bfff-000000000000', true],
			['00000000-0000-0000-0000-000000000000', true],
			['ffffffff-ffff-ffff-ffff-ffffffffffff', true],
			['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', true],
			['ffffffff-FFFF-ffff-FFFF-ffffffffffff', true],
			// version 0 and 9, variant 7 and c
			['123e4567-e89b-02d3-a456-426614174000', false],
			['123e4567-e89b-92d3-a456-426614174000', false],
			['123e4567-e89b-12d3-7456-426614174000', false],
			['123e4567-e89b-12d3-c456-426614174000', false],
			['{123e4567-e89b-12d3-a456-426614174000}', false],
			['123e4567e89b12d3a456426614174000', false],
			['urn:uuid:123e4567-e89b-12d3-a456-426614174000', false],
			['123e4567-e89b-12d3-a456-426614174000\n', false],
			['123e4567-e89b-12d3-a456-42661417400', false],
			['123e4567-e89b-12d3-a456-4266141740000', false],
			// a fullwidth digit
			['123e4567-e89b-12d3-a456-42661417400０', false]
		] as const) {
			assert.strictEqual(s.is(Uuid, value), ok, value);
		}
		// a refinement: the output is the string given, uppercase kept
		const upper = '123E4567-E89B-42D3-A456-426614174000';
		assert.strictEqual(s.parse_or_throw(Uuid, upper), upper);
		assert.deepEqual(issues_of(Uuid, 'x'), [
			{ kind: 'uuid', expected: 'uuid', received: 'string', path: [], message: undefined }
		]);
		assert.deepEqual(issues_of(s.uuid, 1), [
			{ kind: 'uuid', expected: 'uuid', received: 'number', path: [], message: undefined }
		]);
	});

	test('iso_datetime', () => {
		const Datetime = s.pipe(s.string, s.iso_datetime);
		for (const [value, ok] of [
			['2024-01-01T00:00:00Z', true],
			['2024-01-01T00:00:00.1Z', true],
			['2024-01-01T23:59:59.123456789Z', true],
			['2024-02-29T00:00:00Z', true],
			['2000-02-29T00:00:00Z', true],
			['0000-02-29T00:00:00Z', true],
			['2024-01-01T00:00:00.1234567890Z', false],
			['2024-01-01T00:00:00.Z', false],
			['2024-01-01T00:00:00,5Z', false],
			['2024-01-01T00:00:00+01:00', false],
			['2024-01-01T00:00:00', false],
			['2024-01-01T00:00Z', false],
			['2024-01-01t00:00:00Z', false],
			['2024-01-01T00:00:00z', false],
			['2024-01-01 00:00:00Z', false],
			['2023-02-29T00:00:00Z', false],
			['1900-02-29T00:00:00Z', false],
			['2024-02-30T00:00:00Z', false],
			['2024-04-31T00:00:00Z', false],
			['2024-13-01T00:00:00Z', false],
			['2024-00-01T00:00:00Z', false],
			['2024-01-00T00:00:00Z', false],
			['2024-01-01T24:00:00Z', false],
			['2024-01-01T23:60:00Z', false],
			['2024-01-01T23:59:60Z', false],
			['+002024-01-01T00:00:00Z', false],
			['2024-01-01T00:00:00Z\n', false],
			['２024-01-01T00:00:00Z', false]
		] as const) {
			assert.strictEqual(s.is(Datetime, value), ok, value);
		}
		assert.deepEqual(issues_of(Datetime, '2024-02-30T00:00:00Z'), [
			{
				kind: 'iso_datetime',
				expected: 'iso_datetime',
				received: 'string',
				path: [],
				message: undefined
			}
		]);
		assert.deepEqual(issues_of(s.iso_datetime, null), [
			{
				kind: 'iso_datetime',
				expected: 'iso_datetime',
				received: 'null',
				path: [],
				message: undefined
			}
		]);
	});
});
