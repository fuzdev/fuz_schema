import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// where an object stops matching: at a wrong value, and at an unknown key
// before its value is read, but a missing key only at the closing brace
export const fixture: JsonFixture = {
	schema: s.object({ a: s.number, b: s.optional(s.array(s.string)) }),
	cases: {
		valid: '{"a":1,"b":["x"]}',
		wrong_then_malformed: { text: '{"a":"x",}', diverges: 'malformed_tail' },
		wrong_then_cut_short: { text: '{"a":null', diverges: 'malformed_tail' },
		wrong_item_then_malformed: { text: '{"a":1,"b":[1,}', diverges: 'malformed_tail' },
		unknown_key_then_malformed: { text: '{"z":1,]', diverges: 'malformed_tail' },
		unknown_key_without_colon: { text: '{"a":1,"z"', diverges: 'malformed_tail' },
		unknown_key_without_value: { text: '{"a":1,"z":}', diverges: 'malformed_tail' },
		unknown_key_cut_short: '{"a":1,"z',
		right_item_then_malformed: '{"a":1,"b":["x",}',
		cut_short: '{"a":1',
		// nothing has failed until the object closes without `a`
		missing_then_malformed: '{"b":[],}',
		missing_then_cut_short: '{"b":[]',
		missing: '{"b":[]}',
		// and then it has, before what follows the object is read
		missing_then_trailing: { text: '{"b":[]} x', diverges: 'malformed_tail' },
		wrong_then_overflow: { text: '{"a":"x","b":[1e400]}', diverges: 'number_overflow_unread' },
		unknown_key_then_lone_surrogate: {
			text: String.raw`{"z":"\ud800","a":1}`,
			diverges: 'lone_surrogate_unread'
		}
	}
};
