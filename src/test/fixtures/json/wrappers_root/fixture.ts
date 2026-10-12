import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// wrappers at the root and around items, where no value is ever missing
export const fixture: JsonFixture = {
	schema: s.nullable(
		s.optional(s.with_default(s.array(s.optional(s.with_default(s.nullable(s.string), 'x'))), []))
	),
	cases: {
		null: 'null',
		empty: '[]',
		strings: '["a","b"]',
		null_item: '["a",null]',
		number_item: '["a",1]',
		nested_item: '[["a"]]',
		string: '"a"',
		number: '0',
		false: 'false',
		object: '{}'
	}
};
