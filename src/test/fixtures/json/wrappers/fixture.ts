import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// each wrapper as an entry, where a missing key is `undefined`
const entries = {
	required: s.string,
	optional: s.optional(s.string),
	nullable: s.nullable(s.string),
	with_default: s.with_default(s.string, 'x'),
	optional_nullable: s.optional(s.nullable(s.string)),
	nullable_optional: s.nullable(s.optional(s.string)),
	default_nullable: s.with_default(s.nullable(s.number), null),
	optional_default: s.optional(s.with_default(s.string, 'y')),
	default_object: s.with_default(s.object({ a: s.number }), { a: 1 }),
	default_array: s.with_default(s.array(s.string), []),
	optional_unknown: s.optional(s.unknown),
	nullable_unknown: s.nullable(s.unknown),
	nullable_bigint: s.nullable(s.bigint)
};

// the entries that reject a missing key, present so the others are what varies
const base = '"required":"r","nullable":null,"nullable_unknown":null,"nullable_bigint":null';
const in_base = ['required', 'nullable', 'nullable_unknown', 'nullable_bigint'];

const values: Record<string, string> = {
	null: 'null',
	string: '"a"',
	number: '1',
	false: 'false',
	array: '[]',
	strings: '["a"]',
	object: '{}',
	object_a: '{"a":1}',
	object_a_wrong: '{"a":"1"}'
};

const cases: Record<string, JsonFixtureText> = {
	all_missing: '{}',
	base: `{${base}}`,
	required_missing: '{"nullable":null,"nullable_unknown":null,"nullable_bigint":null}',
	nullable_missing: '{"required":"r","nullable_unknown":null,"nullable_bigint":null}',
	// an `unknown` under a `nullable` still needs its key
	nullable_unknown_missing: '{"required":"r","nullable":null,"nullable_bigint":null}',
	nullable_bigint_missing: '{"required":"r","nullable":null,"nullable_unknown":null}'
};
for (const key of Object.keys(entries)) {
	for (const [name, value] of Object.entries(values)) {
		// a key written twice here would be a different test
		if (in_base.includes(key)) {
			const rest = base
				.split(',')
				.filter((entry) => !entry.startsWith(`"${key}"`))
				.join(',');
			cases[`${key}_${name}`] = `{${rest},"${key}":${value}}`;
		} else {
			cases[`${key}_${name}`] = `{${base},"${key}":${value}}`;
		}
	}
}

export const fixture: JsonFixture = { schema: s.object(entries), cases };
