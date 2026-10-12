import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a scalar schema at the root, where the whole text is the value
export const fixture: JsonFixture = {
	schema: s.string,
	cases: {
		string: '"a"',
		empty: '""',
		padded: ' \t\n\r"a"\r\n\t ',
		escapes: String.raw`"\"\\\/\b\f\n\r\t\u0041"`,
		escaped_upper_hex: String.raw`"\u00E9\uD83D\uDE00"`,
		raw_delete: '"\u007f"',
		raw_line_separators: '"  "',
		raw_byte_order_mark: '"﻿"',
		escaped_nul: String.raw`"\u0000"`,
		astral: '"😀"',
		null: 'null',
		true: 'true',
		number: '1',
		array: '["a"]',
		object: '{"a":"a"}',
		nested_array: '[[["a"]]]'
	}
};
