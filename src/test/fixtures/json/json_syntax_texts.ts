/**
 * Texts that are about JSON's syntax and not about any schema, shared by the
 * groups that read them in different ways.
 *
 * @module
 */

/** Texts `JSON.parse` reads. */
export const JSON_SYNTAX_VALID: Record<string, string> = {
	null: 'null',
	true: 'true',
	false: 'false',
	zero: '0',
	negative_zero: '-0',
	integer: '123',
	negative: '-123',
	fraction: '1.5',
	exponent: '1e2',
	exponent_upper: '1E2',
	exponent_plus: '1e+2',
	exponent_minus: '1e-2',
	exponent_leading_zeros: '1e002',
	zero_exponent: '0e0',
	zero_fraction_exponent: '0.0e-0',
	zero_huge_exponent: '0e99999',
	underflow: '1e-400',
	underflow_huge: '1e-99999',
	many_digits: '123456789012345678901234567890',
	many_fraction_digits: '0.123456789012345678901234567890',
	many_leading_fraction_zeros: `0.${'0'.repeat(400)}1`,
	empty_string: '""',
	string: '"a"',
	every_escape: String.raw`"\"\\\/\b\f\n\r\t"`,
	unicode_escape: String.raw`"\u0041\u00e9\u00E9"`,
	escaped_nul: String.raw`"\u0000"`,
	escaped_pair: String.raw`"\ud83d\ude00"`,
	raw_astral: '"😀"',
	raw_delete: '"\u007f"',
	raw_c1_control: '"\u0080\u009f"',
	raw_line_separator: '" "',
	raw_paragraph_separator: '" "',
	raw_byte_order_mark_in_string: '"﻿"',
	raw_no_break_space_in_string: '" "',
	slash: '"/"',
	empty_array: '[]',
	empty_object: '{}',
	array: '[1,"a",null,true,[],{}]',
	object: '{"a":1,"b":[],"c":{"d":null}}',
	empty_key: '{"":1}',
	escaped_key: String.raw`{"a\n":1}`,
	nested: '[[[[{"a":[{"b":[]}]}]]]]',
	whitespace: ' \t\n\r[ \t\n\r1 \t\n\r, \t\n\r{ \t\n\r"a" \t\n\r: \t\n\r2 \t\n\r} \t\n\r] \t\n\r',
	duplicate_keys: '{"a":1,"a":2}',
	proto_key: '{"__proto__":1}'
};

/** Texts `JSON.parse` throws on. */
export const JSON_SYNTAX_INVALID: Record<string, string> = {
	empty: '',
	only_whitespace: ' \n',
	trailing_value: '1 2',
	trailing_comma_array: '[1,]',
	trailing_comma_object: '{"a":1,}',
	leading_comma_array: '[,1]',
	double_comma: '[1,,2]',
	only_comma: '[,]',
	missing_comma: '[1 2]',
	missing_colon: '{"a" 1}',
	missing_value: '{"a":}',
	missing_key: '{:1}',
	unquoted_key: '{a:1}',
	number_key: '{1:1}',
	single_quoted_key: "{'a':1}",
	single_quoted_string: "'a'",
	byte_order_mark: '﻿1',
	byte_order_mark_then_array: '﻿[]',
	leading_zero: '01',
	negative_leading_zero: '-01',
	double_zero: '00',
	trailing_point: '1.',
	trailing_point_exponent: '1.e1',
	leading_point: '.5',
	leading_plus: '+1',
	only_minus: '-',
	minus_space: '- 1',
	no_exponent_digits: '1e',
	no_exponent_digits_after_sign: '1e+',
	hex: '0x10',
	underscore: '1_0',
	nan: 'NaN',
	infinity: 'Infinity',
	negative_infinity: '-Infinity',
	undefined: 'undefined',
	truncated_null: 'nul',
	truncated_true: 'tru',
	capitalized: 'True',
	long_null: 'nulll',
	raw_tab_in_string: '"a\tb"',
	raw_newline_in_string: '"a\nb"',
	raw_nul_in_string: '"a\u0000b"',
	raw_unit_separator_in_string: '"\u001f"',
	bad_escape_x: String.raw`"\x41"`,
	bad_escape_a: String.raw`"\a"`,
	bad_escape_quote: String.raw`"\'"`,
	bad_escape_upper_u: String.raw`"\U0041"`,
	short_unicode_escape: String.raw`"\u12"`,
	non_hex_unicode_escape: String.raw`"\u12g4"`,
	unterminated_string: '"a',
	unterminated_escape: '"a\\',
	unterminated_array: '[',
	unterminated_nested: '[[1]',
	unterminated_object: '{',
	unterminated_object_after_key: '{"a"',
	unterminated_object_after_colon: '{"a":',
	unterminated_object_after_value: '{"a":1',
	unterminated_lone_surrogate: String.raw`"\ud800`,
	stray_close_bracket: ']',
	stray_close_brace: '}',
	extra_close_bracket: '[]]',
	extra_close_brace: '{"a":1}}',
	mismatched_close: '[1}',
	mismatched_close_object: '{"a":1]',
	no_break_space_before: ' 1',
	no_break_space_after: '1 ',
	vertical_tab: '\u000b1',
	form_feed: '\u000c1',
	line_separator_before: ' 1',
	line_comment: '1 // one',
	block_comment: '/* one */ 1',
	two_arrays: '[][]',
	two_objects: '{}{}'
};

/**
 * Texts `JSON.parse` reads that the Rust crate's parser refuses when it reads
 * them, by what it refuses them for.
 */
export const JSON_SYNTAX_REFUSED: Record<
	string,
	{ text: string; reason: 'number_overflow' | 'lone_surrogate' | 'depth_limit' }
> = {
	overflow: { text: '1e400', reason: 'number_overflow' },
	negative_overflow: { text: '-1e400', reason: 'number_overflow' },
	overflow_huge_exponent: { text: '1e99999', reason: 'number_overflow' },
	overflow_in_array: { text: '[0,1e400]', reason: 'number_overflow' },
	overflow_in_object: { text: '{"a":{"b":-1e400}}', reason: 'number_overflow' },
	lone_lead: { text: String.raw`"\ud800"`, reason: 'lone_surrogate' },
	lone_trail: { text: String.raw`"\udc00"`, reason: 'lone_surrogate' },
	lone_lead_then_bmp: { text: String.raw`"\ud800\u0041"`, reason: 'lone_surrogate' },
	lone_lead_then_text: { text: String.raw`"\ud800a"`, reason: 'lone_surrogate' },
	lone_lead_then_pair: { text: String.raw`"\ud800\ud83d\ude00"`, reason: 'lone_surrogate' },
	lone_in_array: { text: String.raw`["a","\udfff"]`, reason: 'lone_surrogate' },
	lone_in_key: { text: String.raw`{"\ud800":1}`, reason: 'lone_surrogate' },
	arrays_at_the_limit: { text: `${'['.repeat(128)}${']'.repeat(128)}`, reason: 'depth_limit' },
	arrays_past_the_limit: { text: `${'['.repeat(200)}${']'.repeat(200)}`, reason: 'depth_limit' },
	objects_at_the_limit: { text: `${'{"a":'.repeat(128)}1${'}'.repeat(128)}`, reason: 'depth_limit' }
};

/** The deepest texts the Rust crate's parser reads. */
export const JSON_SYNTAX_DEEPEST: Record<string, string> = {
	arrays_below_the_limit: `${'['.repeat(127)}${']'.repeat(127)}`,
	objects_below_the_limit: `${'{"a":'.repeat(127)}1${'}'.repeat(127)}`,
	mixed_below_the_limit: `${'[{"a":'.repeat(63)}[]${'}]'.repeat(63)}`
};
