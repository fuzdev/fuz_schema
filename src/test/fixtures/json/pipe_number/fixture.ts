import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// numbers are doubles, tested as the value read and not as the token written
const entries = {
	integer: s.optional(s.pipe(s.number, s.integer)),
	safe: s.optional(s.pipe(s.number, s.safe_integer)),
	finite: s.optional(s.pipe(s.number, s.finite)),
	range: s.optional(s.pipe(s.number, s.min_value(0.1), s.max_value(0.3))),
	at_most_large: s.optional(s.pipe(s.number, s.max_value(1e21))),
	at_least_large: s.optional(s.pipe(s.number, s.min_value(1e21))),
	at_least_zero: s.optional(s.pipe(s.number, s.min_value(-0))),
	at_least_tiny: s.optional(s.pipe(s.number, s.min_value(Number.MIN_VALUE))),
	at_most_max: s.optional(s.pipe(s.number, s.max_value(Number.MAX_VALUE), s.finite)),
	whole_percent: s.optional(s.pipe(s.pipe(s.number, s.integer), s.min_value(0), s.max_value(100))),
	// the number tests answer for any value, so they stand alone too
	bare_integer: s.optional(s.integer),
	bare_safe: s.optional(s.safe_integer),
	bare_finite: s.optional(s.finite),
	from_integer: s.optional(s.pipe(s.integer, s.min_value(1)))
};

const integers = [
	'0',
	'-0',
	'1',
	'-1',
	'1.0',
	'1.00',
	'1e2',
	'1E2',
	'1e+2',
	'0.1e1',
	'4.5e1',
	'100e-2',
	'1.5',
	'0.1',
	'1e-2',
	'5e-324',
	'9007199254740991',
	'9007199254740991.0',
	'9007199254740992',
	'9007199254740993',
	'9007199254740991e0',
	'900719925474099.1e1',
	'9.007199254740991e15',
	'9.007199254740992e15',
	'-9007199254740991',
	'-9007199254740992',
	'9223372036854775807',
	'-9223372036854775808',
	'-9223372036854775809',
	'18446744073709551615',
	'18446744073709551616',
	'123456789012345678901234567890',
	'1e21',
	'1e308',
	'4503599627370496.5',
	'4503599627370495.5',
	'0.9999999999999999',
	'0.99999999999999999',
	'"1"',
	'null',
	'true',
	'[1]'
];

const values: Record<keyof typeof entries, Array<string>> = {
	integer: integers,
	safe: integers,
	finite: ['0', '1.5', '1e308', '-1.7976931348623157e308', '"1"', 'null'],
	range: [
		'0.1',
		'0.3',
		'0.2',
		'1e-1',
		'3e-1',
		'0.30000000000000004',
		'0.30000000000000001',
		'0.09999999999999999',
		'0.099999999999999999',
		'0.1000000000000000055511151231257827021181583404541015625',
		'0.29999999999999998',
		'0',
		'-0.2',
		'1'
	],
	at_most_large: [
		'1e21',
		'1000000000000000000000',
		'1000000000000000000001',
		'1000000000000000100000',
		'1e22',
		'-1e22'
	],
	// the doubles on either side of the bound, by the digits that round to them
	at_least_large: [
		'1e21',
		'999999999999999999999',
		'999999999999999934464',
		'999999999999999934463',
		'999999999999999868928',
		'1e20'
	],
	at_least_zero: ['0', '-0', '0.0', '-0.0', '5e-324', '-5e-324', '1e-400', '-1e-400', '-1'],
	at_least_tiny: ['5e-324', '4.9e-324', '2.5e-324', '2.4e-324', '0', '1e-323'],
	at_most_max: [
		'1.7976931348623157e308',
		'1.7976931348623158e308',
		'1e308',
		'-1.7976931348623157e308'
	],
	whole_percent: ['0', '100', '100.0', '1e2', '50.5', '-1', '101', '-0', '"50"'],
	bare_integer: ['1', '1.0', '1.5', '"1"', 'null', 'true', '[]', '{}'],
	bare_safe: ['1', '9007199254740992', '1.5', '"1"', 'null'],
	bare_finite: ['1.5', '"1"', 'null', '[]'],
	from_integer: ['1', '2.0', '0', '1.5', '"1"']
};

const cases: Record<string, JsonFixtureText> = {};
for (const [key, texts] of Object.entries(values)) {
	texts.forEach((text, i) => {
		cases[`${key}_${i}`] = `{"${key}":${text}}`;
	});
}
// `JSON.parse` reads these as an infinity, which `number` refuses before any
// action is asked
for (const [name, text] of Object.entries({
	overflow: '1e400',
	negative_overflow: '-1e400',
	overflow_by_digits: `1${'0'.repeat(400)}`,
	just_past_max: '1.7976931348623159e308',
	twice_max: '2e308'
})) {
	for (const key of ['integer', 'finite', 'at_most_large', 'at_least_zero', 'at_most_max']) {
		cases[`${key}_${name}`] = { text: `{"${key}":${text}}`, diverges: 'number_overflow' };
	}
}

export const fixture: JsonFixture = { schema: s.object(entries), cases };
