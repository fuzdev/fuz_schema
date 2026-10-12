import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const deep = `${'['.repeat(200)}${']'.repeat(200)}`;

// the streaming evaluator stops at the first failure and reads no further, so
// what follows one can be anything
export const fixture: JsonFixture = {
	schema: s.array(s.number),
	cases: {
		valid: '[1,2,3]',
		first_wrong: '["x",1,2]',
		last_wrong: '[1,2,"x"]',
		first_wrong_then_malformed: { text: '["x",1,}', diverges: 'malformed_tail' },
		first_wrong_then_cut_short: { text: '["x",1', diverges: 'malformed_tail' },
		first_wrong_then_not_json: { text: '["x" this is not JSON', diverges: 'malformed_tail' },
		last_wrong_then_malformed: { text: '[1,2,"x"} ]', diverges: 'malformed_tail' },
		wrong_then_trailing_value: { text: '[null] []', diverges: 'malformed_tail' },
		// a token is read whole before it is anything
		malformed_then_wrong: '[1,} "x"]',
		cut_short_before_wrong: '[1,',
		wrong_token_cut_short: '[1,"x',
		wrong_token_bad_escape: String.raw`[1,"\x"]`,
		not_array_then_malformed: { text: '{"a":', diverges: 'malformed_tail' },
		not_array_then_mismatched: { text: '{]', diverges: 'malformed_tail' },
		string_then_trailing: { text: '"x" y', diverges: 'malformed_tail' },
		true_then_trailing: { text: 'truex', diverges: 'malformed_tail' },
		null_then_trailing: { text: 'nullx', diverges: 'malformed_tail' },
		// a number is a token too, and this one is not a number
		leading_zero: '01',
		leading_zero_item: '[01]',
		not_json_from_the_start: 'x["x"]',
		valid_then_trailing: '[1] x',
		// what the parser refuses, after the failure and before it
		wrong_then_overflow: { text: '["x",1e400]', diverges: 'number_overflow_unread' },
		overflow_then_wrong: { text: '[1e400,"x"]', diverges: 'number_overflow' },
		wrong_then_lone_surrogate: {
			text: String.raw`[null,"\ud800"]`,
			diverges: 'lone_surrogate_unread'
		},
		lone_surrogate_then_wrong: { text: String.raw`["\ud800",null]`, diverges: 'lone_surrogate' },
		wrong_then_deep: { text: `[null,${deep}]`, diverges: 'depth_limit_unread' },
		deep_then_wrong: { text: `[${deep},null]`, diverges: 'depth_limit_unread' },
		not_array_and_deep: { text: `{"a":${deep}}`, diverges: 'depth_limit_unread' }
	}
};
