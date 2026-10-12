import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

export const fixture: JsonFixture = {
	schema: s.record(s.record(s.number)),
	cases: {
		empty: '{}',
		empty_inner: '{"a":{}}',
		valid: '{"a":{"x":1,"y":2},"b":{"z":-1.5}}',
		any_key: '{"":{"":0},"a b":{"é":1,"😀":2},"0":{"1":1}}',
		proto_key: '{"__proto__":{"a":1}}',
		proto_key_inner: '{"a":{"__proto__":1}}',
		proto_key_wrong: '{"a":{"__proto__":"x"}}',
		proto_key_not_object: '{"__proto__":1}',
		prototype_member_keys: '{"constructor":{"toString":1,"valueOf":2}}',
		wrong_value: '{"a":{"x":"1"}}',
		wrong_first: '{"a":{"x":null,"y":1}}',
		wrong_last: '{"a":{"x":1},"b":{"y":true}}',
		// keys that are indices come first, whatever order they are written in
		wrong_in_key_order: '{"b":{"z":"x","10":"x","2":"x"},"1":null,"a":[]}',
		inner_array: '{"a":[1]}',
		inner_null: '{"a":null}',
		inner_number: '{"a":1}',
		duplicate_last_good: { text: '{"a":{"x":"x","x":1}}', diverges: 'duplicate_keys' },
		duplicate_last_bad: '{"a":{"x":1,"x":"x"}}',
		duplicate_outer_last_good: { text: '{"a":1,"b":{},"a":{}}', diverges: 'duplicate_keys' },
		duplicate_outer_last_bad: '{"a":{},"b":{},"a":1}',
		duplicate_both_good: '{"a":{"x":1,"x":2}}',
		// a key is read, and one with half a surrogate pair is refused, where
		// JavaScript keeps it
		lone_surrogate_key: { text: String.raw`{"a":{"\ud800":1}}`, diverges: 'lone_surrogate' },
		lone_surrogate_outer_key: { text: String.raw`{"\udc00":{}}`, diverges: 'lone_surrogate' },
		wrong_then_lone_surrogate_key: {
			text: String.raw`{"a":1,"\ud800":{}}`,
			diverges: 'lone_surrogate_unread'
		},
		array: '[]',
		array_of_objects: '[{"a":1}]',
		null: 'null',
		string: '"a"'
	}
};
