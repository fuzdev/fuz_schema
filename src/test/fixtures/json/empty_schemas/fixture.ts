import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// schemas with nothing in them, which match everything of a kind or nothing
const entries = {
	object: s.optional(s.object({})),
	loose_object: s.optional(s.loose_object({})),
	strip_object: s.optional(s.strip_object({})),
	record: s.optional(s.record(s.bigint)),
	array: s.optional(s.array(s.bigint)),
	union: s.optional(s.union([])),
	one_of: s.optional(s.one_of([])),
	variant: s.optional(s.variant('k', [])),
	bigint: s.optional(s.bigint),
	nullable_bigint: s.optional(s.nullable(s.bigint)),
	default_bigint: s.with_default(s.nullable(s.bigint), null),
	safe: s.optional(s.pipe(s.safe_integer, s.finite, s.integer))
};

const values = ['null', 'true', '0', '1.5', '""', '"a"', '[]', '[null]', '{}', '{"k":"k"}'];

const cases: Record<string, JsonFixtureText> = { empty: '{}' };
for (const key of Object.keys(entries)) {
	values.forEach((value, i) => {
		cases[`${key}_${i}`] = `{"${key}":${value}}`;
	});
}

export const fixture: JsonFixture = { schema: s.object(entries), cases };
