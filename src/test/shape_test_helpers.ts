/**
 * One of every schema the library makes, for `schema.shape.test.ts`: the
 * samples, what they are run through, and which exports they must cover.
 *
 * Imported by the test, by `introspect.test.ts`, which reads every sample, and
 * by `shape_test_child.ts`, the process that asks the engine about them, so
 * it is erasable syntax only.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { get_meta, meta } from '#lib/meta.ts';
import { to_standard_schema } from '#lib/standard_schema.ts';
import { to_schema_json } from '#lib/schema_json.ts';

export interface ShapeSample {
	schema: s.AnySchema;
	/** Inputs that match. */
	valid: Array<unknown>;
	/** Inputs that don't, none of them `null` or `undefined`, which a wrapper may accept. */
	invalid: Array<unknown>;
	/** Whether it assumes typed input, and so is given none but its own. */
	action?: boolean;
}

/** The exports of `schema.ts` that are not a schema and don't make one. */
export const SHAPE_NOT_SCHEMAS: ReadonlyArray<string> = [
	'fail',
	'parse',
	'parse_or_throw',
	'is',
	'is_schema',
	'format_issue',
	'get_issue_value',
	'SchemaError'
];

interface ShapeTree {
	value: string;
	next?: ShapeTree;
}
const tree: s.Schema<ShapeTree> = s.object({
	value: s.string,
	next: s.optional(s.lazy(() => tree))
});

/**
 * Samples by the export that makes them. Its keys are every kind of
 * `SchemaDefs`, which the types hold it to, and the exports with no kind of
 * their own. Each is a function so that a lazy starts unused.
 */
export const SHAPE_SAMPLES: Record<
	s.SchemaKind | 'message' | 'flavor' | 'brand',
	() => Array<ShapeSample>
> = {
	string: () => [{ schema: s.string, valid: ['a'], invalid: [1] }],
	number: () => [{ schema: s.number, valid: [1], invalid: ['a'] }],
	boolean: () => [{ schema: s.boolean, valid: [true], invalid: [1] }],
	bigint: () => [{ schema: s.bigint, valid: [1n], invalid: [1] }],
	unknown: () => [{ schema: s.unknown, valid: [1, 'a'], invalid: [] }],
	literal: () => [
		{ schema: s.literal('a'), valid: ['a'], invalid: ['b'] },
		{ schema: s.literal(undefined), valid: [undefined], invalid: [1] }
	],
	one_of: () => [
		{ schema: s.one_of(['a', 1]), valid: ['a', 1], invalid: ['b'] },
		{ schema: s.one_of(['a', undefined]), valid: ['a', undefined], invalid: ['b'] }
	],
	optional: () => [
		{ schema: s.optional(s.string), valid: ['a', undefined], invalid: [1] },
		{ schema: s.optional(s.unknown), valid: [1, undefined], invalid: [] }
	],
	nullable: () => [
		{ schema: s.nullable(s.string), valid: ['a', null], invalid: [1] },
		{ schema: s.nullable(s.unknown), valid: [1, null], invalid: [] },
		{ schema: s.nullable(s.lazy(() => s.string)), valid: ['a', null], invalid: [1] }
	],
	with_default: () => [
		{ schema: s.with_default(s.string, 'd'), valid: ['a', undefined], invalid: [1] }
	],
	with_default_fn: () => [
		{ schema: s.with_default_fn(s.string, () => 'd'), valid: ['a', undefined], invalid: [1] },
		{
			schema: s.with_default_fn(s.array(s.string), () => []),
			valid: [['x'], undefined],
			invalid: [[1], 1]
		}
	],
	lazy: () => [
		{ schema: s.lazy(() => s.string), valid: ['a'], invalid: [1] },
		{ schema: s.lazy(() => s.unknown), valid: [1], invalid: [] },
		{ schema: s.lazy(() => s.lazy(() => s.number)), valid: [1], invalid: ['a'] }
	],
	message: () => [
		{ schema: s.message(s.string, 'm'), valid: ['a'], invalid: [1] },
		{ schema: s.message(s.unknown, 'm'), valid: [1], invalid: [] },
		{
			schema: s.message(
				s.lazy(() => s.string),
				() => 'm'
			),
			valid: ['a'],
			invalid: [1]
		},
		{ schema: s.message(s.object({ a: s.string }), 'm'), valid: [{ a: 'a' }], invalid: [1] }
	],
	flavor: () => [{ schema: s.flavor(s.string, 'Flavor'), valid: ['a'], invalid: [1] }],
	brand: () => [{ schema: s.brand(s.string, 'Brand'), valid: ['a'], invalid: [1] }],
	object: () => [
		{
			schema: s.object({ a: s.string, b: s.optional(s.number), c: s.with_default(s.number, 1) }),
			valid: [{ a: 'a' }, { a: 'a', b: 1, c: 2 }],
			invalid: [{ a: 1 }, { a: 'a', d: 1 }, {}, 1, []]
		},
		{
			schema: tree,
			valid: [{ value: 'a', next: { value: 'b' } }],
			invalid: [{ value: 'a', next: { value: 1 } }]
		}
	],
	loose_object: () => [
		{
			schema: s.loose_object({ a: s.string, c: s.with_default(s.number, 1) }),
			valid: [{ a: 'a' }, { a: 'a', c: 2, d: 1 }],
			invalid: [{ a: 1 }, {}, 1, []]
		}
	],
	object_with_rest: () => [
		{
			schema: s.object_with_rest({ a: s.string, c: s.with_default(s.number, 1) }, s.number),
			valid: [{ a: 'a' }, { a: 'a', c: 2, d: 1 }, JSON.parse('{"a": "a", "__proto__": 1}')],
			invalid: [{ a: 1 }, { a: 'a', d: 'x' }, { a: 1, d: 'x' }, {}, 1, []]
		},
		{
			schema: s.object_with_rest(
				{},
				s.pipe(
					s.string,
					s.transform((v: string) => v + '!')
				)
			),
			valid: [{}, { a: 'a', b: 'b' }],
			invalid: [{ a: 1 }]
		}
	],
	strip_object: () => [
		{
			schema: s.strip_object({ a: s.string, c: s.with_default(s.number, 1) }),
			valid: [{ a: 'a' }, { a: 'a', c: 2, d: 1 }],
			invalid: [{ a: 1 }, {}, 1, []]
		}
	],
	record: () => [
		{ schema: s.record(s.number), valid: [{}, { a: 1 }], invalid: [{ a: 'a' }, 1, []] },
		{ schema: s.record(s.with_default(s.number, 1)), valid: [{ a: undefined }], invalid: [1] }
	],
	array: () => [
		{ schema: s.array(s.string), valid: [[], ['a']], invalid: [[1], ['a', 1], 1, {}] },
		{ schema: s.array(s.with_default(s.number, 1)), valid: [[1, undefined]], invalid: [['a']] }
	],
	union: () => [
		{ schema: s.union([s.string, s.number]), valid: ['a', 1], invalid: [true] },
		{ schema: s.union([s.string, s.unknown]), valid: ['a', 1], invalid: [] },
		{ schema: s.union([s.string, s.lazy(() => s.number)]), valid: ['a', 1], invalid: [true] },
		{
			schema: s.union([s.object({ a: s.string }), s.array(s.string)]),
			valid: [{ a: 'a' }, ['a']],
			invalid: [{ a: 1 }, [1]]
		}
	],
	variant: () => [
		{
			schema: s.variant('k', [
				s.object({ k: s.literal('a'), v: s.string }),
				s.loose_object({ k: s.literal('b') }),
				s.strip_object({ k: s.literal('c'), v: s.with_default(s.number, 1) })
			]),
			valid: [{ k: 'a', v: 'a' }, { k: 'b', d: 1 }, { k: 'c' }],
			invalid: [{ k: 'a', v: 1 }, { k: 'd' }, {}, 1, []]
		}
	],
	pipe: () => [
		{ schema: s.pipe(s.string, s.min_length(2)), valid: ['ab'], invalid: ['a', 1] },
		// one that starts with an `optional`, which has a closure of its own
		{
			schema: s.pipe(
				s.optional(s.string),
				s.check(() => true)
			),
			valid: ['a', undefined],
			invalid: [1]
		},
		{
			schema: s.pipe(
				s.unknown,
				s.check((v) => v !== 0)
			),
			valid: [1],
			invalid: [0]
		},
		{
			schema: s.pipe(
				s.lazy(() => s.string),
				s.transform((v: string) => v.length),
				s.max_value(2)
			),
			valid: ['ab'],
			invalid: ['abc', 1]
		}
	],
	min_length: () => [
		{ action: true, schema: s.min_length(2), valid: ['ab', [1, 2]], invalid: ['a'] }
	],
	max_length: () => [
		{ action: true, schema: s.max_length(2), valid: ['ab', []], invalid: ['abc'] }
	],
	min_value: () => [
		{ action: true, schema: s.min_value(1), valid: [1], invalid: [0] },
		{ action: true, schema: s.min_value(1n), valid: [1n], invalid: [0n] },
		{ action: true, schema: s.min_value(1.5), valid: [2], invalid: [1] }
	],
	max_value: () => [
		{ action: true, schema: s.max_value(1), valid: [1], invalid: [2] },
		{ action: true, schema: s.max_value(1n), valid: [1n], invalid: [2n] }
	],
	integer: () => [{ action: true, schema: s.integer, valid: [1], invalid: [1.5] }],
	safe_integer: () => [{ action: true, schema: s.safe_integer, valid: [1], invalid: [2 ** 60] }],
	regex: () => [{ action: true, schema: s.regex(/^a/), valid: ['a'], invalid: ['b'] }],
	check: () => [
		{
			action: true,
			schema: s.check((v: number) => v > 0, 'a positive number'),
			valid: [1],
			invalid: [0]
		}
	],
	transform: () => [
		{ action: true, schema: s.transform((v: number) => v + 1), valid: [1], invalid: [] }
	]
};

/**
 * Names what `schema.ts` exports that the samples leave out: a schema or a
 * function with no entry in `SHAPE_SAMPLES` that `SHAPE_NOT_SCHEMAS` doesn't
 * name, and a name in either that is no export.
 */
export const find_uncovered_shape_exports = (): Array<string> => {
	const uncovered: Array<string> = [];
	const exported: Record<string, unknown> = s;
	for (const name of Object.keys(exported)) {
		if (name in SHAPE_SAMPLES === SHAPE_NOT_SCHEMAS.includes(name)) {
			uncovered.push(`${name} is ${name in SHAPE_SAMPLES ? 'in both lists' : 'in neither list'}`);
		}
	}
	for (const name of [...Object.keys(SHAPE_SAMPLES), ...SHAPE_NOT_SCHEMAS]) {
		if (!(name in exported)) uncovered.push(`${name} is not an export`);
	}
	return uncovered;
};

// what a sample is put inside, with the input that puts a value there. The
// object schemas hand their entry the object and the key, and the rest call
// it with a value alone
const AROUND: Array<[string, (schema: s.AnySchema) => s.AnySchema, (value: unknown) => unknown]> = [
	['object', (schema) => s.object({ a: schema }), (a) => ({ a })],
	['loose_object', (schema) => s.loose_object({ a: schema }), (a) => ({ a, b: 1 })],
	['strip_object', (schema) => s.strip_object({ a: schema }), (a) => ({ a, b: 1 })],
	['object of nullable', (schema) => s.object({ a: s.nullable(schema) }), (a) => ({ a })],
	['object of lazy', (schema) => s.object({ a: s.lazy(() => schema) }), (a) => ({ a })],
	['object of message', (schema) => s.object({ a: s.message(schema, 'm') }), (a) => ({ a })],
	['object of union', (schema) => s.object({ a: s.union([schema]) }), (a) => ({ a })],
	[
		'object of pipe',
		(schema) =>
			s.object({
				a: s.pipe(
					schema,
					s.check(() => true)
				)
			}),
		(a) => ({ a })
	],
	['array', (schema) => s.array(schema), (a) => [a]],
	['record', (schema) => s.record(schema), (a) => ({ a })],
	['meta', (schema) => meta(schema, { description: 'd' }), (a) => a]
];

const KINDLESS: ReadonlyArray<string> = ['message', 'flavor', 'brand'];

const format_input = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		// a `bigint`
		return String(value);
	}
};

// how many times each sample is run each way, enough that a `run` which
// changes itself after its first calls has
const ROUNDS = 4;

export interface ShapeRun {
	/** Every schema built: the samples, and what each was put inside. */
	schemas: Array<{ name: string; schema: s.AnySchema }>;
	/**
	 * Where `parse`, `is`, `parse_or_throw`, or a Standard Schema's `validate`
	 * gave another answer than the sample says.
	 */
	wrong: Array<string>;
}

/**
 * Builds every sample, and what each is put inside, and runs each through
 * `parse`, `is`, `parse_or_throw`, and a Standard Schema's `validate` on every
 * input. Each is also handed to what else the library takes a schema in:
 * `is_schema`, `get_meta`, and `to_schema_json`.
 */
export const run_shape_samples = (): ShapeRun => {
	const schemas: ShapeRun['schemas'] = [];
	const wrong: Array<string> = [];
	const run = (name: string, schema: s.AnySchema, value: unknown, valid: boolean | null): void => {
		for (let round = 0; round < ROUNDS; round++) {
			let threw = false;
			try {
				s.parse_or_throw(schema, value);
			} catch (error) {
				if (!(error instanceof s.SchemaError)) throw error;
				threw = true;
			}
			const validated = to_standard_schema(schema)['~standard'].validate(value);
			const verdicts = [
				s.parse(schema, value).ok,
				s.is(schema, value),
				!threw,
				!('issues' in validated && validated.issues)
			];
			// `null` is an input run for its code and not its answer
			if (valid !== null && verdicts.some((v) => v !== valid)) {
				wrong.push(`${name} on ${format_input(value)}: ${verdicts.join(', ')}`);
			}
		}
	};
	for (const [key, create] of Object.entries(SHAPE_SAMPLES)) {
		for (const [i, sample] of create().entries()) {
			const name = `${key} #${i}`;
			if (!KINDLESS.includes(key) && sample.schema.kind !== key) {
				wrong.push(`${name} is of kind ${sample.schema.kind}`);
			}
			const all = [
				[name, sample.schema, (a: unknown) => a] as const,
				...AROUND.map(
					([around, wrap, to_input]) =>
						[`${around} of ${name}`, wrap(sample.schema), to_input] as const
				)
			];
			for (const [at, schema, to_input] of all) {
				schemas.push({ name: at, schema });
				if (!s.is_schema(schema)) wrong.push(`${at} is no schema to is_schema`);
				if (!!get_meta(schema) !== at.startsWith('meta of ')) {
					wrong.push(`${at} ${get_meta(schema) ? 'has' : 'has no'} metadata`);
				}
				try {
					to_schema_json(schema);
				} catch {
					// what it refuses it has still read
				}
				for (const value of sample.valid) run(at, schema, to_input(value), true);
				for (const value of sample.invalid) run(at, schema, to_input(value), false);
				if (sample.action) continue;
				// a missing key, and what is no object or array
				run(at, schema, {}, null);
				run(at, schema, 'x', null);
			}
		}
	}
	return { schemas, wrong };
};
