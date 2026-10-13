import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// every primitive against every type of JSON value, each at its own key
const entries = {
	string: s.optional(s.string),
	number: s.optional(s.number),
	boolean: s.optional(s.boolean),
	bigint: s.optional(s.bigint),
	unknown: s.optional(s.unknown)
};

const values: Record<string, string> = {
	null: 'null',
	true: 'true',
	false: 'false',
	zero: '0',
	number: '-1.5e3',
	empty_string: '""',
	string: '"a"',
	number_in_string: '"1"',
	array: '[]',
	array_of_one: '[1]',
	object: '{}',
	object_of_one: '{"a":1}'
};

const cases: Record<string, JsonFixtureText> = { empty: '{}' };
for (const key of Object.keys(entries)) {
	for (const [name, value] of Object.entries(values)) {
		cases[`${key}_${name}`] = `{"${key}":${value}}`;
	}
}
// a number of any size is one, an integer past the safe ones among them
for (const [name, text] of Object.entries({
	largest: '1.7976931348623157e308',
	most_negative: '-1.7976931348623157e308',
	smallest: '5e-324',
	underflow: '1e-999',
	past_safe: '9007199254740993',
	huge_integer: '123456789012345678901234567890',
	huge_integer_by_digits: `1${'0'.repeat(308)}`
})) {
	cases[`number_${name}`] = `{"number":${text}}`;
}
// and one past a double is an infinity to `JSON.parse`, which `number` refuses
// and `unknown` takes, and which the crate's parser doesn't read
for (const [name, text] of Object.entries({
	overflow: '1e999',
	negative_overflow: '-1e999',
	overflow_by_digits: `1${'0'.repeat(400)}`,
	just_past_largest: '1.7976931348623159e308'
})) {
	cases[`number_${name}`] = { text: `{"number":${text}}`, diverges: 'number_overflow' };
	cases[`string_${name}`] = { text: `{"string":${text}}`, diverges: 'number_overflow' };
	cases[`unknown_${name}`] = { text: `{"unknown":${text}}`, diverges: 'number_overflow_unread' };
}
cases.all = '{"string":"a","number":1,"boolean":true,"unknown":null}';
cases.all_with_bigint = '{"string":"a","number":1,"boolean":true,"bigint":1,"unknown":null}';

export const fixture: JsonFixture = { schema: s.object(entries), cases };
