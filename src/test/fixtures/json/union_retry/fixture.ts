import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// a union whose option fills a missing key in, after options that take the
// object and the key: the library tries those options again on the
// `undefined` the key reads as. That changes the output and never the
// verdict, so the crate, which builds no output and tries nothing again,
// gives the same verdicts and issues
const entries = {
	unknown_default: s.union([s.unknown, s.with_default(s.string, 'd')]),
	lazy_default: s.union([s.lazy(() => s.literal('a')), s.with_default(s.literal('b'), 'b')]),
	nullable_default: s.union([s.nullable(s.unknown), s.with_default(s.number, 0)]),
	union_default: s.union([s.union([s.number, s.unknown]), s.with_default(s.string, 'd')]),
	// the union that fills the key in is an option of another, which then
	// tries the options before it again too
	nested_default: s.union([
		s.lazy(() => s.literal(1)),
		s.union([s.string, s.with_default(s.boolean, true)])
	]),
	// no option before it takes the key, so none is tried again
	string_default: s.union([s.string, s.with_default(s.number, 0)]),
	piped_default: s.union([s.pipe(s.string, s.min_length(2)), s.with_default(s.string, 'dd')]),
	// the option that fills the key in is the first, with none before it to
	// try again
	default_first: s.union([s.with_default(s.string, 'd'), s.unknown])
};

const present: Record<keyof typeof entries, [valid: string, invalid: string | null]> = {
	unknown_default: ['1', null],
	lazy_default: ['"b"', '"c"'],
	nullable_default: ['null', null],
	union_default: ['[]', null],
	nested_default: ['false', '2'],
	string_default: ['3', 'null'],
	piped_default: ['"x"', 'true'],
	default_first: ['{}', null]
};

// a union a `lazy` brings back to itself, each option reading `next` before
// the literal that tells them apart, and `next` a union that fills a missing
// key in after the option that comes back: the retry inside the recursion
const tree: s.AnySchema = s.lazy(() =>
	s.union(
		['a', 'b'].map((op) =>
			s.object({
				next: s.union([s.lazy(() => tree), s.with_default(s.literal(null), null)]),
				op: s.literal(op)
			})
		)
	)
);

const chain = (levels: number, op: string, leaf: string): string =>
	`${'{"next":'.repeat(levels)}${leaf}${`,"op":"${op}"}`.repeat(levels)}`;

const cases: Record<string, JsonFixtureText> = {
	all_missing: '{}',
	all_present: `{${Object.entries(present)
		.map(([key, [valid]]) => `"${key}":${valid}`)
		.join(',')}}`,
	tree_leaf: '{"tree":{"op":"b"}}',
	tree_null_next: '{"tree":{"next":null,"op":"a"}}',
	tree_wrong_next: '{"tree":{"next":1,"op":"a"}}',
	tree_wrong_op: '{"tree":{"op":"c"}}',
	// the library takes time exponential in the depth here, which it
	// declares, so the chains stay short
	tree_chain: `{"tree":${chain(12, 'b', '{"op":"b"}')}}`,
	tree_chain_wrong_leaf: `{"tree":${chain(12, 'b', '{"op":"c"}')}}`,
	tree_chain_mixed: `{"tree":${chain(6, 'a', chain(6, 'b', '{"next":null,"op":"a"}'))}}`
};
for (const [key, [valid, invalid]] of Object.entries(present)) {
	cases[`${key}_valid`] = `{"${key}":${valid}}`;
	if (invalid !== null) cases[`${key}_invalid`] = `{"${key}":${invalid}}`;
}

export const fixture: JsonFixture = {
	schema: s.loose_object({ ...entries, tree: s.optional(tree) }),
	cases
};
