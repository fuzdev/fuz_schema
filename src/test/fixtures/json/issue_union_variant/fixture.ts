import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const shape = s.variant('type', [
	s.object({ type: s.literal('a'), n: s.number }),
	s.loose_object({ type: s.literal(1.5), u: s.union([s.string, s.number]) }),
	s.object({ type: s.literal(-0) }),
	s.strip_object({
		type: s.literal(null),
		deep: s.optional(
			s.variant('t', [
				s.object({ t: s.literal(true) }),
				s.object({ t: s.literal(false), x: s.string })
			])
		)
	}),
	s.object({ type: s.literal('a"b') }),
	s.object({ type: s.literal(1e21) }),
	// the same value again, which keeps its first place among the values
	s.object({ type: s.literal('a'), n: s.number, m: s.optional(s.number) })
]);

// a union that fails reports once, at its own value, with the kinds of its
// options, whatever they found. A variant reports at its discriminator, with
// the values of its options, or leaves the report to the option it selects.
export const fixture: JsonFixture = {
	schema: s.object({
		kinds: s.optional(
			s.union([
				s.literal(1),
				s.one_of(['a', 2]),
				s.nullable(s.boolean),
				s.lazy(() => s.array(s.number)),
				s.pipe(s.number, s.integer, s.min_value(10)),
				s.object({ a: s.number }),
				s.strip_object({ b: s.string }),
				s.loose_object({ c: s.string }),
				s.record(s.boolean),
				s.variant('k', [s.object({ k: s.literal('x') })]),
				s.union([s.bigint]),
				s.bigint,
				s.pipe(s.string, s.min_length(3)),
				s.safe_integer
			])
		),
		none: s.optional(s.union([])),
		one: s.optional(s.union([s.finite])),
		nested: s.optional(
			s.array(
				s.union([
					s.string,
					s.array(s.union([s.number, s.object({ n: s.union([s.boolean, s.literal(null)]) })]))
				])
			)
		),
		entries: s.optional(
			s.object({ x: s.union([s.number, s.string]), y: s.union([s.unknown]), z: s.number })
		),
		with_default: s.with_default(s.union([s.number]), 0),
		shape: s.optional(shape),
		shapes: s.optional(s.record(s.array(shape))),
		no_options: s.optional(s.variant('k', [])),
		either: s.optional(s.union([shape, s.string])),
		index: s.optional(s.variant('0', [s.object({ 1: s.number, 0: s.literal(0) })]))
	}),
	cases: {
		nothing: '{}',
		kinds_fraction: '{"kinds":1.5}',
		kinds_small_integer: '{"kinds":3}',
		kinds_large_integer: '{"kinds":12}',
		kinds_unsafe_fraction: '{"kinds":9007199254740993.5}',
		kinds_string: '{"kinds":"b"}',
		kinds_short_string: '{"kinds":"ab"}',
		kinds_long_string: '{"kinds":"abc"}',
		kinds_null: '{"kinds":null}',
		kinds_array: '{"kinds":["x"]}',
		kinds_object: '{"kinds":{"z":1}}',
		kinds_empty_object: '{"kinds":{}}',
		kinds_variant: '{"kinds":{"k":"x"}}',
		kinds_variant_unknown: '{"kinds":{"k":"y"}}',
		none_null: '{"none":null}',
		none_object: '{"none":{}}',
		one_string: '{"one":"1"}',
		one_number: '{"one":1}',
		nested_valid: '{"nested":["a",[1,{"n":true},{"n":null}]]}',
		nested_outer: '{"nested":[1,null,{},"a",true]}',
		nested_inner: '{"nested":[[1,"a",{"n":1},{},[],{"n":null,"m":1}],"a",[null]]}',
		nested_not_array: '{"nested":"a"}',
		entries_all: '{"entries":{"x":null,"y":null,"z":null}}',
		entries_missing: '{"entries":{}}',
		entries_unknown_key: '{"entries":{"z":1,"x":[],"w":{}}}',
		with_default_wrong: '{"with_default":"x"}',
		with_default_null: '{"with_default":null}',
		shape_first: '{"shape":{"type":"a","n":1,"m":2}}',
		shape_array: '{"shape":[]}',
		shape_null: '{"shape":null}',
		shape_string: '{"shape":"a"}',
		shape_number: '{"shape":1.5}',
		shape_empty: '{"shape":{}}',
		shape_unknown: '{"shape":{"type":"b","n":1}}',
		shape_unknown_array: '{"shape":{"type":["a"]}}',
		shape_unknown_object: '{"shape":{"n":1,"type":{"type":"a"}}}',
		shape_unknown_true: '{"shape":{"type":true}}',
		shape_unknown_number: '{"shape":{"type":1}}',
		shape_selected_wrong: '{"shape":{"type":"a","n":"1","m":"2","other":1}}',
		shape_selected_missing: '{"shape":{"type":"a"}}',
		shape_loose_union: '{"shape":{"type":1.5,"u":null,"other":1}}',
		shape_zero_unknown_key: '{"shape":{"type":0,"n":1}}',
		shape_negative_zero: '{"shape":{"type":-0}}',
		shape_quoted: '{"shape":{"type":"a\\"b","n":1}}',
		shape_large: '{"shape":{"type":1000000000000000000000,"n":1}}',
		shape_deep_missing: '{"shape":{"type":null,"deep":{}}}',
		shape_deep_unknown: '{"shape":{"type":null,"deep":{"t":"true"}}}',
		shape_deep_not_object: '{"shape":{"type":null,"deep":[true]}}',
		shape_deep_selected: '{"shape":{"type":null,"deep":{"t":false,"y":1}}}',
		shapes:
			'{"shapes":{"b":[{"type":"a","n":1},{"type":"c"},[],{"type":0,"x":1}],"a":{},"1":[null]}}',
		no_options_object: '{"no_options":{"k":"x"}}',
		no_options_empty: '{"no_options":{}}',
		no_options_array: '{"no_options":[]}',
		either_string: '{"either":"a"}',
		either_shape: '{"either":{"type":"a","n":1}}',
		either_wrong_shape: '{"either":{"type":"a","n":"1"}}',
		either_unknown_shape: '{"either":{"type":"z"}}',
		either_number: '{"either":1}',
		index_valid: '{"index":{"1":1,"0":0}}',
		index_missing: '{"index":{"1":1}}',
		index_wrong: '{"index":{"1":"x","0":0,"2":2}}',
		index_array: '{"index":[0,1]}',
		several:
			'{"kinds":[],"none":0,"one":"x","nested":[0],"shape":{"type":"z"},"no_options":{},"either":[]}'
	}
};
