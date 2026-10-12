import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';
import {
	JSON_SYNTAX_DEEPEST,
	JSON_SYNTAX_INVALID,
	JSON_SYNTAX_REFUSED,
	JSON_SYNTAX_VALID
} from '../json_syntax_texts.ts';

// a schema that needs nothing read, so the streaming evaluator skips the whole
// text: what is not JSON must still be an error, and what only the parser
// refuses goes unseen
const cases: Record<string, JsonFixtureText> = {
	...JSON_SYNTAX_VALID,
	...JSON_SYNTAX_DEEPEST,
	...JSON_SYNTAX_INVALID
};
for (const [name, { text, reason }] of Object.entries(JSON_SYNTAX_REFUSED)) {
	cases[name] = { text, diverges: `${reason}_unread` };
}

export const fixture: JsonFixture = { schema: s.unknown, cases };
