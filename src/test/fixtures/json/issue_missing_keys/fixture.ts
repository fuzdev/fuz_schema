import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const entries = {
	string: s.string,
	number: s.number,
	boolean: s.boolean,
	bigint: s.bigint,
	literal: s.literal('a'),
	literal_null: s.literal(null),
	one_of: s.one_of(['a', 1, null]),
	object: s.object({}),
	loose_object: s.loose_object({}),
	strip_object: s.strip_object({}),
	record: s.record(s.unknown),
	array: s.array(s.unknown),
	union: s.union([s.string, s.nullable(s.number)]),
	variant: s.variant('k', [s.object({ k: s.literal('a') })]),
	integer: s.integer,
	safe_integer: s.safe_integer,
	long_string: s.pipe(s.string, s.min_length(1)),
	bounded_number: s.pipe(s.number, s.min_value(0), s.max_value(1)),
	bounded_integer: s.pipe(s.integer, s.min_value(0)),
	short_array: s.pipe(s.array(s.unknown), s.max_length(1)),
	nullable: s.nullable(s.string),
	lazy: s.lazy(() => s.string),
	// accepts `undefined` and needs its key, as the entry itself and where
	// another schema hands it the object
	unknown: s.unknown,
	nullable_unknown: s.nullable(s.unknown),
	lazy_unknown: s.lazy(() => s.unknown),
	nullable_lazy_unknown: s.nullable(s.lazy(() => s.unknown)),
	// no option lets the key be missing, which the union reports as its own
	union_unknown: s.union([s.string, s.unknown]),
	lazy_union_unknown: s.lazy(() => s.union([s.unknown, s.nullable(s.unknown)])),
	// the entries a missing key does not fail
	optional: s.optional(s.string),
	with_default: s.with_default(s.string, 'x'),
	nullable_optional: s.nullable(s.optional(s.string)),
	union_optional: s.union([s.unknown, s.optional(s.string)]),
	lazy_optional: s.lazy(() => s.optional(s.string))
};

const all =
	'"string":"","number":0,"boolean":false,"literal":"a","literal_null":null,"one_of":1,"object":{},' +
	'"loose_object":{},"strip_object":{},"record":{},"array":[],"union":null,"variant":{"k":"a"},' +
	'"integer":0,"safe_integer":0,"long_string":"a","bounded_number":0,"bounded_integer":0,' +
	'"short_array":[],"nullable":null,"lazy":"","unknown":null,"nullable_unknown":null,' +
	'"lazy_unknown":1,"nullable_lazy_unknown":[],"union_unknown":{},"lazy_union_unknown":0';

// a key that is not there is `undefined` to its entry, which reports having
// received that: an `unknown` as a `missing_key`, wherever the entry reaches
// it, and a `union` none of whose options takes it as a `union`. Only a
// `bigint` entry keeps these from matching.
export const fixture: JsonFixture = {
	schema: s.object({
		strict: s.optional(s.object(entries)),
		loose: s.optional(s.loose_object(entries)),
		strip: s.optional(s.strip_object(entries)),
		nested: s.optional(s.object({ a: s.object({ b: s.object({ c: s.string }) }) })),
		items: s.optional(s.array(s.object({ id: s.number, tags: s.array(s.string) }))),
		tagged: s.optional(
			s.variant('kind', [
				s.object({ kind: s.literal('a'), x: s.number, y: s.number }),
				s.object({ kind: s.literal('b') })
			])
		)
	}),
	cases: {
		nothing: '{}',
		strict_empty: '{"strict":{}}',
		loose_empty: '{"loose":{}}',
		strip_empty: '{"strip":{}}',
		strict_all_but_bigint: `{"strict":{${all}}}`,
		loose_all_but_bigint: `{"loose":{${all},"other":1}}`,
		strict_null_for_each:
			'{"strict":{"string":null,"optional":null,"with_default":null,"unknown":null}}',
		strict_missing_with_unknown_keys: '{"strict":{"zz":1,"0":2}}',
		nested_empty: '{"nested":{}}',
		nested_one: '{"nested":{"a":{}}}',
		nested_two: '{"nested":{"a":{"b":{}}}}',
		nested_null: '{"nested":{"a":{"b":null}}}',
		items: '{"items":[{},{"id":1},{"tags":[]},{"id":"1","tags":[1]},null]}',
		tagged_missing_discriminator: '{"tagged":{"x":1,"y":2}}',
		tagged_missing_entries: '{"tagged":{"kind":"a"}}',
		tagged_missing_one: '{"tagged":{"y":2,"kind":"a"}}',
		tagged_none_to_miss: '{"tagged":{"kind":"b"}}'
	}
};
