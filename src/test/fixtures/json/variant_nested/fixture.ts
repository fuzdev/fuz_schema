import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const shape = s.variant('t', [
	s.object({ t: s.literal('a'), n: s.number }),
	s.loose_object({ t: s.literal('b') })
]);

// a variant that is not the root: its objects are the values of a record
export const fixture: JsonFixture = {
	schema: s.array(s.nullable(s.record(shape))),
	cases: {
		empty: '[]',
		discriminator_first_and_last: '[null,{"x":{"t":"a","n":1},"y":{"n":1,"t":"a"}}]',
		loose_option: '[{"x":{"t":"b","z":[1,{"t":"a"}]}}]',
		missing_entry: '[{"x":{"t":"a"}}]',
		null_value: '[{"x":null}]',
		unknown_discriminator: '[{"x":{"t":"c","n":1}}]',
		second_wrong: '[{"x":{"t":"a","n":1},"y":{"t":"a","n":"1"}}]',
		// read whole when the discriminator is not first, so its last value selects
		discriminator_twice_later: '[{"x":{"n":1,"t":"b","t":"a"}}]',
		discriminator_twice_first: {
			text: '[{"x":{"t":"b","n":1,"t":"a"}}]',
			diverges: 'duplicate_keys'
		},
		wrong_then_malformed: { text: '[{"x":{"t":"c",}}]', diverges: 'malformed_tail' },
		later_then_malformed: '[{"x":{"n":1,"t":"c",}}]'
	}
};
