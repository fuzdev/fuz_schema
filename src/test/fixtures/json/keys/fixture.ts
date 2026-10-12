import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// keys are compared as the strings they decode to, and nothing else about them
// means anything: not their order, not what they look like
const keys = [
	'',
	' ',
	'a b',
	'é',
	'é',
	'😀',
	'a"b',
	'a\\b',
	'\u0000',
	'\n',
	' ',
	'10',
	'9',
	'0',
	'01',
	'-1',
	'1.5',
	'4294967294',
	'4294967295',
	'length',
	'prototype',
	'then',
	'__proto',
	'hasOwn',
	'a/b',
	'a~b',
	'$0',
	'kind',
	'def',
	'schema',
	'defs',
	'null',
	'undefined'
];

const entries: Record<string, s.AnySchema> = {};
for (const key of keys) entries[key] = s.optional(s.number);
entries.required = s.number;

const field = (key: string, value: string): string =>
	`{"required":0,${JSON.stringify(key)}:${value}}`;

const cases: Record<string, JsonFixtureText> = {
	none: '{"required":0}',
	all: `{${keys.map((key, i) => `${JSON.stringify(key)}:${i}`).join(',')},"required":0}`,
	all_reversed: `{"required":0,${keys
		.toReversed()
		.map((key, i) => `${JSON.stringify(key)}:${i}`)
		.join(',')}}`,
	// every one wrong: issues come in the schema's order, indices first
	all_wrong: `{${keys.map((key) => `${JSON.stringify(key)}:null`).join(',')},"required":null}`
};
keys.forEach((key, i) => {
	cases[`key_${i}`] = field(key, '1');
	cases[`key_${i}_wrong`] = field(key, '"1"');
});
Object.assign(cases, {
	escaped_ascii: String.raw`{"required":0,"a\u0020b":1}`,
	escaped_composed: String.raw`{"required":0,"\u00e9":1}`,
	escaped_decomposed: String.raw`{"required":0,"e\u0301":1}`,
	escaped_pair: String.raw`{"required":0,"\ud83d\ude00":1}`,
	escaped_quote: String.raw`{"required":0,"a\"b":1}`,
	escaped_backslash: String.raw`{"required":0,"a\\b":1}`,
	escaped_slash: String.raw`{"required":0,"a\/b":1}`,
	escaped_nul: String.raw`{"required":0,"\u0000":1}`,
	escaped_newline: String.raw`{"required":0,"\n":1}`,
	escaped_newline_as_unicode: String.raw`{"required":0,"\u000a":1}`,
	// near misses, which are unknown keys
	upper: '{"required":0,"A B":1}',
	upper_composed: '{"required":0,"É":1}',
	two_spaces: '{"required":0,"  ":1}',
	leading_zero: '{"required":0,"00":1}',
	positive_index: '{"required":0,"+1":1}',
	float_index: '{"required":0,"1.50":1}',
	past_index: '{"required":0,"4294967296":1}',
	trailing_nul: String.raw`{"required":0,"\u0000\u0000":1}`,
	proto: '{"required":0,"__proto__":1}',
	constructor: '{"required":0,"constructor":1}',
	has_own_property: '{"required":0,"hasOwnProperty":1}',
	required_escaped: String.raw`{"\u0072equired":0}`,
	required_upper: '{"Required":0}'
} satisfies Record<string, JsonFixtureText>);

export const fixture: JsonFixture = { schema: s.object(entries), cases };
