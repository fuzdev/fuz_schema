import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a discriminator that is an array index, which JavaScript lists first
// wherever it is written
export const fixture: JsonFixture = {
	schema: s.variant('0', [s.object({ 0: s.literal('a'), b: s.number })]),
	cases: {
		index_last: '{"b":1,"0":"a"}',
		index_first: '{"0":"a","b":1}',
		missing: '{"b":1}',
		wrong_entry: '{"b":"1","0":"a"}',
		unknown: '{"0":"b","b":1}',
		array: '["a"]'
	}
};
