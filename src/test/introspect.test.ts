import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta } from '#lib/meta.ts';
import {
	unwrap_schema,
	get_schema_meta,
	find_schema_meta,
	get_schema_entries,
	get_schema_fields,
	format_schema_type
} from '#lib/introspect.ts';

import { SHAPE_SAMPLES } from './shape_test_helpers.ts';

declare module '#lib/meta.ts' {
	interface SchemaMeta {
		introspect_aliases?: Array<string>;
	}
}

describe('unwrap_schema', () => {
	test('walks every wrapper to the schema under them', () => {
		const inner = s.number;
		assert.strictEqual(
			unwrap_schema(s.optional(s.nullable(s.with_default(s.pipe(inner, s.integer), 1)))),
			inner
		);
	});

	test('follows a lazy', () => {
		const inner = s.string;
		assert.strictEqual(unwrap_schema(s.lazy(() => s.optional(inner))), inner);
	});

	test('message, flavor, and brand are no layer', () => {
		const M = s.message(s.optional(s.brand(s.flavor(s.string, 'F'), 'B')), 'text');
		assert.strictEqual(unwrap_schema(M).kind, 'string');
	});

	test('a schema that is no wrapper is itself', () => {
		const O = s.object({});
		assert.strictEqual(unwrap_schema(O), O);
	});
});

describe('get_schema_meta', () => {
	test('finds metadata on any layer, outermost first', () => {
		const inner = s.with_default(meta(s.boolean, { description: 'inner' }), true);
		assert.strictEqual(get_schema_meta(inner, 'description'), 'inner');
		const outer = meta(inner, { description: 'outer' });
		assert.strictEqual(get_schema_meta(outer, 'description'), 'outer');
	});

	test('reads keys added by declaration merging', () => {
		const A = s.optional(meta(s.string, { introspect_aliases: ['a'] }));
		assert.deepEqual(get_schema_meta(A, 'introspect_aliases'), ['a']);
		assert.strictEqual(get_schema_meta(A, 'description'), undefined);
	});

	test('passes a layer whose key is undefined', () => {
		const A = meta(s.optional(meta(s.string, { description: 'kept' })), {
			description: undefined
		});
		assert.strictEqual(get_schema_meta(A, 'description'), 'kept');
	});

	test('finds metadata outside message and inside it', () => {
		const outside = meta(s.message(s.string, 'text'), { description: 'd' });
		assert.strictEqual(get_schema_meta(outside, 'description'), 'd');
		const inside = s.message(meta(s.string, { description: 'd' }), 'text');
		assert.strictEqual(get_schema_meta(inside, 'description'), 'd');
		const nested = s.message(s.message(meta(s.string, { description: 'n' }), 'a'), 'b');
		assert.strictEqual(get_schema_meta(nested, 'description'), 'n');
		const layered = meta(s.message(meta(s.string, { description: 'in' }), 'text'), {
			introspect_aliases: ['a']
		});
		assert.strictEqual(get_schema_meta(layered, 'description'), 'in');
		assert.deepEqual(get_schema_meta(layered, 'introspect_aliases'), ['a']);
		const action = s.message(meta(s.min_length(1), { description: 'r' }), 'text');
		assert.strictEqual(get_schema_meta(action, 'description'), 'r');
	});

	test('reads metadata through flavor, brand, and a lazy', () => {
		const F = s.flavor(meta(s.string, { description: 'd' }), 'F');
		assert.strictEqual(get_schema_meta(F, 'description'), 'd');
		const L = s.lazy(() => s.brand(meta(s.string, { description: 'l' }), 'B'));
		assert.strictEqual(get_schema_meta(L, 'description'), 'l');
	});
});

describe('find_schema_meta', () => {
	const mark = (schema: s.AnySchema, description: string): s.AnySchema =>
		meta(schema, { description });

	// every kind, which the types hold the table to: whether a mark on what it
	// holds is found always, only with `structural`, or it holds no schema
	const kinds: Record<
		s.SchemaKind,
		[(m: s.AnySchema) => s.AnySchema, 'always' | 'structural' | 'none']
	> = {
		string: [() => s.string, 'none'],
		number: [() => s.number, 'none'],
		boolean: [() => s.boolean, 'none'],
		bigint: [() => s.bigint, 'none'],
		unknown: [() => s.unknown, 'none'],
		literal: [() => s.literal('a'), 'none'],
		one_of: [() => s.one_of(['a', 1]), 'none'],
		optional: [(m) => s.optional(m), 'always'],
		nullable: [(m) => s.nullable(m), 'always'],
		with_default: [(m) => s.with_default(m, 'x'), 'always'],
		with_default_fn: [(m) => s.with_default_fn(m, () => 'x'), 'always'],
		lazy: [(m) => s.lazy(() => m), 'always'],
		object: [(m) => s.object({ a: m }), 'structural'],
		loose_object: [(m) => s.loose_object({ a: m }), 'structural'],
		strip_object: [(m) => s.strip_object({ a: m }), 'structural'],
		object_with_rest: [(m) => s.object_with_rest({ a: m }, s.number), 'structural'],
		record: [(m) => s.record(m), 'structural'],
		keyed_record: [(m) => s.keyed_record(s.string, m), 'structural'],
		array: [(m) => s.array(m), 'structural'],
		union: [(m) => s.union([s.number, m]), 'always'],
		// the option is what a variant holds, so it carries the mark
		variant: [
			() =>
				s.variant('t', [
					s.object({ t: s.literal('a') }),
					meta(s.object({ t: s.literal('b') }), { description: 'm' })
				]),
			'always'
		],
		pipe: [(m) => s.pipe(s.unknown, s.transform(String), m), 'always'],
		min_length: [() => s.min_length(1), 'none'],
		max_length: [() => s.max_length(1), 'none'],
		min_value: [() => s.min_value(1), 'none'],
		max_value: [() => s.max_value(1), 'none'],
		integer: [() => s.integer, 'none'],
		safe_integer: [() => s.safe_integer, 'none'],
		regex: [() => s.regex(/a/), 'none'],
		uuid: [() => s.uuid, 'none'],
		iso_datetime: [() => s.iso_datetime, 'none'],
		to_lower_case: [() => s.to_lower_case, 'none'],
		to_integer: [() => s.to_integer(), 'none'],
		check: [() => s.check(() => true), 'none'],
		transform: [() => s.transform((v) => v), 'none']
	};
	for (const [kind, [make, reach]] of Object.entries(kinds)) {
		test(kind, () => {
			const schema = make(mark(s.string, 'm'));
			assert.strictEqual(schema.kind, kind);
			assert.deepEqual(find_schema_meta(schema, 'description'), reach === 'always' ? ['m'] : []);
			assert.deepEqual(
				find_schema_meta(schema, 'description', { structural: true }),
				reach === 'none' ? [] : ['m']
			);
			// its own mark, whatever it holds
			assert.deepEqual(find_schema_meta(mark(schema, 'own'), 'description').at(0), 'own');
		});
	}

	test('through a chain of wrappers, outermost first', () => {
		const A = mark(
			s.optional(mark(s.nullable(s.with_default(mark(s.string, 'c'), 'x')), 'b')),
			'a'
		);
		assert.deepEqual(find_schema_meta(A, 'description'), ['a', 'b', 'c']);
	});

	test('the key schema of a keyed_record, then its value schema, with structural', () => {
		const K = s.keyed_record(mark(s.string, 'key'), mark(s.number, 'value'));
		assert.deepEqual(find_schema_meta(K, 'description'), []);
		assert.deepEqual(find_schema_meta(K, 'description', { structural: true }), ['key', 'value']);
	});

	test('a later step of a pipe, where get_schema_meta reads only the first', () => {
		const Secret = mark(s.string, 'secret');
		const P = s.pipe(s.unknown, s.transform(String), Secret);
		assert.strictEqual(get_schema_meta(P, 'description'), undefined);
		assert.deepEqual(find_schema_meta(P, 'description'), ['secret']);
	});

	test('a mark on an action of a pipe', () => {
		const P = s.pipe(s.string, meta(s.min_length(1), { description: 'action' }));
		assert.deepEqual(find_schema_meta(P, 'description'), ['action']);
	});

	test('every option of a union and a memo_union, in order', () => {
		const U = s.union([mark(s.string, 'a'), s.number, mark(s.boolean, 'b')]);
		assert.deepEqual(find_schema_meta(U, 'description'), ['a', 'b']);
		const M = s.memo_union([s.number, mark(s.string, 'c')]);
		assert.deepEqual(find_schema_meta(M, 'description'), ['c']);
	});

	test('a recursive lazy ends, through wrappers alone too', () => {
		// `lazy(() => optional(L))` as `L`, which `get_schema_meta` never ends on
		const L: s.AnySchema = mark(
			s.lazy(() => s.optional(L)),
			'l'
		);
		assert.deepEqual(find_schema_meta(L, 'description'), ['l']);
		let calls = 0;
		const Tree: s.AnySchema = s.object({
			v: mark(s.number, 'v'),
			children: s.array(
				s.lazy(() => {
					calls++;
					return Tree;
				})
			)
		});
		assert.deepEqual(find_schema_meta(Tree, 'description', { structural: true }), ['v']);
		assert.strictEqual(calls, 1);
	});

	test('object entries and their rest only with structural', () => {
		const O = s.object_with_rest(
			{ a: mark(s.string, 'a'), b: s.array(mark(s.string, 'b')) },
			s.record(mark(s.number, 'rest'))
		);
		assert.deepEqual(find_schema_meta(O, 'description'), []);
		assert.deepEqual(find_schema_meta(O, 'description', { structural: true }), ['a', 'b', 'rest']);
	});

	test('structural reaches the entries of a variant option', () => {
		const V = s.variant('t', [
			s.object({ t: s.literal('a'), x: mark(s.string, 'entry') }),
			s.object({ t: s.literal('b') })
		]);
		assert.deepEqual(find_schema_meta(V, 'description'), []);
		assert.deepEqual(find_schema_meta(V, 'description', { structural: true }), ['entry']);
	});

	test('a mark past message, inside a pipe step or a lazy result', () => {
		const P = s.message(
			mark(s.pipe(s.unknown, s.transform(String), mark(s.string, 'step')), 'pipe'),
			'x'
		);
		assert.deepEqual(find_schema_meta(P, 'description'), ['pipe', 'step']);
		const L = s.message(
			mark(
				s.lazy(() => mark(s.string, 'lazy')),
				'own'
			),
			'x'
		);
		assert.deepEqual(find_schema_meta(L, 'description'), ['own', 'lazy']);
	});

	test('a value once for each schema object it is on', () => {
		const Shared = mark(s.string, 'd');
		const U = s.union([Shared, s.optional(Shared), mark(s.number, 'd')]);
		assert.deepEqual(find_schema_meta(U, 'description'), ['d', 'd']);
	});

	test('passes a key given as undefined, and reads merged keys', () => {
		const A = meta(s.optional(meta(s.string, { introspect_aliases: ['a'] })), {
			description: undefined,
			introspect_aliases: ['b']
		});
		assert.deepEqual(find_schema_meta(A, 'description'), []);
		assert.deepEqual(find_schema_meta(A, 'introspect_aliases'), [['b'], ['a']]);
	});

	test('through flavor, brand, and message', () => {
		assert.deepEqual(find_schema_meta(s.flavor(mark(s.string, 'f'), 'F'), 'description'), ['f']);
		assert.deepEqual(find_schema_meta(s.brand(mark(s.string, 'b'), 'B'), 'description'), ['b']);
		// `message` carries the metadata of the schema it was given over to the one it makes
		assert.deepEqual(find_schema_meta(s.message(mark(s.string, 'm'), 'x'), 'description'), ['m']);
		assert.deepEqual(
			find_schema_meta(s.message(s.message(mark(s.string, 'n'), 'x'), 'y'), 'description'),
			['n']
		);
		// what its `def` holds is still read
		assert.deepEqual(
			find_schema_meta(s.message(s.optional(mark(s.string, 'in')), 'x'), 'description'),
			['in']
		);
		// a step under message, an action and a refinement, inside a pipe
		const P = s.pipe(
			s.string,
			s.message(mark(s.min_length(1), 'refinement'), 'x'),
			s.message(mark(s.transform(Number), 'action'), 'y')
		);
		assert.deepEqual(find_schema_meta(P, 'description'), ['refinement', 'action']);
	});
});

describe('get_schema_entries', () => {
	test('every object kind, under wrappers', () => {
		const entries = { a: s.string };
		for (const O of [s.object(entries), s.loose_object(entries), s.strip_object(entries)]) {
			assert.strictEqual(get_schema_entries(s.with_default(O, { a: '' })), entries);
			assert.strictEqual(get_schema_entries(s.lazy(() => s.message(O, 'm'))), entries);
		}
	});

	test('the entries of an object_with_rest, without its rest', () => {
		const entries = { a: s.string };
		const O = s.object_with_rest(entries, s.object({ r: s.string }));
		assert.strictEqual(get_schema_entries(O), entries);
		assert.strictEqual(get_schema_entries(s.optional(s.lazy(() => s.message(O, 'm')))), entries);
	});

	test('undefined for a schema that is no object', () => {
		assert.strictEqual(get_schema_entries(s.string), undefined);
		assert.strictEqual(get_schema_entries(s.array(s.object({}))), undefined);
		assert.strictEqual(get_schema_entries(s.union([s.object({}), s.string])), undefined);
		assert.strictEqual(
			get_schema_entries(s.variant('k', [s.object({ k: s.literal('a') })])),
			undefined
		);
	});
});

describe('get_schema_fields', () => {
	test('reads each entry in order', () => {
		const Args = s.object({
			_: meta(s.with_default(s.array(s.string), []), { description: 'positionals' }),
			force: s.with_default(meta(s.boolean, { description: 'force it' }), false),
			name: s.optional(s.nullable(s.string)),
			count: s.pipe(s.number, s.integer)
		});
		const fields = get_schema_fields(Args);
		assert.deepEqual(
			fields.map(({ name, has_default, default: d, description }) => ({
				name,
				has_default,
				default: d,
				description
			})),
			[
				{ name: '_', has_default: true, default: [], description: 'positionals' },
				{ name: 'force', has_default: true, default: false, description: 'force it' },
				{ name: 'name', has_default: false, default: undefined, description: undefined },
				{ name: 'count', has_default: false, default: undefined, description: undefined }
			]
		);
		assert.strictEqual(fields[0]!.schema, Args.def._);
	});

	test('a description through message', () => {
		const fields = get_schema_fields(
			s.object({
				a: s.message(meta(s.string, { description: 'a' }), 'x'),
				b: s.message(s.with_default(meta(s.number, { description: 'b' }), 1), 'y')
			})
		);
		assert.deepEqual(
			fields.map((f) => [f.name, f.description, f.has_default]),
			[
				['a', 'a', false],
				['b', 'b', true]
			]
		);
	});

	test('the outermost default and description', () => {
		const inner = meta(s.with_default(s.string, 'a'), { description: 'inner' });
		const [field] = get_schema_fields(
			s.object({ a: meta(s.nullable(s.with_default(inner, 'b')), { description: 'outer' }) })
		);
		assert.strictEqual(field!.default, 'b');
		assert.strictEqual(field!.description, 'outer');
	});

	test('no default under an optional, which answers first', () => {
		const O = s.object({
			a: s.optional(s.with_default(s.string, 'a')),
			b: s.pipe(
				s.optional(s.with_default(s.string, 'b')),
				s.check(() => true)
			),
			c: s.with_default(s.optional(s.with_default(s.string, 'x')), 'c')
		});
		assert.deepEqual<unknown>(s.parse(O, {}), { ok: true, value: { c: 'c' } });
		assert.deepEqual(
			get_schema_fields(O).map((f) => [f.has_default, f.default]),
			[
				[false, undefined],
				[false, undefined],
				[true, 'c']
			]
		);
	});

	test('tells a default of undefined from none', () => {
		const [with_undefined, none] = get_schema_fields(
			s.object({ a: s.with_default(s.optional(s.string), undefined), b: s.optional(s.string) })
		);
		assert.ok(with_undefined!.has_default);
		assert.strictEqual(with_undefined!.default, undefined);
		assert.ok(!none!.has_default);
	});

	test('reads a default under nullable and through a lazy', () => {
		const [a, b] = get_schema_fields(
			s.object({
				a: s.nullable(s.with_default(s.number, 1)),
				b: s.lazy(() => s.with_default(s.string, 'l'))
			})
		);
		assert.strictEqual(a!.default, 1);
		assert.strictEqual(b!.default, 'l');
	});

	test('a default made by a function is computed, and never made to read it', () => {
		let made = 0;
		const make = (): Array<string> => (made++, []);
		const [a, b, c, d] = get_schema_fields(
			s.object({
				a: meta(s.with_default_fn(s.array(s.string), make), { description: 'made' }),
				b: s.nullable(s.lazy(() => s.with_default_fn(s.array(s.string), make))),
				c: s.optional(s.with_default_fn(s.array(s.string), make)),
				d: s.with_default_fn(s.with_default(s.array(s.string), ['x']), make)
			})
		);
		assert.deepEqual(
			[a, b, c, d].map((f) => [f!.has_default, f!.default_computed, f!.default]),
			[
				[true, true, undefined],
				[true, true, undefined],
				// an `optional` outside it answers first
				[false, false, undefined],
				// the outermost default is the one asked
				[true, true, undefined]
			]
		);
		assert.strictEqual(a!.description, 'made');
		// a value default is not computed
		const [v] = get_schema_fields(s.object({ v: s.with_default(s.number, 1) }));
		assert.ok(!v!.default_computed);
		assert.strictEqual(made, 0);
	});

	test('a union is not looked into', () => {
		const [field] = get_schema_fields(
			s.object({ a: s.union([s.string, s.with_default(s.number, 1)]) })
		);
		assert.ok(!field!.has_default);
	});

	test('reads the entries of an object_with_rest, and not its rest', () => {
		let made = 0;
		const Args = s.object_with_rest(
			{
				_: s.with_default_fn(meta(s.array(s.string), { description: 'the file path' }), () => {
					made++;
					return [];
				}),
				force: meta(s.optional(s.boolean), { introspect_aliases: ['f'] })
			},
			meta(s.union([s.string, s.number]), { description: 'any other' })
		);
		assert.deepEqual(
			get_schema_fields(Args).map((f) => [
				f.name,
				f.has_default,
				f.default_computed,
				f.description
			]),
			[
				['_', true, true, 'the file path'],
				['force', false, false, undefined]
			]
		);
		assert.deepEqual(get_schema_meta(Args.def.entries.force, 'introspect_aliases'), ['f']);
		assert.strictEqual(unwrap_schema(Args.def.entries.force).kind, 'boolean');
		assert.strictEqual(made, 0);
	});

	test('none for a schema that is no object', () => {
		assert.deepEqual(get_schema_fields(s.string), []);
	});
});

describe('format_schema_type', () => {
	// every kind, which the types hold the table to: a new kind is a row here,
	// with its text and whether it is a layer `unwrap_schema` walks through
	const kinds: Record<s.SchemaKind, [s.AnySchema, string, boolean]> = {
		string: [s.string, 'string', false],
		number: [s.number, 'number', false],
		boolean: [s.boolean, 'boolean', false],
		bigint: [s.bigint, 'bigint', false],
		unknown: [s.unknown, 'unknown', false],
		literal: [s.literal('a"b'), '"a\\"b"', false],
		one_of: [s.one_of(['a', 1, undefined]), '"a" | 1 | undefined', false],
		optional: [s.optional(s.string), 'string | undefined', true],
		nullable: [s.nullable(s.string), 'string | null', true],
		with_default: [s.with_default(s.boolean, true), 'boolean', true],
		with_default_fn: [s.with_default_fn(s.array(s.string), () => []), 'Array<string>', true],
		lazy: [s.lazy(() => s.number), 'number', true],
		object: [
			s.object({
				a: s.string,
				'b-c': s.optional(s.number),
				d: s.with_default(s.number, 1),
				e: s.with_default_fn(s.number, () => 1)
			}),
			'{a: string; "b-c"?: number | undefined; d?: number; e?: number}',
			false
		],
		loose_object: [s.loose_object({ a: s.string }), '{a: string; [key: string]: unknown}', false],
		object_with_rest: [
			s.object_with_rest(
				{ a: s.string, 'b-c': s.optional(s.number) },
				s.union([s.number, s.array(s.string)])
			),
			'{a: string; "b-c"?: number | undefined; [key: string]: number | Array<string>}',
			false
		],
		strip_object: [s.strip_object({}), '{}', false],
		record: [s.record(s.number), 'Record<string, number>', false],
		keyed_record: [
			s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.array(s.string)),
			'Record<string, Array<string>>',
			false
		],
		array: [s.array(s.optional(s.string)), 'Array<string | undefined>', false],
		union: [s.union([s.string, s.array(s.string)]), 'string | Array<string>', false],
		variant: [
			s.variant('t', [s.object({ t: s.literal('a') }), s.object({ t: s.literal('b') })]),
			'{t: "a"} | {t: "b"}',
			false
		],
		pipe: [s.pipe(s.string, s.min_length(1)), 'string', true],
		min_length: [s.min_length(1), 'min_length', false],
		max_length: [s.max_length(1), 'max_length', false],
		min_value: [s.min_value(1), 'min_value', false],
		max_value: [s.max_value(1), 'max_value', false],
		integer: [s.integer, 'integer', false],
		safe_integer: [s.safe_integer, 'safe_integer', false],
		regex: [s.regex(/a/), 'regex', false],
		uuid: [s.uuid, 'uuid', false],
		iso_datetime: [s.iso_datetime, 'iso_datetime', false],
		to_lower_case: [s.to_lower_case, 'to_lower_case', false],
		to_integer: [s.to_integer(), 'to_integer', false],
		check: [s.check(() => true), 'check', false],
		transform: [s.transform((v) => v), 'transform', false]
	};
	for (const [kind, [schema, expected, layer]] of Object.entries(kinds)) {
		test(kind, () => {
			assert.strictEqual(schema.kind, kind);
			assert.strictEqual(format_schema_type(schema), expected);
			assert.strictEqual(unwrap_schema(schema) !== schema, layer);
		});
	}

	test('a keyed_record of a finite key set renders the keys as K', () => {
		assert.strictEqual(
			format_schema_type(s.keyed_record(s.one_of(['a', 'b']), s.number)),
			'Record<"a" | "b", number>'
		);
		assert.strictEqual(
			format_schema_type(s.keyed_record(s.literal('x'), s.optional(s.string))),
			'Record<"x", string | undefined>'
		);
		// not an object schema of entries
		assert.strictEqual(get_schema_entries(s.keyed_record(s.string, s.number)), undefined);
		assert.deepEqual(get_schema_fields(s.keyed_record(s.string, s.number)), []);
	});

	test('a memo_union reads as the union it is', () => {
		const memo = s.memo_union([s.string, s.array(s.string)]);
		assert.strictEqual(format_schema_type(memo), 'string | Array<string>');
		assert.strictEqual(unwrap_schema(memo), memo);
		// not looked into, as a union isn't
		const [field] = get_schema_fields(
			s.object({ a: s.memo_union([s.string, s.with_default(s.number, 1)]) })
		);
		assert.ok(!field!.has_default);
	});

	test('the rest of an object_with_rest, inside a lazy', () => {
		const Tree: s.AnySchema = s.object_with_rest(
			{ v: s.number },
			s.lazy(() => Tree)
		);
		assert.strictEqual(format_schema_type(s.lazy(() => Tree)), '{v: number; [key: string]: ...}');
		assert.strictEqual(
			format_schema_type(s.object_with_rest({}, s.optional(s.string))),
			'{[key: string]: string | undefined}'
		);
	});

	test('literals', () => {
		assert.strictEqual(format_schema_type(s.literal(1n)), '1n');
		assert.strictEqual(format_schema_type(s.literal(null)), 'null');
		assert.strictEqual(format_schema_type(s.literal(undefined)), 'undefined');
		// `void` is that literal to every reader
		assert.strictEqual(format_schema_type(s.void), 'undefined');
		assert.strictEqual(format_schema_type(s.literal(false)), 'false');
	});

	test('message, flavor, brand, and meta render as what they were given', () => {
		const O = s.object({ a: s.string });
		const text = '{a: string}';
		assert.strictEqual(format_schema_type(s.message(O, 'm')), text);
		assert.strictEqual(format_schema_type(s.flavor(O, 'F')), text);
		assert.strictEqual(format_schema_type(meta(O, { description: 'd' })), text);
	});

	test('an entry whose pipe starts with an optional is marked optional', () => {
		assert.strictEqual(
			format_schema_type(
				s.object({
					a: s.pipe(
						s.optional(s.string),
						s.check(() => true)
					)
				})
			),
			'{a?: string | undefined}'
		);
	});

	test('a lazy renders what its function returns once, and a lazy inside it as ...', () => {
		const Tree: s.Schema = s.lazy(() => s.object({ children: s.array(Tree) }));
		assert.strictEqual(format_schema_type(Tree), '{children: Array<...>}');
		// recursive or not
		const nested = s.lazy(() => s.object({ a: s.lazy(() => s.string) }));
		assert.strictEqual(format_schema_type(nested), '{a: ...}');
	});

	test('a lazy that returns a lazy renders what that returns', () => {
		assert.strictEqual(format_schema_type(s.lazy(() => s.lazy(() => s.number))), 'number');
		const Tree: s.Schema = s.lazy(() => s.object({ children: s.array(Tree) }));
		assert.strictEqual(
			format_schema_type(s.object({ root: s.lazy(() => Tree) })),
			'{root: {children: Array<...>}}'
		);
	});

	test('every container passes the depth on', () => {
		const J: s.Schema = s.lazy(() =>
			s.union([
				s.nullable(
					s.with_default(
						s.pipe(
							J,
							s.check(() => true)
						),
						null
					)
				),
				s.record(J),
				s.variant('k', [s.object({ k: s.literal('a'), v: J })])
			])
		);
		assert.strictEqual(
			format_schema_type(J),
			'... | null | Record<string, ...> | {k: "a"; v: ...}'
		);
	});

	test('whatever its function builds', () => {
		// a new `lazy` of itself on each call, and a new function too
		const make = (): s.AnySchema => s.object({ child: s.optional(s.lazy(make)) });
		const make_inline = (): s.AnySchema =>
			s.object({ child: s.optional(s.lazy(() => make_inline())) });
		for (const m of [make, make_inline]) {
			assert.strictEqual(format_schema_type(s.lazy(m)), '{child?: ... | undefined}');
			assert.strictEqual(
				format_schema_type(m()),
				'{child?: {child?: ... | undefined} | undefined}'
			);
			assert.strictEqual(get_schema_fields(m()).length, 1);
			assert.strictEqual(unwrap_schema(m()).kind, 'object');
		}
	});

	test('a recursive object shows one level of itself under each lazy', () => {
		const Bin: s.Schema = s.object({
			left: s.optional(s.lazy(() => Bin)),
			right: s.optional(s.lazy(() => Bin))
		});
		assert.strictEqual(
			format_schema_type(Bin),
			'{left?: {left?: ... | undefined; right?: ... | undefined} | undefined; ' +
				'right?: {left?: ... | undefined; right?: ... | undefined} | undefined}'
		);
		const entries: Record<string, s.AnySchema> = {};
		const N: s.Schema = s.object(entries);
		for (let i = 0; i < 8; i++) entries['f' + i] = s.optional(s.lazy(() => N));
		const inner = `{${Object.keys(entries)
			.map((k) => `${k}?: ... | undefined`)
			.join('; ')}}`;
		assert.strictEqual(
			format_schema_type(N),
			`{${Object.keys(entries)
				.map((k) => `${k}?: ${inner} | undefined`)
				.join('; ')}}`
		);
	});

	test('the text of a recursive schema is bounded', () => {
		// each entry's function builds a new wrapper around the object
		const entries: Record<string, s.AnySchema> = {};
		const N: s.Schema = s.object(entries);
		for (let i = 0; i < 8; i++) entries['f' + i] = s.lazy(() => s.optional(N));
		assert.ok(format_schema_type(N).length < 10_000);
		// objects each with an entry for every one of them
		const all: Array<Record<string, s.AnySchema>> = [];
		const objects: Array<s.Schema> = [];
		for (let i = 0; i < 8; i++) {
			all.push({});
			objects.push(s.object(all[i]!));
		}
		for (const e of all) {
			for (let j = 0; j < 8; j++) e['f' + j] = s.optional(s.lazy(() => objects[j]!));
		}
		assert.ok(format_schema_type(objects[0]!).length < 10_000);
	});

	test('a lazy reached twice side by side renders both times', () => {
		const L = s.lazy(() => s.string);
		assert.strictEqual(format_schema_type(s.object({ a: L, b: L })), '{a: string; b: string}');
	});
});

describe('reading', () => {
	test('writes to no schema', () => {
		for (const make of Object.values(SHAPE_SAMPLES)) {
			for (const { schema } of make()) {
				if (typeof schema.def === 'object' && schema.def !== null) Object.freeze(schema.def);
				const frozen = s.object({ a: Object.freeze(schema) });
				Object.freeze(frozen.def);
				Object.freeze(frozen);
				unwrap_schema(frozen);
				get_schema_meta(schema, 'description');
				find_schema_meta(frozen, 'description', { structural: true });
				get_schema_fields(frozen);
				format_schema_type(frozen);
			}
		}
	});
});
