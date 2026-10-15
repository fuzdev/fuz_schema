import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// a union expects the kinds of its options, each once: a union among them by
// its own options, at any depth, and a `pipe` by its first schema, through a
// pipe that starts with a pipe. Any other schema that holds one is its kind
export const fixture: JsonFixture = {
	schema: s.object({
		flat: s.optional(
			s.union([
				s.string,
				s.union([s.string, s.loose_object({ name: s.string })]),
				s.union([s.union([s.literal(null), s.array(s.number)]), s.number])
			])
		),
		piped: s.optional(
			s.union([
				s.pipe(s.string, s.min_length(3)),
				s.union([s.pipe(s.pipe(s.array(s.number), s.min_length(1)), s.max_length(2)), s.boolean]),
				s.record(s.string)
			])
		),
		held: s.optional(
			s.union([
				s.nullable(s.union([s.string])),
				s.lazy(() => s.union([s.number])),
				s.array(s.union([s.boolean])),
				s.variant('k', [s.object({ k: s.literal('a') })]),
				s.one_of(['a', 1])
			])
		),
		twice: s.optional(
			s.union([s.object({ a: s.number }), s.union([s.object({ b: s.number }), s.number]), s.number])
		)
	}),
	cases: {
		none: '{}',
		flat_string: '{"flat":"a"}',
		flat_object: '{"flat":{"name":"a","other":1}}',
		flat_null: '{"flat":null}',
		flat_numbers: '{"flat":[1,2]}',
		flat_wrong_object: '{"flat":{"name":1}}',
		flat_true: '{"flat":true}',
		flat_strings: '{"flat":["a"]}',
		piped_short: '{"piped":"ab"}',
		piped_long: '{"piped":"abc"}',
		piped_record: '{"piped":{"a":"b"}}',
		piped_number: '{"piped":1}',
		piped_empty: '{"piped":[]}',
		piped_numbers: '{"piped":[1,2]}',
		piped_null: '{"piped":null}',
		held_null: '{"held":null}',
		held_number: '{"held":1}',
		held_wrong: '{"held":{}}',
		held_array: '{"held":[1]}',
		twice_wrong: '{"twice":{"c":1}}',
		twice_string: '{"twice":"a"}',
		// a number past a double is an infinity to `JSON.parse`, received as one
		flat_overflow: { text: '{"flat":1e400}', diverges: 'number_overflow' },
		piped_negative_overflow: { text: '{"piped":-1e400}', diverges: 'number_overflow' },
		all: '{"flat":false,"piped":false,"held":false,"twice":false}'
	}
};
