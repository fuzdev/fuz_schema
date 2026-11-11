import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { to_standard_schema } from '#lib/standard_schema.ts';
import { issues_of } from './schema_test_helpers.ts';

describe('array, union, variant', () => {
	describe('memo_union', () => {
		type Union = (options: Array<s.AnySchema>) => s.AnySchema;
		const UNIONS: Array<[string, Union]> = [
			['union', (options) => s.union(options)],
			['memo_union', (options) => s.memo_union(options)]
		];

		// counts the runs of every option it wraps, with the `length` of the
		// option's `run`, so the union holding it chooses the closure it would
		let runs = 0;
		const counted = (o: s.AnySchema): s.AnySchema => ({
			kind: o.kind,
			def: o.def,
			run:
				o.run.length > 2
					? (value: unknown, ctx: s.SchemaContext, parent: any, key: any) => (
							runs++,
							o.run(value, ctx, parent, key)
						)
					: (value: unknown, ctx: s.SchemaContext) => (runs++, o.run(value, ctx))
		});

		// expressions whose options walk `args` before the `op` that tells them apart
		const expr = (U: Union, ops = ['a', 'b']): s.AnySchema => {
			const Node: s.AnySchema = s.lazy(() =>
				U(ops.map((op) => counted(s.object({ args: s.array(Node), op: s.literal(op) }))))
			);
			return Node;
		};
		const expr_chain = (depth: number, op = 'b', leaf: unknown = { args: [], op }): unknown => {
			let node = leaf;
			for (let i = 0; i < depth; i++) node = { args: [node], op };
			return node;
		};

		// the L/M form: an option of each link reads into the link before it,
		// and the last into `M`, a JSON-like union
		const chain = (U: Union, links: number): s.AnySchema => {
			const M: s.AnySchema = s.lazy(() =>
				U([s.string, s.number, s.array(M), s.record(M)].map(counted))
			);
			let next = M;
			for (let k = 0; k < links; k++) {
				const prev = next;
				const L: s.AnySchema = s.lazy(() =>
					U(
						[
							s.object({ x: s.array(L), t: s.literal('a') }),
							s.loose_object({ x: s.array(prev) })
						].map(counted)
					)
				);
				next = L;
			}
			return next;
		};
		const x_chain = (depth: number): unknown => {
			let node: unknown = { x: [], t: 'b' };
			for (let i = 0; i < depth; i++) node = { x: [node], t: 'b' };
			return node;
		};

		const count = (
			schema: s.AnySchema,
			input: unknown,
			ok = true
		): { parse: number; is: number } => {
			runs = 0;
			assert.strictEqual(s.parse(schema, input).ok, ok);
			const parse = runs;
			runs = 0;
			assert.strictEqual(s.is(schema, input), ok);
			return { parse, is: runs };
		};

		test('runs the options of a recursive union a number of times linear in depth', () => {
			const two = expr(s.memo_union);
			assert.deepEqual(count(two, expr_chain(10)), { parse: 22, is: 22 });
			assert.deepEqual(count(two, expr_chain(100)), { parse: 202, is: 202 });
			const three = expr(s.memo_union, ['a', 'b', 'c']);
			assert.deepEqual(count(three, expr_chain(100, 'c')), { parse: 303, is: 303 });
			// where `union` doubles at each level
			assert.deepEqual(count(expr(s.union), expr_chain(10)), { parse: 4094, is: 4094 });
			// and on an input whose leaf fails, which keeps the failures
			const failing = expr_chain(10, 'b', { args: [], op: 'c' });
			assert.deepEqual(count(two, failing, false), { parse: 22, is: 22 });
			assert.deepEqual(count(expr(s.union), failing, false), { parse: 4094, is: 4094 });
		});

		test('on a chain, linear when every link and what the last reads into are one', () => {
			const memo = chain(s.memo_union, 2);
			assert.deepEqual(count(memo, x_chain(10)), { parse: 114, is: 114 });
			assert.deepEqual(count(memo, x_chain(20)), { parse: 234, is: 234 });
			assert.deepEqual(count(memo, x_chain(30)), { parse: 354, is: 354 });
			assert.deepEqual(count(chain(s.union, 2), x_chain(10)), { parse: 1452, is: 1452 });
		});

		test('gives what union gives: verdicts, outputs, and issues', () => {
			const cases: Array<[string, (U: Union) => s.AnySchema, Array<unknown>]> = [
				['primitives', (U) => U([s.string, s.number]), ['a', 1, true, null, {}, []]],
				[
					'containers',
					(U) => U([s.object({ a: s.string }), s.array(s.number)]),
					[{ a: 'x' }, { a: 1 }, { a: 'x', b: 1 }, [1], [1, 'x'], {}, 'x']
				],
				[
					'copies',
					(U) => U([s.strip_object({ a: s.string }), s.object({ b: s.with_default(s.number, 1) })]),
					[{ a: 'x', z: 1 }, { b: undefined }, {}, { z: 1 }]
				],
				[
					'a transform',
					(U) =>
						U([
							s.pipe(
								s.object({ a: s.number }),
								s.transform((o: { a: number }) => ({ ...o, t: 1 }))
							),
							s.string
						]),
					[{ a: 1 }, { a: 'x' }, 'x']
				],
				[
					'recursive',
					(U) => expr(U, ['a', 'b', 'c']),
					[
						expr_chain(6, 'c'),
						expr_chain(6, 'c', { args: [], op: 'd' }),
						expr_chain(6, 'b', { args: [1], op: 'b' }),
						{ args: [expr_chain(3, 'a'), expr_chain(3, 'b'), 1], op: 'c' },
						{ args: 'x', op: 'a' },
						1
					]
				],
				[
					'the L/M form',
					(U) => chain(U, 2),
					[x_chain(6), { x: [{ x: [true], t: 'b' }], t: 'b' }, { x: 1 }, null]
				],
				[
					'an entry that a missing key fails',
					(U) => s.object({ a: U([s.number, s.unknown]) }),
					[{}, { a: undefined }, { a: 1 }, { a: {} }]
				],
				[
					'an entry with an optional',
					(U) => s.object({ a: U([s.number, s.optional(s.string)]) }),
					[{}, { a: undefined }, { a: 'x' }, { a: true }]
				],
				[
					'an entry with a default after an unknown',
					(U) => s.object({ a: U([s.unknown, s.with_default(s.string, 'D')]) }),
					[{}, { a: undefined }, { a: 1 }]
				],
				[
					'an entry under a nullable, a message, and a pipe',
					(U) =>
						s.object({
							a: s.nullable(U([s.number, s.unknown])),
							b: s.message(U([s.unknown, s.with_default(s.string, 'D')]), 'm'),
							c: s.pipe(
								U([s.number, s.optional(s.string)]),
								s.check(() => true)
							)
						}),
					[{ a: 1 }, {}, { a: null, b: 1, c: 'x' }, { a: true, c: true }]
				],
				[
					'inside another union',
					(U) => s.union([U([s.object({ a: s.number })]), U([s.object({ a: s.string })])]),
					[{ a: 1 }, { a: 'x' }, { a: true }]
				],
				[
					'a record',
					(U) => s.record(U([s.number, s.array(s.number)])),
					[{ a: 1, b: [1] }, { a: 'x' }]
				]
			];
			for (const [name, make, inputs] of cases) {
				const [union, memo] = UNIONS.map(([, U]) => make(U));
				for (const input of inputs) {
					const message = `${name} on ${JSON.stringify(input)}`;
					assert.deepEqual(s.parse(memo!, input), s.parse(union!, input), message);
					assert.strictEqual(s.is(memo!, input), s.is(union!, input), message);
				}
			}
		});

		test('takes the object and the key exactly where union does', () => {
			for (const options of [[s.string], [s.unknown], [s.string, s.lazy(() => s.number)]]) {
				assert.strictEqual(s.memo_union(options).run.length, s.union(options).run.length);
			}
			assert.strictEqual(s.memo_union([s.string]).run.length, 2);
			assert.strictEqual(s.memo_union([s.unknown]).run.length, 4);
			// so a union that fills a missing key in tries it again only where it
			// would a union: one that takes neither, as a bare `check` doesn't, is not
			for (const [take, times] of [
				[s.check(() => false), 1],
				[
					s.pipe(
						s.unknown,
						s.check(() => false)
					),
					2
				]
			] as const) {
				for (const [name, U] of UNIONS) {
					runs = 0;
					const schema = s.object({
						a: s.union([U([counted(take)]), s.with_default(s.number, 1)])
					});
					assert.deepEqual(s.parse_or_throw(schema, {}), { a: 1 }, name);
					assert.strictEqual(runs, times, name);
				}
			}
		});

		test('is of kind union, and read as one', () => {
			const options = [s.string, s.object({ a: s.number })] as const;
			const memo = s.memo_union(options);
			assert.strictEqual(memo.kind, 'union');
			assert.strictEqual(memo.def, options);
			assert.deepEqual(Object.keys(memo), ['kind', 'def', 'run']);
			expectTypeOf<s.Infer<typeof memo>>().toEqualTypeOf<string | { a: number }>();
			const standard = to_standard_schema(memo)['~standard'].validate(1);
			assert(!(standard instanceof Promise));
			assert.strictEqual(standard.issues?.length, 1);
		});

		test('runs a transform beneath it once for an object it is probed with again', () => {
			for (const [name, U] of UNIONS) {
				let transforms = 0;
				const E: s.AnySchema = s.lazy(() =>
					U([
						s.object({ args: s.array(E), op: s.literal('+') }),
						s.object({
							args: s.array(E),
							op: s.pipe(
								s.literal('-'),
								s.transform((x: '-') => (transforms++, x))
							)
						}),
						s.pipe(
							s.object({ leaf: s.number }),
							s.transform((o: { leaf: number }) => (transforms++, { ...o }))
						)
					])
				);
				const leaf = { leaf: 1 };
				const input = { args: [leaf, leaf, { args: [leaf], op: '-' }], op: '-' };
				const first = s.parse_or_throw(E, input);
				const once = transforms;
				// the same object twice in the input gives one output object in both places
				assert.strictEqual(first.args[0] === first.args[1], name === 'memo_union', name);
				assert.deepEqual(first, input, name);
				// and nothing of one parse reaches another
				const second = s.parse_or_throw(E, input);
				assert.notStrictEqual(second.args[0], first.args[0], name);
				assert.strictEqual(transforms, 2 * once, name);
				assert.strictEqual(once, name === 'memo_union' ? 3 : 11, name);
			}
		});

		test('keeps only what it gives while probing', () => {
			let transforms = 0;
			const M = s.memo_union([
				s.pipe(
					s.object({ x: s.number }),
					s.transform((o: { x: number }) => (transforms++, { ...o }))
				)
			]);
			const schema = s.object({ a: M, b: M });
			const shared = { x: 1 };
			// an entry is not probed, so each runs
			const output = s.parse_or_throw(schema, { a: shared, b: shared });
			assert.strictEqual(transforms, 2);
			assert.notStrictEqual(output.a, output.b);
			// and each fails with an issue of its own
			const bad = { x: 'x' };
			assert.deepEqual(
				issues_of(schema, { a: bad, b: bad }).map((issue) => issue.path),
				[['a'], ['b']]
			);
			// where `is` probes, and the second is read back
			transforms = 0;
			assert(s.is(schema, { a: shared, b: shared }));
			assert.strictEqual(transforms, 1);
			assert(!s.is(schema, { a: shared, b: bad }));
			assert(!s.is(s.array(M), [bad, bad]));
		});

		test('keeps an output of undefined', () => {
			let transforms = 0;
			const M = s.memo_union([
				s.pipe(
					s.object({ x: s.number }),
					s.transform((): undefined => {
						transforms++;
					})
				)
			]);
			const shared = { x: 1 };
			assert(s.is(s.array(M), [shared, shared]));
			assert.strictEqual(transforms, 1);
		});

		test('a check with state can tell', () => {
			for (const [name, U] of UNIONS) {
				let calls = 0;
				const E: s.AnySchema = s.lazy(() =>
					U([
						s.object({ args: s.array(E), op: s.literal('+') }),
						s.object({
							leaf: s.pipe(
								s.number,
								s.check(() => ++calls <= 1)
							)
						})
					])
				);
				const leaf = { leaf: 1 };
				// the second `leaf` is read back where the check would fail it
				assert.strictEqual(s.is(E, { args: [leaf, leaf], op: '+' }), name === 'memo_union');
			}
		});

		// an object whose `x` is `1` and then `'a'` on every read after the first
		const changing = (reads: { count: number }): { x: unknown } => ({
			get x() {
				return reads.count++ ? 'a' : 1;
			}
		});

		// what two options of an outer union probe `M` with the same object `a`
		// through: `M` is an entry before `z`, so the first option reads `z`, and
		// fails on a `z` of `2`, only after its probe of `M` is done
		const probed_twice = (M: s.AnySchema): s.AnySchema =>
			s.union([s.object({ a: M, z: s.literal(1) }), s.object({ a: M, z: s.literal(2) })]);

		test('reads nothing of an object it is probed with again in one parse', () => {
			for (const [name, U] of UNIONS) {
				const schema = probed_twice(U([s.object({ x: s.number })]));
				// the reads of `a` by every probe of `M`, however many one probe makes
				const reads_of = (z: number): number => {
					let reads = 0;
					const a = {
						get x() {
							reads++;
							return 1;
						}
					};
					assert(s.parse(schema, { a, z }).ok, name);
					return reads;
				};
				// a `z` of `1` is one probe of `M`, of `2` two, the second of them a memo hit
				const once = reads_of(1);
				assert(once > 0, name);
				assert.strictEqual(reads_of(2), once * (name === 'memo_union' ? 1 : 2), name);
			}
		});

		test('a second probe is handed what the first read', () => {
			for (const [name, U] of UNIONS) {
				const schema = probed_twice(U([s.object({ x: s.number })]));
				// `x` is `1` until `z` is read, which ends the first probe of `M`
				let probed = false;
				const input = {
					a: {
						get x() {
							return probed ? 'a' : 1;
						}
					},
					get z() {
						probed = true;
						return 2;
					}
				};
				assert.strictEqual(s.parse(schema, input).ok, name === 'memo_union', name);
			}
		});

		test('a getter held twice can make is and parse differ', () => {
			for (const [name, U] of UNIONS) {
				const M = U([s.object({ x: s.number })]);
				const input = (): Array<unknown> => {
					const o = changing({ count: 0 });
					return [o, o];
				};
				// `parse` probes neither item, so each reads the getter
				assert(!s.parse(s.array(M), input()).ok, name);
				// `is` probes both, and the second is read back from the memo
				assert.strictEqual(s.is(s.array(M), input()), name === 'memo_union', name);
			}
		});

		test('a Proxy it is probed with again in one parse is enumerated by the first probe alone', () => {
			for (const [name, U] of UNIONS) {
				const schema = probed_twice(U([s.object({ x: s.number })]));
				const enumerations_of = (z: number): number => {
					let enumerations = 0;
					const a = new Proxy(
						{ x: 1 },
						{
							ownKeys: (target) => {
								enumerations++;
								return Reflect.ownKeys(target);
							},
							getOwnPropertyDescriptor: (target, key) =>
								Reflect.getOwnPropertyDescriptor(target, key)
						}
					);
					assert(s.is(schema, { a, z }), name);
					return enumerations;
				};
				const once = enumerations_of(1);
				assert(once > 0, name);
				assert.strictEqual(enumerations_of(2), once * (name === 'memo_union' ? 1 : 2), name);
				// an unknown key `y` appears once `z` is read, after the first probe of `M`
				let probed = false;
				const a = new Proxy(
					{ x: 1, y: 1 },
					{
						ownKeys: () => (probed ? ['x', 'y'] : ['x']),
						getOwnPropertyDescriptor: (target, key) => Reflect.getOwnPropertyDescriptor(target, key)
					}
				);
				const input = {
					a,
					get z() {
						probed = true;
						return 2;
					}
				};
				assert.strictEqual(s.is(schema, input), name === 'memo_union', name);
			}
		});

		test('a revoked Proxy throws as under union', () => {
			const errors = UNIONS.map(([, U]) => {
				const M = U([s.object({ x: s.number })]);
				const { proxy, revoke } = Proxy.revocable({ x: 1 }, {});
				revoke();
				return [
					() => s.is(s.array(M), [proxy, proxy]),
					() =>
						s.parse(s.union([s.object({ a: M, z: s.literal(1) }), s.object({ a: M })]), {
							a: proxy
						})
				].map((run) => {
					try {
						run();
					} catch (error) {
						return String(error);
					}
					return 'no throw';
				});
			});
			assert.deepEqual(errors[1], errors[0]);
			assert(errors[0]!.every((e) => e.startsWith('TypeError')));
		});

		test('a stable object held twice gets what union gives', () => {
			const results = UNIONS.map(([name, U]) => {
				const M = U([s.strip_object({ x: s.number }), s.array(s.number)]);
				// probed under an outer union, so the second key reads the memo
				const schema = s.union([s.object({ a: M, b: M })]);
				const copied = { x: 1, q: 1 };
				const output = s.parse_or_throw(schema, { a: copied, b: copied });
				// one output object in both places, where union copies twice
				assert.strictEqual(output.a === output.b, name === 'memo_union', name);
				const failing = { x: 'x' };
				const list = [1];
				return [
					output,
					s.parse(schema, { a: failing, b: failing }),
					s.is(schema, { a: failing, b: failing }),
					s.is(schema, { a: list, b: list })
				];
			});
			assert.deepEqual(results[1], results[0]);
			assert.deepEqual(results[0]!.slice(2), [false, true]);
		});

		test('a context run again keeps its memo', () => {
			// a context is one parse: run again, the memo answers for an object it
			// kept, changed or not
			for (const [name, U] of UNIONS) {
				const M = U([s.object({ x: s.number })]);
				const value: { x: unknown } = { x: 1 };
				const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
				M.run(value, ctx);
				assert.strictEqual(ctx.fails, 0, name);
				value.x = 'a';
				M.run(value, ctx);
				assert.strictEqual(ctx.fails, name === 'memo_union' ? 0 : 1, name);
				// a fresh context reads it again
				assert(!s.is(M, value), name);
			}
		});

		test('keeps and reads only while probing', () => {
			const results = UNIONS.map(([, U]) => {
				const M = U([s.strip_object({ x: s.number })]);
				// copied by the strip, so each run gives an object of its own
				const kept = { x: 1, q: 1 };
				const failing = { x: 'x' };
				// `a` is probed, under a union, and `b` is not, in either order
				const probed_first = s.object({ a: s.union([M]), b: M });
				const probed_last = s.object({ a: M, b: s.union([M]) });
				const first = s.parse_or_throw(probed_first, { a: kept, b: kept });
				const last = s.parse_or_throw(probed_last, { a: kept, b: kept });
				return [
					first.a === first.b,
					last.a === last.b,
					s.parse(probed_first, { a: failing, b: failing }),
					s.parse(probed_last, { a: failing, b: failing })
				];
			});
			assert.deepEqual(results[1], results[0]);
			assert.deepEqual(results[0]!.slice(0, 2), [false, false]);
		});

		test('a parse inside a check has a memo of its own', () => {
			const verdicts = UNIONS.map(([, U]) => {
				// a check that runs `is` of the union on each child
				const N: s.AnySchema = s.lazy(() =>
					U([
						s.object({ args: s.array(N), op: s.literal('a') }),
						s.pipe(
							s.object({ args: s.array(s.unknown), op: s.literal('b') }),
							s.check((v: { args: Array<unknown>; op: 'b' }) => v.args.every((a) => s.is(N, a)))
						)
					])
				);
				return [
					expr_chain(4, 'b'),
					expr_chain(4, 'b', { args: [], op: 'c' }),
					{ args: [expr_chain(2, 'a'), expr_chain(2, 'b')], op: 'b' },
					{ args: [expr_chain(2, 'a'), expr_chain(2, 'a', 1)], op: 'b' }
				].flatMap((input) => [s.is(N, input), s.parse(N, input).ok]);
			});
			assert.deepEqual(verdicts[1], verdicts[0]);
			assert.deepEqual(verdicts[0], [true, true, false, false, true, true, false, false]);
		});

		test('a cyclic input still throws a RangeError', () => {
			for (const [name, U] of UNIONS) {
				const E = expr(U, ['+', '-']);
				const cyclic: { args: Array<unknown>; op: string } = { args: [], op: '-' };
				cyclic.args.push(cyclic);
				assert.throws(() => s.is(E, cyclic), RangeError, undefined, name);
			}
		});
	});
});
