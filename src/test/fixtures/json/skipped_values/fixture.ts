import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const deep = `${'['.repeat(200)}${']'.repeat(200)}`;

// values a schema accepts whatever they are, which the streaming evaluator
// skips without reading
export const fixture: JsonFixture = {
	schema: s.object({
		any: s.unknown,
		items: s.optional(s.array(s.unknown)),
		map: s.optional(s.record(s.nullable(s.optional(s.unknown)))),
		loose: s.optional(s.loose_object({ a: s.number })),
		strip: s.optional(s.strip_object({})),
		either: s.optional(s.union([s.string, s.lazy(() => s.unknown)]))
	}),
	cases: {
		empty: '{}',
		valid:
			'{"any":[1,{"a":null}],"items":[1,"a"],"map":{"a":1},"loose":{"a":1,"b":2},"strip":{"c":3},"either":[]}',
		any_missing: '{"items":[]}',
		any_overflow: { text: '{"any":1e400}', diverges: 'number_overflow_unread' },
		any_lone_surrogate: { text: String.raw`{"any":"\ud800"}`, diverges: 'lone_surrogate_unread' },
		any_lone_surrogate_key: {
			text: String.raw`{"any":{"\udc00":1}}`,
			diverges: 'lone_surrogate_unread'
		},
		any_deep: { text: `{"any":${deep}}`, diverges: 'depth_limit_unread' },
		items_overflow: { text: '{"items":[1,-1e400]}', diverges: 'number_overflow_unread' },
		items_lone_surrogate: {
			text: String.raw`{"items":["a\ud800b"]}`,
			diverges: 'lone_surrogate_unread'
		},
		items_deep: { text: `{"items":[${deep}]}`, diverges: 'depth_limit_unread' },
		map_overflow: { text: '{"map":{"a":1e400}}', diverges: 'number_overflow_unread' },
		// a key is always read
		map_lone_surrogate_key: { text: String.raw`{"map":{"\ud800":1}}`, diverges: 'lone_surrogate' },
		loose_overflow: { text: '{"loose":{"a":1,"b":1e400}}', diverges: 'number_overflow_unread' },
		loose_entry_overflow: { text: '{"loose":{"a":1e400}}', diverges: 'number_overflow' },
		loose_deep: { text: `{"loose":{"b":${deep},"a":1}}`, diverges: 'depth_limit_unread' },
		strip_lone_surrogate: {
			text: String.raw`{"strip":{"a":"\ud800"}}`,
			diverges: 'lone_surrogate_unread'
		},
		either_overflow: { text: '{"either":1e400}', diverges: 'number_overflow_unread' },
		either_deep: { text: `{"either":${deep}}`, diverges: 'depth_limit_unread' },
		// skipped is still JSON or not
		any_trailing_comma: '{"any":[1,]}',
		any_leading_zero: '{"any":01}',
		any_raw_tab: '{"any":"\t"}',
		any_bad_escape: String.raw`{"any":"\x"}`,
		any_short_escape: String.raw`{"any":"\u12"}`,
		any_cut_short: '{"any":[1',
		any_single_quotes: '{"any":\'a\'}',
		any_nan: '{"any":NaN}',
		any_mismatched: '{"any":[{]}}',
		loose_unknown_trailing_comma: '{"loose":{"a":1,"b":{"c":1,}}}',
		// and what is not skipped is checked
		loose_wrong: '{"loose":{"a":"1","b":1}}',
		strip_not_object: '{"strip":[]}',
		items_not_array: '{"items":{}}',
		unknown_key: '{"other":1}'
	}
};
