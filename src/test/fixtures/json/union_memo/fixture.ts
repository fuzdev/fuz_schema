import * as s from '#lib/schema.ts';
import type { JsonFixture, JsonFixtureText } from '../json_test_helpers.ts';

// unions two of whose options could take one array or object and reach a
// cycle, which the crate keeps the verdicts of: each option reads into the
// value before anything tells them apart, so without the kept verdicts a
// value is asked again once per option at every level above it. A
// `memo_union` keeps the library's time linear in the depth, and the crate
// loads it as the `union` it is

// objects, each option reading its `args` before the `op` that tells them apart
const expr: s.AnySchema = s.lazy(() =>
	s.memo_union(['a', 'b'].map((op) => s.object({ args: s.array(expr), op: s.literal(op) })))
);

// arrays, the first option refusing what has fewer than two items once it has
// read them
const nest: s.AnySchema = s.lazy(() =>
	s.memo_union([s.pipe(s.array(nest), s.min_length(2)), s.array(nest), s.literal(0)])
);

// two unions the crate keeps the verdicts of, asked of one value, which one
// refuses and the other takes: `pair` refuses an array of more than one item,
// and `any` takes every array, so a kept verdict read back for the wrong union
// gives the wrong answer. The `union` above them asks `pair` first, and `any`
// last, of the same arrays
const pair: s.AnySchema = s.lazy(() =>
	s.union([
		s.pipe(s.array(pair), s.max_length(1)),
		s.pipe(s.array(pair), s.max_length(0)),
		s.loose_object({ a: pair }),
		s.record(pair),
		s.literal(0)
	])
);
const any: s.AnySchema = s.lazy(() =>
	s.union([
		s.array(any),
		s.pipe(s.array(any), s.min_length(5)),
		s.loose_object({ b: any }),
		s.record(any),
		s.literal(0)
	])
);
const two_unions = s.union([pair, s.array(pair), any]);

/** A chain of `depth` objects, each the only item of the `args` of the one above. */
const chain = (depth: number, op: string, leaf: string): string =>
	`${'{"args":['.repeat(depth)}${leaf}${`],"op":"${op}"}`.repeat(depth)}`;

/** `depth` arrays, each the only item of the one above but for a `0` beside it. */
const arrays = (depth: number, leaf: string): string =>
	`${'['.repeat(depth)}${leaf}${',0]'.repeat(depth)}`;

const cases: Record<string, JsonFixtureText> = {
	empty: '{}',
	expr_leaf: '{"expr":{"args":[],"op":"a"}}',
	expr_wrong_op: '{"expr":{"args":[],"op":"c"}}',
	expr_not_object: '{"expr":[]}',
	// the deepest item is an object no option takes, so every level fails
	nest_leaf: '{"nest":[0,0]}',
	nest_one: '{"nest":[0]}',
	nest_wrong: '{"nest":[1]}',
	// items that fail apart, each its own issue
	list: `{"list":[${chain(3, 'a', '')},${chain(3, 'b', '{"args":[],"op":"x"}')},1,${chain(2, 'b', '')}]}`
};
for (const depth of [1, 2, 3, 5, 8, 12, 30, 62]) {
	cases[`expr_${depth}`] = `{"expr":${chain(depth, 'b', '')}}`;
	cases[`expr_${depth}_wrong_leaf`] = `{"expr":${chain(depth, 'a', '{"args":[],"op":"c"}')}}`;
	// the deepest is an `a`, the rest `b`
	cases[`expr_${depth}_mixed`] = `{"expr":${chain(depth - 1, 'b', '{"args":[],"op":"a"}')}}`;
	cases[`nest_${depth}`] = `{"nest":${arrays(depth, '0')}}`;
	cases[`nest_${depth}_wrong_leaf`] = `{"nest":${arrays(depth, '1')}}`;
	cases[`nest_${depth}_one_item`] = `{"nest":${'['.repeat(depth)}0${']'.repeat(depth)}}`;
}
// `[0,0]`, which `pair` refuses, reached by `any` after it
cases.two_unions_inner = '{"two_unions":[[0,0]]}';
cases.two_unions_second_item = '{"two_unions":[[0,0],[0]]}';
cases.two_unions_in_an_object = '{"two_unions":{"a":[[0,0]]}}';
cases.two_unions_deeper = '{"two_unions":[[[0,0]],[0,0]]}';
// and what neither takes, an item that is no `0`, at each of those places
cases.two_unions_wrong_inner = '{"two_unions":[[0,1]]}';
cases.two_unions_wrong_second_item = '{"two_unions":[[0,0],[1]]}';
cases.two_unions_wrong_in_an_object = '{"two_unions":{"a":[[0,"x"]]}}';
cases.two_unions_wrong_beside = '{"two_unions":{"a":[[0,0]],"b":[[1]]}}';
// the same value reached by both evaluators' readings, in a list of three
cases.list_of_chains = `{"list":[${[1, 4, 9].map((depth) => chain(depth, 'a', '')).join(',')}]}`;

export const fixture: JsonFixture = {
	schema: s.object({
		expr: s.optional(expr),
		nest: s.optional(nest),
		list: s.optional(s.array(expr)),
		two_unions: s.optional(two_unions)
	}),
	cases
};
