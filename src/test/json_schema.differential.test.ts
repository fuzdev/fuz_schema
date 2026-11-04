import { describe, test, assert } from 'vitest';
import { readFileSync } from 'node:fs';

import * as s from '#lib/schema.ts';
import { to_json_schema } from '#lib/json_schema.ts';
import { meta } from '#lib/meta.ts';
import { check_json_schema, JSON_SCHEMA_DRAFT } from './json_schema_check.ts';
import { CONFORMANCE_LIBS } from './conformance_adapters.ts';
import { build_spec, show_spec, type DifferentialSpec } from './differential_generate.ts';
import {
	JSON_SCHEMA_DIFFERENCES,
	assert_rewrite_loosens,
	explain_json_schema_disagreement,
	format_json_schema_differential_report,
	run_json_schema_differential,
	type JsonSchemaCase,
	type JsonSchemaMode,
	type JsonSchemaSide
} from './json_schema_differential.ts';

// The JSON Schema differential at a fixed depth, the same on every run and in
// CI, each schema written in both modes. A deeper run, of any seed, is
// `npm run differential -- --json-schema`.
const SEEDS = [1, 2, 3];
const COUNT = 3000;

describe('the JSON Schema differential', () => {
	for (const seed of SEEDS) {
		test(`seed ${seed}: the document's verdict is the library's, but where declared`, () => {
			const report = run_json_schema_differential({ seed, count: COUNT });
			if (report.finding_count) {
				assert.fail(
					'\n' +
						format_json_schema_differential_report(report) +
						'\n\nFix the emitter, or declare the difference in JSON_SCHEMA_DIFFERENCES and docs/design.md § JSON Schema.'
				);
			}
			// not vacuous: most schemas are written on each side, and inputs are taken and refused
			for (const side of ['input', 'output'] as const) {
				const fraction = report.refused[side] / report.schemas;
				assert.ok(fraction < 0.55, `${side}: refused ${report.refused[side]} of ${report.schemas}`);
			}
			const taken = report.accepted / report.compared.input;
			assert.ok(
				taken > 0.25 && taken < 0.75,
				`taken ${report.accepted} of ${report.compared.input}`
			);
			assert.ok(report.compared.output > COUNT, `${report.compared.output} outputs compared`);
			// with 'any', what the default mode refuses is written and held one way
			const any = report.any!;
			assert.strictEqual(any.refused.output, 0, "refused with 'any'");
			assert.ok(any.compared.input > report.accepted, `${any.compared.input} inputs with 'any'`);
			assert.ok(
				any.compared.output > report.compared.output,
				`${any.compared.output} outputs with 'any'`
			);
			// variants zod refuses are made, one whose discriminator is no literal among them
			assert.ok(
				Object.keys(report.refusals).some((line) => line.startsWith('cannot express `variant`')),
				'no variant refused'
			);
		}, 30_000);
	}

	test('every declared difference is a sentence of docs/design.md § JSON Schema', () => {
		const design = readFileSync('docs/design.md', 'utf8');
		const start = design.indexOf('\n## JSON Schema\n');
		assert.ok(start !== -1, 'design.md has a JSON Schema section');
		const end = design.indexOf('\n## ', start + 1);
		// whatever the line breaks
		const section = design.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
		for (const d of JSON_SCHEMA_DIFFERENCES) {
			assert.ok(section.includes(d.design), `${d.name}: ${d.design}`);
		}
	});
});

// a case of each difference, which its recognizer must explain alone, so none
// is dead where the seeds don't reach it
interface Pinned {
	name: string;
	side: JsonSchemaSide;
	mode?: JsonSchemaMode;
	schema?: s.AnySchema;
	spec?: DifferentialSpec;
	/** The JSON text of the input. */
	input: string;
}

const PINNED: Array<Pinned> = [
	{
		name: 'code_point_lengths',
		side: 'input',
		schema: s.pipe(s.string, s.max_length(1)),
		input: '"😀"'
	},
	{
		name: 'code_point_lengths',
		side: 'output',
		schema: s.pipe(s.string, s.min_length(2)),
		input: '"😀"'
	},
	{
		name: 'pattern_under_u',
		side: 'input',
		schema: s.pipe(s.string, s.regex(/^.$/)),
		input: '"😀"'
	},
	{
		name: 'rest_drops_proto',
		side: 'input',
		schema: s.object_with_rest({}, s.number),
		input: '{"__proto__": "x"}'
	},
	{
		name: 'output_refuses_default',
		side: 'output',
		schema: s.object({ a: s.with_default(s.number, 'D' as any) }),
		input: '{}'
	},
	{
		name: 'output_refuses_default',
		side: 'output',
		spec: {
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'default_fn', of: { t: 'number' }, v: undefined }]]
		},
		input: '{}'
	},
	{
		name: 'output_refuses_default',
		side: 'output',
		spec: {
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'default_fn', of: { t: 'number' }, v: 'D' }]]
		},
		input: '{}'
	},
	{
		name: 'output_transform_undefined',
		side: 'output',
		mode: 'any',
		spec: {
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'map', of: { t: 'number' }, fn: 'to_undefined' }]]
		},
		input: '{"a": 1}'
	},
	{
		name: 'output_transform_undefined',
		side: 'output',
		mode: 'any',
		spec: {
			t: 'object',
			flavor: 'strict',
			entries: [
				['a', { t: 'default', of: { t: 'map', of: { t: 'number' }, fn: 'identity' }, v: 'D' }],
				['b', { t: 'transform', fn: 'to_undefined' }]
			]
		},
		input: '{"a": 1}'
	}
];

const pinned_case = (p: Pinned): JsonSchemaCase => {
	const schema = p.schema ?? build_spec(p.spec!, CONFORMANCE_LIBS.fuz_schema);
	return { schema, spec: p.spec ?? null, label: p.spec ? show_spec(p.spec) : p.name };
};

describe('the declared differences', () => {
	for (const p of PINNED) {
		test(`${p.name}, on the ${p.side} side: ${p.input}`, () => {
			const c = pinned_case(p);
			const mode = p.mode ?? 'throw';
			const doc = to_json_schema(c.schema, { io: p.side, unrepresentable: mode });
			const input = JSON.parse(p.input);
			let value = input;
			let expected: boolean;
			if (p.side === 'input') {
				expected = s.is(c.schema, input);
			} else {
				const result = s.parse(c.schema, input);
				assert.ok(result.ok);
				value = JSON.parse(JSON.stringify(result.value));
				expected = true;
			}
			assert.notStrictEqual(check_json_schema(doc, value), expected, 'the document disagrees');
			const set = explain_json_schema_disagreement(c, p.side, doc, input, value, expected, mode);
			assert.deepStrictEqual(
				set?.map((d) => d.name),
				[p.name]
			);
		});
	}

	test('every difference has a pinned case', () => {
		for (const d of JSON_SCHEMA_DIFFERENCES) {
			assert.ok(
				PINNED.some((p) => p.name === d.name),
				d.name
			);
		}
	});

	test('a record validates a __proto__ key, which rest_drops_proto never skips', () => {
		const doc = to_json_schema(s.record(s.number), { io: 'input' });
		const value = JSON.parse('{"__proto__": "x"}');
		assert.strictEqual(s.is(s.record(s.number), value), false);
		assert.strictEqual(check_json_schema(doc, value, { rest_skips_proto: true }), false);
	});

	test('a recognizer applies only to a schema that holds what triggers it', () => {
		const by_name = (name: string) => JSON_SCHEMA_DIFFERENCES.find((d) => d.name === name)!;
		const of = (spec: DifferentialSpec): JsonSchemaCase =>
			pinned_case({ name: '', side: 'output', spec, input: '' });
		const defaults = by_name('output_refuses_default');
		const transforms = by_name('output_transform_undefined');
		const plain: DifferentialSpec = {
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'number' }]]
		};
		assert.ok(!defaults.applies!(of(plain)));
		assert.ok(!transforms.applies!(of(plain)));
		assert.ok(
			defaults.applies!({
				schema: s.lazy(() => s.array(s.with_default(s.number, 1))),
				spec: null,
				label: ''
			})
		);
		assert.ok(!transforms.applies!({ schema: s.transform((x) => x), spec: null, label: '' }));
		// a default, unexplained by the default alone, is not the transform's
		const value = { a: 'D' };
		const c = of({
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'default', of: { t: 'number' }, v: 'D' }]]
		});
		const doc = to_json_schema(c.schema);
		assert.deepStrictEqual(
			explain_json_schema_disagreement(c, 'output', doc, {}, value, true)?.map((d) => d.name),
			['output_refuses_default']
		);
	});

	test('a transform explains only where what it gives is undefined and that is the refusal', () => {
		const of = (spec: DifferentialSpec): JsonSchemaCase =>
			pinned_case({ name: '', side: 'output', spec, input: '' });
		// a missing key runs no step of a pipe that starts with an optional, and a
		// document that required it would refuse what the parse gives
		const c = of({
			t: 'object',
			flavor: 'strict',
			entries: [['a', { t: 'map', of: { t: 'optional', of: { t: 'number' } }, fn: 'to_undefined' }]]
		});
		const doc = to_json_schema(c.schema, { io: 'output', unrepresentable: 'any' });
		assert.deepEqual(doc.required, undefined);
		const wrong = { ...doc, required: ['a'] };
		assert.strictEqual(check_json_schema(wrong, {}), false);
		assert.strictEqual(
			explain_json_schema_disagreement(c, 'output', wrong, {}, {}, true, 'any'),
			null
		);
		// given the key, the transform's `undefined` leaves it out, which explains it
		assert.deepStrictEqual(
			explain_json_schema_disagreement(c, 'output', wrong, { a: 1 }, {}, true, 'any')?.map(
				(d) => d.name
			),
			['output_transform_undefined']
		);
		// and with 'throw', which writes no transform on the output side, nothing is
		assert.strictEqual(
			explain_json_schema_disagreement(c, 'output', wrong, { a: 1 }, {}, true, 'throw'),
			null
		);
	});

	test('a rewrite changes the document only by a default and a required it takes keys out of', () => {
		for (const p of PINNED.filter((p) => p.spec)) {
			const d = JSON_SCHEMA_DIFFERENCES.find((d) => d.name === p.name)!;
			if (!d.rewrite) continue;
			const options = { io: p.side, unrepresentable: p.mode ?? 'throw' } as const;
			const original = to_json_schema(build_spec(p.spec!, CONFORMANCE_LIBS.fuz_schema), options);
			const rewritten = to_json_schema(
				build_spec(d.rewrite(p.spec!), CONFORMANCE_LIBS.fuz_schema),
				options
			);
			assert.notDeepEqual(rewritten, original, `${p.name}: the rewrite changes the document`);
			assert_rewrite_loosens(original, rewritten);
		}
		const doc = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };
		assert_rewrite_loosens(doc, { ...doc, required: [] });
		// metadata beside a folded `anyOf`: the refold puts `type` elsewhere in key order
		for (const io of ['input', 'output'] as const) {
			assert_rewrite_loosens(
				to_json_schema(
					s.object({
						a: meta(s.nullable(s.with_default_fn(s.string, () => 'd')), { description: 'x' })
					}),
					{ io }
				),
				to_json_schema(
					s.object({ a: meta(s.nullable(s.with_default(s.string, 'd')), { description: 'x' }) }),
					{ io }
				)
			);
		}
		assert_rewrite_loosens(
			{ type: ['number', 'null'] },
			{
				anyOf: [{ type: 'number', default: 1 }, { type: 'null' }]
			}
		);
		assert.throws(() => assert_rewrite_loosens({ ...doc, required: [] }, doc), /past a default/);
		assert.throws(
			() => assert_rewrite_loosens(doc, { ...doc, properties: { a: {} } }),
			/at #\/properties\/a past/
		);
	});

	test('a property named default or required is a property as any other', () => {
		const doc = {
			type: 'object',
			properties: {
				default: { type: 'number', default: 1 },
				required: { type: 'string' }
			},
			required: ['default', 'required']
		};
		const { default: _, ...bare } = doc.properties.default;
		assert_rewrite_loosens(doc, {
			...doc,
			properties: { ...doc.properties, default: bare },
			required: ['required']
		});
		assert.throws(
			() => assert_rewrite_loosens(doc, { ...doc, properties: { ...doc.properties, default: {} } }),
			/at #\/properties\/default past/
		);
		assert.throws(
			() =>
				assert_rewrite_loosens(doc, {
					...doc,
					properties: { ...doc.properties, required: { type: 'number' } }
				}),
			/at #\/properties\/required\/type past/
		);
		assert.throws(
			() => assert_rewrite_loosens(doc, { ...doc, required: ['default', 'required', 'x'] }),
			/at #\/required past/
		);
		// a value of `const` or `enum` is a value, whose `default` key counts
		assert.throws(
			() => assert_rewrite_loosens({ const: { default: 1 } }, { const: {} }),
			/at #\/const past/
		);
	});

	test('default_fills takes the default and nothing else', () => {
		const doc = to_json_schema(s.object({ a: s.with_default(s.number, 'D' as any) }));
		assert.strictEqual(check_json_schema(doc, { a: 'E' }, { default_fills: true }), false);
		assert.strictEqual(check_json_schema(doc, { a: 'D' }, { default_fills: true }), true);
	});
});

const doc_of = (node: object): any => ({ $schema: JSON_SCHEMA_DRAFT, ...node });

describe('check_json_schema', () => {
	test('reads each keyword as draft 2020-12 does', () => {
		const rows: Array<[object, unknown, boolean]> = [
			[{ type: 'integer' }, 1, true],
			[{ type: 'integer' }, 1.5, false],
			[{ type: ['string', 'null'] }, null, true],
			[{ type: 'object' }, [], false],
			[{ const: { a: [1] } }, { a: [1] }, true],
			[{ enum: [1, 'x'] }, 'y', false],
			[{ not: {} }, 1, false],
			[{ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1, false],
			[{ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1.5, true],
			[{ allOf: [{ pattern: 'a' }, { pattern: 'b' }] }, 'ab', true],
			[{ allOf: [{ pattern: 'a' }, { pattern: 'b' }] }, 'a', false],
			[{ minLength: 2 }, '😀', false],
			[{ maxLength: 1 }, '😀', true],
			[{ pattern: '^.$' }, '😀', true],
			[{ minimum: 1, maximum: 2 }, 2, true],
			[{ exclusiveMinimum: 1 }, 1, false],
			[{ exclusiveMaximum: 1 }, 0.5, true],
			[{ minItems: 1, maxItems: 1 }, [], false],
			[{ items: { type: 'string' } }, ['x', 1], false],
			[{ properties: { a: { type: 'string' } }, required: ['a'] }, { a: 1 }, false],
			[{ properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 }, false],
			[{ properties: {}, additionalProperties: { type: 'number' } }, { b: 2 }, true],
			[{ propertyNames: { maxLength: 1 } }, { ab: 1 }, false],
			[{ format: 'uuid', pattern: 'x', default: 1, title: 't' }, 'x', true],
			[{ type: 'string', minLength: 9 }, 1, false]
		];
		for (const [node, value, expected] of rows) {
			assert.strictEqual(
				check_json_schema(doc_of(node), value),
				expected,
				`${JSON.stringify(node)} on ${JSON.stringify(value)}`
			);
		}
	});

	test('follows $ref to the root and into $defs', () => {
		const doc = doc_of({
			anyOf: [{ type: 'null' }, { type: 'array', items: { $ref: '#' } }]
		});
		assert.strictEqual(check_json_schema(doc, [[null], []]), true);
		assert.strictEqual(check_json_schema(doc, [[1]]), false);
		const defs = doc_of({
			$ref: '#/$defs/a~1b',
			$defs: { 'a/b': { type: 'array', items: { $ref: '#/$defs/a~1b' } } }
		});
		assert.strictEqual(check_json_schema(defs, [[], [[]]]), true);
		assert.strictEqual(check_json_schema(defs, [1]), false);
	});

	test('throws on what it does not know or cannot read', () => {
		const throws: Array<[object, unknown]> = [
			[{ multipleOf: 2 }, 1],
			// on a branch the value never reaches
			[{ anyOf: [{ type: 'null' }, { items: { minProperties: 1 } }] }, null],
			[{ format: 'email' }, 'x'],
			[{ $ref: '#/properties/a' }, 1],
			[{ $ref: '#/$defs/missing' }, 1],
			[{ pattern: '\\-' }, '-'],
			[{ anyOf: [] }, 1],
			[{ minLength: 1.5 }, 'x'],
			[{ required: ['a', 'a'] }, { a: 1 }],
			[{ items: { $defs: {} } }, []],
			[{ $ref: '#' }, 1]
		];
		for (const [node, value] of throws) {
			assert.throws(
				() => check_json_schema(doc_of(node), value),
				/json_schema_check/,
				JSON.stringify(node)
			);
		}
		assert.throws(() => check_json_schema({ type: 'string' }, 'x'), /\$schema/);
	});
});
