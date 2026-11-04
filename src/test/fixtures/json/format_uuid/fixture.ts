import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// the grammar of `docs/formats.md`: versions 1 to 8, the RFC's variant, the
// nil UUID, and the max UUID in either case
export const fixture: JsonFixture = {
	schema: s.pipe(s.string, s.uuid),
	cases: {
		v1: '"123e4567-e89b-12d3-a456-426614174000"',
		v2: '"123e4567-e89b-22d3-a456-426614174000"',
		v3: '"123e4567-e89b-32d3-a456-426614174000"',
		v4: '"123e4567-e89b-42d3-a456-426614174000"',
		v5: '"123e4567-e89b-52d3-a456-426614174000"',
		v6: '"123e4567-e89b-62d3-a456-426614174000"',
		v7: '"123e4567-e89b-72d3-a456-426614174000"',
		v8: '"123e4567-e89b-82d3-a456-426614174000"',
		version_0: '"123e4567-e89b-02d3-a456-426614174000"',
		version_9: '"123e4567-e89b-92d3-a456-426614174000"',
		version_f: '"123e4567-e89b-f2d3-a456-426614174000"',
		variant_0: '"123e4567-e89b-42d3-0456-426614174000"',
		variant_7: '"123e4567-e89b-42d3-7456-426614174000"',
		variant_8: '"123e4567-e89b-42d3-8456-426614174000"',
		variant_9: '"123e4567-e89b-42d3-9456-426614174000"',
		variant_a: '"123e4567-e89b-42d3-a456-426614174000"',
		variant_b: '"123e4567-e89b-42d3-b456-426614174000"',
		variant_upper_a: '"123e4567-e89b-42d3-A456-426614174000"',
		variant_upper_b: '"123e4567-e89b-42d3-B456-426614174000"',
		variant_c: '"123e4567-e89b-42d3-c456-426614174000"',
		variant_f: '"123e4567-e89b-42d3-f456-426614174000"',
		nil: '"00000000-0000-0000-0000-000000000000"',
		max_lower: '"ffffffff-ffff-ffff-ffff-ffffffffffff"',
		max_upper: '"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"',
		max_mixed: '"ffffffff-FFFF-ffff-FFFF-ffffffffffff"',
		near_max: '"ffffffff-ffff-ffff-ffff-fffffffffffe"',
		v4_mixed_case: '"123E4567-e89B-42D3-a456-426614174ABC"',
		escaped: String.raw`"123e4567-e89b-\u00342d3-a456-42661417400\u0030"`,
		braced: '"{123e4567-e89b-42d3-a456-426614174000}"',
		no_dashes: '"123e4567e89b42d3a456426614174000"',
		urn: '"urn:uuid:123e4567-e89b-42d3-a456-426614174000"',
		trailing_newline: String.raw`"123e4567-e89b-42d3-a456-426614174000\n"`,
		fullwidth_digit: '"123e4567-e89b-42d3-a456-42661417400０"',
		too_short: '"123e4567-e89b-42d3-a456-42661417400"',
		too_long: '"123e4567-e89b-42d3-a456-4266141740000"',
		not_hex: '"123e4567-e89b-42d3-a456-42661417400g"',
		empty: '""',
		number: '1',
		array_of_one: '["123e4567-e89b-42d3-a456-426614174000"]',
		null: 'null'
	}
};
