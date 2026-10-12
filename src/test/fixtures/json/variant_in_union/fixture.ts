import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const shape = s.variant('t', [
	s.object({ t: s.literal('a'), n: s.number }),
	s.loose_object({ t: s.literal('b') })
]);

// a variant as the one option of a union an object could match, which is
// matched as the object is read
export const fixture: JsonFixture = {
	schema: s.union([s.string, shape]),
	cases: {
		string: '"a"',
		discriminator_last: '{"n":1,"t":"a"}',
		discriminator_first: '{"t":"a","n":1}',
		loose_option: '{"t":"b","z":[]}',
		unknown_discriminator: '{"t":"c"}',
		missing_entry: '{"t":"a"}',
		empty: '{}',
		array: '[]',
		number: '1',
		duplicate_entry: { text: '{"t":"a","n":"x","n":1}', diverges: 'duplicate_keys' },
		duplicate_entry_later: '{"n":"x","t":"a","n":1}',
		wrong_then_malformed: { text: '{"t":"c",}', diverges: 'malformed_tail' },
		valid_then_malformed: '{"t":"a","n":1,}',
		array_then_malformed: { text: '[1,}', diverges: 'malformed_tail' }
	}
};
