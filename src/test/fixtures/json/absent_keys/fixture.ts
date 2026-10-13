import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a key that is not there is `undefined`, which more than a wrapper around the
// entry can accept: an option of a union, and what a lazy defers to. An
// `unknown` needs its key, as the entry itself and as an option of a union
export const fixture: JsonFixture = {
	schema: s.object({
		optional_option: s.optional(s.object({ u: s.union([s.number, s.optional(s.string)]) })),
		default_option: s.optional(s.object({ u: s.union([s.number, s.with_default(s.string, 'x')]) })),
		lazy_optional: s.optional(s.object({ u: s.lazy(() => s.optional(s.string)) })),
		unknown_option: s.optional(s.object({ u: s.union([s.string, s.unknown]) })),
		nullable_option: s.optional(s.object({ u: s.union([s.string, s.nullable(s.number)]) })),
		unknown_entries: s.optional(
			s.object({ l: s.loose_object({ a: s.unknown }), t: s.strip_object({ a: s.unknown }) })
		),
		integer: s.optional(s.object({ i: s.integer }))
	}),
	cases: {
		none: '{}',
		optional_option_absent: '{"optional_option":{}}',
		optional_option_null: '{"optional_option":{"u":null}}',
		optional_option_string: '{"optional_option":{"u":"a"}}',
		default_option_absent: '{"default_option":{}}',
		default_option_wrong: '{"default_option":{"u":true}}',
		lazy_optional_absent: '{"lazy_optional":{}}',
		lazy_optional_wrong: '{"lazy_optional":{"u":1}}',
		unknown_option_absent: '{"unknown_option":{}}',
		// `null` is not a missing key
		nullable_option_absent: '{"nullable_option":{}}',
		nullable_option_null: '{"nullable_option":{"u":null}}',
		unknown_entries_absent: '{"unknown_entries":{"l":{},"t":{}}}',
		unknown_entries_present: '{"unknown_entries":{"l":{"a":null},"t":{"a":0}}}',
		integer_absent: '{"integer":{}}'
	}
};
