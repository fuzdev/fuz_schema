import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

export const fixture: JsonFixture = {
	// given out of JavaScript's key order, which puts `2` and `10` first
	schema: s.object({
		b: s.string,
		a: s.number,
		10: s.optional(s.boolean),
		2: s.optional(s.number),
		nested: s.optional(s.object({ a: s.number }))
	}),
	cases: {
		valid: '{"b":"x","a":1}',
		valid_all: '{"b":"x","a":1,"10":true,"2":2,"nested":{"a":1}}',
		valid_other_order: '{"nested":{"a":1},"2":2,"a":1,"10":false,"b":"x"}',
		empty: '{}',
		missing_one: '{"b":"x"}',
		wrong_one: '{"b":"x","a":"1"}',
		wrong_both: '{"b":1,"a":"1"}',
		null_entry: '{"b":null,"a":1}',
		null_optional: '{"b":"x","a":1,"2":null}',
		unknown_key: '{"b":"x","a":1,"c":3}',
		unknown_key_first: '{"c":3,"b":"x","a":1}',
		unknown_keys: '{"z":1,"b":"x","y":[],"a":1,"x":{}}',
		// entries in the schema's order, then unknown keys in the input's
		wrong_and_unknown: '{"z":1,"a":"no","7":1,"b":2,"0":null}',
		index_like_unknown_keys:
			'{"b":"x","a":1,"7":1,"3":1,"01":1,"-1":1,"4294967295":1,"4294967294":1}',
		proto_key: '{"b":"x","a":1,"__proto__":3}',
		proto_key_object: '{"b":"x","a":1,"__proto__":{"b":"y"}}',
		only_proto_key: '{"__proto__":{"b":"x","a":1}}',
		constructor_key: '{"b":"x","a":1,"constructor":1}',
		to_string_key: '{"b":"x","a":1,"toString":"x"}',
		empty_key: '{"b":"x","a":1,"":1}',
		escaped_key: String.raw`{"b":"x","\u0061":1}`,
		nested_wrong: '{"b":"x","a":1,"nested":{"a":"1"}}',
		nested_unknown: '{"b":"x","a":1,"nested":{"a":1,"b":2}}',
		nested_array: '{"b":"x","a":1,"nested":[]}',
		nested_null: '{"b":"x","a":1,"nested":null}',
		// a key written twice has its last value, at its first position
		duplicate_last_good: { text: '{"b":"x","a":"x","a":1}', diverges: 'duplicate_keys' },
		duplicate_last_bad: '{"b":"x","a":1,"a":"x"}',
		duplicate_both_good: '{"b":"x","a":1,"a":2}',
		duplicate_both_bad: '{"b":"x","a":"x","a":null}',
		duplicate_apart: { text: '{"a":[],"b":"x","a":1}', diverges: 'duplicate_keys' },
		duplicate_optional: { text: '{"b":"x","a":1,"2":"x","2":2}', diverges: 'duplicate_keys' },
		duplicate_nested: {
			text: '{"b":"x","a":1,"nested":{"a":"x","a":1}}',
			diverges: 'duplicate_keys'
		},
		duplicate_nested_object: {
			text: '{"b":"x","a":1,"nested":1,"nested":{"a":1}}',
			diverges: 'duplicate_keys'
		},
		duplicate_escaped: {
			text: String.raw`{"b":"x","a":"x","\u0061":1}`,
			diverges: 'duplicate_keys'
		},
		duplicate_escaped_last_bad: String.raw`{"b":"x","\u0061":1,"a":"x"}`,
		duplicate_unknown: '{"b":"x","a":1,"c":1,"c":2}',
		array: '[]',
		array_of_entries: '[["b","x"],["a",1]]',
		null: 'null',
		string: '"{}"',
		number: '0',
		true: 'true'
	}
};
