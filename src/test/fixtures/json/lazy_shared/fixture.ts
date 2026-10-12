import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// several lazies: two that defer to one schema, two schemas that defer to each
// other, and one that defers to a schema also held directly
const leaf = s.object({ v: s.number });

const a: s.AnySchema = s.object({
	b: s.optional(s.lazy(() => b)),
	leaf: s.optional(s.lazy(() => leaf)),
	other_leaf: s.optional(s.lazy(() => leaf)),
	held_leaf: s.optional(leaf),
	list: s.optional(s.array(s.nullable(s.lazy(() => a))))
});

const b: s.AnySchema = s.loose_object({
	a: s.optional(s.lazy(() => a)),
	n: s.number
});

export const fixture: JsonFixture = {
	schema: a,
	cases: {
		empty: '{}',
		leaves: '{"leaf":{"v":1},"other_leaf":{"v":2},"held_leaf":{"v":3}}',
		wrong_leaf: '{"leaf":{"v":"1"}}',
		wrong_other_leaf: '{"other_leaf":{}}',
		wrong_held_leaf: '{"held_leaf":{"v":1,"w":2}}',
		there_and_back: '{"b":{"n":1,"a":{"b":{"n":2,"a":{"leaf":{"v":3}}}}}}',
		b_missing_n: '{"b":{"a":{}}}',
		b_unknown_key: '{"b":{"n":1,"extra":true}}',
		a_unknown_key_through_b: '{"b":{"n":1,"a":{"extra":true}}}',
		list: '{"list":[null,{},{"list":[{"b":{"n":0}},null]}]}',
		list_wrong: '{"list":[null,{},{"list":[{"b":{}},1]}]}'
	}
};
