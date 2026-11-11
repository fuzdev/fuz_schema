import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

describe('array, union, variant', () => {
	test('array prefixes the index', () => {
		assert.deepEqual(s.parse_or_throw(s.array(s.number), [1, 2]), [1, 2]);
		assert.deepEqual(
			issues_of(s.array(s.strip_object({ a: s.number })), [{ a: 1 }, { a: 'x' }])[0]!.path,
			[1, 'a']
		);
		assert(!s.is(s.array(s.number), {}));
	});

	test('union takes the first match and reports one issue', () => {
		const U = s.union([s.string, s.number]);
		assert.strictEqual(s.parse_or_throw(U, 1), 1);
		assert.deepEqual(issues_of(U, true), [
			{
				kind: 'union',
				expected: 'string | number',
				received: 'boolean',
				path: [],
				message: undefined
			}
		]);
	});

	test('union names its options as received names values, through a nested union or a pipe', () => {
		const expected_of = (schema: s.AnySchema, value: unknown = Symbol('none')): string => {
			const issues = issues_of(schema, value);
			assert.strictEqual(issues.length, 1);
			assert.strictEqual(issues[0]!.kind, 'union');
			return issues[0]!.expected;
		};
		const Self: s.AnySchema = s.lazy(() => s.union([s.string, s.array(Self)]));
		const cases: Array<[schema: s.AnySchema, expected: string]> = [
			[s.union([]), ''],
			[s.union([s.string]), 'string'],
			// a nested union adds its options in its place, at any depth
			[s.union([s.string, s.union([s.number, s.boolean])]), 'string | number | boolean'],
			[s.union([s.union([s.number, s.boolean]), s.string]), 'number | boolean | string'],
			[
				s.union([s.bigint, s.union([s.union([s.union([s.number]), s.array(s.string)]), s.string])]),
				'bigint | number | array | string'
			],
			[s.union([s.string, s.union([])]), 'string'],
			// each once, where it first appears
			[s.union([s.string, s.number, s.string]), 'string | number'],
			[s.union([s.string, s.union([s.number, s.string])]), 'string | number'],
			[s.union([s.object({ a: s.string }), s.object({ b: s.string })]), 'object'],
			// a pipe is its first schema, a union there included
			[s.union([s.number, s.pipe(s.string, s.min_length(1))]), 'number | string'],
			[
				s.union([
					s.number,
					s.pipe(
						s.pipe(
							s.union([s.string, s.boolean]),
							s.check(() => true)
						),
						s.check(() => true)
					)
				]),
				'number | string | boolean'
			],
			[s.union([s.pipe(s.string, s.min_length(1)), s.string]), 'string'],
			// a wrapper is what its schema adds, and a `nullable` then `null`
			[s.union([s.nullable(s.string), s.number]), 'string | null | number'],
			[
				s.union([s.number, s.nullable(s.union([s.string, s.boolean]))]),
				'number | string | boolean | null'
			],
			[s.union([s.nullable(s.nullable(s.string)), s.number]), 'string | null | number'],
			[s.union([s.nullable(s.string), s.nullable(s.number)]), 'string | null | number'],
			[s.union([s.number, s.optional(s.string)]), 'number | string'],
			[s.union([s.number, s.with_default(s.string, 'd')]), 'number | string'],
			[s.union([s.number, s.with_default_fn(s.string, () => 'd')]), 'number | string'],
			[s.union([s.optional(s.nullable(s.string)), s.number]), 'string | null | number'],
			[s.union([s.nullable(s.optional(s.number))]), 'number | null'],
			// a literal or a one_of is each value, as standalone they write it, all of them
			[s.union([s.literal('a'), s.literal(1)]), '"a" | 1'],
			[s.union([s.literal('a"b'), s.literal('x | y'), s.literal('')]), '"a\\"b" | "x | y" | ""'],
			[
				s.union([s.literal(true), s.literal(null), s.literal(undefined), s.literal(10n)]),
				'true | null | undefined | 10'
			],
			[s.union([s.one_of(['a', 'b', 'c']), s.number]), '"a" | "b" | "c" | number'],
			[
				s.union([s.one_of(Array.from({ length: 30 }, (_, i) => i))]),
				Array.from({ length: 30 }, (_, i) => i).join(' | ')
			],
			// each part by its text: a nullable's `null` and a literal's are one, and
			// `0` and `-0`, and two `NaN`s, are each one
			[s.union([s.nullable(s.string), s.literal(null)]), 'string | null'],
			[s.union([s.literal(null), s.nullable(s.string)]), 'null | string'],
			[s.union([s.one_of(['a', 'b']), s.literal('a'), s.one_of(['b', 'c'])]), '"a" | "b" | "c"'],
			[s.union([s.literal(0), s.literal(-0), s.one_of([NaN, NaN])]), '0 | NaN'],
			// the string `"null"` is quoted, and not the `null` of a `nullable`
			[s.union([s.literal('null'), s.nullable(s.string)]), '"null" | string | null'],
			// an empty union or one_of adds nothing, so a union of only those expects ''
			[s.union([s.one_of([])]), ''],
			[s.union([s.one_of([]), s.union([])]), ''],
			[s.union([s.one_of([]), s.string]), 'string'],
			// every object schema is `object`, an array is `array`
			[
				s.union([
					s.object({ a: s.string }),
					s.loose_object({ b: s.string }),
					s.strip_object({ c: s.string }),
					s.object_with_rest({}, s.string),
					s.record(s.number),
					s.variant('k', [s.object({ k: s.literal('a') })])
				]),
				'object'
			],
			[s.union([s.number, s.variant('k', [s.object({ k: s.literal('a') })])]), 'number | object'],
			[s.union([s.array(s.string), s.record(s.string)]), 'array | object'],
			[s.union([s.number, s.array(s.union([s.string]))]), 'number | array'],
			// an entry named `schema` is not a wrapper's
			[s.union([s.object({ schema: s.string }), s.number]), 'object | number'],
			[s.union([s.strip_object({ schema: s.string }), s.number]), 'object | number'],
			[s.union([s.loose_object({ schema: s.string }), s.number]), 'object | number'],
			[s.union([s.message(s.object({ schema: s.string }), 'x')]), 'object'],
			// a `lazy` is its kind
			[s.union([s.number, s.lazy(() => s.union([s.string]))]), 'number | lazy'],
			[s.union([s.nullable(s.lazy(() => s.string))]), 'lazy | null'],
			// a recursive union is not followed back through its `lazy`
			[s.union([s.number, Self]), 'number | lazy'],
			// `message`, `flavor`, and `brand` keep the kind and def of the schema
			[
				s.union([s.number, s.message(s.union([s.string, s.boolean]), 'm')]),
				'number | string | boolean'
			],
			[s.union([s.flavor(s.union([s.string]), 'F'), s.brand(s.number, 'B')]), 'string | number']
		];
		for (const [schema, expected] of cases) {
			assert.strictEqual(expected_of(schema), expected, expected);
			// and the same on a second failure, the text being kept
			assert.strictEqual(expected_of(schema), expected, expected);
		}
		assert.strictEqual(
			s.format_issue(
				issues_of(s.object({ a: s.union([s.string, s.union([s.number])]) }), { a: {} })[0]!
			),
			'a: expected string | number, received object'
		);
		// both closures, the one that passes the object and the key on included
		const Keyed = s.object({ a: s.union([s.unknown, s.union([s.string, s.number])]) });
		assert.deepEqual(issues_of(Keyed, {})[0]!.expected, 'unknown | string | number');
	});

	test('union restores issues recorded before it', () => {
		const O = s.strip_object({ a: s.string, b: s.union([s.string, s.number]) });
		assert.deepEqual(
			issues_of(O, { a: 1, b: 2 }).map((i) => i.path),
			[['a']]
		);
	});

	test('variant dispatches on the discriminator', () => {
		const Shape = s.variant('kind', [
			s.object({ kind: s.literal('circle'), radius: s.number }),
			s.object({ kind: s.literal('square'), size: s.number })
		]);
		assert.deepEqual(s.parse_or_throw(Shape, { kind: 'square', size: 2 }), {
			kind: 'square',
			size: 2
		});
		assert.deepEqual(issues_of(Shape, { kind: 'circle', radius: 'x' })[0]!.path, ['radius']);
		assert.deepEqual(issues_of(Shape, { kind: 'line' }), [
			{
				kind: 'variant',
				expected: '"circle" | "square"',
				received: 'string',
				path: ['kind'],
				message: undefined
			}
		]);
		assert(!s.is(Shape, null));
	});

	describe('a recursive union', () => {
		// a chain of nodes each with one child, of the last option, counting the
		// `check` every option reaches in a node before its `op`, or after it
		const count_runs = (
			make: (counted: s.AnySchema, Node: () => s.AnySchema) => s.AnySchema,
			depth: number
		): { parse: number; is: number } => {
			let runs = 0;
			const counted = s.pipe(
				s.number,
				s.check(() => {
					runs++;
					return true;
				})
			);
			const Node: s.AnySchema = s.lazy(() => make(counted, () => Node));
			let input: unknown = { op: 'b', n: 0, args: [] };
			for (let i = 0; i < depth; i++) input = { op: 'b', n: 0, args: [input] };
			assert(s.parse(Node, input).ok);
			const parse = runs;
			runs = 0;
			assert(s.is(Node, input));
			return { parse, is: runs };
		};
		const depth = 10;

		test('walks the children again for each option they fail in, exponential in depth', () => {
			const runs = count_runs(
				(n, Node) =>
					s.union(
						['a', 'b'].map((op) => s.object({ args: s.array(Node()), n, op: s.literal(op) }))
					),
				depth
			);
			const expected = 2 ** (depth + 2) - 2;
			assert.deepEqual(runs, { parse: expected, is: expected });
		});

		test('is linear with the entry that tells the options apart first', () => {
			const runs = count_runs(
				(n, Node) =>
					s.union(
						['a', 'b'].map((op) => s.object({ op: s.literal(op), n, args: s.array(Node()) }))
					),
				depth
			);
			assert.deepEqual(runs, { parse: depth + 1, is: depth + 1 });
		});

		test('is linear as a variant, whatever the order of the entries', () => {
			const runs = count_runs(
				(n, Node) =>
					s.variant(
						'op',
						['a', 'b'].map((op) => s.object({ args: s.array(Node()), n, op: s.literal(op) }))
					),
				depth
			);
			assert.deepEqual(runs, { parse: depth + 1, is: depth + 1 });
		});

		test('is linear as a memo_union, whatever the order of the entries', () => {
			const make = (n: s.AnySchema, Node: () => s.AnySchema): s.AnySchema =>
				s.memo_union(
					['a', 'b'].map((op) => s.object({ args: s.array(Node()), n, op: s.literal(op) }))
				);
			// each option reads `n` of each node once, and the second is handed
			// the children the first walked from the memo
			assert.deepEqual(count_runs(make, depth), { parse: 2 * (depth + 1), is: 2 * (depth + 1) });
			assert.deepEqual(count_runs(make, 2 * depth), {
				parse: 2 * (2 * depth + 1),
				is: 2 * (2 * depth + 1)
			});
		});
	});
});

describe('probe mode', () => {
	test('is stops at the first failure in every container', () => {
		let calls = 0;
		const Counted = s.pipe(
			s.unknown,
			s.check(() => {
				calls++;
				return false;
			})
		);
		for (const [schema, value] of [
			[s.strip_object({ a: Counted, b: Counted }), { a: 1, b: 2 }],
			[s.object({ a: Counted, b: Counted }), { a: 1, b: 2 }],
			[s.array(Counted), [1, 2, 3]],
			[s.record(Counted), { a: 1, b: 2 }]
		] as const) {
			calls = 0;
			assert(!s.is(schema, value));
			assert.strictEqual(calls, 1, schema.kind);
			// and without probe mode every child runs
			calls = 0;
			assert(!s.parse(schema, value).ok);
			assert(calls > 1, schema.kind);
		}
	});

	test('is matches parse on unknown keys, variants, and messages', () => {
		const Strict = s.object({ a: s.string });
		assert(s.is(Strict, { a: 'x' }));
		assert(!s.is(Strict, { a: 'x', b: 1 }));
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		assert(!s.is(V, { kind: 'z' }));
		assert(!s.is(s.message(s.strip_object({ a: s.message(s.string, 'x') }), 'y'), { a: 1 }));
	});

	test('union probes options without leaking failures', () => {
		const Item = s.union([
			s.object({ a: s.array(s.string) }),
			s.object({ b: s.union([s.number, s.literal('x')]) })
		]);
		assert.deepEqual(s.parse_or_throw(Item, { b: 'x' }), { b: 'x' });
		const List = s.strip_object({ first: s.string, items: s.array(Item) });
		assert.deepEqual(issues_of(List, { first: 1, items: [{ b: 1 }, { a: [1] }, { c: 1 }] }), [
			{
				kind: 'string',
				expected: 'string',
				received: 'number',
				path: ['first'],
				message: undefined
			},
			{
				kind: 'union',
				expected: 'object',
				received: 'object',
				path: ['items', 1],
				message: undefined
			},
			{
				kind: 'union',
				expected: 'object',
				received: 'object',
				path: ['items', 2],
				message: undefined
			}
		]);
	});

	test('a failed union leaves probe mode off for its siblings', () => {
		const O = s.strip_object({
			a: s.union([s.string, s.number]),
			b: s.strip_object({ c: s.string, d: s.string })
		});
		assert.deepEqual(
			issues_of(O, { a: true, b: { c: 1, d: 2 } }).map((i) => i.path),
			[['a'], ['b', 'c'], ['b', 'd']]
		);
	});

	test('is stops looking at keys once it has failed', () => {
		let scans = 0;
		const create_input = (): Record<string, unknown> =>
			new Proxy(
				{ a: 1, z: 2 },
				{
					ownKeys: (target) => {
						scans++;
						return Reflect.ownKeys(target);
					}
				}
			);
		// a failed entry, so the keys are never enumerated
		assert(!s.is(s.object({ a: s.string }), create_input()));
		assert(!s.is(s.strip_object({ a: s.string }), create_input()));
		assert.strictEqual(scans, 0);
		// and without probe mode `object` goes on to report the unknown key
		assert.deepEqual(
			issues_of(s.object({ a: s.string }), create_input()).map((i) => i.path),
			[['a'], ['z']]
		);
		assert.strictEqual(scans, 1);
		// the first unknown key is the last one looked at
		let reads = 0;
		const input = {
			a: 'x',
			y: 1,
			get z() {
				reads++;
				return 2;
			}
		};
		assert(!s.is(s.object({ a: s.string }), input));
		assert.strictEqual(reads, 0);
		assert.strictEqual(issues_of(s.object({ a: s.string }), input).length, 2);
		assert.strictEqual(reads, 1);
	});

	test('a failure about a key reads its value only to build an issue', () => {
		let reads = 0;
		const unknown = {
			a: 'x',
			get z() {
				reads++;
				return 1;
			}
		};
		assert(!s.is(s.object({ a: s.string }), unknown));
		assert(s.is(s.union([s.object({ a: s.string }), s.loose_object({ a: s.string })]), unknown));
		assert.strictEqual(reads, 0);
		assert.deepEqual(issues_of(s.object({ a: s.string }), unknown), [
			{
				kind: 'unknown_key',
				expected: 'no unknown keys',
				received: 'number',
				path: ['z'],
				message: undefined
			}
		]);
		assert.strictEqual(reads, 1);
		// a `variant` reads its discriminator to find the option, and again for the issue
		reads = 0;
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		const untagged = {
			get kind() {
				reads++;
				return 'zz';
			}
		};
		assert(!s.is(V, untagged));
		assert.strictEqual(reads, 1);
		assert.strictEqual(issues_of(V, untagged)[0]!.received, 'string');
		assert.strictEqual(reads, 3);
	});
});
