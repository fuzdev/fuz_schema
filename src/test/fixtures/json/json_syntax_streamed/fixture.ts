import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a schema whose arrays and objects are matched as they are read, with texts
// that match it up to where they stop being JSON
export const fixture: JsonFixture = {
	schema: s.array(s.record(s.array(s.number))),
	cases: {
		valid: '[{"a":[1,2]},{"b":[]}]',
		padded: '\n[ { "a" : [ 1 , 2 ] } ]\n\n',
		trailing_comma_inner: '[{"a":[1,2,]}]',
		trailing_comma_object: '[{"a":[1,2],}]',
		trailing_comma_outer: '[{"a":[1,2]},]',
		leading_comma_object: '[{,"a":[1]}]',
		double_comma: '[{"a":[1,,2]}]',
		missing_comma: '[{"a":[1 2]}]',
		missing_comma_objects: '[{"a":[1]} {"b":[2]}]',
		missing_colon: '[{"a" [1]}]',
		missing_value: '[{"a":[1],"b"}]',
		single_quoted_key: "[{'a':[1]}]",
		unquoted_key: '[{a:[1]}]',
		mismatched_close: '[{"a":[1]]',
		unterminated: '[{"a":[1]}',
		unterminated_inner: '[{"a":[1',
		extra_close: '[{"a":[1]}]]',
		trailing_value: '[{"a":[1]}] []',
		line_comment: '[{"a":[1]}] // x',
		leading_zero: '[{"a":[01]}]',
		trailing_point: '[{"a":[1.]}]',
		only_minus: '[{"a":[-]}]',
		leading_plus: '[{"a":[+1]}]',
		nan: '[{"a":[NaN]}]',
		infinity: '[{"a":[Infinity]}]',
		raw_tab_in_key: '[{"a\tb":[1]}]',
		bad_escape_in_key: String.raw`[{"\x":[1]}]`,
		escaped_key: String.raw`[{"\u0061\ud83d\ude00":[1]}]`,
		overflow: { text: '[{"a":[1,1e400]}]', diverges: 'number_overflow' },
		lone_surrogate_in_key: { text: String.raw`[{"a\ud800":[1]}]`, diverges: 'lone_surrogate' }
	}
};
