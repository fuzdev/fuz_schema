import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';
import {
	JSON_SYNTAX_DEEPEST,
	JSON_SYNTAX_INVALID,
	JSON_SYNTAX_REFUSED,
	JSON_SYNTAX_VALID
} from '../json_syntax_texts.ts';

// a schema every JSON value matches and none is skipped by: a scalar is
// checked as it is read, and so is an array or object, by the one option of
// the union that could match it
const json: s.AnySchema = s.union([
	s.literal(null),
	s.boolean,
	s.number,
	s.string,
	s.array(s.lazy(() => json)),
	s.record(s.lazy(() => json))
]);

const cases: Record<string, JsonFixtureText> = {
	...JSON_SYNTAX_VALID,
	...JSON_SYNTAX_DEEPEST,
	...JSON_SYNTAX_INVALID
};
for (const [name, { text, reason }] of Object.entries(JSON_SYNTAX_REFUSED)) {
	cases[name] = { text, diverges: reason };
}

export const fixture: JsonFixture = { schema: json, cases };
