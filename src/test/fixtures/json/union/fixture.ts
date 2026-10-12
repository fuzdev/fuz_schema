import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const option: s.AnySchema = s.union([
	s.string,
	s.pipe(s.number, s.integer),
	s.object({ a: s.string }),
	s.object({ a: s.number, c: s.optional(s.boolean) }),
	s.array(s.number),
	s.lazy(() => s.literal(null)),
	s.union([s.literal(true), s.pipe(s.array(s.string), s.min_length(2))])
]);

export const fixture: JsonFixture = {
	schema: s.array(option),
	cases: {
		empty: '[]',
		every_option: '["x",1,{"a":"x"},{"a":1},{"a":1,"c":true},[1,2],null,true,["a","b"]]',
		string: '[""]',
		integer: '[1e2]',
		not_integer: '[1.5]',
		first_object: '[{"a":"x"}]',
		second_object: '[{"a":1,"c":false}]',
		neither_object: '[{"a":true}]',
		mixed_object: '[{"a":"x","c":true}]',
		empty_object: '[{}]',
		unknown_key: '[{"a":1,"d":1}]',
		numbers: '[[1,2,3]]',
		empty_array: '[[]]',
		one_string: '[["a"]]',
		two_strings: '[["a","b"]]',
		mixed_array: '[[1,"a"]]',
		false: '[false]',
		nested_array: '[[[1]]]',
		no_match_last: '["x",1,null,false]',
		no_match_first: '[false,"x",1]',
		not_array: '"x"',
		// an object or array is read whole before any option is tried, so a key
		// written twice has its last value here as it does in JavaScript
		duplicate_last_good: '[{"a":true,"a":"x"}]',
		duplicate_last_bad: '[{"a":"x","a":true}]',
		duplicate_changes_option: '[{"a":"x","c":true,"a":1}]'
	}
};
