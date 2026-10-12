import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

export const fixture: JsonFixture = {
	schema: s.array(s.array(s.object({ n: s.number }))),
	cases: {
		empty: '[]',
		empty_inner: '[[]]',
		valid: '[[{"n":1},{"n":2}],[],[{"n":3}]]',
		padded: ' [ [ { "n" : 1 } , { "n" : 2 } ] , [ ] ] ',
		wrong_first: '[[{"n":"1"},{"n":2}],[{"n":3}]]',
		wrong_last: '[[{"n":1},{"n":2}],[{"n":null}]]',
		wrong_every: '[[{"n":"a"},{"m":1}],[1],null]',
		item_not_array: '[{"n":1}]',
		item_null: '[null]',
		inner_item_not_object: '[[1]]',
		inner_item_array: '[[[]]]',
		too_deep: '[[[{"n":1}]]]',
		object: '{"0":[]}',
		object_like_array: '{"length":0}',
		null: 'null',
		string: '"[]"',
		number: '0'
	}
};
