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
		const Tree: s.Schema<Tree> = s.strict_object({
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
	const User = s.object({
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

	test('strict_object fails on unknown keys', () => {
		const Strict = s.strict_object({ a: s.string });
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

	test('record validates values and ignores __proto__', () => {
		const Counts = s.record(s.number);
		assert.deepEqual(s.parse_or_throw(Counts, { a: 1, b: 2 }), { a: 1, b: 2 });
		assert.deepEqual(issues_of(Counts, { a: 1, b: 'x' })[0]!.path, ['b']);
		const output = s.parse_or_throw(Counts, JSON.parse('{"__proto__": 1, "a": 2}'));
		assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
		assert.deepEqual(Object.keys(output), ['a']);
	});
});

describe('copy on write', () => {
	const Address = s.strict_object({ city: s.string, zip: s.optional(s.string) });
	const User = s.strict_object({
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
			s.parse_or_throw(s.object({ city: s.string, zip: s.optional(s.string) }), loose),
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
		const Tree = s.object({
			items: s.array(s.object({ n: s.with_default(s.number, 0), keep: s.string }))
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

	test('object still drops unknown keys, by copying', () => {
		const O = s.object({ a: s.string });
		const input = { a: 'x', secret: 1 };
		const output = s.parse_or_throw(O, input);
		assert.deepEqual(output, { a: 'x' });
		assert.deepEqual(input, { a: 'x', secret: 1 });
		// including when a later entry changes
		assert.deepEqual(
			s.parse_or_throw(s.object({ a: s.string, b: s.with_default(s.number, 1) }), input),
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

describe('array, union, variant', () => {
	test('array prefixes the index', () => {
		assert.deepEqual(s.parse_or_throw(s.array(s.number), [1, 2]), [1, 2]);
		assert.deepEqual(
			issues_of(s.array(s.object({ a: s.number })), [{ a: 1 }, { a: 'x' }])[0]!.path,
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
		const O = s.object({ a: s.string, b: s.union([s.string, s.number]) });
		assert.deepEqual(
			issues_of(O, { a: 1, b: 2 }).map((i) => i.path),
			[['a']]
		);
	});

	test('variant dispatches on the discriminator', () => {
		const Shape = s.variant('kind', [
			s.strict_object({ kind: s.literal('circle'), radius: s.number }),
			s.strict_object({ kind: s.literal('square'), size: s.number })
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
			s.object({ a: s.message(s.string, 'a must be text'), b: s.number }),
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
		const O = s.object({ a: s.message(s.optional(s.string), 'x') });
		assert.strictEqual(O.def.a.kind, 'optional');
		assert.deepEqual(s.parse_or_throw(O, {}), {});
		const V = s.variant('kind', [
			s.message(s.strict_object({ kind: s.literal('a') }), 'x'),
			s.strict_object({ kind: s.literal('b') })
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
			[s.object({ a: Counted, b: Counted }), { a: 1, b: 2 }],
			[s.strict_object({ a: Counted, b: Counted }), { a: 1, b: 2 }],
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
		const Strict = s.strict_object({ a: s.string });
		assert(s.is(Strict, { a: 'x' }));
		assert(!s.is(Strict, { a: 'x', b: 1 }));
		const V = s.variant('kind', [s.strict_object({ kind: s.literal('a') })]);
		assert(!s.is(V, { kind: 'z' }));
		assert(!s.is(s.message(s.object({ a: s.message(s.string, 'x') }), 'y'), { a: 1 }));
	});

	test('union probes options without leaking failures', () => {
		const Item = s.union([
			s.strict_object({ a: s.array(s.string) }),
			s.strict_object({ b: s.union([s.number, s.literal('x')]) })
		]);
		assert.deepEqual(s.parse_or_throw(Item, { b: 'x' }), { b: 'x' });
		const List = s.object({ first: s.string, items: s.array(Item) });
		assert.deepEqual(issues_of(List, { first: 1, items: [{ b: 1 }, { a: [1] }, { c: 1 }] }), [
			{ kind: 'string', expected: 'string', value: 1, path: ['first'], message: undefined },
			{
				kind: 'union',
				expected: 'strict_object | strict_object',
				value: { a: [1] },
				path: ['items', 1],
				message: undefined
			},
			{
				kind: 'union',
				expected: 'strict_object | strict_object',
				value: { c: 1 },
				path: ['items', 2],
				message: undefined
			}
		]);
	});

	test('a failed union leaves probe mode off for its siblings', () => {
		const O = s.object({
			a: s.union([s.string, s.number]),
			b: s.object({ c: s.string, d: s.string })
		});
		assert.deepEqual(
			issues_of(O, { a: true, b: { c: 1, d: 2 } }).map((i) => i.path),
			[['a'], ['b', 'c'], ['b', 'd']]
		);
	});
});

describe('parse_or_throw', () => {
	test('throws SchemaError listing every issue', () => {
		const O = s.object({ a: s.string, b: s.array(s.number) });
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

describe('types', () => {
	test('infers object output and input', () => {
		const _User = s.object({
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
			s.strict_object({ kind: s.literal('circle'), radius: s.number }),
			s.strict_object({ kind: s.literal('square'), size: s.number })
		]);
		expectTypeOf<s.Infer<typeof _Shape>>().toEqualTypeOf<
			{ kind: 'circle'; radius: number } | { kind: 'square'; size: number }
		>();
	});

	test('rejects an action for the wrong type', () => {
		// @ts-expect-error `integer` takes a number
		s.pipe(s.string, s.integer);
	});
});
