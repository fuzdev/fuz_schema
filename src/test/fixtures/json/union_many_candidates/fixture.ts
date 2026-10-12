import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a union with two options an array could match, and two an object could:
// which one does is not known until the value is whole, so it is read whole,
// and agrees with the library on what it reads
export const fixture: JsonFixture = {
	schema: s.union([
		s.array(s.string),
		s.array(s.number),
		s.object({ a: s.string }),
		s.object({ a: s.number, b: s.optional(s.boolean) }),
		s.literal(null)
	]),
	cases: {
		strings: '["a","b"]',
		numbers: '[1,2]',
		empty_array: '[]',
		mixed: '[1,"a"]',
		first_object: '{"a":"x"}',
		second_object: '{"a":1,"b":true}',
		neither_object: '{"a":"x","b":true}',
		empty_object: '{}',
		null: 'null',
		string: '"a"',
		duplicate_last_good: '{"a":true,"a":1}',
		duplicate_last_bad: '{"a":1,"a":true}',
		duplicate_changes_option: '{"a":"x","b":true,"a":1}',
		mixed_then_malformed: '[1,"a",}',
		wrong_then_malformed: '{"a":true,}',
		wrong_then_cut_short: '[true',
		overflow: { text: '[1e400]', diverges: 'number_overflow' },
		wrong_then_overflow: { text: '[true,1e400]', diverges: 'number_overflow' },
		wrong_then_lone_surrogate: {
			text: String.raw`{"a":true,"b":"\ud800"}`,
			diverges: 'lone_surrogate'
		}
	}
};
