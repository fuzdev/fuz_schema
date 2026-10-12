import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// every primitive against every type of JSON value, each at its own key
const entries = {
	string: s.optional(s.string),
	number: s.optional(s.number),
	boolean: s.optional(s.boolean),
	bigint: s.optional(s.bigint),
	unknown: s.unknown
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
cases.all = '{"string":"a","number":1,"boolean":true,"unknown":null}';
cases.all_with_bigint = '{"string":"a","number":1,"boolean":true,"bigint":1,"unknown":null}';

export const fixture: JsonFixture = { schema: s.object(entries), cases };
