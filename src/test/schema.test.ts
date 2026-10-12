import { runInNewContext } from 'node:vm';
import { inspect } from 'node:util';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { to_standard_schema } from '#lib/standard_schema.ts';

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

	test('number rejects NaN and allows infinities', () => {
		assert(!s.is(s.number, NaN));
		assert(s.is(s.number, Infinity));
		assert(!s.is(s.pipe(s.number, s.finite), Infinity));
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
});

describe('wrappers', () => {
	test('optional, nullable, with_default', () => {
		assert.strictEqual(s.parse_or_throw(s.optional(s.string), undefined), undefined);
		assert.strictEqual(s.parse_or_throw(s.nullable(s.string), null), null);
		assert(!s.is(s.optional(s.string), null));
		assert.strictEqual(s.parse_or_throw(s.with_default(s.string, 'x'), undefined), 'x');
		assert.strictEqual(s.parse_or_throw(s.with_default(s.string, 'x'), 'y'), 'y');
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
		assert.deepEqual(output, { a: 'x', extra: true, b: 1 });
		assert.deepEqual(input, { a: 'x', extra: true });
		assert.deepEqual(issues_of(Loose, { a: 1, extra: true }), [
			{ kind: 'string', expected: 'string', received: 'number', path: ['a'], message: undefined }
		]);
		assert(!s.is(Loose, null));
		// a `__proto__` key in the input stays an own key of the copy
		const proto_output = s.parse_or_throw(Loose, JSON.parse('{"a": "x", "__proto__": {"p": 1}}'));
		assert.strictEqual(Object.getPrototypeOf(proto_output), Object.prototype);
		assert(Object.hasOwn(proto_output, '__proto__'));
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
});

describe('arrays are not objects', () => {
	const entries = { a: s.optional(s.string) };
	const schemas = [
		s.object(entries),
		s.strip_object(entries),
		s.loose_object(entries),
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
});

describe('object keys', () => {
	// the two object schemas that look at keys the schema doesn't name
	const factories = [s.object, s.strip_object] as const;

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
});

describe('message', () => {
	test('labels the issues of the schema it wraps, not its children', () => {
		const O = s.message(
			s.strip_object({ a: s.message(s.string, 'a must be text'), b: s.number }),
			'not an object'
		);
		assert.deepEqual(
			issues_of(O, { a: 1, b: 'x' }).map((i) => i.message),
			['a must be text', undefined]
		);
		assert.deepEqual(
			issues_of(O, null).map((i) => i.message),
			['not an object']
		);
		assert.strictEqual(s.format_issue(issues_of(O, { a: 1, b: 2 })[0]!), 'a: a must be text');
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
		// around an object: the object, for its own issue and not its entries'
		issues_of(s.message(O, note), null);
		issues_of(s.message(s.object({ a: s.string }), note), { a: 1 });
		assert.deepEqual(seen.splice(0), [null]);
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
		lazy: s.lazy(lazy_get),
		object: s.object(entries),
		loose_object: s.loose_object(entries),
		strip_object: s.strip_object(entries),
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
		finite: s.finite,
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
			lazy: lazy_get,
			object: entries,
			loose_object: entries,
			strip_object: entries,
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
			finite: undefined,
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
	});

	test('a wrapper holds its schema under one key', () => {
		for (const kind of ['optional', 'nullable', 'with_default'] as const) {
			assert.strictEqual(by_kind[kind].def.schema, s.string);
		}
		assert.deepEqual(Object.keys(by_kind.optional.def), ['schema']);
		assert.deepEqual(Object.keys(by_kind.nullable.def), ['schema']);
		assert.deepEqual(Object.keys(by_kind.with_default.def), ['schema', 'value']);
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
				expected: 'object | object',
				received: 'object',
				path: ['items', 1],
				message: undefined
			},
			{
				kind: 'union',
				expected: 'object | object',
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
			[NaN, 'number'],
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
		assert.strictEqual(issues_of(s.number, NaN)[0]!.received, 'number');
		assert.strictEqual(issues_of(s.object({ a: s.string }), {})[0]!.received, 'undefined');
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
		const _address = 'x' as Address;
		// @ts-expect-error a different flavor does not assign
		const _email: Email = _address;
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
		// @ts-expect-error a plain string does not assign
		const _plain: Uuid = 'x';
		const _parsed: Uuid = s.parse_or_throw(Uuid, 'x');
		expectTypeOf(_parsed).toEqualTypeOf<Uuid>();
		// @ts-expect-error a different brand does not assign
		const _other: Uuid = {} as Other;
		expectTypeOf<s.InferInput<typeof Uuid>>().toEqualTypeOf<string>();
		expectTypeOf<s.Infer<typeof Uuid>>().toEqualTypeOf<s.Branded<string, 'Uuid'>>();
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
				case 'finite':
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
				case 'lazy':
					expectTypeOf(schema.def).toEqualTypeOf<() => s.SchemaNode>();
					break;
				case 'object':
				case 'loose_object':
				case 'strip_object':
					expectTypeOf(schema.def).toEqualTypeOf<Readonly<Record<string, s.SchemaNode>>>();
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
		expectTypeOf(_Optional.def).toEqualTypeOf<{ schema: typeof s.string }>();
		expectTypeOf(_Optional.def.schema.kind).toEqualTypeOf<'string'>();
		const _Nullable = s.nullable(s.array(s.number));
		expectTypeOf(_Nullable.def.schema.def.kind).toEqualTypeOf<'number'>();
		const _Default = s.with_default(s.number, 1);
		expectTypeOf(_Default.def).toEqualTypeOf<{ schema: typeof s.number; value: number }>();
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

	test('variant does not take a wrapper for an option', () => {
		const Circle = s.object({ kind: s.literal('circle') });
		// @ts-expect-error a wrapper's def is not an object schema's entries
		assert.throws(() => s.variant('kind', [s.optional(Circle)]));
		// @ts-expect-error nor is it when the key is the one a wrapper has
		s.variant('schema', [s.nullable(s.literal('a'))]);
	});

	test('rejects an action for the wrong type', () => {
		// @ts-expect-error `integer` takes a number
		s.pipe(s.string, s.integer);
	});
});
