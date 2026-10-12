import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a length asked of an array, and of each array in it
export const fixture: JsonFixture = {
	schema: s.pipe(s.array(s.pipe(s.array(s.number), s.min_length(1))), s.min_length(1)),
	cases: {
		one_of_one: '[[1]]',
		inner_empty: '[[]]',
		empty: '[]',
		second_inner_empty: '[[1],[]]',
		two_of_two: '[[1,2],[3,4]]',
		inner_wrong: '[[1,"2"]]',
		inner_not_array: '[1]',
		not_array: '{}',
		inner_empty_then_malformed: { text: '[[],}', diverges: 'malformed_tail' }
	}
};
