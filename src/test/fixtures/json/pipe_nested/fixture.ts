import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// pipes that start with pipes, around an array of the same, and under a union
// whose other option no array could match
const list: s.AnySchema = s.lazy(() => either);
let piped: s.AnySchema = s.pipe(s.array(list), s.max_length(2));
for (let i = 0; i < 6; i++)
	piped = (s.pipe as any)(piped, i % 2 ? s.min_length(0) : s.max_length(3));
const either = s.union([s.bigint, piped]);

const nested = (depth: number, leaf = ''): string =>
	`${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`;

export const fixture: JsonFixture = {
	schema: list,
	cases: {
		// of the lengths the pipes allow, the innermost's is the least: two
		empty: '[]',
		one: '[[[]]]',
		two: '[[[]],[[]]]',
		three: '[[[]],[[]],[[]]]',
		inner_empty: '[[]]',
		number: '1',
		item_number: '[1]',
		object: '{}',
		depth_20: nested(20),
		depth_20_of_one: nested(20, '[[]]'),
		depth_20_of_three: nested(20, '[[]],[[]],[[]]'),
		deepest: nested(127),
		too_deep: { text: nested(128), diverges: 'depth_limit' },
		three_then_malformed: { text: '[[[]],[[]],[[]],}', diverges: 'malformed_tail' }
	}
};
