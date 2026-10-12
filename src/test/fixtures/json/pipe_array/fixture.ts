import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

export const fixture: JsonFixture = {
	schema: s.object({
		bounded: s.optional(s.pipe(s.pipe(s.array(s.number), s.min_length(1)), s.max_length(3))),
		pairs: s.optional(s.array(s.pipe(s.array(s.unknown), s.min_length(2), s.max_length(2)))),
		fractional: s.optional(s.pipe(s.array(s.unknown), s.min_length(0.5), s.max_length(1.5))),
		nullable: s.optional(s.nullable(s.pipe(s.array(s.string), s.max_length(1))))
	}),
	cases: {
		bounded_empty: '{"bounded":[]}',
		bounded_one: '{"bounded":[1]}',
		bounded_three: '{"bounded":[1,2,3]}',
		bounded_four: '{"bounded":[1,2,3,4]}',
		// the array's own failures end the pipe, and no length is asked of it
		bounded_wrong_item: '{"bounded":[1,"2"]}',
		bounded_wrong_items_too_many: '{"bounded":["1",2,3,4,null]}',
		bounded_string: '{"bounded":"ab"}',
		bounded_object: '{"bounded":{"length":2}}',
		bounded_null: '{"bounded":null}',
		pairs_empty: '{"pairs":[]}',
		pairs: '{"pairs":[[1,"a"],[null,[]]]}',
		pairs_short: '{"pairs":[[1,2],[1]]}',
		pairs_long: '{"pairs":[[1,2,3],[1,2]]}',
		pairs_not_array: '{"pairs":[[1,2],"ab"]}',
		fractional_empty: '{"fractional":[]}',
		fractional_one: '{"fractional":[null]}',
		fractional_two: '{"fractional":[1,2]}',
		nullable_null: '{"nullable":null}',
		nullable_one: '{"nullable":["a"]}',
		nullable_two: '{"nullable":["a","b"]}',
		nullable_wrong: '{"nullable":[1]}'
	}
};
