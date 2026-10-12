import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const deep = `${'{"a":'.repeat(200)}1${'}'.repeat(200)}`;

// a union no option of which an object could match, through a wrapper and a
// union in it: an object fails before any of it is read, whatever it holds
export const fixture: JsonFixture = {
	schema: s.union([s.string, s.nullable(s.array(s.number)), s.union([s.boolean, s.integer])]),
	cases: {
		string: '"x"',
		integer: '1',
		null: 'null',
		array: '[1]',
		empty_object: '{}',
		object: '{"a":1}',
		object_of_array: '{"a":[1]}',
		object_duplicate: '{"a":1,"a":2}',
		object_then_trailing: { text: '{} x', diverges: 'malformed_tail' },
		object_cut_short: { text: '{', diverges: 'malformed_tail' },
		object_malformed: { text: '{"a":1,}', diverges: 'malformed_tail' },
		object_of_overflow: { text: '{"a":1e400}', diverges: 'number_overflow_unread' },
		object_of_lone_surrogate_key: {
			text: String.raw`{"\ud800":1}`,
			diverges: 'lone_surrogate_unread'
		},
		deep_object: { text: deep, diverges: 'depth_limit_unread' },
		// the one option an array could match is matched as it is read
		array_wrong: '["1"]',
		array_wrong_then_malformed: { text: '["1",}', diverges: 'malformed_tail' },
		array_malformed: '[1,}'
	}
};
