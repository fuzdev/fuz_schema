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

describe('to_integer', () => {
	// the grammar of `docs/formats.md`, the digits and the white space `trim` takes
	const formats = readFileSync(new URL('../../docs/formats.md', import.meta.url), 'utf8');
	const [, DIGITS, SPACE] = /### `to_integer`\n\n```\n(.*)\n```[\s\S]*?```\n(.*)\n```/.exec(
		formats
	)!;
	const MAX = BigInt(Number.MAX_SAFE_INTEGER);
	const OPTIONS = [{}, { unsigned: true }, { trim: true }, { unsigned: true, trim: true }] as const;
	const grammar = (unsigned: boolean, trim: boolean): RegExp =>
		RegExp(
			DIGITS!
				.replaceAll('<space>', trim ? `(${SPACE!})` : '()')
				.replace('[+-]?', unsigned ? '(\\+?)' : '([+-]?)'),
			'u'
		);
	// what the grammar reads, by `BigInt` of the sign and the digits it matched,
	// or `undefined` where it reads no safe integer
	const read = (value: string, unsigned: boolean, trim: boolean): number | undefined => {
		const match = grammar(unsigned, trim).exec(value);
		if (!match) return undefined;
		const n = BigInt(value.slice(match[1]!.length, value.length - match[3]!.length));
		return n > MAX || n < -MAX ? undefined : Number(n);
	};
	const assert_as_grammar = (value: string): void => {
		for (const options of OPTIONS) {
			const unsigned = 'unsigned' in options;
			const trim = 'trim' in options;
			const result = s.parse(s.pipe(s.string, s.to_integer(options)), value);
			const expected = read(value, unsigned, trim);
			// a `-0` gives `0`, so the result is compared by `Object.is`
			assert.ok(
				expected === undefined
					? !result.ok
					: result.ok && Object.is(result.value, expected === 0 ? 0 : expected),
				JSON.stringify({ value, options })
			);
		}
	};
	const BASES = ['5', '-12', '+007', '0', '-0', '9007199254740991', '-9007199254740991'];
	// ASCII and Latin-1, every white space of Unicode and some that aren't, and
	// digits of other scripts
	const CHARS = [
		...Array.from({ length: 0x100 }, (_, c) => String.fromCharCode(c)),
		...['\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000'],
		...['\ufeff', '\u180e', '\u200b', '\u0660', '\u0663', '\uff10', '\uff15', '\ud800'],
		String.fromCodePoint(0x1d7ce)
	];

	test('reads as its grammar with any char at any position', () => {
		for (const base of BASES) {
			for (let i = 0; i <= base.length; i++) {
				for (const c of CHARS) {
					assert_as_grammar(base.slice(0, i) + c + base.slice(i + 1));
					assert_as_grammar(base.slice(0, i) + c + base.slice(i));
				}
				assert_as_grammar(base.slice(0, i) + base.slice(i + 1));
			}
		}
	});

	test('with trim, takes every white space of Unicode around it, and no other', () => {
		const White_Space = /^\p{White_Space}$/u;
		for (let c = 0; c <= 0xffff; c++) {
			const space = String.fromCharCode(c);
			// a digit or a sign is of the integer
			if (/[\d+-]/.test(space)) continue;
			const takes = White_Space.test(space);
			for (const value of [space + '5', '5' + space, space + space + '-5' + space]) {
				assert.strictEqual(s.is(s.pipe(s.string, s.to_integer({ trim: true })), value), takes);
				assert(!s.is(s.pipe(s.string, s.to_integer()), value), JSON.stringify(value));
			}
		}
		// Rust's `str::trim` takes U+0085, which `Number` reads as no number, and
		// neither U+FEFF, U+180E, nor U+200B, which `Number` or `\s` read as space
		assert.strictEqual(
			s.parse_or_throw(s.pipe(s.string, s.to_integer({ trim: true })), '\u00855'),
			5
		);
		for (const space of ['\ufeff', '\u180e', '\u200b']) {
			assert(!s.is(s.pipe(s.string, s.to_integer({ trim: true })), space + '5'));
		}
	});

	test('reads the safe integers, leading zeros taken, and none past them', () => {
		const Integer = s.pipe(s.string, s.to_integer());
		for (const [value, expected] of [
			['9007199254740991', 9007199254740991],
			['-9007199254740991', -9007199254740991],
			['+0009007199254740991', 9007199254740991],
			['-0009007199254740991', -9007199254740991],
			['0000000000000000000000000000001', 1],
			['9007199254740992', undefined],
			['-9007199254740992', undefined],
			// rounds to 2 ** 53 as a double
			['9007199254740993', undefined],
			['99999999999999999999', undefined],
			['1' + '0'.repeat(400), undefined]
		] as const) {
			const result = s.parse(Integer, value);
			assert.deepEqual(result.ok ? result.value : undefined, expected, value);
		}
	});

	test('reads the inputs of its table, under each option', () => {
		const MAX = Number.MAX_SAFE_INTEGER;
		// the output of `to_integer()`, `{unsigned: true}`, `{trim: true}`, and both
		for (const [value, ...outputs] of [
			['5', 5, 5, 5, 5],
			['+5', 5, 5, 5, 5],
			['007', 7, 7, 7, 7],
			['-5', -5, undefined, -5, undefined],
			['-0', 0, undefined, 0, undefined],
			['-000', 0, undefined, 0, undefined],
			['', undefined, undefined, undefined, undefined],
			[' 5', undefined, undefined, 5, 5],
			['\t5\n', undefined, undefined, 5, 5],
			['\u30005 ', undefined, undefined, 5, 5],
			['\u00855', undefined, undefined, 5, 5],
			['\ufeff5', undefined, undefined, undefined, undefined],
			[' ', undefined, undefined, undefined, undefined],
			['- 5', undefined, undefined, undefined, undefined],
			['1e3', undefined, undefined, undefined, undefined],
			['0x10', undefined, undefined, undefined, undefined],
			['1.0', undefined, undefined, undefined, undefined],
			['5.', undefined, undefined, undefined, undefined],
			['1_000', undefined, undefined, undefined, undefined],
			['+', undefined, undefined, undefined, undefined],
			['+-5', undefined, undefined, undefined, undefined],
			['\u0663', undefined, undefined, undefined, undefined],
			['\uff15', undefined, undefined, undefined, undefined],
			['Infinity', undefined, undefined, undefined, undefined],
			['9007199254740991', MAX, MAX, MAX, MAX],
			['9007199254740992', undefined, undefined, undefined, undefined]
		] as const) {
			OPTIONS.forEach((options, i) => {
				const result = s.parse(s.pipe(s.string, s.to_integer(options)), value);
				const output = result.ok ? result.value : undefined;
				assert.ok(Object.is(output, outputs[i]), JSON.stringify({ value, options, output }));
			});
		}
	});

	test('its issue, of the grammar and of the range alike', () => {
		const at = (expected: string, received = 'string') => [
			{ kind: 'to_integer', expected, received, path: [], message: undefined }
		];
		const signed = 'a safe integer in decimal digits';
		const unsigned = 'an unsigned safe integer in decimal digits';
		assert.deepEqual(issues_of(s.pipe(s.string, s.to_integer()), '1e3'), at(signed));
		assert.deepEqual(issues_of(s.pipe(s.string, s.to_integer()), '9007199254740992'), at(signed));
		assert.deepEqual(
			issues_of(s.pipe(s.string, s.to_integer({ unsigned: true, trim: true })), '-5'),
			at(unsigned)
		);
		// alone it fails any value that isn't a string, where its grammar would convert it
		assert.deepEqual(issues_of(s.to_integer(), 5), at(signed, 'number'));
		assert.deepEqual(issues_of(s.to_integer(), ['5']), at(signed, 'array'));
		assert.deepEqual(issues_of(s.to_integer(), { toString: () => '5' }), at(signed, 'object'));
		assert.deepEqual(issues_of(s.to_integer(), undefined), at(signed, 'undefined'));
		assert.strictEqual(s.parse_or_throw(s.to_integer(), '5'), 5);
	});
});
