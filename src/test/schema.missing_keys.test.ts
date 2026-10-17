import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta, get_meta } from '#lib/meta.ts';
import { issues_of } from './schema_test_helpers.ts';

describe('missing keys', () => {
	const factories = [s.object, s.strip_object, s.loose_object] as const;

	const MISSING_KEY: s.SchemaIssue = {
		kind: 'missing_key',
		expected: 'a required key',
		received: 'undefined',
		path: ['a'],
		message: undefined
	};

	// what a `union` reports when none of its options takes a missing key
	const union_issue = (expected: string, message?: string): s.SchemaIssue => ({
		kind: 'union',
		expected,
		received: 'undefined',
		path: ['a'],
		message
	});

	const passes = s.check(() => true);
	// the same for a value of any type
	const accepts = s.check<any>(() => true);

	// each entry with whether its key may be missing, whether it accepts
	// `undefined`, the output's value at the key when it was missing, and the
	// issue of a missing key where it is not a plain `missing_key`
	const cases: Array<
		[
			name: string,
			entry: s.AnySchema,
			missing: boolean,
			undefined_value: boolean,
			filled?: unknown,
			issue?: s.SchemaIssue
		]
	> = [
		['string', s.string, false, false],
		['nullable', s.nullable(s.string), false, false],
		// `unknown` is handed the object and looks for its key
		['unknown', s.unknown, false, true],
		// as it is where it is the schema itself
		['flavor unknown', s.flavor(s.unknown, 'F'), false, true],
		['brand unknown', s.brand(s.unknown, 'B'), false, true],
		['optional', s.optional(s.string), true, true],
		['optional unknown', s.optional(s.unknown), true, true],
		['with_default', s.with_default(s.string, 'd'), true, true, 'd'],
		['with_default unknown', s.with_default(s.unknown, 'd'), true, true, 'd'],
		['message optional', s.message(s.optional(s.unknown), 'm'), true, true],
		['brand with_default', s.brand(s.with_default(s.string, 'd'), 'B'), true, true, 'd'],
		// `nullable`, `lazy`, `union`, and `pipe` hand what they hold the object
		// too, so an `unknown` under them needs its key
		['nullable unknown', s.nullable(s.unknown), false, true],
		['lazy unknown', s.lazy(() => s.unknown), false, true],
		['pipe of unknown', s.pipe(s.unknown, passes), false, true],
		['pipe of unknown, two actions', s.pipe(s.unknown, passes, passes), false, true],
		[
			'pipe of unknown and a transform',
			s.pipe(
				s.unknown,
				s.transform(() => 'T')
			),
			false,
			true
		],
		// a union with no option that lets the key be missing reports itself
		[
			'union with unknown',
			s.union([s.string, s.unknown]),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		[
			'union of unknown alone',
			s.union([s.unknown]),
			false,
			true,
			undefined,
			union_issue('unknown')
		],
		// one in another
		['nullable lazy unknown', s.nullable(s.lazy(() => s.unknown)), false, true],
		['lazy nullable unknown', s.lazy(() => s.nullable(s.unknown)), false, true],
		['lazy lazy unknown', s.lazy(() => s.lazy(() => s.unknown)), false, true],
		['nullable nullable unknown', s.nullable(s.nullable(s.unknown)), false, true],
		['pipe of nullable unknown', s.pipe(s.nullable(s.unknown), passes), false, true],
		['pipe of a pipe of unknown', s.pipe(s.pipe(s.unknown, passes), passes), false, true],
		[
			'pipe of lazy unknown',
			s.pipe(
				s.lazy(() => s.unknown),
				passes
			),
			false,
			true
		],
		['lazy pipe of unknown', s.lazy(() => s.pipe(s.unknown, passes)), false, true],
		['nullable pipe of unknown', s.nullable(s.pipe(s.unknown, passes)), false, true],
		[
			'nullable union with unknown',
			s.nullable(s.union([s.string, s.unknown])),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		[
			'union with nullable unknown',
			s.union([s.number, s.nullable(s.unknown)]),
			false,
			true,
			undefined,
			union_issue('number | unknown | null')
		],
		[
			'union with lazy unknown',
			s.union([s.number, s.lazy(() => s.unknown)]),
			false,
			true,
			undefined,
			union_issue('number | lazy')
		],
		[
			'union with a pipe of unknown',
			s.union([s.number, s.pipe(s.unknown, passes)]),
			false,
			true,
			undefined,
			union_issue('number | unknown')
		],
		[
			'union with a union with unknown',
			s.union([s.number, s.union([s.string, s.unknown])]),
			false,
			true,
			undefined,
			union_issue('number | string | unknown')
		],
		[
			'pipe of a union with unknown',
			s.pipe(s.union([s.string, s.unknown]), passes),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		// a `message` and a nominal type are the schema they hold
		[
			'message nullable unknown',
			s.message(s.nullable(s.unknown), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'nullable message unknown',
			s.nullable(s.message(s.unknown, 'm')),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message lazy unknown',
			s.message(
				s.lazy(() => s.unknown),
				'm'
			),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message pipe of unknown',
			s.message(s.pipe(s.unknown, passes), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message union with unknown',
			s.message(s.union([s.string, s.unknown]), 'm'),
			false,
			true,
			undefined,
			union_issue('string | unknown', 'm')
		],
		[
			'union with message unknown',
			s.union([s.string, s.message(s.unknown, 'm')]),
			false,
			true,
			undefined,
			union_issue('string | unknown')
		],
		['brand nullable unknown', s.brand(s.nullable(s.unknown), 'B'), false, true],
		['nullable flavor unknown', s.nullable(s.flavor(s.unknown, 'F')), false, true],
		// an `optional` or a `with_default` under any of them lets the key be missing
		['nullable optional', s.nullable(s.optional(s.string)), true, true],
		['nullable optional unknown', s.nullable(s.optional(s.unknown)), true, true],
		['nullable with_default', s.nullable(s.with_default(s.unknown, 'd')), true, true, 'd'],
		['lazy optional', s.lazy(() => s.optional(s.string)), true, true],
		['lazy optional unknown', s.lazy(() => s.optional(s.unknown)), true, true],
		['lazy with_default', s.lazy(() => s.with_default(s.unknown, 'd')), true, true, 'd'],
		['nullable lazy optional', s.nullable(s.lazy(() => s.optional(s.unknown))), true, true],
		['union with an optional', s.union([s.number, s.optional(s.string)]), true, true],
		['union with unknown and an optional', s.union([s.unknown, s.optional(s.string)]), true, true],
		['union with an optional unknown', s.union([s.string, s.optional(s.unknown)]), true, true],
		// the default makes the key optional, and the `unknown` is then the first
		// to match the `undefined` it reads as, so nothing is filled in
		[
			'union with unknown and a with_default',
			s.union([s.unknown, s.with_default(s.string, 'd')]),
			true,
			true
		],
		[
			'union with lazy unknown and a lazy optional',
			s.union([s.lazy(() => s.unknown), s.lazy(() => s.optional(s.string))]),
			true,
			true
		],
		[
			'message union with an optional',
			s.message(s.union([s.unknown, s.optional(s.string)]), 'm'),
			true,
			true
		],
		[
			'pipe of an optional',
			s.pipe(
				s.optional(s.string),
				s.transform((v) => v)
			),
			true,
			true
		],
		['pipe of an optional unknown', s.pipe(s.optional(s.unknown), passes), true, true],
		// a step of a `pipe` after its first is handed neither
		['pipe with unknown as an action', s.pipe(s.optional(s.unknown), s.unknown), true, true],
		// a `literal` of `undefined` and a `one_of` with it look for their key as
		// `unknown` does, as the entry and wherever they are handed the object
		['undefined literal', s.literal(undefined), false, true],
		['one_of with undefined', s.one_of(['x', undefined]), false, true],
		['one_of of undefined alone', s.one_of([undefined]), false, true],
		['flavor undefined literal', s.flavor(s.literal(undefined), 'F'), false, true],
		['brand one_of with undefined', s.brand(s.one_of(['x', undefined]), 'B'), false, true],
		['nullable undefined literal', s.nullable(s.literal(undefined)), false, true],
		['nullable one_of with undefined', s.nullable(s.one_of(['x', undefined])), false, true],
		['lazy undefined literal', s.lazy(() => s.literal(undefined)), false, true],
		['lazy one_of with undefined', s.lazy(() => s.one_of(['x', undefined])), false, true],
		['pipe of an undefined literal', s.pipe(s.literal(undefined), accepts), false, true],
		['pipe of a one_of with undefined', s.pipe(s.one_of(['x', undefined]), accepts), false, true],
		[
			'nullable lazy pipe of an undefined literal',
			s.nullable(s.lazy(() => s.pipe(s.literal(undefined), accepts))),
			false,
			true
		],
		[
			'message undefined literal',
			s.message(s.literal(undefined), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message one_of with undefined',
			s.message(s.one_of(['x', undefined]), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'message nullable undefined literal',
			s.message(s.nullable(s.literal(undefined)), 'm'),
			false,
			true,
			undefined,
			{ ...MISSING_KEY, message: 'm' }
		],
		[
			'union with an undefined literal',
			s.union([s.string, s.literal(undefined)]),
			false,
			true,
			undefined,
			union_issue('string | undefined')
		],
		[
			'union with a one_of with undefined',
			s.union([s.number, s.one_of(['x', undefined])]),
			false,
			true,
			undefined,
			union_issue('number | "x" | undefined')
		],
		[
			'union with an undefined literal and unknown',
			s.union([s.literal(undefined), s.unknown]),
			false,
			true,
			undefined,
			union_issue('undefined | unknown')
		],
		// an `optional` or a `with_default` takes the `undefined` first
		['optional undefined literal', s.optional(s.literal(undefined)), true, true],
		['optional one_of with undefined', s.optional(s.one_of(['x', undefined])), true, true],
		[
			'with_default one_of with undefined',
			s.with_default(s.one_of(['x', undefined]), 'x'),
			true,
			true,
			'x'
		],
		[
			'nullable optional undefined literal',
			s.nullable(s.optional(s.literal(undefined))),
			true,
			true
		],
		[
			'union with an undefined literal and an optional',
			s.union([s.literal(undefined), s.optional(s.string)]),
			true,
			true
		],
		// a step of a `pipe` after its first is handed neither
		[
			'pipe with an undefined literal as an action',
			s.pipe(s.optional(s.unknown), s.literal(undefined)),
			true,
			true
		],
		// and these accept `undefined` without looking for the key
		['check', s.check(() => true), true, true],
		['transform', s.transform((v) => v), true, true]
	];

	test('a key may be missing where its entry accepts undefined and reaches no unknown', () => {
		for (const factory of factories) {
			for (const [name, entry, missing, undefined_value, filled, issue] of cases) {
				const O = factory({ a: entry });
				const V = s.variant('kind', [factory({ kind: s.literal('k'), a: entry })]);
				const inputs: Array<[schema: s.AnySchema, input: Record<string, unknown>]> = [
					[O, {}],
					[V, { kind: 'k' }]
				];
				for (const [schema, input] of inputs) {
					const at = `${schema.kind} ${O.kind}: ${name}`;
					const absent = s.parse(schema, input);
					assert.strictEqual(absent.ok, missing, at);
					assert.strictEqual(s.is(schema, input), missing, at);
					const present = s.parse(schema, { ...input, a: undefined });
					assert.strictEqual(present.ok, undefined_value, at);
					assert.strictEqual(s.is(schema, { ...input, a: undefined }), undefined_value, at);
					if (absent.ok) {
						// a key left out stays out, unless a default fills it
						assert.deepEqual(
							absent.value,
							filled === undefined ? input : { ...input, a: filled },
							at
						);
						assert.strictEqual('a' in absent.value, filled !== undefined, at);
					} else if (undefined_value) {
						assert.deepEqual(absent.issues, [issue ?? MISSING_KEY], at);
						// a second parse does as the first did, a `lazy` having been used
						assert.deepEqual(issues_of(schema, input), [issue ?? MISSING_KEY], at);
						assert(!s.is(schema, input), at);
					} else {
						// the schema's own issue, as for an `undefined` value
						assert(!present.ok);
						assert.strictEqual(absent.issues.length, 1, at);
						assert.notStrictEqual(absent.issues[0]!.kind, 'missing_key', at);
						assert.deepEqual(absent.issues, present.issues, at);
					}
				}
			}
		}
	});

	test('unknown leaves the output the input itself, with its key or with it undefined', () => {
		for (const factory of factories) {
			const O = factory({ a: s.optional(s.string), b: s.unknown, c: s.optional(s.unknown) });
			for (const input of [{ b: undefined }, { b: 1 }, { a: 'a', b: null, c: undefined }]) {
				assert.strictEqual(s.parse_or_throw(O, input), input, O.kind);
			}
		}
	});

	test('an inherited or a non-enumerable key is there', () => {
		for (const factory of factories) {
			const O = factory({ a: s.unknown });
			for (const input of [
				Object.create({ a: undefined }),
				Object.defineProperty({}, 'a', { value: undefined, enumerable: false }),
				new (class {
					a = undefined;
				})(),
				new (class {
					get a(): undefined {
						return undefined;
					}
				})()
			]) {
				assert(s.is(O, input), O.kind);
				assert(s.parse(O, input).ok, O.kind);
			}
			// an object with no prototype has only its own
			assert(!s.is(O, Object.create(null)), O.kind);
			assert.deepEqual(issues_of(O, Object.create(null)), [MISSING_KEY], O.kind);
			// and a key named like a member of `Object.prototype` is inherited
			assert(s.is(factory({ toString: s.unknown }), {}), O.kind);
		}
	});

	test('a literal of undefined and a one_of with it need their key, as unknown does', () => {
		const literal_issue: s.SchemaIssue = {
			kind: 'literal',
			expected: 'undefined',
			received: 'string',
			path: ['a'],
			message: undefined
		};
		const one_of_issue: s.SchemaIssue = {
			kind: 'one_of',
			expected: '"x" | undefined',
			received: 'string',
			path: ['a'],
			message: undefined
		};
		for (const factory of factories) {
			const L = factory({ a: s.literal(undefined) });
			const O = factory({ a: s.one_of(['x', undefined]) });
			for (const schema of [L, O]) {
				const at = `${schema.kind}: ${schema.def.a.kind}`;
				// missing
				assert(!s.is(schema, {}), at);
				assert.deepEqual(issues_of(schema, {}), [MISSING_KEY], at);
				assert.strictEqual(
					s.format_issue(issues_of(schema, {})[0]!),
					'a: expected a required key, received undefined',
					at
				);
				assert.deepEqual(s.get_issue_value(issues_of(schema, {})[0]!, {}), {
					ok: true,
					value: undefined
				});
				// an object with no prototype has only its own keys
				assert(!s.is(schema, Object.create(null)), at);
				assert.deepEqual(issues_of(schema, Object.create(null)), [MISSING_KEY], at);
				// there, as its own, inherited, not enumerable, or a getter's: the input comes back
				for (const input of [
					{ a: undefined },
					Object.create({ a: undefined }),
					Object.defineProperty({}, 'a', { value: undefined, enumerable: false }),
					new (class {
						a = undefined;
					})(),
					new (class {
						get a(): undefined {
							return undefined;
						}
					})()
				]) {
					assert(s.is(schema, input), at);
					assert.strictEqual(s.parse_or_throw(schema, input), input, at);
				}
			}
			// another value is the schema's own issue, as it was
			assert(!s.is(L, { a: 'x' }));
			assert.deepEqual(issues_of(L, { a: 'x' }), [literal_issue]);
			assert.deepEqual(issues_of(L, { a: null }), [{ ...literal_issue, received: 'null' }]);
			const present: unknown = { a: 'x' };
			assert.strictEqual(s.parse_or_throw(O, present), present);
			assert(!s.is(O, { a: 'y' }));
			assert.deepEqual(issues_of(O, { a: 'y' }), [one_of_issue]);
			// in the order of the entries, before an unknown key, and a probe builds nothing
			const Three = factory({ a: s.string, b: s.literal(undefined), c: s.one_of([1, undefined]) });
			assert.deepEqual(
				issues_of(Three, { a: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['string', ['a']],
					['missing_key', ['b']],
					['missing_key', ['c']]
				]
			);
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			Three.run({ a: 'a', c: 1 }, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues, undefined);
		}
		// a `message` function is handed the issue and the value the entry was given
		const calls: Array<[kind: string, value: unknown]> = [];
		const Labeled = s.object({
			a: s.message(s.literal(undefined), (issue, value) => {
				calls.push([issue.kind, value]);
				return `no ${issue.kind}`;
			})
		});
		assert.deepEqual(issues_of(Labeled, {}), [{ ...MISSING_KEY, message: 'no missing_key' }]);
		assert.deepEqual(issues_of(Labeled, { a: 1 }), [
			{ ...literal_issue, received: 'number', message: 'no literal' }
		]);
		assert.deepEqual(calls, [
			['missing_key', undefined],
			['literal', 1]
		]);
	});

	test('a one_of needs its key wherever undefined is among its values', () => {
		for (const factory of factories) {
			const First = factory({ a: s.one_of([undefined, 'x']) });
			assert.strictEqual(First.def.a.run.length, 4);
			assert(!s.is(First, {}));
			assert.deepEqual(issues_of(First, {}), [MISSING_KEY]);
			for (const input of [{ a: undefined }, { a: 'x' }]) {
				assert(s.is(First, input));
				assert.strictEqual(s.parse_or_throw(First, input), input);
			}
			assert(!s.is(First, { a: 'y' }));
		}
	});

	test('a literal of undefined and a one_of with it outside an object accept undefined', () => {
		const schemas: Array<[schema: s.AnySchema, input: unknown]> = [
			[s.literal(undefined), undefined],
			[s.one_of(['x', undefined]), undefined],
			[s.array(s.literal(undefined)), [undefined]],
			// a hole, which is no key of the array
			[s.array(s.literal(undefined)), new Array(1)],
			[s.array(s.one_of(['x', undefined])), new Array(1)],
			[s.record(s.literal(undefined)), { a: undefined }],
			[s.record(s.one_of(['x', undefined])), { a: undefined }],
			[s.union([s.string, s.literal(undefined)]), undefined],
			[
				s.pipe(
					s.literal(undefined),
					s.check(() => true)
				),
				undefined
			],
			[s.message(s.one_of(['x', undefined]), 'm'), undefined],
			[s.nullable(s.literal(undefined)), undefined],
			[s.lazy(() => s.literal(undefined)), undefined]
		];
		for (const [schema, input] of schemas) {
			assert(s.is(schema, input), schema.kind);
			const result = s.parse(schema, input);
			assert(result.ok, schema.kind);
			assert.strictEqual(result.value, input, schema.kind);
		}
		// and called as anything but an object schema calls them
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		const bare: Array<s.AnySchema> = [s.literal(undefined), s.one_of([undefined])];
		for (const schema of bare) assert.strictEqual(schema.run(undefined, ctx), undefined);
		assert.strictEqual(ctx.fails, 0);
	});

	test('only a literal of undefined and a one_of with it take the object and the key', () => {
		assert.strictEqual(s.literal(undefined).run.length, 4);
		assert.strictEqual(s.one_of(['x', undefined]).run.length, 4);
		assert.strictEqual(s.one_of([undefined]).run.length, 4);
		// so the schemas that pass them on do around either
		assert.strictEqual(s.nullable(s.literal(undefined)).run.length, 4);
		assert.strictEqual(s.union([s.string, s.one_of(['x', undefined])]).run.length, 4);
		assert.strictEqual(
			s.pipe(
				s.literal(undefined),
				s.check(() => true)
			).run.length,
			4
		);
		// a `message` passes on whether what it holds is the entry itself too
		assert.strictEqual(s.message(s.literal(undefined), 'm').run.length, 5);
		// every other one is called as it was, and so is what holds it
		for (const schema of [
			s.literal('a'),
			s.literal(0),
			s.literal(NaN),
			s.literal(null),
			s.literal(false),
			s.literal(''),
			s.one_of(['x', 'y']),
			s.one_of([null, 0, '', false, NaN]),
			s.one_of([])
		]) {
			assert.strictEqual(schema.run.length, 2, String(schema.def));
			assert.strictEqual(s.nullable(schema).run.length, 2, String(schema.def));
			assert.strictEqual(s.union([s.string, schema]).run.length, 2, String(schema.def));
			assert.strictEqual(
				s.pipe(
					schema,
					s.check(() => true)
				).run.length,
				2,
				String(schema.def)
			);
			assert.strictEqual(s.message(schema, 'm').run.length, 2, String(schema.def));
		}
	});

	test('a variant option whose discriminator is a literal of undefined needs the key', () => {
		for (const factory of factories) {
			const V = s.variant('t', [
				factory({ t: s.literal(undefined), x: s.string }),
				factory({ t: s.literal('b') })
			]);
			// an input without the key selects the option, whose entry then refuses it
			assert(!s.is(V, { x: 'x' }));
			assert.deepEqual(issues_of(V, { x: 'x' }), [{ ...MISSING_KEY, path: ['t'] }]);
			// and the option's other entries run
			assert.deepEqual(
				issues_of(V, { x: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['missing_key', ['t']],
					['string', ['x']]
				]
			);
			// own or inherited, the key is there
			for (const input of [
				{ t: undefined, x: 'x' },
				Object.assign(Object.create({ t: undefined }), { x: 'x' })
			]) {
				assert(s.is(V, input));
				assert.strictEqual(s.parse_or_throw(V, input), input);
			}
			const other: unknown = { t: 'b' };
			assert.strictEqual(s.parse_or_throw(V, other), other);
			// with no such option a missing key is the variant's own issue, as it was
			const W = s.variant('t', [factory({ t: s.literal('a') }), factory({ t: s.literal('b') })]);
			assert.deepEqual(issues_of(W, {}), [
				{
					kind: 'variant',
					expected: '"a" | "b"',
					received: 'undefined',
					path: ['t'],
					message: undefined
				}
			]);
		}
	});

	test('unknown outside an object accepts undefined', () => {
		const schemas: Array<[schema: s.AnySchema, input: unknown]> = [
			[s.unknown, undefined],
			[s.array(s.unknown), [undefined]],
			// a hole, which is no key of the array
			[s.array(s.unknown), new Array(1)],
			[s.record(s.unknown), { a: undefined }],
			[s.union([s.string, s.unknown]), undefined],
			[
				s.pipe(
					s.unknown,
					s.check(() => true)
				),
				undefined
			],
			[s.message(s.unknown, 'm'), undefined],
			[s.optional(s.unknown), undefined],
			[s.nullable(s.unknown), undefined],
			[s.lazy(() => s.unknown), undefined]
		];
		for (const [schema, input] of schemas) {
			assert(s.is(schema, input), schema.kind);
			const result = s.parse(schema, input);
			assert(result.ok, schema.kind);
			assert.strictEqual(result.value, input, schema.kind);
		}
		// and called as anything but an object schema calls it
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		assert.strictEqual(s.unknown.run(undefined, ctx), undefined);
		assert.strictEqual(ctx.fails, 0);
	});

	test('a missing key is reported in the order of the entries, before unknown keys', () => {
		const O = s.object({
			a: s.number,
			b: s.unknown,
			c: s.object({ d: s.unknown, e: s.string }),
			f: s.optional(s.unknown),
			g: s.unknown
		});
		const input = { z: 1, c: { y: 2 }, a: 'x' };
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((issue) => [issue.kind, issue.path]),
			[
				['number', ['a']],
				['missing_key', ['b']],
				['missing_key', ['c', 'd']],
				['string', ['c', 'e']],
				['unknown_key', ['c', 'y']],
				['missing_key', ['g']],
				['unknown_key', ['z']]
			]
		);
		assert.deepEqual(issues[2], { ...MISSING_KEY, path: ['c', 'd'] });
		assert.deepEqual(issues.map(s.format_issue), [
			'a: expected number, received string',
			'b: expected a required key, received undefined',
			'c.d: expected a required key, received undefined',
			'c.e: expected string, received undefined',
			'c.y: expected no unknown keys, received number',
			'g: expected a required key, received undefined',
			'z: expected no unknown keys, received number'
		]);
		// the value of each is found in the input, a missing key's as `undefined`
		assert.deepEqual(
			issues.map((issue) => s.get_issue_value(issue, input)),
			[
				{ ok: true, value: 'x' },
				{ ok: true, value: undefined },
				{ ok: true, value: undefined },
				{ ok: true, value: undefined },
				{ ok: true, value: 2 },
				{ ok: true, value: undefined },
				{ ok: true, value: 1 }
			]
		);
		// and `loose_object` and `strip_object` report the same of their entries
		for (const factory of [s.loose_object, s.strip_object]) {
			const L = factory({ a: s.number, b: s.unknown, c: s.string });
			assert.deepEqual(
				issues_of(L, { a: 'x', z: 1 }).map((issue) => [issue.kind, issue.path]),
				[
					['number', ['a']],
					['missing_key', ['b']],
					['string', ['c']]
				]
			);
		}
		// an array's and a record's keys prefix it as they do any issue
		assert.deepEqual(issues_of(s.array(s.record(O)), [{ k: { a: 1, c: { d: 1, e: '' }, g: 1 } }]), [
			{ ...MISSING_KEY, path: [0, 'k', 'b'] }
		]);
	});

	test('a message around the object labels the issue, at any depth', () => {
		for (const factory of factories) {
			const O = factory({ a: s.unknown });
			assert.deepEqual(issues_of(s.message(O, 'object'), {}), [
				{ ...MISSING_KEY, message: 'object' }
			]);
			assert.deepEqual(issues_of(s.message(factory({ o: O }), 'outer'), { o: {} }), [
				{ ...MISSING_KEY, path: ['o', 'a'], message: 'outer' }
			]);
			assert.deepEqual(issues_of(s.message(s.array(s.record(O)), 'outer'), [{ k: {} }]), [
				{ ...MISSING_KEY, path: [0, 'k', 'a'], message: 'outer' }
			]);
			// the entry's own message is the innermost
			assert.deepEqual(issues_of(s.message(factory({ a: s.message(s.unknown, 'a') }), 'o'), {}), [
				{ ...MISSING_KEY, message: 'a' }
			]);
		}
	});

	test('unknown under a message needs its key, and the message labels the issue', () => {
		const calls: Array<[issue: s.SchemaIssue, value: unknown]> = [];
		const entries: Array<[name: string, entry: s.AnySchema, text: string]> = [
			['string', s.message(s.unknown, 'm'), 'm'],
			[
				'function',
				s.message(s.unknown, (issue, value) => {
					calls.push([issue, value]);
					return `no ${issue.kind}`;
				}),
				'no missing_key'
			],
			// the innermost wins, and the outer one passes the object on to it
			['nested', s.message(s.message(s.unknown, 'inner'), 'outer'), 'inner'],
			['flavor', s.message(s.flavor(s.unknown, 'F'), 'm'), 'm'],
			['brand', s.brand(s.message(s.unknown, 'm'), 'B'), 'm']
		];
		for (const factory of factories) {
			for (const [name, entry, text] of entries) {
				const O = factory({ a: entry });
				const at = `${O.kind}: ${name}`;
				assert(!s.is(O, {}), at);
				assert(s.is(O, { a: undefined }), at);
				const input = { a: undefined };
				assert.strictEqual(s.parse_or_throw(O, input), input, at);
				calls.length = 0;
				assert.deepEqual(issues_of(O, {}), [{ ...MISSING_KEY, message: text }], at);
				if (name === 'function') {
					// the issue before its path is prefixed, and the value the entry was given
					assert.strictEqual(calls.length, 1, at);
					assert.strictEqual(calls[0]![1], undefined, at);
					assert.strictEqual(calls[0]![0].kind, 'missing_key', at);
				}
				assert.strictEqual(s.format_issue(issues_of(O, {})[0]!), `a: ${text}`, at);
			}
		}
	});

	test('a message takes the object and the key only around a schema that does', () => {
		assert.strictEqual(s.unknown.run.length, 4);
		// and whether what it holds is the entry itself, which it passes on too
		assert.strictEqual(s.message(s.unknown, 'm').run.length, 5);
		assert.strictEqual(s.message(s.message(s.unknown, 'a'), 'b').run.length, 5);
		// around anything else it is called as it was, with the value alone
		for (const schema of [
			s.string,
			s.optional(s.unknown),
			s.nullable(s.string),
			s.nullable(s.optional(s.unknown)),
			s.union([s.string, s.optional(s.unknown)]),
			s.pipe(s.string, s.min_length(1)),
			s.pipe(s.nullable(s.optional(s.unknown)), s.unknown),
			s.object({ a: s.unknown }),
			s.min_length(1)
		]) {
			assert.strictEqual(schema.run.length, 2, schema.kind);
			assert.strictEqual(s.message(schema, 'm').run.length, 2, schema.kind);
		}
		// and so do the schemas that pass them on, each around one that takes them
		const used = s.lazy(() => s.string);
		s.is(used, '');
		for (const [schema, length] of [
			[s.nullable(s.unknown), 4],
			[s.nullable(s.nullable(s.unknown)), 4],
			[s.union([s.string, s.unknown]), 4],
			[s.union([s.string, s.nullable(s.unknown)]), 4],
			[s.pipe(s.unknown, s.unknown), 4],
			[s.pipe(s.nullable(s.unknown), s.unknown), 4],
			// a `pipe` takes them for itself after an `optional`, which takes neither,
			// and whether it is the entry itself
			[s.pipe(s.optional(s.unknown), s.unknown), 5],
			[s.pipe(s.message(s.optional(s.string), 'm'), accepts), 5],
			[s.pipe(s.pipe(s.optional(s.string), accepts), accepts), 5],
			[s.nullable(s.pipe(s.optional(s.string), accepts)), 4],
			// or around a `lazy`, whatever it defers to and whether it has been used
			[s.nullable(s.lazy(() => s.string)), 4],
			[s.union([s.string, s.lazy(() => s.string)]), 4],
			[
				s.pipe(
					s.lazy(() => s.string),
					s.min_length(1)
				),
				4
			],
			[s.nullable(used), 4]
		] as const) {
			assert.strictEqual(schema.run.length, length, schema.kind);
			assert.strictEqual(s.message(schema, 'm').run.length, 5, schema.kind);
		}
		// a `lazy` itself declares two, and a `message` around one takes them for it
		for (const lazy of [s.lazy(() => s.string), s.lazy(() => s.unknown), used]) {
			assert.strictEqual(lazy.run.length, 2);
			assert.strictEqual(s.message(lazy, 'm').run.length, 5);
		}
		// a consumer's schema that declares them is handed them
		const seen: Array<unknown> = [];
		const Own: s.Schema<unknown, unknown, 'own', undefined> = {
			kind: 'own',
			def: undefined,
			run: (value, _ctx, parent, key) => {
				seen.push(parent, key);
				return value;
			}
		};
		const input = { a: 1 };
		s.parse_or_throw(s.object({ a: s.message(Own, 'm') }), input);
		assert.deepEqual(seen, [input, 'a']);
		assert.strictEqual(seen[0], input);
		// one that declares the object alone is handed it, and a function gets
		// the value that schema was given, not what it returned
		const values: Array<unknown> = [];
		const Refuses: s.Schema<unknown, unknown, 'refuses', undefined> = {
			kind: 'refuses',
			def: undefined,
			run: (value, ctx, parent) => {
				if (parent) s.fail(ctx, 'refuses', value);
				return null;
			}
		};
		assert.strictEqual(Refuses.run.length, 3);
		const Labeled = s.message(Refuses, (_issue, value) => {
			values.push(value);
			return 'm';
		});
		assert.strictEqual(Labeled.run.length, 5);
		assert(s.is(Labeled, 1));
		assert.deepEqual(issues_of(s.object({ a: Labeled }), input), [
			{ kind: 'refuses', expected: 'refuses', received: 'number', path: ['a'], message: 'm' }
		]);
		assert.deepEqual(values, [1]);
	});

	test('a probe counts a missing key and builds nothing', () => {
		let calls = 0;
		const Counted = s.pipe(
			s.unknown,
			s.check(() => {
				calls++;
				return true;
			})
		);
		for (const factory of factories) {
			const O = factory({ a: s.unknown, b: Counted });
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			calls = 0;
			O.run({ b: 1 }, ctx);
			assert.strictEqual(ctx.fails, 1, O.kind);
			assert.strictEqual(ctx.issues, undefined, O.kind);
			// and it is the first failure, where the probe stops
			assert.strictEqual(calls, 0, O.kind);
			// outside a probe every entry runs, and the count is the number of issues.
			// A pipe whose first schema misses its key runs no step after it
			const collect: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			O.run({}, collect);
			assert.strictEqual(calls, 0, O.kind);
			assert.strictEqual(collect.fails, 2, O.kind);
			assert.strictEqual(collect.issues?.length, 2, O.kind);
			O.run({ a: 1, b: undefined }, collect);
			assert.strictEqual(calls, 1, O.kind);
			assert.strictEqual(collect.fails, 2, O.kind);
			// a union probes its options and reports itself
			const U = s.union([O, s.string]);
			assert(!s.is(U, { b: 1 }));
			assert.deepEqual(issues_of(U, { b: 1 }), [
				{
					kind: 'union',
					expected: 'object | string',
					received: 'object',
					path: [],
					message: undefined
				}
			]);
			assert(s.is(U, { a: undefined, b: 1 }));
		}
	});

	test('an entry is handed the object, its key, and 1, and need not take them', () => {
		const seen: Array<Array<unknown>> = [];
		const Spy: s.Schema = {
			kind: 'spy',
			def: undefined,
			run: (...args) => {
				seen.push(args);
				return args[0];
			}
		};
		// a schema written against the first two parameters only
		const Two: s.Schema<string> = {
			kind: 'two',
			def: undefined,
			run: (value, ctx) => (typeof value === 'string' ? value : s.fail(ctx, 'two', value))
		};
		for (const factory of factories) {
			seen.length = 0;
			const O = factory({ a: Spy, b: Two });
			const input = { a: 1, b: 'b' };
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0]!.length, 5);
			assert.strictEqual(seen[0]![2], input);
			assert.strictEqual(seen[0]![3], 'a');
			assert.strictEqual(seen[0]![4], 1);
			assert(!s.is(O, { a: 1 }));
			assert.deepEqual(
				issues_of(O, { a: 1 }).map((issue) => [issue.kind, issue.received, issue.path]),
				[['two', 'undefined', ['b']]]
			);
		}
		// a `run` that declares neither is handed neither by a schema that holds it
		for (const schema of [
			s.array(Spy),
			s.record(Spy),
			s.union([Spy]),
			s.optional(Spy),
			s.nullable(Spy),
			s.with_default(Spy, 1),
			s.message(Spy, 'm'),
			s.pipe(
				Spy,
				s.check(() => true)
			)
		]) {
			for (const factory of factories) {
				seen.length = 0;
				s.parse(factory({ a: schema }), { a: schema.kind === 'record' ? { k: 1 } : [1] });
				assert.strictEqual(seen.length, 1, schema.kind);
				assert.strictEqual(seen[0]!.length, 2, schema.kind);
			}
		}
		// but by a `lazy`, which is the schema it defers to, with the object and
		// the key and not the `1`: what it defers to is not the entry itself
		const deferred = s.lazy(() => Spy);
		for (const factory of factories) {
			seen.length = 0;
			const input = { a: 1 };
			s.parse(factory({ a: deferred }), input);
			assert.strictEqual(seen.length, 1);
			assert.strictEqual(seen[0]!.length, 4);
			assert.strictEqual(seen[0]![2], input);
			assert.strictEqual(seen[0]![3], 'a');
		}
	});

	test('a schema that passes the object on hands it to a run that declares it', () => {
		const seen: Array<Array<unknown>> = [];
		const Keyed: s.Schema = {
			kind: 'keyed',
			def: undefined,
			run: (value, ctx, parent, key) => {
				seen.push([value, ctx, parent, key]);
				return value;
			}
		};
		const Plain: s.Schema = {
			kind: 'plain',
			def: undefined,
			run: (value, ctx) => s.fail(ctx, 'plain', value)
		};
		const holders: Array<[name: string, schema: s.AnySchema, calls: number]> = [
			['nullable', s.nullable(Keyed), 1],
			['lazy', s.lazy(() => Keyed), 1],
			['message', s.message(Keyed, 'm'), 1],
			// every option is handed them, in order, to the first that matches
			['union', s.union([Plain, Keyed, Keyed]), 1],
			// the first schema of a pipe is, and the steps after it are not
			['pipe', s.pipe(Keyed, Keyed), 2],
			['all of them', s.message(s.nullable(s.lazy(() => s.union([s.pipe(Keyed, passes)]))), 'm'), 1]
		];
		for (const factory of factories) {
			for (const [name, schema, calls] of holders) {
				const input = { a: 1 };
				for (const parse of [s.parse, s.is]) {
					seen.length = 0;
					parse(factory({ a: schema }), input);
					const at = `${factory({}).kind}: ${name}`;
					assert.strictEqual(seen.length, calls, at);
					assert.strictEqual(seen[0]![2], input, at);
					assert.strictEqual(seen[0]![3], 'a', at);
					if (calls > 1) assert.deepEqual(seen[1]!.slice(2), [undefined, undefined], at);
				}
				// and neither outside an object
				seen.length = 0;
				s.parse(schema, 1);
				assert.deepEqual(seen[0]!.slice(2), [undefined, undefined], name);
			}
		}
	});

	test('a pipe whose first schema misses its key runs no step after it', () => {
		for (const factory of factories) {
			let calls = 0;
			const counted = s.check(() => {
				calls++;
				return true;
			});
			const mapped = s.transform(() => {
				calls++;
				return 'T';
			});
			for (const head of [s.unknown, s.nullable(s.unknown), s.lazy(() => s.unknown)]) {
				const O = factory({ a: s.pipe(head, counted, mapped) });
				for (let i = 0; i < 2; i++) {
					calls = 0;
					assert(!s.is(O, {}), head.kind);
					assert.deepEqual(issues_of(O, {}), [MISSING_KEY], head.kind);
					assert.strictEqual(calls, 0, head.kind);
					// with the key there every step runs, on `undefined` too
					assert.deepEqual(s.parse_or_throw(O, { a: undefined }), { a: 'T' }, head.kind);
					assert.strictEqual(calls, 2, head.kind);
					assert.deepEqual(s.parse_or_throw(O, { a: 1 }), { a: 'T' }, head.kind);
				}
			}
		}
	});

	describe('a pipe whose first schema let a missing key through', () => {
		// a step that fails whatever it is given, one that replaces it, and one
		// that passes it on, each counting its calls
		let calls = 0;
		const refuses = s.check<any>(() => {
			calls++;
			return false;
		}, 'never');
		const mapped = s.transform((v: unknown) => {
			calls++;
			return v ?? 'T';
		});
		const counted = s.check<any>(() => {
			calls++;
			return true;
		});
		const refused: s.SchemaIssue = {
			kind: 'check',
			expected: 'never',
			received: 'undefined',
			path: ['a'],
			message: undefined
		};
		const inherited = (): object => Object.create({ a: undefined });
		const hidden = (): object => Object.defineProperty({}, 'a', { value: undefined });

		// the first schemas a pipe starts with an `optional` by, each made anew
		const stopping: Array<[name: string, make: () => s.AnySchema]> = [
			['optional', () => s.optional(s.string)],
			['optional unknown', () => s.optional(s.unknown)],
			['optional nullable', () => s.optional(s.nullable(s.string))],
			['optional default', () => s.optional(s.with_default(s.string, 'd'))],
			['optional lazy', () => s.optional(s.lazy(() => s.string))],
			['message optional', () => s.message(s.optional(s.string), 'm')],
			['flavor optional', () => s.flavor(s.optional(s.string), 'F')],
			['brand optional', () => s.brand(s.optional(s.string), 'B')],
			['meta optional', () => meta(s.optional(s.string), { description: 'd' })],
			['pipe of an optional', () => s.pipe(s.optional(s.string), accepts)],
			[
				'pipe of a pipe of an optional',
				() => s.pipe(s.pipe(s.optional(s.string), accepts), accepts)
			],
			['message pipe of an optional', () => s.message(s.pipe(s.optional(s.string), accepts), 'm')],
			['meta pipe of an optional', () => meta(s.pipe(s.optional(s.string), accepts), {})]
		];

		// and the ones that let a missing key through without being one
		const passing: Array<[name: string, make: () => s.AnySchema]> = [
			['nullable optional', () => s.nullable(s.optional(s.string))],
			['lazy optional', () => s.lazy(() => s.optional(s.string))],
			['lazy lazy optional', () => s.lazy(() => s.lazy(() => s.optional(s.string)))],
			['nullable lazy optional', () => s.nullable(s.lazy(() => s.optional(s.string)))],
			['union with an optional', () => s.union([s.number, s.optional(s.string)])],
			['union with a lazy optional', () => s.union([s.number, s.lazy(() => s.optional(s.string))])],
			['union with an unknown and an optional', () => s.union([s.unknown, s.optional(s.string)])],
			['default of undefined', () => s.with_default(s.optional(s.string), undefined)],
			['check', () => s.check<any>(() => true)],
			['transform', () => s.transform((v: unknown) => v)],
			[
				'pipe of a lazy optional',
				() =>
					s.pipe(
						s.lazy(() => s.optional(s.string)),
						accepts
					)
			],
			['pipe of a nullable optional', () => s.pipe(s.nullable(s.optional(s.string)), accepts)]
		];

		test('runs no step after it, and leaves the key out', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					for (const step of [refuses, mapped, counted]) {
						const O = factory({ a: s.pipe(make(), step) });
						const at = `${factory({}).kind}: ${name}, ${step.kind}`;
						// twice, a `lazy` having its schema by the second
						for (let i = 0; i < 2; i++) {
							calls = 0;
							const input = {};
							assert.strictEqual(s.parse_or_throw(O, input), input, at);
							assert(s.is(O, input), at);
							assert.strictEqual(calls, 0, at);
						}
					}
				}
			}
		});

		test('beside an entry that changes, the key is not in the copy', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					const O = factory({
						d: s.with_default(s.string, 'D'),
						a: s.pipe(make(), mapped),
						e: s.with_default(s.string, 'E')
					});
					// typed with the key, which a `pipe` entry always has in the types
					const output: object = s.parse_or_throw(O, {});
					assert.deepEqual(output, { d: 'D', e: 'E' }, name);
					assert(!('a' in output), name);
				}
			}
		});

		test('runs every step when the key is there, on `undefined` too', () => {
			for (const factory of factories) {
				for (const [name, make] of stopping) {
					const at = `${factory({}).kind}: ${name}`;
					const R = factory({ a: s.pipe(make(), refuses) });
					const M = factory({ a: s.pipe(make(), mapped) });
					for (const [input, received] of [
						[{ a: undefined }, 'undefined'],
						[inherited(), 'undefined'],
						[hidden(), 'undefined'],
						[{ a: 'x' }, 'string']
					] as const) {
						calls = 0;
						assert.deepEqual(issues_of(R, input), [{ ...refused, received }], at);
						assert(!s.is(R, input), at);
						assert.strictEqual(calls, 2, at);
					}
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'T' }, at);
					assert.deepEqual(s.parse_or_throw(M, inherited()), { a: 'T' }, at);
					assert.deepEqual(s.parse_or_throw(M, hidden()), { a: 'T' }, at);
					const present = { a: 'x' };
					assert.strictEqual(s.parse_or_throw(M, present), present, at);
				}
			}
		});

		test('a first schema that fills a default has the steps run on it', () => {
			for (const factory of factories) {
				for (const head of [
					s.with_default(s.string, 'd'),
					s.lazy(() => s.with_default(s.string, 'd')),
					s.nullable(s.with_default(s.string, 'd'))
				]) {
					const at = `${factory({}).kind}: ${head.kind}`;
					const R = factory({ a: s.pipe(head, refuses) });
					const M = factory({
						a: s.pipe(
							head,
							s.transform((v) => v + '!')
						)
					});
					for (const input of [{}, { a: undefined }, inherited(), { a: 'x' }]) {
						calls = 0;
						assert.deepEqual(issues_of(R, input), [{ ...refused, received: 'string' }], at);
						assert(!s.is(R, input), at);
						assert.strictEqual(calls, 2, at);
					}
					assert.deepEqual(s.parse_or_throw(M, {}), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, inherited()), { a: 'd!' }, at);
					assert.deepEqual(s.parse_or_throw(M, { a: 'x' }), { a: 'x!' }, at);
				}
			}
		});

		test('after any other schema that let the key through, the steps run on `undefined`', () => {
			for (const factory of factories) {
				for (const [name, make] of passing) {
					const at = `${factory({}).kind}: ${name}`;
					const R = factory({ a: s.pipe(make(), refuses) });
					const M = factory({ a: s.pipe(make(), mapped) });
					// twice, a `lazy` having its schema by the second
					for (let i = 0; i < 2; i++) {
						calls = 0;
						assert.deepEqual(issues_of(R, {}), [refused], at);
						assert(!s.is(R, {}), at);
						assert.strictEqual(calls, 2, at);
						assert.deepEqual(s.parse_or_throw(M, {}), { a: 'T' }, at);
					}
				}
			}
		});

		// a `message` hands it the object, the key, and that it is the entry itself
		test('under a message it runs no step either', () => {
			const wrappers: Array<[name: string, wrap: (schema: s.AnySchema) => s.AnySchema]> = [
				['message', (schema) => s.message(schema, 'm')],
				['message message', (schema) => s.message(s.message(schema, 'a'), 'b')]
			];
			for (const factory of factories) {
				for (const [name, wrap] of wrappers) {
					for (const step of [refuses, mapped] as Array<s.AnySchema>) {
						const O = factory({ a: wrap(s.pipe(s.optional(s.string), step)) });
						const at = `${factory({}).kind}: ${name}, ${step.kind}`;
						for (let i = 0; i < 2; i++) {
							calls = 0;
							const input = {};
							assert.strictEqual(s.parse_or_throw(O, input), input, at);
							assert(s.is(O, input), at);
							assert.strictEqual(calls, 0, at);
						}
						// and every step with the key there
						assert.strictEqual(s.is(O, { a: undefined }), step === mapped, at);
						assert.strictEqual(calls, 1, at);
					}
				}
				// under one that takes `undefined` first, it is never asked
				const D = factory({ a: s.with_default(s.pipe(s.optional(s.string), refuses), 'd') });
				assert.deepEqual(s.parse_or_throw(D, {}), { a: 'd' });
			}
		});

		// a `nullable`, a `lazy`, and a `union` hand it the object and the key, and
		// not that it is the entry itself, so it is a step of the schema that is
		test('under a nullable, a lazy, or a union its steps run on `undefined`', () => {
			// typed as any schema, as the steps above take any value
			const optional_string = (): s.AnySchema => s.optional(s.string);
			const wrappers: Array<
				[name: string, wrap: (schema: s.AnySchema) => s.AnySchema, issue: s.SchemaIssue]
			> = [
				['nullable', (schema) => s.nullable(schema), refused],
				['lazy', (schema) => s.lazy(() => schema), refused],
				['union', (schema) => s.union([s.number, schema]), union_issue('number | string')],
				['nullable lazy', (schema) => s.nullable(s.lazy(() => schema)), refused],
				[
					'message nullable',
					(schema) => s.message(s.nullable(schema), 'm'),
					{ ...refused, message: 'm' }
				],
				[
					'nullable message',
					(schema) => s.nullable(s.message(schema, 'm')),
					{ ...refused, message: 'm' }
				]
			];
			for (const factory of factories) {
				for (const [name, wrap, issue] of wrappers) {
					const R = factory({ a: wrap(s.pipe(optional_string(), refuses)) });
					const M = factory({ a: wrap(s.pipe(optional_string(), mapped)) });
					const at = `${factory({}).kind}: ${name}`;
					// twice, a `lazy` having its schema by the second
					for (let i = 0; i < 2; i++) {
						calls = 0;
						assert.deepEqual(issues_of(R, {}), [issue], at);
						assert(!s.is(R, {}), at);
						assert.strictEqual(calls, 2, at);
						assert.deepEqual(s.parse_or_throw(M, {}), { a: 'T' }, at);
						assert.strictEqual(calls, 3, at);
					}
					// as with the key there
					calls = 0;
					assert(!s.is(R, { a: undefined }), at);
					assert.deepEqual(s.parse_or_throw(M, { a: undefined }), { a: 'T' }, at);
					assert.strictEqual(calls, 2, at);
				}
			}
		});

		// the steps fail the missing key where both zod and valibot refuse it: one
		// fails beside a `transform`, in the pipe or in a pipe around the wrapper
		test('so under those a step that fails beside a transform refuses the missing key', () => {
			const head = (): s.AnySchema =>
				s.pipe(
					s.optional(s.string),
					s.transform((v: string | undefined) => v),
					refuses
				);
			for (const factory of factories) {
				for (const [name, entry] of [
					['nullable', s.nullable(head())],
					['lazy', s.lazy(() => head())],
					['union', s.union([s.number, head()])],
					[
						'nullable then a transform',
						s.pipe(
							s.nullable(s.pipe(s.optional(s.string), refuses)),
							s.transform(() => 'T')
						)
					],
					[
						'lazy then a transform',
						s.pipe(
							s.lazy(() => s.pipe(s.optional(s.string), refuses)),
							s.transform(() => 'T')
						)
					]
				] as const) {
					const O = factory({ a: entry });
					const at = `${factory({}).kind}: ${name}`;
					assert(!s.parse(O, {}).ok, at);
					assert(!s.is(O, {}), at);
				}
			}
		});

		test('outside an object a pipe runs its steps on `undefined`', () => {
			for (const [name, make] of stopping) {
				const R = s.pipe(make(), refuses);
				const M = s.pipe(make(), mapped);
				calls = 0;
				// at the top level
				assert.deepEqual(issues_of(R, undefined), [{ ...refused, path: [] }], name);
				assert(!s.is(R, undefined), name);
				assert.strictEqual(s.parse_or_throw(M, undefined), 'T', name);
				// as an array's item, a hole among them
				// eslint-disable-next-line no-sparse-arrays
				assert.deepEqual(s.parse_or_throw(s.array(M), [undefined, , 'x']), ['T', 'T', 'x'], name);
				assert.deepEqual(issues_of(s.array(R), [undefined]), [{ ...refused, path: [0] }], name);
				// as a record's value
				assert.deepEqual(s.parse_or_throw(s.record(M), { a: undefined }), { a: 'T' }, name);
				// under a wrapper that takes neither the object nor the key
				assert.deepEqual(
					s.parse_or_throw(s.object({ a: s.with_default(M, 'd') }), { a: 'x' }),
					{ a: 'x' },
					name
				);
				// and as a step after the first
				assert.deepEqual(
					s.parse_or_throw(s.object({ a: s.pipe(s.optional(s.string), M) }), { a: undefined }),
					{ a: 'T' },
					name
				);
				assert(calls > 0, name);
			}
		});

		test('a message around it labels nothing for a missing key', () => {
			for (const factory of factories) {
				const O = factory({
					a: s.message(s.pipe(s.optional(s.string), refuses), 'm'),
					b: s.string
				});
				assert.deepEqual(issues_of(O, {}), [
					{
						kind: 'string',
						expected: 'string',
						received: 'undefined',
						path: ['b'],
						message: undefined
					}
				]);
				assert.deepEqual(issues_of(O, { a: undefined, b: '' }), [{ ...refused, message: 'm' }]);
			}
		});

		test('the context is as the first schema left it', () => {
			const O = s.object({ z: s.string, a: s.pipe(s.optional(s.string), refuses) });
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			O.run({}, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues?.length, 1);
			const probe: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
			s.object({ a: s.pipe(s.optional(s.string), refuses) }).run({}, probe);
			assert.strictEqual(probe.fails, 0);
			assert.strictEqual(probe.issues, undefined);
		});
	});

	// a declared difference as the entry itself, under a message, and as the first
	// schema of another pipe: zod and valibot write the key as `undefined`
	describe('a pipe that starts with a default leaves a missing key out when its steps give `undefined`', () => {
		const factories = [s.object, s.strip_object, s.loose_object] as const;
		// a default whose steps give `undefined`, each made anew
		const gone = (): s.AnySchema =>
			s.pipe(
				s.with_default(s.string, 'D'),
				s.transform(() => undefined)
			);
		const refuses = s.check<any>(() => false, 'never');

		test('as the entry itself, and in a copy begun by another key', () => {
			for (const factory of factories) {
				const input = {};
				assert.strictEqual(s.parse_or_throw(factory({ a: gone() }), input), input);
				assert.ok(s.is(factory({ a: gone() }), {}));
				// with the key there the input comes back
				const present = { a: undefined };
				assert.strictEqual(s.parse_or_throw(factory({ a: gone() }), present), present);
				const copied = s.parse_or_throw(
					factory({ d: s.with_default(s.string, 'D'), a: gone() }),
					{}
				);
				assert.deepEqual<unknown>(copied, { d: 'D' });
				assert.ok(!Object.hasOwn(copied, 'a'));
			}
		});

		test('under a message, a nullable, a lazy, or a union, and as the first schema of another pipe', () => {
			for (const entry of [
				s.message(gone(), 'm'),
				s.nullable(gone()),
				s.lazy(() => gone()),
				s.union([s.number, gone()]),
				s.pipe(
					gone(),
					s.transform((v: unknown) => v)
				)
			]) {
				const output = s.parse_or_throw(s.object({ a: entry }), {});
				assert.deepEqual<unknown>(output, {});
				assert.ok(!Object.hasOwn(output, 'a'));
			}
		});

		test('a default that its steps keep is written, and a step that fails is reported', () => {
			const kept = s.object({
				a: s.pipe(
					s.with_default(s.string, 'D'),
					s.transform((v: string) => v + '!')
				)
			});
			assert.deepEqual(s.parse_or_throw(kept, {}), { a: 'D!' });
			const failing = s.object({
				a: s.pipe(s.with_default(s.optional(s.string), undefined), refuses)
			});
			assert.deepEqual(
				issues_of(failing, {}).map((issue) => issue.path),
				[['a']]
			);
			assert.ok(!s.is(failing, {}));
		});

		test('outside an object it gives what its steps give', () => {
			assert.strictEqual(s.parse_or_throw(gone(), undefined), undefined);
			assert.deepEqual(s.parse_or_throw(s.array(gone()), [undefined]), [undefined]);
			assert.deepEqual(s.parse_or_throw(s.record(gone()), { a: undefined }), { a: undefined });
		});
	});

	test('a union run again runs an option once more for each enclosing union, and no more', () => {
		for (let depth = 1; depth <= 4; depth++) {
			let calls = 0;
			// takes the object and the key (a `lazy`), runs its transform on a missing
			// key, and fails for another reason, so each union that fills the key in
			// runs it again without the key
			const option = s.pipe(
				s.lazy(() => s.optional(s.string)),
				s.transform((value: string | undefined) => {
					calls++;
					return value;
				}),
				s.check(() => false)
			);
			let schema: s.AnySchema = s.with_default(s.string, 'D');
			for (let i = 0; i < depth; i++) schema = s.union([option, schema]);
			assert.deepEqual(s.parse_or_throw(s.object({ a: schema }), {}), { a: 'D' });
			// once with the key at every depth, and once more as each union retries
			assert.strictEqual(calls, 2 * depth);
		}
	});

	test('a union that matches a missing key with `undefined` tries no option again', () => {
		const U = (): s.AnySchema =>
			s.pipe(
				s.unknown,
				s.transform(() => 'U')
			);
		for (const factory of factories) {
			// the first that matches is the `optional`, though a default follows it
			assert.deepEqual<unknown>(
				s.parse_or_throw(
					factory({ a: s.union([U(), s.optional(s.string), s.with_default(s.string, 'D')]) }),
					{}
				),
				{}
			);
			// an inner union that fills the key in and then matches an option
			// before it with `undefined` gives the outer one `undefined`, and the
			// outer one tries none again, where the same options in one union
			// give `{a: 'U'}`
			const inner = s.union([s.string, s.unknown, s.with_default(s.string, 'D')]);
			assert.deepEqual<unknown>(s.parse_or_throw(factory({ a: s.union([U(), inner]) }), {}), {});
			assert.deepEqual(
				s.parse_or_throw(
					factory({ a: s.union([U(), s.string, s.unknown, s.with_default(s.string, 'D')]) }),
					{}
				),
				{ a: 'U' }
			);
		}
	});

	test('a union tries every option with the key missing, and reports itself', () => {
		for (const factory of factories) {
			const order: Array<string> = [];
			// a spy that takes the object and the key where its schema does
			const spy = (name: string, schema: s.AnySchema): s.AnySchema => ({
				kind: schema.kind,
				def: schema.def,
				run:
					schema.run.length > 2
						? (value, ctx, parent, key) => {
								order.push(name);
								return schema.run(value, ctx, parent, key);
							}
						: (value, ctx) => {
								order.push(name);
								return schema.run(value, ctx);
							}
			});
			const U = s.union([
				spy('string', s.string),
				spy('unknown', s.unknown),
				spy('default', s.with_default(s.unknown, 'd')),
				spy('never', s.unknown)
			]);
			const O = factory({ a: U });
			// the first that lets the key be missing fills it in, which makes it
			// optional, and the options before it that take the object and the key
			// are tried again without them: the first of those that matches gives
			// the output
			const missing = {};
			assert.strictEqual(s.parse_or_throw(O, missing), missing);
			assert.deepEqual(order, ['string', 'unknown', 'default', 'unknown']);
			assert(s.is(O, {}));
			// one that leaves the key `undefined` gives the output, and none is
			// tried again
			order.length = 0;
			const L = factory({
				a: s.union([spy('unknown', s.unknown), spy('optional', s.optional(s.string))])
			});
			const absent = {};
			assert.strictEqual(s.parse_or_throw(L, absent), absent);
			assert.deepEqual(order, ['unknown', 'optional']);
			// with none of those before it, it gives the output itself
			order.length = 0;
			const D = factory({
				a: s.union([spy('string', s.string), spy('default', s.with_default(s.unknown, 'd'))])
			});
			assert.deepEqual(s.parse_or_throw(D, {}), { a: 'd' });
			assert.deepEqual(order, ['string', 'default']);
			// and with the key there, the first that takes the value
			order.length = 0;
			const input = { a: undefined };
			assert.strictEqual(s.parse_or_throw(O, input), input);
			assert.deepEqual(order, ['string', 'unknown']);
			// with none, one issue, which is the union's and not an option's
			const N = factory({ a: s.union([s.string, s.unknown, s.nullable(s.unknown)]), b: s.string });
			assert.deepEqual(issues_of(N, { b: 1 }), [
				union_issue('string | unknown | null'),
				{ kind: 'string', expected: 'string', received: 'number', path: ['b'], message: undefined }
			]);
			assert.deepEqual(s.get_issue_value(issues_of(N, {})[0]!, {}), { ok: true, value: undefined });
			// the probe of the options leaves the context as it was
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			N.run({ b: '' }, ctx);
			assert.strictEqual(ctx.fails, 1);
			assert.strictEqual(ctx.issues?.length, 1);
			assert.strictEqual(ctx.probe, false);
			// and so does the second try of the options before the one that matched
			const tried: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			factory({
				a: s.union([
					s.pipe(
						s.unknown,
						s.check(() => false)
					),
					s.nullable(s.unknown),
					s.with_default(s.string, 'D')
				])
			}).run({}, tried);
			assert.strictEqual(tried.fails, 0);
			assert.strictEqual(tried.issues, undefined);
			assert.strictEqual(tried.probe, false);
		}
	});

	test('a union whose option needs its key lets no later default fill it in', () => {
		for (const factory of factories) {
			// the pipe runs its step on the `undefined` the missing key reads as
			const U = s.union([
				s.pipe(
					s.unknown,
					s.transform((v: unknown) => (v === undefined ? 'U' : v))
				),
				s.with_default(s.string, 'D')
			]);
			assert.deepEqual(s.parse_or_throw(factory({ a: U }), {}), { a: 'U' });
			// so a check around it refuses the key, as zod and valibot both do
			const Checked = factory({
				a: s.pipe(
					s.union([
						s.pipe(
							s.unknown,
							s.transform((v: unknown) => v)
						),
						s.with_default(s.string, 'D')
					]),
					s.check((v: unknown) => v !== undefined)
				)
			});
			assert(!s.parse(Checked, {}).ok);
			assert(!s.is(Checked, {}));
			assert.deepEqual(s.parse_or_throw(Checked, { a: 'x' }), { a: 'x' });
			// and under a `nullable`, a `lazy`, and a `message`, which pass the object on
			for (const entry of [s.nullable(U), s.lazy(() => U), s.message(U, 'm')]) {
				assert.deepEqual(s.parse_or_throw(factory({ a: entry }), {}), { a: 'U' }, entry.kind);
			}
			// one that fails again without the object leaves the default's value
			const Refused = factory({
				a: s.union([
					s.pipe(
						s.unknown,
						s.check(() => false)
					),
					s.with_default(s.string, 'D')
				])
			});
			assert.deepEqual(s.parse_or_throw(Refused, {}), { a: 'D' });
			// and a `lazy` is tried again too, as it passes the object on
			const Deferred = factory({
				a: s.union([
					s.lazy(() =>
						s.pipe(
							s.unknown,
							s.transform(() => 'U')
						)
					),
					s.with_default(s.string, 'D')
				])
			});
			assert.deepEqual(s.parse_or_throw(Deferred, {}), { a: 'U' });
		}
	});

	test('a union runs each option no more often than it is asked to', () => {
		let transforms = 0;
		const counted = (): s.AnySchema =>
			s.transform((v: unknown) => {
				transforms++;
				return v;
			});
		const runs: Record<string, number> = {};
		// counts the calls of a schema's `run`, taking the object and the key where it does
		const spy = (name: string, schema: s.AnySchema): s.AnySchema => ({
			kind: schema.kind,
			def: schema.def,
			run:
				schema.run.length > 2
					? (value, ctx, parent, key) => {
							runs[name] = (runs[name] ?? 0) + 1;
							return schema.run(value, ctx, parent, key);
						}
					: (value, ctx) => {
							runs[name] = (runs[name] ?? 0) + 1;
							return schema.run(value, ctx);
						}
		});
		// each union with the runs of its options and of its transform for a
		// missing key, an `undefined` one, and a string
		const unions: Array<
			[
				name: string,
				make: () => s.AnySchema,
				expected: Array<[runs: Record<string, number>, transforms: number]>
			]
		> = [
			// a pipe that starts with an optional, after an option that refuses `undefined`
			[
				'number, optional then a transform',
				() =>
					s.union([spy('number', s.number), spy('pipe', s.pipe(s.optional(s.string), counted()))]),
				[
					[{ number: 1, pipe: 1 }, 1],
					[{ number: 1, pipe: 1 }, 1],
					[{ number: 1, pipe: 1 }, 1]
				]
			],
			// an option that needs its key before a default that fills it in: the
			// first is run again without the object, and its step runs then
			[
				'unknown then a transform, default',
				() =>
					s.union([
						spy('pipe', s.pipe(s.unknown, counted())),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 2, default: 1 }, 1],
					[{ pipe: 1 }, 1],
					[{ pipe: 1 }, 1]
				]
			],
			// before an optional, which leaves the key `undefined`, none is run again
			[
				'unknown then a transform, optional',
				() =>
					s.union([
						spy('pipe', s.pipe(s.unknown, counted())),
						spy('optional', s.optional(s.string))
					]),
				[
					[{ pipe: 1, optional: 1 }, 0],
					[{ pipe: 1 }, 1],
					[{ pipe: 1 }, 1]
				]
			],
			// an option that takes the object and the key and fails for another
			// reason, before a default: it is run again, and so is its transform,
			// twice in the parse
			[
				'optional then a transform and a check that fails, default',
				() =>
					s.union([
						spy(
							'pipe',
							s.pipe(
								s.optional(s.string),
								counted(),
								s.check(() => false)
							)
						),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 2, default: 1 }, 2],
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1]
				]
			],
			// one that doesn't take them fails the same without them, and isn't
			[
				'a transform and a check that fails, default',
				() =>
					s.union([
						spy(
							'pipe',
							s.pipe(
								counted(),
								s.check(() => false)
							)
						),
						spy('default', s.with_default(s.string, 'D'))
					]),
				[
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1],
					[{ pipe: 1, default: 1 }, 1]
				]
			]
		];
		for (const factory of factories) {
			for (const [name, make, expected] of unions) {
				const O = factory({ a: make() });
				const inputs = [{}, { a: undefined }, { a: 'x' }];
				for (let i = 0; i < inputs.length; i++) {
					const at = `${factory({}).kind}: ${name}, ${i}`;
					transforms = 0;
					for (const key of Object.keys(runs)) delete runs[key];
					assert(s.parse(O, inputs[i]).ok, at);
					assert.deepEqual([runs, transforms], expected[i], at);
				}
			}
		}
	});

	describe('lazy', () => {
		// what a lazy defers to, with whether its key may be missing
		const targets: Array<[name: string, make: () => s.AnySchema, missing: boolean]> = [
			['unknown', () => s.unknown, false],
			['nullable unknown', () => s.nullable(s.unknown), false],
			['string', () => s.string, false],
			['optional', () => s.optional(s.unknown), true],
			['with_default', () => s.with_default(s.unknown, undefined), true]
		];

		// a schema around a lazy, which does the same made before the lazy is
		// first used or after
		const around: Array<[name: string, wrap: (schema: s.AnySchema) => s.AnySchema]> = [
			['itself', (schema) => schema],
			['nullable', (schema) => s.nullable(schema)],
			['message', (schema) => s.message(schema, 'm')],
			['pipe', (schema) => s.pipe(schema, passes)],
			['lazy', (schema) => s.lazy(() => schema)],
			['meta', (schema) => meta(schema, { description: 'd' })],
			['brand', (schema) => s.brand(schema, 'B')]
		];

		const assert_entry = (
			O: s.AnySchema,
			missing: boolean,
			accepts_undefined: boolean,
			at: string
		): void => {
			// the first parse and every later one
			for (let i = 0; i < 3; i++) {
				assert.strictEqual(s.is(O, {}), missing, at);
				assert.strictEqual(s.parse(O, {}).ok, missing, at);
				assert.strictEqual(s.is(O, { a: undefined }), accepts_undefined, at);
				assert.strictEqual(s.parse(O, { a: undefined }).ok, accepts_undefined, at);
				assert(s.is(O, { a: 'x' }), at);
				const input = { a: 'x' };
				assert.strictEqual(s.parse_or_throw(O, input), input, at);
			}
		};

		test('needs the key its schema needs, on its first parse and on every later one', () => {
			for (const factory of factories) {
				for (const [target, make, missing] of targets) {
					for (const [name, wrap] of around) {
						const at = `${factory({}).kind}: ${name} around a lazy ${target}`;
						const accepts_undefined = target !== 'string';
						// around a lazy not yet used, whose first use is a missing key
						assert_entry(factory({ a: wrap(s.lazy(make)) }), missing, accepts_undefined, at);
						// around one first used on a value, outside an object
						const warm = s.lazy(make);
						const made = wrap(warm);
						assert(s.is(warm, 'x'), at);
						assert_entry(factory({ a: made }), missing, accepts_undefined, at);
						// and made around one already used
						const used = s.lazy(make);
						assert(s.is(used, 'x'), at);
						assert_entry(factory({ a: wrap(used) }), missing, accepts_undefined, at);
					}
				}
			}
		});

		test('a union made around one before or after its first use does the same', () => {
			for (const factory of factories) {
				for (const [target, make, missing] of targets) {
					const at = `${factory({}).kind}: ${target}`;
					const accepts_undefined = target !== 'string';
					const fresh = s.lazy(make);
					const before = s.union([s.number, fresh]);
					assert_entry(
						factory({ a: s.union([s.number, s.string, fresh]) }),
						missing,
						accepts_undefined,
						at
					);
					assert_entry(factory({ a: before }), missing, accepts_undefined, at);
					// and made after
					assert_entry(
						factory({ a: s.union([s.number, s.string, fresh]) }),
						missing,
						accepts_undefined,
						at
					);
					// a lazy that is itself the entry, first used under a union
					assert_entry(factory({ a: fresh }), missing, accepts_undefined, at);
				}
			}
		});

		test('reports the issue of its schema, at the key', () => {
			for (const factory of factories) {
				const O = factory({
					a: s.lazy(() => s.unknown),
					b: s.lazy(() => s.string),
					c: s.nullable(s.lazy(() => s.unknown)),
					d: s.lazy(() => s.optional(s.string))
				});
				const expected = [
					MISSING_KEY,
					{
						kind: 'string',
						expected: 'string',
						received: 'undefined',
						path: ['b'],
						message: undefined
					},
					{ ...MISSING_KEY, path: ['c'] }
				];
				assert.deepEqual(issues_of(O, {}), expected);
				assert.deepEqual(issues_of(O, {}), expected);
				const input: Record<string, unknown> = { a: undefined, b: '', c: null };
				assert.strictEqual(s.parse_or_throw(O, input), input);
			}
		});

		test('is not written to: its run is the same function before and after use', () => {
			const target = s.object({ a: s.string });
			const L = s.lazy(() => target);
			const first = L.run;
			assert.strictEqual(first.length, 2);
			assert(s.is(L, { a: '' }));
			assert(!s.parse(L, 1).ok);
			assert.strictEqual(L.run, first);
			assert.notStrictEqual(L.run, target.run);
			assert.deepEqual(Object.keys(L), ['kind', 'def', 'run']);
			assert.strictEqual(L.kind, 'lazy');
			assert(s.is_schema(L));
			// one whose first use is a failure
			const F = s.lazy(() => target);
			const failing = F.run;
			assert(!s.parse(F, 1).ok);
			assert.strictEqual(F.run, failing);
		});

		test('a frozen lazy parses, used first when frozen or before', () => {
			for (const factory of factories) {
				const fresh = Object.freeze(s.lazy(() => s.unknown));
				const used = s.lazy(() => s.unknown);
				assert(s.is(used, 1));
				Object.freeze(used);
				for (const L of [fresh, used]) {
					const O = Object.freeze(factory({ a: L, b: Object.freeze(s.nullable(L)) }));
					for (let i = 0; i < 2; i++) {
						assert(s.is(L, 1));
						assert.deepEqual(issues_of(O, {}), [MISSING_KEY, { ...MISSING_KEY, path: ['b'] }]);
						const input = { a: undefined, b: null };
						assert.strictEqual(s.parse_or_throw(O, input), input);
					}
				}
			}
		});

		test('is handed to as a lazy by its kind, and a run of two parameters is not', () => {
			const seen: Array<Array<unknown>> = [];
			const spy = (kind: string): s.Schema => ({
				kind,
				def: undefined,
				run: (...args) => {
					seen.push(args);
					return args[0];
				}
			});
			// each with whether it passes on that what it holds is the entry itself
			const wraps: Array<[wrap: (schema: s.AnySchema) => s.AnySchema, entry: boolean]> = [
				[(schema) => s.nullable(schema), false],
				[(schema) => s.message(schema, 'm'), true],
				[(schema) => s.union([s.string, schema]), false],
				[(schema) => s.pipe(schema, passes), false],
				[(schema) => s.lazy(() => schema), false]
			];
			const input = { a: 1 };
			for (const factory of factories) {
				for (const [wrap, entry] of wraps) {
					// a consumer's schema whose `run` declares neither is handed neither,
					// but under a `lazy`, which passes on what it is given
					seen.length = 0;
					const Own = wrap(spy('own'));
					s.parse(factory({ a: Own }), input);
					assert.strictEqual(seen.length, 1, Own.kind);
					assert.strictEqual(seen[0]!.length, Own.kind === 'lazy' ? 4 : 2, Own.kind);
					// one that calls itself a lazy is handed both by them all
					seen.length = 0;
					const Named = wrap(spy('lazy'));
					s.parse(factory({ a: Named }), input);
					assert.strictEqual(seen.length, 1, Named.kind);
					assert.deepEqual(seen[0]!.slice(2), entry ? [input, 'a', 1] : [input, 'a'], Named.kind);
					// and outside an object a lazy gives its schema the two it was given
					seen.length = 0;
					s.parse(
						s.lazy(() => spy('own')),
						1
					);
					s.parse(s.array(s.lazy(() => spy('own'))), [1]);
					assert.deepEqual(
						seen.map((args) => args.length),
						[2, 2]
					);
				}
			}
		});

		test('calls get once, whatever holds it', () => {
			let calls = 0;
			const make = (): s.AnySchema =>
				s.lazy(() => {
					calls++;
					return s.unknown;
				});
			// used directly
			const direct = make();
			for (let i = 0; i < 3; i++) s.is(direct, 1);
			s.parse(s.object({ a: direct }), {});
			assert.strictEqual(calls, 1);
			// held by schemas made before its first use, each calling it in turn
			calls = 0;
			const held = make();
			const holders = [
				s.nullable(held),
				s.message(held, 'm'),
				s.pipe(held, passes),
				s.union([s.string, held]),
				s.optional(held),
				s.array(held),
				s.lazy(() => held),
				s.object({ a: held })
			];
			assert.strictEqual(calls, 0);
			for (let i = 0; i < 2; i++) {
				for (const holder of holders) {
					s.is(holder, [1]);
					s.parse(holder, { a: 1 });
				}
			}
			assert.strictEqual(calls, 1);
			// a `meta` copy has the lazy's `run`, whenever it is taken, and shares
			// what the lazy got
			calls = 0;
			const original = make();
			const copy = meta(original, { description: 'd' });
			const O = s.object({ a: copy });
			for (let i = 0; i < 3; i++) {
				assert(!s.is(O, {}));
				assert(s.is(O, { a: undefined }));
				assert(s.is(copy, 1));
			}
			assert(s.is(original, 1));
			const later = meta(original, {});
			assert(!s.is(s.object({ a: later }), {}));
			assert(s.is(s.object({ a: later }), { a: undefined }));
			assert.strictEqual(calls, 1);
			assert.strictEqual(copy.run, original.run);
			assert.strictEqual(later.run, original.run);
			assert.deepEqual(get_meta(copy), { description: 'd' });
			// and the function itself, kept by a caller
			const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
			assert.strictEqual(original.run(1, ctx), 1);
			assert.strictEqual(calls, 1);
		});

		test('calls a get that threw again on the next use', () => {
			let calls = 0;
			const L = s.lazy(() => {
				if (calls++ === 0) throw new Error('not yet');
				return s.unknown;
			});
			const O = s.object({ a: s.nullable(L) });
			assert.throws(() => s.is(O, {}), 'not yet');
			assert(!s.is(O, {}));
			assert(s.is(O, { a: undefined }));
			assert.strictEqual(calls, 2);
		});

		test('a lazy of a lazy, and schemas that come back to each other', () => {
			const inner = s.lazy(() => s.unknown);
			const outer = s.lazy(() => inner);
			const O = s.object({ a: outer });
			for (let i = 0; i < 3; i++) {
				assert(!s.is(O, {}));
				assert(s.is(O, { a: undefined }));
				assert.deepEqual(issues_of(O, {}), [MISSING_KEY]);
			}
			interface A {
				value: unknown;
				b?: B;
			}
			interface B {
				value?: unknown;
				a: A | null;
			}
			const A: s.Schema<A> = s.object({ value: s.unknown, b: s.optional(s.lazy(() => B)) });
			const B: s.Schema<B> = s.object({
				value: s.optional(s.unknown),
				a: s.nullable(s.lazy(() => A))
			});
			const input = { value: 1, b: { a: { value: undefined, b: { a: null } } } };
			for (let i = 0; i < 2; i++) {
				assert.strictEqual(s.parse_or_throw(A, input), input);
				assert(s.is(A, input));
				assert.deepEqual(
					issues_of(A, { b: { a: { b: {} } } }).map((issue) => [issue.kind, issue.path]),
					[
						['missing_key', ['value']],
						['missing_key', ['b', 'a', 'value']],
						['object', ['b', 'a', 'b', 'a']]
					]
				);
				assert(!s.is(A, { b: { a: { b: {} } } }));
			}
			// a tree, whose lazy is first used inside its own schema's run
			interface Tree {
				value: unknown;
				children: Array<Tree>;
			}
			const Tree: s.Schema<Tree> = s.object({
				value: s.unknown,
				children: s.array(s.lazy(() => Tree))
			});
			const tree = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] };
			assert.strictEqual(s.parse_or_throw(Tree, tree), tree);
			assert.deepEqual(
				issues_of(Tree, { value: 1, children: [{ children: [{ children: [] }] }] }),
				[
					{ ...MISSING_KEY, path: ['children', 0, 'value'] },
					{ ...MISSING_KEY, path: ['children', 0, 'children', 0, 'value'] }
				]
			);
		});
	});

	test('the input is not changed, and a failed parse has no output to copy', () => {
		for (const factory of factories) {
			const O = factory({ a: s.with_default(s.string, 'd'), b: s.unknown });
			const input = Object.freeze({});
			assert(!s.parse(O, input).ok);
			assert.deepEqual(Object.keys(input), []);
		}
	});
});
