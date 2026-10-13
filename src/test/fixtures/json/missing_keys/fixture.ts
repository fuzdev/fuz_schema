import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

interface Tree {
	value: unknown;
	next?: Tree;
}

const Tree: s.Schema<Tree> = s.object({
	value: s.unknown,
	next: s.lazy(() => s.optional(Tree))
});

// every entry here accepts `undefined`. An `unknown` needs its key, as the
// entry itself and held by a `nullable`, a `lazy`, a `union`, or a `message`,
// which hand it the object. An `optional` or a `with_default` lets the key be
// missing, and so does a `union` with one among its options
const entries = {
	unknown: s.unknown,
	optional: s.optional(s.unknown),
	with_default: s.with_default(s.unknown, 'x'),
	nullable_unknown: s.nullable(s.unknown),
	nullable_optional: s.nullable(s.optional(s.string)),
	nullable_with_default: s.nullable(s.with_default(s.unknown, 'x')),
	union_unknown: s.union([s.string, s.unknown]),
	union_optional: s.union([s.number, s.optional(s.string)]),
	union_unknown_optional: s.union([s.unknown, s.optional(s.string)]),
	union_with_default: s.union([s.string, s.with_default(s.number, 0)]),
	lazy_unknown: s.lazy(() => s.unknown),
	lazy_optional: s.lazy(() => s.optional(s.string)),
	lazy_with_default: s.lazy(() => s.with_default(s.string, 'x')),
	// one in another
	nullable_lazy_unknown: s.nullable(s.lazy(() => s.unknown)),
	lazy_nullable_unknown: s.lazy(() => s.nullable(s.unknown)),
	lazy_lazy_unknown: s.lazy(() => s.lazy(() => s.unknown)),
	nullable_union_unknown: s.nullable(s.union([s.string, s.unknown])),
	union_nullable_unknown: s.union([s.number, s.nullable(s.unknown)]),
	union_lazy_unknown: s.union([s.number, s.lazy(() => s.unknown)]),
	union_union_unknown: s.union([s.number, s.union([s.string, s.unknown])]),
	lazy_union_optional: s.lazy(() => s.union([s.unknown, s.optional(s.unknown)])),
	nullable_lazy_optional: s.nullable(s.lazy(() => s.optional(s.unknown))),
	optional_nullable_unknown: s.optional(s.nullable(s.unknown)),
	// a `message` is the schema it holds
	message_unknown: s.message(s.unknown, 'text'),
	message_optional: s.message(s.optional(s.unknown), 'text'),
	message_nullable_unknown: s.message(s.nullable(s.unknown), 'text'),
	nullable_message_unknown: s.nullable(s.message(s.unknown, 'text')),
	message_lazy_unknown: s.message(
		s.lazy(() => s.unknown),
		'text'
	),
	message_union_unknown: s.message(s.union([s.string, s.unknown]), 'text'),
	union_message_unknown: s.union([s.string, s.message(s.unknown, 'text')]),
	message_union_optional: s.message(s.union([s.string, s.optional(s.unknown)]), 'text')
};

const present: Record<keyof typeof entries, string> = {
	unknown: 'null',
	optional: '1',
	with_default: '2',
	nullable_unknown: '[]',
	nullable_optional: 'null',
	nullable_with_default: 'null',
	union_unknown: '0',
	union_optional: '"a"',
	union_unknown_optional: '[]',
	union_with_default: '1',
	lazy_unknown: '{}',
	lazy_optional: '"a"',
	lazy_with_default: '"a"',
	nullable_lazy_unknown: 'null',
	lazy_nullable_unknown: '1',
	lazy_lazy_unknown: 'false',
	nullable_union_unknown: '"a"',
	union_nullable_unknown: '{}',
	union_lazy_unknown: '0',
	union_union_unknown: '[1]',
	lazy_union_optional: '1',
	nullable_lazy_optional: 'null',
	optional_nullable_unknown: 'null',
	message_unknown: '0',
	message_optional: '1',
	message_nullable_unknown: 'null',
	nullable_message_unknown: '2',
	message_lazy_unknown: '""',
	message_union_unknown: '{}',
	union_message_unknown: '"a"',
	message_union_optional: '3'
};

// every entry but `without`, then `more`
const to_text = (without?: string, more = ''): string =>
	`{${Object.entries(present)
		.filter(([key]) => key !== without)
		.map(([key, value]) => `"${key}":${value}`)
		.join(',')}${more}}`;

const cases: Record<string, JsonFixtureText> = {
	nothing: '{}',
	tagged_strict_missing: '{"tagged":{"kind":"a"}}',
	tagged_strict_present: '{"tagged":{"kind":"a","u":null}}',
	tagged_strict_all: '{"tagged":{"kind":"a","u":1,"o":2}}',
	tagged_strict_optional_only: '{"tagged":{"kind":"a","o":2}}',
	// read whole, the discriminator not being first
	tagged_strict_missing_later_discriminator: '{"tagged":{"o":2,"kind":"a"}}',
	tagged_strict_present_later_discriminator: '{"tagged":{"u":null,"kind":"a"}}',
	tagged_loose_missing: '{"tagged":{"kind":"b","other":1}}',
	tagged_loose_present: '{"tagged":{"kind":"b","other":1,"u":false}}',
	tagged_strip_missing: '{"tagged":{"kind":"c","other":1}}',
	tagged_strip_present: '{"tagged":{"u":"","kind":"c"}}',
	// a missing key is reported at its entry's place among the others
	order_between_failures: '{"order":{"zz":true,"a":"x","c":1,"d":{}}}',
	order_between_failures_reversed: '{"order":{"d":{"y":1},"c":1,"a":"x","7":0}}',
	order_only_missing: '{"order":{"a":1,"c":"x","d":{"e":null}}}',
	order_none_missing: '{"order":{"1":null,"a":1,"b":null,"c":"x","d":{"e":null}}}',
	order_not_an_object: '{"order":{"1":1,"a":1,"b":1,"c":"x","d":null}}',
	items: '{"items":[{},{"u":null},{"x":1},null,{"u":[],"u":{}}]}',
	// a schema that comes back to itself through a `lazy` over an `optional`
	tree_one: '{"tree":{"value":null}}',
	tree_empty: '{"tree":{}}',
	tree_three: '{"tree":{"value":1,"next":{"value":2,"next":{"value":3}}}}',
	tree_missing_at_each_level: '{"tree":{"next":{"value":2,"next":{}}}}',
	tree_missing_at_the_end: '{"tree":{"value":1,"next":{"value":2,"next":{"other":3}}}}',
	// a pipe needs a schema that fixes the type, which refuses `undefined` itself
	piped_missing: '{"piped":{}}',
	piped_present: '{"piped":{"p":"a","q":null}}'
};
for (const flavor of ['strict', 'loose', 'strip']) {
	// a key the schema has no entry for, which only `strict` minds
	const other = flavor === 'strict' ? '' : ',"other":1';
	cases[`${flavor}_empty`] = `{"${flavor}":{}}`;
	cases[`${flavor}_only_unknown`] = `{"${flavor}":{"unknown":false${other}}}`;
	cases[`${flavor}_all`] = `{"${flavor}":${to_text(undefined, other)}}`;
	cases[`${flavor}_null_for_each`] = `{"${flavor}":{${Object.keys(entries)
		.map((key) => `"${key}":null`)
		.join(',')}}}`;
	cases[`${flavor}_missing_with_unknown_keys`] = `{"${flavor}":{"zz":1,"0":2}}`;
	for (const key of Object.keys(entries)) {
		cases[`${flavor}_missing_${key}`] = `{"${flavor}":${to_text(key, other)}}`;
	}
}

export const fixture: JsonFixture = {
	schema: s.object({
		strict: s.optional(s.object(entries)),
		loose: s.optional(s.loose_object(entries)),
		strip: s.optional(s.strip_object(entries)),
		tagged: s.optional(
			s.variant('kind', [
				s.object({ kind: s.literal('a'), u: s.unknown, o: s.optional(s.unknown) }),
				s.loose_object({ kind: s.literal('b'), u: s.unknown }),
				s.strip_object({ kind: s.literal('c'), u: s.unknown })
			])
		),
		order: s.optional(
			s.object({
				a: s.number,
				b: s.unknown,
				c: s.string,
				1: s.unknown,
				d: s.object({ e: s.unknown })
			})
		),
		items: s.optional(s.array(s.loose_object({ u: s.unknown }))),
		tree: s.optional(Tree),
		piped: s.optional(
			s.object({ p: s.pipe(s.string, s.min_length(1)), q: s.nullable(s.optional(s.unknown)) })
		)
	}),
	cases
};
