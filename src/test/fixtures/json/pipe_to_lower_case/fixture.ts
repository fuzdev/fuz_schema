import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// `to_lower_case` gives the steps after it the lowercase, which of a dotted
// capital I is two units, and of an `iso_datetime`'s `T` and `Z` is no date
// and time: the steps before it are given the string as it came
export const fixture: JsonFixture = {
	schema: s.object({
		id: s.optional(s.pipe(s.string, s.uuid, s.to_lower_case)),
		id_after: s.optional(s.pipe(s.string, s.to_lower_case, s.uuid)),
		short: s.optional(s.pipe(s.string, s.to_lower_case, s.max_length(1))),
		short_before: s.optional(s.pipe(s.string, s.max_length(1), s.to_lower_case)),
		at: s.optional(s.pipe(s.string, s.to_lower_case, s.iso_datetime)),
		at_before: s.optional(s.pipe(s.string, s.iso_datetime, s.to_lower_case)),
		nested: s.optional(s.pipe(s.pipe(s.string, s.to_lower_case), s.min_length(2), s.to_lower_case))
	}),
	cases: {
		empty: '{}',
		id_upper: '{"id":"123E4567-E89B-42D3-A456-426614174000"}',
		id_max_mixed: '{"id":"ffffffff-FFFF-ffff-FFFF-ffffffffffff"}',
		id_not_uuid: '{"id":"X"}',
		id_after_upper: '{"id_after":"123E4567-E89B-42D3-A456-426614174000"}',
		id_after_kelvin: '{"id_after":"123e4567-e89b-42d3-a456-42661417400K"}',
		short_ascii: '{"short":"A"}',
		short_dotted_i: String.raw`{"short":"İ"}`,
		short_before_dotted_i: String.raw`{"short_before":"İ"}`,
		short_two: '{"short":"AB"}',
		at_utc: '{"at":"2024-01-01T00:00:00Z"}',
		at_before_utc: '{"at_before":"2024-01-01T00:00:00Z"}',
		at_before_lower: '{"at_before":"2024-01-01t00:00:00z"}',
		nested_sigma: '{"nested":"ΑΣ"}',
		nested_one: '{"nested":"Σ"}',
		number: '{"id":1}',
		null: '{"short":null}',
		every: String.raw`{"id":"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF","id_after":"X","short":"İ","short_before":"ab","at":"2024-01-01T00:00:00Z","at_before":"x","nested":"I"}`
	}
};
