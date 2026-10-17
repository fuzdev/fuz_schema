import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const numbers = (count: number): string => '[' + Array(count).fill(1).join(',') + ']';

// a parse reports its first hundred failures and counts the rest: an item
// that fails across the cap has its key on the issue it built, and what fails
// past it, an unknown key and a union included, builds none
export const fixture: JsonFixture = {
	schema: s.object({
		pre: s.optional(s.array(s.string)),
		items: s.optional(s.array(s.object({ p: s.string, q: s.string }))),
		u: s.optional(s.union([s.string, s.number])),
		tail: s.optional(s.string)
	}),
	cases: {
		valid: '{"pre":["a"],"items":[{"p":"a","q":"b"}],"u":1,"tail":"t"}',
		ninety_nine: `{"pre":${numbers(99)}}`,
		hundred: `{"pre":${numbers(100)}}`,
		hundred_and_one: `{"pre":${numbers(101)}}`,
		item_crosses_the_cap: `{"pre":${numbers(99)},"items":[{"p":1,"q":1},{"p":1,"q":1}],"u":true,"tail":1,"z":1}`,
		far_past: `{"pre":${numbers(300)},"items":[{"p":1}],"u":true,"tail":1,"z":1}`,
		union_past_the_cap_matches: `{"pre":${numbers(150)},"u":1}`
	}
};
