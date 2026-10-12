import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// more entries than fit in one machine word, every third one optional
const COUNT = 70;
const keys = Array.from({ length: COUNT }, (_, i) => `k${i}`);
const optional = (i: number): boolean => i % 3 === 0;

const entries: Record<string, s.AnySchema> = {};
keys.forEach((key, i) => {
	entries[key] = optional(i) ? s.optional(s.number) : s.number;
});

const text = (indices: Array<number>, extra = ''): string =>
	`{${indices.map((i) => `"k${i}":${i}`).join(',')}${extra}}`;

const all = keys.map((_, i) => i);
const reversed = all.toReversed();
// a fixed shuffle
const shuffled = all.toSorted((a, b) => ((a * 37) % COUNT) - ((b * 37) % COUNT));
const required = all.filter((i) => !optional(i));

const cases: Record<string, JsonFixtureText> = {
	all: text(all),
	reversed: text(reversed),
	shuffled: text(shuffled),
	required_only: text(required),
	required_only_reversed: text(required.toReversed()),
	missing_first_required: text(all.filter((i) => i !== 1)),
	missing_last_required: text(all.filter((i) => i !== 68)),
	missing_past_one_word: text(shuffled.filter((i) => i !== 65)),
	missing_optional: text(all.filter((i) => i !== 69 && i !== 0 && i !== 66)),
	unknown_last: text(all, ',"k70":70'),
	unknown_first: `{"other":1,${text(all).slice(1)}`,
	wrong_last: text(all.slice(0, -1), ',"k69":"69"'),
	wrong_in_the_middle: text(all).replace('"k40":40', '"k40":null'),
	empty: '{}'
};

export const fixture: JsonFixture = { schema: s.object(entries), cases };
