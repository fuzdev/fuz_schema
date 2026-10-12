import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// zero is one value however it is written, and is not the empty string
export const fixture: JsonFixture = {
	schema: s.one_of([0, 'a']),
	cases: {
		zero: '0',
		negative_zero: '-0',
		zero_fraction: '0.0',
		negative_zero_fraction: '-0.0',
		zero_exponent: '0e9',
		underflow: '1e-400',
		empty_string: '""',
		string: '"a"',
		string_zero: '"0"',
		false: 'false',
		null: 'null',
		tiny: '5e-324'
	}
};
