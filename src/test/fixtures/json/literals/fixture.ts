import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

const entries = {
	one: s.optional(s.literal(1)),
	zero: s.optional(s.literal(0)),
	negative_zero: s.optional(s.literal(-0)),
	tenth: s.optional(s.literal(0.1)),
	sum: s.optional(s.literal(0.1 + 0.2)),
	large: s.optional(s.literal(1e21)),
	max: s.optional(s.literal(Number.MAX_VALUE)),
	min: s.optional(s.literal(Number.MIN_VALUE)),
	text: s.optional(s.literal('a')),
	empty: s.optional(s.literal('')),
	escaped: s.optional(s.literal('a"b\\c\n é😀')),
	yes: s.optional(s.literal(true)),
	no: s.optional(s.literal(false)),
	nothing: s.optional(s.literal(null)),
	any_of: s.optional(s.one_of(['a', 1, null, false, 0.5])),
	none_of: s.optional(s.one_of([]))
};

// each key with the texts of the values it is given
const values: Record<keyof typeof entries, Array<string>> = {
	one: [
		'1',
		'1.0',
		'1e0',
		'10e-1',
		'0.1E1',
		'1.0000000000000001',
		'1.000000000000001',
		'"1"',
		'true',
		'[1]'
	],
	zero: ['0', '-0', '0.0', '-0.0', '0e5', '-0E-5', '1e-400', 'false', 'null', '""'],
	negative_zero: ['0', '-0', '1'],
	tenth: [
		'0.1',
		'1e-1',
		'0.10',
		// the double's own decimal expansion
		'0.1000000000000000055511151231257827021181583404541015625',
		// halfway to the next double, where the tie goes to the even one
		'0.100000000000000012490009027033011079765856266021728515625',
		// and just past halfway
		'0.1000000000000000124900090270330110797658562660217285156250001',
		'0.10000000000000002',
		'0.09999999999999999'
	],
	sum: ['0.30000000000000004', '0.3', '0.30000000000000003', '0.30000000000000001'],
	large: [
		'1e21',
		'1000000000000000000000',
		'1E+21',
		'1000000000000000000001',
		'999999999999999999999'
	],
	max: [
		'1.7976931348623157e308',
		'1.7976931348623158e308',
		'179769313486231570000e288',
		'1.7976931348623156e308'
	],
	min: ['5e-324', '4.9e-324', '2.5e-324', '2.4e-324', '0'],
	text: ['"a"', String.raw`"\u0061"`, '"A"', '"a "', '""', '1', '["a"]'],
	empty: ['""', '" "', 'null'],
	escaped: [
		String.raw`"a\"b\\c\n é😀"`,
		String.raw`"a\"b\\c\n é😀"`,
		String.raw`"a\"b\\c\\n é😀"`,
		String.raw`"a\u0022b\u005cc\u000a\u2028\u00e9\ud83d\ude00"`
	],
	yes: ['true', 'false', '1', '"true"'],
	no: ['false', 'true', '0', 'null'],
	nothing: ['null', 'false', '0', '""', '[]', '{}'],
	any_of: ['"a"', '1', '1.0', 'null', 'false', '0.5', '5e-1', '"b"', '2', 'true', '0', '[]', '{}'],
	none_of: ['null', '0']
};

const cases: Record<string, JsonFixtureText> = { empty_object: '{}' };
for (const [key, texts] of Object.entries(values)) {
	texts.forEach((text, i) => {
		cases[`${key}_${i}`] = `{"${key}":${text}}`;
	});
}
// a number past what a double holds is not a number the crate reads
cases.max_overflow = { text: '{"max":1.7976931348623159e308}', diverges: 'number_overflow' };
cases.zero_overflow = { text: '{"zero":1e400}', diverges: 'number_overflow' };

export const fixture: JsonFixture = { schema: s.object(entries), cases };
