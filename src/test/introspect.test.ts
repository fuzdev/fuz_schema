import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta } from '#lib/meta.ts';
import {
	unwrap_schema,
	get_schema_meta,
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

	test('finds metadata outside message and not inside it', () => {
		const outside = meta(s.message(s.string, 'text'), { description: 'd' });
		assert.strictEqual(get_schema_meta(outside, 'description'), 'd');
		const inside = s.message(meta(s.string, { description: 'd' }), 'text');
		assert.strictEqual(get_schema_meta(inside, 'description'), undefined);
	});

	test('reads metadata through flavor, brand, and a lazy', () => {
		const F = s.flavor(meta(s.string, { description: 'd' }), 'F');
		assert.strictEqual(get_schema_meta(F, 'description'), 'd');
		const L = s.lazy(() => s.brand(meta(s.string, { description: 'l' }), 'B'));
		assert.strictEqual(get_schema_meta(L, 'description'), 'l');
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
		strip_object: [s.strip_object({}), '{}', false],
		record: [s.record(s.number), 'Record<string, number>', false],
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

	test('literals', () => {
		assert.strictEqual(format_schema_type(s.literal(1n)), '1n');
		assert.strictEqual(format_schema_type(s.literal(null)), 'null');
		assert.strictEqual(format_schema_type(s.literal(undefined)), 'undefined');
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
				get_schema_fields(frozen);
				format_schema_type(frozen);
			}
		}
	});
});
