import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a string's length is its UTF-16 code units, however the text writes them
export const fixture: JsonFixture = {
	schema: s.pipe(s.pipe(s.string, s.min_length(2)), s.max_length(4)),
	cases: {
		two: '"ab"',
		four: '"abcd"',
		one: '"a"',
		five: '"abcde"',
		empty: '""',
		astral: '"😀"',
		astral_escaped: String.raw`"\ud83d\ude00"`,
		astral_escaped_upper: String.raw`"\uD83D\uDE00"`,
		two_astral: '"😀😀"',
		two_astral_and_one: '"😀😀a"',
		astral_and_one: '"a😀"',
		two_bytes: '"é"',
		two_two_bytes: '"éé"',
		three_bytes: '"€"',
		two_three_bytes: '"€€"',
		five_three_bytes: '"€€€€€"',
		combining: '"é"',
		escaped_bmp: String.raw`"\u0061\u0062"`,
		escaped_nul: String.raw`"\u0000\u0000"`,
		escapes: String.raw`"\n\t\"\\"`,
		five_escapes: String.raw`"\n\t\"\\\/"`,
		joined: '"👨‍👩‍👧"',
		flag: '"🇯🇵"',
		line_separators: '"  "',
		// half a pair counts as one unit to JavaScript
		lone_lead: { text: String.raw`"a\ud800"`, diverges: 'lone_surrogate' },
		lone_trail: { text: String.raw`"\udc00a"`, diverges: 'lone_surrogate' },
		lone_lead_then_escape: { text: String.raw`"\ud800A"`, diverges: 'lone_surrogate' },
		lone_lead_then_newline: { text: String.raw`"\ud800\n"`, diverges: 'lone_surrogate' },
		reversed_pair: { text: String.raw`"\ude00\ud83d"`, diverges: 'lone_surrogate' },
		lone_too_long: { text: String.raw`"abcd\ud800"`, diverges: 'lone_surrogate' },
		number: '2',
		null: 'null',
		array: '["a","b"]',
		object: '{"length":2}'
	}
};
