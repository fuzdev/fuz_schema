import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta, get_meta, type SchemaMeta } from '#lib/meta.ts';
import type * as Meta from '#lib/meta.ts';

// how a consumer adds its own keys
declare module '#lib/meta.ts' {
	interface SchemaMeta {
		test_aliases?: Array<string>;
	}
}

const issues_of = (schema: s.AnySchema, value: unknown): Array<s.SchemaIssue> => {
	const result = s.parse(schema, value);
	assert(!result.ok);
	return result.issues;
};

describe('meta', () => {
	test('a copy of unknown needs its key as an entry, as unknown does', () => {
		const O = s.object({ a: meta(s.unknown, { description: 'anything' }) });
		assert(s.is(O, { a: undefined }));
		assert(!s.is(O, {}));
		assert.deepEqual(issues_of(O, {})[0]!.kind, 'missing_key');
	});

	test('returns a fresh schema each time and leaves the original alone', () => {
		const before = Object.entries(s.string);
		const a = meta(s.string, { description: 'a' });
		const b = meta(s.string, { description: 'b' });
		assert.notStrictEqual(a, s.string);
		assert.notStrictEqual(a, b);
		assert.strictEqual(get_meta(s.string), undefined);
		assert.deepEqual(Object.entries(s.string), before);
		assert.deepEqual(get_meta(a), { description: 'a' });
		assert.deepEqual(get_meta(b), { description: 'b' });
	});

	test('the copy has the three fields in order, holding what the schema holds', () => {
		const O = s.object({ a: s.string });
		for (const schema of [s.string, s.min_length(1), O, s.optional(O), s.message(O, 'x')]) {
			const copy = meta(schema, { description: 'x' });
			assert.deepEqual(Object.keys(copy), ['kind', 'def', 'run']);
			assert.strictEqual(copy.kind, schema.kind);
			assert.strictEqual(copy.def, schema.def);
			assert.strictEqual(copy.run, schema.run);
			assert(s.is_schema(copy));
		}
	});

	test('parses like the schema', () => {
		const User = s.object({ name: s.pipe(s.string, s.min_length(1)), age: s.optional(s.number) });
		const Described = meta(User, { description: 'a user' });
		const valid = { name: 'a' };
		assert.strictEqual(s.parse_or_throw(Described, valid), valid);
		for (const input of [valid, null, [], { name: '' }, { name: 'a', age: 'x', extra: 1 }]) {
			assert.deepEqual(s.parse(Described, input), s.parse(User, input));
			assert.strictEqual(s.is(Described, input), s.is(User, input));
		}
	});

	test('copies the metadata given', () => {
		const given: SchemaMeta = { description: 'a' };
		const a = meta(s.string, given);
		given.description = 'changed';
		assert.deepEqual(get_meta(a), { description: 'a' });
		assert.strictEqual(get_meta(a), get_meta(a));
	});

	test('merges onto metadata the schema already has, new keys winning', () => {
		const a = meta(s.string, { description: 'a', test_aliases: ['x'] });
		const b = meta(a, { description: 'b' });
		assert.notStrictEqual(a, b);
		assert.deepEqual(get_meta(b), { description: 'b', test_aliases: ['x'] });
		// the schema it was built from keeps what it had
		assert.deepEqual(get_meta(a), { description: 'a', test_aliases: ['x'] });
		// `undefined` is a value like any other, so it clears a key
		const c = meta(b, { test_aliases: undefined });
		assert.deepEqual(get_meta(c), { description: 'b', test_aliases: undefined });
		assert.deepEqual(get_meta(meta(c, {})), get_meta(c));
	});

	test('survives flavor and brand, which return the schema itself', () => {
		const a = meta(s.string, { description: 'a' });
		assert.deepEqual(get_meta(s.flavor(a, 'Email')), { description: 'a' });
		assert.deepEqual(get_meta(s.brand(a, 'Uuid')), { description: 'a' });
		assert.deepEqual(get_meta(meta(s.brand(s.string, 'Uuid'), { description: 'b' })), {
			description: 'b'
		});
	});

	test('is not carried by message, which builds a new schema', () => {
		const a = meta(s.string, { description: 'a' });
		assert.strictEqual(get_meta(s.message(a, 'x')), undefined);
		// so metadata goes on last
		const b = meta(s.message(s.string, 'must be text'), { description: 'b' });
		assert.deepEqual(get_meta(b), { description: 'b' });
		const result = s.parse(b, 1);
		assert(!result.ok);
		assert.strictEqual(result.issues[0]!.message, 'must be text');
	});

	test('is read from the schema given, not the ones inside it', () => {
		const a = meta(s.string, { description: 'a' });
		const Optional = s.optional(a);
		const Default = s.with_default(a, '');
		const O = s.object({ a });
		assert.strictEqual(get_meta(Optional), undefined);
		assert.strictEqual(get_meta(O), undefined);
		// a walk finds it
		assert.deepEqual(get_meta(Optional.def.schema), { description: 'a' });
		assert.deepEqual(get_meta(Default.def.schema), { description: 'a' });
		assert.deepEqual(get_meta(O.def.a), { description: 'a' });
		assert.deepEqual(get_meta(s.array(a).def), { description: 'a' });
	});

	test('goes anywhere a schema does', () => {
		const O = s.object({
			name: meta(s.string, { description: 'name' }),
			age: meta(s.optional(s.number), { description: 'age' }),
			role: meta(s.with_default(s.string, 'user'), { description: 'role' })
		});
		assert.deepEqual(s.parse_or_throw(O, { name: 'a' }), { name: 'a', role: 'user' });
		assert.deepEqual(
			Object.entries(O.def).map(([key, schema]) => [key, schema.kind, get_meta(schema)]),
			[
				['name', 'string', { description: 'name' }],
				['age', 'optional', { description: 'age' }],
				['role', 'with_default', { description: 'role' }]
			]
		);

		const Piped = s.pipe(meta(s.string, { description: 'base' }), s.min_length(1));
		assert(s.is(Piped, 'a'));
		assert(!s.is(Piped, ''));
		assert.deepEqual(get_meta(Piped.def[0]!), { description: 'base' });

		const U = s.union([meta(s.string, { description: 'text' }), s.number]);
		assert(s.is(U, 'a'));
		assert(s.is(U, 1));
		assert(!s.is(U, true));
		assert.deepEqual(get_meta(U.def[0]), { description: 'text' });

		const V = s.variant('kind', [
			meta(s.object({ kind: s.literal('a'), x: s.number }), { description: 'the a option' }),
			s.object({ kind: s.literal('b') })
		]);
		assert(s.is(V, { kind: 'a', x: 1 }));
		assert(!s.is(V, { kind: 'a' }));
		assert.deepEqual(get_meta(V.def.options[0]), { description: 'the a option' });

		const L: s.Schema = s.lazy(() => meta(s.array(L), { description: 'nested' }));
		assert(s.is(L, [[], [[]]]));
		assert(!s.is(L, [1]));
	});

	test('a schema never given to meta has none, whatever its shape', () => {
		assert.strictEqual(get_meta({ kind: 'string', def: undefined, run: s.string.run }), undefined);
	});

	test('the copy has the three fields whatever else the schema given holds', () => {
		const wide = { kind: 'string', def: undefined, run: s.string.run, extra: 1 } as s.AnySchema;
		const copy = meta(wide, { description: 'x' });
		assert.deepEqual(Object.keys(copy), ['kind', 'def', 'run']);
		assert.deepEqual(get_meta(copy), { description: 'x' });
	});

	test('copies the metadata one level deep', () => {
		const aliases = ['a'];
		const given = { description: 'x', aliases } as { description: string };
		const copy = meta(s.string, given);
		aliases.push('b');
		// the object is copied and what its keys hold is shared
		assert.strictEqual((get_meta(copy) as { aliases?: Array<string> }).aliases, aliases);
	});

	test('a __proto__ key in the metadata stays a key', () => {
		const copy = meta(
			s.string,
			JSON.parse('{"__proto__": {"polluted": true}, "description": "x"}')
		);
		const stored = get_meta(meta(copy, {}))!;
		assert.strictEqual(Object.getPrototypeOf(stored), Object.prototype);
		assert(Object.hasOwn(stored, '__proto__'));
		assert.strictEqual(({} as { polluted?: boolean }).polluted, undefined);
	});

	test('a copy of a lazy schema shares what it resolved to', () => {
		let calls = 0;
		const Lazy = s.lazy(() => (calls++, s.string));
		const Described = meta(Lazy, { description: 'x' });
		assert(s.is(Described, 'a'));
		assert(s.is(Lazy, 'a'));
		assert(s.is(meta(Described, {}), 'a'));
		assert.strictEqual(calls, 1);
	});

	test('a variant reads a discriminator through its copy', () => {
		const V = s.variant('kind', [
			s.object({ kind: meta(s.literal('a'), { description: 'the a kind' }), x: s.number }),
			s.object({ kind: s.literal('b') })
		]);
		assert(s.is(V, { kind: 'a', x: 1 }));
		assert(s.is(V, { kind: 'b' }));
		assert(!s.is(V, { kind: 'c' }));
		assert.strictEqual(issues_of(V, { kind: 'c' })[0]!.expected, '"a" | "b"');
	});
});

describe('meta across copies of the module', () => {
	const KEY = Symbol.for('@fuzdev/fuz_schema/meta');

	// a second instance of the module, as a second install or a bundler's duplicate is
	const load_copy = async (): Promise<typeof Meta> =>
		import(new URL('../lib/meta.ts', import.meta.url).href + '?second_copy');

	test('a second instance of the module is another module', async () => {
		const copy = await load_copy();
		assert.notStrictEqual(copy.meta, meta);
		assert.notStrictEqual(copy.get_meta, get_meta);
	});

	test('metadata attached through one copy is read through the other', async () => {
		const copy = await load_copy();
		const a = meta(s.string, { description: 'a', test_aliases: ['x'] });
		assert.deepEqual(copy.get_meta(a), { description: 'a', test_aliases: ['x'] });
		const b = copy.meta(s.number, { description: 'b' });
		assert.deepEqual(get_meta(b), { description: 'b' });
		// and merges across them
		const c = copy.meta(a, { description: 'c' });
		assert.deepEqual(get_meta(c), { description: 'c', test_aliases: ['x'] });
		assert.strictEqual(get_meta(c), copy.get_meta(c));
	});

	test('the registry is a WeakMap on globalThis under the shared key', () => {
		const registry = (globalThis as unknown as Record<symbol, unknown>)[KEY];
		assert.instanceOf(registry, WeakMap);
		const a = meta(s.string, { description: 'a' });
		assert.strictEqual((registry as WeakMap<object, SchemaMeta>).get(a), get_meta(a));
		// what another version writes there is read, and merged onto
		const b = { kind: 'string', def: undefined, run: s.string.run } as s.AnySchema;
		(registry as WeakMap<object, SchemaMeta>).set(b, { description: 'b' });
		assert.deepEqual(get_meta(b), { description: 'b' });
		assert.deepEqual(get_meta(meta(b, { test_aliases: [] })), {
			description: 'b',
			test_aliases: []
		});
	});
});

describe('meta types', () => {
	test('returns the type of the schema given', () => {
		const _a = meta(s.string, { description: 'a' });
		expectTypeOf(_a).toEqualTypeOf<typeof s.string>();
		const O = s.object({ a: s.string });
		expectTypeOf(meta(O, {})).toEqualTypeOf<typeof O>();
		const Uuid = s.brand(s.string, 'Uuid');
		expectTypeOf<s.Infer<typeof Uuid>>().toEqualTypeOf<s.Branded<string, 'Uuid'>>();
		expectTypeOf(meta(Uuid, {})).toEqualTypeOf<typeof Uuid>();
	});

	test('keeps key optionality as an object entry', () => {
		const _O = s.object({
			name: meta(s.string, { description: 'name' }),
			age: meta(s.optional(s.number), { description: 'age' }),
			role: meta(s.with_default(s.string, 'user'), { description: 'role' }),
			id: meta(s.flavor(s.string, 'Id'), { description: 'id' })
		});
		expectTypeOf<s.Infer<typeof _O>>().toEqualTypeOf<{
			name: string;
			role: string;
			id: s.Flavored<string, 'Id'>;
			age?: number | undefined;
		}>();
		expectTypeOf<s.InferInput<typeof _O>>().toEqualTypeOf<{
			name: string;
			id: string;
			age?: number | undefined;
			role?: string | undefined;
		}>();
	});

	test('narrows like the schema when read as data', () => {
		const _a = meta(s.optional(s.string), { description: 'a' });
		expectTypeOf(_a.kind).toEqualTypeOf<'optional'>();
		expectTypeOf(_a.def.schema).toEqualTypeOf<typeof s.string>();
		const _piped = s.pipe(meta(s.string, {}), s.min_length(1));
		expectTypeOf<s.Infer<typeof _piped>>().toEqualTypeOf<string>();
		const _U = s.union([meta(s.string, {}), meta(s.number, {})]);
		expectTypeOf<s.Infer<typeof _U>>().toEqualTypeOf<string | number>();
		const _V = s.variant('kind', [
			meta(s.object({ kind: s.literal('a'), x: s.number }), {}),
			meta(s.object({ kind: s.literal('b') }), {})
		]);
		expectTypeOf<s.Infer<typeof _V>>().toEqualTypeOf<{ kind: 'a'; x: number } | { kind: 'b' }>();
	});

	test('takes built-in keys and merged ones, and rejects others', () => {
		meta(s.string, { description: 'a', test_aliases: ['x'] });
		// @ts-expect-error not a key of `SchemaMeta`
		meta(s.string, { nope: 1 });
		// @ts-expect-error `description` is a string
		meta(s.string, { description: 1 });
		// @ts-expect-error the merged key keeps its type
		meta(s.string, { test_aliases: 'x' });
		// @ts-expect-error a schema is required
		meta({ description: 'a' }, {});
	});

	test('reads back as readonly metadata or undefined', () => {
		const read = get_meta(meta(s.string, {}));
		expectTypeOf(read).toEqualTypeOf<Readonly<SchemaMeta> | undefined>();
		expectTypeOf<NonNullable<typeof read>['test_aliases']>().toEqualTypeOf<
			Array<string> | undefined
		>();
		const write = (stored: Readonly<SchemaMeta>): void => {
			// @ts-expect-error the stored object is not for writing
			stored.description = 'x';
		};
		expectTypeOf(write).toBeFunction();
	});
});
