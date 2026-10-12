import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// an entry at an array index runs first, and a key written twice around one
// keeps the place of its first
export const fixture: JsonFixture = {
	schema: s.object({ b: s.number, 1: s.number }),
	cases: {
		as_written: '{"b":3,"1":2}',
		index_first: '{"1":2,"b":3}',
		both_wrong: '{"b":"x","1":"y"}',
		missing_index: '{"b":3}',
		unknown_index: '{"b":3,"1":2,"0":1}',
		around_index_last_good: { text: '{"b":"x","1":2,"b":3}', diverges: 'duplicate_keys' },
		around_index_last_bad: '{"b":3,"1":2,"b":"x"}',
		index_last_good: { text: '{"1":"x","b":3,"1":2}', diverges: 'duplicate_keys' }
	}
};
