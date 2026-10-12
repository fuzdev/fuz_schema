import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// bounds are numbers, and nothing makes them whole or positive
export const fixture: JsonFixture = {
	schema: s.object({
		fractional: s.optional(s.pipe(s.string, s.min_length(1.5), s.max_length(2.5))),
		negative: s.optional(s.pipe(s.string, s.min_length(-1), s.max_length(0))),
		impossible: s.optional(s.pipe(s.string, s.min_length(2), s.max_length(1))),
		repeated: s.optional(
			s.pipe(s.string, s.min_length(1), s.min_length(3), s.max_length(4), s.max_length(3))
		)
	}),
	cases: {
		fractional_one: '{"fractional":"a"}',
		fractional_two: '{"fractional":"ab"}',
		fractional_three: '{"fractional":"abc"}',
		negative_empty: '{"negative":""}',
		negative_one: '{"negative":"a"}',
		impossible_one: '{"impossible":"a"}',
		impossible_two: '{"impossible":"ab"}',
		repeated_two: '{"repeated":"ab"}',
		repeated_three: '{"repeated":"abc"}',
		repeated_four: '{"repeated":"abcd"}',
		repeated_number: '{"repeated":3}'
	}
};
