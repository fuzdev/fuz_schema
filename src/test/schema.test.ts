import { inspect } from 'node:util';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

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
		expectTypeOf<
			s.Flavored<s.Flavored<string | null, 'A'>, 'B'>
		>().toEqualTypeOf<s.Flavored<s.Flavored<string, 'A'>, 'B'> | null>();
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
