import { runInNewContext } from 'node:vm';
import { inspect } from 'node:util';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { to_standard_schema } from '#lib/standard_schema.ts';
import { meta, get_meta } from '#lib/meta.ts';

const issues_of = (schema: s.AnySchema, value: unknown): Array<s.SchemaIssue> => {
	const result = s.parse(schema, value);
	assert(!result.ok);
	return result.issues;
};

describe('primitives', () => {
	test('accept their type and reject others', () => {
		assert.strictEqual(s.parse_or_throw(s.string, 'a'), 'a');
		assert.strictEqual(s.parse_or_throw(s.number, 1), 1);
		assert.strictEqual(s.parse_or_throw(s.boolean, false), false);
		assert.strictEqual(s.parse_or_throw(s.bigint, 1n), 1n);
		assert(!s.is(s.string, 1));
		assert(!s.is(s.number, '1'));
		assert(!s.is(s.boolean, 0));
		assert(!s.is(s.bigint, 1));
	});

	test('number rejects NaN and the infinities', () => {
		for (const [value, received] of [
			[NaN, 'NaN'],
			[Infinity, 'Infinity'],
			[-Infinity, '-Infinity'],
			[JSON.parse('1e999'), 'Infinity'],
			[JSON.parse('-1e999'), '-Infinity'],
			[JSON.parse('1' + '0'.repeat(400)), 'Infinity'],
			[Number.MAX_VALUE * 2, 'Infinity']
		] as const) {
			assert(!s.is(s.number, value), inspect(value));
			assert.deepEqual(
				issues_of(s.number, value),
				[{ kind: 'number', expected: 'number', received, path: [], message: undefined }],
				inspect(value)
			);
			assert.strictEqual(
				s.format_issue(issues_of(s.number, value)[0]!),
				`expected number, received ${received}`
			);
		}
		for (const value of [
			0,
			-0,
			1.5,
			Number.MAX_VALUE,
			-Number.MAX_VALUE,
			Number.MIN_VALUE,
			Number.MAX_SAFE_INTEGER + 2,
			2 ** 1023,
			JSON.parse('123456789012345678901234567890'),
			JSON.parse('1e308')
		]) {
			assert(s.is(s.number, value), inspect(value));
			assert(Object.is(s.parse_or_throw(s.number, value), value), inspect(value));
		}
		for (const value of ['1', 'Infinity', null, undefined, 1n, true, Object(1), [1], {}]) {
			assert(!s.is(s.number, value), inspect(value));
			assert.notStrictEqual(issues_of(s.number, value)[0]!.received, 'number', inspect(value));
		}
		// a value with a `valueOf` is not asked for it
		const coerced = {
			valueOf: () => {
				throw Error('read');
			}
		};
		assert(!s.is(s.number, coerced));
	});

	test('number refuses an infinity wherever it is', () => {
		const O = s.object({ a: s.number, b: s.optional(s.array(s.number)) });
		assert.deepEqual(issues_of(O, JSON.parse('{"a":1e999,"b":[0,-1e999]}')), [
			{ kind: 'number', expected: 'number', received: 'Infinity', path: ['a'], message: undefined },
			{
				kind: 'number',
				expected: 'number',
				received: '-Infinity',
				path: ['b', 1],
				message: undefined
			}
		]);
		assert(!s.is(s.record(s.number), { a: Infinity }));
		assert(!s.is(s.union([s.string, s.number]), Infinity));
		assert(!s.is(s.nullable(s.number), -Infinity));
		assert(!s.is(s.with_default(s.number, 0), Infinity));
		// a pipe stops at it, so no action sees one
		let calls = 0;
		const counted = s.check<number>(() => {
			calls++;
			return true;
		});
		assert.deepEqual(
			issues_of(s.pipe(s.number, counted), Infinity).map((i) => i.kind),
			['number']
		);
		assert.strictEqual(calls, 0);
	});

	test('the number tests after number, and alone', () => {
		// an integer past the safe ones is an integer
		for (const value of [2 ** 53, 2 ** 53 + 2, -(2 ** 60), Number.MAX_VALUE, 1e21]) {
			assert(s.is(s.pipe(s.number, s.integer), value), inspect(value));
			assert(!s.is(s.pipe(s.number, s.safe_integer), value), inspect(value));
		}
		// after `number` an infinity fails as a `number`, and the action has nothing left to fail
		for (const action of [s.integer, s.safe_integer]) {
			for (const value of [Infinity, -Infinity, NaN]) {
				assert.deepEqual(
					issues_of(s.pipe(s.number, action), value).map((i) => i.kind),
					['number'],
					action.kind
				);
				// alone, or after a schema that takes any value, each fails it itself:
				// the types refuse an action after `unknown`, so it is cast to a schema
				assert.deepEqual(
					issues_of(action, value).map((i) => i.kind),
					[action.kind]
				);
				assert.deepEqual(
					issues_of(s.pipe(s.unknown, action as s.Schema<number, unknown>), value).map(
						(i) => i.kind
					),
					[action.kind]
				);
			}
		}
	});

	test('an infinity is still a literal, a one_of value, and a bound', () => {
		assert(s.is(s.literal(Infinity), Infinity));
		assert(!s.is(s.literal(Infinity), -Infinity));
		assert(!s.is(s.literal(Infinity), Number.MAX_VALUE));
		assert(s.is(s.one_of([Infinity, -Infinity]), -Infinity));
		assert(s.is(s.union([s.number, s.literal(Infinity)]), Infinity));
		assert(!s.is(s.union([s.number, s.literal(Infinity)]), -Infinity));
		// a bound is not a value that is validated
		const Any = s.pipe(s.number, s.min_value(-Infinity), s.max_value(Infinity));
		assert(s.is(Any, Number.MAX_VALUE));
		assert(s.is(Any, -Number.MAX_VALUE));
		assert(!s.is(Any, Infinity));
		assert(!s.is(s.pipe(s.number, s.min_value(Infinity)), Number.MAX_VALUE));
		assert.strictEqual(
			issues_of(s.pipe(s.number, s.min_value(Infinity)), 1)[0]!.expected,
			'>= Infinity'
		);
	});

	test('literal and one_of', () => {
		assert(s.is(s.literal('a'), 'a'));
		assert(!s.is(s.literal('a'), 'b'));
		assert(s.is(s.literal(null), null));
		assert(s.is(s.one_of(['a', 'b']), 'b'));
		assert.strictEqual(issues_of(s.literal(1n), 2n)[0]!.expected, '1');
		assert.strictEqual(issues_of(s.literal('a'), 'b')[0]!.expected, '"a"');
		assert.strictEqual(issues_of(s.one_of([1, 'a', null]), 2)[0]!.expected, '1 | "a" | null');
		assert.deepEqual(issues_of(s.one_of(['a', 'b']), 'c'), [
			{ kind: 'one_of', expected: '"a" | "b"', received: 'string', path: [], message: undefined }
		]);
	});

	test('a NaN literal matches NaN and nothing else', () => {
		const Nan = s.literal(NaN);
		assert.deepEqual(Object.keys(Nan), ['kind', 'def', 'run']);
		assert(s.is(Nan, NaN));
		assert(s.is(Nan, 0 / 0));
		assert.deepEqual(s.parse(Nan, NaN), { ok: true, value: NaN });
		for (const value of [0, -0, 1, Infinity, 'NaN', null, undefined, {}, [NaN], Object(NaN)]) {
			assert(!s.is(Nan, value), inspect(value));
		}
		assert.deepEqual(issues_of(Nan, 1), [
			{ kind: 'literal', expected: 'NaN', received: 'number', path: [], message: undefined }
		]);
		assert.strictEqual(issues_of(Nan, 'NaN')[0]!.received, 'string');
		assert.throws(() => s.parse_or_throw(Nan, 1), s.SchemaError);
		// the other literals still refuse it
		for (const value of [0, 1, 'NaN', null, undefined, 1n, true]) {
			assert(!s.is(s.literal(value), NaN), inspect(value));
		}
		assert(s.is(s.one_of([1, NaN]), NaN));
	});

	test('a literal of either zero matches both, and the output is the input', () => {
		for (const schema of [s.literal(0), s.literal(-0), s.one_of([0, 1]), s.one_of([-0, 1])]) {
			for (const value of [0, -0]) {
				const result = s.parse(schema, value);
				assert(result.ok);
				assert(Object.is(result.value, value));
			}
		}
		// the text is the literal's own
		assert.strictEqual(issues_of(s.literal(-0), 1)[0]!.expected, '0');
	});

	test('a one_of matches what includes finds, wherever the value is in the list', () => {
		const inputs = [0, -0, 1, NaN, '', 'a', 'NaN', null, undefined, false, true, 1n, {}, [], [NaN]];
		const lists: Array<Array<s.SchemaLiteral>> = [
			[],
			[NaN],
			[NaN, 1],
			[1, NaN],
			[0],
			[-0],
			[-0, 'a', 1],
			['a', 1, 0],
			['a'],
			[null],
			[null, 'a'],
			[undefined],
			[undefined, 'a'],
			['a', undefined],
			[false, 1n, '', null],
			['a', 'b', 'c', 'd', 'e'],
			Array.from({ length: 20 }, (_, i) => i)
		];
		for (const values of lists) {
			const schema = s.one_of(values);
			for (const input of inputs) {
				const result = s.parse(schema, input);
				assert.strictEqual(result.ok, values.includes(input as any), inspect([values, input]));
				// the output is the input, so `-0` stays `-0`
				if (result.ok) assert(Object.is(result.value, input), inspect([values, input]));
			}
		}
		// an empty list matches nothing, `undefined` included, inside an object and out
		assert(!s.is(s.one_of([]), undefined));
		assert(!s.is(s.array(s.one_of([])), new Array(1)));
		assert(!s.is(s.object({ a: s.one_of([]) }), { a: undefined }));
		assert(!s.is(s.object({ a: s.one_of([]) }), {}));
	});

	test('variant finds an option by a NaN literal, and by either zero', () => {
		const V = s.variant('t', [
			s.object({ t: s.literal(NaN), a: s.string }),
			s.object({ t: s.literal(0), b: s.string })
		]);
		// the input: a `NaN` that passes is no change to the container holding it
		const nan = { t: NaN, a: 'x' };
		assert.strictEqual(s.parse_or_throw(V, nan), nan);
		const negative_zero: unknown = { t: -0, b: 'x' };
		assert.strictEqual(s.parse_or_throw(V, negative_zero), negative_zero);
		assert.deepEqual(issues_of(V, { t: NaN, a: 1 }), [
			{ kind: 'string', expected: 'string', received: 'number', path: ['a'], message: undefined }
		]);
		assert.deepEqual(issues_of(V, { t: 1 }), [
			{ kind: 'variant', expected: 'NaN | 0', received: 'number', path: ['t'], message: undefined }
		]);
	});
});

describe('wrappers', () => {
	test('optional, nullable, with_default', () => {
		assert.strictEqual(s.parse_or_throw(s.optional(s.string), undefined), undefined);
		assert.strictEqual(s.parse_or_throw(s.nullable(s.string), null), null);
		assert(!s.is(s.optional(s.string), null));
		assert.strictEqual(s.parse_or_throw(s.with_default(s.string, 'x'), undefined), 'x');
		assert.strictEqual(s.parse_or_throw(s.with_default(s.string, 'x'), 'y'), 'y');
	});

	describe('with_default_fn', () => {
		// a `make` that counts its calls and the arguments it was called with
		const counting = <T>(value: () => T) => {
			const calls: Array<number> = [];
			return {
				calls,
				make: (...args: Array<unknown>): T => {
					calls.push(args.length);
					return value();
				}
			};
		};

		test('fills undefined with what make returns, once a fill, with no arguments', () => {
			const { calls, make } = counting(() => ['m']);
			const D = s.with_default_fn(s.array(s.string), make);
			assert.deepEqual(s.parse_or_throw(D, undefined), ['m']);
			assert.deepEqual(calls, [0]);
			const input = ['x'];
			assert.strictEqual(s.parse_or_throw(D, input), input);
			assert(!s.is(D, null));
			assert(!s.is(D, [1]));
			assert.deepEqual(calls, [0], 'never called for a value that is there');
		});

		test('gives a new value on every parse, where with_default gives the same', () => {
			const fresh = s.object({ a: s.with_default_fn(s.array(s.string), () => []) });
			const first = s.parse_or_throw(fresh, {}).a;
			first.push('x');
			assert.deepEqual(s.parse_or_throw(fresh, {}).a, []);
			assert.notStrictEqual(s.parse_or_throw(fresh, {}).a, s.parse_or_throw(fresh, {}).a);
			const shared = s.object({ a: s.with_default(s.array(s.string), []) });
			assert.strictEqual(s.parse_or_throw(shared, {}).a, s.parse_or_throw(shared, {}).a);
		});

		test('what make returns is not validated', () => {
			const D = s.with_default_fn(s.string, (() => 5) as unknown as () => string);
			assert.strictEqual<unknown>(s.parse_or_throw(D, undefined), 5);
			// nor run through the steps of a pipe inside it
			const P = s.with_default_fn(
				s.pipe(
					s.string,
					s.transform((v: string) => v + '!')
				),
				() => 'd'
			);
			assert.strictEqual(s.parse_or_throw(P, undefined), 'd');
			assert.strictEqual(s.parse_or_throw(P, 'x'), 'x!');
		});

		test('as an entry, a missing key and an undefined one are filled in', () => {
			const { calls, make } = counting(() => 'm');
			const O = s.object({ a: s.with_default_fn(s.string, make), b: s.string });
			assert.deepEqual(s.parse_or_throw(O, { b: 'b' }), { a: 'm', b: 'b' });
			assert.deepEqual(s.parse_or_throw(O, { a: undefined, b: 'b' }), { a: 'm', b: 'b' });
			const input = { a: 'x', b: 'b' };
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert(s.is(O, { b: 'b' }));
			assert.deepEqual(calls, [0, 0, 0]);
			assert.deepEqual(issues_of(O, { a: 1, b: 'b' })[0]!.path, ['a']);
		});

		test('a make that returns undefined leaves a missing key out, as a default of undefined does', () => {
			const O = s.object({ a: s.with_default_fn(s.optional(s.string), () => undefined) });
			const V = s.object({ a: s.with_default(s.optional(s.string), undefined) });
			for (const schema of [O, V]) {
				const input = {};
				assert.strictEqual(s.parse_or_throw(schema, input), input);
				assert.deepEqual(Object.keys(s.parse_or_throw(schema, { a: undefined })), ['a']);
			}
		});

		test('under another schema, as a with_default is', () => {
			const make = (): string => 'm';
			for (const a of [
				s.nullable(s.with_default_fn(s.string, make)),
				s.lazy(() => s.with_default_fn(s.string, make)),
				s.message(s.with_default_fn(s.string, make), 'text'),
				s.union([s.number, s.with_default_fn(s.string, make)])
			]) {
				assert.deepEqual(s.parse_or_throw(s.object({ a }), {}), { a: 'm' }, a.kind);
			}
			// an `optional` outside it answers first
			const { calls, make: counted } = counting(() => 'm');
			const input = {};
			assert.strictEqual(
				s.parse_or_throw(s.object({ a: s.optional(s.with_default_fn(s.string, counted)) }), input),
				input
			);
			assert.deepEqual(calls, []);
			// the steps of a pipe it starts run on what it made
			assert.deepEqual(
				s.parse_or_throw(
					s.object({
						a: s.pipe(
							s.with_default_fn(s.string, make),
							s.transform((v: string) => v + '!')
						)
					}),
					{}
				),
				{ a: 'm!' }
			);
		});

		test('in a union, the options before it are tried on the undefined, as before a with_default', () => {
			const { calls, make } = counting(() => 'm');
			const U = s.object({ a: s.union([s.unknown, s.with_default_fn(s.string, make)]) });
			const D = s.object({ a: s.union([s.unknown, s.with_default(s.string, 'm')]) });
			for (const schema of [U, D]) {
				const input = {};
				assert.strictEqual(s.parse_or_throw(schema, input), input);
			}
			// called, and what it returned dropped
			assert.deepEqual(calls, [0]);
			const T = s.object({
				a: s.union([
					s.pipe(
						s.unknown,
						s.transform((v: unknown) => v ?? 'U')
					),
					s.with_default_fn(s.string, () => 'm')
				])
			});
			assert.deepEqual(s.parse_or_throw(T, {}), { a: 'U' });
		});
	});

	test('lazy resolves once and recurses', () => {
		interface Tree {
			children: Array<Tree>;
		}
		let calls = 0;
		const Tree: s.Schema<Tree> = s.object({
			children: s.array(
				s.lazy(() => {
					calls++;
					return Tree;
				})
			)
		});
		assert(s.is(Tree, { children: [{ children: [] }, { children: [{ children: [] }] }] }));
		assert.strictEqual(calls, 1);
		assert.deepEqual(issues_of(Tree, { children: [{ children: [1] }] })[0]!.path, [
			'children',
			0,
			'children',
			0
		]);
	});
});

describe('object', () => {
	const User = s.strip_object({
		name: s.string,
		age: s.optional(s.number),
		role: s.with_default(s.string, 'user')
	});

	test('builds a new output and drops unknown keys', () => {
		const input: unknown = { name: 'a', extra: 1 };
		const output = s.parse_or_throw(User, input);
		assert.notStrictEqual(output, input);
		assert.deepEqual(output, { name: 'a', role: 'user' });
	});

	test('keeps an explicit undefined and omits a missing optional', () => {
		assert.deepEqual(Object.keys(s.parse_or_throw(User, { name: 'a', age: undefined })), [
			'name',
			'age',
			'role'
		]);
		assert.deepEqual(Object.keys(s.parse_or_throw(User, { name: 'a' })), ['name', 'role']);
	});

	test('collects every issue with its path', () => {
		assert.deepEqual(issues_of(User, { age: 'x' }), [
			{
				kind: 'string',
				expected: 'string',
				received: 'undefined',
				path: ['name'],
				message: undefined
			},
			{ kind: 'number', expected: 'number', received: 'string', path: ['age'], message: undefined }
		]);
		assert(!s.is(User, null));
		assert(!s.is(User, 'a'));
	});

	test('object fails on unknown keys', () => {
		const Strict = s.object({ a: s.string });
		assert.deepEqual(s.parse_or_throw(Strict, { a: 'x' }), { a: 'x' });
		assert.deepEqual(issues_of(Strict, { a: 'x', b: 1, toString: 2 }), [
			{
				kind: 'unknown_key',
				expected: 'no unknown keys',
				received: 'number',
				path: ['b'],
				message: undefined
			},
			{
				kind: 'unknown_key',
				expected: 'no unknown keys',
				received: 'number',
				path: ['toString'],
				message: undefined
			}
		]);
	});

	test('loose_object keeps unknown keys and returns the input when nothing changed', () => {
		const Loose = s.loose_object({ a: s.string, b: s.with_default(s.number, 1) });
		const same = { a: 'x', b: 2, extra: true };
		assert.strictEqual(s.parse_or_throw(Loose, same), same);
		const input = { a: 'x', extra: true };
		const output = s.parse_or_throw(Loose, input);
		assert.deepEqual(output, { a: 'x', b: 1, extra: true });
		assert.deepEqual(Object.keys(output), ['a', 'b', 'extra']);
		assert.deepEqual(input, { a: 'x', extra: true });
		assert.deepEqual(issues_of(Loose, { a: 1, extra: true }), [
			{ kind: 'string', expected: 'string', received: 'number', path: ['a'], message: undefined }
		]);
		assert(!s.is(Loose, null));
		// a `__proto__` key in the input is left out of the copy
		const proto_output = s.parse_or_throw(Loose, JSON.parse('{"a": "x", "__proto__": {"p": 1}}'));
		assert.strictEqual(Object.getPrototypeOf(proto_output), Object.prototype);
		assert(!Object.hasOwn(proto_output, '__proto__'));
	});

	test('the three object schemas differ only on unknown keys', () => {
		const entries = { a: s.string };
		const input = { a: 'x', extra: 1 };
		assert(!s.is(s.object(entries), input));
		assert.deepEqual(s.parse_or_throw(s.loose_object(entries), input), { a: 'x', extra: 1 });
		assert.deepEqual(s.parse_or_throw(s.strip_object(entries), input), { a: 'x' });
		for (const schema of [s.object(entries), s.loose_object(entries), s.strip_object(entries)]) {
			assert.deepEqual(s.parse_or_throw(schema, { a: 'x' }), { a: 'x' });
			assert(!s.is(schema, { a: 1 }));
			assert(!s.is(schema, 'x'));
		}
	});

	test('record validates values and ignores __proto__', () => {
		const Counts = s.record(s.number);
		assert.deepEqual(s.parse_or_throw(Counts, { a: 1, b: 2 }), { a: 1, b: 2 });
		assert.deepEqual(issues_of(Counts, { a: 1, b: 'x' })[0]!.path, ['b']);
		const output = s.parse_or_throw(Counts, JSON.parse('{"__proto__": 1, "a": 2}'));
		assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
		assert.deepEqual(Object.keys(output), ['a']);
	});

	test('record leaves a __proto__ key that failed out of a copy begun after it', () => {
		const Next = s.record(
			s.pipe(
				s.number,
				s.transform((x) => x + 1)
			)
		);
		// a frozen prototype refuses the write of `a`, and a setter takes it
		const written: Array<unknown> = [];
		const protos = [
			Object.freeze({ a: 0 }),
			{
				set a(value: unknown) {
					written.push(value);
				}
			}
		];
		for (const proto of protos) {
			const input = { ['__proto__']: proto, a: 1 };
			assert(Object.hasOwn(input, '__proto__'));
			assert.deepEqual(
				issues_of(Next, input).map((issue) => issue.path),
				[['__proto__']]
			);
		}
		assert.deepEqual(written, []);
	});
});

describe('arrays are not objects', () => {
	const entries = { a: s.optional(s.string) };
	const schemas = [
		s.object(entries),
		s.strip_object(entries),
		s.loose_object(entries),
		s.object_with_rest(entries, s.unknown),
		s.record(s.unknown),
		s.variant('kind', [s.object({ kind: s.literal('a') })])
	];

	test('every object schema rejects an array, as it does any non-object', () => {
		for (const schema of schemas) {
			for (const input of [[], [1, 2], ['a'], [{ kind: 'a' }], new Array(3), Array.from('abc')]) {
				assert(!s.is(schema, input), schema.kind);
				// one issue for the array, with nothing about its items
				assert.deepEqual(issues_of(schema, input), [
					{ ...issues_of(schema, 1)[0]!, received: 'array' }
				]);
			}
			const issue = issues_of(schema, [])[0]!;
			assert.strictEqual(issue.kind, schema.kind);
			assert.strictEqual(issue.expected, 'object');
			assert.strictEqual(s.format_issue(issue), 'expected object, received array');
		}
		// an array with keys of its own that match the entries
		const named = Object.assign(['x'], { a: 'x', kind: 'a' });
		for (const schema of schemas) assert(!s.is(schema, named), schema.kind);
		// and an empty schema, which has no entry to fail on
		for (const factory of [s.object, s.strip_object, s.loose_object]) {
			assert(!s.is(factory({}), []));
			assert(s.is(factory({}), {}));
		}
	});

	test('a long array is one issue, not one per item', () => {
		const long = Array.from({ length: 1000 }, (_, i) => i);
		for (const schema of schemas) assert.strictEqual(issues_of(schema, long).length, 1);
	});

	test('an array is rejected in a union, nested, and as a record value', () => {
		for (const schema of schemas) {
			const U = s.union([s.string, schema]);
			assert(!s.is(U, []));
			assert.deepEqual(
				issues_of(U, [1]).map((i) => i.kind),
				['union']
			);
			// an array schema ahead of it still takes the array
			assert.deepEqual(s.parse_or_throw(s.union([schema, s.array(s.number)]), [1]), [1]);
			assert.deepEqual(
				issues_of(s.object({ outer: s.array(schema) }), { outer: [{}, []] }).map((i) => i.path),
				schema.kind === 'variant'
					? [
							['outer', 0, 'kind'],
							['outer', 1]
						]
					: [['outer', 1]]
			);
			assert.deepEqual(
				issues_of(s.record(schema), { k: [] }).map((i) => [i.kind, i.path]),
				[[schema.kind, ['k']]]
			);
		}
	});

	test('a proxy of an array is an array', () => {
		for (const schema of schemas) {
			assert(!s.is(schema, new Proxy([], {})), schema.kind);
		}
		assert(s.is(s.object(entries), new Proxy({}, {})));
	});

	test('every other object is still accepted', () => {
		class Empty {
			#hidden = 1;
			get hidden(): number {
				return this.#hidden;
			}
		}
		const typed = new Uint8Array(0);
		const objects: Array<object> = [
			{},
			Object.create(null),
			new Empty(),
			new Map([['a', 1]]),
			new Set([1]),
			new Date(0),
			/x/,
			new Error('x'),
			typed,
			// array-like, and not an array
			(function () {
				// eslint-disable-next-line prefer-rest-params
				return arguments;
			})()
		];
		for (const input of objects) {
			for (const schema of schemas.slice(0, 4)) {
				assert.strictEqual(s.parse_or_throw(schema, input), input, schema.kind);
			}
		}
		assert(s.is(s.loose_object(entries), { length: 1, 0: 'x' }));
		assert(s.is(s.record(s.unknown), new Uint8Array(2)));
		// a function never was one
		for (const schema of schemas) {
			assert(!s.is(schema, () => 1));
			assert(!s.is(schema, Empty));
		}
	});

	// each of these tells `Array.isArray` from one cheaper stand-in for it
	test('an array from another realm is an array', () => {
		const foreign: unknown = runInNewContext('[1]');
		assert(!(foreign instanceof Array));
		for (const schema of schemas) assert(!s.is(schema, foreign), schema.kind);
		// and an object from one is an object
		const foreign_object: unknown = runInNewContext('({a: "x"})');
		assert(s.is(s.object(entries), foreign_object));
	});

	test('an array is an array without its prototype or its tag', () => {
		const bare: unknown = Object.setPrototypeOf([], null);
		const retagged = Object.assign([], { [Symbol.toStringTag]: 'Object' });
		class Sub extends Array<unknown> {}
		for (const schema of schemas) {
			assert(!s.is(schema, bare), schema.kind);
			assert(!s.is(schema, retagged), schema.kind);
			assert(!s.is(schema, new Sub()), schema.kind);
		}
	});

	test('an object is an object with an array for a prototype or a tag', () => {
		const inherits: object = Object.create(Array.prototype);
		const tagged = { [Symbol.toStringTag]: 'Array' };
		for (const schema of schemas.slice(0, 4)) {
			assert.strictEqual(s.parse_or_throw(schema, inherits), inherits, schema.kind);
			assert.strictEqual(s.parse_or_throw(schema, tagged), tagged, schema.kind);
		}
	});
});

// a revoked `Proxy` throws on `Array.isArray`, which `fail` names `received` with and the
// containers check first: it is never accepted, only thrown on, see docs/declined.md
describe('a revoked Proxy', () => {
	const revoked = (target: object): object => {
		const { proxy, revoke } = Proxy.revocable(target, {});
		revoke();
		return proxy;
	};
	const targets: Array<[string, object]> = [
		['object', {}],
		['array', []],
		['function', () => {}]
	];
	const primitives: Array<s.AnySchema> = [
		s.string,
		s.number,
		s.literal('a'),
		s.one_of(['a', 1]),
		s.nullable(s.string),
		s.union([s.string, s.number]),
		s.pipe(s.string, s.min_length(1))
	];
	const containers: Array<s.AnySchema> = [
		s.object({ a: s.string }),
		s.array(s.string),
		s.record(s.string)
	];
	const assert_throws = (f: () => unknown, label: string): void => {
		let thrown: unknown;
		try {
			f();
		} catch (error) {
			thrown = error;
		}
		assert(thrown instanceof TypeError, label);
	};

	test('a primitive is false to is, and parse throws a TypeError', () => {
		for (const [name, target] of targets) {
			for (const schema of primitives) {
				const label = `${schema.kind} of a revoked ${name}`;
				assert.strictEqual(s.is(schema, revoked(target)), false, label);
				assert_throws(() => s.parse(schema, revoked(target)), label);
			}
		}
	});

	test('a container throws a TypeError in is and parse', () => {
		for (const [name, target] of targets) {
			for (const schema of containers) {
				const label = `${schema.kind} of a revoked ${name}`;
				assert_throws(() => s.parse(schema, revoked(target)), label);
				// a function is told from an object by `typeof` first, and only `array` checks it
				// with `Array.isArray`
				if (name === 'function' && schema.kind !== 'array') {
					assert.strictEqual(s.is(schema, revoked(target)), false, label);
				} else {
					assert_throws(() => s.is(schema, revoked(target)), label);
				}
			}
		}
	});

	test('unknown accepts it', () => {
		for (const [name, target] of targets) {
			const proxy = revoked(target);
			assert(s.is(s.unknown, proxy), name);
			const result = s.parse(s.unknown, proxy);
			assert(result.ok, name);
			assert.strictEqual(result.value, proxy, name);
		}
	});
});

describe('copy on write', () => {
	const Address = s.object({ city: s.string, zip: s.optional(s.string) });
	const User = s.object({
		name: s.string,
		tags: s.array(s.string),
		address: Address,
		counts: s.record(s.number),
		role: s.with_default(s.string, 'user')
	});

	test('returns the input itself when nothing changed', () => {
		const input = {
			name: 'a',
			tags: ['x'],
			address: { city: 'c' },
			counts: { a: 1 },
			role: 'admin'
		};
		assert.strictEqual(s.parse_or_throw(User, input), input);
		const list = [input, input];
		assert.strictEqual(s.parse_or_throw(s.array(User), list), list);
		const loose = { city: 'c' };
		assert.strictEqual(
			s.parse_or_throw(s.strip_object({ city: s.string, zip: s.optional(s.string) }), loose),
			loose
		);
		assert.strictEqual(s.parse_or_throw(s.union([s.number, Address]), loose), loose);
	});

	test('copies only the changed path and never mutates the input', () => {
		const input = { name: 'a', tags: ['x'], address: { city: 'c' }, counts: { a: 1 } };
		const snapshot = structuredClone(input);
		const output = s.parse_or_throw(User, input);
		assert(!Object.is(output, input));
		assert.deepEqual(output, { ...snapshot, role: 'user' });
		assert.deepEqual(input, snapshot);
		// unchanged siblings are shared with the input
		assert.strictEqual(output.tags, input.tags);
		assert.strictEqual(output.address, input.address);
	});

	test('a change deep in a tree copies each ancestor', () => {
		const Tree = s.strip_object({
			items: s.array(s.strip_object({ n: s.with_default(s.number, 0), keep: s.string }))
		});
		const input = { items: [{ n: 1, keep: 'a' }, { keep: 'b' }, { n: 3, keep: 'c' }] };
		const output = s.parse_or_throw(Tree, input);
		assert.deepEqual(output, {
			items: [
				{ n: 1, keep: 'a' },
				{ n: 0, keep: 'b' },
				{ n: 3, keep: 'c' }
			]
		});
		assert.notStrictEqual(output.items, input.items);
		assert.strictEqual(output.items[0], input.items[0]);
		assert.strictEqual(output.items[2], input.items[2]);
		assert.deepEqual(input.items[1], { keep: 'b' });
	});

	test('strip_object drops unknown keys, by copying', () => {
		const O = s.strip_object({ a: s.string });
		const input = { a: 'x', secret: 1 };
		const output = s.parse_or_throw(O, input);
		assert.deepEqual(output, { a: 'x' });
		assert.deepEqual(input, { a: 'x', secret: 1 });
		// including when a later entry changes
		assert.deepEqual(
			s.parse_or_throw(s.strip_object({ a: s.string, b: s.with_default(s.number, 1) }), input),
			{
				a: 'x',
				b: 1
			}
		);
	});

	test('transforms copy arrays from the first changed item', () => {
		const Upper = s.array(
			s.pipe(
				s.string,
				s.transform((v) => v.toUpperCase())
			)
		);
		const input = ['A', 'b', 'C'];
		const output = s.parse_or_throw(Upper, input);
		assert.deepEqual(output, ['A', 'B', 'C']);
		assert.deepEqual(input, ['A', 'b', 'C']);
		const same = ['A', 'B'];
		assert.strictEqual(s.parse_or_throw(Upper, same), same);
	});

	test('an array copy is whole from the first change, holes and later items included', () => {
		const Doubled = s.array(
			s.pipe(
				s.optional(s.number),
				s.transform((v: number | undefined) => (v === 2 ? 20 : v))
			)
		);
		// eslint-disable-next-line no-sparse-arrays
		const input = [1, , 2, 3, undefined];
		const output = s.parse_or_throw(Doubled, input);
		assert.notStrictEqual(output, input);
		assert.strictEqual(output.length, 5);
		assert.deepEqual(Array.from(output), [1, undefined, 20, 3, undefined]);
		// a hole before the change stays a hole, as it is in the input
		assert.notProperty(output, '1');
		// and the input is as it was
		assert.notProperty(input, '1');
		assert.strictEqual(input[2], 2);
	});

	test('an array copy holds only items that were run, when the input shrinks', () => {
		const input: Array<unknown> = ['a', 'b', 3, 4];
		const Upper = s.array(
			s.pipe(
				s.optional(s.string),
				s.transform((v: string | undefined) => {
					if (v === 'b') input.length = 2;
					return v?.toUpperCase();
				})
			)
		);
		// the length is read once: what is gone reads as `undefined`, and is run
		assert.deepEqual(s.parse_or_throw(Upper, input), ['A', 'B', undefined, undefined]);
	});

	test('record copies when a value changes or a __proto__ key is present', () => {
		const Counts = s.record(s.with_default(s.number, 0));
		const same = { a: 1 };
		assert.strictEqual(s.parse_or_throw(Counts, same), same);
		assert.deepEqual(s.parse_or_throw(Counts, { a: 1, b: undefined, c: 3 }), { a: 1, b: 0, c: 3 });
	});

	// every container, each holding one child at `a` or at the first index
	describe('a child changed when its output is not its input by Object.is', () => {
		const containers: Record<
			string,
			{
				of: (child: s.AnySchema) => s.AnySchema;
				holding: (value: unknown) => any;
				held: (container: any) => unknown;
			}
		> = {
			object: {
				of: (child) => s.object({ a: child }),
				holding: (a) => ({ a }),
				held: (o) => o.a
			},
			strip_object: {
				of: (child) => s.strip_object({ a: child }),
				holding: (a) => ({ a }),
				held: (o) => o.a
			},
			loose_object: {
				of: (child) => s.loose_object({ a: child }),
				holding: (a) => ({ a }),
				held: (o) => o.a
			},
			record: { of: (child) => s.record(child), holding: (a) => ({ a }), held: (o) => o.a },
			array: { of: (child) => s.array(child), holding: (a) => [a], held: (o) => o[0] }
		};
		const negated = s.pipe(
			s.number,
			s.transform((x) => -x)
		);
		// each passes a `NaN` through as it is
		const passing: Record<string, s.AnySchema> = {
			unknown: s.unknown,
			number_or_nan: s.union([s.number, s.literal(NaN)]),
			literal: s.literal(NaN),
			one_of: s.one_of([1, NaN]),
			check: s.check(() => true),
			transform: s.transform((x) => x)
		};

		for (const [name, { of, holding, held }] of Object.entries(containers)) {
			describe(name, () => {
				test('a transform between the two zeros is in the output, which is a copy', () => {
					for (const zero of [0, -0]) {
						const input = holding(zero);
						const output = s.parse_or_throw(of(negated), input);
						assert.notStrictEqual(output, input);
						assert(Object.is(held(output), -zero), inspect(output));
						// and the input is as it was
						assert(Object.is(held(input), zero));
					}
				});

				test('a zero that passes as it is returns the input', () => {
					for (const zero of [0, -0]) {
						const input = holding(zero);
						assert.strictEqual(s.parse_or_throw(of(s.number), input), input);
						assert(Object.is(held(input), zero));
					}
				});

				test('a NaN that passes returns the input', () => {
					for (const [child_name, child] of Object.entries(passing)) {
						const input = holding(NaN);
						assert.strictEqual(s.parse_or_throw(of(child), input), input, child_name);
					}
				});

				test('a NaN made of another value, or made another, copies', () => {
					const to_nan = holding(1);
					const made = s.parse_or_throw(of(s.transform(() => NaN)), to_nan);
					assert.notStrictEqual(made, to_nan);
					assert(Number.isNaN(held(made)));
					assert.strictEqual(held(to_nan), 1);
					const from_nan = holding(NaN);
					const unmade = s.parse_or_throw(of(s.transform(() => 1)), from_nan);
					assert.notStrictEqual(unmade, from_nan);
					assert.strictEqual(held(unmade), 1);
					assert(Number.isNaN(held(from_nan)));
				});

				test('a value that changes copies', () => {
					const input = holding(1);
					const output = s.parse_or_throw(of(negated), input);
					assert.notStrictEqual(output, input);
					assert.strictEqual(held(output), -1);
					assert.strictEqual(held(input), 1);
				});
			});
		}

		test('a zero transform after the first change is written too', () => {
			assert(Object.is(s.parse_or_throw(s.array(negated), [1, 0])[1], -0));
			assert(Object.is(s.parse_or_throw(s.record(negated), { a: 1, b: -0 }).b, 0));
			for (const factory of [s.object, s.strip_object, s.loose_object]) {
				assert(
					Object.is(s.parse_or_throw(factory({ a: negated, b: negated }), { a: 1, b: 0 }).b, -0)
				);
			}
		});

		test('a NaN among items that pass keeps the input, and beside a change is shared', () => {
			const nans = [NaN, 1, NaN];
			assert.strictEqual(s.parse_or_throw(s.array(s.unknown), nans), nans);
			const Nested = s.object({ list: s.array(s.unknown), d: s.with_default(s.number, 0) });
			const input: unknown = { list: nans };
			const output = s.parse_or_throw(Nested, input);
			assert.notStrictEqual(output, input);
			assert.strictEqual(output.list, nans);
		});
	});

	test('a copy never takes an inherited key, even when the key that began it is gone', () => {
		// a getter that deletes its own key, so the copy's pass over the keys
		// before it never meets it and reaches the inherited ones
		const make = (): object => {
			const input = Object.create({ inherited: 'i' });
			Object.defineProperty(input, 'a', {
				get() {
					delete this.a;
					return 'x';
				},
				enumerable: true,
				configurable: true
			});
			input.b = 'y';
			return input;
		};
		const upper = s.pipe(
			s.string,
			s.transform((v) => v.toUpperCase())
		);
		for (const schema of [s.record(upper), s.object_with_rest({}, upper)]) {
			assert.deepEqual(s.parse_or_throw(schema, make()), { a: 'X', b: 'Y' }, schema.kind);
		}
	});
});

describe('object keys', () => {
	// all three, which copy the schema's keys the same way
	const factories = [s.object, s.strip_object, s.loose_object] as const;

	// the own keys of `value`, symbols included, in order
	const keys_of = (value: object): Array<string | symbol> => Reflect.ownKeys(value);

	test('a copy has the schema keys in the schema order', () => {
		for (const factory of factories) {
			const O = factory({ a: s.string, b: s.with_default(s.string, 'd'), c: s.string });
			assert.deepEqual(keys_of(s.parse_or_throw(O, { c: 'z', a: 'x' })), ['a', 'b', 'c']);
			// the first, a middle, and the last entry changing
			const P = factory({
				a: s.with_default(s.string, 'd'),
				b: s.string,
				c: s.with_default(s.string, 'd'),
				d: s.string,
				e: s.with_default(s.string, 'd')
			});
			for (const input of [
				{ b: 'x', c: 'y', d: 'z', e: 'w' },
				{ a: 'v', b: 'x', d: 'z', e: 'w' },
				{ a: 'v', b: 'x', c: 'y', d: 'z' },
				{ d: 'z', b: 'x' }
			]) {
				const output = s.parse_or_throw(P, input);
				assert.deepEqual(keys_of(output), ['a', 'b', 'c', 'd', 'e']);
				assert.deepEqual(output, { a: 'd', c: 'd', e: 'd', ...input });
			}
		}
		// dropping keys copies the same way, whatever order the input has them in
		const O = s.strip_object({ a: s.string, b: s.string, c: s.string });
		assert.deepEqual(keys_of(s.parse_or_throw(O, { z: 1, c: 'z', b: 'y', y: 2, a: 'x' })), [
			'a',
			'b',
			'c'
		]);
	});

	test('a copy keeps a missing key missing and an undefined one present', () => {
		for (const factory of factories) {
			const O = factory({
				a: s.optional(s.string),
				b: s.string,
				c: s.optional(s.string),
				d: s.with_default(s.string, 'd'),
				e: s.optional(s.string)
			});
			assert.deepEqual(keys_of(s.parse_or_throw(O, { b: 'x' })), ['b', 'd']);
			assert.deepEqual(keys_of(s.parse_or_throw(O, { a: undefined, b: 'x', e: undefined })), [
				'a',
				'b',
				'd',
				'e'
			]);
			assert.deepEqual(keys_of(s.parse_or_throw(O, { b: 'x', c: undefined })), ['b', 'c', 'd']);
		}
		// and when the copy is made to drop a key
		const O = s.strip_object({ a: s.optional(s.string), b: s.string, c: s.optional(s.string) });
		assert.deepEqual(keys_of(s.parse_or_throw(O, { b: 'x', z: 1 })), ['b']);
		assert.deepEqual(keys_of(s.parse_or_throw(O, { z: 1, c: undefined, b: 'x' })), ['b', 'c']);
		// a transform to `undefined` keeps its key
		const T = s.object({
			a: s.pipe(
				s.string,
				s.transform(() => undefined)
			),
			b: s.string
		});
		assert.deepEqual(keys_of(s.parse_or_throw(T, { a: 'x', b: 'y' })), ['a', 'b']);
	});

	test('an unknown key is found wherever it is', () => {
		const entries = { a: s.string, b: s.optional(s.string), c: s.string, 1: s.string };
		const inputs: Array<Record<string, unknown>> = [
			{ a: 'x', b: 'y', c: 'z', 1: 'n', z: 1 },
			{ z: 1, a: 'x', b: 'y', c: 'z', 1: 'n' },
			{ a: 'x', z: 1, b: 'y', c: 'z', 1: 'n' },
			// in another order than the schema's
			{ c: 'z', z: 1, a: 'x', 1: 'n' },
			// an optional key absent, so the rest don't line up with the schema
			{ a: 'x', c: 'z', 1: 'n', z: 1 },
			// an integer-like key, which is enumerated ahead of the others
			{ a: 'x', c: 'z', 1: 'n', 0: 'm' },
			// names an object inherits
			{ a: 'x', c: 'z', 1: 'n', toString: 1 },
			{ a: 'x', c: 'z', 1: 'n', constructor: 1 },
			JSON.parse('{"a": "x", "c": "z", "1": "n", "__proto__": {"a": 1}}')
		];
		for (const input of inputs) {
			const unknown = keys_of(input).filter((k) => !Object.hasOwn(entries, k));
			assert.strictEqual(unknown.length, 1);
			const Strict = s.object(entries);
			assert(!s.is(Strict, input));
			assert.deepEqual(
				issues_of(Strict, input).map((i) => [i.kind, i.path]),
				[['unknown_key', unknown]]
			);
			const Strip = s.strip_object(entries);
			assert(s.is(Strip, input));
			const output: object = s.parse_or_throw(Strip, input);
			assert.notStrictEqual(output, input);
			assert.deepEqual(
				keys_of(output),
				Object.keys(entries).filter((k) => Object.hasOwn(input, k))
			);
			assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
			// and with an entry that changes
			const Changed = s.strip_object({ ...entries, d: s.with_default(s.string, 'd') });
			const changed: object = s.parse_or_throw(Changed, input);
			assert.deepEqual(keys_of(changed), [...keys_of(output), 'd']);
		}
		// without the unknown key every one of them is the output itself
		for (const input of [
			{ a: 'x', b: 'y', c: 'z', 1: 'n' },
			{ c: 'z', a: 'x', 1: 'n' },
			{ a: 'x', c: 'z', 1: 'n' }
		]) {
			for (const factory of factories) {
				assert.strictEqual(s.parse_or_throw(factory(entries), input), input);
			}
		}
	});

	test('object reports every unknown key after the entries, in the order of the input', () => {
		const O = s.object({ a: s.string, b: s.string });
		assert.deepEqual(
			issues_of(O, { y: 1, b: 2, z: null, a: 4, x: [] }).map((i) => [i.kind, i.path, i.received]),
			[
				['string', ['a'], 'number'],
				['string', ['b'], 'number'],
				['unknown_key', ['y'], 'number'],
				['unknown_key', ['z'], 'null'],
				['unknown_key', ['x'], 'array']
			]
		);
	});

	test('strip_object never returns a key the schema does not name', () => {
		const entries = { a: s.string, b: s.optional(s.string), c: s.with_default(s.string, 'd') };
		const O = s.strip_object(entries);
		const inputs: Array<Record<string, unknown>> = [
			// more keys than the schema, as many, and fewer
			{ a: 'x', b: 'y', c: 'z', y: 1, z: 2 },
			{ a: 'x', c: 'z', z: 2 },
			{ a: 'x', b: 'y', z: 2 },
			{ z: 2, a: 'x' },
			{ a: 'x', z: 2 }
		];
		for (const input of inputs) {
			const snapshot = { ...input };
			const output: object = s.parse_or_throw(O, input);
			assert(keys_of(output).every((k) => Object.hasOwn(entries, k)));
			const { y: _y, z: _z, ...known } = snapshot;
			assert.deepEqual(output, { c: 'd', ...known });
			assert(!('z' in output));
			assert.deepEqual(input, snapshot);
			// as an option of a union, which reads the output of a probe
			assert.deepEqual<unknown>(s.parse_or_throw(s.union([s.number, O]), input), output);
		}
		// an unknown key the input inherits is dropped too
		const inherits = Object.assign(Object.create({ z: 1 }), { a: 'x', c: 'z' });
		const output: object = s.parse_or_throw(O, inherits);
		assert.notStrictEqual(output, inherits);
		assert.deepEqual(keys_of(output), ['a', 'c']);
		assert(!('z' in output));
		assert(!s.is(s.object(entries), inherits));
	});

	test('a key the input adds while it is parsed is still dropped or rejected', () => {
		const create_input = (): Record<string, unknown> => {
			const input: Record<string, unknown> = {
				get a() {
					input.added = 1;
					return 'x';
				},
				b: 'y'
			};
			return input;
		};
		const output: object = s.parse_or_throw(
			s.strip_object({ a: s.string, b: s.string }),
			create_input()
		);
		assert.deepEqual(keys_of(output), ['a', 'b']);
		assert.deepEqual(
			issues_of(s.object({ a: s.string, b: s.string }), create_input()).map((i) => i.path),
			[['added']]
		);
	});

	test('an entry that is an object schema leaves the unknown keys around it found', () => {
		const child = { x: s.string };
		for (const [inner_name, inner] of [
			['object', s.object(child)],
			['strip_object', s.strip_object(child)]
		] as const) {
			// `z` comes before `child`, whose own keys are all the schema's
			const input = { a: 'x', z: 1, child: { x: 'y' } };
			assert.deepEqual(
				issues_of(s.object({ a: s.string, child: inner }), input).map((i) => i.path),
				[['z']],
				inner_name
			);
			assert.deepEqual(
				s.parse_or_throw(s.strip_object({ a: s.string, child: inner }), input),
				{ a: 'x', child: { x: 'y' } },
				inner_name
			);
			// the same with the unknown key last, and with the child's keys the ones out of order
			const last = { a: 'x', child: { x: 'y' }, z: 1 };
			assert.deepEqual(
				issues_of(s.object({ a: s.string, child: inner }), last).map((i) => i.path),
				[['z']],
				inner_name
			);
			// and the entries after the child are still run, each at its own place
			assert.deepEqual(
				issues_of(s.object({ child: inner, a: s.string, b: s.string }), {
					child: { x: 'y' },
					a: 1,
					b: 2
				}).map((i) => i.path),
				[['a'], ['b']],
				inner_name
			);
			const Outer = s.object({ child: s.object({ x: s.string, y: s.string }), b: s.string });
			const mixed = { child: { y: 'y', x: 'x' }, b: 'b' };
			assert.strictEqual(s.parse_or_throw(Outer, mixed), mixed);
			assert.deepEqual(
				issues_of(Outer, { child: { y: 'y', x: 'x', z: 1 }, b: 'b' }).map((i) => i.path),
				[['child', 'z']]
			);
		}
	});

	test('issues come in the order of the schema, then unknown keys, whatever the order of the input', () => {
		const entries = { a: s.string, b: s.string, c: s.string, d: s.optional(s.string) };
		for (const input of [
			{ a: 1, b: 'x', c: 2, z: 3 },
			{ a: 1, z: 3, b: 'x', c: 2 },
			{ z: 3, c: 2, b: 'x', a: 1 },
			{ c: 2, a: 1, z: 3, b: 'x' }
		]) {
			assert.deepEqual(
				issues_of(s.object(entries), input).map((i) => i.path),
				[['a'], ['c'], ['z']]
			);
			assert.deepEqual(
				issues_of(s.strip_object(entries), input).map((i) => i.path),
				[['a'], ['c']]
			);
		}
	});

	test('a copy begun at a key the input has leaves out a later key it lacks', () => {
		for (const factory of factories) {
			const O = factory({
				a: s.with_default(s.string, 'd'),
				b: s.pipe(
					s.string,
					s.transform((v) => v + '!')
				),
				c: s.optional(s.string),
				d: s.with_default(s.string, 'd')
			});
			// `b` changes, and `c` is absent after the copy has begun
			const output: object = s.parse_or_throw(O, { a: 'x', b: 'y' });
			assert.deepEqual(keys_of(output), ['a', 'b', 'd']);
			assert.deepEqual(output, { a: 'x', b: 'y!', d: 'd' });
		}
	});

	test('keys the schema names are read through the prototype and copied as own', () => {
		class Point {
			x = 1;
			get y(): number {
				return this.x + 1;
			}
		}
		for (const factory of factories) {
			const O = factory({ x: s.number, y: s.number });
			// unchanged, an instance is the output itself
			const point = new Point();
			assert.strictEqual(s.parse_or_throw(O, point), point);
			const Defaulted = factory({ x: s.number, y: s.number, z: s.with_default(s.number, 3) });
			const output: object = s.parse_or_throw(Defaulted, point);
			assert.deepEqual(keys_of(output), ['x', 'y', 'z']);
			assert.deepEqual(output, { x: 1, y: 2, z: 3 });
			assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
			// an enumerable key on the prototype
			const inherits = Object.assign(Object.create({ y: 2 }), { x: 1 });
			assert.strictEqual(s.parse_or_throw(O, inherits), inherits);
			assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, inherits)), ['x', 'y', 'z']);
			// a non-enumerable own key
			const hidden = Object.defineProperty({ x: 1 }, 'y', { value: 2 });
			assert.strictEqual(s.parse_or_throw(O, hidden), hidden);
			assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, hidden)), ['x', 'y', 'z']);
			// no prototype at all
			const bare = Object.assign(Object.create(null), { x: 1, y: 2 });
			assert.strictEqual(s.parse_or_throw(O, bare), bare);
			assert.deepEqual(s.parse_or_throw(Defaulted, bare), { x: 1, y: 2, z: 3 });
		}
		// dropping a key copies them the same way
		const O = s.strip_object({ x: s.number, y: s.number });
		const output: object = s.parse_or_throw(O, Object.assign(new Point(), { extra: 1 }));
		assert.deepEqual(keys_of(output), ['x', 'y']);
		assert.deepEqual(output, { x: 1, y: 2 });
	});

	test('symbol and non-enumerable keys the schema does not name are never copied', () => {
		const sym = Symbol('sym');
		for (const factory of factories) {
			const O = factory({ a: s.string, b: s.with_default(s.string, 'd') });
			const input = Object.defineProperty({ a: 'x', b: 'y', [sym]: 1 }, 'hidden', { value: 2 });
			// they are not looked at, so an unchanged input is still the output itself
			assert.strictEqual(s.parse_or_throw(O, input), input);
			const changed = Object.defineProperty({ a: 'x', [sym]: 1 }, 'hidden', { value: 2 });
			assert.deepEqual(keys_of(s.parse_or_throw(O, changed)), ['a', 'b']);
		}
	});

	test('each entry runs once, and each key is read once when nothing is copied', () => {
		for (const factory of factories) {
			let runs = 0;
			let reads = 0;
			const O = factory({
				a: s.pipe(
					s.string,
					s.check(() => {
						runs++;
						return true;
					})
				),
				b: s.string
			});
			const input = {
				get a() {
					reads++;
					return 'x';
				},
				b: 'y'
			};
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert.strictEqual(runs, 1);
			assert.strictEqual(reads, 1);
		}
		let runs = 0;
		const O = s.strip_object({
			a: s.pipe(
				s.string,
				s.check(() => {
					runs++;
					return true;
				})
			)
		});
		assert.deepEqual(s.parse_or_throw(O, { a: 'x', z: 1 }), { a: 'x' });
		assert.strictEqual(runs, 1);
	});

	test('object rejects an unknown key when an entry changed', () => {
		const schemas = [
			s.object({ a: s.string, b: s.with_default(s.string, 'd') }),
			s.object({ b: s.with_default(s.string, 'd'), a: s.string }),
			s.object({
				a: s.pipe(
					s.string,
					s.transform((v) => v.toUpperCase())
				)
			})
		];
		for (const O of schemas) {
			for (const input of [
				{ a: 'x', z: 1 },
				{ z: 1, a: 'x' }
			]) {
				assert(!s.is(O, input));
				assert.deepEqual(
					issues_of(O, input).map((i) => [i.kind, i.path]),
					[['unknown_key', ['z']]]
				);
				// as an option of a union, which takes the output of a probe
				assert(!s.is(s.union([s.number, O]), input));
			}
		}
	});

	test('a copy keeps an inherited undefined key, as an own one', () => {
		const create_input = (own: Record<string, unknown>): Record<string, unknown> =>
			Object.assign(Object.create({ a: undefined }), own);
		for (const factory of factories) {
			// the inherited key before the entry that changes, and after it
			const Before = factory({
				a: s.optional(s.string),
				b: s.string,
				c: s.with_default(s.string, 'd')
			});
			const before: object = s.parse_or_throw(Before, create_input({ b: 'x' }));
			assert.deepEqual(keys_of(before), ['a', 'b', 'c']);
			assert.strictEqual(Object.getPrototypeOf(before), Object.prototype);
			const After = factory({
				c: s.with_default(s.string, 'd'),
				a: s.optional(s.string),
				b: s.string
			});
			assert.deepEqual(keys_of(s.parse_or_throw(After, create_input({ b: 'x' }))), ['c', 'a', 'b']);
		}
		// and when the copy is made to drop a key
		const O = s.strip_object({ a: s.optional(s.string), b: s.string });
		assert.deepEqual(keys_of(s.parse_or_throw(O, create_input({ b: 'x', z: 1 }))), ['a', 'b']);
	});
});

describe('loose_object copy', () => {
	// the own keys of `value`, symbols included, in order
	const keys_of = (value: object): Array<string | symbol> => Reflect.ownKeys(value);

	const sym = Symbol('sym');
	const upper = s.pipe(
		s.string,
		s.transform((v) => v.toUpperCase())
	);
	// nothing changes in the first, and each of the others has an entry that does
	const Same = s.loose_object({ a: s.optional(s.string), b: s.optional(s.string) });
	const Defaulted = s.loose_object({ a: s.string, d: s.with_default(s.string, 'D') });
	const Transformed = s.loose_object({ a: s.string, b: upper, c: s.string });

	class Point {
		u = 1;
		get a(): string {
			return 'x'.repeat(this.u);
		}
	}

	test('the schema keys come first in the schema order, then the unknown keys in the input order', () => {
		// unknown keys before, between, and after the schema's
		const input = { y: 1, c: 'c', m: 2, a: 'a', b: 'b', z: 3 };
		const output = s.parse_or_throw(Transformed, input);
		assert.deepEqual(keys_of(output), ['a', 'b', 'c', 'y', 'm', 'z']);
		assert.deepEqual(output, { a: 'a', b: 'B', c: 'c', y: 1, m: 2, z: 3 });
		assert.deepEqual(keys_of(input), ['y', 'c', 'm', 'a', 'b', 'z']);
		assert.strictEqual(input.b, 'b');
		// a default, written at its entry's place and not after the unknown keys
		assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, { x: 1, a: 'a', w: 2 })), [
			'a',
			'd',
			'x',
			'w'
		]);
		// an unknown key whose value is `undefined` is kept
		const kept = s.parse_or_throw(Defaulted, { u: undefined, a: 'a' });
		assert.deepEqual(keys_of(kept), ['a', 'd', 'u']);
		assert.strictEqual(kept.u, undefined);
		// the first, a middle, and the last entry changing
		const O = s.loose_object({
			a: s.with_default(s.string, 'd'),
			b: s.string,
			c: s.with_default(s.string, 'd'),
			e: s.with_default(s.string, 'd')
		});
		for (const changed of [
			{ z: 1, b: 'x', c: 'y', e: 'w' },
			{ a: 'v', z: 1, b: 'x', e: 'w' },
			{ a: 'v', b: 'x', c: 'y', z: 1 },
			{ z: 1, b: 'x' }
		]) {
			const copy = s.parse_or_throw(O, changed);
			assert.deepEqual(keys_of(copy), ['a', 'b', 'c', 'e', 'z']);
			assert.deepEqual(copy, { a: 'd', c: 'd', e: 'd', ...changed });
		}
	});

	test('a schema key the input inherits or hides is copied as an own key', () => {
		const inherits = Object.assign(Object.create({ a: 'x' }), { u: 1 });
		const output = s.parse_or_throw(Defaulted, inherits);
		assert.deepEqual(keys_of(output), ['a', 'd', 'u']);
		assert.deepEqual(output, { a: 'x', d: 'D', u: 1 });
		assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, Object.create({ a: 'x' }))), ['a', 'd']);
		const hidden = Object.defineProperty({ u: 1 }, 'a', { value: 'x' });
		const copy = s.parse_or_throw(Defaulted, hidden);
		assert.deepEqual(keys_of(copy), ['a', 'd', 'u']);
		assert(Object.getOwnPropertyDescriptor(copy, 'a')!.enumerable);
		// through a getter on a class
		assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, new Point())), ['a', 'd', 'u']);
	});

	test('an unknown key is copied only when it is an own enumerable string key', () => {
		const input = Object.defineProperty(
			Object.assign(Object.create({ inherited: 1 }), { a: 'x', [sym]: 1, u: 1 }),
			'hidden',
			{ value: 2 }
		);
		const output: object = s.parse_or_throw(Defaulted, input);
		assert.deepEqual(keys_of(output), ['a', 'd', 'u']);
		assert(!('inherited' in output));
		assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
	});

	test('a __proto__ key the schema does not name is left out of a copy', () => {
		for (const text of [
			'{"a": "x", "__proto__": {"p": 1}, "u": 1}',
			'{"__proto__": {"p": 1}, "a": "x", "u": 1}',
			'{"a": "x", "u": 1, "__proto__": 1}'
		]) {
			const output: object = s.parse_or_throw(Defaulted, JSON.parse(text));
			assert.deepEqual(keys_of(output), ['a', 'd', 'u']);
			assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
			assert(!('p' in output));
		}
		assert.strictEqual(({} as any).p, undefined);
	});

	test('a missing optional key stays out and an undefined one stays in', () => {
		const O = s.loose_object({
			o: s.optional(s.string),
			a: s.string,
			d: s.with_default(s.string, 'D'),
			p: s.optional(s.string)
		});
		assert.deepEqual(keys_of(s.parse_or_throw(O, { u: 1, a: 'x' })), ['a', 'd', 'u']);
		const output = s.parse_or_throw(O, { u: 1, p: undefined, a: 'x', o: undefined });
		assert.deepEqual(keys_of(output), ['o', 'a', 'd', 'p', 'u']);
		assert.deepEqual(output, { o: undefined, a: 'x', d: 'D', p: undefined, u: 1 });
	});

	test('a copy has a plain prototype whatever the input has', () => {
		const bare = Object.assign(Object.create(null), { u: 1, a: 'x' });
		const from_bare: object = s.parse_or_throw(Defaulted, bare);
		assert.strictEqual(Object.getPrototypeOf(from_bare), Object.prototype);
		assert.deepEqual(keys_of(from_bare), ['a', 'd', 'u']);
		const from_instance: object = s.parse_or_throw(Defaulted, new Point());
		assert.strictEqual(Object.getPrototypeOf(from_instance), Object.prototype);
		assert.deepEqual(from_instance, { a: 'x', d: 'D', u: 1 });
	});

	test('the input comes back, whatever its keys, when no entry changed', () => {
		const inputs: Array<object> = [
			{ y: 1, b: 'b', m: 2, a: 'a', z: 3 },
			{ u: undefined },
			Object.assign(Object.create({ a: 'x', inherited: 1 }), { u: 1 }),
			Object.defineProperty(Object.defineProperty({ u: 1 }, 'a', { value: 'x' }), 'hidden', {
				value: 2
			}),
			{ a: 'x', [sym]: 1 },
			JSON.parse('{"a": "x", "__proto__": {"p": 1}, "u": 1}'),
			{ a: undefined, b: undefined, u: 1 },
			Object.assign(Object.create(null), { u: 1, a: 'x' }),
			new Point(),
			{ 1: 'n', a: 'x' }
		];
		for (const input of inputs) {
			const keys = keys_of(input);
			assert.strictEqual<unknown>(s.parse_or_throw(Same, input), input);
			assert(s.is(Same, input));
			assert.deepEqual(keys_of(input), keys);
			// as an option of a union, which takes the output of a probe
			assert.strictEqual<unknown>(s.parse_or_throw(s.union([s.number, Same]), input), input);
		}
		// a default that is there, and a transform that returns what it was given
		const present = { x: 1, d: 'd', a: 'a' };
		assert.strictEqual<unknown>(s.parse_or_throw(Defaulted, present), present);
		const upper_already = { z: 1, c: 'c', b: 'B', a: 'a' };
		assert.strictEqual<unknown>(s.parse_or_throw(Transformed, upper_already), upper_already);
	});

	test('unknown keys are not looked at unless a copy is made, and then are read once', () => {
		let reads = 0;
		let entry_reads = 0;
		const create_input = (): Record<string, unknown> => ({
			get u() {
				reads++;
				return 1;
			},
			get a() {
				entry_reads++;
				return 'x';
			}
		});
		const traps: Array<string> = [];
		const watched = new Proxy(create_input(), {
			ownKeys: (target) => {
				traps.push('ownKeys');
				return Reflect.ownKeys(target);
			}
		});
		assert.strictEqual<unknown>(s.parse_or_throw(Same, watched), watched);
		assert.deepEqual([reads, entry_reads, traps.length], [0, 1, 0]);
		// a failed probe doesn't enumerate either, though an entry changed before the failure
		assert(!s.is(s.loose_object({ d: s.with_default(s.string, 'D'), a: s.number }), watched));
		assert.deepEqual([reads, traps.length], [0, 0]);
		reads = entry_reads = 0;
		// the entry before the one that changed is read again for the copy
		assert.deepEqual(s.parse_or_throw(Defaulted, create_input()), { a: 'x', d: 'D', u: 1 });
		assert.deepEqual([reads, entry_reads], [1, 2]);
		reads = entry_reads = 0;
		// and the one after it is not
		const After = s.loose_object({ d: s.with_default(s.string, 'D'), a: s.string });
		assert.deepEqual(s.parse_or_throw(After, create_input()), { d: 'D', a: 'x', u: 1 });
		assert.deepEqual([reads, entry_reads], [1, 1]);
	});

	test('a key the input adds while it is parsed is in the copy, after the schema keys', () => {
		const input: Record<string, unknown> = {
			u: 1,
			get a() {
				input.added = 2;
				return 'x';
			}
		};
		assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, input)), ['a', 'd', 'u', 'added']);
	});

	test('an integer-like key comes first, as it does in any object', () => {
		const O = s.loose_object({ a: s.string, 1: s.string, d: s.with_default(s.string, 'D') });
		const output = s.parse_or_throw(O, { z: 1, a: 'x', 1: 'n', 0: 'm' });
		assert.deepEqual(keys_of(output), ['0', '1', 'a', 'd', 'z']);
		assert.deepEqual(output, { 0: 'm', 1: 'n', a: 'x', d: 'D', z: 1 });
	});

	test('an unknown key named like a member of Object.prototype is kept', () => {
		const output = s.parse_or_throw(Defaulted, { toString: 1, a: 'x', constructor: 2 });
		assert.deepEqual(keys_of(output), ['a', 'd', 'toString', 'constructor']);
		assert.deepEqual<unknown>(output, { a: 'x', d: 'D', toString: 1, constructor: 2 });
		// `constructor` and `prototype` too, which Valibot drops and Zod keeps
		const named = s.parse_or_throw(Defaulted, { prototype: 1, a: 'x', constructor: 2 });
		assert.deepEqual(keys_of(named), ['a', 'd', 'prototype', 'constructor']);
	});

	test('a __proto__ entry is written to a copy as the other object schemas write it', () => {
		const text = '{"a": "x", "__proto__": {"p": 1}, "u": 1}';
		for (const factory of [s.object, s.strip_object, s.loose_object] as const) {
			const O = factory({
				a: s.string,
				['__proto__']: s.unknown,
				u: s.number,
				d: s.with_default(s.string, 'D')
			});
			assert(Object.hasOwn(O.def, '__proto__'));
			const output: object = s.parse_or_throw(O, JSON.parse(text));
			// not guarded: the entry's value becomes the copy's prototype
			assert.deepEqual(Object.getPrototypeOf(output), { p: 1 });
			assert.deepEqual(Object.keys(output), ['a', 'u', 'd']);
		}
		// the entry is still run
		assert(!s.is(s.loose_object({ a: s.string, ['__proto__']: s.string }), JSON.parse(text)));
	});

	test('a nested loose object copies the path to the change and shares the rest', () => {
		const Inner = s.loose_object({ x: s.string, d: s.with_default(s.string, 'D') });
		const Outer = s.loose_object({ same: Inner, changed: Inner, items: s.array(Inner) });
		const same = { u: 1, x: 'x', d: 'd' };
		const item = { w: 4, x: 'x' };
		const sibling = { deep: true };
		const input = { first: sibling, items: [item], changed: { v: 2, x: 'y' }, same, last: 3 };
		const output = s.parse_or_throw(Outer, input);
		assert.deepEqual(keys_of(output), ['same', 'changed', 'items', 'first', 'last']);
		assert.strictEqual<unknown>(output.same, same);
		assert.strictEqual(output.first, sibling);
		assert.deepEqual(keys_of(output.changed), ['x', 'd', 'v']);
		assert.deepEqual(output.changed, { x: 'y', d: 'D', v: 2 });
		assert.deepEqual(keys_of(output.items[0]!), ['x', 'd', 'w']);
		assert.deepEqual(input.changed, { v: 2, x: 'y' });
		assert.deepEqual(item, { w: 4, x: 'x' });
		// under an object that rejects unknown keys of its own
		const Strict = s.object({ inner: Inner });
		assert.deepEqual(keys_of(s.parse_or_throw(Strict, { inner: { v: 2, x: 'y' } }).inner), [
			'x',
			'd',
			'v'
		]);
	});

	test('a failed probe has no output, and a union takes the copy of a probe that passed', () => {
		const O = s.union([
			s.loose_object({ a: s.number, d: s.with_default(s.string, 'D') }),
			Defaulted
		]);
		const output: object = s.parse_or_throw(O, { u: 1, a: 'x' });
		assert.deepEqual(keys_of(output), ['a', 'd', 'u']);
		assert(!s.is(Defaulted, { u: 1, a: 1 }));
		assert(!s.is(Defaulted, { u: 1 }));
		// issues are the entries' alone, with a changed entry before or after the failed one
		assert.deepEqual(
			issues_of(s.loose_object({ d: s.with_default(s.string, 'D'), a: s.string }), { u: 1 }).map(
				(i) => [i.kind, i.path]
			),
			[['string', ['a']]]
		);
		assert.deepEqual(
			issues_of(Defaulted, { u: 1 }).map((i) => [i.kind, i.path]),
			[['string', ['a']]]
		);
	});

	test('the three object schemas copy the schema keys the same way', () => {
		const entries = {
			o: s.optional(s.string),
			a: s.string,
			b: upper,
			d: s.with_default(s.string, 'D'),
			p: s.optional(s.string)
		};
		const Loose = s.loose_object(entries);
		const Strip = s.strip_object(entries);
		const Strict = s.object(entries);
		const create_inputs = (): Array<Record<string, unknown>> => [
			{ b: 'b', a: 'a' },
			{ p: undefined, b: 'b', a: 'a', o: undefined },
			{ a: 'a', b: 'B' },
			{ d: 'd', b: 'b', a: 'a', o: 'o', p: 'p' },
			Object.assign(Object.create({ a: 'a', o: undefined }), { b: 'b' }),
			Object.defineProperty({ b: 'b' }, 'a', { value: 'a' }),
			Object.assign(Object.create(null), { b: 'b', a: 'a' })
		];
		for (const [i, input] of create_inputs().entries()) {
			const strict: object = s.parse_or_throw(Strict, input);
			const stripped: object = s.parse_or_throw(Strip, input);
			const loose: object = s.parse_or_throw(Loose, input);
			assert.notStrictEqual(strict, input);
			for (const output of [stripped, loose]) {
				assert.deepEqual(keys_of(output), keys_of(strict));
				assert.deepEqual(output, strict);
				assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
			}
			// with unknown keys, the loose copy is the stripped one and then those keys
			const more = Object.assign(create_inputs()[i]!, { z: 1, y: undefined });
			(more as Record<PropertyKey, unknown>)[sym] = 2;
			assert.deepEqual(keys_of(s.parse_or_throw(Loose, more)), [...keys_of(strict), 'z', 'y']);
			assert.deepEqual(keys_of(s.parse_or_throw(Strip, more)), keys_of(strict));
		}
	});
});

describe('object_with_rest', () => {
	const keys_of = (value: object): Array<string | symbol> => Reflect.ownKeys(value);
	const sym = Symbol('sym');
	const upper = s.pipe(
		s.string,
		s.transform((v) => v.toUpperCase())
	);
	const Numbers = s.object_with_rest({ a: s.string, b: s.optional(s.string) }, s.number);
	const Defaulted = s.object_with_rest({ a: s.string, d: s.with_default(s.string, 'D') }, s.number);
	const Upper = s.object_with_rest({ a: s.string }, upper);

	test('validates every other own key with rest', () => {
		assert(s.is(Numbers, { a: 'x' }));
		assert(s.is(Numbers, { a: 'x', b: 'y', z: 1, y: 2 }));
		assert(!s.is(Numbers, { a: 'x', z: 'z' }));
		assert(!s.is(Numbers, { z: 1 }));
		// an entry out of the schema's order is an entry, not one of the other keys
		assert(s.is(Numbers, { b: 'y', a: 'x' }));
		assert.deepEqual(
			issues_of(Numbers, { b: 'y', z: 'z', a: 'x' }).map((i) => i.path),
			[['z']]
		);
		assert.deepEqual(issues_of(Numbers, { z: 'z', a: 'x' }), [
			{ kind: 'number', expected: 'number', received: 'string', path: ['z'], message: undefined }
		]);
		// a key that isn't an identifier, in the path as it is
		assert.deepEqual(
			issues_of(Numbers, { a: 'x', 'some-key': null }).map((i) => [i.path, s.format_issue(i)]),
			[[['some-key'], '"some-key": expected number, received null']]
		);
		// nested, the path goes through the key
		const Nested = s.object_with_rest({}, s.object_with_rest({}, s.number));
		assert.deepEqual(
			issues_of(Nested, { o: { p: 'x' } }).map((i) => i.path),
			[['o', 'p']]
		);
	});

	test('the entries are reported first, then the other keys in the input order', () => {
		const O = s.object_with_rest({ _: s.array(s.string), n: s.number }, s.number);
		// keys that fail before, between, and after the entries, and one that passes
		const input = { y: 'y', _: [1, 'x', 2], m: 'm', ok: 1, n: 'n', z: null };
		assert.deepEqual(
			issues_of(O, input).map((i) => i.path),
			[['_', 0], ['_', 2], ['n'], ['y'], ['m'], ['z']]
		);
		// as `object` reports its entries before its unknown keys
		assert.deepEqual(
			issues_of(s.object({ _: s.array(s.string) }), { y: 1, _: [1] }).map((i) => i.path),
			[['_', 0], ['y']]
		);
		// probe mode stops at the first failure, whichever it is
		assert(!s.is(O, { _: [1], y: 'y' }));
		assert(!s.is(O, { _: [], n: 1, y: 'y' }));
		assert(s.is(O, { _: [], n: 1, y: 1 }));
	});

	test('the input comes back when nothing changed', () => {
		const inputs: Array<object> = [
			{ a: 'x' },
			{ z: 1, a: 'x', b: 'y', y: 2 },
			{ a: 'x', [sym]: 'not a number' },
			Object.defineProperty({ a: 'x' }, 'hidden', { value: 'not a number' }),
			Object.assign(Object.create(null), { a: 'x', z: 1 }),
			Object.assign(Object.create({ a: 'x', inherited: 'not a number' }), { z: 1 })
		];
		for (const input of inputs) {
			const keys = keys_of(input);
			assert.strictEqual<unknown>(s.parse_or_throw(Numbers, input), input);
			assert(s.is(Numbers, input));
			assert.deepEqual(keys_of(input), keys);
			assert.strictEqual<unknown>(s.parse_or_throw(s.union([s.string, Numbers]), input), input);
		}
		const already = { z: 'Z', a: 'x' };
		assert.strictEqual<unknown>(s.parse_or_throw(Upper, already), already);
		// a value `rest` gives back is unchanged by `Object.is`, as a `NaN` is,
		// and a `-0` it gives back as `0` is a change
		const nan = { a: 'x', z: NaN };
		assert.strictEqual<unknown>(
			s.parse_or_throw(s.object_with_rest({ a: s.string }, s.unknown), nan),
			nan
		);
		const zero = s.object_with_rest(
			{ a: s.string },
			s.pipe(
				s.number,
				s.transform((n) => n + 0)
			)
		);
		assert(Object.is(s.parse_or_throw(zero, { a: 'x', z: -0 }).z, 0));
	});

	test('a copy has the schema keys first, then the other keys in the input order', () => {
		// a change in an entry
		const output = s.parse_or_throw(Defaulted, { y: 1, a: 'x', z: 2 });
		assert.deepEqual(keys_of(output), ['a', 'd', 'y', 'z']);
		assert.deepEqual<unknown>(output, { a: 'x', d: 'D', y: 1, z: 2 });
		// a change in another key: first, in the middle, and last
		for (const [input, expected] of [
			[
				{ y: 'y', a: 'x', z: 'Z' },
				{ a: 'x', y: 'Y', z: 'Z' }
			],
			[
				{ y: 'Y', a: 'x', z: 'z', w: 'W' },
				{ a: 'x', y: 'Y', z: 'Z', w: 'W' }
			],
			[
				{ y: 'Y', z: 'Z', a: 'x', w: 'w' },
				{ a: 'x', y: 'Y', z: 'Z', w: 'W' }
			]
		] as const) {
			const copy = s.parse_or_throw(Upper, input);
			assert.notStrictEqual<unknown>(copy, input);
			assert.deepEqual(keys_of(copy), keys_of(expected));
			assert.deepEqual<unknown>(copy, expected);
		}
		// a missing optional entry stays out, an undefined one stays in
		const optional = s.object_with_rest({ o: s.optional(s.string), a: upper }, s.unknown);
		assert.deepEqual(keys_of(s.parse_or_throw(optional, { u: 1, a: 'x' })), ['a', 'u']);
		assert.deepEqual(keys_of(s.parse_or_throw(optional, { u: 1, a: 'x', o: undefined })), [
			'o',
			'a',
			'u'
		]);
		// the same in a copy begun at another key
		const later = s.object_with_rest({ o: s.optional(s.string), a: s.string }, upper);
		assert.deepEqual(keys_of(s.parse_or_throw(later, { a: 'x', u: 'u' })), ['a', 'u']);
		assert.deepEqual(keys_of(s.parse_or_throw(later, { u: 'u', a: 'x', o: undefined })), [
			'o',
			'a',
			'u'
		]);
		// a key whose value is `undefined` that rest accepts is kept
		const kept = s.parse_or_throw(s.object_with_rest({ a: upper }, s.unknown), {
			u: undefined,
			a: 'x'
		});
		assert.deepEqual(keys_of(kept), ['a', 'u']);
		// a copy has a plain prototype
		const bare = Object.assign(Object.create(null), { z: 'z', a: 'x' });
		assert.strictEqual(Object.getPrototypeOf(s.parse_or_throw(Upper, bare)), Object.prototype);
		// the input is never mutated
		const input = { z: 'z', a: 'x' };
		s.parse_or_throw(Upper, input);
		assert.deepEqual(input, { z: 'z', a: 'x' });
	});

	test('a key the input inherits is neither validated nor copied', () => {
		const inherits = Object.assign(Object.create({ inherited: 'not a number' }), {
			a: 'x',
			z: 1
		});
		assert(s.is(Numbers, inherits));
		const copy: object = s.parse_or_throw(Defaulted, inherits);
		assert.deepEqual(keys_of(copy), ['a', 'd', 'z']);
		assert(!('inherited' in copy));
		// an entry it inherits is read through the prototype, as in every object schema
		assert(s.is(Numbers, Object.create({ a: 'x' })));
	});

	test('a symbol key and a non-enumerable key are neither validated nor copied', () => {
		const input = Object.defineProperty({ a: 'x', [sym]: 'not a number', z: 1 }, 'hidden', {
			value: 'not a number'
		});
		assert(s.is(Numbers, input));
		assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, input)), ['a', 'd', 'z']);
	});

	test('an own key named constructor or prototype is validated as any other', () => {
		for (const key of ['constructor', 'prototype', 'toString']) {
			assert(!s.is(Numbers, { a: 'x', [key]: 'not a number' }), key);
			assert.deepEqual(
				issues_of(Numbers, { a: 'x', [key]: 'x' }).map((i) => i.path),
				[[key]]
			);
			const output = s.parse_or_throw(Defaulted, { [key]: 1, a: 'x' });
			assert.deepEqual(keys_of(output), ['a', 'd', key]);
			// and on an input that inherits from something else
			for (const proto of [null, {}]) {
				const make = (v: unknown) => Object.assign(Object.create(proto), { a: 'x', [key]: v });
				assert(!s.is(Numbers, make('not a number')), key);
				assert.deepEqual(keys_of(s.parse_or_throw(Defaulted, make(1))), ['a', 'd', key]);
			}
		}
	});

	test('an own __proto__ key is left out and not validated', () => {
		for (const text of [
			'{"a": "x", "__proto__": "not a number", "z": 1}',
			'{"__proto__": {"p": 1}, "a": "x", "z": 1}',
			'{"a": "x", "z": 1, "__proto__": 1}'
		]) {
			const input = JSON.parse(text);
			assert(s.is(Numbers, input), text);
			// a copy, though nothing else changed
			const output: object = s.parse_or_throw(Numbers, input);
			assert.notStrictEqual(output, input);
			assert.deepEqual(keys_of(output), ['a', 'z']);
			assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
			assert(Object.hasOwn(input, '__proto__'));
		}
		// with a rest key after it that changes, and one before it
		const after = s.parse_or_throw(Upper, JSON.parse('{"a": "x", "__proto__": 1, "z": "z"}'));
		assert.deepEqual(keys_of(after), ['a', 'z']);
		assert.deepEqual(after, { a: 'x', z: 'Z' });
		const before = s.parse_or_throw(Upper, JSON.parse('{"y": "y", "a": "x", "__proto__": 1}'));
		assert.deepEqual(keys_of(before), ['a', 'y']);
		assert.deepEqual(before, { a: 'x', y: 'Y' });
		assert.strictEqual(({} as any).p, undefined);
	});

	test('an entry named __proto__ is run and written as the other object schemas do', () => {
		const O = s.object_with_rest(
			{ a: s.string, ['__proto__']: s.unknown, d: s.with_default(s.string, 'D') },
			s.number
		);
		const output: object = s.parse_or_throw(O, JSON.parse('{"a": "x", "__proto__": {"p": 1}}'));
		// not guarded: the entry's value becomes the copy's prototype
		assert.deepEqual(Object.getPrototypeOf(output), { p: 1 });
		assert.deepEqual(Object.keys(output), ['a', 'd']);
	});

	test('an array is refused, with one issue', () => {
		for (const input of [[], [1], Object.assign(['x'], { a: 'x' })]) {
			assert.deepEqual(issues_of(Numbers, input), [
				{
					kind: 'object_with_rest',
					expected: 'object',
					received: 'array',
					path: [],
					message: undefined
				}
			]);
		}
		assert.deepEqual(issues_of(Numbers, null)[0]!.received, 'null');
	});

	test('rest is handed the value alone, not the object and the key', () => {
		const calls: Array<number> = [];
		const O = s.object_with_rest(
			{},
			s.check((...args: Array<unknown>) => (calls.push(args.length), true))
		);
		assert(s.is(O, { a: 1, b: 2 }));
		assert.deepEqual(calls, [1, 1]);
		// so an `unknown` rest accepts a key whose value is `undefined`
		assert(s.is(s.object_with_rest({}, s.unknown), { a: undefined }));
	});

	test('variant refuses it as an option, in its types, and throws when one is forced', () => {
		const Option = s.object_with_rest({ t: s.literal('a') }, s.number);
		// @ts-expect-error its `def` is not the entries
		assert.throws(() => s.variant('t', [Option]), TypeError);
	});

	test('a failed probe has no output, and a union takes the copy of one that passed', () => {
		const U = s.union([s.object_with_rest({ a: s.number }, upper), Upper]);
		const output: object = s.parse_or_throw(U, { z: 'z', a: 'x' });
		assert.deepEqual(output, { a: 'x', z: 'Z' });
		assert(!s.is(Upper, { a: 'x', z: 1 }));
	});

	test('types', () => {
		type Out = s.Infer<typeof Defaulted>;
		type In = s.InferInput<typeof Defaulted>;
		expectTypeOf<Out['a']>().toEqualTypeOf<string>();
		expectTypeOf<Out['d']>().toEqualTypeOf<string>();
		expectTypeOf<Out['other']>().toEqualTypeOf<number>();
		expectTypeOf<In['d']>().toEqualTypeOf<string | undefined>();
		expectTypeOf<In['other']>().toEqualTypeOf<number>();
		expectTypeOf<Out>().toEqualTypeOf<{ a: string; d: string } & Record<string, number>>();
		expectTypeOf<In>().toEqualTypeOf<
			{ a: string; d?: string | undefined } & Record<string, number>
		>();
		// rest's input and output are apart
		const _Lengths = s.object_with_rest(
			{},
			s.pipe(
				s.string,
				s.transform((v: string) => v.length)
			)
		);
		expectTypeOf<s.Infer<typeof _Lengths>['k']>().toEqualTypeOf<number>();
		expectTypeOf<s.InferInput<typeof _Lengths>['k']>().toEqualTypeOf<string>();
		expectTypeOf(Defaulted.def.rest).toEqualTypeOf(s.number);
	});
});

describe('missing keys', () => {
	const factories = [s.object, s.strip_object, s.loose_object] as const;

	const MISSING_KEY: s.SchemaIssue = {
		kind: 'missing_key',
		expected: 'a required key',
		received: 'undefined',
		path: ['a'],
		message: undefined
	};

	// what a `union` reports when none of its options takes a missing key
	const union_issue = (expected: string, message?: string): s.SchemaIssue => ({
		kind: 'union',
		expected,
		received: 'undefined',
		path: ['a'],
		message
	});

	const passes = s.check(() => true);
	// the same for a value of any type
	const accepts = s.check<any>(() => true);

	// each entry with whether its key may be missing, whether it accepts
	// `undefined`, the output's value at the key when it was missing, and the
	// issue of a missing key where it is not a plain `missing_key`
	const cases: Array<
		[
			name: string,
			entry: s.AnySchema,
			missing: boolean,
			undefined_value: boolean,
			filled?: unknown,
			issue?: s.SchemaIssue
		]
	> = [
		['string', s.string, false, false],
		['nullable', s.nullable(s.string), false, false],
		// `unknown` is handed the object and looks for its key
		['unknown', s.unknown, false, true],
		// as it is where it is the schema itself
		['flavor unknown', s.flavor(s.unknown, 'F'), false, true],
		['brand unknown', s.brand(s.unknown, 'B'), false, true],
		['optional', s.optional(s.string), true, true],
		['optional unknown', s.optional(s.unknown), true, true],
		['with_default', s.with_default(s.string, 'd'), true, true, 'd'],
		['with_default unknown', s.with_default(s.unknown, 'd'), true, true, 'd'],
		['message optional', s.message(s.optional(s.unknown), 'm'), true, true],
		['brand with_default', s.brand(s.with_default(s.string, 'd'), 'B'), true, true, 'd'],
		// `nullable`, `lazy`, `union`, and `pipe` hand what they hold the object
		// too, so an `unknown` under them needs its key
		['nullable unknown', s.nullable(s.unknown), false, true],
		['lazy unknown', s.lazy(() => s.unknown), false, true],
		['pipe of unknown', s.pipe(s.unknown, passes), false, true],
		['pipe of unknown, two actions', s.pipe(s.unknown, passes, passes), false, true],
		[
			'pipe of unknown and a transform',
			s.pipe(
				s.unknown,
				s.transform(() => 'T')
			),
			false,
			true
		],
		// a union with no option that lets the key be missing reports itself
		[
			'union with unknown',
			s.union([s.string, s.unknown]),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		[
			'union of unknown alone',
			s.union([s.unknown]),
			false,
			true,
			undefined,
			union_issue('unknown')
		],
		// one in another
		['nullable lazy unknown', s.nullable(s.lazy(() => s.unknown)), false, true],
		['lazy nullable unknown', s.lazy(() => s.nullable(s.unknown)), false, true],
		['lazy lazy unknown', s.lazy(() => s.lazy(() => s.unknown)), false, true],
		['nullable nullable unknown', s.nullable(s.nullable(s.unknown)), false, true],
		['pipe of nullable unknown', s.pipe(s.nullable(s.unknown), passes), false, true],
		['pipe of a pipe of unknown', s.pipe(s.pipe(s.unknown, passes), passes), false, true],
		[
			'pipe of lazy unknown',
			s.pipe(
				s.lazy(() => s.unknown),
				passes
			),
			false,
			true
		],
		['lazy pipe of unknown', s.lazy(() => s.pipe(s.unknown, passes)), false, true],
		['nullable pipe of unknown', s.nullable(s.pipe(s.unknown, passes)), false, true],
		[
			'nullable union with unknown',
			s.nullable(s.union([s.string, s.unknown])),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		[
			'union with nullable unknown',
			s.union([s.number, s.nullable(s.unknown)]),
			false,
			true,
			undefined,
			union_issue('number | unknown | null')
		],
		[
			'union with lazy unknown',
			s.union([s.number, s.lazy(() => s.unknown)]),
			false,
			true,
			undefined,
			union_issue('number | lazy')
		],
		[
			'union with a pipe of unknown',
			s.union([s.number, s.pipe(s.unknown, passes)]),
			false,
			true,
			undefined,
			union_issue('number | unknown')
		],
		[
			'union with a union with unknown',
			s.union([s.number, s.union([s.string, s.unknown])]),
			false,
			true,
			undefined,
			union_issue('number | string | unknown')
		],
		[
			'pipe of a union with unknown',
			s.pipe(s.union([s.string, s.unknown]), passes),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		// a `message` and a nominal type are the schema they hold
		[
			'message nullable unknown',
			s.message(s.nullable(s.unknown), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'nullable message unknown',
			s.nullable(s.message(s.unknown, 'm')),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message lazy unknown',
			s.message(
				s.lazy(() => s.unknown),
				'm'
			),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message pipe of unknown',
			s.message(s.pipe(s.unknown, passes), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message union with unknown',
			s.message(s.union([s.string, s.unknown]), 'm'),
			false,
			true,
			undefined,
			union_issue('string | unknown', 'm')
		],
		[
			'union with message unknown',
			s.union([s.string, s.message(s.unknown, 'm')]),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		['brand nullable unknown', s.brand(s.nullable(s.unknown), 'B'), false, true],
		['nullable flavor unknown', s.nullable(s.flavor(s.unknown, 'F')), false, true],
		// an `optional` or a `with_default` under any of them lets the key be missing
		['nullable optional', s.nullable(s.optional(s.string)), true, true],
		['nullable optional unknown', s.nullable(s.optional(s.unknown)), true, true],
		['nullable with_default', s.nullable(s.with_default(s.unknown, 'd')), true, true, 'd'],
		['lazy optional', s.lazy(() => s.optional(s.string)), true, true],
		['lazy optional unknown', s.lazy(() => s.optional(s.unknown)), true, true],
		['lazy with_default', s.lazy(() => s.with_default(s.unknown, 'd')), true, true, 'd'],
		['nullable lazy optional', s.nullable(s.lazy(() => s.optional(s.unknown))), true, true],
		['union with an optional', s.union([s.number, s.optional(s.string)]), true, true],
		['union with unknown and an optional', s.union([s.unknown, s.optional(s.string)]), true, true],
		['union with an optional unknown', s.union([s.string, s.optional(s.unknown)]), true, true],
		// the default makes the key optional, and the `unknown` is then the first
		// to match the `undefined` it reads as, so nothing is filled in
		[
			'union with unknown and a with_default',
			s.union([s.unknown, s.with_default(s.string, 'd')]),
			true,
			true
		],
		[
			'union with lazy unknown and a lazy optional',
			s.union([s.lazy(() => s.unknown), s.lazy(() => s.optional(s.string))]),
			true,
			true
		],
		[
			'message union with an optional',
			s.message(s.union([s.unknown, s.optional(s.string)]), 'm'),
			true,
			true
		],
		[
			'pipe of an optional',
			s.pipe(
				s.optional(s.string),
				s.transform((v) => v)
			),
			true,
			true
		],
		['pipe of an optional unknown', s.pipe(s.optional(s.unknown), passes), true, true],
		// a step of a `pipe` after its first is handed neither
		['pipe with unknown as an action', s.pipe(s.optional(s.unknown), s.unknown), true, true],
		// a `literal` of `undefined` and a `one_of` with it look for their key as
		// `unknown` does, as the entry and wherever they are handed the object
		['undefined literal', s.literal(undefined), false, true],
		['one_of with undefined', s.one_of(['x', undefined]), false, true],
		['one_of of undefined alone', s.one_of([undefined]), false, true],
		['flavor undefined literal', s.flavor(s.literal(undefined), 'F'), false, true],
		['brand one_of with undefined', s.brand(s.one_of(['x', undefined]), 'B'), false, true],
		['nullable undefined literal', s.nullable(s.literal(undefined)), false, true],
		['nullable one_of with undefined', s.nullable(s.one_of(['x', undefined])), false, true],
		['lazy undefined literal', s.lazy(() => s.literal(undefined)), false, true],
		['lazy one_of with undefined', s.lazy(() => s.one_of(['x', undefined])), false, true],
		['pipe of an undefined literal', s.pipe(s.literal(undefined), accepts), false, true],
		['pipe of a one_of with undefined', s.pipe(s.one_of(['x', undefined]), accepts), false, true],
		[
			'nullable lazy pipe of an undefined literal',
			s.nullable(s.lazy(() => s.pipe(s.literal(undefined), accepts))),
			false,
			true
		],
		[
			'message undefined literal',
			s.message(s.literal(undefined), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message one_of with undefined',
			s.message(s.one_of(['x', undefined]), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message nullable undefined literal',
			s.message(s.nullable(s.literal(undefined)), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'union with an undefined literal',
			s.union([s.string, s.literal(undefined)]),
			false,
			true,
			undefined,
			union_issue('string | undefined')
		],
		[
			'union with a one_of with undefined',
			s.union([s.number, s.one_of(['x', undefined])]),
			false,
			true,
			undefined,
			union_issue('number | "x" | undefined')
		],
		[
			'union with an undefined literal and unknown',
			s.union([s.literal(undefined), s.unknown]),
			false,
			true,
			undefined,
			union_issue('undefined | unknown')
		],
		// an `optional` or a `with_default` takes the `undefined` first
		['optional undefined literal', s.optional(s.literal(undefined)), true, true],
		['optional one_of with undefined', s.optional(s.one_of(['x', undefined])), true, true],
		[
			'with_default one_of with undefined',
			s.with_default(s.one_of(['x', undefined]), 'x'),
			true,
			true,
			'x'
		],
		[
			'nullable optional undefined literal',
			s.nullable(s.optional(s.literal(undefined))),
			true,
			true
		],
		[
			'union with an undefined literal and an optional',
			s.union([s.literal(undefined), s.optional(s.string)]),
			true,
			true
		],
		// a step of a `pipe` after its first is handed neither
		[
			'pipe with an undefined literal as an action',
			s.pipe(s.optional(s.unknown), s.literal(undefined)),
			true,
			true
		],
		// and these accept `undefined` without looking for the key
		['check', s.check(() => true), true, true],
		['transform', s.transform((v) => v), true, true]
	];

	test('a key may be missing where its entry accepts undefined and reaches no unknown', () => {
		for (const factory of factories) {
			for (const [name, entry, missing, undefined_value, filled, issue] of cases) {
				const O = factory({ a: entry });
				const V = s.variant('kind', [factory({ kind: s.literal('k'), a: entry })]);
				const inputs: Array<[schema: s.AnySchema, input: Record<string, unknown>]> = [
					[O, {}],
					[V, { kind: 'k' }]
				];
				for (const [schema, input] of inputs) {
					const at = `${schema.kind} ${O.kind}: ${name}`;
					const absent = s.parse(schema, input);
					assert.strictEqual(absent.ok, missing, at);
					assert.strictEqual(s.is(schema, input), missing, at);
					const present = s.parse(schema, { ...input, a: undefined });
					assert.strictEqual(present.ok, undefined_value, at);
					assert.strictEqual(s.is(schema, { ...input, a: undefined }), undefined_value, at);
					if (absent.ok) {
						// a key left out stays out, unless a default fills it
						assert.deepEqual(
							absent.value,
							filled === undefined ? input : { ...input, a: filled },
							at
						);
						assert.strictEqual('a' in absent.value, filled !== undefined, at);
					} else if (undefined_value) {
						assert.deepEqual(absent.issues, [issue ?? MISSING_KEY], at);
						// a second parse does as the first did, a `lazy` having been used
						assert.deepEqual(issues_of(schema, input), [issue ?? MISSING_KEY], at);
						assert(!s.is(schema, input), at);
					} else {
						// the schema's own issue, as for an `undefined` value
						assert(!present.ok);
						assert.strictEqual(absent.issues.length, 1, at);
						assert.notStrictEqual(absent.issues[0]!.kind, 'missing_key', at);
						assert.deepEqual(absent.issues, present.issues, at);
					}
				}
			}
		}
	});

	test('unknown leaves the output the input itself, with its key or with it undefined', () => {
		for (const factory of factories) {
			const O = factory({ a: s.optional(s.string), b: s.unknown, c: s.optional(s.unknown) });
			for (const input of [{ b: undefined }, { b: 1 }, { a: 'a', b: null, c: undefined }]) {
				assert.strictEqual(s.parse_or_throw(O, input), input, O.kind);
			}
		}
	});

	test('an inherited or a non-enumerable key is there', () => {
		for (const factory of factories) {
			const O = factory({ a: s.unknown });
			for (const input of [
				Object.create({ a: undefined }),
				Object.defineProperty({}, 'a', { value: undefined, enumerable: false }),
				new (class {
					a = undefined;
				})(),
				new (class {
					get a(): undefined {
						return undefined;
					}
				})()
			]) {
				assert(s.is(O, input), O.kind);
				assert(s.parse(O, input).ok, O.kind);
			}
			// an object with no prototype has only its own
			assert(!s.is(O, Object.create(null)), O.kind);
			assert.deepEqual(issues_of(O, Object.create(null)), [MISSING_KEY], O.kind);
			// and a key named like a member of `Object.prototype` is inherited
			assert(s.is(factory({ toString: s.unknown }), {}), O.kind);
		}
	});

	test('a literal of undefined and a one_of with it need their key, as unknown does', () => {
		const literal_issue: s.SchemaIssue = {
			kind: 'literal',
			expected: 'undefined',
			received: 'string',
			path: ['a'],
			message: undefined
		};
		const one_of_issue: s.SchemaIssue = {
			kind: 'one_of',
			expected: '"x" | undefined',
			received: 'string',
			path: ['a'],
			message: undefined
		};
		for (const factory of factories) {
			const L = factory({ a: s.literal(undefined) });
			const O = factory({ a: s.one_of(['x', undefined]) });
			for (const schema of [L, O]) {
				const at = `${schema.kind}: ${schema.def.a.kind}`;
				// missing
				assert(!s.is(schema, {}), at);
				assert.deepEqual(issues_of(schema, {}), [MISSING_KEY], at);
				assert.strictEqual(
					s.format_issue(issues_of(schema, {})[0]!),
					'a: expected a required key, received undefined',
					at
				);
				assert.deepEqual(s.get_issue_value(issues_of(schema, {})[0]!, {}), {
					ok: true,
					value: undefined
				});
				// an object with no prototype has only its own keys
				assert(!s.is(schema, Object.create(null)), at);
				assert.deepEqual(issues_of(schema, Object.create(null)), [MISSING_KEY], at);
				// there, as its own, inherited, not enumerable, or a getter's: the input comes back
				for (const input of [
					{ a: undefined },
					Object.create({ a: undefined }),
					Object.defineProperty({}, 'a', { value: undefined, enumerable: false }),
					new (class {
						a = undefined;
					})(),
					new (class {
						get a(): undefined {
							return undefined;
						}
					})()
				]) {
					assert(s.is(schema, input), at);
					assert.strictEqual(s.parse_or_throw(schema, input), input, at);
				}
			}
			// another value is the schema's own issue, as it was
			assert(!s.is(L, { a: 'x' }));
			assert.deepEqual(issues_of(L, { a: 'x' }), [literal_issue]);
			assert.deepEqual(issues_of(L, { a: null }), [{ ...literal_issue, received: 'null' }]);
			const present: unknown = { a: 'x' };
			assert.strictEqual(s.parse_or_throw(O, present), present);
			assert(!s.is(O, { a: 'y' }));
			assert.deepEqual(issues_of(O, { a: 'y' }), [one_of_issue]);
			// in the order of the entries, before an unknown key, and a probe builds nothing
			const Three = factory({ a: s.string, b: s.literal(undefined), c: s.one_of([1, undefined]) });
			assert.deepEqual(
				issues_of(Three, { a: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['string', ['a']],
					['missing_key', ['b']],
					['missing_key', ['c']]
				]
			);
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			Three.run({ a: 'a', c: 1 }, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues, undefined);
		}
		// a `message` function is handed the issue and the value the entry was given
		const calls: Array<[kind: string, value: unknown]> = [];
		const Labeled = s.object({
			a: s.message(s.literal(undefined), (issue, value) => {
				calls.push([issue.kind, value]);
				return `no ${issue.kind}`;
			})
		});
		assert.deepEqual(issues_of(Labeled, {}), [{ ...MISSING_KEY, message: 'no missing_key' }]);
		assert.deepEqual(issues_of(Labeled, { a: 1 }), [
			{ ...literal_issue, received: 'number', message: 'no literal' }
		]);
		assert.deepEqual(calls, [
			['missing_key', undefined],
			['literal', 1]
		]);
	});

	test('a one_of needs its key wherever undefined is among its values', () => {
		for (const factory of factories) {
			const First = factory({ a: s.one_of([undefined, 'x']) });
			assert.strictEqual(First.def.a.run.length, 4);
			assert(!s.is(First, {}));
			assert.deepEqual(issues_of(First, {}), [MISSING_KEY]);
			for (const input of [{ a: undefined }, { a: 'x' }]) {
				assert(s.is(First, input));
				assert.strictEqual(s.parse_or_throw(First, input), input);
			}
			assert(!s.is(First, { a: 'y' }));
		}
	});

	test('a literal of undefined and a one_of with it outside an object accept undefined', () => {
		const schemas: Array<[schema: s.AnySchema, input: unknown]> = [
			[s.literal(undefined), undefined],
			[s.one_of(['x', undefined]), undefined],
			[s.array(s.literal(undefined)), [undefined]],
			// a hole, which is no key of the array
			[s.array(s.literal(undefined)), new Array(1)],
			[s.array(s.one_of(['x', undefined])), new Array(1)],
			[s.record(s.literal(undefined)), { a: undefined }],
			[s.record(s.one_of(['x', undefined])), { a: undefined }],
			[s.union([s.string, s.literal(undefined)]), undefined],
			[
				s.pipe(
					s.literal(undefined),
					s.check(() => true)
				),
				undefined
			],
			[s.message(s.one_of(['x', undefined]), 'm'), undefined],
			[s.nullable(s.literal(undefined)), undefined],
			[s.lazy(() => s.literal(undefined)), undefined]
		];
		for (const [schema, input] of schemas) {
			assert(s.is(schema, input), schema.kind);
			const result = s.parse(schema, input);
			assert(result.ok, schema.kind);
			assert.strictEqual(result.value, input, schema.kind);
		}
		// and called as anything but an object schema calls them
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		const bare: Array<s.AnySchema> = [s.literal(undefined), s.one_of([undefined])];
		for (const schema of bare) assert.strictEqual(schema.run(undefined, ctx), undefined);
		assert.strictEqual(ctx.fails, 0);
	});

	test('only a literal of undefined and a one_of with it take the object and the key', () => {
		assert.strictEqual(s.literal(undefined).run.length, 4);
		assert.strictEqual(s.one_of(['x', undefined]).run.length, 4);
		assert.strictEqual(s.one_of([undefined]).run.length, 4);
		// so the schemas that pass them on do around either
		assert.strictEqual(s.nullable(s.literal(undefined)).run.length, 4);
		assert.strictEqual(s.union([s.string, s.one_of(['x', undefined])]).run.length, 4);
		assert.strictEqual(
			s.pipe(
				s.literal(undefined),
				s.check(() => true)
			).run.length,
			4
		);
		// a `message` passes on whether what it holds is the entry itself too
		assert.strictEqual(s.message(s.literal(undefined), 'm').run.length, 5);
		// every other one is called as it was, and so is what holds it
		for (const schema of [
			s.literal('a'),
			s.literal(0),
			s.literal(NaN),
			s.literal(null),
			s.literal(false),
			s.literal(''),
			s.one_of(['x', 'y']),
			s.one_of([null, 0, '', false, NaN]),
			s.one_of([])
		]) {
			assert.strictEqual(schema.run.length, 2, String(schema.def));
			assert.strictEqual(s.nullable(schema).run.length, 2, String(schema.def));
			assert.strictEqual(s.union([s.string, schema]).run.length, 2, String(schema.def));
			assert.strictEqual(
				s.pipe(
					schema,
					s.check(() => true)
				).run.length,
				2,
				String(schema.def)
			);
			assert.strictEqual(s.message(schema, 'm').run.length, 2, String(schema.def));
		}
	});

	test('a variant option whose discriminator is a literal of undefined needs the key', () => {
		for (const factory of factories) {
			const V = s.variant('t', [
				factory({ t: s.literal(undefined), x: s.string }),
				factory({ t: s.literal('b') })
			]);
			// an input without the key selects the option, whose entry then refuses it
			assert(!s.is(V, { x: 'x' }));
			assert.deepEqual(issues_of(V, { x: 'x' }), [{ ...MISSING_KEY, path: ['t'] }]);
			// and the option's other entries run
			assert.deepEqual(
				issues_of(V, { x: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['missing_key', ['t']],
					['string', ['x']]
				]
			);
			// own or inherited, the key is there
			for (const input of [
				{ t: undefined, x: 'x' },
				Object.assign(Object.create({ t: undefined }), { x: 'x' })
			]) {
				assert(s.is(V, input));
				assert.strictEqual(s.parse_or_throw(V, input), input);
			}
			const other: unknown = { t: 'b' };
			assert.strictEqual(s.parse_or_throw(V, other), other);
			// with no such option a missing key is the variant's own issue, as it was
			const W = s.variant('t', [factory({ t: s.literal('a') }), factory({ t: s.literal('b') })]);
			assert.deepEqual(issues_of(W, {}), [
				{
					kind: 'variant',
					expected: '"a" | "b"',
					received: 'undefined',
					path: ['t'],
					message: undefined
				}
			]);
		}
	});

	test('unknown outside an object accepts undefined', () => {
		const schemas: Array<[schema: s.AnySchema, input: unknown]> = [
			[s.unknown, undefined],
			[s.array(s.unknown), [undefined]],
			// a hole, which is no key of the array
			[s.array(s.unknown), new Array(1)],
			[s.record(s.unknown), { a: undefined }],
			[s.union([s.string, s.unknown]), undefined],
			[
				s.pipe(
					s.unknown,
					s.check(() => true)
				),
				undefined
			],
			[s.message(s.unknown, 'm'), undefined],
			[s.optional(s.unknown), undefined],
			[s.nullable(s.unknown), undefined],
			[s.lazy(() => s.unknown), undefined]
		];
		for (const [schema, input] of schemas) {
			assert(s.is(schema, input), schema.kind);
			const result = s.parse(schema, input);
			assert(result.ok, schema.kind);
			assert.strictEqual(result.value, input, schema.kind);
		}
		// and called as anything but an object schema calls it
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		assert.strictEqual(s.unknown.run(undefined, ctx), undefined);
		assert.strictEqual(ctx.fails, 0);
	});

	test('a missing key is reported in the order of the entries, before unknown keys', () => {
		const O = s.object({
			a: s.number,
			b: s.unknown,
			c: s.object({ d: s.unknown, e: s.string }),
			f: s.optional(s.unknown),
			g: s.unknown
		});
		const input = { z: 1, c: { y: 2 }, a: 'x' };
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((issue) => [issue.kind, issue.path]),
			[
				['number', ['a']],
				['missing_key', ['b']],
				['missing_key', ['c', 'd']],
				['string', ['c', 'e']],
				['unknown_key', ['c', 'y']],
				['missing_key', ['g']],
				['unknown_key', ['z']]
			]
		);
		assert.deepEqual(issues[2], { ...MISSING_KEY, path: ['c', 'd'] });
		assert.deepEqual(issues.map(s.format_issue), [
			'a: expected number, received string',
			'b: expected a required key, received undefined',
			'c.d: expected a required key, received undefined',
			'c.e: expected string, received undefined',
			'c.y: expected no unknown keys, received number',
			'g: expected a required key, received undefined',
			'z: expected no unknown keys, received number'
		]);
		// the value of each is found in the input, a missing key's as `undefined`
		assert.deepEqual(
			issues.map((issue) => s.get_issue_value(issue, input)),
			[
				{ ok: true, value: 'x' },
				{ ok: true, value: undefined },
				{ ok: true, value: undefined },
				{ ok: true, value: undefined },
				{ ok: true, value: 2 },
				{ ok: true, value: undefined },
				{ ok: true, value: 1 }
			]
		);
		// and `loose_object` and `strip_object` report the same of their entries
		for (const factory of [s.loose_object, s.strip_object]) {
			const L = factory({ a: s.number, b: s.unknown, c: s.string });
			assert.deepEqual(
				issues_of(L, { a: 'x', z: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['number', ['a']],
					['missing_key', ['b']],
					['string', ['c']]
				]
			);
		}
		// an array's and a record's keys prefix it as they do any issue
		assert.deepEqual(issues_of(s.array(s.record(O)), [{ k: { a: 1, c: { d: 1, e: '' }, g: 1 } }]), [
			{ ...MISSING_KEY, path: [0, 'k', 'b'] }
		]);
	});

	test('a message around the object labels the issue, at any depth', () => {
		for (const factory of factories) {
			const O = factory({ a: s.unknown });
			assert.deepEqual(issues_of(s.message(O, 'object'), {}), [
				{ ...MISSING_KEY, message: 'object' }
			]);
			assert.deepEqual(issues_of(s.message(factory({ o: O }), 'outer'), { o: {} }), [
				{ ...MISSING_KEY, path: ['o', 'a'], message: 'outer' }
			]);
			assert.deepEqual(issues_of(s.message(s.array(s.record(O)), 'outer'), [{ k: {} }]), [
				{ ...MISSING_KEY, path: [0, 'k', 'a'], message: 'outer' }
			]);
			// the entry's own message is the innermost
			assert.deepEqual(issues_of(s.message(factory({ a: s.message(s.unknown, 'a') }), 'o'), {}), [
				{ ...MISSING_KEY, message: 'a' }
			]);
		}
	});

	test('unknown under a message needs its key, and the message labels the issue', () => {
		const calls: Array<[issue: s.SchemaIssue, value: unknown]> = [];
		const entries: Array<[name: string, entry: s.AnySchema, text: string]> = [
			['string', s.message(s.unknown, 'm'), 'm'],
			[
				'function',
				s.message(s.unknown, (issue, value) => {
					calls.push([issue, value]);
					return `no ${issue.kind}`;
				}),
				'no missing_key'
			],
			// the innermost wins, and the outer one passes the object on to it
			['nested', s.message(s.message(s.unknown, 'inner'), 'outer'), 'inner'],
			['flavor', s.message(s.flavor(s.unknown, 'F'), 'm'), 'm'],
			['brand', s.brand(s.message(s.unknown, 'm'), 'B'), 'm']
		];
		for (const factory of factories) {
			for (const [name, entry, text] of entries) {
				const O = factory({ a: entry });
				const at = `${O.kind}: ${name}`;
				assert(!s.is(O, {}), at);
				assert(s.is(O, { a: undefined }), at);
				const input = { a: undefined };
				assert.strictEqual(s.parse_or_throw(O, input), input, at);
				calls.length = 0;
				assert.deepEqual(issues_of(O, {}), [{ ...MISSING_KEY, message: text }], at);
				if (name === 'function') {
					// the issue before its path is prefixed, and the value the entry was given
					assert.strictEqual(calls.length, 1, at);
					assert.strictEqual(calls[0]![1], undefined, at);
					assert.strictEqual(calls[0]![0].kind, 'missing_key', at);
				}
				assert.strictEqual(s.format_issue(issues_of(O, {})[0]!), `a: ${text}`, at);
			}
		}
	});

	test('a message takes the object and the key only around a schema that does', () => {
		assert.strictEqual(s.unknown.run.length, 4);
		// and whether what it holds is the entry itself, which it passes on too
		assert.strictEqual(s.message(s.unknown, 'm').run.length, 5);
		assert.strictEqual(s.message(s.message(s.unknown, 'a'), 'b').run.length, 5);
		// around anything else it is called as it was, with the value alone
		for (const schema of [
			s.string,
			s.optional(s.unknown),
			s.nullable(s.string),
			s.nullable(s.optional(s.unknown)),
			s.union([s.string, s.optional(s.unknown)]),
			s.pipe(s.string, s.min_length(1)),
			s.pipe(s.nullable(s.optional(s.unknown)), s.unknown),
			s.object({ a: s.unknown }),
			s.min_length(1)
		]) {
			assert.strictEqual(schema.run.length, 2, schema.kind);
			assert.strictEqual(s.message(schema, 'm').run.length, 2, schema.kind);
		}
		// and so do the schemas that pass them on, each around one that takes them
		const used = s.lazy(() => s.string);
		s.is(used, '');
		for (const [schema, length] of [
			[s.nullable(s.unknown), 4],
			[s.nullable(s.nullable(s.unknown)), 4],
			[s.union([s.string, s.unknown]), 4],
			[s.union([s.string, s.nullable(s.unknown)]), 4],
			[s.pipe(s.unknown, s.unknown), 4],
			[s.pipe(s.nullable(s.unknown), s.unknown), 4],
			// a `pipe` takes them for itself after an `optional`, which takes neither,
			// and whether it is the entry itself
			[s.pipe(s.optional(s.unknown), s.unknown), 5],
			[s.pipe(s.message(s.optional(s.string), 'm'), accepts), 5],
			[s.pipe(s.pipe(s.optional(s.string), accepts), accepts), 5],
			[s.nullable(s.pipe(s.optional(s.string), accepts)), 4],
			// or around a `lazy`, whatever it defers to and whether it has been used
			[s.nullable(s.lazy(() => s.string)), 4],
			[s.union([s.string, s.lazy(() => s.string)]), 4],
			[
				s.pipe(
					s.lazy(() => s.string),
					s.min_length(1)
				),
				4
			],
			[s.nullable(used), 4]
		] as const) {
			assert.strictEqual(schema.run.length, length, schema.kind);
			assert.strictEqual(s.message(schema, 'm').run.length, 5, schema.kind);
		}
		// a `lazy` itself declares two, and a `message` around one takes them for it
		for (const lazy of [s.lazy(() => s.string), s.lazy(() => s.unknown), used]) {
			assert.strictEqual(lazy.run.length, 2);
			assert.strictEqual(s.message(lazy, 'm').run.length, 5);
		}
		// a consumer's schema that declares them is handed them
		const seen: Array<unknown> = [];
		const Own: s.Schema<unknown, unknown, 'own', undefined> = {
			kind: 'own',
			def: undefined,
			run: (value, _ctx, parent, key) => {
				seen.push(parent, key);
				return value;
			}
		};
		const input = { a: 1 };
		s.parse_or_throw(s.object({ a: s.message(Own, 'm') }), input);
		assert.deepEqual(seen, [input, 'a']);
		assert.strictEqual(seen[0], input);
		// one that declares the object alone is handed it, and a function gets
		// the value that schema was given, not what it returned
		const values: Array<unknown> = [];
		const Refuses: s.Schema<unknown, unknown, 'refuses', undefined> = {
			kind: 'refuses',
			def: undefined,
			run: (value, ctx, parent) => {
				if (parent) s.fail(ctx, 'refuses', value);
				return null;
			}
		};
		assert.strictEqual(Refuses.run.length, 3);
		const Labeled = s.message(Refuses, (_issue, value) => {
			values.push(value);
			return 'm';
		});
		assert.strictEqual(Labeled.run.length, 5);
		assert(s.is(Labeled, 1));
		assert.deepEqual(issues_of(s.object({ a: Labeled }), input), [
			{ kind: 'refuses', expected: 'refuses', received: 'number', path: ['a'], message: 'm' }
		]);
		assert.deepEqual(values, [1]);
	});

	test('a probe counts a missing key and builds nothing', () => {
		let calls = 0;
		const Counted = s.pipe(
			s.unknown,
			s.check(() => {
				calls++;
				return true;
			})
		);
		for (const factory of factories) {
			const O = factory({ a: s.unknown, b: Counted });
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			calls = 0;
			O.run({ b: 1 }, ctx);
			assert.strictEqual(ctx.fails, 1, O.kind);
			assert.strictEqual(ctx.issues, undefined, O.kind);
			// and it is the first failure, where the probe stops
			assert.strictEqual(calls, 0, O.kind);
			// outside a probe every entry runs, and the count is the number of issues.
			// A pipe whose first schema misses its key runs no step after it
			const collect: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			O.run({}, collect);
			assert.strictEqual(calls, 0, O.kind);
			assert.strictEqual(collect.fails, 2, O.kind);
			assert.strictEqual(collect.issues?.length, 2, O.kind);
			O.run({ a: 1, b: undefined }, collect);
			assert.strictEqual(calls, 1, O.kind);
			assert.strictEqual(collect.fails, 2, O.kind);
			// a union probes its options and reports itself
			const U = s.union([O, s.string]);
			assert(!s.is(U, { b: 1 }));
			assert.deepEqual(issues_of(U, { b: 1 }), [
				{
					kind: 'union',
					expected: 'object | string',
					received: 'object',
					path: [],
					message: undefined
				}
			]);
			assert(s.is(U, { a: undefined, b: 1 }));
		}
	});

	test('an entry is handed the object, its key, and 1, and need not take them', () => {
		const seen: Array<Array<unknown>> = [];
		const Spy: s.Schema = {
			kind: 'spy',
			def: undefined,
			run: (...args) => {
				seen.push(args);
				return args[0];
			}
		};
		// a schema written against the first two parameters only
		const Two: s.Schema<string> = {
			kind: 'two',
			def: undefined,
			run: (value, ctx) => (typeof value === 'string' ? value : s.fail(ctx, 'two', value))
		};
		for (const factory of factories) {
			seen.length = 0;
			const O = factory({ a: Spy, b: Two });
			const input = { a: 1, b: 'b' };
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0]!.length, 5);
			assert.strictEqual(seen[0]![2], input);
			assert.strictEqual(seen[0]![3], 'a');
			assert.strictEqual(seen[0]![4], 1);
			assert(!s.is(O, { a: 1 }));
			assert.deepEqual(
				issues_of(O, { a: 1 }).map((issue) => [issue.kind, issue.received, issue.path]),
				[['two', 'undefined', ['b']]]
			);
		}
		// a `run` that declares neither is handed neither by a schema that holds it
		for (const schema of [
			s.array(Spy),
			s.record(Spy),
			s.union([Spy]),
			s.optional(Spy),
			s.nullable(Spy),
			s.with_default(Spy, 1),
			s.message(Spy, 'm'),
			s.pipe(
				Spy,
				s.check(() => true)
			)
		]) {
			for (const factory of factories) {
				seen.length = 0;
				s.parse(factory({ a: schema }), { a: schema.kind === 'record' ? { k: 1 } : [1] });
				assert.strictEqual(seen.length, 1, schema.kind);
				assert.strictEqual(seen[0]!.length, 2, schema.kind);
			}
		}
		// but by a `lazy`, which is the schema it defers to, with the object and
		// the key and not the `1`: what it defers to is not the entry itself
		const deferred = s.lazy(() => Spy);
		for (const factory of factories) {
			seen.length = 0;
			const input = { a: 1 };
			s.parse(factory({ a: deferred }), input);
			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0]!.length, 4);
			assert.strictEqual(seen[0]![2], input);
			assert.strictEqual(seen[0]![3], 'a');
		}
	});

	test('a schema that passes the object on hands it to a run that declares it', () => {
		const seen: Array<Array<unknown>> = [];
		const Keyed: s.Schema = {
			kind: 'keyed',
			def: undefined,
			run: (value, ctx, parent, key) => {
				seen.push([value, ctx, parent, key]);
				return value;
			}
		};
		const Plain: s.Schema = {
			kind: 'plain',
			def: undefined,
			run: (value, ctx) => s.fail(ctx, 'plain', value)
		};
		const holders: Array<[name: string, schema: s.AnySchema, calls: number]> = [
			['nullable', s.nullable(Keyed), 1],
			['lazy', s.lazy(() => Keyed), 1],
			['message', s.message(Keyed, 'm'), 1],
			// every option is handed them, in order, to the first that matches
			['union', s.union([Plain, Keyed, Keyed]), 1],
			// the first schema of a pipe is, and the steps after it are not
			['pipe', s.pipe(Keyed, Keyed), 2],
			['all of them', s.message(s.nullable(s.lazy(() => s.union([s.pipe(Keyed, passes)]))), 'm'), 1]
		];
		for (const factory of factories) {
			for (const [name, schema, calls] of holders) {
				const input = { a: 1 };
				for (const parse of [s.parse, s.is]) {
					seen.length = 0;
					parse(factory({ a: schema }), input);
					const at = `${factory({}).kind}: ${name}`;
					assert.strictEqual(seen.length, calls, at);
					assert.strictEqual(seen[0]![2], input, at);
					assert.strictEqual(seen[0]![3], 'a', at);
					if (calls > 1) assert.deepEqual(seen[1]!.slice(2), [undefined, undefined], at);
				}
				// and neither outside an object
				seen.length = 0;
				s.parse(schema, 1);
				assert.deepEqual(seen[0]!.slice(2), [undefined, undefined], name);
			}
		}
	});

	test('a pipe whose first schema misses its key runs no step after it', () => {
		for (const factory of factories) {
			let calls = 0;
			const counted = s.check(() => {
				calls++;
				return true;
			});
			const mapped = s.transform(() => {
				calls++;
				return 'T';
			});
			for (const head of [s.unknown, s.nullable(s.unknown), s.lazy(() => s.unknown)]) {
				const O = factory({ a: s.pipe(head, counted, mapped) });
				for (let i = 0; i < 2; i++) {
					calls = 0;
					assert(!s.is(O, {}), head.kind);
					assert.deepEqual(issues_of(O, {}), [MISSING_KEY], head.kind);
					assert.strictEqual(calls, 0, head.kind);
					// with the key there every step runs, on `undefined` too
					assert.deepEqual(s.parse_or_throw(O, { a: undefined }), { a: 'T' }, head.kind);
					assert.strictEqual(calls, 2, head.kind);
					assert.deepEqual(s.parse_or_throw(O, { a: 1 }), { a: 'T' }, head.kind);
				}
			}
		}
	});

	describe('a pipe whose first schema let a missing key through', () => {
		// a step that fails whatever it is given, one that replaces it, and one
		// that passes it on, each counting its calls
		let calls = 0;
		const refuses = s.check<any>(() => {
			calls++;
			return false;
		}, 'never');
		const mapped = s.transform((v: unknown) => {
			calls++;
			return v ?? 'T';
		});
		const counted = s.check<any>(() => {
			calls++;
			return true;
		});
		const refused: s.SchemaIssue = {
			kind: 'check',
			expected: 'never',
			received: 'undefined',
			path: ['a'],
			message: undefined
		};
		const inherited = (): object => Object.create({ a: undefined });
		const hidden = (): object => Object.defineProperty({}, 'a', { value: undefined });

		// the first schemas a pipe starts with an `optional` by, each made anew
		const stopping: Array<[name: string, make: () => s.AnySchema]> = [
			['optional', () => s.optional(s.string)],
			['optional unknown', () => s.optional(s.unknown)],
			['optional nullable', () => s.optional(s.nullable(s.string))],
			['optional default', () => s.optional(s.with_default(s.string, 'd'))],
			['optional lazy', () => s.optional(s.lazy(() => s.string))],
			['message optional', () => s.message(s.optional(s.string), 'm')],
			['flavor optional', () => s.flavor(s.optional(s.string), 'F')],
			['brand optional', () => s.brand(s.optional(s.string), 'B')],
			['meta optional', () => meta(s.optional(s.string), { description: 'd' })],
			['pipe of an optional', () => s.pipe(s.optional(s.string), accepts)],
			[
				'pipe of a pipe of an optional',
				() => s.pipe(s.pipe(s.optional(s.string), accepts), accepts)
			],
			['message pipe of an optional', () => s.message(s.pipe(s.optional(s.string), accepts), 'm')],
			['meta pipe of an optional', () => meta(s.pipe(s.optional(s.string), accepts), {})]
		];

		// and the ones that let a missing key through without being one
		const passing: Array<[name: string, make: () => s.AnySchema]> = [
			['nullable optional', () => s.nullable(s.optional(s.string))],
			['lazy optional', () => s.lazy(() => s.optional(s.string))],
			['lazy lazy optional', () => s.lazy(() => s.lazy(() => s.optional(s.string)))],
			['nullable lazy optional', () => s.nullable(s.lazy(() => s.optional(s.string)))],
			['union with an optional', () => s.union([s.number, s.optional(s.string)])],
			['union with a lazy optional', () => s.union([s.number, s.lazy(() => s.optional(s.string))])],
			['union with an unknown and an optional', () => s.union([s.unknown, s.optional(s.string)])],
			['default of undefined', () => s.with_default(s.optional(s.string), undefined)],
			['check', () => s.check<any>(() => true)],
			['transform', () => s.transform((v: unknown) => v)],
			[
				'pipe of a lazy optional',
				() =>
					s.pipe(
						s.lazy(() => s.optional(s.string)),
						accepts
					)
			],
			['pipe of a nullable optional', () => s.pipe(s.nullable(s.optional(s.string)), accepts)]
		];

		test('runs no step after it, and leaves the key out', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					for (const step of [refuses, mapped, counted]) {
						const O = factory({ a: s.pipe(make(), step) });
						const at = `${factory({}).kind}: ${name}, ${step.kind}`;
						// twice, a `lazy` having its schema by the second
						for (let i = 0; i < 2; i++) {
							calls = 0;
							const input = {};
							assert.strictEqual(s.parse_or_throw(O, input), input, at);
							assert(s.is(O, input), at);
							assert.strictEqual(calls, 0, at);
						}
					}
				}
			}
		});

		test('beside an entry that changes, the key is not in the copy', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					const O = factory({
						d: s.with_default(s.string, 'D'),
						a: s.pipe(make(), mapped),
						e: s.with_default(s.string, 'E')
					});
					// typed with the key, which a `pipe` entry always has in the types
					const output: object = s.parse_or_throw(O, {});
					assert.deepEqual(output, { d: 'D', e: 'E' }, name);
					assert(!('a' in output), name);
				}
			}
		});

		test('runs every step when the key is there, on `undefined` too', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					const at = `${factory({}).kind}: ${name}`;
					const R = factory({ a: s.pipe(make(), refuses) });
					const M = factory({ a: s.pipe(make(), mapped) });
					for (const [input, received] of [
						[{ a: undefined }, 'undefined'],
						[inherited(), 'undefined'],
						[hidden(), 'undefined'],
						[{ a: 'x' }, 'string']
					] as const) {
						calls = 0;
						assert.deepEqual(issues_of(R, input), [{ ...refused, received }], at);
						assert(!s.is(R, input), at);
						assert.strictEqual(calls, 2, at);
					}
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'T' }, at);
					assert.deepEqual(s.parse_or_throw(M, inherited()), { a: 'T' }, at);
					assert.deepEqual(s.parse_or_throw(M, hidden()), { a: 'T' }, at);
					const present = { a: 'x' };
					assert.strictEqual(s.parse_or_throw(M, present), present, at);
				}
			}
		});

		test('a first schema that fills a default has the steps run on it', () => {
			for (const factory of factories) {
				for (const head of [
					s.with_default(s.string, 'd'),
					s.lazy(() => s.with_default(s.string, 'd')),
					s.nullable(s.with_default(s.string, 'd'))
				]) {
					const at = `${factory({}).kind}: ${head.kind}`;
					const R = factory({ a: s.pipe(head, refuses) });
					const M = factory({
						a: s.pipe(
							head,
							s.transform((v) => v + '!')
						)
					});
					for (const input of [{}, { a: undefined }, inherited(), { a: 'x' }]) {
						calls = 0;
						assert.deepEqual(issues_of(R, input), [{ ...refused, received: 'string' }], at);
						assert(!s.is(R, input), at);
						assert.strictEqual(calls, 2, at);
					}
					assert.deepEqual(s.parse_or_throw(M, {}), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, inherited()), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, { a: 'x' }), { a: 'x!' }, at);
				}
			}
		});

		test('after any other schema that let the key through, the steps run on `undefined`', () => {
			for (const factory of factories) {
				for (const [name, make] of passing) {
					const at = `${factory({}).kind}: ${name}`;
					const R = factory({ a: s.pipe(make(), refuses) });
					const M = factory({ a: s.pipe(make(), mapped) });
					// twice, a `lazy` having its schema by the second
					for (let i = 0; i < 2; i++) {
						calls = 0;
						assert.deepEqual(issues_of(R, {}), [refused], at);
						assert(!s.is(R, {}), at);
						assert.strictEqual(calls, 2, at);
						assert.deepEqual(s.parse_or_throw(M, {}), { a: 'T' }, at);
					}
				}
			}
		});

		// a `message` hands it the object, the key, and that it is the entry itself
		test('under a message it runs no step either', () => {
			const wrappers: Array<[name: string, wrap: (schema: s.AnySchema) => s.AnySchema]> = [
				['message', (schema) => s.message(schema, 'm')],
				['message message', (schema) => s.message(s.message(schema, 'a'), 'b')]
			];
			for (const factory of factories) {
				for (const [name, wrap] of wrappers) {
					for (const step of [refuses, mapped] as Array<s.AnySchema>) {
						const O = factory({ a: wrap(s.pipe(s.optional(s.string), step)) });
						const at = `${factory({}).kind}: ${name}, ${step.kind}`;
						for (let i = 0; i < 2; i++) {
							calls = 0;
							const input = {};
							assert.strictEqual(s.parse_or_throw(O, input), input, at);
							assert(s.is(O, input), at);
							assert.strictEqual(calls, 0, at);
						}
						// and every step with the key there
						assert.strictEqual(s.is(O, { a: undefined }), step === mapped, at);
						assert.strictEqual(calls, 1, at);
					}
				}
				// under one that takes `undefined` first, it is never asked
				const D = factory({ a: s.with_default(s.pipe(s.optional(s.string), refuses), 'd') });
				assert.deepEqual(s.parse_or_throw(D, {}), { a: 'd' });
			}
		});

		// a `nullable`, a `lazy`, and a `union` hand it the object and the key, and
		// not that it is the entry itself, so it is a step of the schema that is
		test('under a nullable, a lazy, or a union its steps run on `undefined`', () => {
			// typed as any schema, as the steps above take any value
			const optional_string = (): s.AnySchema => s.optional(s.string);
			const wrappers: Array<
				[name: string, wrap: (schema: s.AnySchema) => s.AnySchema, issue: s.SchemaIssue]
			> = [
				['nullable', (schema) => s.nullable(schema), refused],
				['lazy', (schema) => s.lazy(() => schema), refused],
				['union', (schema) => s.union([s.number, schema]), union_issue('number | string')],
				['nullable lazy', (schema) => s.nullable(s.lazy(() => schema)), refused],
				[
					'message nullable',
					(schema) => s.message(s.nullable(schema), 'm'),
					{ ...refused, message: 'm' }
				],
				[
					'nullable message',
					(schema) => s.nullable(s.message(schema, 'm')),
					{ ...refused, message: 'm' }
				]
			];
			for (const factory of factories) {
				for (const [name, wrap, issue] of wrappers) {
					const R = factory({ a: wrap(s.pipe(optional_string(), refuses)) });
					const M = factory({ a: wrap(s.pipe(optional_string(), mapped)) });
					const at = `${factory({}).kind}: ${name}`;
					// twice, a `lazy` having its schema by the second
					for (let i = 0; i < 2; i++) {
						calls = 0;
						assert.deepEqual(issues_of(R, {}), [issue], at);
						assert(!s.is(R, {}), at);
						assert.strictEqual(calls, 2, at);
						assert.deepEqual(s.parse_or_throw(M, {}), { a: 'T' }, at);
						assert.strictEqual(calls, 3, at);
					}
					// as with the key there
					calls = 0;
					assert(!s.is(R, { a: undefined }), at);
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'T' }, at);
					assert.strictEqual(calls, 2, at);
				}
			}
		});

		// the steps fail the missing key where both zod and valibot refuse it: one
		// fails beside a `transform`, in the pipe or in a pipe around the wrapper
		test('so under those a step that fails beside a transform refuses the missing key', () => {
			const head = (): s.AnySchema =>
				s.pipe(
					s.optional(s.string),
					s.transform((v: string | undefined) => v),
					refuses
				);
			for (const factory of factories) {
				for (const [name, entry] of [
					['nullable', s.nullable(head())],
					['lazy', s.lazy(() => head())],
					['union', s.union([s.number, head()])],
					[
						'nullable then a transform',
						s.pipe(
							s.nullable(s.pipe(s.optional(s.string), refuses)),
							s.transform(() => 'T')
						)
					],
					[
						'lazy then a transform',
						s.pipe(
							s.lazy(() => s.pipe(s.optional(s.string), refuses)),
							s.transform(() => 'T')
						)
					]
				] as const) {
					const O = factory({ a: entry });
					const at = `${factory({}).kind}: ${name}`;
					assert(!s.parse(O, {}).ok, at);
					assert(!s.is(O, {}), at);
				}
			}
		});

		test('outside an object a pipe runs its steps on `undefined`', () => {
			for (const [name, make] of stopping) {
				const R = s.pipe(make(), refuses);
				const M = s.pipe(make(), mapped);
				calls = 0;
				// at the top level
				assert.deepEqual(issues_of(R, undefined), [{ ...refused, path: [] }], name);
				assert(!s.is(R, undefined), name);
				assert.strictEqual(s.parse_or_throw(M, undefined), 'T', name);
				// as an array's item, a hole among them
				// eslint-disable-next-line no-sparse-arrays
				assert.deepEqual(s.parse_or_throw(s.array(M), [undefined, , 'x']), ['T', 'T', 'x'], name);
				assert.deepEqual(issues_of(s.array(R), [undefined]), [{ ...refused, path: [0] }], name);
				// as a record's value
				assert.deepEqual(s.parse_or_throw(s.record(M), { a: undefined }), { a: 'T' }, name);
				// under a wrapper that takes neither the object nor the key
				assert.deepEqual(
					s.parse_or_throw(s.object({ a: s.with_default(M, 'd') }), { a: 'x' }),
					{ a: 'x' },
					name
				);
				// and as a step after the first
				assert.deepEqual(
					s.parse_or_throw(s.object({ a: s.pipe(s.optional(s.string), M) }), { a: undefined }),
					{ a: 'T' },
					name
				);
				assert(calls > 0, name);
			}
		});

		test('a message around it labels nothing for a missing key', () => {
			for (const factory of factories) {
				const O = factory({
					a: s.message(s.pipe(s.optional(s.string), refuses), 'm'),
					b: s.string
				});
				assert.deepEqual(issues_of(O, {}), [
					{
						kind: 'string',
						expected: 'string',
						received: 'undefined',
						path: ['b'],
						message: undefined
					}
				]);
				assert.deepEqual(issues_of(O, { a: undefined, b: '' }), [{ ...refused, message: 'm' }]);
			}
		});

		test('the context is as the first schema left it', () => {
			const O = s.object({ z: s.string, a: s.pipe(s.optional(s.string), refuses) });
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			O.run({}, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues?.length, 1);
			const probe: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			s.object({ a: s.pipe(s.optional(s.string), refuses) }).run({}, probe);
			assert.strictEqual(probe.fails, 0);
			assert.strictEqual(probe.issues, undefined);
		});
	});

	// a declared difference as the entry itself, under a message, and as the first
	// schema of another pipe: zod and valibot write the key as `undefined`
	describe('a pipe that starts with a default leaves a missing key out when its steps give `undefined`', () => {
		const factories = [s.object, s.strip_object, s.loose_object] as const;
		// a default whose steps give `undefined`, each made anew
		const gone = (): s.AnySchema =>
			s.pipe(
				s.with_default(s.string, 'D'),
				s.transform(() => undefined)
			);
		const refuses = s.check<any>(() => false, 'never');

		test('as the entry itself, and in a copy begun by another key', () => {
			for (const factory of factories) {
				const input = {};
				assert.strictEqual(s.parse_or_throw(factory({ a: gone() }), input), input);
				assert.ok(s.is(factory({ a: gone() }), {}));
				// with the key there the input comes back
				const present = { a: undefined };
				assert.strictEqual(s.parse_or_throw(factory({ a: gone() }), present), present);
				const copied = s.parse_or_throw(
					factory({ d: s.with_default(s.string, 'D'), a: gone() }),
					{}
				);
				assert.deepEqual<unknown>(copied, { d: 'D' });
				assert.ok(!Object.hasOwn(copied, 'a'));
			}
		});

		test('under a message, a nullable, a lazy, or a union, and as the first schema of another pipe', () => {
			for (const entry of [
				s.message(gone(), 'm'),
				s.nullable(gone()),
				s.lazy(() => gone()),
				s.union([s.number, gone()]),
				s.pipe(
					gone(),
					s.transform((v: unknown) => v)
				)
			]) {
				const output = s.parse_or_throw(s.object({ a: entry }), {});
				assert.deepEqual<unknown>(output, {});
				assert.ok(!Object.hasOwn(output, 'a'));
			}
		});

		test('a default that its steps keep is written, and a step that fails is reported', () => {
			const kept = s.object({
				a: s.pipe(
					s.with_default(s.string, 'D'),
					s.transform((v: string) => v + '!')
				)
			});
			assert.deepEqual(s.parse_or_throw(kept, {}), { a: 'D!' });
			const failing = s.object({
				a: s.pipe(s.with_default(s.optional(s.string), undefined), refuses)
			});
			assert.deepEqual(
				issues_of(failing, {}).map((issue) => issue.path),
				[['a']]
			);
			assert.ok(!s.is(failing, {}));
		});

		test('outside an object it gives what its steps give', () => {
			assert.strictEqual(s.parse_or_throw(gone(), undefined), undefined);
			assert.deepEqual(s.parse_or_throw(s.array(gone()), [undefined]), [undefined]);
			assert.deepEqual(s.parse_or_throw(s.record(gone()), { a: undefined }), { a: undefined });
		});
	});

	test('a union run again runs an option once more for each enclosing union, and no more', () => {
		for (let depth = 1; depth <= 4; depth++) {
			let calls = 0;
			// takes the object and the key (a `lazy`), runs its transform on a missing
			// key, and fails for another reason, so each union that fills the key in
			// runs it again without the key
			const option = s.pipe(
				s.lazy(() => s.optional(s.string)),
				s.transform((value: string | undefined) => {
					calls++;
					return value;
				}),
				s.check(() => false)
			);
			let schema: s.AnySchema = s.with_default(s.string, 'D');
			for (let i = 0; i < depth; i++) schema = s.union([option, schema]);
			assert.deepEqual(s.parse_or_throw(s.object({ a: schema }), {}), { a: 'D' });
			// once with the key at every depth, and once more as each union retries
			assert.strictEqual(calls, 2 * depth);
		}
	});

	test('a union that matches a missing key with `undefined` tries no option again', () => {
		const U = (): s.AnySchema =>
			s.pipe(
				s.unknown,
				s.transform(() => 'U')
			);
		for (const factory of factories) {
			// the first that matches is the `optional`, though a default follows it
			assert.deepEqual<unknown>(
				s.parse_or_throw(
					factory({ a: s.union([U(), s.optional(s.string), s.with_default(s.string, 'D')]) }),
					{}
				),
				{}
			);
			// an inner union that fills the key in and then matches an option
			// before it with `undefined` gives the outer one `undefined`, and the
			// outer one tries none again, where the same options in one union
			// give `{a: 'U'}`
			const inner = s.union([s.string, s.unknown, s.with_default(s.string, 'D')]);
			assert.deepEqual<unknown>(s.parse_or_throw(factory({ a: s.union([U(), inner]) }), {}), {});
			assert.deepEqual(
				s.parse_or_throw(
					factory({ a: s.union([U(), s.string, s.unknown, s.with_default(s.string, 'D')]) }),
					{}
				),
				{ a: 'U' }
			);
		}
	});

	test('a union tries every option with the key missing, and reports itself', () => {
		for (const factory of factories) {
			const order: Array<string> = [];
			// a spy that takes the object and the key where its schema does
			const spy = (name: string, schema: s.AnySchema): s.AnySchema => ({
				kind: schema.kind,
				def: schema.def,
				run:
					schema.run.length > 2
						? (value, ctx, parent, key) => {
								order.push(name);
								return schema.run(value, ctx, parent, key);
							}
						: (value, ctx) => {
								order.push(name);
								return schema.run(value, ctx);
							}
			});
			const U = s.union([
				spy('string', s.string),
				spy('unknown', s.unknown),
				spy('default', s.with_default(s.unknown, 'd')),
				spy('never', s.unknown)
			]);
			const O = factory({ a: U });
			// the first that lets the key be missing fills it in, which makes it
			// optional, and the options before it that take the object and the key
			// are tried again without them: the first of those that matches gives
			// the output
			const missing = {};
			assert.strictEqual(s.parse_or_throw(O, missing), missing);
			assert.deepEqual(order, ['string', 'unknown', 'default', 'unknown']);
			assert(s.is(O, {}));
			// one that leaves the key `undefined` gives the output, and none is
			// tried again
			order.length = 0;
			const L = factory({
				a: s.union([spy('unknown', s.unknown), spy('optional', s.optional(s.string))])
			});
			const absent = {};
			assert.strictEqual(s.parse_or_throw(L, absent), absent);
			assert.deepEqual(order, ['unknown', 'optional']);
			// with none of those before it, it gives the output itself
			order.length = 0;
			const D = factory({
				a: s.union([spy('string', s.string), spy('default', s.with_default(s.unknown, 'd'))])
			});
			assert.deepEqual(s.parse_or_throw(D, {}), { a: 'd' });
			assert.deepEqual(order, ['string', 'default']);
			// and with the key there, the first that takes the value
			order.length = 0;
			const input = { a: undefined };
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert.deepEqual(order, ['string', 'unknown']);
			// with none, one issue, which is the union's and not an option's
			const N = factory({ a: s.union([s.string, s.unknown, s.nullable(s.unknown)]), b: s.string });
			assert.deepEqual(issues_of(N, { b: 1 }), [
				union_issue('string | unknown | null'),
				{ kind: 'string', expected: 'string', received: 'number', path: ['b'], message: undefined }
			]);
			assert.deepEqual(s.get_issue_value(issues_of(N, {})[0]!, {}), { ok: true, value: undefined });
			// the probe of the options leaves the context as it was
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			N.run({ b: '' }, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues?.length, 1);
			assert.strictEqual(ctx.probe, false);
			// and so does the second try of the options before the one that matched
			const tried: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			factory({
				a: s.union([
					s.pipe(
						s.unknown,
						s.check(() => false)
					),
					s.nullable(s.unknown),
					s.with_default(s.string, 'D')
				])
			}).run({}, tried);
			assert.strictEqual(tried.fails, 0);
			assert.strictEqual(tried.issues, undefined);
			assert.strictEqual(tried.probe, false);
		}
	});

	test('a union whose option needs its key lets no later default fill it in', () => {
		for (const factory of factories) {
			// the pipe runs its step on the `undefined` the missing key reads as
			const U = s.union([
				s.pipe(
					s.unknown,
					s.transform((v: unknown) => (v === undefined ? 'U' : v))
				),
				s.with_default(s.string, 'D')
			]);
			assert.deepEqual(s.parse_or_throw(factory({ a: U }), {}), { a: 'U' });
			// so a check around it refuses the key, as zod and valibot both do
			const Checked = factory({
				a: s.pipe(
					s.union([
						s.pipe(
							s.unknown,
							s.transform((v: unknown) => v)
						),
						s.with_default(s.string, 'D')
					]),
					s.check((v: unknown) => v !== undefined)
				)
			});
			assert(!s.parse(Checked, {}).ok);
			assert(!s.is(Checked, {}));
			assert.deepEqual(s.parse_or_throw(Checked, { a: 'x' }), { a: 'x' });
			// and under a `nullable`, a `lazy`, and a `message`, which pass the object on
			for (const entry of [s.nullable(U), s.lazy(() => U), s.message(U, 'm')]) {
				assert.deepEqual(s.parse_or_throw(factory({ a: entry }), {}), { a: 'U' }, entry.kind);
			}
			// one that fails again without the object leaves the default's value
			const Refused = factory({
				a: s.union([
					s.pipe(
						s.unknown,
						s.check(() => false)
					),
					s.with_default(s.string, 'D')
				])
			});
			assert.deepEqual(s.parse_or_throw(Refused, {}), { a: 'D' });
			// and a `lazy` is tried again too, as it passes the object on
			const Deferred = factory({
				a: s.union([
					s.lazy(() =>
						s.pipe(
							s.unknown,
							s.transform(() => 'U')
						)
					),
					s.with_default(s.string, 'D')
				])
			});
			assert.deepEqual(s.parse_or_throw(Deferred, {}), { a: 'U' });
		}
	});

	test('a union runs each option no more often than it is asked to', () => {
		let transforms = 0;
		const counted = (): s.AnySchema =>
			s.transform((v: unknown) => {
				transforms++;
				return v;
			});
		const runs: Record<string, number> = {};
		// counts the calls of a schema's `run`, taking the object and the key where it does
		const spy = (name: string, schema: s.AnySchema): s.AnySchema => ({
			kind: schema.kind,
			def: schema.def,
			run:
				schema.run.length > 2
					? (value, ctx, parent, key) => {
							runs[name] = (runs[name] ?? 0) + 1;
							return schema.run(value, ctx, parent, key);
						}
					: (value, ctx) => {
							runs[name] = (runs[name] ?? 0) + 1;
							return schema.run(value, ctx);
						}
		});
		// each union with the runs of its options and of its transform for a
		// missing key, an `undefined` one, and a string
		const unions: Array<
			[
				name: string,
				make: () => s.AnySchema,
				expected: Array<[runs: Record<string, number>, transforms: number]>
			]
		> = [
			// a pipe that starts with an optional, after an option that refuses `undefined`
			[
				'number, optional then a transform',
				() =>
					s.union([spy('number', s.number), spy('pipe', s.pipe(s.optional(s.string), counted()))]),
				[
					[{ number: 1, pipe: 1 }, 1],
					[{ number: 1, pipe: 1 }, 1],
					[{ number: 1, pipe: 1 }, 1]
				]
			],
			// an option that needs its key before a default that fills it in: the
			// first is run again without the object, and its step runs then
			[
				'unknown then a transform, default',
				() =>
					s.union([
						spy('pipe', s.pipe(s.unknown, counted())),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 2, default: 1 }, 1],
					[{ pipe: 1 }, 1],
					[{ pipe: 1 }, 1]
				]
			],
			// before an optional, which leaves the key `undefined`, none is run again
			[
				'unknown then a transform, optional',
				() =>
					s.union([
						spy('pipe', s.pipe(s.unknown, counted())),
						spy('optional', s.optional(s.string))
					]),
				[
					[{ pipe: 1, optional: 1 }, 0],
					[{ pipe: 1 }, 1],
					[{ pipe: 1 }, 1]
				]
			],
			// an option that takes the object and the key and fails for another
			// reason, before a default: it is run again, and so is its transform,
			// twice in the parse
			[
				'optional then a transform and a check that fails, default',
				() =>
					s.union([
						spy(
							'pipe',
							s.pipe(
								s.optional(s.string),
								counted(),
								s.check(() => false)
							)
						),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 2, default: 1 }, 2],
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1]
				]
			],
			// one that doesn't take them fails the same without them, and isn't
			[
				'a transform and a check that fails, default',
				() =>
					s.union([
						spy(
							'pipe',
							s.pipe(
								counted(),
								s.check(() => false)
							)
						),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1]
				]
			]
		];
		for (const factory of factories) {
			for (const [name, make, expected] of unions) {
				const O = factory({ a: make() });
				const inputs = [{}, { a: undefined }, { a: 'x' }];
				for (let i = 0; i < inputs.length; i++) {
					const at = `${factory({}).kind}: ${name}, ${i}`;
					transforms = 0;
					for (const key of Object.keys(runs)) delete runs[key];
					assert(s.parse(O, inputs[i]).ok, at);
					assert.deepEqual([runs, transforms], expected[i], at);
				}
			}
		}
	});

	describe('lazy', () => {
		// what a lazy defers to, with whether its key may be missing
		const targets: Array<[name: string, make: () => s.AnySchema, missing: boolean]> = [
			['unknown', () => s.unknown, false],
			['nullable unknown', () => s.nullable(s.unknown), false],
			['string', () => s.string, false],
			['optional', () => s.optional(s.unknown), true],
			['with_default', () => s.with_default(s.unknown, undefined), true]
		];

		// a schema around a lazy, which does the same made before the lazy is
		// first used or after
		const around: Array<[name: string, wrap: (schema: s.AnySchema) => s.AnySchema]> = [
			['itself', (schema) => schema],
			['nullable', (schema) => s.nullable(schema)],
			['message', (schema) => s.message(schema, 'm')],
			['pipe', (schema) => s.pipe(schema, passes)],
			['lazy', (schema) => s.lazy(() => schema)],
			['meta', (schema) => meta(schema, { description: 'd' })],
			['brand', (schema) => s.brand(schema, 'B')]
		];

		const assert_entry = (
			O: s.AnySchema,
			missing: boolean,
			accepts_undefined: boolean,
			at: string
		): void => {
			// the first parse and every later one
			for (let i = 0; i < 3; i++) {
				assert.strictEqual(s.is(O, {}), missing, at);
				assert.strictEqual(s.parse(O, {}).ok, missing, at);
				assert.strictEqual(s.is(O, { a: undefined }), accepts_undefined, at);
				assert.strictEqual(s.parse(O, { a: undefined }).ok, accepts_undefined, at);
				assert(s.is(O, { a: 'x' }), at);
				const input = { a: 'x' };
				assert.strictEqual(s.parse_or_throw(O, input), input, at);
			}
		};

		test('needs the key its schema needs, on its first parse and on every later one', () => {
			for (const factory of factories) {
				for (const [target, make, missing] of targets) {
					for (const [name, wrap] of around) {
						const at = `${factory({}).kind}: ${name} around a lazy ${target}`;
						const accepts_undefined = target !== 'string';
						// around a lazy not yet used, whose first use is a missing key
						assert_entry(factory({ a: wrap(s.lazy(make)) }), missing, accepts_undefined, at);
						// around one first used on a value, outside an object
						const warm = s.lazy(make);
						const made = wrap(warm);
						assert(s.is(warm, 'x'), at);
						assert_entry(factory({ a: made }), missing, accepts_undefined, at);
						// and made around one already used
						const used = s.lazy(make);
						assert(s.is(used, 'x'), at);
						assert_entry(factory({ a: wrap(used) }), missing, accepts_undefined, at);
					}
				}
			}
		});

		test('a union made around one before or after its first use does the same', () => {
			for (const factory of factories) {
				for (const [target, make, missing] of targets) {
					const at = `${factory({}).kind}: ${target}`;
					const accepts_undefined = target !== 'string';
					const fresh = s.lazy(make);
					const before = s.union([s.number, fresh]);
					assert_entry(
						factory({ a: s.union([s.number, s.string, fresh]) }),
						missing,
						accepts_undefined,
						at
					);
					assert_entry(factory({ a: before }), missing, accepts_undefined, at);
					// and made after
					assert_entry(
						factory({ a: s.union([s.number, s.string, fresh]) }),
						missing,
						accepts_undefined,
						at
					);
					// a lazy that is itself the entry, first used under a union
					assert_entry(factory({ a: fresh }), missing, accepts_undefined, at);
				}
			}
		});

		test('reports the issue of its schema, at the key', () => {
			for (const factory of factories) {
				const O = factory({
					a: s.lazy(() => s.unknown),
					b: s.lazy(() => s.string),
					c: s.nullable(s.lazy(() => s.unknown)),
					d: s.lazy(() => s.optional(s.string))
				});
				const expected = [
					MISSING_KEY,
					{
						kind: 'string',
						expected: 'string',
						received: 'undefined',
						path: ['b'],
						message: undefined
					},
					{ ...MISSING_KEY, path: ['c'] }
				];
				assert.deepEqual(issues_of(O, {}), expected);
				assert.deepEqual(issues_of(O, {}), expected);
				const input: Record<string, unknown> = { a: undefined, b: '', c: null };
				assert.strictEqual(s.parse_or_throw(O, input), input);
			}
		});

		test('is not written to: its run is the same function before and after use', () => {
			const target = s.object({ a: s.string });
			const L = s.lazy(() => target);
			const first = L.run;
			assert.strictEqual(first.length, 2);
			assert(s.is(L, { a: '' }));
			assert(!s.parse(L, 1).ok);
			assert.strictEqual(L.run, first);
			assert.notStrictEqual(L.run, target.run);
			assert.deepEqual(Object.keys(L), ['kind', 'def', 'run']);
			assert.strictEqual(L.kind, 'lazy');
			assert(s.is_schema(L));
			// one whose first use is a failure
			const F = s.lazy(() => target);
			const failing = F.run;
			assert(!s.parse(F, 1).ok);
			assert.strictEqual(F.run, failing);
		});

		test('a frozen lazy parses, used first when frozen or before', () => {
			for (const factory of factories) {
				const fresh = Object.freeze(s.lazy(() => s.unknown));
				const used = s.lazy(() => s.unknown);
				assert(s.is(used, 1));
				Object.freeze(used);
				for (const L of [fresh, used]) {
					const O = Object.freeze(factory({ a: L, b: Object.freeze(s.nullable(L)) }));
					for (let i = 0; i < 2; i++) {
						assert(s.is(L, 1));
						assert.deepEqual(issues_of(O, {}), [MISSING_KEY, { ...MISSING_KEY, path: ['b'] }]);
						const input = { a: undefined, b: null };
						assert.strictEqual(s.parse_or_throw(O, input), input);
					}
				}
			}
		});

		test('is handed to as a lazy by its kind, and a run of two parameters is not', () => {
			const seen: Array<Array<unknown>> = [];
			const spy = (kind: string): s.Schema => ({
				kind,
				def: undefined,
				run: (...args) => {
					seen.push(args);
					return args[0];
				}
			});
			// each with whether it passes on that what it holds is the entry itself
			const wraps: Array<[wrap: (schema: s.AnySchema) => s.AnySchema, entry: boolean]> = [
				[(schema) => s.nullable(schema), false],
				[(schema) => s.message(schema, 'm'), true],
				[(schema) => s.union([s.string, schema]), false],
				[(schema) => s.pipe(schema, passes), false],
				[(schema) => s.lazy(() => schema), false]
			];
			const input = { a: 1 };
			for (const factory of factories) {
				for (const [wrap, entry] of wraps) {
					// a consumer's schema whose `run` declares neither is handed neither,
					// but under a `lazy`, which passes on what it is given
					seen.length = 0;
					const Own = wrap(spy('own'));
					s.parse(factory({ a: Own }), input);
					assert.strictEqual(seen.length, 1, Own.kind);
					assert.strictEqual(seen[0]!.length, Own.kind === 'lazy' ? 4 : 2, Own.kind);
					// one that calls itself a lazy is handed both by them all
					seen.length = 0;
					const Named = wrap(spy('lazy'));
					s.parse(factory({ a: Named }), input);
					assert.strictEqual(seen.length, 1, Named.kind);
					assert.deepEqual(seen[0]!.slice(2), entry ? [input, 'a', 1] : [input, 'a'], Named.kind);
					// and outside an object a lazy gives its schema the two it was given
					seen.length = 0;
					s.parse(
						s.lazy(() => spy('own')),
						1
					);
					s.parse(s.array(s.lazy(() => spy('own'))), [1]);
					assert.deepEqual(
						seen.map((args) => args.length),
						[2, 2]
					);
				}
			}
		});

		test('calls get once, whatever holds it', () => {
			let calls = 0;
			const make = (): s.AnySchema =>
				s.lazy(() => {
					calls++;
					return s.unknown;
				});
			// used directly
			const direct = make();
			for (let i = 0; i < 3; i++) s.is(direct, 1);
			s.parse(s.object({ a: direct }), {});
			assert.strictEqual(calls, 1);
			// held by schemas made before its first use, each calling it in turn
			calls = 0;
			const held = make();
			const holders = [
				s.nullable(held),
				s.message(held, 'm'),
				s.pipe(held, passes),
				s.union([s.string, held]),
				s.optional(held),
				s.array(held),
				s.lazy(() => held),
				s.object({ a: held })
			];
			assert.strictEqual(calls, 0);
			for (let i = 0; i < 2; i++) {
				for (const holder of holders) {
					s.is(holder, [1]);
					s.parse(holder, { a: 1 });
				}
			}
			assert.strictEqual(calls, 1);
			// a `meta` copy has the lazy's `run`, whenever it is taken, and shares
			// what the lazy got
			calls = 0;
			const original = make();
			const copy = meta(original, { description: 'd' });
			const O = s.object({ a: copy });
			for (let i = 0; i < 3; i++) {
				assert(!s.is(O, {}));
				assert(s.is(O, { a: undefined }));
				assert(s.is(copy, 1));
			}
			assert(s.is(original, 1));
			const later = meta(original, {});
			assert(!s.is(s.object({ a: later }), {}));
			assert(s.is(s.object({ a: later }), { a: undefined }));
			assert.strictEqual(calls, 1);
			assert.strictEqual(copy.run, original.run);
			assert.strictEqual(later.run, original.run);
			assert.deepEqual(get_meta(copy), { description: 'd' });
			// and the function itself, kept by a caller
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			assert.strictEqual(original.run(1, ctx), 1);
			assert.strictEqual(calls, 1);
		});

		test('calls a get that threw again on the next use', () => {
			let calls = 0;
			const L = s.lazy(() => {
				if (calls++ === 0) throw new Error('not yet');
				return s.unknown;
			});
			const O = s.object({ a: s.nullable(L) });
			assert.throws(() => s.is(O, {}), 'not yet');
			assert(!s.is(O, {}));
			assert(s.is(O, { a: undefined }));
			assert.strictEqual(calls, 2);
		});

		test('a lazy of a lazy, and schemas that come back to each other', () => {
			const inner = s.lazy(() => s.unknown);
			const outer = s.lazy(() => inner);
			const O = s.object({ a: outer });
			for (let i = 0; i < 3; i++) {
				assert(!s.is(O, {}));
				assert(s.is(O, { a: undefined }));
				assert.deepEqual(issues_of(O, {}), [MISSING_KEY]);
			}
			interface A {
				value: unknown;
				b?: B;
			}
			interface B {
				value?: unknown;
				a: A | null;
			}
			const A: s.Schema<A> = s.object({ value: s.unknown, b: s.optional(s.lazy(() => B)) });
			const B: s.Schema<B> = s.object({
				value: s.optional(s.unknown),
				a: s.nullable(s.lazy(() => A))
			});
			const input = { value: 1, b: { a: { value: undefined, b: { a: null } } } };
			for (let i = 0; i < 2; i++) {
				assert.strictEqual(s.parse_or_throw(A, input), input);
				assert(s.is(A, input));
				assert.deepEqual(
					issues_of(A, { b: { a: { b: {} } } }).map((issue) => [issue.kind, issue.path]),
					[
						['missing_key', ['value']],
						['missing_key', ['b', 'a', 'value']],
						['object', ['b', 'a', 'b', 'a']]
					]
				);
				assert(!s.is(A, { b: { a: { b: {} } } }));
			}
			// a tree, whose lazy is first used inside its own schema's run
			interface Tree {
				value: unknown;
				children: Array<Tree>;
			}
			const Tree: s.Schema<Tree> = s.object({
				value: s.unknown,
				children: s.array(s.lazy(() => Tree))
			});
			const tree = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] };
			assert.strictEqual(s.parse_or_throw(Tree, tree), tree);
			assert.deepEqual(
				issues_of(Tree, { value: 1, children: [{ children: [{ children: [] }] }] }),
				[
					{ ...MISSING_KEY, path: ['children', 0, 'value'] },
					{ ...MISSING_KEY, path: ['children', 0, 'children', 0, 'value'] }
				]
			);
		});
	});

	test('the input is not changed, and a failed parse has no output to copy', () => {
		for (const factory of factories) {
			const O = factory({ a: s.with_default(s.string, 'd'), b: s.unknown });
			const input = Object.freeze({});
			assert(!s.parse(O, input).ok);
			assert.deepEqual(Object.keys(input), []);
		}
	});
});

describe('context', () => {
	test('a context has no issues until something fails', () => {
		const seen: Array<unknown> = [];
		const Spy: s.Schema = {
			kind: 'spy',
			def: undefined,
			run: (value, ctx) => {
				seen.push(ctx.issues);
				return value;
			}
		};
		assert.isFalse(s.parse(s.object({ a: Spy, b: s.string, c: Spy }), { a: 1, b: 2, c: 3 }).ok);
		assert.strictEqual(seen[0], undefined);
		assert.isArray(seen[1]);
		// a message around a schema that passes, with no issues to look at
		assert.strictEqual(s.parse_or_throw(s.message(s.string, 'no'), 'a'), 'a');
		assert.isTrue(s.is(s.message(s.string, 'no'), 'a'));
	});
});

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

		test('reads an object once for every probe of one parse', () => {
			for (const [name, U] of UNIONS) {
				const M = U([s.object({ x: s.number })]);
				// two options of an outer union probe `M` with the same object
				const schema = s.union([
					s.object({ a: M, z: s.literal(1) }),
					s.object({ a: M, z: s.literal(2) })
				]);
				const reads = { count: 0 };
				const result = s.parse(schema, { a: changing(reads), z: 2 });
				// the second option is handed what the first read
				assert.strictEqual(result.ok, name === 'memo_union', name);
				assert.strictEqual(reads.count, name === 'memo_union' ? 1 : 2, name);
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

		test('a Proxy whose keys change is enumerated once', () => {
			for (const [name, U] of UNIONS) {
				const M = U([s.object({ x: s.number })]);
				const schema = s.union([
					s.object({ a: M, z: s.literal(1) }),
					s.object({ a: M, z: s.literal(2) })
				]);
				let enumerations = 0;
				// an unknown key `y` appears after the first enumeration
				const a = new Proxy(
					{ x: 1, y: 1 },
					{
						ownKeys: () => (enumerations++ ? ['x', 'y'] : ['x']),
						getOwnPropertyDescriptor: (target, key) => Reflect.getOwnPropertyDescriptor(target, key)
					}
				);
				assert.strictEqual(s.is(schema, { a, z: 2 }), name === 'memo_union', name);
				assert.strictEqual(enumerations, name === 'memo_union' ? 1 : 2, name);
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

describe('pipe and actions', () => {
	test('runs actions in order and stops at the first failure', () => {
		const Name = s.pipe(s.string, s.min_length(2), s.max_length(4));
		assert.strictEqual(s.parse_or_throw(Name, 'abc'), 'abc');
		assert.deepEqual(
			issues_of(Name, 'a').map((i) => i.kind),
			['min_length']
		);
		assert.deepEqual(
			issues_of(Name, 1).map((i) => i.kind),
			['string']
		);
	});

	test('number actions', () => {
		const Age = s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150));
		assert(s.is(Age, 36));
		assert(!s.is(Age, 36.5));
		assert(!s.is(Age, -1));
		assert(!s.is(Age, 151));
		assert(!s.is(s.pipe(s.number, s.safe_integer), 2 ** 53));
	});

	test('the expected text is the same on every failure, and each schema has its own', () => {
		for (const [schema, value, expected] of [
			[s.min_length(2), 'a', 'length >= 2'],
			[s.max_length(2), 'abc', 'length <= 2'],
			[s.min_value(0), -1, '>= 0'],
			[s.max_value(10n), 11n, '<= 10'],
			[s.union([s.string, s.number]), true, 'string | number']
		] as const) {
			// first as a probe, which builds no issue
			assert(!s.is(schema, value));
			assert.strictEqual(issues_of(schema, value)[0]!.expected, expected);
			assert.strictEqual(issues_of(schema, value)[0]!.expected, expected);
		}
		for (const [a, b, value, expected_a, expected_b] of [
			[s.min_length(1), s.min_length(3), '', 'length >= 1', 'length >= 3'],
			[s.max_length(1), s.max_length(3), 'abcd', 'length <= 1', 'length <= 3'],
			[s.min_value(1), s.min_value(3), 0, '>= 1', '>= 3'],
			[s.max_value(1), s.max_value(3), 4, '<= 1', '<= 3'],
			[s.union([s.string]), s.union([s.number]), true, 'string', 'number']
		] as const) {
			assert.strictEqual(issues_of(a, value)[0]!.expected, expected_a);
			assert.strictEqual(issues_of(b, value)[0]!.expected, expected_b);
			assert.strictEqual(issues_of(a, value)[0]!.expected, expected_a);
		}
	});

	test('regex, check, transform', () => {
		assert(s.is(s.pipe(s.string, s.regex(/^a/)), 'ab'));
		assert(!s.is(s.pipe(s.string, s.regex(/^a/)), 'ba'));
		const Even = s.pipe(
			s.number,
			s.check((v) => v % 2 === 0, 'an even number')
		);
		assert.strictEqual(issues_of(Even, 3)[0]!.expected, 'an even number');
		const Length = s.pipe(
			s.string,
			s.transform((v) => v.length)
		);
		assert.strictEqual(s.parse_or_throw(Length, 'abc'), 3);
	});

	test('transform ignores the context argument', () => {
		assert.strictEqual(s.parse_or_throw(s.pipe(s.string, s.transform(parseInt)), '11'), 11);
	});

	// KNOWN: an action used as a schema itself, outside a `pipe`, is handed the
	// input unchecked, as its `run` assumes the type a `pipe` gives it. Its type
	// is inferred from what it reads, see `schema.inference.test.ts`, which the
	// input is not checked against. A guard would cost bytes in every action, so
	// these are pinned and not fixed
	test('an action outside a pipe is handed the input unchecked, a known hole', () => {
		// a length action reads `length`, so `parse` and `is` throw on a missing key and on null
		const Entry = s.object({ a: s.min_length(1) });
		assert.throws(() => s.parse(Entry, {}), TypeError);
		assert.throws(() => s.is(Entry, {}), TypeError);
		assert.throws(() => s.parse(Entry, { a: null }), TypeError);
		assert.throws(() => s.parse(s.min_length(1), null), TypeError);
		assert.throws(() => s.parse(s.max_length(1), undefined), TypeError);
		assert.throws(() => s.parse(s.union([s.min_length(1), s.number]), null), TypeError);
		// `RegExp.prototype.test` converts what it is given to a string
		assert(s.is(s.regex(/5/), 5));
		assert(s.is(s.object({ a: s.regex(/5/) }), { a: 5 }));
		// and a value action compares what it is given
		assert(s.is(s.min_value(1), '5'));
		// in a `pipe` each is given only what the schema before it accepts
		assert(!s.is(s.object({ a: s.pipe(s.string, s.min_length(1)) }), {}));
		assert(!s.is(s.pipe(s.string, s.regex(/5/)), 5));
		assert(!s.is(s.pipe(s.number, s.min_value(1)), '5'));
	});
});

describe('message', () => {
	test('labels every issue of the schema it wraps that has no message, at any path', () => {
		const O = s.message(
			s.strip_object({ a: s.message(s.string, 'a must be text'), b: s.number }),
			'not an object'
		);
		assert.deepEqual(
			issues_of(O, { a: 1, b: 'x' }).map((i) => i.message),
			['a must be text', 'not an object']
		);
		assert.deepEqual(
			issues_of(O, null).map((i) => i.message),
			['not an object']
		);
		assert.strictEqual(s.format_issue(issues_of(O, { a: 1, b: 2 })[0]!), 'a: a must be text');
		// only the issues of its own run: an earlier sibling's stay unlabeled
		assert.deepEqual(
			issues_of(s.object({ a: s.string, b: s.message(s.string, 'm') }), { a: 1, b: 1 }).map(
				(i) => i.message
			),
			[undefined, 'm']
		);
	});

	test('wraps actions, takes a function, and the innermost wins', () => {
		const Name = s.message(
			s.pipe(
				s.string,
				s.message(
					s.min_length(2),
					(issue, value) => `too short: ${String(value)} (${issue.received})`
				)
			),
			'bad name'
		);
		assert.strictEqual(issues_of(Name, 'a')[0]!.message, 'too short: a (string)');
		assert.strictEqual(issues_of(Name, 1)[0]!.message, 'bad name');
		assert.strictEqual(s.parse_or_throw(Name, 'ab'), 'ab');
	});

	test('a function is handed the value the wrapped schema was given', () => {
		const seen: Array<unknown> = [];
		const note = (issue: s.SchemaIssue, value: unknown): string => {
			seen.push(value);
			return `${issue.kind} of ${issue.received}`;
		};
		const trim = s.transform((v: string) => v.trim());
		// around an action: the action's input, the output of the steps before it
		const Action = s.pipe(s.string, trim, s.message(s.min_length(2), note));
		assert.strictEqual(issues_of(Action, ' a ')[0]!.message, 'min_length of string');
		assert.deepEqual(seen.splice(0), ['a']);
		// and nothing when it's an earlier step that fails
		assert.strictEqual(issues_of(Action, 1)[0]!.message, undefined);
		assert.deepEqual(seen.splice(0), []);
		// around a whole pipe: the pipe's input, whichever step failed
		const Piped = s.message(s.pipe(s.string, trim, s.min_length(2)), note);
		assert.strictEqual(issues_of(Piped, ' a ')[0]!.message, 'min_length of string');
		assert.strictEqual(issues_of(Piped, 1)[0]!.message, 'string of number');
		assert.deepEqual(seen.splice(0), [' a ', 1]);
		// around an entry: its value, the same object, and `undefined` when missing
		const O = s.object({ a: s.message(s.string, note) });
		const value = { nested: true };
		issues_of(O, { a: value });
		issues_of(O, {});
		assert.strictEqual(seen[0], value);
		assert.deepEqual(seen.splice(0), [value, undefined]);
		// around an object: the object, for its own issue and for its entries'
		issues_of(s.message(O, note), null);
		const input = { a: 1 };
		assert.strictEqual(
			issues_of(s.message(s.object({ a: s.string }), note), input)[0]!.message,
			'string of number'
		);
		assert.deepEqual(seen.splice(0), [null, input]);
		// the path is relative to that value, so the child's value can be found from it
		const Found = s.message(s.object({ a: s.object({ b: s.string }) }), (issue, v) => {
			const found = s.get_issue_value(issue, v);
			return found.ok ? `got ${String(found.value)} at ${issue.path.join('.')}` : 'none';
		});
		const found_issue = issues_of(s.object({ o: Found }), { o: { a: { b: 1 } } })[0]!;
		assert.strictEqual(found_issue.message, 'got 1 at a.b');
		assert.deepEqual(found_issue.path, ['o', 'a', 'b']);
		// never for a value that matches, or when only whether it matches is asked
		assert(s.is(Piped, 'ab'));
		assert(!s.is(Piped, 1));
		assert(!s.is(s.union([Piped, s.number]), true));
		s.parse_or_throw(Piped, 'ab');
		assert.deepEqual(seen, []);
		// the text is the function's, so the value is in the issue only if it put it there
		const Echo = s.message(s.string, (_issue, v) => `got ${String(v)}`);
		assert.strictEqual(issues_of(Echo, 1)[0]!.message, 'got 1');
		s.message(s.string, (issue, v) => {
			expectTypeOf(issue).toEqualTypeOf<s.SchemaIssue>();
			expectTypeOf(v).toBeUnknown();
			return '';
		});
	});

	test('is transparent to introspection and optional keys', () => {
		const O = s.strip_object({ a: s.message(s.optional(s.string), 'x') });
		assert.strictEqual(O.def.a.kind, 'optional');
		assert.deepEqual(s.parse_or_throw(O, {}), {});
		const V = s.variant('kind', [
			s.message(s.object({ kind: s.literal('a') }), 'x'),
			s.object({ kind: s.literal('b') })
		]);
		assert(s.is(V, { kind: 'a' }));
	});

	test('labels the issues of every kind of child, and leaves a labeled one alone', () => {
		const labeled = (schema: s.AnySchema, value: unknown): Array<[Array<PropertyKey>, unknown]> =>
			issues_of(s.message(schema, 'm'), value).map((i) => [i.path, i.message]);
		const V = s.variant('t', [
			s.object({ t: s.literal('a'), x: s.string }),
			s.object({ t: s.literal('b') })
		]);
		const A = s.object({ a: s.string });
		const cases: Array<
			[name: string, schema: s.AnySchema, value: unknown, path: Array<PropertyKey>]
		> = [
			['object unknown_key', A, { a: '', b: 1 }, ['b']],
			['object entry', A, { a: 1 }, ['a']],
			['strip_object entry', s.strip_object({ a: A }), { a: { a: 1 } }, ['a', 'a']],
			['loose_object entry', s.loose_object({ a: s.string }), { a: 1 }, ['a']],
			[
				'object_with_rest rest',
				s.object_with_rest({ a: s.string }, s.number),
				{ a: '', b: '' },
				['b']
			],
			['record value', s.record(s.number), { k: '' }, ['k']],
			['array item', s.array(s.number), [0, ''], [1]],
			['variant discriminator', V, { t: 'z' }, ['t']],
			['variant missing discriminator', V, {}, ['t']],
			['variant option entry', V, { t: 'a', x: 1 }, ['x']],
			['variant option unknown_key', V, { t: 'b', q: 1 }, ['q']],
			[
				'pipe',
				s.pipe(
					A,
					s.check(() => true)
				),
				{ a: 1 },
				['a']
			],
			['lazy', s.lazy(() => A), { a: 1 }, ['a']],
			['nullable', s.nullable(A), { a: 1 }, ['a']],
			['optional', s.optional(A), { a: 1 }, ['a']],
			['with_default', s.with_default(A, { a: '' }), { a: 1 }, ['a']],
			// a failed union is one issue, its own: its options are only probed
			['union', s.union([s.string, A]), { a: 1 }, []]
		];
		for (const [name, schema, value, path] of cases) {
			assert.deepEqual(labeled(schema, value), [[path, 'm']], name);
		}
		// the innermost wins, around the child and around the whole
		assert.deepEqual(
			labeled(s.object({ a: s.message(s.string, 'inner'), b: s.number }), { a: 1, b: '' }),
			[
				[['a'], 'inner'],
				[['b'], 'm']
			]
		);
		assert.deepEqual(
			issues_of(s.message(s.message(A, 'inner'), 'outer'), { a: 1, b: 1 }).map((i) => i.message),
			['inner', 'inner']
		);
		// an outer function is not called for an issue an inner message labeled
		let calls = 0;
		const Counted = s.message(s.object({ a: s.message(s.string, 'inner'), b: s.number }), () => {
			calls++;
			return 'outer';
		});
		assert.deepEqual(
			issues_of(Counted, { a: 1, b: '' }).map((i) => i.message),
			['inner', 'outer']
		);
		assert.strictEqual(calls, 1);
	});

	test('labels nothing when only whether a value matches is asked', () => {
		const seen: Array<unknown> = [];
		const O = s.message(s.object({ a: s.array(s.string) }), (issue, value) => {
			seen.push(value);
			return issue.kind;
		});
		assert(!s.is(O, { a: [1] }));
		assert(!s.is(O, { a: [], b: 1 }));
		assert(!s.is(s.union([O, s.number]), { a: [1] }));
		assert.deepEqual(seen, []);
		// the issues a parse gives are its own, labeled once
		assert.deepEqual(
			issues_of(O, { a: [1] }).map((i) => [i.path, i.message]),
			[[['a', 0], 'string']]
		);
		assert.strictEqual(seen.length, 1);
	});

	test('a function is handed the input of a wrapper, a union, and a schema that fails twice', () => {
		const seen: Array<unknown> = [];
		const note = (_issue: s.SchemaIssue, value: unknown): string => {
			seen.push(value);
			return 'noted';
		};
		// around a default: the input, and not at all when the default applies
		const Default = s.message(s.with_default(s.string, 'd'), note);
		issues_of(Default, 1);
		assert.strictEqual(s.parse_or_throw(Default, undefined), 'd');
		assert.deepEqual(seen.splice(0), [1]);
		// a default applied by an earlier step is what an action's function sees
		issues_of(s.pipe(s.with_default(s.string, ''), s.message(s.min_length(1), note)), undefined);
		assert.deepEqual(seen.splice(0), ['']);
		// around a union: the value no option took
		issues_of(s.message(s.union([s.string, s.number]), note), true);
		assert.deepEqual(seen.splice(0), [true]);
		// inside a union's option: never, the option is only probed
		issues_of(s.union([s.message(s.string, note), s.number]), true);
		assert.deepEqual(seen.splice(0), []);
		// the innermost function is the one called
		const inner: Array<unknown> = [];
		issues_of(
			s.message(
				s.message(s.string, (_issue, value) => (inner.push(value), 'inner')),
				note
			),
			1
		);
		assert.deepEqual([inner, seen.splice(0)], [[1], []]);
		// a schema reporting two issues of its own: called for each, with the one value
		const Twice: s.Schema = {
			kind: 'twice',
			def: undefined,
			run: (value, ctx) => s.fail(ctx, 'twice', s.fail(ctx, 'twice', value))
		};
		const value = { a: 1 };
		assert.strictEqual(issues_of(s.message(Twice, note), value).length, 2);
		assert.strictEqual(seen[0], value);
		assert.strictEqual(seen[1], value);
	});
});

describe('def', () => {
	const Circle = s.object({ kind: s.literal('circle'), radius: s.number });
	const lazy_get = (): typeof s.string => s.string;
	const check_fn = (v: number): boolean => v > 0;
	const transform_fn = (v: string): number => v.length;
	const pattern = /^a/;
	const entries = { a: s.string, b: s.optional(s.number) };
	const values = ['a', 1, null] as const;
	const options = [s.string, s.number] as const;
	const step = s.min_length<string>(1);
	const make = (): string => 'm';

	// one schema of every kind, which fails to compile when a kind is missing
	// or a schema is not what the contract says its kind is
	const by_kind: { [K in s.SchemaKind]: s.SchemaNode<K> } = {
		string: s.string,
		number: s.number,
		boolean: s.boolean,
		bigint: s.bigint,
		unknown: s.unknown,
		literal: s.literal('a'),
		one_of: s.one_of(values),
		optional: s.optional(s.string),
		nullable: s.nullable(s.string),
		with_default: s.with_default(s.string, 'd'),
		with_default_fn: s.with_default_fn(s.string, make),
		lazy: s.lazy(lazy_get),
		object: s.object(entries),
		loose_object: s.loose_object(entries),
		strip_object: s.strip_object(entries),
		object_with_rest: s.object_with_rest(entries, s.number),
		record: s.record(s.string),
		array: s.array(s.string),
		union: s.union(options),
		variant: s.variant('kind', [Circle]),
		pipe: s.pipe(s.string, step),
		min_length: s.min_length(1),
		max_length: s.max_length(2),
		min_value: s.min_value(3),
		max_value: s.max_value(4n),
		integer: s.integer,
		safe_integer: s.safe_integer,
		regex: s.regex(pattern),
		check: s.check(check_fn),
		transform: s.transform(transform_fn)
	};

	test('every schema is kind, def, and run, in that order', () => {
		for (const [kind, schema] of Object.entries(by_kind)) {
			assert.strictEqual(schema.kind, kind);
			assert.deepEqual(Object.keys(schema), ['kind', 'def', 'run']);
		}
	});

	test('every schema the module exports is of a kind the contract has', () => {
		for (const value of Object.values(s)) {
			if (s.is_schema(value)) assert.strictEqual(by_kind[value.kind], value);
		}
	});

	test('holds what the contract says for each kind', () => {
		const expected: { [K in s.SchemaKind]: s.SchemaDef<K> } = {
			string: undefined,
			number: undefined,
			boolean: undefined,
			bigint: undefined,
			unknown: undefined,
			literal: 'a',
			one_of: values,
			optional: { schema: s.string },
			nullable: { schema: s.string },
			with_default: { schema: s.string, value: 'd' },
			with_default_fn: { schema: s.string, make },
			lazy: lazy_get,
			object: entries,
			loose_object: entries,
			strip_object: entries,
			object_with_rest: { entries, rest: s.number },
			record: s.string,
			array: s.string,
			union: options,
			variant: { key: 'kind', options: [Circle] },
			pipe: [s.string, step],
			min_length: 1,
			max_length: 2,
			min_value: 3,
			max_value: 4n,
			integer: undefined,
			safe_integer: undefined,
			regex: pattern,
			check: check_fn,
			transform: transform_fn
		};
		for (const kind of Object.keys(by_kind) as Array<s.SchemaKind>) {
			assert.deepEqual<unknown>(by_kind[kind].def, expected[kind], kind);
		}
		// what was given is held as it is, not copied
		assert.strictEqual(by_kind.one_of.def, values);
		assert.strictEqual(by_kind.object.def, entries);
		assert.strictEqual(by_kind.union.def, options);
		assert.strictEqual(by_kind.variant.def.options[0], Circle);
		assert.strictEqual(by_kind.lazy.def, lazy_get);
		assert.strictEqual(by_kind.regex.def, pattern);
		assert.strictEqual(by_kind.check.def, check_fn);
		assert.strictEqual(by_kind.transform.def, transform_fn);
		assert.strictEqual(by_kind.with_default_fn.def.make, make);
		assert.strictEqual(by_kind.object_with_rest.def.entries, entries);
		assert.deepEqual(Object.keys(by_kind.object_with_rest.def), ['entries', 'rest']);
	});

	test('a wrapper holds its schema under one key', () => {
		for (const kind of ['optional', 'nullable', 'with_default', 'with_default_fn'] as const) {
			assert.strictEqual(by_kind[kind].def.schema, s.string);
		}
		assert.deepEqual(Object.keys(by_kind.optional.def), ['schema']);
		assert.deepEqual(Object.keys(by_kind.nullable.def), ['schema']);
		assert.deepEqual(Object.keys(by_kind.with_default.def), ['schema', 'value']);
		assert.deepEqual(Object.keys(by_kind.with_default_fn.def), ['schema', 'make']);
		// each wrapper has a def of its own
		assert.notStrictEqual(s.optional(s.string).def, s.optional(s.string).def);
	});

	test('message, flavor, and brand keep the kind and def of their schema', () => {
		const schemas: Array<s.AnySchema> = Object.values(by_kind);
		for (const schema of schemas) {
			const labeled = s.message(schema, 'x');
			assert.notStrictEqual(labeled, schema);
			assert.strictEqual(labeled.kind, schema.kind);
			assert.strictEqual(labeled.def, schema.def);
			assert.deepEqual(Object.keys(labeled), ['kind', 'def', 'run']);
			assert.strictEqual(s.flavor(schema, 'F'), schema);
			assert.strictEqual(s.brand(schema, 'B'), schema);
		}
	});

	test('variant finds its literals through message, flavor, and brand', () => {
		const V = s.variant('kind', [
			s.message(s.object({ kind: s.message(s.literal('a'), 'x'), n: s.number }), 'y'),
			s.strip_object({ kind: s.flavor(s.literal('b'), 'B') }),
			s.loose_object({ kind: s.brand(s.literal(3), 'C') })
		]);
		assert(s.is(V, { kind: 'a', n: 1 }));
		assert(s.is(V, { kind: 'b' }));
		assert(s.is(V, { kind: 3, extra: 1 }));
		assert.strictEqual(issues_of(V, { kind: 'z' })[0]!.expected, '"a" | "b" | 3');
		assert.deepEqual(V.def.key, 'kind');
		assert.strictEqual(V.def.options.length, 3);
	});

	test('kind narrows def, through a recursive schema, with no cast', () => {
		// every kind under `schema`, each schema counted once
		const kinds_of = (schema: s.SchemaNode, seen: Set<s.SchemaNode> = new Set()): Array<string> => {
			if (seen.has(schema)) return [];
			seen.add(schema);
			const children = (): Array<s.SchemaNode> => {
				switch (schema.kind) {
					case 'optional':
					case 'nullable':
					case 'with_default':
						return [schema.def.schema];
					case 'lazy':
						return [schema.def()];
					case 'object':
					case 'loose_object':
					case 'strip_object':
						return Object.values(schema.def);
					case 'object_with_rest':
						return [...Object.values(schema.def.entries), schema.def.rest];
					case 'record':
					case 'array':
						return [schema.def];
					case 'union':
					case 'pipe':
						return [...schema.def];
					case 'variant':
						return [...schema.def.options];
					default:
						return [];
				}
			};
			return [schema.kind, ...children().flatMap((child) => kinds_of(child, seen))];
		};
		assert.deepEqual(kinds_of(s.array(s.optional(s.with_default(s.nullable(s.string), null)))), [
			'array',
			'optional',
			'with_default',
			'nullable',
			'string'
		]);
		// a schema typed as a bare `Schema` gets in through `is_schema`
		interface Tree {
			kind: 'leaf' | 'branch';
			children?: Array<Tree>;
		}
		const Tree: s.Schema<Tree> = s.variant('kind', [
			s.object({ kind: s.literal('leaf') }),
			s.object({
				kind: s.literal('branch'),
				children: s.array(s.lazy(() => Tree))
			})
		]);
		assert(s.is_schema(Tree));
		assert.deepEqual(kinds_of(Tree), [
			'variant',
			'object',
			'literal',
			'object',
			'literal',
			'array',
			'lazy'
		]);
	});
});

describe('is_schema', () => {
	const run = (value: unknown): unknown => value;

	test('accepts every schema and action, wrapped or not', () => {
		for (const value of [
			s.string,
			s.integer,
			s.literal(undefined),
			s.object({ a: s.string }),
			s.optional(s.string),
			s.lazy(() => s.string),
			s.pipe(s.string, s.min_length(1)),
			s.transform((v: string) => v.length),
			s.message(s.string, 'x'),
			s.message(s.optional(s.string), () => 'x'),
			s.flavor(s.string, 'F'),
			s.brand(s.array(s.string), 'B')
		]) {
			assert(s.is_schema(value));
		}
	});

	test('rejects what lacks a string kind, a def, or a run function', () => {
		for (const value of [
			null,
			undefined,
			0,
			'string',
			true,
			Symbol('kind'),
			{},
			[],
			[s.string],
			{ a: s.string },
			{ kind: 'string' },
			{ kind: 'string', def: undefined },
			{ kind: 'string', run },
			{ def: undefined, run },
			{ kind: 1, def: undefined, run },
			{ kind: 'string', def: undefined, run: 'run' },
			{ kind: 'string', def: undefined, run: null },
			// a function is not one, whatever it carries
			run,
			Object.assign(() => 1, { kind: 'string', def: undefined, run }),
			s.optional,
			s.parse(s.string, 'a'),
			s.parse(s.string, 1)
		]) {
			assert(!s.is_schema(value));
		}
	});

	test('is structural: the kind, the def, and extra keys are not checked', () => {
		assert(s.is_schema({ kind: 'string', def: undefined, run }));
		assert(s.is_schema({ kind: 'not_a_kind', def: 1, run }));
		assert(s.is_schema({ kind: 'optional', def: 'not a wrapper', run }));
		assert(s.is_schema({ kind: 'string', def: undefined, run, extra: 1 }));
		assert(s.is_schema({ run, def: undefined, kind: 'string' }));
		assert(s.is_schema(Object.create({ kind: 'string', def: undefined, run })));
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

describe('parse_or_throw', () => {
	test('throws SchemaError listing every issue', () => {
		const O = s.strip_object({ a: s.string, b: s.array(s.number) });
		try {
			s.parse_or_throw(O, { a: 1, b: [1, null] });
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 2);
			assert.strictEqual(
				error.message,
				'a: expected string, received number\nb.1: expected number, received null'
			);
		}
	});
});

describe('issues', () => {
	const SECRET = 'hunter2-do-not-log';

	test('a path is outermost first at any depth, from parse and parse_or_throw', () => {
		const Node: s.AnySchema = s.lazy(() =>
			s.object({ c: s.optional(Node), xs: s.array(s.string) })
		);
		let input: unknown = { xs: [1, 'a', 2] };
		for (let i = 0; i < 50; i++) input = { c: input, xs: [] };
		const deep = Array.from({ length: 50 }, () => 'c');
		const expected = [
			[...deep, 'xs', 0],
			[...deep, 'xs', 2]
		];
		assert.deepEqual(
			issues_of(Node, input).map((i) => i.path),
			expected
		);
		try {
			s.parse_or_throw(Node, input);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.deepEqual(
				error.issues.map((i) => i.path),
				expected
			);
			// the message is written from the paths as they are returned
			assert.strictEqual(error.message, error.issues.map(s.format_issue).join('\n'));
		}
		// a function under the spine is handed the path below it
		const seen: Array<Array<PropertyKey>> = [];
		const Labeled = s.object({
			c: s.message(Node, (issue) => {
				seen.push(issue.path);
				return 'x';
			})
		});
		const labeled = issues_of(Labeled, { c: input });
		assert.deepEqual(seen, expected);
		assert.deepEqual(
			labeled.map((i) => i.path),
			expected.map((path) => ['c', ...path])
		);
	});

	test('a message function is handed a copy of the five fields, which it cannot change', () => {
		const handed: Array<s.SchemaIssue> = [];
		const Labeled = s.object({
			a: s.message(s.object({ b: s.array(s.string) }), (issue) => {
				handed.push(issue);
				issue.path.push('x');
				issue.expected = 'changed';
				return 'm';
			})
		});
		const issues = issues_of(Labeled, { a: { b: ['ok', 1] } });
		assert.strictEqual(handed.length, 1);
		assert.deepEqual(Object.keys(handed[0]!), ['kind', 'expected', 'received', 'path', 'message']);
		assert.notStrictEqual(handed[0], issues[0]);
		assert.deepEqual(issues, [
			{ kind: 'string', expected: 'string', received: 'number', path: ['a', 'b', 1], message: 'm' }
		]);
	});

	// every value reachable through own properties, for checking what a result holds
	const reachable = (root: unknown): Set<unknown> => {
		const seen: Set<unknown> = new Set();
		const visit = (value: unknown): void => {
			if (seen.has(value)) return;
			seen.add(value);
			if (typeof value !== 'object' || value === null) return;
			for (const key of Reflect.ownKeys(value)) visit((value as any)[key]);
		};
		visit(root);
		return seen;
	};

	const failing: Array<[name: string, schema: s.AnySchema, input: unknown]> = [
		['the root', s.number, SECRET],
		['an object root', s.string, { password: SECRET }],
		['an array root', s.string, [SECRET]],
		['an entry', s.object({ password: s.number }), { password: SECRET }],
		['an unknown key', s.object({}), { extra: SECRET }],
		['a record value', s.record(s.number), { a: SECRET }],
		['an array item', s.array(s.number), [SECRET]],
		['a union', s.union([s.number, s.boolean]), SECRET],
		[
			'a variant discriminator',
			s.variant('kind', [s.object({ kind: s.literal('a') })]),
			{
				kind: SECRET
			}
		],
		[
			'a variant option',
			s.variant('kind', [s.object({ kind: s.literal('a'), x: s.number })]),
			{
				kind: 'a',
				x: SECRET
			}
		],
		['a literal', s.literal('x'), SECRET],
		['a one_of', s.one_of(['x', 'y']), SECRET],
		['an action', s.pipe(s.string, s.max_length(3)), SECRET],
		['a regex', s.pipe(s.string, s.regex(/^\d+$/)), SECRET],
		[
			'a check',
			s.pipe(
				s.string,
				s.check((v) => v === 'x')
			),
			SECRET
		],
		[
			'a transformed value',
			s.pipe(
				s.string,
				s.transform((v: string) => v + v),
				s.max_length(3)
			),
			SECRET
		],
		['a wrapper', s.optional(s.nullable(s.with_default(s.number, 0))), SECRET],
		['a lazy schema', s.lazy(() => s.number), SECRET],
		['a schema with a message', s.message(s.number, 'not a number'), SECRET],
		['a strip_object', s.strip_object({ a: s.number }), { a: SECRET, extra: SECRET }],
		['a loose_object', s.loose_object({ a: s.number }), { a: SECRET, extra: SECRET }]
	];

	test('a path is outermost first at every depth, through every container', () => {
		const Leaf = s.variant('t', [
			s.object({ t: s.literal('a'), v: s.string }),
			s.object({ t: s.literal('b'), v: s.number })
		]);
		const Deep = s.object({
			top: s.string,
			list: s.array(s.record(s.strip_object({ inner: s.loose_object({ leaves: s.array(Leaf) }) })))
		});
		const input = {
			top: 1,
			list: [
				1,
				{ k: 1, m: { inner: { leaves: [{ t: 'a', v: 1 }, { t: 'c' }, { t: 'b', v: 'x', w: 1 }] } } }
			]
		};
		assert.deepEqual(
			issues_of(Deep, input).map((i) => [i.kind, i.path]),
			[
				['string', ['top']],
				['record', ['list', 0]],
				['strip_object', ['list', 1, 'k']],
				['string', ['list', 1, 'm', 'inner', 'leaves', 0, 'v']],
				['variant', ['list', 1, 'm', 'inner', 'leaves', 1, 't']],
				['number', ['list', 1, 'm', 'inner', 'leaves', 2, 'v']],
				['unknown_key', ['list', 1, 'm', 'inner', 'leaves', 2, 'w']]
			]
		);
		assert.deepEqual(
			issues_of(s.array(s.array(s.string)), [['a', 1], [2]]).map((i) => i.path),
			[
				[0, 1],
				[1, 0]
			]
		);
		assert.deepEqual(issues_of(s.record(s.string), { a: 1 })[0]!.path, ['a']);
	});

	test('every issue has a path array of its own', () => {
		const O = s.object({
			a: s.string,
			b: s.object({ c: s.string, d: s.array(s.number) }),
			e: s.record(s.string)
		});
		const input = { a: 1, b: { c: 1, d: ['x', 'y'], z: 1 }, e: { f: 1, g: 2 } };
		const expected = [
			['a'],
			['b', 'c'],
			['b', 'd', 0],
			['b', 'd', 1],
			['b', 'z'],
			['e', 'f'],
			['e', 'g']
		];
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((i) => i.path),
			expected
		);
		assert.strictEqual(new Set(issues.map((i) => i.path)).size, issues.length);
		// writing to one path changes no other
		for (const issue of issues) issue.path.push('written');
		assert.deepEqual(
			issues.map((i) => i.path),
			expected.map((path) => [...path, 'written'])
		);
		// the issues at the root too, which no container prefixed
		const [first, second] = [issues_of(s.string, 1)[0]!, issues_of(s.string, 2)[0]!];
		assert.notStrictEqual(first.path, second.path);
		first.path.push('written');
		assert.deepEqual(second.path, []);
	});

	test('a path is replaced as it grows, so one a message function keeps stays empty', () => {
		const kept: Array<Array<PropertyKey>> = [];
		const Leaf = s.message(s.string, (issue) => {
			kept.push(issue.path);
			return 'text';
		});
		const issues = issues_of(s.object({ a: s.array(Leaf) }), { a: [1, 2] });
		assert.deepEqual(
			issues.map((i) => [i.message, i.path]),
			[
				['text', ['a', 0]],
				['text', ['a', 1]]
			]
		);
		assert.deepEqual(kept, [[], []]);
	});

	test('an issue is kind, expected, received, path, and message, in that order', () => {
		for (const [name, schema, input] of failing) {
			for (const issue of issues_of(schema, input)) {
				assert.deepEqual(
					Object.keys(issue),
					['kind', 'expected', 'received', 'path', 'message'],
					name
				);
				assert.typeOf(issue.received, 'string', name);
			}
		}
	});

	test('received names the type of the value that failed', () => {
		const Never = s.literal('never');
		const values: Array<[value: unknown, received: string]> = [
			[null, 'null'],
			[[], 'array'],
			[[1], 'array'],
			[{}, 'object'],
			[new Date(0), 'object'],
			[undefined, 'undefined'],
			['a', 'string'],
			[1, 'number'],
			[-0, 'number'],
			[Number.MAX_VALUE, 'number'],
			[NaN, 'NaN'],
			[Infinity, 'Infinity'],
			[-Infinity, '-Infinity'],
			[Object(NaN), 'object'],
			[true, 'boolean'],
			[1n, 'bigint'],
			[Symbol('a'), 'symbol'],
			[() => 1, 'function']
		];
		for (const [value, received] of values) {
			const issue = issues_of(Never, value)[0]!;
			assert.strictEqual(issue.received, received);
			// `get_issue_value` names types the same way, or it would refuse
			assert.deepEqual(s.get_issue_value(issue, value), { ok: true, value });
		}
		assert.strictEqual(issues_of(s.number, NaN)[0]!.received, 'NaN');
		// a value of another type is refused by its type, a non-finite number by its value
		assert.deepEqual(s.get_issue_value(issues_of(Never, NaN)[0]!, Infinity), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, Infinity)[0]!, -Infinity), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, Infinity)[0]!, 1), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, 1)[0]!, NaN), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, '')[0]!, NaN), { ok: false });
		assert.strictEqual(issues_of(s.object({ a: s.string }), {})[0]!.received, 'undefined');
	});

	test('a number that is not finite is received as String writes it, wherever it fails', () => {
		const cases: Array<[schema: s.AnySchema, value: unknown, text: string]> = [
			[s.string, NaN, 'expected string, received NaN'],
			[s.boolean, Infinity, 'expected boolean, received Infinity'],
			[s.bigint, -Infinity, 'expected bigint, received -Infinity'],
			[s.integer, Infinity, 'expected integer, received Infinity'],
			[s.integer, NaN, 'expected integer, received NaN'],
			[s.safe_integer, -Infinity, 'expected safe_integer, received -Infinity'],
			[s.min_value(0), NaN, 'expected >= 0, received NaN'],
			[s.min_value(0), -Infinity, 'expected >= 0, received -Infinity'],
			[s.max_value(0), Infinity, 'expected <= 0, received Infinity'],
			[s.literal(1), NaN, 'expected 1, received NaN'],
			[s.literal(Infinity), -Infinity, 'expected Infinity, received -Infinity'],
			[s.one_of([1, 'a']), Infinity, 'expected 1 | "a", received Infinity'],
			[s.union([s.string, s.number]), NaN, 'expected string | number, received NaN'],
			[s.array(s.number), [1, NaN], '1: expected number, received NaN'],
			[s.object({ a: s.number }), { a: -Infinity }, 'a: expected number, received -Infinity'],
			[s.record(s.string), { a: Infinity }, 'a: expected string, received Infinity'],
			[s.array(s.string), NaN, 'expected array, received NaN'],
			[s.object({}), Infinity, 'expected object, received Infinity'],
			[s.check(() => false, 'finite'), NaN, 'expected finite, received NaN'],
			[
				s.variant('k', [s.object({ k: s.literal('a') })]),
				{ k: NaN },
				'k: expected "a", received NaN'
			],
			[s.pipe(s.number, s.integer), Infinity, 'expected number, received Infinity']
		];
		for (const [schema, value, text] of cases) {
			const issues = issues_of(schema, value);
			assert.deepEqual(issues.map(s.format_issue), [text], text);
			// and the value is read back by it
			assert.deepEqual(s.get_issue_value(issues[0]!, value), {
				ok: true,
				value: issues[0]!.path.reduce((v: any, key) => v[key], value)
			});
		}
		// as Standard Schema writes it too
		const result = to_standard_schema(s.number)['~standard'].validate(-Infinity);
		assert(!(result instanceof Promise) && result.issues);
		assert.strictEqual(result.issues[0]!.message, 'expected number, received -Infinity');
		// a finite number, and a boxed one, are received by their type
		assert.strictEqual(issues_of(s.string, Number.MAX_VALUE)[0]!.received, 'number');
		assert.strictEqual(issues_of(s.string, -Number.MIN_VALUE)[0]!.received, 'number');
		assert.strictEqual(issues_of(s.string, Object(Infinity))[0]!.received, 'object');
	});

	test('nothing in a failed result or a SchemaError holds the input', () => {
		for (const [name, schema, input] of failing) {
			const result = s.parse(schema, input);
			assert(!result.ok, name);
			let error: unknown;
			try {
				s.parse_or_throw(schema, input);
			} catch (thrown) {
				error = thrown;
			}
			assert(error instanceof s.SchemaError, name);
			const texts = [
				JSON.stringify(result),
				JSON.stringify(result.issues),
				result.issues.map(s.format_issue).join('\n'),
				error.message,
				String(error),
				error.stack ?? '',
				JSON.stringify(error),
				inspect(error, { depth: null, showHidden: true, getters: true }),
				inspect(result, { depth: null, showHidden: true, getters: true })
			];
			for (const text of texts) assert.notInclude(text, SECRET, name);
			for (const held of [...reachable(result), ...reachable(error)]) {
				assert.notStrictEqual(held, input, name);
				assert.notStrictEqual(held, SECRET, name);
				if (typeof held === 'string') assert.notInclude(held, SECRET, name);
			}
		}
	});

	test('a path holds the keys the input named', () => {
		const issues = issues_of(s.object({ known: s.record(s.number) }), {
			known: { 'a.b': 'x' },
			'not known': 1
		});
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path]),
			[
				['number', ['known', 'a.b']],
				['unknown_key', ['not known']]
			]
		);
	});

	test('received sees through realms and proxies, and not into objects', () => {
		const Never = s.literal('never');
		const values: Array<[value: unknown, received: string]> = [
			[runInNewContext('[1]'), 'array'],
			[new Proxy([], {}), 'array'],
			[new Proxy({}, {}), 'object'],
			[Object('a'), 'object'],
			[Object.create(null), 'object'],
			[new Map(), 'object'],
			[new Uint8Array(1), 'object'],
			[{ length: 0 }, 'object'],
			[Symbol, 'function']
		];
		for (const [value, received] of values) {
			assert.strictEqual(issues_of(Never, value)[0]!.received, received);
		}
	});

	test('a SchemaError has its issues and nothing else of its own', () => {
		try {
			s.parse_or_throw(s.string, 1);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.deepEqual(
				Reflect.ownKeys(error)
					.map(String)
					.sort((a, b) => a.localeCompare(b)),
				['issues', 'message', 'name', 'stack']
			);
			assert.strictEqual(error.cause, undefined);
		}
	});

	test('a message function can put the value in an issue, and only it can', () => {
		const SECRET = 'hunter2-do-not-log';
		const Quiet = s.object({ password: s.message(s.number, (issue) => `not a ${issue.expected}`) });
		const Loud = s.object({
			password: s.message(s.number, (_issue, value) => `got ${String(value)}`)
		});
		assert.notInclude(JSON.stringify(issues_of(Quiet, { password: SECRET })), SECRET);
		assert.include(JSON.stringify(issues_of(Loud, { password: SECRET })), SECRET);
		const result = to_standard_schema(Loud)['~standard'].validate({ password: SECRET });
		assert.include(JSON.stringify(result), SECRET);
	});
});

describe('format_issue', () => {
	const format_key = (key: string): string =>
		s.format_issue(issues_of(s.record(s.number), JSON.parse(JSON.stringify({ [key]: 'x' })))[0]!);

	test('writes keys of word characters as they are', () => {
		for (const key of ['a', 'a_1', 'A', '_', '0', '12', '__proto__']) {
			assert.strictEqual(format_key(key), `${key}: expected number, received string`);
		}
		const Nested = s.object({ list: s.array(s.object({ id: s.number })) });
		assert.strictEqual(
			s.format_issue(issues_of(Nested, { list: [{ id: 1 }, { id: 'x' }] })[0]!),
			'list.1.id: expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(s.string, 1)[0]!),
			'expected string, received number'
		);
	});

	test('quotes any other key as JSON', () => {
		const quoted: Array<[key: string, text: string]> = [
			['a.b', '"a.b"'],
			['', '""'],
			['a b', '"a b"'],
			['a-b', '"a-b"'],
			['$id', '"$id"'],
			['é', '"é"'],
			['"a"', '"\\"a\\""'],
			['a: expected string, received number', '"a: expected string, received number"'],
			['a\nb', '"a\\nb"'],
			['a\n', '"a\\n"'],
			['\na', '"\\na"'],
			['a\r\nb', '"a\\r\\nb"'],
			['a\\', '"a\\\\"']
		];
		for (const [key, text] of quoted) {
			assert.strictEqual(format_key(key), `${text}: expected number, received string`);
		}
		// a dotted key and a nested one read differently
		const R = s.record(s.record(s.number));
		assert.strictEqual(
			s.format_issue(issues_of(R, { 'a.b': { c: 'x' } })[0]!),
			'"a.b".c: expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(R, { a: { 'b.c': 'x' } })[0]!),
			'a."b.c": expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(R, { a: { b: 'x' } })[0]!),
			'a.b: expected number, received string'
		);
	});

	test('takes any property key', () => {
		const issue: s.SchemaIssue = {
			kind: 'x',
			expected: 'x',
			received: 'string',
			path: [Symbol('s'), 2, 1.5, -1, 'a'],
			message: undefined
		};
		assert.strictEqual(
			s.format_issue(issue),
			'"Symbol(s)".2."1.5"."-1".a: expected x, received string'
		);
	});

	test('a key cannot add a line to a SchemaError', () => {
		const forged = 'a: expected string, received number\nb';
		const input = JSON.parse(JSON.stringify({ [forged]: 1, c: 2 }));
		try {
			s.parse_or_throw(s.object({}), input);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 2);
			assert.deepEqual(error.message.split('\n'), [
				'"a: expected string, received number\\nb": expected no unknown keys, received number',
				'c: expected no unknown keys, received number'
			]);
		}
	});

	test('uses the text set by message as it is', () => {
		const O = s.object({ 'a.b': s.message(s.string, 'line one\nline two') });
		assert.strictEqual(s.format_issue(issues_of(O, {})[0]!), '"a.b": line one\nline two');
	});

	test('an index and a key of the same digits read the same', () => {
		const to_issue = (path: Array<PropertyKey>): s.SchemaIssue => ({
			kind: 'x',
			expected: 'x',
			received: 'string',
			path,
			message: undefined
		});
		assert.strictEqual(s.format_issue(to_issue([0])), s.format_issue(to_issue(['0'])));
	});

	test('quotes a key with a Unicode line or paragraph separator, which JSON leaves as it is', () => {
		// JSON.stringify escapes the C0 controls and not U+2028, U+2029, or U+0085,
		// so such a key is quoted and still holds the character
		for (const separator of ['\u2028', '\u2029', '\u0085']) {
			const key = `a${separator}b`;
			const text = s.format_issue(issues_of(s.record(s.number), { [key]: 'x' })[0]!);
			assert.strictEqual(text, `"${key}": expected number, received string`);
			assert.strictEqual(text.split('\n').length, 1);
		}
	});
});

describe('get_issue_value', () => {
	const NOT_FOUND = { ok: false };

	const value_of = (schema: s.AnySchema, input: unknown, index = 0): unknown =>
		s.get_issue_value(issues_of(schema, input)[index]!, input);

	const to_issue = (path: Array<PropertyKey>, received: string): s.SchemaIssue => ({
		kind: 'x',
		expected: 'x',
		received,
		path,
		message: undefined
	});

	test('finds the root with an empty path', () => {
		assert.deepEqual(value_of(s.string, 1), { ok: true, value: 1 });
		assert.deepEqual(value_of(s.string, undefined), { ok: true, value: undefined });
		assert.deepEqual(value_of(s.string, null), { ok: true, value: null });
		const input = { a: 1 };
		const found = s.get_issue_value(issues_of(s.string, input)[0]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, input);
	});

	test('finds the value of every issue of a parse', () => {
		const O = s.object({
			name: s.string,
			tags: s.array(s.string),
			by_id: s.record(s.object({ n: s.number })),
			shape: s.variant('kind', [s.object({ kind: s.literal('a') })]),
			either: s.union([s.string, s.number])
		});
		const nested = { n: 'x' };
		const either = { not: 'either' };
		const input = {
			name: 1,
			tags: ['a', 2, null],
			by_id: { first: nested, second: { n: 1 } },
			shape: { kind: 'line' },
			either,
			extra: [3]
		};
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((issue) => [issue.path, s.get_issue_value(issue, input)]),
			[
				[['name'], { ok: true, value: 1 }],
				[['tags', 1], { ok: true, value: 2 }],
				[['tags', 2], { ok: true, value: null }],
				[['by_id', 'first', 'n'], { ok: true, value: 'x' }],
				[['shape', 'kind'], { ok: true, value: 'line' }],
				[['either'], { ok: true, value: either }],
				[['extra'], { ok: true, value: [3] }]
			]
		);
		const found = s.get_issue_value(issues[5]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, either);
	});

	test('finds a missing key as undefined, which is what the schema saw', () => {
		const O = s.object({ name: s.string });
		assert.strictEqual(issues_of(O, {})[0]!.received, 'undefined');
		assert.deepEqual(value_of(O, {}), { ok: true, value: undefined });
		assert.deepEqual(value_of(O, { name: undefined }), { ok: true, value: undefined });
		// and one an `unknown` entry needs, whose issue is a `missing_key`
		const U = s.object({ a: s.object({ name: s.unknown }) });
		assert.strictEqual(issues_of(U, { a: {} })[0]!.kind, 'missing_key');
		assert.deepEqual(issues_of(U, { a: {} })[0]!.path, ['a', 'name']);
		assert.deepEqual(value_of(U, { a: {} }), { ok: true, value: undefined });
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		assert.deepEqual(issues_of(V, {})[0]!.path, ['kind']);
		assert.deepEqual(value_of(V, {}), { ok: true, value: undefined });
		// a hole in an array
		assert.deepEqual(value_of(s.array(s.number), new Array(1)), { ok: true, value: undefined });
	});

	test('finds an unknown key by the last element of its path', () => {
		const O = s.object({ a: s.object({}) });
		const input = { a: { extra: 5 } };
		const issue = issues_of(O, input)[0]!;
		assert.strictEqual(issue.kind, 'unknown_key');
		assert.deepEqual(issue.path, ['a', 'extra']);
		assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: 5 });
	});

	test('refuses when the path leads through something that is not an object', () => {
		const issue = to_issue(['a', 'b'], 'undefined');
		assert.deepEqual(s.get_issue_value(issue, { a: {} }), { ok: true, value: undefined });
		for (const input of [
			{},
			{ a: undefined },
			{ a: null },
			{ a: 'text' },
			{ a: 1 },
			{ a: () => 1 },
			null,
			undefined,
			'ab',
			1
		]) {
			assert.deepEqual(s.get_issue_value(issue, input), NOT_FOUND);
		}
		// through an array, by index
		assert.deepEqual(s.get_issue_value(to_issue([1, 'b'], 'number'), [{}, { b: 2 }]), {
			ok: true,
			value: 2
		});
		assert.deepEqual(s.get_issue_value(to_issue([2, 'b'], 'undefined'), [{}, { b: 2 }]), NOT_FOUND);
	});

	test('refuses when the value is not of the type the issue received', () => {
		const O = s.object({ a: s.string });
		const issue = issues_of(O, { a: 1 })[0]!;
		for (const input of [{ a: 'x' }, { a: null }, { a: [1] }, { a: { b: 1 } }, {}, { b: 1 }, [1]]) {
			assert.deepEqual(s.get_issue_value(issue, input), NOT_FOUND);
		}
		// a `pipe` step that changed the type before the one that failed
		const Count = s.pipe(
			s.string,
			s.transform((v: string) => Number(v)),
			s.min_value(5)
		);
		assert.strictEqual(issues_of(Count, '1')[0]!.received, 'number');
		assert.deepEqual(value_of(Count, '1'), NOT_FOUND);
		assert.deepEqual(value_of(s.object({ count: Count }), { count: '1' }), NOT_FOUND);
		// a default applied before the step that failed
		const Name = s.pipe(s.with_default(s.string, ''), s.min_length(1));
		assert.deepEqual(value_of(Name, undefined), NOT_FOUND);
		assert.deepEqual(value_of(s.object({ name: Name }), {}), NOT_FOUND);
	});

	test('cannot tell a value from another of the same type', () => {
		// a step that replaced the value with one of its own type: the issue is
		// about the replacement, and what comes back is the input's value
		const Trimmed = s.pipe(
			s.string,
			s.transform((v: string) => v.trim()),
			s.min_length(1)
		);
		assert.deepEqual(value_of(Trimmed, '  '), { ok: true, value: '  ' });
		const Stripped = s.pipe(
			s.strip_object({ a: s.number }),
			s.check((v) => Object.keys(v).length > 1)
		);
		const input = { a: 1, extra: 2 };
		const found = s.get_issue_value(issues_of(Stripped, input)[0]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, input);
		// and an input other than the one parsed
		const issue = issues_of(s.object({ a: s.string }), { a: 1 })[0]!;
		assert.deepEqual(s.get_issue_value(issue, { a: 2 }), { ok: true, value: 2 });
	});

	test('reads own keys only, so an inherited value is never returned', () => {
		// the schema reads through the prototype, and the walk doesn't
		const inherits = Object.create({ a: 1, extra: 2 });
		const issues = issues_of(s.object({ a: s.string }), inherits);
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path, i.received]),
			[
				['string', ['a'], 'number'],
				['unknown_key', ['extra'], 'number']
			]
		);
		for (const issue of issues) assert.deepEqual(s.get_issue_value(issue, inherits), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['toString'], 'function'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['constructor'], 'function'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['length'], 'number'), 'abc'), NOT_FOUND);
		// an own key of an array that is not an index is still its own
		assert.deepEqual(s.get_issue_value(to_issue(['length'], 'number'), [1, 2]), {
			ok: true,
			value: 2
		});
	});

	test('reads a __proto__ key only where the input has one of its own', () => {
		const input = JSON.parse('{"__proto__": 1, "a": {"__proto__": {"b": 2}}}');
		assert.deepEqual(value_of(s.record(s.string), input), { ok: true, value: 1 });
		const unknown = issues_of(s.object({ a: s.unknown }), input)[0]!;
		assert.deepEqual(unknown.path, ['__proto__']);
		assert.deepEqual(s.get_issue_value(unknown, input), { ok: true, value: 1 });
		assert.deepEqual(s.get_issue_value(to_issue(['a', '__proto__', 'b'], 'number'), input), {
			ok: true,
			value: 2
		});
		// an object without one: the schema read `Object.prototype`, and the walk refuses
		const Proto = s.loose_object({ ['__proto__']: s.string });
		const issue = issues_of(Proto, {})[0]!;
		assert.deepEqual([issue.path, issue.received], [['__proto__'], 'object']);
		assert.deepEqual(s.get_issue_value(issue, {}), NOT_FOUND);
		assert.deepEqual(
			s.get_issue_value(to_issue(['__proto__', 'polluted'], 'undefined'), {}),
			NOT_FOUND
		);
		assert.strictEqual(({} as any).polluted, undefined);
	});

	test('takes any property key', () => {
		const sym = Symbol('s');
		assert.deepEqual(s.get_issue_value(to_issue([sym], 'number'), { [sym]: 1 }), {
			ok: true,
			value: 1
		});
		assert.deepEqual(s.get_issue_value(to_issue([sym], 'number'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue([0], 'string'), { 0: 'a' }), {
			ok: true,
			value: 'a'
		});
		assert.deepEqual(s.get_issue_value(to_issue(['0'], 'string'), ['a']), { ok: true, value: 'a' });
		assert.deepEqual(s.get_issue_value(to_issue([1.5], 'string'), { '1.5': 'a' }), {
			ok: true,
			value: 'a'
		});
		assert.deepEqual(s.get_issue_value(to_issue([-1], 'string'), ['a']), NOT_FOUND);
	});

	test('leaves the input alone', () => {
		const input = Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) });
		const before = JSON.stringify(input);
		assert.deepEqual(s.get_issue_value(to_issue(['a', 0, 'b'], 'number'), input), {
			ok: true,
			value: 1
		});
		assert.deepEqual(s.get_issue_value(to_issue(['a', 0, 'c', 'd'], 'number'), input), NOT_FOUND);
		assert.strictEqual(JSON.stringify(input), before);
	});

	test('narrows on ok', () => {
		const found = s.get_issue_value(to_issue([], 'number'), 1);
		expectTypeOf(found).toEqualTypeOf<{ ok: true; value: unknown } | { ok: false }>();
		if (found.ok) expectTypeOf(found.value).toBeUnknown();
		// @ts-expect-error no value without checking `ok`
		assert.strictEqual(found.value, 1);
	});

	test('finds an inherited undefined as undefined, the one inherited read it answers', () => {
		const O = s.object({ a: s.string });
		const input = Object.create({ a: undefined, extra: undefined });
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path, i.received]),
			[
				['string', ['a'], 'undefined'],
				['unknown_key', ['extra'], 'undefined']
			]
		);
		for (const issue of issues) {
			assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: undefined });
		}
	});

	test('refuses a discriminator the variant read through the prototype', () => {
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		const input = Object.create({ kind: 'line' });
		const issue = issues_of(V, input)[0]!;
		assert.deepEqual([issue.path, issue.received], [['kind'], 'string']);
		assert.deepEqual(s.get_issue_value(issue, input), { ok: false });
	});

	test('a found undefined or null is always the value that failed', () => {
		// a replaced value can only be told apart by type, and these types have one value each
		const Replaced = s.pipe(
			s.unknown,
			s.transform(() => ({})),
			s.object({ a: s.string })
		);
		for (const input of [{ b: 1 }, { a: undefined }]) {
			const issue = issues_of(Replaced, input)[0]!;
			assert.strictEqual(issue.received, 'undefined');
			assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: undefined });
		}
		// and where the input has another type there, it refuses
		const present = { a: 'present' };
		assert.deepEqual(s.get_issue_value(issues_of(Replaced, present)[0]!, present), { ok: false });
	});

	test('reads the input again, so a getter runs again', () => {
		let reads = 0;
		const input = {
			get a(): number {
				return reads++;
			}
		};
		const issue = issues_of(s.object({ a: s.string }), input)[0]!;
		assert.strictEqual(reads, 1);
		// the schema saw 0, and the walk reads 1: the input has to be unchanged since
		assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: 1 });
		assert.strictEqual(reads, 2);
	});
});

describe('flavor and brand', () => {
	test('return the schema itself', () => {
		assert.strictEqual(s.flavor(s.string, 'Email'), s.string);
		assert.strictEqual(s.brand(s.string, 'Uuid'), s.string);
	});

	test('parse like the wrapped schema and still report issues', () => {
		const Email = s.flavor(s.pipe(s.string, s.min_length(3)), 'Email');
		const Uuid = s.brand(s.string, 'Uuid');
		assert.deepEqual(s.parse(Email, 'abc'), { ok: true, value: 'abc' });
		const parsed: unknown = s.parse(Uuid, 'x');
		assert.deepEqual(parsed, { ok: true, value: 'x' });
		assert.strictEqual(issues_of(Email, 'a').length, 1);
		assert.strictEqual(issues_of(Uuid, 1).length, 1);
	});
});

describe('types', () => {
	test('infers object output and input', () => {
		const _User = s.strip_object({
			name: s.string,
			age: s.optional(s.number),
			role: s.with_default(s.one_of(['user', 'admin']), 'user'),
			tags: s.array(s.string)
		});
		expectTypeOf<s.Infer<typeof _User>>().toEqualTypeOf<{
			name: string;
			role: 'user' | 'admin';
			tags: Array<string>;
			age?: number | undefined;
		}>();
		expectTypeOf<s.InferInput<typeof _User>>().toEqualTypeOf<{
			name: string;
			tags: Array<string>;
			age?: number | undefined;
			role?: 'user' | 'admin' | undefined;
		}>();
	});

	test('a default made by a function is optional in the input and required in the output', () => {
		const _D = s.with_default_fn(s.array(s.string), () => []);
		expectTypeOf<s.Infer<typeof _D>>().toEqualTypeOf<Array<string>>();
		expectTypeOf<s.InferInput<typeof _D>>().toEqualTypeOf<Array<string> | undefined>();
		const _O = s.object({ tags: _D, name: s.string });
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{ tags: Array<string>; name: string }>();
		expectTypeOf<s.InferInput<typeof _O>>().toEqualTypeOf<{
			name: string;
			tags?: Array<string> | undefined;
		}>();
		// `make` returns the output type
		// @ts-expect-error a number for an array
		s.with_default_fn(s.array(s.string), () => 1);
		// and is called with nothing
		// @ts-expect-error a parameter it is never given
		s.with_default_fn(s.string, (x: string) => x);
	});

	test('a value action keeps the type it is given, whatever its bound', () => {
		const _Age = s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150));
		expectTypeOf<s.Infer<typeof _Age>>().toEqualTypeOf<number>();
		const _Big = s.pipe(s.bigint, s.min_value(0n));
		expectTypeOf<s.Infer<typeof _Big>>().toEqualTypeOf<bigint>();
		const _Meters = s.pipe(s.flavor(s.number, 'Meters'), s.max_value(10));
		expectTypeOf<s.Infer<typeof _Meters>>().toEqualTypeOf<s.Flavored<number, 'Meters'>>();
		// so a default need not be the bound
		const _Retries = s.with_default(s.pipe(s.number, s.min_value(0)), 3);
		expectTypeOf<s.Infer<typeof _Retries>>().toEqualTypeOf<number>();
		// @ts-expect-error a bigint bound on a number
		s.pipe(s.number, s.min_value(0n));
		// outside a `pipe` there is nothing to say which it is
		const _alone = s.max_value(1);
		expectTypeOf<s.Infer<typeof _alone>>().toEqualTypeOf<number | bigint>();
		// as an entry or an option, where the schema around the `pipe` types it as any schema
		const _Entry = s.object({
			age: s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150)),
			name: s.pipe(s.string, s.min_length(1), s.max_length(50))
		});
		expectTypeOf<s.Infer<typeof _Entry>>().toEqualTypeOf<{ age: number; name: string }>();
		const _Option = s.union([s.pipe(s.bigint, s.min_value(0n)), s.string]);
		expectTypeOf<s.Infer<typeof _Option>>().toEqualTypeOf<bigint | string>();
		s.pipe(s.number, s.min_value(0)) satisfies s.SchemaNode;
		// a brand is kept, and takes a plain bound
		const _Id = s.pipe(s.brand(s.number, 'Id'), s.min_value(0));
		expectTypeOf<s.Infer<typeof _Id>>().toEqualTypeOf<s.Branded<number, 'Id'>>();
		// @ts-expect-error a number bound on a bigint
		s.pipe(s.bigint, s.max_value(0));
	});

	test('infers through pipe, union, and variant', () => {
		const _Length = s.pipe(
			s.string,
			s.min_length(1),
			s.transform((v) => v.length)
		);
		expectTypeOf<s.Infer<typeof _Length>>().toEqualTypeOf<number>();
		expectTypeOf<s.InferInput<typeof _Length>>().toEqualTypeOf<string>();

		const _U = s.union([s.string, s.literal(1), s.nullable(s.boolean)]);
		expectTypeOf<s.Infer<typeof _U>>().toEqualTypeOf<string | 1 | boolean | null>();

		const _Shape = s.variant('kind', [
			s.object({ kind: s.literal('circle'), radius: s.number }),
			s.object({ kind: s.literal('square'), size: s.number })
		]);
		expectTypeOf<s.Infer<typeof _Shape>>().toEqualTypeOf<
			{ kind: 'circle'; radius: number } | { kind: 'square'; size: number }
		>();
	});

	test('loose_object types its unknown keys as unknown', () => {
		const _Loose = s.loose_object({ a: s.string, b: s.optional(s.number) });
		type Loose = s.Infer<typeof _Loose>;
		expectTypeOf<Loose['a']>().toEqualTypeOf<string>();
		expectTypeOf<Loose['b']>().toEqualTypeOf<number | undefined>();
		expectTypeOf<Loose['anything_else']>().toEqualTypeOf<unknown>();
	});

	test('flavor is loose nominal typing', () => {
		const Email = s.flavor(s.pipe(s.string, s.min_length(3)), 'Email');
		const Address = s.flavor(s.string, 'Address');
		type Email = s.Infer<typeof Email>;
		type Address = s.Infer<typeof Address>;
		const _plain: Email = 'plain';
		expectTypeOf(_plain).toEqualTypeOf<Email>();
		expectTypeOf<Address>().not.toExtend<Email>();
		expectTypeOf<s.InferInput<typeof Email>>().toEqualTypeOf<string>();
		expectTypeOf<s.Infer<typeof Email>>().toEqualTypeOf<s.Flavored<string, 'Email'>>();

		const _Piped = s.pipe(Email, s.max_length(10));
		expectTypeOf<s.Infer<typeof _Piped>>().toEqualTypeOf<Email>();

		const _Obj = s.object({ email: Email, other: s.optional(Address) });
		expectTypeOf<s.Infer<typeof _Obj>>().toEqualTypeOf<{
			email: Email;
			other?: Address | undefined;
		}>();

		const _Opt = s.object({ a: s.flavor(s.optional(s.string), 'A') });
		type Opt = s.Infer<typeof _Opt>;
		expectTypeOf<Opt>().toEqualTypeOf<{ a?: s.Flavored<string, 'A'> | undefined }>();
	});

	test('brand is strict nominal typing', () => {
		const Uuid = s.brand(s.string, 'Uuid');
		const _Other = s.brand(s.string, 'Other');
		type Uuid = s.Infer<typeof Uuid>;
		type Other = s.Infer<typeof _Other>;
		expectTypeOf<string>().not.toExtend<Uuid>();
		const _parsed: Uuid = s.parse_or_throw(Uuid, 'x');
		expectTypeOf(_parsed).toEqualTypeOf<Uuid>();
		expectTypeOf<Other>().not.toExtend<Uuid>();
		expectTypeOf<s.InferInput<typeof Uuid>>().toEqualTypeOf<string>();
		expectTypeOf<s.Infer<typeof Uuid>>().toEqualTypeOf<s.Branded<string, 'Uuid'>>();
	});

	test('two flavors of one type parameter mix where its constraint rules out null', () => {
		// what the TSDoc of `Flavored` says: these compile
		const _mix = <T extends string>(x: s.Flavored<T, 'A'>): s.Flavored<T, 'B'> => x;
		// and these keep them apart
		const _apart_non_nullable = <T>(
			x: s.Flavored<NonNullable<T>, 'A'>
		): s.Flavored<NonNullable<T>, 'B'> =>
			// @ts-expect-error `NonNullable` of an unconstrained `T` keeps them apart
			x;
		const _apart_unconstrained = <T>(x: s.Flavored<T, 'A'>): s.Flavored<T, 'B'> =>
			// @ts-expect-error the flavors of an unconstrained `T` don't mix
			x;
		const _apart = <T extends string>(
			x: T & s.Flavored<string, 'A'>
		): T & s.Flavored<string, 'B'> =>
			// @ts-expect-error the form the TSDoc gives keeps them apart
			x;
		const _brands = <T extends string>(x: s.Branded<T, 'A'>): s.Branded<T, 'B'> =>
			// @ts-expect-error brands don't mix
			x;
		// a plain value still assigns to the flavored constraint
		const _plain = <T extends string>(x: T): T & s.Flavored<string, 'B'> => x;
		for (const f of [_mix, _apart_non_nullable, _apart_unconstrained, _apart, _brands, _plain]) {
			assert.strictEqual(f('x' as never), 'x');
		}
		// and keeps `T`
		expectTypeOf(_apart<'x'>)
			.parameter(0)
			.toEqualTypeOf<'x' & s.Flavored<string, 'A'>>();
	});

	test('a flavor and a brand leave null and undefined unmarked', () => {
		type F = s.Flavored<string, 'N'>;
		type B = s.Branded<string, 'N'>;
		// written by hand
		expectTypeOf<s.Flavored<string | null, 'N'>>().toEqualTypeOf<F | null>();
		expectTypeOf<s.Flavored<string | undefined, 'N'>>().toEqualTypeOf<F | undefined>();
		expectTypeOf<s.Flavored<string | null | undefined, 'N'>>().toEqualTypeOf<
			F | null | undefined
		>();
		expectTypeOf<s.Flavored<null, 'N'>>().toEqualTypeOf<null>();
		expectTypeOf<s.Flavored<undefined, 'N'>>().toEqualTypeOf<undefined>();
		expectTypeOf<s.Branded<string | null, 'N'>>().toEqualTypeOf<B | null>();
		expectTypeOf<s.Branded<string | undefined, 'N'>>().toEqualTypeOf<B | undefined>();
		expectTypeOf<s.Branded<string | null | undefined, 'N'>>().toEqualTypeOf<B | null | undefined>();
		expectTypeOf<s.Branded<null, 'N'>>().toEqualTypeOf<null>();
		expectTypeOf<s.Branded<undefined, 'N'>>().toEqualTypeOf<undefined>();
		expectTypeOf<null>().toExtend<s.Flavored<string | null, 'N'>>();
		expectTypeOf<null>().toExtend<s.Branded<string | null, 'N'>>();
		expectTypeOf<undefined>().toExtend<s.Branded<string | undefined, 'N'>>();
		// a type without them still refuses them
		expectTypeOf<null>().not.toExtend<F>();
		expectTypeOf<undefined>().not.toExtend<B>();
		expectTypeOf<undefined>().not.toExtend<s.Branded<string | null, 'N'>>();
		// and what isn't one of the two is marked as before
		expectTypeOf<string>().toExtend<s.Flavored<string | null, 'N'>>();
		expectTypeOf<string>().not.toExtend<s.Branded<string | null, 'N'>>();
		expectTypeOf<s.Flavored<string | null, 'M'>>().not.toExtend<s.Flavored<string | null, 'N'>>();
		expectTypeOf<s.Branded<string | null, 'M'>>().not.toExtend<s.Branded<string | null, 'N'>>();

		// under every wrapper that adds one
		const _f_nullable = s.flavor(s.nullable(s.string), 'N');
		expectTypeOf<s.Infer<typeof _f_nullable>>().toEqualTypeOf<F | null>();
		expectTypeOf<s.InferInput<typeof _f_nullable>>().toEqualTypeOf<string | null>();
		const _f_optional = s.flavor(s.optional(s.string), 'N');
		expectTypeOf<s.Infer<typeof _f_optional>>().toEqualTypeOf<F | undefined>();
		const _f_both = s.flavor(s.nullable(s.optional(s.string)), 'N');
		expectTypeOf<s.Infer<typeof _f_both>>().toEqualTypeOf<F | null | undefined>();
		const _f_default = s.flavor(s.with_default(s.nullable(s.string), null), 'N');
		expectTypeOf<s.Infer<typeof _f_default>>().toEqualTypeOf<F | null>();
		const _f_lazy = s.flavor(
			s.lazy(() => s.nullable(s.string)),
			'N'
		);
		expectTypeOf<s.Infer<typeof _f_lazy>>().toEqualTypeOf<F | null>();
		const _f_union = s.flavor(s.union([s.string, s.literal(null), s.literal(undefined)]), 'N');
		expectTypeOf<s.Infer<typeof _f_union>>().toEqualTypeOf<F | null | undefined>();
		const _f_one_of = s.flavor(s.one_of(['a', null]), 'N');
		expectTypeOf<s.Infer<typeof _f_one_of>>().toEqualTypeOf<s.Flavored<'a', 'N'> | null>();
		const _f_pipe = s.flavor(
			s.pipe(
				s.nullable(s.string),
				s.check<string | null>(() => true)
			),
			'N'
		);
		expectTypeOf<s.Infer<typeof _f_pipe>>().toEqualTypeOf<F | null>();
		const _f_null = s.flavor(s.literal(null), 'N');
		expectTypeOf<s.Infer<typeof _f_null>>().toEqualTypeOf<null>();
		const _f_undefined = s.flavor(s.literal(undefined), 'N');
		expectTypeOf<s.Infer<typeof _f_undefined>>().toEqualTypeOf<undefined>();

		const _b_nullable = s.brand(s.nullable(s.string), 'N');
		expectTypeOf<s.Infer<typeof _b_nullable>>().toEqualTypeOf<B | null>();
		expectTypeOf<s.InferInput<typeof _b_nullable>>().toEqualTypeOf<string | null>();
		const _b_optional = s.brand(s.optional(s.string), 'N');
		expectTypeOf<s.Infer<typeof _b_optional>>().toEqualTypeOf<B | undefined>();
		const _b_both = s.brand(s.nullable(s.optional(s.string)), 'N');
		expectTypeOf<s.Infer<typeof _b_both>>().toEqualTypeOf<B | null | undefined>();
		const _b_default = s.brand(s.with_default(s.nullable(s.string), null), 'N');
		expectTypeOf<s.Infer<typeof _b_default>>().toEqualTypeOf<B | null>();
		const _b_lazy = s.brand(
			s.lazy(() => s.nullable(s.string)),
			'N'
		);
		expectTypeOf<s.Infer<typeof _b_lazy>>().toEqualTypeOf<B | null>();
		const _b_union = s.brand(s.union([s.string, s.literal(null), s.literal(undefined)]), 'N');
		expectTypeOf<s.Infer<typeof _b_union>>().toEqualTypeOf<B | null | undefined>();
		const _b_one_of = s.brand(s.one_of(['a', null]), 'N');
		expectTypeOf<s.Infer<typeof _b_one_of>>().toEqualTypeOf<s.Branded<'a', 'N'> | null>();
		const _b_pipe = s.brand(
			s.pipe(
				s.nullable(s.string),
				s.check<string | null>(() => true)
			),
			'N'
		);
		expectTypeOf<s.Infer<typeof _b_pipe>>().toEqualTypeOf<B | null>();
		const _b_null = s.brand(s.literal(null), 'N');
		expectTypeOf<s.Infer<typeof _b_null>>().toEqualTypeOf<null>();
		const _b_undefined = s.brand(s.literal(undefined), 'N');
		expectTypeOf<s.Infer<typeof _b_undefined>>().toEqualTypeOf<undefined>();
		// what the parse returns is what the type says
		assert.strictEqual(s.parse_or_throw(_b_nullable, null), null);
		assert.strictEqual(s.parse_or_throw(_f_optional, undefined), undefined);

		// the wrapper outside the flavor is the same type
		const _outside = s.nullable(s.flavor(s.string, 'N'));
		expectTypeOf<s.Infer<typeof _f_nullable>>().toEqualTypeOf<s.Infer<typeof _outside>>();

		// as entries, where the key is optional by the entry's kind
		const _Entries = s.object({
			nullable: s.flavor(s.nullable(s.string), 'N'),
			optional: s.brand(s.optional(s.string), 'N'),
			defaulted: s.flavor(s.with_default(s.nullable(s.string), null), 'N'),
			absent: s.brand(s.literal(undefined), 'N')
		});
		expectTypeOf<s.Infer<typeof _Entries>>().toEqualTypeOf<{
			nullable: F | null;
			defaulted: F | null;
			absent: undefined;
			optional?: B | undefined;
		}>();
		expectTypeOf<s.InferInput<typeof _Entries>>().toEqualTypeOf<{
			nullable: string | null;
			absent: undefined;
			optional?: string | undefined;
			defaulted?: string | null | undefined;
		}>();

		// stacked
		expectTypeOf<s.Flavored<s.Flavored<string | null, 'A'>, 'B'>>().toEqualTypeOf<
			s.Flavored<s.Flavored<string, 'A'>, 'B'> | null
		>();
		const _stacked = s.brand(s.flavor(s.nullable(s.string), 'A'), 'B');
		expectTypeOf<s.Infer<typeof _stacked>>().toEqualTypeOf<
			(string & s.Flavor<'A'> & s.Brand<'B'>) | null
		>();
	});

	test('a flavor and a brand mark every other type as an intersection', () => {
		expectTypeOf<s.Flavored<string, 'N'>>().toEqualTypeOf<string & s.Flavor<'N'>>();
		expectTypeOf<s.Branded<string, 'N'>>().toEqualTypeOf<string & s.Brand<'N'>>();
		expectTypeOf<s.Flavored<string | number, 'N'>>().toEqualTypeOf<
			(string | number) & s.Flavor<'N'>
		>();
		expectTypeOf<s.Branded<'a' | 'b', 'N'>>().toEqualTypeOf<('a' | 'b') & s.Brand<'N'>>();
		expectTypeOf<s.Flavored<boolean, 'N'>>().toEqualTypeOf<boolean & s.Flavor<'N'>>();
		expectTypeOf<s.Flavored<{ a: 1 }, 'N'>>().toEqualTypeOf<{ a: 1 } & s.Flavor<'N'>>();
		expectTypeOf<s.Branded<Array<string>, 'N'>>().toEqualTypeOf<Array<string> & s.Brand<'N'>>();
		expectTypeOf<s.Flavored<unknown, 'N'>>().toEqualTypeOf<s.Flavor<'N'>>();
		expectTypeOf<s.Branded<unknown, 'N'>>().toEqualTypeOf<s.Brand<'N'>>();
		expectTypeOf<s.Flavored<any, 'N'>>().toBeAny();
		expectTypeOf<s.Branded<any, 'N'>>().toBeAny();
		expectTypeOf<s.Flavored<never, 'N'>>().toBeNever();
		expectTypeOf<s.Branded<never, 'N'>>().toBeNever();
	});

	test('a flavor and a brand of a type parameter assign as the parameter does', () => {
		const flavor_of = <T extends string>(value: T): s.Flavored<T, 'N'> => value;
		const unflavor = <T extends string | null>(value: s.Flavored<T, 'N'>): string | null => value;
		const flavor_base = <T>(value: s.Flavored<T, 'N'>): T => value;
		const brand_base = <T>(value: s.Branded<T, 'N'>): T => value;
		const brand_of = <T extends string>(value: T): s.Branded<T, 'N'> =>
			// @ts-expect-error a plain value of a type parameter is not a branded one
			value;
		expectTypeOf(flavor_of('a')).toEqualTypeOf<s.Flavored<'a', 'N'>>();
		expectTypeOf(unflavor<string | null>(null)).toEqualTypeOf<string | null>();
		expectTypeOf(brand_of('a')).toEqualTypeOf<s.Branded<'a', 'N'>>();
		// the parameter is inferred through either
		expectTypeOf(flavor_base('a' as string | null)).toEqualTypeOf<string | null>();
		expectTypeOf(brand_base('a' as s.Branded<string, 'N'> | null)).toEqualTypeOf<string | null>();
	});

	test('a flavor and a brand of a type parameter are not known to lack null and undefined', () => {
		// `Extract` of a type parameter waits for the parameter, so what the
		// intersection alone allowed here is given up
		const widen = <T extends string>(value: s.Branded<T, 'N'>): s.Branded<string, 'N'> =>
			// @ts-expect-error not the brand of its constraint
			value;
		const marker = <T>(value: s.Branded<T, 'N'>): s.Brand<'N'> =>
			// @ts-expect-error possibly null or undefined
			value;
		// and two flavors of one constrained parameter assign to each other, where two brands don't
		const mix = <T extends string>(value: s.Flavored<T, 'M'>): s.Flavored<T, 'N'> => value;
		const mix_brand = <T extends string>(value: s.Branded<T, 'M'>): s.Branded<T, 'N'> =>
			// @ts-expect-error a different brand does not assign
			value;
		expectTypeOf(widen<'a'>).returns.toEqualTypeOf<s.Branded<string, 'N'>>();
		expectTypeOf(marker<string>).returns.toEqualTypeOf<s.Brand<'N'>>();
		expectTypeOf(mix<'a'>).returns.toEqualTypeOf<s.Flavored<'a', 'N'>>();
		expectTypeOf(mix_brand<'a'>).returns.toEqualTypeOf<s.Branded<'a', 'N'>>();
	});

	test('each bound holds a number or a bigint', () => {
		// asserted apart, because a `switch` case shared by both sees the union of the two
		expectTypeOf<s.SchemaDef<'min_value'>>().toEqualTypeOf<number | bigint>();
		expectTypeOf<s.SchemaDef<'max_value'>>().toEqualTypeOf<number | bigint>();
		expectTypeOf(s.min_value(1n)).toExtend<s.SchemaNode<'min_value'>>();
		expectTypeOf(s.max_value(1)).toExtend<s.SchemaNode<'max_value'>>();
	});

	test('kind narrows def to what the contract says', () => {
		expectTypeOf<s.SchemaDef<'string'>>().toEqualTypeOf<undefined>();
		expectTypeOf<s.SchemaDef<'literal'>>().toEqualTypeOf<s.SchemaLiteral>();
		expectTypeOf<s.SchemaDef<'with_default'>>().toEqualTypeOf<{
			readonly schema: s.SchemaNode;
			readonly value: unknown;
		}>();
		expectTypeOf<s.SchemaDef<'array'>>().toEqualTypeOf<s.SchemaNode>();
		expectTypeOf<s.SchemaNode<'regex'>['def']>().toEqualTypeOf<RegExp>();
		expectTypeOf<s.SchemaNode['kind']>().toEqualTypeOf<s.SchemaKind>();
		expectTypeOf<s.SchemaNode<'optional' | 'nullable'>['kind']>().toEqualTypeOf<
			'optional' | 'nullable'
		>();

		const check = (schema: s.SchemaNode): void => {
			switch (schema.kind) {
				case 'string':
				case 'number':
				case 'boolean':
				case 'bigint':
				case 'unknown':
				case 'integer':
				case 'safe_integer':
					expectTypeOf(schema.def).toEqualTypeOf<undefined>();
					break;
				case 'literal':
					expectTypeOf(schema.def).toEqualTypeOf<s.SchemaLiteral>();
					break;
				case 'one_of':
					expectTypeOf(schema.def).toEqualTypeOf<ReadonlyArray<s.SchemaLiteral>>();
					break;
				case 'optional':
				case 'nullable':
					expectTypeOf(schema.def).toEqualTypeOf<{ readonly schema: s.SchemaNode }>();
					break;
				case 'with_default':
					expectTypeOf(schema.def.schema).toEqualTypeOf<s.SchemaNode>();
					expectTypeOf(schema.def.value).toEqualTypeOf<unknown>();
					break;
				case 'with_default_fn':
					expectTypeOf(schema.def.schema).toEqualTypeOf<s.SchemaNode>();
					expectTypeOf(schema.def.make).toEqualTypeOf<() => unknown>();
					break;
				case 'lazy':
					expectTypeOf(schema.def).toEqualTypeOf<() => s.SchemaNode>();
					break;
				case 'object':
				case 'loose_object':
				case 'strip_object':
					expectTypeOf(schema.def).toEqualTypeOf<Readonly<Record<string, s.SchemaNode>>>();
					break;
				case 'object_with_rest':
					expectTypeOf(schema.def.entries).toEqualTypeOf<Readonly<Record<string, s.SchemaNode>>>();
					expectTypeOf(schema.def.rest).toEqualTypeOf<s.SchemaNode>();
					break;
				case 'record':
				case 'array':
					expectTypeOf(schema.def).toEqualTypeOf<s.SchemaNode>();
					break;
				case 'union':
				case 'pipe':
					expectTypeOf(schema.def).toEqualTypeOf<ReadonlyArray<s.SchemaNode>>();
					break;
				case 'variant':
					expectTypeOf(schema.def.key).toEqualTypeOf<string>();
					expectTypeOf(schema.def.options).toEqualTypeOf<
						ReadonlyArray<s.SchemaNode<'object' | 'loose_object' | 'strip_object'>>
					>();
					break;
				case 'min_length':
				case 'max_length':
					expectTypeOf(schema.def).toEqualTypeOf<number>();
					break;
				case 'min_value':
				case 'max_value':
					expectTypeOf(schema.def).toEqualTypeOf<number | bigint>();
					break;
				case 'regex':
					expectTypeOf(schema.def).toEqualTypeOf<RegExp>();
					break;
				case 'check':
					expectTypeOf(schema.def).toEqualTypeOf<(value: any) => boolean>();
					break;
				case 'transform':
					expectTypeOf(schema.def).toEqualTypeOf<(value: any) => unknown>();
					break;
				default:
					// every kind has a case
					expectTypeOf(schema).toEqualTypeOf<never>();
			}
		};
		check(s.string);
	});

	test('a schema is typed with the def its kind holds', () => {
		const _Optional = s.optional(s.string);
		expectTypeOf(_Optional.def).toEqualTypeOf<{ readonly schema: typeof s.string }>();
		expectTypeOf(_Optional.def.schema.kind).toEqualTypeOf<'string'>();
		const _Nullable = s.nullable(s.array(s.number));
		expectTypeOf(_Nullable.def.schema.def.kind).toEqualTypeOf<'number'>();
		const _Default = s.with_default(s.number, 1);
		expectTypeOf(_Default.def).toEqualTypeOf<{
			readonly schema: typeof s.number;
			readonly value: number;
		}>();
		const _OneOf = s.one_of(['a', 'b']);
		expectTypeOf(_OneOf.kind).toEqualTypeOf<'one_of'>();
		expectTypeOf(_OneOf.def).toEqualTypeOf<readonly ['a', 'b']>();
		// a typed schema is a node of its kind, and of no other
		expectTypeOf(_Optional).toExtend<s.SchemaNode<'optional'>>();
		expectTypeOf(_Optional).toExtend<s.SchemaNode>();
		expectTypeOf(_Optional).not.toExtend<s.SchemaNode<'nullable'>>();
		expectTypeOf(s.object({ a: _Optional, b: _Default })).toExtend<s.SchemaNode<'object'>>();
		// every node is a schema
		expectTypeOf<s.SchemaNode>().toExtend<s.AnySchema>();
	});

	test('is_schema narrows to a node', () => {
		const narrow = (value: unknown, any_schema: s.AnySchema, bare: s.Schema<string>): void => {
			if (s.is_schema(value)) {
				expectTypeOf(value).toEqualTypeOf<s.SchemaNode>();
				if (value.kind === 'optional') expectTypeOf(value.def.schema).toEqualTypeOf<s.SchemaNode>();
			}
			if (s.is_schema(any_schema)) expectTypeOf(any_schema.kind).toEqualTypeOf<s.SchemaKind>();
			if (s.is_schema(bare)) {
				expectTypeOf(bare.kind).toEqualTypeOf<s.SchemaKind>();
				// a node is the schema as data, without what it parses to
				expectTypeOf<s.Infer<typeof bare>>().toEqualTypeOf<unknown>();
			}
			expectTypeOf<s.Infer<typeof bare>>().toEqualTypeOf<string>();
		};
		narrow(s.string, s.string, s.string);
	});

	test('variant does not take a wrapper or an object_with_rest for an option', () => {
		const Circle = s.object({ kind: s.literal('circle') });
		// @ts-expect-error a wrapper's def is not an object schema's entries
		assert.throws(() => s.variant('kind', [s.optional(Circle)]));
		// @ts-expect-error nor is it when the key is the one a wrapper has
		s.variant('schema', [s.nullable(s.literal('a'))]);
		// nor a default's, when its value is of type `any` or is a schema
		const Any = s.unknown as s.Schema<any>;
		// @ts-expect-error a value of type `any` is not a schema's entries
		assert.throws(() => s.variant('kind', [s.with_default(Any, 1)]), TypeError);
		const OfSchema = s.unknown as s.Schema<s.Schema<'x', 'x', 'literal', 'x'>>;
		// @ts-expect-error a value that is a schema is not one either
		s.variant('value', [s.with_default(OfSchema, s.literal('x'))]);
		// @ts-expect-error nor is the wrapped schema, under its key
		s.variant('schema', [s.with_default(OfSchema, s.literal('x'))]);
		// @ts-expect-error nor a `make` that returns `any`
		assert.throws(() => s.variant('kind', [s.with_default_fn(Any, () => 1)]), TypeError);
		// nor an `object_with_rest`'s, when its entries are of type `any`
		// @ts-expect-error its `rest` is not an entry
		s.variant('rest', [s.object_with_rest({} as any, s.literal('a'))]);
	});

	test('the object, key, and entry of run are optional, and a key is optional only by its kind', () => {
		expectTypeOf<Parameters<s.Schema['run']>>().toEqualTypeOf<
			[
				value: any,
				ctx: s.SchemaContext,
				parent?: Record<PropertyKey, unknown>,
				key?: PropertyKey,
				entry?: 1
			]
		>();
		// a `run` of two parameters is a schema's, and one is called with two arguments
		const Two: s.Schema<number> = { kind: 'two', def: undefined, run: (value, _ctx) => value };
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		assert.strictEqual(Two.run(1, ctx), 1);
		assert.strictEqual(Two.run(1, ctx, { a: 1 }, 'a', 1), 1);
		const _O = s.object({
			unknown: s.unknown,
			held: s.nullable(s.optional(s.unknown)),
			optional: s.optional(s.unknown),
			defaulted: s.with_default(s.unknown, 'd'),
			flavored: s.flavor(s.unknown, 'F')
		});
		// `held` lets its key be missing at run time, which the types don't say
		expectTypeOf<s.InferInput<typeof _O>>().toEqualTypeOf<{
			unknown: unknown;
			held: unknown;
			flavored: unknown;
			optional?: unknown;
			defaulted?: unknown;
		}>();
	});

	test('rejects an action for the wrong type', () => {
		// @ts-expect-error `integer` takes a number
		s.pipe(s.string, s.integer);
	});
});
