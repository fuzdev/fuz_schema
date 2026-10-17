import { runInNewContext } from 'node:vm';
import { inspect } from 'node:util';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

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
