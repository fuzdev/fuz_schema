/**
 * The unions on a cycle the two sides must rule on alike. `compile.ts`
 * refuses a `union` it can't bound, two or more options of which walk one
 * array or object on into a cycle, and the crate keeps the verdicts of the
 * same unions, `union_memoized` and `told_apart` in `builder.rs`: one rule,
 * written twice. Each row here is a union with whether `compile_guard`
 * refuses it: a recursive one of two options, drawn from a table of shapes in
 * each order, and those written out whole, of more options and of what a pair
 * of shapes can't say. `union_bounds.json` holds the rows, and the crate's
 * tests hold its builder to them: of the unions on a cycle, one refused there
 * has its verdicts kept, and no other. A `memo_union` is not among the rows:
 * the form writes it as a `union`, whose verdicts the crate keeps, and a
 * compile takes it.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { compile_guard } from '#lib/compile.ts';
import { to_schema_json } from '#lib/schema_json.ts';

// a discriminator value for the option at `index`, so two options of one shape differ
const VALUES = ['a', 'b'];

/**
 * What an option of the union can be, given the `lazy` of the union and
 * where it is among the options.
 */
const SHAPES: Record<string, (recursive: s.AnySchema, index: number) => s.AnySchema> = {
	literal_first: (L, i) => s.object({ t: s.literal(VALUES[i]!), x: s.array(L) }),
	literal_after: (L, i) => s.object({ x: s.array(L), t: s.literal(VALUES[i]!) }),
	literal_alike: (L) => s.object({ t: s.literal('z'), x: s.array(L) }),
	literal_at_a_key_of_its_own: (L, i) =>
		s.object({ ['k' + i]: s.literal(VALUES[i]!), x: s.array(L) }),
	literal_at_an_index_key: (L, i) => s.object({ x: s.array(L), 0: s.literal(VALUES[i]!) }),
	literal_after_a_plain_entry: (L, i) =>
		s.object({ p: s.string, t: s.literal(VALUES[i]!), x: s.array(L) }),
	literal_under_an_optional: (L, i) =>
		s.object({ t: s.optional(s.literal(VALUES[i]!)), x: s.array(L) }),
	literal_a_number: (L, i) => s.object({ t: s.literal(i), x: s.array(L) }),
	literal_minus_zero: (L) => s.object({ t: s.literal(-0), x: s.array(L) }),
	nullable_object: (L, i) => s.nullable(s.object({ t: s.literal(VALUES[i]!), x: s.array(L) })),
	lazy_object: (L, i) => {
		const object = s.object({ t: s.literal(VALUES[i]!), x: s.array(L) });
		return s.lazy(() => object);
	},
	default_nullable_strip_object: (L, i) =>
		s.with_default(s.nullable(s.strip_object({ t: s.literal(VALUES[i]!), x: s.array(L) })), null),
	loose_object: (L, i) => s.loose_object({ t: s.literal(VALUES[i]!), x: s.record(L) }),
	array: (L) => s.array(L),
	pipe_array: (L) => s.pipe(s.array(L), s.min_length(1)),
	record: (L) => s.record(L),
	variant: (L, i) => s.variant('t', [s.object({ t: s.literal(VALUES[i]!), x: s.array(L) })]),
	string: () => s.string,
	unknown: () => s.unknown,
	object_off_the_cycle: (_L, i) => s.object({ t: s.literal(VALUES[i]!) }),
	array_off_the_cycle: () => s.array(s.number),
	inner_union: (L, i) => s.union([s.string, s.object({ t: s.literal(VALUES[i]!), x: s.array(L) })])
};

// an option that walks on into the cycle, told by the literals of `entries`
const walking = (
	L: s.AnySchema,
	entries: Record<string, string | number | boolean | null>
): s.AnySchema =>
	s.object({
		...Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, s.literal(value)])),
		x: s.array(L)
	});

// the `lazy` of a union of the options made of it, which is the cycle
const recursive_union = (options: (L: s.AnySchema) => Array<s.AnySchema>): s.AnySchema => {
	const recursive: s.AnySchema = s.lazy(() => union);
	const union = s.union(options(recursive));
	return recursive;
};

/**
 * Unions written out whole, each by the schema a compile is asked for: of
 * three options, where telling apart is of every option at one key and not of
 * a pair, of literals that are alike only as text or as a type, and one that
 * is on no cycle.
 */
const UNIONS: Record<string, () => s.AnySchema> = {
	three_apart: () =>
		recursive_union((L) => ['a', 'b', 'c'].map((value) => walking(L, { t: value }))),
	three_two_alike: () =>
		recursive_union((L) => ['a', 'b', 'a'].map((value) => walking(L, { t: value }))),
	three_one_without_the_key: () =>
		recursive_union((L) => [walking(L, { t: 'a' }), walking(L, { t: 'b' }), walking(L, {})]),
	// each pair differs at a key, and no key has all three
	three_apart_only_by_pairs: () =>
		recursive_union((L) => [
			walking(L, { t: 'a', u: 'a' }),
			walking(L, { t: 'b', v: 'a' }),
			walking(L, { u: 'b', v: 'b' })
		]),
	three_one_off_the_cycle: () =>
		recursive_union((L) => [
			walking(L, { t: 'a' }),
			s.object({ t: s.literal('a') }),
			walking(L, { t: 'b' })
		]),
	// alike at the first key and apart at the second
	apart_at_a_second_key: () =>
		recursive_union((L) => [walking(L, { t: 'z', u: 'a' }), walking(L, { t: 'z', u: 'b' })]),
	string_against_the_number_it_prints: () =>
		recursive_union((L) => [walking(L, { t: '0' }), walking(L, { t: 0 })]),
	true_against_false: () =>
		recursive_union((L) => [walking(L, { t: true }), walking(L, { t: false })]),
	true_against_null: () =>
		recursive_union((L) => [walking(L, { t: true }), walking(L, { t: null })]),
	one_option_twice: () =>
		recursive_union((L) => {
			const option = walking(L, { t: 'a' });
			return [option, option];
		}),
	// its options walk on into a cycle it is not on
	off_every_cycle: () => {
		const recursive: s.AnySchema = s.lazy(() => tree);
		const tree = s.object({ x: s.array(recursive) });
		return s.union([s.object({ a: tree }), s.object({ b: tree })]);
	}
};

/** A row of `union_bounds.json`. */
export interface JsonUnionBound {
	/** The shapes of its two options, in order, or the name of a union written out whole. */
	name: string;
	/** The interchange document of the union, which the crate loads. */
	document: string;
	/** Whether `compile_guard` refuses it as one it can't bound. */
	refused: boolean;
}

const REFUSAL =
	/^cannot compile `union` at .*: two or more of its options can walk one array or object/;

/**
 * Every pair of the shapes, in each order, and then the unions written out whole.
 *
 * @throws Error when a compile throws anything but the refusal of an unbounded union, and whatever `to_schema_json` throws
 */
export const generate_json_union_bounds = (): Array<JsonUnionBound> => {
	const rows: Array<JsonUnionBound> = [];
	const add = (name: string, schema: s.AnySchema): void => {
		let refused = false;
		try {
			compile_guard(schema);
		} catch (error) {
			if (!(error instanceof Error) || !REFUSAL.test(error.message)) throw error;
			refused = true;
		}
		rows.push({ name, document: JSON.stringify(to_schema_json(schema)), refused });
	};
	const names = Object.keys(SHAPES);
	for (const first of names) {
		for (const second of names) {
			add(
				`${first}, ${second}`,
				recursive_union((L) => [SHAPES[first]!(L, 0), SHAPES[second]!(L, 1)])
			);
		}
	}
	for (const [name, make] of Object.entries(UNIONS)) add(name, make());
	return rows;
};
