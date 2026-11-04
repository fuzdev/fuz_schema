import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// the grammar of `docs/formats.md`: a real date of a four-digit year, the time
// with seconds, a fraction of 1 to 9 digits or none, and `Z`
export const fixture: JsonFixture = {
	schema: s.pipe(s.string, s.iso_datetime),
	cases: {
		midnight: '"2024-01-01T00:00:00Z"',
		fraction_1: '"2024-01-01T00:00:00.1Z"',
		fraction_6: '"2024-01-01T00:00:00.123456Z"',
		fraction_9: '"2024-01-01T00:00:00.123456789Z"',
		fraction_10: '"2024-01-01T00:00:00.1234567890Z"',
		fraction_30: '"2024-01-01T00:00:00.123456789012345678901234567890Z"',
		fraction_empty: '"2024-01-01T00:00:00.Z"',
		fraction_comma: '"2024-01-01T00:00:00,5Z"',
		offset: '"2024-01-01T00:00:00+01:00"',
		offset_negative_zero: '"2024-01-01T00:00:00-00:00"',
		offset_no_colon: '"2024-01-01T00:00:00+0100"',
		no_seconds: '"2024-01-01T00:00Z"',
		local: '"2024-01-01T00:00:00"',
		lowercase_t: '"2024-01-01t00:00:00Z"',
		lowercase_z: '"2024-01-01T00:00:00z"',
		space: '"2024-01-01 00:00:00Z"',
		feb_30: '"2024-02-30T00:00:00Z"',
		feb_29_2023: '"2023-02-29T00:00:00Z"',
		feb_29_2024: '"2024-02-29T00:00:00Z"',
		feb_29_2000: '"2000-02-29T00:00:00Z"',
		feb_29_1900: '"1900-02-29T00:00:00Z"',
		feb_29_0000: '"0000-02-29T00:00:00Z"',
		april_31: '"2024-04-31T00:00:00Z"',
		april_30: '"2024-04-30T00:00:00Z"',
		december_31: '"9999-12-31T23:59:59Z"',
		month_13: '"2024-13-01T00:00:00Z"',
		month_00: '"2024-00-01T00:00:00Z"',
		day_00: '"2024-01-00T00:00:00Z"',
		hour_24: '"2024-01-01T24:00:00Z"',
		minute_60: '"2024-01-01T23:60:00Z"',
		leap_second: '"2024-01-01T23:59:60Z"',
		year_0000: '"0000-01-01T00:00:00Z"',
		year_expanded: '"+002024-01-01T00:00:00Z"',
		year_short: '"024-01-01T00:00:00Z"',
		trailing_newline: String.raw`"2024-01-01T00:00:00Z\n"`,
		escaped: String.raw`"2024-01-01\u005400:00:00\u005a"`,
		fullwidth_digits: '"２０２４-01-01T00:00:00Z"',
		fullwidth_fraction: '"2024-01-01T00:00:00.１Z"',
		empty: '""',
		number: '1704067200000',
		array_of_one: '["2024-01-01T00:00:00Z"]',
		null: 'null'
	}
};
