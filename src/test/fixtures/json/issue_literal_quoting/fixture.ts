import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

const char = String.fromCodePoint;

// strings whose text in an issue's `expected` is what `JSON.stringify` makes
// of them: the quote, the backslash, and the control characters below a space
// escaped, and nothing else
const strings: Record<string, string> = {
	plain: 'a',
	empty: '',
	space: ' ',
	quote: 'a"b',
	only_quote: '"',
	backslash: 'a\\b',
	backslash_quote: '\\"',
	backslash_n: '\\n',
	backslash_u: '\\u0041',
	slash: 'a/b',
	apostrophe: "it's",
	angle: '</script>',
	null_character: char(0),
	start_of_heading: char(1),
	backspace: '\b',
	tab: '\t',
	newline: '\n',
	vertical_tab: char(0xb),
	form_feed: '\f',
	carriage_return: '\r',
	escape: char(0x1b),
	unit_separator: char(0x1f),
	delete: char(0x7f),
	c1_control: char(0x80),
	no_break_space: char(0xa0),
	accented: 'é',
	line_separator: char(0x2028),
	paragraph_separator: char(0x2029),
	byte_order_mark: char(0xfeff),
	last_of_the_plane: char(0xffff),
	astral: '😀',
	last_code_point: char(0x10ffff),
	mixed: 'a"b\\c\n ' + char(0x2028) + 'é😀' + char(0x7f) + '\t' + char(1),
	like_null: 'null',
	like_true: 'true',
	like_number: '1',
	like_joined: 'a | b'
};

const entries: Record<string, s.AnySchema> = {
	any_of: s.optional(s.one_of([...Object.values(strings), 1, null, true])),
	tagged: s.optional(
		s.variant(
			'tag',
			Object.values(strings).map((string) => s.loose_object({ tag: s.literal(string) }))
		)
	)
};
const cases: Record<string, JsonFixtureText> = {
	none: '{}',
	any_of_other: '{"any_of":"other"}',
	any_of_array: '{"any_of":["a"]}',
	tagged_other: '{"tagged":{"tag":"other"}}',
	tagged_missing: '{"tagged":{}}'
};
for (const [name, string] of Object.entries(strings)) {
	entries[name] = s.optional(s.literal(string));
	const text = JSON.stringify(string);
	cases[`${name}_equal`] = `{"${name}":${text},"any_of":${text},"tagged":{"tag":${text}}}`;
	cases[`${name}_other`] = `{"${name}":"other"}`;
	cases[`${name}_not_string`] = `{"${name}":null}`;
	// the text of the text, which is another string
	cases[`${name}_quoted_twice`] = `{"${name}":${JSON.stringify(text)}}`;
}
// the characters JSON lets a string hold unescaped, written that way
cases.unescaped =
	`{"delete":"${strings.delete}","line_separator":"${strings.line_separator}",` +
	`"astral":"${strings.astral}","last_code_point":"${strings.last_code_point}","slash":"a/b"}`;
cases.slash_escaped = '{"slash":"a\\/b"}';

export const fixture: JsonFixture = { schema: s.object(entries), cases };
