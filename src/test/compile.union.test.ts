import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta } from '#lib/meta.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';
import { find_compile_differences } from './compile_test_helpers.ts';

// Recursive unions under the compiler, by counted runs and never by time:
// what is refused, what a `memo_union` keeps, and the state a compiled call
// has: the verdicts of a `memo_union`, and the context of a subtree run in
// place.

describe('recursive unions', () => {
	// The runs of the options are counted by a `check` that is the first entry
	// of each, and never by time
	const counts = { runs: 0 };
	const CAP = 200_000;
	const c = s.check(() => {
		if (++counts.runs > CAP) throw new Error('cap');
		return true;
	});
	const count = (run: () => unknown): number => {
		counts.runs = 0;
		run();
		return counts.runs;
	};
	type Union = (options: Array<s.AnySchema>) => s.AnySchema;
	// two options that walk `args` before the `literal` that tells them apart
	const walk_first = (union: Union): s.AnySchema => {
		const N: s.AnySchema = s.lazy(() =>
			union([
				s.object({ c, args: s.array(N), op: s.literal('a') }),
				s.object({ c, args: s.array(N), op: s.literal('b') }),
				s.number
			])
		);
		return N;
	};
	// two options no `literal` of their own tells apart: they differ a level down
	const differ_deep = (union: Union): s.AnySchema => {
		const N: s.AnySchema = s.lazy(() =>
			union([
				s.object({ c, args: s.array(N), meta: s.object({ v: s.literal(1) }) }),
				s.object({ c, args: s.array(N), meta: s.object({ v: s.literal(2) }) }),
				s.number
			])
		);
		return N;
	};
	// two options that take an array
	const two_arrays = (union: Union): s.AnySchema => {
		const N: s.AnySchema = s.lazy(() =>
			union([
				s.pipe(
					s.array(N),
					s.check((v: Array<unknown>) => (counts.runs++, v.length > 5))
				),
				s.pipe(
					s.array(N),
					s.check((v: Array<unknown>) => (counts.runs++, v.length < 5))
				),
				s.number
			])
		);
		return N;
	};
	// one option, a pipe of two containers over one subtree
	const piped = (union: Union): s.AnySchema => {
		const L: s.AnySchema = s.lazy(() =>
			union([s.pipe(s.object({ c, k: s.array(L) }), s.loose_object({ k: s.array(L) }) as any)])
		);
		return L;
	};
	const chain = (depth: number, node: (child: unknown) => unknown, leaf: unknown = 1): unknown => {
		let n = leaf;
		for (let i = 0; i < depth; i++) n = node(n);
		return n;
	};
	const tagged = (child: unknown): unknown => ({ args: [child], op: 'b' });
	const deep = (child: unknown): unknown => ({ args: [child], meta: { v: 2 } });
	const nested = (child: unknown): unknown => [child];
	const keyed = (child: unknown): unknown => ({ k: [child] });
	// each level holds the level below twice: as many objects as levels, and
	// twice the places at each
	const twice = (child: unknown): unknown => ({ args: [child, child], op: 'a' });
	const DEPTH = 14;

	const UNION_REFUSAL =
		': two or more of its options can walk one array or object on into a cycle, and an input is walked again at every level: make it a memo_union, or where each option is an object schema, a variant, or put the literal entry that tells them apart first in each';
	const PIPE_REFUSAL =
		': two or more of its steps walk the value on into a cycle, and an input is walked again at every level: make it the one option of a memo_union';
	const refused = (schema: s.AnySchema, message: string): void => {
		for (const compile of [compile_guard, compile_parse]) {
			assert.throws(() => compile(schema), new RegExp(`^${message.replace(/[`()/]/g, '\\$&')}$`));
		}
	};
	// two options a `literal` tells apart before either walks `args`
	const literal_first = (union: Union): s.AnySchema => {
		const N: s.AnySchema = s.lazy(() =>
			union([
				s.object({ op: s.literal('a'), c, args: s.array(N) }),
				s.object({ op: s.literal('b'), c, args: s.array(N) }),
				s.number
			])
		);
		return N;
	};

	test('a union the library walks in time exponential in the depth is refused, with its path and what to write', () => {
		for (const [make, node] of [
			[walk_first, tagged],
			[differ_deep, deep],
			[two_arrays, nested]
		] as const) {
			refused(make(s.union), 'cannot compile `union` at /def()' + UNION_REFUSAL);
			// which is what the interpreter does with it
			assert.isAbove(
				count(() => s.is(make(s.union), chain(DEPTH, node))),
				2 ** DEPTH
			);
		}
		// where it is, in a schema around it
		refused(
			s.object({ a: s.array(s.nullable(walk_first(s.union))) }),
			'cannot compile `union` at /def/a/def/def/schema/def()' + UNION_REFUSAL
		);
		// a literal that comes after an entry that walks on tells nothing apart in
		// time: one option is enough
		const N: s.AnySchema = s.lazy(() =>
			s.union([
				s.object({ c, args: s.array(N), op: s.literal('a') }),
				s.object({ op: s.literal('b'), c, args: s.array(N) })
			])
		);
		refused(N, 'cannot compile `union` at /def()' + UNION_REFUSAL);
		// and one value under two keys tells nothing apart
		const Same: s.AnySchema = s.lazy(() =>
			s.union([
				s.object({ op: s.literal('a'), args: s.array(Same) }),
				s.object({ op: s.literal('a'), args: s.array(Same), more: s.number })
			])
		);
		refused(Same, 'cannot compile `union` at /def()' + UNION_REFUSAL);
	});

	test('the same as a memo_union compiles, and keeps its bound in a guard, a parse, and a parse that fails', () => {
		for (const [make, node] of [
			[walk_first, tagged],
			[differ_deep, deep],
			[two_arrays, nested]
		] as const) {
			const schema = make(s.memo_union);
			const guard = compile_guard(schema);
			const parse = compile_parse(schema);
			for (const leaf of [1, 'x']) {
				const input = chain(DEPTH, node, leaf);
				assert.strictEqual(guard(input), leaf === 1);
				assert.isAtMost(
					count(() => guard(input)),
					3 * DEPTH + 3
				);
				assert.strictEqual(parse(input).ok, leaf === 1);
				// a parse that fails is the interpreter's, which has the memo's bound
				assert.isAtMost(
					count(() => parse(input)),
					6 * DEPTH + 6
				);
			}
		}
	});

	test('a memo_union is never refused, whatever its options reach', () => {
		// on a cycle, with two options that each read another recursive schema
		const Other: s.AnySchema = s.lazy(() => s.object({ c, k: s.array(Other) }));
		const M: s.AnySchema = s.lazy(() =>
			s.memo_union([
				s.object({ args: s.array(M), of: Other, op: s.literal('a') }),
				s.object({ args: s.array(M), of: Other, op: s.literal('b') })
			])
		);
		const node = (child: unknown): unknown => ({ args: [child], of: { k: [] }, op: 'b' });
		const input = chain(DEPTH, node, { args: [], of: { k: [] }, op: 'b' });
		for (const compiled of [compile_guard(M), compile_parse(M)]) {
			assert(compiled(input));
			assert.strictEqual(
				count(() => compiled(input)),
				2 * (DEPTH + 1)
			);
		}
	});

	test('a union whose options a literal tells apart first compiles, its options in the schema’s order', () => {
		const schema = literal_first(s.union);
		const guard = compile_guard(schema);
		const parse = compile_parse(schema);
		const node = (child: unknown): unknown => ({ op: 'b', args: [child] });
		for (const leaf of [1, 'x']) {
			const input = chain(DEPTH, node, leaf);
			assert.strictEqual(guard(input), leaf === 1);
			assert.strictEqual(
				count(() => guard(input)),
				DEPTH
			);
			assert.strictEqual(
				count(() => s.is(schema, input)),
				DEPTH
			);
			assert.deepEqual(parse(input), s.parse(schema, input));
			// a parse that fails is the compiled walk and then the interpreter's
			assert.isAtMost(
				count(() => parse(input)),
				2 * DEPTH
			);
		}
		// on an input that holds one object twice a level it is a walk for each
		// place, as the interpreter's is: only a `memo_union` reads a verdict back
		const twice_b = (child: unknown): unknown => ({ op: 'b', args: [child, child] });
		assert.strictEqual(
			count(() => guard(chain(8, twice_b))),
			2 ** 8 - 1
		);
		assert.strictEqual(
			count(() => s.is(schema, chain(8, twice_b))),
			2 ** 8 - 1
		);
	});

	test('a union that is on no cycle is not refused, whatever its options reach', () => {
		const Tree: s.AnySchema = s.lazy(() => s.object({ c, kids: s.array(Tree) }));
		// two options that each walk a recursive schema, asked of a value once
		const schema = s.union([
			s.object({ data: Tree, more: s.number }),
			s.object({ data: Tree, error: s.string })
		]);
		let tree: unknown = { kids: [] };
		for (let i = 0; i < DEPTH; i++) tree = { kids: [tree] };
		const input = { data: tree, error: 'e' };
		assert.isTrue(compile_guard(schema)(input));
		assert.strictEqual(
			count(() => compile_guard(schema)(input)),
			2 * (DEPTH + 1)
		);
		assert.deepEqual(compile_parse(schema)(input), s.parse(schema, input));
		// and in a recursive schema, where each is asked of a subtree of its own
		const Around: s.AnySchema = s.lazy(() => s.object({ next: s.optional(Around), of: schema }));
		assert.isTrue(compile_guard(Around)({ next: { of: input }, of: input }));
	});

	test('a union on a cycle only through a memo_union is not refused: the memo_union is asked of a value once', () => {
		const M: s.AnySchema = s.lazy(() => s.memo_union([U]));
		const U = s.union([
			s.object({ c, x: s.optional(M), a: s.number }),
			s.object({ c, x: s.optional(M) })
		]);
		const input = chain(DEPTH, (child) => ({ x: child }), {});
		for (const compiled of [compile_guard(M), compile_parse(M), compile_guard(U)]) {
			assert(compiled(input));
			assert.isAtMost(
				count(() => compiled(input)),
				2 * DEPTH + 2
			);
		}
		assert.isAtMost(
			count(() => s.is(M, input)),
			2 * DEPTH + 2
		);
	});

	test('a memo_union as an option walks nothing again, so the union around it has one option that walks on', () => {
		const N: s.AnySchema = s.lazy(() =>
			s.union([
				s.object({ c, args: s.array(N), op: s.literal('a') }),
				s.memo_union([s.object({ c, args: s.array(N), op: s.literal('b') })])
			])
		);
		// the first option fails after its walk at every level, and the second
		// reads back what it kept below: the size times the depth, and no more
		for (const leaf of [{ args: [], op: 'b' }, 'x']) {
			const input = chain(DEPTH, tagged, leaf);
			for (const run of [compile_guard(N), compile_parse(N), (v: unknown) => s.is(N, v)]) {
				assert.isAtMost(
					count(() => run(input)),
					2 * (DEPTH + 2) ** 2
				);
			}
			assert.strictEqual(compile_guard(N)(input), leaf !== 'x');
			assert.deepEqual(compile_parse(N)(input), s.parse(N, input));
		}
		// and more than a walk: it is not linear
		assert.isAbove(
			count(() => compile_guard(N)(chain(DEPTH, tagged, { args: [], op: 'b' }))),
			(DEPTH * DEPTH) / 2
		);
	});

	test('a pipe on a cycle, more than one step of which walks on, is refused, and compiles as the one option of a memo_union', () => {
		const input = chain(DEPTH, keyed, { k: [] });
		const L: s.AnySchema = s.lazy(() =>
			s.pipe(s.object({ c, k: s.array(L) }), s.loose_object({ k: s.array(L) }) as any)
		);
		refused(L, 'cannot compile `pipe` at /def()' + PIPE_REFUSAL);
		// which the interpreter walks twice a level
		assert.strictEqual(
			count(() => s.is(L, input)),
			2 ** (DEPTH + 1) - 1
		);
		// under a union of one option the pipe is still what is refused
		refused(piped(s.union), 'cannot compile `pipe` at /def()/def/0' + PIPE_REFUSAL);
		// a second step that walks another recursive schema, at every level
		const Other: s.AnySchema = s.lazy(() => s.loose_object({ k: s.array(Other) }));
		const Both: s.AnySchema = s.lazy(() => s.pipe(s.object({ c, k: s.array(Both) }), Other as any));
		refused(Both, 'cannot compile `pipe` at /def()' + PIPE_REFUSAL);
		assert.strictEqual(
			count(() => s.is(Both, input)),
			DEPTH + 1
		);
		const of_memo = piped(s.memo_union);
		for (const compiled of [compile_guard(of_memo), compile_parse(of_memo)]) {
			assert(compiled(input));
			assert.strictEqual(
				count(() => compiled(input)),
				count(() => s.is(of_memo, input))
			);
			assert.strictEqual(
				count(() => compiled(input)),
				DEPTH + 1
			);
		}
		// a pipe on no cycle is asked of a value once, and is not refused
		const Tree: s.AnySchema = s.lazy(() => s.object({ c, k: s.array(Tree) }));
		const once = s.pipe(Tree, Other as any);
		assert.isTrue(compile_guard(once)(input));
		assert.deepEqual(compile_parse(once)(input), s.parse(once, input));
		// nor is one with a single step that walks on
		const Checked: s.AnySchema = s.lazy(() =>
			s.pipe(
				s.object({ c, k: s.array(Checked) }),
				s.check((v) => v.k.length < 2)
			)
		);
		assert.strictEqual(
			count(() => compile_guard(Checked)(input)),
			DEPTH + 1
		);
	});

	test('an input that holds one object twice a level: a memo_union walks each object once', () => {
		const input = chain(DEPTH, twice);
		const of_memo = walk_first(s.memo_union);
		for (const compiled of [compile_guard(of_memo), compile_parse(of_memo)]) {
			assert.strictEqual(
				count(() => compiled(input)),
				count(() => s.is(of_memo, input))
			);
			assert.isAtMost(
				count(() => compiled(input)),
				2 * DEPTH
			);
		}
	});

	test('a kind of one’s own is not seen into, so what it walks is not refused', () => {
		// it walks its value twice, at every level
		const Own: s.AnySchema = {
			kind: 'twice',
			def: undefined,
			run: (value: any, ctx: s.SchemaContext) => {
				counts.runs++;
				if (value !== 1) {
					Own.run(value.x, ctx);
					Own.run(value.x, ctx);
				}
				return value;
			}
		};
		const input = chain(10, (child) => ({ x: child }));
		for (const schema of [Own, s.lazy(() => s.union([Own, s.object({ x: s.array(Own) })]))]) {
			assert.strictEqual(
				count(() => compile_guard(schema)(input)),
				2 ** 11 - 1
			);
		}
	});

	test('a memo_union under meta, brand, flavor, and message is told, and keeps its bound', () => {
		const input = chain(DEPTH, keyed, { k: [] });
		const dag = chain(16, twice);
		const wraps: Array<(schema: s.AnySchema) => s.AnySchema> = [
			(schema) => meta(schema, { description: 'a memo_union' }),
			(schema) => s.brand(schema, 'B'),
			(schema) => s.flavor(schema, 'F'),
			(schema) => s.message(schema, 'text'),
			(schema) => s.message(meta(s.message(schema, 'inner'), { description: 'd' }), () => 'outer')
		];
		for (const wrap of wraps) {
			// one option that walks one subtree twice
			const L: s.AnySchema = s.lazy(() =>
				wrap(
					s.memo_union([
						s.pipe(s.object({ c, k: s.array(L) }), s.loose_object({ k: s.array(L) }) as any)
					])
				)
			);
			// and options a literal tells apart, over an input that holds each level twice
			const N: s.AnySchema = s.lazy(() =>
				wrap(
					s.memo_union([
						s.object({ c, args: s.array(N), op: s.literal('a') }),
						s.object({ c, args: s.array(N), op: s.literal('b') }),
						s.number
					])
				)
			);
			for (const compile of [compile_guard, compile_parse]) {
				assert.strictEqual(
					count(() => compile(L)(input)),
					DEPTH + 1
				);
				assert.strictEqual(
					count(() => compile(N)(dag)),
					count(() => s.is(N, dag))
				);
				assert.isAtMost(
					count(() => compile(N)(dag)),
					2 * 17
				);
			}
		}
	});

	test('a union that shares a memo_union’s options array is told as one, and gives the same answers with verdicts kept', () => {
		const options = (N: () => s.AnySchema): Array<s.AnySchema> => [
			s.object({ c, args: s.array(s.lazy(N)), op: s.literal('a') }),
			s.object({ c, args: s.array(s.lazy(N)), op: s.literal('b') }),
			s.number
		];
		// a union made from a memo_union's own `def`
		const made: s.AnySchema = s.memo_union(options(() => from_memo));
		const from_memo: s.AnySchema = s.union(made.def);
		// and a union whose array a memo_union was made from after it
		const before: s.AnySchema = s.union(options(() => before));
		s.memo_union(before.def);
		const plain = walk_first(s.union);
		const dag = chain(12, twice);
		// each is a `union` the library walks once a place, which the compiler would
		// refuse: told as a `memo_union`, it is compiled as one
		for (const schema of [from_memo, before]) {
			assert.isTrue(s.is_memo_union(schema));
			// the interpreter runs it as the union it is: once a place
			assert.strictEqual(
				count(() => s.is(schema, dag)),
				2 ** 12 - 1
			);
			// compiled code keeps its verdicts: once an object
			assert.strictEqual(
				count(() => compile_guard(schema)(dag)),
				12
			);
			for (const input of [dag, chain(6, tagged), chain(6, tagged, 'x'), 1, null]) {
				assert.strictEqual(compile_guard(schema)(input), s.is(plain, input));
				assert.deepEqual(compile_parse(schema)(input), s.parse(schema, input));
			}
			// its own `run` keeps nothing, and a compiled parse that fails calls it:
			// the library's walk, which the compiler did not refuse
			assert.isAbove(
				count(() => compile_parse(schema)(chain(10, tagged, 'x'))),
				2 ** 10
			);
			assert.isAtMost(
				count(() => compile_guard(schema)(chain(10, tagged, 'x'))),
				3 * 10
			);
		}
		// and where an option can change a value, a compiled parse of an input
		// that matches runs it too
		const changing = (N: () => s.AnySchema): Array<s.AnySchema> => [
			s.strip_object({ c, args: s.array(s.lazy(N)), op: s.literal('a') }),
			s.strip_object({ c, args: s.array(s.lazy(N)), op: s.literal('b') }),
			s.number
		];
		const made_changing: s.AnySchema = s.memo_union(changing(() => shares));
		const shares: s.AnySchema = s.union(made_changing.def);
		for (const leaf of [1, 'x']) {
			assert.isAbove(
				count(() => compile_parse(shares)(chain(10, tagged, leaf))),
				2 ** 10
			);
			assert.isAtMost(
				count(() => compile_guard(shares)(chain(10, tagged, leaf))),
				3 * 10
			);
			assert.deepEqual(
				compile_parse(shares)(chain(6, tagged, leaf)),
				s.parse(shares, chain(6, tagged, leaf))
			);
		}
	});

	test('a memo_union whose option changes a value gives one object the outputs the interpreter gives it', () => {
		const M = s.memo_union([s.strip_object({ a: s.with_default(s.number, 0) }), s.number]);
		const shared = { z: 1 };
		// probed, under a union's option: one output object in both places
		const probed = s.union([s.array(M), s.string]);
		// not probed: an output for each place
		const unprobed = s.array(M);
		for (const [schema, same] of [
			[probed, true],
			[unprobed, false]
		] as const) {
			const expected = s.parse(schema, [shared, shared]);
			const actual = compile_parse(schema)([shared, shared]);
			assert(expected.ok && actual.ok);
			assert.deepEqual(actual.value, expected.value);
			assert.deepEqual(actual.value, [{ a: 0 }, { a: 0 }]);
			assert.strictEqual(expected.value[0] === expected.value[1], same);
			assert.strictEqual(actual.value[0] === actual.value[1], same);
		}
		// a plain union gives each place a copy of its own, in both
		const U = s.union([s.strip_object({ a: s.with_default(s.number, 0) }), s.number]);
		for (const schema of [s.union([s.array(U), s.string]), s.array(U)]) {
			const expected = s.parse(schema, [shared, shared]);
			const actual = compile_parse(schema)([shared, shared]);
			assert(expected.ok && actual.ok);
			assert.notStrictEqual(expected.value[0], expected.value[1]);
			assert.notStrictEqual(actual.value[0], actual.value[1]);
		}
	});

	test('a verdict kept in one call is not read by the next', () => {
		// of the `memo_union` alone: a plain `union` of these options is refused
		for (const union of [s.memo_union as Union]) {
			const guard: (value: unknown) => boolean = compile_guard(differ_deep(union));
			const input: any = chain(6, deep);
			assert(guard(input));
			input.args[0].args[0].meta.v = 3;
			assert(!guard(input));
			input.args[0].args[0].meta.v = 1;
			assert(guard(input));
		}
	});

	test('two unions that keep verdicts, asked of one object, each give their own', () => {
		// of the `memo_union` alone: a plain `union` of these options is refused
		for (const union of [s.memo_union as Union]) {
			const One = differ_deep(union);
			const Other: s.AnySchema = s.lazy(() =>
				union([
					s.object({ args: s.array(Other), meta: s.object({ v: s.literal(2) }) }),
					s.object({ args: s.array(Other), meta: s.object({ v: s.literal(3) }) }),
					s.number
				])
			);
			const x = { args: [], meta: { v: 1 } };
			const y = { args: [], meta: { v: 3 } };
			for (const schema of [s.object({ a: One, b: Other }), s.array(s.union([One, Other]))]) {
				const guard = compile_guard(schema);
				for (const input of [{ a: x, b: x }, { a: x, b: y }, { a: y, b: y }, [x, y, x, y]]) {
					assert.strictEqual(guard(input), s.is(schema, input));
				}
			}
		}
	});

	test('a cyclic input throws a RangeError, the interpreter’s: the next call answers', () => {
		const cyclic: any = { args: [], op: 'b' };
		cyclic.args.push(cyclic);
		const around: any = { args: [], meta: { v: 2 } };
		around.args.push(around);
		for (const [schema, input] of [
			[walk_first(s.memo_union), cyclic],
			[differ_deep(s.memo_union), around],
			[literal_first(s.union), cyclic]
		] as const) {
			const guard = compile_guard(schema);
			const parse = compile_parse(schema);
			assert.throws(() => s.is(schema, input), RangeError);
			assert.throws(() => guard(input), RangeError);
			assert.throws(() => parse(input), RangeError);
			assert.isTrue(guard(1));
			assert.deepEqual(parse(1), { ok: true, value: 1 });
		}
	});
});

describe('the state of a call', () => {
	const Even: s.AnySchema = {
		kind: 'even',
		def: undefined,
		run: (v: any, ctx: s.SchemaContext) => (v % 2 === 0 ? v : s.fail(ctx, 'even', v))
	};

	test('a compiled function called from a check it is running gives its answer, and the outer call its own', () => {
		let inner: (value: unknown) => unknown = () => undefined;
		let armed = false;
		let inner_gave: unknown;
		const schema = s.object({
			pre: s.string,
			u: s.union([
				s.object({
					a: s.pipe(
						s.string,
						s.check(() => {
							if (armed) {
								armed = false;
								inner_gave = inner({ pre: 1 });
							}
							return true;
						})
					)
				}),
				s.pipe(s.string, s.to_lower_case)
			]),
			e: Even
		});
		const parse = compile_parse(schema);
		const guard = compile_guard(schema);
		const make = (): unknown => ({ pre: 'p', u: { a: 'x' }, e: 2 });
		inner = parse;
		armed = true;
		assert.deepEqual(parse(make()), s.parse(schema, make()));
		assert.deepEqual(inner_gave, s.parse(schema, { pre: 1 }));
		inner = guard;
		armed = true;
		assert.isTrue(guard(make()));
		assert.isFalse(inner_gave);
	});

	test('the outer call keeps its verdicts through an inner one, and a throw leaves nothing behind', () => {
		let runs = 0;
		let on_run: (() => void) | undefined;
		const counted = s.check(() => {
			runs++;
			on_run?.();
			return true;
		});
		// of the `memo_union` alone: a plain `union` of these options is refused
		for (const union of [s.memo_union]) {
			const N: s.AnySchema = s.lazy(() =>
				(
					union as (options: Array<s.AnySchema>) => s.AnySchema
				)([
					s.object({ c: counted, args: s.array(N), meta: s.object({ v: s.literal(1) }) }),
					s.object({ c: counted, args: s.array(N), meta: s.object({ v: s.literal(2) }) }),
					s.number
				])
			);
			const guard: (value: unknown) => boolean = compile_guard(N);
			const chain_of = (depth: number): unknown => {
				let n: unknown = 1;
				for (let i = 0; i < depth; i++) n = { args: [n], meta: { v: 2 } };
				return n;
			};
			const input = chain_of(12);
			runs = 0;
			guard(input);
			const alone = runs;
			assert.isAtMost(alone, 3 * 12);
			// an inner call of the same function, on another input, at every run
			let inner_runs = 0;
			let nested = false;
			on_run = () => {
				if (nested) return;
				nested = true;
				const before = runs;
				assert.isTrue(guard(chain_of(3)));
				inner_runs += runs - before;
				nested = false;
			};
			runs = 0;
			assert.isTrue(guard(input));
			// what the outer call ran is what it runs alone: its verdicts were kept
			assert.strictEqual(runs - inner_runs, alone);
			// a check that throws, and then a call that finds nothing of the one before
			on_run = () => {
				if (runs > 6) throw new Error('thrown by a check');
			};
			runs = 0;
			assert.throws(() => guard(input), 'thrown by a check');
			on_run = undefined;
			runs = 0;
			assert.isTrue(guard(input));
			assert.strictEqual(runs, alone);
			const changed: any = chain_of(4);
			assert.isTrue(guard(changed));
			changed.args[0].meta.v = 3;
			assert.isFalse(guard(changed));
		}
	});

	test('an inner call starts with a state of its own: it is not probed where the outer call is', () => {
		const M = s.memo_union([s.strip_object({ d: s.with_default(s.number, 0) }), s.number]);
		let inner_gave: any;
		let armed = false;
		const schema: s.AnySchema = s.object({
			u: s.union([
				s.strip_object({
					a: s.pipe(
						s.string,
						s.check(() => {
							if (armed) {
								armed = false;
								const shared = {};
								// under the outer call's union option, which is probed
								inner_gave = parse({ u: 1, m: [shared, shared] });
							}
							return true;
						})
					)
				}),
				s.number
			]),
			m: s.array(M)
		});
		const parse = compile_parse(schema);
		armed = true;
		const outer = parse({ u: { a: 'x', z: 1 }, m: [] });
		assert.deepEqual(outer, { ok: true, value: { u: { a: 'x' }, m: [] } });
		// the inner call's array is not under a union: its items are not probed, and get an output each
		assert.deepEqual(inner_gave, { ok: true, value: { u: 1, m: [{ d: 0 }, { d: 0 }] } });
		assert.notStrictEqual(inner_gave.value.m[0], inner_gave.value.m[1]);
		const shared = {};
		const expected: any = s.parse(schema, { u: 1, m: [shared, shared] });
		assert.notStrictEqual(expected.value.m[0], expected.value.m[1]);
	});

	test('a memo_union after a compiled union that matched is not probed, so one object in two places gets two outputs', () => {
		const M: s.AnySchema = s.lazy(() =>
			s.memo_union([
				s.strip_object({ x: s.array(M), d: s.with_default(s.string, 'd') }),
				s.loose_object({ y: s.string })
			])
		);
		// the first entry is a union compiled in place, whose options are probed;
		// the second is run in place after it, where the library is not probing
		const schema = s.object({
			u: s.union([s.pipe(s.string, s.to_lower_case), s.strip_object({ a: s.string })]),
			m: s.array(M)
		});
		const make = (): unknown => {
			const leaf = { x: [] };
			const node = { x: [leaf, leaf] };
			return { u: 'A', m: [node, node, leaf] };
		};
		assert.deepEqual(
			find_compile_differences(schema, [
				make,
				() => ({ ...(make() as object), u: { a: 'x', z: 1 } })
			]),
			[]
		);
		const result = compile_parse(schema)(make());
		assert(result.ok);
		const m = (result.value as any).m;
		// as the interpreter has it: the array's items are not probed, what they hold is
		assert.notStrictEqual(m[0], m[1]);
		assert.strictEqual(m[0].x[0], m[0].x[1]);
	});

	test('a kind of the consumer’s own that holds a memo_union keeps no verdict from one call to the next', () => {
		const Inner: s.AnySchema = s.lazy(() =>
			s.memo_union([
				s.object({ x: s.array(Inner), t: s.literal('a') }),
				s.object({ x: s.array(Inner) })
			])
		);
		// a kind with no code of the compiler, which runs what it holds as the library's wrappers do
		const Holder: s.AnySchema = {
			kind: 'holder',
			def: undefined,
			run: (value: unknown, ctx: s.SchemaContext) => Inner.run(value, ctx)
		};
		for (const schema of [Holder, s.object({ h: Holder }), s.array(Holder)]) {
			const guard: (value: unknown) => boolean = compile_guard(schema);
			const parse = compile_parse(schema);
			const node: any = { x: [{ x: [] }] };
			const input = schema === Holder ? node : schema.kind === 'array' ? [node] : { h: node };
			assert.isTrue(guard(input));
			assert.isTrue(parse(input).ok);
			// the same objects, changed in place: a verdict kept by the context of a call before would still say yes
			node.x[0].x = 'not an array';
			assert.isFalse(s.is(schema, input));
			assert.isFalse(guard(input));
			assert.isFalse(parse(input).ok);
		}
	});
});
