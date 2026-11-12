import { describe, test, assert } from 'vitest';
import { readFileSync } from 'node:fs';

import * as s from '#lib/schema.ts';
import { meta as attach, type SchemaMeta } from '#lib/meta.ts';
import { to_json_schema, type JsonSchemaOptions } from '#lib/json_schema.ts';

// any keys, as a consumer adds them to `SchemaMeta` by declaration merging
const meta = <T extends s.Schema>(schema: T, data: Record<string, unknown>): T =>
	attach(schema, data as SchemaMeta);

const $schema = 'https://json-schema.org/draft/2020-12/schema';

// an identity escape, which `u` refuses
// eslint-disable-next-line no-useless-escape
const NO_U_PATTERN = /^\-$/;

// the decimal of every integer from 0 to `Number.MAX_SAFE_INTEGER`, with no leading zero
const SAFE_DIGITS =
	'\\d|[1-9]\\d{1,14}|[1-8]\\d{15}|900[0-6]\\d{12}|90070\\d{11}|90071[0-8]\\d{10}|900719[0-8]\\d{9}|9007199[0-1]\\d{8}|90071992[0-4]\\d{7}|900719925[0-3]\\d{6}|9007199254[0-6]\\d{5}|90071992547[0-3]\\d{4}|9007199254740[0-8]\\d{2}|90071992547409[0-8]\\d|900719925474099[0-1]';

// Unicode `White_Space`, as `to_json_schema` writes it
const WHITE_SPACE =
	'[\\t-\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*';

const OUTPUT: JsonSchemaOptions = { io: 'output' };
const INPUT: JsonSchemaOptions = { io: 'input' };
const ANY: JsonSchemaOptions = { unrepresentable: 'any' };
const INPUT_ANY: JsonSchemaOptions = { io: 'input', unrepresentable: 'any' };

// the document without `$schema`, loosely typed for comparing
const write = (schema: s.Schema, options?: JsonSchemaOptions): Record<string, any> => {
	const { $schema: written, ...rest } = to_json_schema(schema, options);
	assert.strictEqual(written, $schema);
	return rest;
};

const assert_throws = (f: () => unknown, message: string): void => {
	try {
		f();
	} catch (error) {
		assert.strictEqual((error as Error).message, message);
		return;
	}
	assert.fail(`did not throw: ${message}`);
};

describe('to_json_schema', () => {
	test('writes $schema first, for draft 2020-12', () => {
		const doc = to_json_schema(s.string);
		assert.deepEqual(Object.keys(doc), ['$schema', 'type']);
		assert.strictEqual(doc.$schema, $schema);
	});

	test('the primitives', () => {
		assert.deepEqual(write(s.string), { type: 'string' });
		assert.deepEqual(write(s.number), { type: 'number' });
		assert.deepEqual(write(s.boolean), { type: 'boolean' });
		assert.deepEqual(write(s.unknown), {});
		assert.deepEqual(write(s.integer), { type: 'integer' });
		assert.deepEqual(write(s.safe_integer), {
			type: 'integer',
			minimum: -Number.MAX_SAFE_INTEGER,
			maximum: Number.MAX_SAFE_INTEGER
		});
	});

	test('literal and one_of', () => {
		assert.deepEqual(write(s.literal('a')), { type: 'string', const: 'a' });
		assert.deepEqual(write(s.literal(null)), { type: 'null', const: null });
		assert.deepEqual(write(s.literal(true)), { type: 'boolean', const: true });
		assert.ok(Object.is(write(s.literal(-0)).const, 0), '-0 is 0');
		assert.deepEqual(write(s.one_of(['a', 'b'])), { type: 'string', enum: ['a', 'b'] });
		assert.deepEqual(write(s.one_of([1, 2])), { type: 'number', enum: [1, 2] });
		assert.deepEqual(write(s.one_of(['a', 1])), { enum: ['a', 1] });
		assert.deepEqual(write(s.one_of(['a'])), { type: 'string', const: 'a' });
		assert.deepEqual(write(s.one_of([])), { not: {} });
	});

	test('a literal JSON has no value for is unrepresentable', () => {
		assert_throws(
			() => to_json_schema(s.literal(undefined)),
			'cannot express `literal` at #: a literal of undefined is not JSON'
		);
		assert_throws(
			() => to_json_schema(s.literal(1n)),
			'cannot express `literal` at #: a literal of bigint is not JSON'
		);
		assert_throws(
			() => to_json_schema(s.one_of(['a', NaN])),
			'cannot express `one_of` at #: a literal of NaN is not JSON'
		);
		// `void` is that literal
		assert_throws(
			() => to_json_schema(s.void),
			'cannot express `literal` at #: a literal of undefined is not JSON'
		);
		assert.deepEqual(write(s.literal(undefined), ANY), {});
		assert.deepEqual(write(s.one_of(['a', undefined, 1n, Infinity]), ANY), {
			type: 'string',
			const: 'a'
		});
		assert.deepEqual(write(s.one_of([undefined]), ANY), {});
	});

	test('bigint is unrepresentable', () => {
		assert_throws(
			() => to_json_schema(s.bigint),
			'cannot express `bigint` at #: a bigint is not JSON'
		);
		assert.deepEqual(write(s.bigint, ANY), {});
	});

	describe('objects', () => {
		const entries = { a: s.string, b: s.optional(s.number) };
		const properties = { a: { type: 'string' }, b: { type: 'number' } };

		test('object is closed on both sides', () => {
			for (const options of [OUTPUT, INPUT]) {
				assert.deepEqual(write(s.object(entries), options), {
					type: 'object',
					properties,
					required: ['a'],
					additionalProperties: false
				});
			}
		});

		test('strip_object is closed on the output side only', () => {
			assert.deepEqual(write(s.strip_object(entries), OUTPUT), {
				type: 'object',
				properties,
				required: ['a'],
				additionalProperties: false
			});
			assert.deepEqual(write(s.strip_object(entries), INPUT), {
				type: 'object',
				properties,
				required: ['a']
			});
		});

		test('loose_object takes any other key', () => {
			for (const options of [OUTPUT, INPUT]) {
				assert.deepEqual(write(s.loose_object(entries), options), {
					type: 'object',
					properties,
					required: ['a'],
					additionalProperties: {}
				});
			}
		});

		test('object_with_rest takes other keys of its rest', () => {
			assert.deepEqual(write(s.object_with_rest(entries, s.boolean)), {
				type: 'object',
				properties,
				required: ['a'],
				additionalProperties: { type: 'boolean' }
			});
		});

		test('an empty object has properties and no required', () => {
			assert.deepEqual(write(s.object({})), {
				type: 'object',
				properties: {},
				additionalProperties: false
			});
		});

		test('record', () => {
			assert.deepEqual(write(s.record(s.number)), {
				type: 'object',
				propertyNames: { type: 'string' },
				additionalProperties: { type: 'number' }
			});
		});

		test('an entry named like a member of Object.prototype is refused in either mode', () => {
			for (const key of ['__proto__', 'constructor', 'toString']) {
				const entries = Object.defineProperty({}, key, { value: s.string, enumerable: true });
				for (const options of [OUTPUT, ANY]) {
					assert_throws(
						() => to_json_schema(s.object(entries), options),
						`cannot express \`object\` at #/properties/${key}: the entry is named like a member of Object.prototype`
					);
				}
			}
		});

		test('a path escapes its keys as a JSON Pointer does', () => {
			assert_throws(
				() => to_json_schema(s.object({ 'a/b~c': s.bigint })),
				'cannot express `bigint` at #/properties/a~1b~0c: a bigint is not JSON'
			);
		});
	});

	describe('which keys are required', () => {
		const required = (entry: s.Schema, options?: JsonSchemaOptions): boolean =>
			write(s.object({ a: entry }), options).required !== undefined;

		test('a key is optional under an optional, through what passes it on', () => {
			for (const entry of [
				s.optional(s.string),
				s.nullable(s.optional(s.string)),
				s.lazy(() => s.optional(s.string)),
				s.union([s.number, s.optional(s.string)]),
				s.pipe(
					s.optional(s.string),
					s.check(() => true)
				),
				s.message(s.optional(s.string), 'm'),
				s.optional(s.with_default(s.string, 'x'))
			]) {
				assert.ok(!required(entry, ANY), 'output');
				assert.ok(!required(entry, INPUT_ANY), 'input');
			}
		});

		test('a default is required on the output side and optional on the input', () => {
			for (const entry of [
				s.with_default(s.string, 'x'),
				s.with_default_fn(s.string, () => 'x'),
				s.nullable(s.with_default(s.string, 'x')),
				s.union([s.number, s.with_default(s.string, 'x')])
			]) {
				assert.ok(required(entry, OUTPUT), 'output');
				assert.ok(!required(entry, INPUT), 'input');
			}
		});

		test('a default of undefined leaves the key out, and writes no default', () => {
			const entry = s.with_default(s.unknown, undefined);
			assert.ok(!required(entry, OUTPUT));
			assert.deepEqual(write(s.object({ a: entry })).properties, { a: {} });
		});

		test('unknown needs its key, as the library does', () => {
			assert.ok(required(s.unknown));
			assert.ok(required(s.nullable(s.unknown)));
		});

		test('a transform after an optional', () => {
			const entry = s.pipe(
				s.optional(s.string),
				s.transform((x) => x)
			);
			// as the entry, no step runs for a missing key, which stays out
			assert.ok(!required(entry, ANY));
			assert.ok(!required(entry, INPUT_ANY));
			// under a nullable the steps run, and the transform gives the key
			assert.ok(required(s.nullable(entry), ANY));
			assert.ok(!required(s.nullable(entry), INPUT_ANY));
		});

		test('a bare transform is optional on the input side', () => {
			const entry = s.transform((x) => x);
			assert.ok(required(entry, ANY));
			assert.ok(!required(entry, INPUT_ANY));
		});

		// the key is required on the output side where the parse of `{}` writes it,
		// and on the input side where it refuses `{}`, both asked of the library too
		const assert_sides = (entry: s.Schema, output: boolean, input: boolean): void => {
			const schema = s.object({ a: entry });
			const result = s.parse(schema, {});
			assert.strictEqual(required(entry, ANY), output, 'output');
			assert.strictEqual(required(entry, INPUT_ANY), input, 'input');
			assert.strictEqual(!s.is(schema, {}), input, 'the library on the input side');
			if (result.ok) assert.strictEqual(Object.hasOwn(result.value, 'a'), output, 'the parse');
		};

		test('a union tries the options before one that fills the key in again', () => {
			for (const entry of [
				s.union([s.unknown, s.with_default(s.string, 'D')]),
				s.memo_union([s.unknown, s.with_default(s.string, 'D')]),
				s.union([s.lazy(() => s.unknown), s.with_default_fn(s.string, () => 'D')]),
				s.union([s.union([s.number, s.unknown]), s.with_default(s.string, 'D')]),
				s.union([s.nullable(s.unknown), s.with_default(s.string, 'D')]),
				s.union([s.literal(undefined), s.with_default(s.string, 'D')]),
				s.union([s.message(s.unknown, 'm'), s.with_default(s.string, 'D')]),
				// the inner union is handed no object or key, and fills the key in
				s.union([s.unknown, s.union([s.number, s.with_default(s.string, 'D')])])
			]) {
				assert_sides(entry, false, false);
			}
		});

		test("the first option that matches a missing key is the union's", () => {
			// an optional leaves the key out, and none is tried again
			assert_sides(s.union([s.optional(s.string), s.with_default(s.string, 'D')]), false, false);
			// a default first fills it in, with nothing before it
			assert_sides(s.union([s.with_default(s.string, 'D'), s.unknown]), true, false);
			// an option before it that takes no object or key isn't tried again
			assert_sides(s.union([s.string, s.with_default(s.string, 'D')]), true, false);
			// one tried again that fills the key in itself
			assert_sides(
				s.union([
					s.pipe(
						s.unknown,
						s.transform(() => 'U')
					),
					s.with_default(s.string, 'D')
				]),
				true,
				false
			);
			// a union that gives `undefined` inside another is that one's, tried no more
			assert_sides(
				s.union([
					s.pipe(
						s.unknown,
						s.transform(() => 'U')
					),
					s.union([s.unknown, s.with_default(s.string, 'D')])
				]),
				false,
				false
			);
			assert_sides(s.union([s.unknown, s.string]), true, true);
		});

		test('the steps of a pipe that starts with an optional run where it is not the entry', () => {
			// the types refuse an action that takes no `undefined` after an optional
			const entry = s.pipe(s.optional(s.number), s.min_value(1) as any);
			// as the entry no step runs, and the key stays out
			assert_sides(entry, false, false);
			// elsewhere the bound refuses the `undefined`
			assert_sides(s.union([entry]), true, true);
			assert_sides(s.nullable(entry), true, true);
			assert_sides(
				s.lazy(() => entry),
				true,
				true
			);
			assert_sides(s.union([s.pipe(s.optional(s.string), s.regex(/^u/) as any)]), false, false);
			assert_sides(s.union([s.pipe(s.optional(s.string), s.regex(/^x/) as any)]), true, true);
		});

		test('a check in a pipe that decides it leaves the key optional', () => {
			// the parse fills the key in, but which depends on what the check says
			const entry = s.union([
				s.pipe(
					s.unknown,
					s.check((v) => v !== undefined)
				),
				s.with_default(s.string, 'D')
			]);
			assert.deepEqual(s.parse(s.object({ a: entry }), {}), { ok: true, value: { a: 'D' } });
			assert.ok(!required(entry, ANY));
		});

		test('a bare check leaves the key optional with any, as it can take a missing key', () => {
			for (const entry of [
				s.check(() => true),
				s.nullable(s.check(() => true)),
				s.lazy(() => s.check(() => true)),
				s.union([s.unknown, s.check(() => true)])
			]) {
				assert_sides(entry, false, false);
			}
			// what it says decides it, so the key is optional though this one refuses it
			assert.ok(
				!required(
					s.check(() => false),
					ANY
				)
			);
			assert.ok(
				!required(
					s.check(() => false),
					INPUT_ANY
				)
			);
		});

		test('a one_of of undefined tried again without the key leaves it out', () => {
			assert_sides(s.union([s.one_of([undefined, 1]), s.with_default(s.number, 1)]), false, false);
		});
	});

	describe('wrappers and containers', () => {
		test('array', () => {
			assert.deepEqual(write(s.array(s.string)), { type: 'array', items: { type: 'string' } });
		});

		test('nullable folds bare types', () => {
			assert.deepEqual(write(s.nullable(s.string)), { type: ['string', 'null'] });
			assert.deepEqual(write(s.nullable(s.nullable(s.string))), { type: ['string', 'null'] });
			assert.deepEqual(write(s.nullable(s.literal('a'))), {
				anyOf: [{ type: 'string', const: 'a' }, { type: 'null' }]
			});
		});

		test('union and memo_union are anyOf, folded where bare', () => {
			for (const union of [s.union, s.memo_union]) {
				assert.deepEqual(write(union([s.string, s.number, s.string])), {
					type: ['string', 'number']
				});
				assert.deepEqual(write(union([s.string, s.array(s.number)])), {
					anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }]
				});
			}
		});

		test('variant is oneOf', () => {
			assert.deepEqual(
				write(s.variant('t', [s.object({ t: s.literal('a') }), s.object({ t: s.literal('b') })])),
				{
					oneOf: ['a', 'b'].map((t) => ({
						type: 'object',
						properties: { t: { type: 'string', const: t } },
						required: ['t'],
						additionalProperties: false
					}))
				}
			);
		});

		test('variant is anyOf where a discriminator is no const, as with any', () => {
			const schema = s.variant('t', [
				s.object({ t: s.literal(undefined) }),
				s.object({ t: s.literal('b'), b: s.number })
			]);
			const doc = write(schema, ANY);
			assert.strictEqual(doc.oneOf, undefined);
			assert.deepEqual(doc.anyOf[1].properties.t, { type: 'string', const: 'b' });
			// both options match it, and the variant takes it
			const value = { t: 'b', b: 1 };
			assert.ok(s.is(schema, value));
			assert.strictEqual(doc.anyOf.length, 2);
		});

		test('variant leaves out an option a later one shares the discriminator of', () => {
			const schema = s.variant('t', [
				s.object({ t: s.literal(0), a: s.string }),
				s.object({ t: s.literal(-0), b: s.number })
			]);
			assert.ok(!s.is(schema, { t: 0, a: 'x' }));
			assert.ok(s.is(schema, { t: 0, b: 1 }));
			assert.deepEqual(write(schema), {
				oneOf: [
					{
						type: 'object',
						properties: { t: { type: 'number', const: 0 }, b: { type: 'number' } },
						required: ['t', 'b'],
						additionalProperties: false
					}
				]
			});
		});

		test('a variant option whose discriminator is no literal entry is unrepresentable', () => {
			const b = s.object({ t: s.literal('b') });
			const rows: Array<[s.AnySchema, Array<unknown>]> = [
				// picked where `t` is missing, as `string`'s `def` is `undefined`
				[s.variant('t', [s.object({ t: s.string }), b]), [{ t: 'zz' }]],
				[s.variant('t', [s.object({ t: s.optional(s.literal('a')) }), b]), [{ t: 'a' }, {}]],
				[s.variant('t', [s.object({ t: s.nullable(s.literal('a')) }), b]), [{ t: 'a' }]],
				[s.variant('t', [s.object({ t: s.one_of(['a', 'c']) }), b]), [{ t: 'a' }]],
				[s.variant('t', [s.object({ t: s.pipe(s.number, s.min_value(5)) }), b]), [{ t: 5 }]],
				// the rest's `literal` is what `def.rest` holds, which no entry is
				[s.variant('rest', [s.object_with_rest({}, s.literal('a')) as any]), [{ x: 'a' }]]
			];
			for (const [schema, refused] of rows) {
				for (const options of [OUTPUT, INPUT]) {
					assert.throws(
						() => to_json_schema(schema, options),
						/^cannot express `variant` at #\/anyOf\/0: its discriminator is not a `literal` entry$/
					);
				}
				for (const value of refused) assert.ok(!s.is(schema, value), JSON.stringify(value));
				// with 'any', the option is kept, and the document is anyOf
				const doc = write(schema, INPUT_ANY);
				assert.strictEqual(doc.oneOf, undefined);
				assert.ok(doc.anyOf.length >= 1);
			}
		});

		test('a variant option whose discriminator is a literal under message or meta is written', () => {
			for (const t of [s.message(s.literal('a'), 'm'), meta(s.literal('a'), { title: 'A' })]) {
				const doc = write(s.variant('t', [s.object({ t }), s.object({ t: s.literal('b') })]));
				assert.strictEqual(doc.oneOf.length, 2);
				assert.strictEqual(doc.oneOf[0].properties.t.const, 'a');
			}
		});

		test('with_default writes its value, as JSON', () => {
			assert.deepEqual(write(s.with_default(s.array(s.number), [1, -0])), {
				type: 'array',
				items: { type: 'number' },
				default: [1, 0]
			});
		});

		test('a default that is not JSON is unrepresentable', () => {
			for (const [value, what] of [
				[1n, 'a bigint'],
				[new Date(0), 'an object that is not plain'],
				[new Array<number>(2).fill(1, 0, 1), 'an array with a hole, or a key that is not an item'],
				[
					Object.assign(new Array<number>(3), { 0: 1, 2: 3, x: 1 }),
					'an array with a hole, or a key that is not an item'
				],
				[Object.assign([1, 2], { x: 1 }), 'an array with a hole, or a key that is not an item'],
				[{ a: undefined }, 'an `undefined`'],
				[NaN, 'a number past the finite ones']
			] as const) {
				assert_throws(
					() => to_json_schema(s.with_default(s.unknown, value)),
					`cannot express \`with_default\` at #: the default is ${what}`
				);
				assert.deepEqual(write(s.with_default(s.unknown, value), ANY), {});
			}
			const self: Record<string, unknown> = {};
			self.self = self;
			assert_throws(
				() => to_json_schema(s.with_default(s.unknown, self)),
				'cannot express `with_default` at #: the default is a value that holds itself'
			);
		});

		test('with_default_fn writes no default, and never calls make', () => {
			const make = (): never => assert.fail('make was called');
			assert.deepEqual(write(s.with_default_fn(s.string, make)), { type: 'string' });
			// nor the default of what it holds, which `make` replaces, but its own metadata's
			const inner = s.with_default(s.string, 'a');
			assert.deepEqual(write(s.with_default_fn(inner, make)), { type: 'string' });
			assert.deepEqual(write(s.with_default_fn(meta(s.string, { default: 'a' }), make), INPUT), {
				type: 'string'
			});
			assert.deepEqual(write(meta(s.with_default_fn(inner, make), { default: 'c' })), {
				type: 'string',
				default: 'c'
			});
			// and what it holds is written as it is elsewhere
			assert.deepEqual(write(s.object({ a: inner, b: s.with_default_fn(inner, make) })), {
				type: 'object',
				properties: { a: { type: 'string', default: 'a' }, b: { type: 'string' } },
				required: ['a', 'b'],
				additionalProperties: false
			});
		});

		test('a default over a transform is left out on the input side, as zod does', () => {
			const schema = s.with_default(
				s.pipe(
					s.string,
					s.transform((x) => x)
				),
				'x'
			);
			assert.deepEqual(write(schema, ANY), { default: 'x' });
			assert.deepEqual(write(schema, INPUT), { type: 'string' });
		});

		test('a default over a keyed_record whose keys or values transform is left out on the input side', () => {
			const trim = s.pipe(
				s.string,
				s.transform((k: string) => k.trim())
			);
			for (const schema of [
				s.with_default(s.keyed_record(trim, s.number), {}),
				s.with_default(s.keyed_record(s.string, s.pipe(s.number, s.transform(String))), {})
			]) {
				assert.deepEqual(write(schema, INPUT), {
					type: 'object',
					propertyNames: { type: 'string' },
					additionalProperties: { type: 'number' }
				});
			}
			// and written where neither does
			assert.deepEqual(write(s.with_default(s.keyed_record(s.string, s.number), {}), INPUT), {
				type: 'object',
				propertyNames: { type: 'string' },
				additionalProperties: { type: 'number' },
				default: {}
			});
		});

		test('message, brand, and flavor are transparent', () => {
			assert.deepEqual(write(s.message(s.string, 'm')), { type: 'string' });
			assert.deepEqual(write(s.brand(s.string, 'B')), { type: 'string' });
			assert.deepEqual(write(s.flavor(s.string, 'F')), { type: 'string' });
		});
	});

	describe('pipe', () => {
		test('lengths of a string and of an array, the tightest winning', () => {
			assert.deepEqual(
				write(s.pipe(s.string, s.min_length(2), s.min_length(4), s.max_length(9), s.max_length(5))),
				{ type: 'string', minLength: 4, maxLength: 5 }
			);
			assert.deepEqual(write(s.pipe(s.array(s.string), s.min_length(1), s.max_length(3))), {
				type: 'array',
				items: { type: 'string' },
				minItems: 1,
				maxItems: 3
			});
		});

		test('bounds and integers', () => {
			assert.deepEqual(write(s.pipe(s.number, s.min_value(-1), s.max_value(7), s.integer)), {
				type: 'integer',
				minimum: -1,
				maximum: 7
			});
			assert.deepEqual(write(s.pipe(s.number, s.safe_integer, s.min_value(3))), {
				type: 'integer',
				minimum: 3,
				maximum: Number.MAX_SAFE_INTEGER
			});
			assert.deepEqual(write(s.pipe(s.safe_integer, s.min_value(-1e20))), {
				type: 'integer',
				minimum: -Number.MAX_SAFE_INTEGER,
				maximum: Number.MAX_SAFE_INTEGER
			});
			// the action narrows a bound before it that is looser
			assert.deepEqual(write(s.pipe(s.number, s.min_value(-1e20), s.safe_integer)), {
				type: 'integer',
				minimum: -Number.MAX_SAFE_INTEGER,
				maximum: Number.MAX_SAFE_INTEGER
			});
		});

		test('formats and patterns', () => {
			const uuid = write(s.uuid);
			assert.strictEqual(uuid.format, 'uuid');
			assert.deepEqual(write(s.pipe(s.string, s.uuid)), uuid);
			assert.deepEqual(write(s.pipe(s.string, s.regex(/^a+$/u))), {
				type: 'string',
				pattern: '^a+$'
			});
			assert.deepEqual(write(s.pipe(s.string, s.regex(/a/), s.regex(/b/))), {
				type: 'string',
				allOf: [{ pattern: 'a' }, { pattern: 'b' }]
			});
			// as zod has it, the last format wins, and a regex has none
			assert.deepEqual(write(s.pipe(s.string, s.uuid, s.regex(/0/))), {
				type: 'string',
				allOf: [{ pattern: uuid.pattern }, { pattern: '0' }]
			});
			assert.strictEqual(write(s.pipe(s.string, s.regex(/0/), s.iso_datetime)).format, 'date-time');
		});

		test('to_lower_case writes nothing, and a step that reads another string is refused', () => {
			const uuid = write(s.uuid);
			const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
			for (const options of [OUTPUT, INPUT]) {
				assert.deepEqual(write(Uuid, options), uuid);
				assert.deepEqual(write(s.pipe(s.string, s.to_lower_case), options), { type: 'string' });
				// a uuid holds of either case, after it and before it
				assert.deepEqual(write(s.pipe(s.string, s.to_lower_case, s.uuid), options), uuid);
				assert.deepEqual(write(s.pipe(s.uuid, s.to_lower_case), options), uuid);
			}
			// after it, a step reads the lowercase, which the input is not: `is` refuses
			// `ABC` and every `T`, which the keywords would take
			const pattern = s.pipe(s.string, s.to_lower_case, s.regex(/^[a-z]+$/));
			const length = s.pipe(s.string, s.to_lower_case, s.min_length(2));
			const after = s.pipe(s.string, s.to_lower_case, s.iso_datetime);
			assert(s.is(pattern, 'ABC'));
			assert(s.is(length, 'İ'));
			assert(!s.is(after, '2024-01-01T00:00:00Z'));
			for (const [schema, kind] of [
				[pattern, 'regex'],
				[length, 'min_length'],
				[after, 'iso_datetime']
			] as const) {
				assert_throws(
					() => to_json_schema(schema, INPUT),
					`cannot express \`${kind}\` at #: it reads the lowercase of the input`
				);
				assert.deepEqual(write(schema, INPUT_ANY), { type: 'string' });
			}
			// on the output side it is the output's
			assert.deepEqual(write(pattern), { type: 'string', pattern: '^[a-z]+$' });
			assert.deepEqual(write(length), { type: 'string', minLength: 2 });
			// before it, a step reads what the output is the lowercase of: its
			// pattern refuses the output, and its length can, as `İ` lowercases to two
			const before = s.pipe(s.string, s.iso_datetime, s.to_lower_case);
			const output = s.parse(before, '2024-01-01T00:00:00Z');
			assert(output.ok && output.value === '2024-01-01t00:00:00z');
			const short = s.pipe(s.string, s.max_length(1), s.to_lower_case);
			assert.strictEqual(s.parse_or_throw(short, 'İ').length, 2);
			for (const [schema, kind] of [
				[before, 'iso_datetime'],
				[short, 'max_length'],
				[s.pipe(s.iso_datetime, s.to_lower_case), 'iso_datetime'],
				[s.pipe(s.string, s.regex(/^[A-Z]+$/), s.to_lower_case, s.min_length(1)), 'regex']
			] as const) {
				assert_throws(
					() => to_json_schema(schema),
					`cannot express \`${kind}\` at #: it reads what the output is the lowercase of`
				);
			}
			assert.deepEqual(write(before, ANY), { type: 'string' });
			assert.deepEqual(
				write(s.pipe(s.string, s.max_length(1), s.to_lower_case, s.min_length(1)), ANY),
				{ type: 'string', minLength: 1 }
			);
			// on the input side a step before it is the input's
			assert.deepEqual(write(before, INPUT), write(s.iso_datetime));
			assert.deepEqual(write(short, INPUT), { type: 'string', maxLength: 1 });
			// a default over it is written on both sides, as it is no transform
			const defaulted = s.with_default(s.pipe(s.string, s.to_lower_case), 'x');
			for (const options of [OUTPUT, INPUT]) {
				assert.deepEqual(write(defaulted, options), { type: 'string', default: 'x' });
			}
			// alone it reads any value, and throws on most
			assert_throws(
				() => to_json_schema(s.to_lower_case),
				'cannot express `to_lower_case` at #: it means something only in a pipe after a schema it fits'
			);
			assert_throws(
				() => to_json_schema(s.pipe(s.number, s.to_lower_case as any)),
				'cannot express `to_lower_case` at #: the action is not for numbers'
			);
		});

		test('to_integer is an integer on the output side, within the bounds after it', () => {
			const MAX = Number.MAX_SAFE_INTEGER;
			const all = { type: 'integer', minimum: -MAX, maximum: MAX };
			assert.deepEqual(write(s.pipe(s.string, s.to_integer())), all);
			// an unsigned grammar spells no integer below 0
			assert.deepEqual(write(s.pipe(s.string, s.to_integer({ unsigned: true, trim: true }))), {
				...all,
				minimum: 0
			});
			assert.deepEqual(write(s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000))), {
				type: 'integer',
				minimum: 1,
				maximum: 1000
			});
			// a bound with a fraction is as tight as the integers it leaves
			assert.deepEqual(
				write(s.pipe(s.string, s.to_integer(), s.min_value(-2.5), s.max_value(2.5))),
				{ type: 'integer', minimum: -2.5, maximum: 2.5 }
			);
			assert.deepEqual(
				write(s.pipe(s.string, s.to_integer(), s.safe_integer, s.integer, s.min_value(1))),
				{ ...all, minimum: 1 }
			);
			assert.deepEqual(write(s.pipe(s.pipe(s.string, s.to_integer()), s.max_value(9))), {
				...all,
				maximum: 9
			});
			// nothing of the string is of the integer, its metadata included, which
			// the input side keeps
			const head = s.pipe(
				meta(s.string, { description: 's', examples: ['5'] }),
				s.to_integer(),
				s.max_value(9)
			);
			assert.deepEqual(write(head), { ...all, maximum: 9 });
			assert.deepEqual(write(head, INPUT).examples, ['5']);
			assert.strictEqual(write(head, INPUT).description, 's');
			// a step that changes the string says nothing of the integer
			assert.deepEqual(write(s.pipe(s.string, s.to_lower_case, s.to_integer())), all);
			assert.deepEqual(
				write(
					s.pipe(
						s.string,
						s.transform((v: string) => v.trim()),
						s.to_integer()
					)
				),
				all
			);
			// one that asserts something of the string narrows what the output can be
			for (const [schema, kind] of [
				[s.pipe(s.string, s.max_length(4), s.to_integer()), 'max_length'],
				[s.pipe(s.string, s.regex(/^1/), s.to_integer()), 'regex'],
				[s.pipe(s.pipe(s.string, s.min_length(2)), s.to_integer()), 'min_length'],
				[s.pipe(s.uuid, s.to_integer()), 'uuid']
			] as const) {
				assert_throws(
					() => to_json_schema(schema),
					`cannot express \`${kind}\` at #: it reads the string the integer was read from`
				);
				assert.deepEqual(write(schema, ANY), all);
			}
			// after it, the steps are of a number
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.to_integer(), s.min_length(1) as any)),
				'cannot express `min_length` at #: the action is not for numbers'
			);
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.to_integer(), s.to_integer() as any)),
				'cannot express `to_integer` at #: the action is not for numbers'
			);
			assert_throws(
				() =>
					to_json_schema(
						s.pipe(
							s.string,
							s.to_integer(),
							s.check((n) => n > 0)
						)
					),
				'cannot express `check` at #: it holds a function'
			);
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.to_integer(), s.transform(String))),
				'cannot express `transform` at #: its output is not known'
			);
			// a default is the integer's, and the key is required
			assert.deepEqual(
				write(s.object({ a: s.with_default(s.pipe(s.string, s.to_integer()), 5) })),
				{
					type: 'object',
					properties: { a: { ...all, default: 5 } },
					required: ['a'],
					additionalProperties: false
				}
			);
		});

		test('to_integer is a pattern of the strings it reads on the input side', () => {
			const pattern = (schema: s.Schema, options = INPUT): unknown =>
				write(schema, options).pattern;
			assert.deepEqual(write(s.pipe(s.string, s.to_integer()), INPUT), {
				type: 'string',
				pattern: `^(?:\\+?0*(?:${SAFE_DIGITS})|-0*(?:${SAFE_DIGITS}))$`
			});
			// a `-0` reads as 0, so the `-` takes only zeros where 0 is the least
			assert.strictEqual(
				pattern(s.pipe(s.string, s.to_integer(), s.min_value(0))),
				`^(?:\\+?0*(?:${SAFE_DIGITS})|-0*(?:0))$`
			);
			assert.strictEqual(
				pattern(s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000))),
				'^(?:\\+?0*(?:[1-9]\\d{0,2}|1000))$'
			);
			assert.strictEqual(
				pattern(
					s.pipe(
						s.string,
						s.to_integer({ unsigned: true, trim: true }),
						s.min_value(1),
						s.max_value(65535)
					)
				),
				`^${WHITE_SPACE}(?:\\+?0*(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5]))${WHITE_SPACE}$`
			);
			assert.strictEqual(
				pattern(s.pipe(s.string, s.to_integer(), s.max_value(-3), s.min_value(-12))),
				'^(?:-0*(?:[3-9]|1[0-2]))$'
			);
			assert.strictEqual(
				pattern(s.pipe(s.string, s.to_integer(), s.min_value(-2.5), s.max_value(2.5))),
				'^(?:\\+?0*(?:[0-2])|-0*(?:[0-2]))$'
			);
			// no string reads as an integer of an empty range
			for (const schema of [
				s.pipe(s.string, s.to_integer(), s.min_value(5), s.max_value(3)),
				s.pipe(s.string, s.to_integer({ unsigned: true }), s.max_value(-1))
			]) {
				assert.deepEqual(write(schema, INPUT), { type: 'string', not: {} });
			}
			// the steps before it are of the string
			const safe = `^(?:\\+?0*(?:${SAFE_DIGITS})|-0*(?:${SAFE_DIGITS}))$`;
			assert.deepEqual(write(s.pipe(s.string, s.max_length(4), s.to_integer()), INPUT), {
				type: 'string',
				maxLength: 4,
				pattern: safe
			});
			assert.deepEqual(
				write(
					s.pipe(s.string, s.regex(/^1/), s.to_integer(), s.min_value(0), s.max_value(20)),
					INPUT
				),
				{
					type: 'string',
					allOf: [{ pattern: '^1' }, { pattern: '^(?:\\+?0*(?:\\d|1\\d|20)|-0*(?:0))$' }]
				}
			);
			// no character lowercases into or out of the grammar, so a `to_lower_case`
			// before it changes nothing it reads
			assert.deepEqual(
				write(s.pipe(s.string, s.to_lower_case, s.to_integer()), INPUT),
				write(s.pipe(s.string, s.to_integer()), INPUT)
			);
			assert_throws(
				() =>
					to_json_schema(
						s.pipe(
							s.string,
							s.transform((v: string) => v.trim()),
							s.to_integer()
						),
						INPUT
					),
				'cannot express `to_integer` at #: it reads the output of a transform, which is not known'
			);
			// a check after it is no pattern, and the bounds past it still are
			const checked = s.pipe(
				s.string,
				s.to_integer(),
				s.check((n) => n % 2 === 0),
				s.min_value(0),
				s.max_value(9)
			);
			assert_throws(
				() => to_json_schema(checked, INPUT),
				'cannot express `check` at #: it holds a function'
			);
			assert.strictEqual(pattern(checked, INPUT_ANY), '^(?:\\+?0*(?:\\d)|-0*(?:0))$');
			// the strings a transform after it is given are those it reads
			const mapped = s.pipe(
				s.string,
				s.to_integer(),
				s.max_value(9),
				s.min_value(0),
				s.transform(String)
			);
			assert.strictEqual(pattern(mapped), '^(?:\\+?0*(?:\\d)|-0*(?:0))$');
			assert_throws(
				() => to_json_schema(s.pipe(mapped, s.min_length(1)), INPUT),
				'cannot express `min_length` at #: it reads the output of a transform, which is not known'
			);
			// a default is the integer's, so the input leaves it out and the key optional
			assert.deepEqual(
				write(s.object({ a: s.with_default(s.pipe(s.string, s.to_integer()), 5) }), INPUT),
				{
					type: 'object',
					properties: { a: { type: 'string', pattern: safe } },
					additionalProperties: false
				}
			);
			// its own metadata but `examples` and `default`, which are the integer's,
			// and none of the bounds folded in
			const described = s.pipe(
				s.string,
				meta(s.to_integer(), { description: 'digits', examples: [5] }),
				meta(s.min_value(0), { description: 'not negative' })
			);
			assert.deepEqual(write(described, INPUT), {
				type: 'string',
				pattern: `^(?:\\+?0*(?:${SAFE_DIGITS})|-0*(?:0))$`,
				description: 'digits'
			});
			assert.deepEqual(write(described), {
				type: 'integer',
				minimum: 0,
				maximum: Number.MAX_SAFE_INTEGER,
				description: 'not negative',
				examples: [5]
			});
			// alone, or after another type, it means nothing
			for (const options of [OUTPUT, INPUT]) {
				assert_throws(
					() => to_json_schema(s.to_integer(), options),
					'cannot express `to_integer` at #: it means something only in a pipe after a schema it fits'
				);
				assert_throws(
					() => to_json_schema(s.pipe(s.number, s.to_integer() as any), options),
					'cannot express `to_integer` at #: the action is not for numbers'
				);
			}
		});

		test('no character lowercases into or out of what to_integer reads', () => {
			// so a `to_lower_case` before it changes nothing it reads, which its
			// pattern on the input side rests on
			const alphabet = /[0-9+\-\p{White_Space}]/u;
			const moved: Array<number> = [];
			for (let cp = 0; cp <= 0x10ffff; cp++) {
				if (cp >= 0xd800 && cp <= 0xdfff) continue;
				const c = String.fromCodePoint(cp);
				const lower = c.toLowerCase();
				if (lower !== c && (alphabet.test(c) || alphabet.test(lower))) {
					moved.push(cp);
				}
			}
			assert.deepEqual(moved, []);
			// nor in the context a final sigma reads
			for (const x of ['0', '+', '-', ' ', '\u0085', '\u3000']) {
				for (const text of ['\u03a3' + x, 'A\u03a3' + x, x + '\u03a3A']) {
					assert.strictEqual(
						text.toLowerCase().replace(/[^0-9+\-\p{White_Space}]/gu, ''),
						text.replace(/[^0-9+\-\p{White_Space}]/gu, '')
					);
				}
			}
		});

		test('the pattern of to_integer takes exactly the strings is takes', () => {
			const MAX = Number.MAX_SAFE_INTEGER;
			const bounds = [undefined, -MAX, -1001, -10, -1, -0.5, 0, 1, 9, 10, 99, 1000, MAX - 1, MAX];
			const texts = ['', '+', '-', '+-1', ' ', '1e3', '0x10', '1.0', '1_0', '\u0663', '\uff15'];
			for (const n of [0, 1, 9, 10, 11, 99, 100, 999, 1000, 1001, MAX - 1, MAX, MAX + 1]) {
				for (const sign of ['', '+', '-'])
					for (const zeros of ['', '0', '00']) {
						texts.push(sign + zeros + n);
					}
			}
			for (const space of [' ', '\t\n', '\u0085', '\u3000', '\ufeff', '\u200b', '\u180e']) {
				texts.push(space + '5', '5' + space, space + '-0' + space);
			}
			for (const unsigned of [false, true]) {
				for (const trim of [false, true]) {
					for (const lo of bounds) {
						for (const hi of bounds) {
							const steps: Array<any> = [s.to_integer({ unsigned, trim })];
							if (lo !== undefined) steps.push(s.min_value(lo));
							if (hi !== undefined) steps.push(s.max_value(hi));
							const schema = (s.pipe as any)(s.string, ...steps);
							const doc = write(schema, INPUT);
							// a validator reads a pattern with the flag `u`
							const re = doc.not ? undefined : new RegExp(doc.pattern, 'u');
							for (const text of texts) {
								assert.strictEqual(
									re ? re.test(text) : false,
									s.is(schema, text),
									JSON.stringify({ unsigned, trim, lo, hi, text })
								);
							}
						}
					}
				}
			}
		});

		test('a regex object is written once, and a format each time, as zod does', () => {
			const re = /a/;
			assert.deepEqual(write(s.pipe(s.string, s.regex(re), s.regex(re))), {
				type: 'string',
				pattern: 'a'
			});
			assert.deepEqual(write(s.pipe(s.string, s.regex(/a/), s.regex(/a/))), {
				type: 'string',
				allOf: [{ pattern: 'a' }, { pattern: 'a' }]
			});
			const uuid = write(s.uuid).pattern;
			assert.deepEqual(write(s.pipe(s.string, s.uuid, s.uuid)), {
				type: 'string',
				format: 'uuid',
				allOf: [{ pattern: uuid }, { pattern: uuid }]
			});
		});

		test('the patterns are the grammars of schema.ts and docs/formats.md', () => {
			const source = readFileSync(new URL('../lib/schema.ts', import.meta.url), 'utf8');
			const literal = /const ISO_DATETIME =\s*\/(.*)\/;/.exec(source)?.[1];
			assert.strictEqual(write(s.iso_datetime).pattern, literal);
			// `uuid` reads char codes, held to this grammar by schema.formats.test.ts
			const formats = readFileSync(new URL('../../docs/formats.md', import.meta.url), 'utf8');
			const grammar = /### `uuid`\n\n```\n(.*)\n```/.exec(formats)?.[1];
			assert.strictEqual(write(s.uuid).pattern, grammar);
		});

		test('a regex with flags past d and u is unrepresentable', () => {
			for (const re of [/a/i, /a/g, /a/m, /a/s, /a/v]) {
				assert_throws(
					() => to_json_schema(s.pipe(s.string, s.regex(re))),
					`cannot express \`regex\` at #: its flags ${JSON.stringify(re.flags)} are not JSON Schema's`
				);
				assert.deepEqual(write(s.pipe(s.string, s.regex(re)), ANY), { type: 'string' });
			}
			assert.deepEqual(write(s.pipe(s.string, s.regex(/a/du))).pattern, 'a');
		});

		test('a regex whose source is no pattern under u is unrepresentable', () => {
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.regex(NO_U_PATTERN))),
				'cannot express `regex` at #: its source is not a pattern under the flag u'
			);
			assert.deepEqual(write(s.pipe(s.string, s.regex(NO_U_PATTERN)), ANY), { type: 'string' });
			// one that compiles under `u` too, but matches other strings there, built
			// from strings, as TypeScript refuses these escapes in a literal without `u`
			for (const re of [
				...[
					String.raw`^\u{2}$`,
					String.raw`^[\u{2}]$`,
					String.raw`^\p{L}$`,
					String.raw`^[\p{L}]$`,
					String.raw`^\P{L}$`,
					// a surrogate, which under `u` is half of an astral character, which a
					// quantifier or a range takes whole, and so a plain one too
					'^a\u{1F600}?$',
					'^[a-\u{1F600}]$',
					'^\u{1F600}$',
					'^\uDE00$',
					String.raw`^a\uD83D\uDE00?$`,
					String.raw`^a\ud83d\ude00*$`,
					String.raw`^[a-\uD83D\uDE00]$`,
					String.raw`^\uDBFF$`,
					String.raw`^\uDC00$`
				].map((source) => RegExp(source)),
				/^(?i:k)$/,
				/^(?m:a|(?si-m:b))$/
			]) {
				assert_throws(
					() => to_json_schema(s.pipe(s.string, s.regex(re))),
					'cannot express `regex` at #: its source means something else under the flag u'
				);
				assert.deepEqual(write(s.pipe(s.string, s.regex(re)), ANY), { type: 'string' });
			}
			// the same under `u`, which a source with the flag is already read as
			for (const re of [
				/^\\p{1}$/,
				/^[\\]p{1}$/,
				/^\\uD83D$/,
				/^\uD7FF\uE000$/,
				/^\(?i:$/,
				/^[(?i:)]$/,
				/^(?-i:k)(?ms:a)\b[\b]$/,
				/^\p{L}$/u,
				/^(?i:k)$/u,
				/^a\u{1F600}?$/u
			]) {
				assert.strictEqual(write(s.pipe(s.string, s.regex(re))).pattern, re.source, re.source);
			}
			// written, though a validator's `.` takes an astral character this regex refuses
			assert.deepEqual(write(s.pipe(s.string, s.regex(/^.$/))), {
				type: 'string',
				pattern: '^.$'
			});
		});

		test('an action for another type, or after no fixed type, is unrepresentable', () => {
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.min_value(1) as any)),
				'cannot express `min_value` at #: the action is not for strings'
			);
			assert_throws(
				() => to_json_schema(s.pipe(s.unknown, s.min_length(1) as any)),
				'cannot express `min_length` at #: the schema before it fixes no type'
			);
			assert.deepEqual(write(s.pipe(s.unknown, s.min_length(1) as any), ANY), {});
		});

		test('a bound that is not finite, or a length that is not whole, is unrepresentable', () => {
			assert_throws(
				() => to_json_schema(s.pipe(s.number, s.min_value(-Infinity))),
				'cannot express `min_value` at #: the bound is not a finite number'
			);
			assert_throws(
				() => to_json_schema(s.pipe(s.string, s.min_length(1.5))),
				'cannot express `min_length` at #: the bound is not a whole number'
			);
			assert.deepEqual(write(s.pipe(s.number, s.max_value(Infinity)), ANY), { type: 'number' });
		});

		test('a check is refused, and left out with any', () => {
			const schema = s.object({
				a: s.pipe(
					s.string,
					s.check((v) => v !== '')
				)
			});
			assert_throws(
				() => to_json_schema(schema),
				'cannot express `check` at #/properties/a: it holds a function'
			);
			assert.deepEqual(write(schema, ANY).properties, { a: { type: 'string' } });
			// a `check_at` is a `check`
			const at = s.pipe(
				s.object({ a: s.string }),
				s.check_at('a', (v) => v.a !== '')
			);
			assert_throws(() => to_json_schema(at), 'cannot express `check` at #: it holds a function');
			assert.deepEqual(write(at, ANY), write(s.object({ a: s.string })));
		});

		test('a transform has no output, and its input is the steps before it', () => {
			const schema = s.pipe(
				s.string,
				s.min_length(1),
				s.transform((x) => x.length),
				s.min_value(2)
			);
			assert_throws(
				() => to_json_schema(schema),
				'cannot express `transform` at #: its output is not known'
			);
			assert.deepEqual(write(schema, ANY), {});
			// a step after it reads its output
			assert_throws(
				() => to_json_schema(schema, INPUT),
				'cannot express `min_value` at #: it reads the output of a transform, which is not known'
			);
			assert.deepEqual(write(schema, INPUT_ANY), { type: 'string', minLength: 1 });
			const last = s.pipe(
				s.string,
				s.min_length(1),
				s.transform((x) => x.length)
			);
			assert.deepEqual(write(last, INPUT), { type: 'string', minLength: 1 });
		});

		test('a pipe that starts with a pipe is one pipe', () => {
			assert.deepEqual(write(s.pipe(s.pipe(s.string, s.min_length(1)), s.max_length(2))), {
				type: 'string',
				minLength: 1,
				maxLength: 2
			});
		});
	});

	test('a bare action is unrepresentable', () => {
		for (const action of [
			s.min_length(1),
			s.max_value(1),
			s.regex(/a/),
			s.check(() => true),
			s.transform((x) => x)
		]) {
			assert_throws(
				() => to_json_schema(action),
				`cannot express \`${action.kind}\` at #: it means something only in a pipe after a schema it fits`
			);
			assert.deepEqual(write(action, ANY), {});
		}
	});

	test('a kind defined outside the library is unrepresentable', () => {
		const custom = { kind: 'custom', def: undefined, run: (v: unknown) => v } as s.Schema;
		assert_throws(
			() => to_json_schema(s.array(custom)),
			'cannot express `custom` at #/items: it is a kind defined outside the library'
		);
		assert.deepEqual(write(s.array(custom), ANY), { type: 'array', items: {} });
	});

	test('what is not a schema is refused', () => {
		assert_throws(
			() => to_json_schema(s.object({ a: { kind: 'string' } as any })),
			'cannot express at #/properties/a: not a schema'
		);
	});

	describe('lazy', () => {
		test('is written in place when it does not recurse, its function called once', () => {
			let calls = 0;
			const inner = s.lazy(() => (calls++, s.string));
			assert.deepEqual(write(s.object({ x: inner, y: inner })).properties, {
				x: { type: 'string' },
				y: { type: 'string' }
			});
			assert.strictEqual(calls, 1);
		});

		test('that recurses at the root refers to #', () => {
			const node: s.Schema = s.lazy(() => s.object({ a: s.array(node) }));
			assert.deepEqual(write(node), {
				type: 'object',
				properties: { a: { type: 'array', items: { $ref: '#' } } },
				required: ['a'],
				additionalProperties: false
			});
		});

		test('that recurses inside is in $defs, in the order met', () => {
			const a: s.Schema = s.lazy(() => s.union([s.number, s.array(a)]));
			const b: s.Schema = s.lazy(() => s.union([s.string, s.array(b)]));
			assert.deepEqual(write(s.object({ b, a, again: a })), {
				type: 'object',
				properties: {
					b: { $ref: '#/$defs/__schema0' },
					a: { $ref: '#/$defs/__schema1' },
					again: { $ref: '#/$defs/__schema1' }
				},
				required: ['b', 'a', 'again'],
				additionalProperties: false,
				$defs: {
					__schema0: {
						anyOf: [{ type: 'string' }, { type: 'array', items: { $ref: '#/$defs/__schema0' } }]
					},
					__schema1: {
						anyOf: [{ type: 'number' }, { type: 'array', items: { $ref: '#/$defs/__schema1' } }]
					}
				}
			});
		});
	});

	describe('a lazy that comes back to itself without reading into the value', () => {
		test('is refused in either mode', () => {
			const self: s.Schema = s.lazy(() => self);
			const option: s.Schema = s.lazy(() => s.union([s.string, option]));
			const nested: s.Schema = s.lazy(() => s.nullable(s.pipe(nested, s.min_length(1) as any)));
			for (const options of [OUTPUT, ANY, INPUT_ANY]) {
				assert_throws(
					() => to_json_schema(self, options),
					'cannot express `lazy` at #: the schema comes back to itself without reading into the value'
				);
				assert_throws(
					() => to_json_schema(s.object({ a: option }), options),
					'cannot express `lazy` at #/properties/a/anyOf/1: the schema comes back to itself without reading into the value'
				);
				assert_throws(
					() => to_json_schema(nested, options),
					'cannot express `lazy` at #/anyOf/0: the schema comes back to itself without reading into the value'
				);
			}
		});

		test('through an entry, an item, or a rest, is not', () => {
			const tree: s.Schema = s.lazy(() =>
				s.union([s.record(tree), s.object_with_rest({ a: tree }, tree), s.array(tree)])
			);
			assert.doesNotThrow(() => to_json_schema(tree));
		});
	});

	describe('metadata', () => {
		test('is copied into the node of its layer, the outer winning', () => {
			assert.deepEqual(
				write(
					meta(s.optional(meta(s.string, { description: 'inner', title: 't' })), {
						description: 'outer'
					})
				),
				{ type: 'string', description: 'outer', title: 't' }
			);
			assert.deepEqual(write(meta(s.nullable(s.string), { description: 'd' })), {
				type: ['string', 'null'],
				description: 'd'
			});
			// on an option, which then isn't bare
			assert.deepEqual(write(s.nullable(meta(s.string, { description: 'd' }))), {
				anyOf: [{ type: 'string', description: 'd' }, { type: 'null' }]
			});
		});

		test('of a pipe and of its steps is the pipe node', () => {
			assert.deepEqual(
				write(
					meta(s.pipe(meta(s.string, { title: 'head' }), meta(s.min_length(1), { other: 1 })), {
						description: 'd'
					})
				),
				{ type: 'string', minLength: 1, title: 'head', other: 1, description: 'd' }
			);
		});

		test('undefined clears a key of an inner layer', () => {
			assert.deepEqual(
				write(
					meta(s.optional(meta(s.string, { description: 'inner' })), { description: undefined })
				),
				{ type: 'string' }
			);
		});

		test('a key that is a keyword of JSON Schema is refused in either mode', () => {
			const refused = (schema: s.Schema, kind: string, key: string, path = '#'): void => {
				for (const options of [OUTPUT, INPUT, ANY]) {
					assert_throws(
						() => to_json_schema(schema, options),
						`cannot express \`${kind}\` at ${path}: the metadata key "${key}" is a keyword of JSON Schema`
					);
				}
			};
			refused(meta(s.string, { type: 'number' }), 'string', 'type');
			// over a keyword the pipe writes after it, or one it writes that differs
			refused(s.pipe(meta(s.string, { minLength: 5 }), s.min_length(3)), 'string', 'minLength');
			refused(s.pipe(meta(s.string, { pattern: 'x' }), s.regex(/y/)), 'string', 'pattern');
			// one of another node, or one not written at all
			refused(meta(s.nullable(s.literal('a')), { type: 'string' }), 'nullable', 'type');
			refused(
				meta(s.object({ a: s.optional(s.string) }), { required: ['a'] }),
				'object',
				'required'
			);
			refused(meta(s.string, { $schema: 'evil' }), 'string', '$schema');
			refused(meta(s.string, { if: {} }), 'string', 'if');
			refused(meta(s.string, { minimum: undefined }), 'string', 'minimum');
			// of an older draft or OpenAPI, which a validator may apply too
			for (const key of [
				'nullable',
				'dependencies',
				'additionalItems',
				'$recursiveRef',
				'$recursiveAnchor'
			]) {
				refused(meta(s.string, { [key]: true }), 'string', key);
			}
			const tree: s.Schema = s.lazy(() => s.union([s.string, s.array(tree)]));
			refused(meta(s.object({ a: tree }), { $defs: {} }), 'object', '$defs');
		});

		test('annotations and keys of no keyword are copied', () => {
			const data = {
				title: 't',
				description: 'd',
				examples: ['x'],
				deprecated: true,
				readOnly: true,
				writeOnly: false,
				$comment: 'c',
				contentMediaType: 'text/plain',
				contentEncoding: 'base64',
				contentSchema: { type: 'string' },
				sensitivity: 'secret',
				invalid_reason: 'r',
				empty_input_handler_guarded: true
			};
			assert.deepEqual(write(meta(s.string, data)), { type: 'string', ...data });
		});

		test('a default, the outer layer winning, as zod has it', () => {
			assert.deepEqual(write(meta(s.with_default(s.string, 'b'), { default: 'a' })), {
				type: 'string',
				default: 'a'
			});
			assert.deepEqual(write(s.with_default(meta(s.string, { default: 'a' }), 'b')), {
				type: 'string',
				default: 'b'
			});
			assert.deepEqual(write(meta(s.with_default(s.string, 'b'), { default: undefined })), {
				type: 'string'
			});
			assert_throws(
				() => to_json_schema(meta(s.string, { default: [1n] }), ANY),
				'cannot express `string` at #: the metadata "default" holds a bigint'
			);
		});

		test('a value that is not JSON is refused', () => {
			assert_throws(
				() => to_json_schema(meta(s.string, { other: () => 1 })),
				'cannot express `string` at #: the metadata "other" holds a function'
			);
			assert_throws(
				() => to_json_schema(meta(s.string, { other: [1n] }), ANY),
				'cannot express `string` at #: the metadata "other" holds a bigint'
			);
		});

		test('examples and a default of a transform are left out on the input side, as zod does', () => {
			const schema = meta(
				s.pipe(
					s.string,
					s.transform((x) => x)
				),
				{ examples: ['x'], default: 'x', description: 'd' }
			);
			assert.deepEqual(write(schema, ANY), { examples: ['x'], default: 'x', description: 'd' });
			assert.deepEqual(write(schema, INPUT), { type: 'string', description: 'd' });
		});

		test('a __proto__ key is an own key and sets no prototype', () => {
			const doc = to_json_schema(meta(s.string, JSON.parse('{"__proto__": {"x": 1}}')));
			assert.strictEqual(Object.getPrototypeOf(doc), Object.prototype);
			assert.ok(Object.hasOwn(doc, '__proto__'));
			assert.deepEqual(
				JSON.parse(JSON.stringify(doc)),
				JSON.parse(`{"$schema":"${$schema}","type":"string","__proto__":{"x":1}}`)
			);
		});
	});

	test('the key order is the same on every call', () => {
		const schema = s.object({
			a: meta(s.pipe(s.string, s.min_length(1), s.uuid), { description: 'd' }),
			b: s.with_default(s.nullable(s.number), 1),
			c: s.loose_object({ d: s.optional(s.boolean) })
		});
		const order = (value: unknown): unknown =>
			value !== null && typeof value === 'object'
				? Object.entries(value).map(([k, v]) => [k, order(v)])
				: value;
		const first = JSON.stringify(order(to_json_schema(schema)));
		assert.strictEqual(JSON.stringify(order(to_json_schema(schema))), first);
		assert.deepEqual(Object.keys(write(schema).properties.a), [
			'type',
			'minLength',
			'format',
			'pattern',
			'description'
		]);
		assert.deepEqual(Object.keys(write(schema).properties.b), ['type', 'default']);
	});

	test('returns a fresh document each call', () => {
		const shared = s.object({ x: s.string });
		const doc = to_json_schema(s.object({ a: shared, b: shared }));
		assert.notStrictEqual(doc.properties!.a, doc.properties!.b);
		assert.notStrictEqual(to_json_schema(shared), to_json_schema(shared));
	});
});

describe('to_json_schema of every kind', () => {
	const UUID = write(s.uuid).pattern;
	const ISO_DATETIME = write(s.iso_datetime).pattern;
	const STRING = { type: 'string' };
	const NUMBER = { type: 'number' };
	const OBJECT = { type: 'object', properties: { a: STRING }, required: ['a'] };

	// every kind, which the types hold the table to: a new kind is a row here,
	// with a schema that has it, as the root or the last step of a pipe, and the
	// document written of it or the message it is refused with, as output and,
	// where it differs, as input
	const kinds: Record<
		s.SchemaKind,
		[s.AnySchema, Record<string, unknown> | string, (Record<string, unknown> | string)?]
	> = {
		string: [s.string, STRING],
		number: [s.number, NUMBER],
		boolean: [s.boolean, { type: 'boolean' }],
		bigint: [s.bigint, 'cannot express `bigint` at #: a bigint is not JSON'],
		unknown: [s.unknown, {}],
		literal: [s.literal('a'), { type: 'string', const: 'a' }],
		one_of: [s.one_of(['a', 1]), { enum: ['a', 1] }],
		optional: [s.optional(s.string), STRING],
		nullable: [s.nullable(s.string), { type: ['string', 'null'] }],
		with_default: [s.with_default(s.number, 1), { type: 'number', default: 1 }],
		with_default_fn: [s.with_default_fn(s.number, () => 1), NUMBER],
		lazy: [s.lazy(() => s.string), STRING],
		object: [s.object({ a: s.string }), { ...OBJECT, additionalProperties: false }],
		loose_object: [s.loose_object({ a: s.string }), { ...OBJECT, additionalProperties: {} }],
		// what an input may hold beyond its entries is not said
		strip_object: [
			s.strip_object({ a: s.string }),
			{ ...OBJECT, additionalProperties: false },
			OBJECT
		],
		object_with_rest: [
			s.object_with_rest({ a: s.string }, s.number),
			{ ...OBJECT, additionalProperties: NUMBER }
		],
		record: [
			s.record(s.number),
			{ type: 'object', propertyNames: STRING, additionalProperties: NUMBER }
		],
		// the key's node, of the side written: the output's keys are lowercase
		keyed_record: [
			s.keyed_record(s.pipe(s.string, s.to_lower_case, s.min_length(1)), s.number),
			{
				type: 'object',
				propertyNames: { type: 'string', minLength: 1 },
				additionalProperties: NUMBER
			},
			'cannot express `min_length` at #/propertyNames: it reads the lowercase of the input'
		],
		array: [s.array(s.string), { type: 'array', items: STRING }],
		union: [s.union([s.string, s.number]), { type: ['string', 'number'] }],
		variant: [
			s.variant('t', [s.object({ t: s.literal('a') })]),
			{
				oneOf: [
					{
						type: 'object',
						properties: { t: { type: 'string', const: 'a' } },
						required: ['t'],
						additionalProperties: false
					}
				]
			}
		],
		pipe: [s.pipe(s.string, s.min_length(1)), { type: 'string', minLength: 1 }],
		// the actions are written in a pipe, outside one each is refused
		min_length: [s.pipe(s.string, s.min_length(1)), { type: 'string', minLength: 1 }],
		max_length: [
			s.pipe(s.array(s.string), s.max_length(2)),
			{ type: 'array', items: STRING, maxItems: 2 }
		],
		min_value: [s.pipe(s.number, s.min_value(1)), { type: 'number', minimum: 1 }],
		max_value: [s.pipe(s.number, s.max_value(2)), { type: 'number', maximum: 2 }],
		integer: [s.pipe(s.number, s.integer), { type: 'integer' }],
		safe_integer: [
			s.pipe(s.number, s.safe_integer),
			{ type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }
		],
		regex: [s.pipe(s.string, s.regex(/a/)), { type: 'string', pattern: 'a' }],
		uuid: [s.pipe(s.string, s.uuid), { type: 'string', format: 'uuid', pattern: UUID }],
		iso_datetime: [
			s.pipe(s.string, s.iso_datetime),
			{ type: 'string', format: 'date-time', pattern: ISO_DATETIME }
		],
		to_lower_case: [s.pipe(s.string, s.to_lower_case), STRING],
		// the integer, and the strings read as one
		to_integer: [
			s.pipe(s.string, s.to_integer({ unsigned: true })),
			{ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
			{ type: 'string', pattern: `^(?:\\+?0*(?:${SAFE_DIGITS}))$` }
		],
		check: [
			s.pipe(
				s.string,
				s.check(() => true)
			),
			'cannot express `check` at #: it holds a function'
		],
		transform: [
			s.pipe(
				s.string,
				s.transform((v: string) => v)
			),
			'cannot express `transform` at #: its output is not known',
			STRING
		]
	};

	const written = (
		schema: s.AnySchema,
		options: JsonSchemaOptions
	): Record<string, unknown> | string => {
		try {
			return write(schema, options);
		} catch (error) {
			return (error as Error).message;
		}
	};

	for (const [kind, [schema, output, input = output]] of Object.entries(kinds)) {
		test(kind, () => {
			const last = schema.kind === 'pipe' ? (schema.def as Array<s.AnySchema>).at(-1)! : schema;
			assert(schema.kind === kind || last.kind === kind, 'the row has its kind');
			assert.deepEqual(written(schema, OUTPUT), output);
			assert.deepEqual(written(schema, INPUT), input);
		});
	}
});
