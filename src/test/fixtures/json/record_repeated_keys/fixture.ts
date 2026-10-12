import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a key written twice has its last value, at the place of its first, and
// `__proto__` is a key like any other to `JSON.parse`
export const fixture: JsonFixture = {
	schema: s.record(s.number),
	cases: {
		proto: '{"__proto__":1}',
		proto_wrong: '{"__proto__":"x"}',
		proto_last_good: { text: '{"__proto__":"x","__proto__":2}', diverges: 'duplicate_keys' },
		proto_last_bad: '{"__proto__":1,"__proto__":"x"}',
		proto_object_last_good: {
			text: '{"__proto__":{"a":"x"},"__proto__":2}',
			diverges: 'duplicate_keys'
		},
		around_index_last_good: { text: '{"b":"x","1":2,"b":3}', diverges: 'duplicate_keys' },
		around_index_last_bad: '{"b":3,"1":2,"b":"x"}',
		index_last_good: { text: '{"1":"x","b":2,"1":3}', diverges: 'duplicate_keys' },
		three_times: { text: '{"a":1,"a":"x","a":3}', diverges: 'duplicate_keys' }
	}
};
