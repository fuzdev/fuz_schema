import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// the two object schemas that take unknown keys, which differ only in output
const entries = { a: s.number, b: s.optional(s.string) };

const inner: Record<string, JsonFixtureText> = {
	valid: '{"a":1}',
	valid_all: '{"a":1,"b":"x"}',
	unknown_keys: '{"z":[1,{"y":null}],"a":1,"x":"x"}',
	unknown_first_and_last: '{"c":1,"a":1,"d":2}',
	proto_key: '{"a":1,"__proto__":{"a":"x"}}',
	only_proto_key: '{"__proto__":{"a":1}}',
	empty: '{}',
	missing: '{"b":"x","c":1}',
	wrong: '{"a":"1","c":1}',
	wrong_optional: '{"a":1,"b":2}',
	duplicate_unknown: '{"a":1,"c":1,"c":"x"}',
	duplicate_last_good: { text: '{"a":"x","c":1,"a":1}', diverges: 'duplicate_keys' },
	duplicate_last_bad: '{"a":1,"c":1,"a":"x"}',
	array: '[]',
	null: 'null',
	number: '1'
};

const cases: Record<string, JsonFixtureText> = {};
for (const kind of ['loose', 'strip']) {
	for (const [name, input] of Object.entries(inner)) {
		const wrap = (text: string): string => `{"${kind}":${text}}`;
		cases[`${kind}_${name}`] =
			typeof input === 'string'
				? wrap(input)
				: { text: wrap(input.text), diverges: input.diverges };
	}
}
cases.both = '{"loose":{"a":1,"c":1},"strip":{"a":2,"c":2}}';
cases.neither = '{}';

export const fixture: JsonFixture = {
	schema: s.object({
		loose: s.optional(s.loose_object(entries)),
		strip: s.optional(s.strip_object(entries))
	}),
	cases
};
