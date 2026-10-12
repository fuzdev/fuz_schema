import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// more entries than fit in one machine word, in an object that takes other keys
const COUNT = 70;
const entries: Record<string, s.AnySchema> = {};
for (let i = 0; i < COUNT; i++) entries[`k${i}`] = s.number;

const text = (indices: Array<number>, extra = ''): string =>
	`{${indices.map((i) => `"k${i}":${i}`).join(',')}${extra}}`;

const all = Array.from({ length: COUNT }, (_, i) => i);

const cases: Record<string, JsonFixtureText> = {
	all: text(all),
	all_and_extra: text(all, ',"other":[1,{"k0":"x"}]'),
	extra_first: `{"other":null,${text(all).slice(1)}`,
	reversed_and_extra: text(all.toReversed(), ',"k70":"x"'),
	missing_first: text(all.filter((i) => i !== 0)),
	missing_past_one_word: text(all.filter((i) => i !== 66)),
	missing_last_and_extra: text(
		all.filter((i) => i !== 69),
		',"other":1'
	),
	wrong_past_one_word: text(all).replace('"k67":67', '"k67":"67"'),
	only_extra: '{"other":1}',
	empty: '{}'
};

export const fixture: JsonFixture = { schema: s.loose_object(entries), cases };
