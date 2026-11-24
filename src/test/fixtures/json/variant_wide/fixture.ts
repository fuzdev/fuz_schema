import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// more values than the crate searches in order, so its table is read through
// its sorted index: of every type a literal has, two that sort as one (`0`
// and `-0`), and values given twice, whose later option is the one selected
export const fixture: JsonFixture = {
	schema: s.variant('k', [
		s.object({ k: s.literal('m'), a: s.number }),
		s.object({ k: s.literal(10) }),
		s.object({ k: s.literal('b') }),
		s.object({ k: s.literal(true) }),
		s.object({ k: s.literal(-1.5) }),
		s.object({ k: s.literal(null) }),
		s.object({ k: s.literal('') }),
		s.object({ k: s.literal(0), zero: s.optional(s.string) }),
		s.object({ k: s.literal(false) }),
		s.object({ k: s.literal('z') }),
		s.object({ k: s.literal(2) }),
		s.object({ k: s.literal('10') }),
		// given again: each replaces the option of its value, at that value's place
		s.object({ k: s.literal('m'), b: s.string }),
		s.object({ k: s.literal(-0), minus: s.optional(s.string) }),
		s.object({ k: s.literal('a') })
	]),
	cases: {
		string_given_twice_later: '{"k":"m","b":"x"}',
		string_given_twice_first: '{"k":"m","a":1}',
		string_first_sorted: '{"k":""}',
		string_last_sorted: '{"k":"z"}',
		string_between: '{"k":"b"}',
		string_of_a_number: '{"k":"10"}',
		string_added_last: '{"k":"a"}',
		string_missing: '{"k":"c"}',
		string_before_every_one: '{"k":" "}',
		string_after_every_one: '{"k":"zz"}',
		number: '{"k":10}',
		number_float: '{"k":10.0}',
		number_negative: '{"k":-1.5}',
		number_two: '{"k":2}',
		number_missing: '{"k":3}',
		number_below_every_one: '{"k":-2}',
		number_above_every_one: '{"k":1e21}',
		zero_takes_the_later: '{"k":0,"minus":"x"}',
		zero_refuses_the_first: '{"k":0,"zero":"x"}',
		negative_zero: '{"k":-0,"minus":"x"}',
		true_value: '{"k":true}',
		false_value: '{"k":false}',
		null_value: '{"k":null}',
		array_value: '{"k":[]}',
		object_value: '{"k":{}}',
		missing_key: '{}',
		discriminator_last: '{"b":"x","k":"m"}',
		not_an_object: '[]'
	}
};
