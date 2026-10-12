import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// numbers whose text in an issue's `expected` is what `String` makes of them:
// plain digits while the point falls within twenty-one of the first digit or
// six zeros before it, an exponent past either, the fewest digits that read
// back, and no sign on a zero
const numbers: Record<string, number> = {
	one: 1,
	negative: -1.5,
	negative_zero: -0,
	tenth: 0.1,
	sum: 0.1 + 0.2,
	third: 1 / 3,
	hundred: 100,
	safe: Number.MAX_SAFE_INTEGER,
	past_safe: 2 ** 53 + 2,
	e15_and_a_half: 1e15 + 0.5,
	e20: 1e20,
	below_e21: 1e21 - 2 ** 17,
	rounded: 123456789012345680000,
	two_to_69: 2 ** 69,
	two_to_70: 2 ** 70,
	e21: 1e21,
	negative_e21: -1e21,
	past_e21: 1.2345678901234568e21,
	e100: 1e100,
	e300: 1e300,
	max: Number.MAX_VALUE,
	negative_max: -Number.MAX_VALUE,
	e_6: 1e-6,
	e_6_digits: 0.0000015,
	below_e_6: 9.5e-7,
	e_7: 1e-7,
	e_7_digits: 1.234e-7,
	negative_e_7: -1e-7,
	min_normal: 2.2250738585072014e-308,
	min: Number.MIN_VALUE,
	negative_min: -Number.MIN_VALUE,
	// exactly halfway between two runs of the fewest digits, where the one
	// whose last digit is even is written: the lower, the higher, and a
	// single-precision number, which often is one
	tie_lower: 703.2810668945312,
	tie_higher: 936.5509643554688,
	negative_tie: -19.037551879882812,
	tie_single: Math.fround(232.1)
};

const entries: Record<string, s.AnySchema> = {
	any_of: s.optional(s.one_of(Object.values(numbers))),
	longer: s.optional(s.pipe(s.string, s.min_length(1e21))),
	shorter: s.optional(s.pipe(s.string, s.max_length(-1e-7))),
	between: s.optional(s.pipe(s.array(s.unknown), s.min_length(0.5), s.max_length(1.5)))
};
const cases: Record<string, JsonFixtureText> = {
	none: '{}',
	any_of_other: '{"any_of":2}',
	any_of_string: '{"any_of":"1"}',
	longer_string: '{"longer":"a"}',
	shorter_empty: '{"shorter":""}',
	between_empty: '{"between":[]}',
	between_one: '{"between":[1]}',
	between_two: '{"between":[1,2]}'
};
// the bounds no number is outside of fail nothing, and every other one does
const lowest = JSON.stringify(-Number.MAX_VALUE);
const highest = JSON.stringify(Number.MAX_VALUE);
for (const [name, number] of Object.entries(numbers)) {
	entries[`min_${name}`] = s.optional(s.pipe(s.number, s.min_value(number)));
	entries[`max_${name}`] = s.optional(s.pipe(s.number, s.max_value(number)));
	entries[`literal_${name}`] = s.optional(s.literal(number));
	const text = JSON.stringify(number);
	cases[`${name}_equal`] =
		`{"min_${name}":${text},"max_${name}":${text},"literal_${name}":${text}}`;
	cases[`${name}_outside`] =
		`{"min_${name}":${lowest},"max_${name}":${highest},"literal_${name}":"${text}"}`;
	cases[`${name}_not_number`] = `{"min_${name}":"${text}","max_${name}":null}`;
}
cases.negative_zero_written =
	'{"min_negative_zero":-0.0,"max_negative_zero":-0e0,"literal_negative_zero":-0}';
cases.negative_zero_below = '{"min_negative_zero":-5e-324,"max_negative_zero":5e-324}';
cases.e21_written_plainly =
	'{"literal_e21":1000000000000000000000,"max_e21":1000000000000000000001}';
cases.e21_next = '{"literal_e21":1000000000000000100000,"max_e21":1000000000000000100000}';

export const fixture: JsonFixture = { schema: s.object(entries), cases };
