import { runInNewContext } from 'node:vm';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';

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

	test('literal and picklist', () => {
		assert(s.is(s.literal('a'), 'a'));
		assert(!s.is(s.literal('a'), 'b'));
		assert(s.is(s.literal(null), null));
		assert(s.is(s.picklist(['a', 'b']), 'b'));
		assert.strictEqual(issues_of(s.literal(1n), 2n)[0]!.expected, '1');
		assert.strictEqual(issues_of(s.literal('a'), 'b')[0]!.expected, '"a"');
		assert.strictEqual(issues_of(s.picklist([1, 'a', null]), 2)[0]!.expected, '1 | "a" | null');
		assert.deepEqual(issues_of(s.picklist(['a', 'b']), 'c'), [
			{ kind: 'picklist', expected: '"a" | "b"', value: 'c', path: [], message: undefined }
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
			{ kind: 'string', expected: 'string', value: undefined, path: ['name'], message: undefined },
			{ kind: 'number', expected: 'number', value: 'x', path: ['age'], message: undefined }
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
				value: 1,
				path: ['b'],
				message: undefined
			},
			{
				kind: 'unknown_key',
				expected: 'no unknown keys',
				value: 2,
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
			{ kind: 'string', expected: 'string', value: 1, path: ['a'], message: undefined }
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
				assert.deepEqual(issues_of(schema, input), [{ ...issues_of(schema, 1)[0]!, value: input }]);
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
			issues_of(O, { y: 1, b: 2, z: 3, a: 4, x: 5 }).map((i) => [i.kind, i.path, i.value]),
			[
				['string', ['a'], 4],
				['string', ['b'], 2],
				['unknown_key', ['y'], 1],
				['unknown_key', ['z'], 3],
				['unknown_key', ['x'], 5]
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
			{ kind: 'union', expected: 'string | number', value: true, path: [], message: undefined }
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
				value: 'line',
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
				s.message(s.min_length(2), (issue) => `too short: ${String(issue.value)}`)
			),
			'bad name'
		);
		assert.strictEqual(issues_of(Name, 'a')[0]!.message, 'too short: a');
		assert.strictEqual(issues_of(Name, 1)[0]!.message, 'bad name');
		assert.strictEqual(s.parse_or_throw(Name, 'ab'), 'ab');
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
			{ kind: 'string', expected: 'string', value: 1, path: ['first'], message: undefined },
			{
				kind: 'union',
				expected: 'object | object',
				value: { a: [1] },
				path: ['items', 1],
				message: undefined
			},
			{
				kind: 'union',
				expected: 'object | object',
				value: { c: 1 },
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
			role: s.with_default(s.picklist(['user', 'admin']), 'user'),
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

	test('rejects an action for the wrong type', () => {
		// @ts-expect-error `integer` takes a number
		s.pipe(s.string, s.integer);
	});
});
