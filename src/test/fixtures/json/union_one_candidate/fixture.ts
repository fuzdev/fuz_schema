import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const deep = `${'['.repeat(200)}${']'.repeat(200)}`;

// a union with one option an array could match, and one an object could: each
// is matched against that option as it is read, so what the streaming
// evaluator is stricter about, it is stricter about here
export const fixture: JsonFixture = {
	schema: s.array(
		s.union([
			s.string,
			s.literal(null),
			s.array(s.number),
			s.object({ name: s.string, n: s.optional(s.number) })
		])
	),
	cases: {
		every_option: '["x",null,[1,2],{"name":"a"},[],{"n":1,"name":"a"}]',
		wrong_scalar: '[1]',
		wrong_item: '[[1,"x"]]',
		nested_array: '[[[1]]]',
		empty_object: '[{}]',
		unknown_key: '[{"name":"a","other":1}]',
		wrong_entry: '[{"name":"a","n":"1"}]',
		duplicate_both_good: '[{"name":"a","name":"b"}]',
		duplicate_last_good: { text: '[{"name":1,"name":"a"}]', diverges: 'duplicate_keys' },
		duplicate_last_bad: '[{"name":"a","name":1}]',
		duplicate_optional_last_good: {
			text: '[{"name":"a","n":"x","n":1}]',
			diverges: 'duplicate_keys'
		},
		wrong_item_then_malformed: { text: '[[1,"x",}', diverges: 'malformed_tail' },
		wrong_entry_then_malformed: { text: '[{"name":1,}', diverges: 'malformed_tail' },
		unknown_key_then_malformed: { text: '[{"other":}', diverges: 'malformed_tail' },
		valid_then_malformed: '[[1,2],}',
		valid_object_then_malformed: '[{"name":"a",}]',
		overflow: { text: '[[1e400]]', diverges: 'number_overflow' },
		wrong_item_then_overflow: { text: '[["x",1e400]]', diverges: 'number_overflow_unread' },
		unknown_key_overflow: { text: '[{"other":1e400}]', diverges: 'number_overflow_unread' },
		lone_surrogate: { text: String.raw`[{"name":"\ud800"}]`, diverges: 'lone_surrogate' },
		wrong_entry_then_lone_surrogate: {
			text: String.raw`[{"name":1,"n":"\ud800"}]`,
			diverges: 'lone_surrogate_unread'
		},
		wrong_item_then_deep: { text: `[["x",${deep}]]`, diverges: 'depth_limit_unread' }
	}
};
