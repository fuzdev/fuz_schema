import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const deep = `${'['.repeat(200)}${']'.repeat(200)}`;

// a union no option of which an array could match: an array fails before any
// of it is read, whatever it holds
export const fixture: JsonFixture = {
	schema: s.union([s.string, s.number, s.nullable(s.object({ a: s.number }))]),
	cases: {
		string: '"x"',
		number: '1',
		null: 'null',
		object: '{"a":1}',
		boolean: 'true',
		empty_array: '[]',
		array: '[1]',
		array_of_object: '[{"a":1}]',
		array_then_trailing: { text: '[] x', diverges: 'malformed_tail' },
		array_cut_short: { text: '[', diverges: 'malformed_tail' },
		array_malformed: { text: '[1,}', diverges: 'malformed_tail' },
		array_of_overflow: { text: '[1e400]', diverges: 'number_overflow_unread' },
		array_of_lone_surrogate: { text: String.raw`["\ud800"]`, diverges: 'lone_surrogate_unread' },
		deep_array: { text: deep, diverges: 'depth_limit_unread' },
		// the one option an object could match is matched as it is read
		object_wrong: '{"a":"1"}',
		object_duplicate_last_good: { text: '{"a":"x","a":1}', diverges: 'duplicate_keys' },
		object_wrong_then_malformed: { text: '{"a":"x",}', diverges: 'malformed_tail' },
		object_malformed: '{"a":1,}'
	}
};
