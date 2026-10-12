import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

export const fixture: JsonFixture = {
	schema: s.variant('kind', [
		s.object({ kind: s.literal('circle'), r: s.number }),
		s.loose_object({ side: s.number, kind: s.literal('square') }),
		s.strip_object({ kind: s.literal(1), n: s.optional(s.number) }),
		s.object({ kind: s.literal(null) }),
		s.object({ kind: s.literal(false), off: s.optional(s.literal(true)) }),
		s.object({ kind: s.literal(0) }),
		// the same value again: this option replaces the first, at the first's place
		s.object({ kind: s.literal('circle'), r: s.number, label: s.optional(s.string) })
	]),
	cases: {
		first: '{"kind":"circle","r":1}',
		first_with_label: '{"kind":"circle","r":1,"label":"x"}',
		discriminator_last: '{"r":1,"label":"x","kind":"circle"}',
		discriminator_middle: '{"r":1,"kind":"circle","label":"x"}',
		loose: '{"kind":"square","side":2}',
		loose_unknown_keys: '{"kind":"square","other":[1,{"a":null}],"side":2}',
		loose_discriminator_last: '{"other":true,"side":2,"kind":"square"}',
		strip: '{"kind":1}',
		strip_float: '{"kind":1.0,"n":2,"other":1}',
		null_discriminator: '{"kind":null}',
		false_discriminator: '{"kind":false,"off":true}',
		zero: '{"kind":0}',
		negative_zero: '{"kind":-0}',
		zero_float: '{"kind":0.0}',
		missing_entry: '{"kind":"circle"}',
		wrong_entry: '{"kind":"circle","r":"1"}',
		unknown_key: '{"kind":"circle","r":1,"other":1}',
		unknown_key_before: '{"other":1,"kind":"circle","r":1}',
		loose_missing_entry: '{"kind":"square"}',
		null_with_unknown_key: '{"kind":null,"r":1}',
		missing: '{"r":1}',
		empty: '{}',
		unknown: '{"kind":"triangle","r":1}',
		unknown_last: '{"r":1,"kind":"triangle"}',
		string_one: '{"kind":"1"}',
		true: '{"kind":true}',
		string_null: '{"kind":"null"}',
		array_discriminator: '{"kind":["circle"],"r":1}',
		object_discriminator: '{"kind":{"kind":"circle"},"r":1}',
		array: '[]',
		array_of_entries: '[{"kind":"circle","r":1}]',
		null: 'null',
		string: '"circle"',
		// the discriminator is its last occurrence, wherever the first one is
		duplicate_same: '{"kind":"circle","r":1,"kind":"circle"}',
		duplicate_first_other: {
			text: '{"kind":"square","r":1,"kind":"circle"}',
			diverges: 'duplicate_keys'
		},
		duplicate_first_unknown: {
			text: '{"kind":"triangle","kind":"circle","r":1}',
			diverges: 'duplicate_keys'
		},
		duplicate_first_array: {
			text: '{"kind":[],"kind":"circle","r":1}',
			diverges: 'duplicate_keys'
		},
		duplicate_last_other: '{"kind":"circle","r":1,"kind":"square"}',
		duplicate_last_unknown: '{"kind":"circle","r":1,"kind":"triangle"}',
		// read whole when the discriminator is not first, so these agree
		duplicate_later_first_other: '{"r":1,"kind":"square","kind":"circle"}',
		duplicate_later_last_other: '{"r":1,"kind":"circle","kind":"square"}',
		duplicate_entry: { text: '{"kind":"circle","r":"x","r":1}', diverges: 'duplicate_keys' }
	}
};
