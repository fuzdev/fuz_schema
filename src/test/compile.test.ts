import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';
import { SCENARIOS } from '../benchmarks/scenarios.ts';
import * as scenario_schemas from '../benchmarks/libs/schemas/fuz_schema.ts';
import {
	COMPILE_HAND_INPUTS,
	COMPILE_HAND_SCHEMAS,
	find_compile_differences
} from './compile_test_helpers.ts';

// `compile_guard` and `compile_parse` against `is` and `parse`, which are the
// oracle: over a hand table of what the differential's generator doesn't draw,
// and case by case for what a table doesn't show. What a compile reads and
// emits is in `compile.source.test.ts`, and recursive unions and the state of
// a call in `compile.union.test.ts`.

describe('compiled code gives the interpreter its answers', () => {
	test('over the hand table: verdict, result, identity, key order, and what a copy shares', () => {
		const found: Array<string> = [];
		for (const [name, schema] of Object.entries(COMPILE_HAND_SCHEMAS)) {
			for (const difference of find_compile_differences(schema, COMPILE_HAND_INPUTS)) {
				found.push(`${name}, ${difference}`);
			}
		}
		assert.deepEqual(found, []);
	});

	test('over every scenario of the benchmarks, valid and invalid', () => {
		for (const scenario of SCENARIOS) {
			const built: any = scenario_schemas[`schema_${scenario.name}`]();
			const pairs: Array<[s.AnySchema, unknown, unknown]> = scenario.many_schemas
				? Object.keys(built).map((key) => [
						built[key],
						(scenario.valid as any)[key],
						(scenario.invalid as any)[key]
					])
				: [[built, scenario.valid, scenario.invalid]];
			for (const [schema, valid, invalid] of pairs) {
				assert.deepEqual(
					find_compile_differences(schema, [
						() => structuredClone(valid),
						() => structuredClone(invalid)
					]),
					[],
					scenario.name
				);
			}
		}
	});

	test('a with_default fills in its one value, a with_default_fn a new one, and the input is not written to', () => {
		const shared = [1];
		const schema = s.object({
			a: s.with_default(s.array(s.number), shared),
			b: s.array(s.strip_object({ c: s.with_default_fn(s.array(s.number), () => []) }))
		});
		const parse = compile_parse(schema);
		const input = Object.freeze({ b: Object.freeze([Object.freeze({ x: 1 }), Object.freeze({})]) });
		const one = parse(input);
		const two = parse(input);
		assert(one.ok && two.ok);
		assert.strictEqual(one.value.a, shared);
		assert.strictEqual(two.value.a, shared);
		assert.notStrictEqual(one.value.b[0]!.c, two.value.b[0]!.c);
		assert.notStrictEqual(one.value.b[0]!.c, one.value.b[1]!.c);
		assert.deepEqual(one.value, s.parse_or_throw(schema, input));
	});

	test('an input that fails gets the issues of parse', () => {
		const schema = s.object({ a: s.array(s.object({ b: s.number })), c: s.string });
		const input = { a: [{ b: 1 }, { b: 'x', z: 1 }], c: 2, d: 3 };
		const result = compile_parse(schema)(input);
		assert(!result.ok);
		assert.deepEqual(result, s.parse(schema, input));
		assert.deepEqual(
			result.issues.map((issue) => issue.path),
			[['a', 1, 'b'], ['a', 1, 'z'], ['c'], ['d']]
		);
	});

	test('the types are of the schema: a guard of its input, a parse of its output', () => {
		const User = s.object({ name: s.string, age: s.with_default(s.number, 0) });
		expectTypeOf(compile_guard(User)).toEqualTypeOf<
			(value: unknown) => value is { name: string; age?: number | undefined }
		>();
		expectTypeOf(compile_parse(User)).toEqualTypeOf<
			(value: unknown) => s.SchemaResult<{ name: string; age: number }>
		>();
		const value: unknown = { name: 'Ada' };
		if (compile_guard(User)(value)) expectTypeOf(value.name).toEqualTypeOf<string>();
	});
});
describe('a user’s function runs as often as the docs say', () => {
	test('once in a guard and in a parse that matches, and again in the parse of an input that fails', () => {
		let checks = 0;
		let transforms = 0;
		const schema = s.strip_object({
			a: s.pipe(
				s.string,
				s.check(() => (checks++, true)),
				s.transform((v: string) => (transforms++, v.trim()))
			),
			b: s.with_default(s.number, 1)
		});
		const count = (run: () => unknown): [number, number] => {
			checks = transforms = 0;
			run();
			return [checks, transforms];
		};
		const guard = compile_guard(schema);
		const parse = compile_parse(schema);
		for (const input of [{ a: 'x' }, { a: ' x ', z: 1 }]) {
			assert.deepEqual(
				count(() => guard(input)),
				[1, 1]
			);
			assert.deepEqual(
				count(() => parse(input)),
				[1, 1]
			);
			assert.deepEqual(
				count(() => s.parse(schema, input)),
				[1, 1]
			);
		}
		// the compiled code ran them, and then `parse` did
		assert.deepEqual(
			count(() => parse({ a: 'x', b: 'no' })),
			[2, 2]
		);
		assert.deepEqual(
			count(() => guard({ a: 'x', b: 'no' })),
			[1, 1]
		);
	});
});

describe('what the hand table does not draw', () => {
	// every check here is a function of its own, as a consumer's are, so a
	// schema holds as many captured values as it has checks, and a name the
	// emitter makes must be no captured value's
	test('a strip_object of many entries, each with checks of its own, alone and before a default', () => {
		const found: Array<string> = [];
		for (let entries = 1; entries <= 8; entries++) {
			for (let checks = 1; checks <= 3; checks++) {
				const def: Record<string, s.AnySchema> = {};
				for (let i = 0; i < entries; i++) {
					let entry: s.AnySchema = s.string;
					for (let j = 0; j < checks; j++)
						entry = s.pipe(
							entry,
							s.check(() => true)
						);
					def['k' + i] = entry;
				}
				const inner = (): Record<string, unknown> =>
					Object.fromEntries(Object.keys(def).map((key) => [key, 'x']));
				const cases: Array<[string, s.AnySchema, Array<() => unknown>]> = [
					['alone', s.strip_object(def), [inner, () => ({ ...inner(), extra: 1 })]],
					[
						'before a default',
						s.object({
							inner: s.strip_object(def),
							tags: s.with_default(s.array(s.string), ['d'])
						}),
						[() => ({ inner: inner() }), () => ({ inner: { ...inner(), extra: 1 }, tags: [] })]
					],
					[
						'in a pipe',
						s.pipe(
							s.strip_object(def),
							s.check(() => true)
						),
						[inner]
					]
				];
				for (const [name, schema, inputs] of cases) {
					for (const difference of find_compile_differences(schema, inputs)) {
						found.push(`${entries} entries of ${checks} checks, ${name}, ${difference}`);
					}
				}
			}
		}
		assert.deepEqual(found, []);
	});

	test('an entry named __proto__ compiles, in each object schema', () => {
		const entries = (rest: Record<string, s.AnySchema>): Record<string, s.AnySchema> => ({
			['__proto__']: s.string,
			...rest
		});
		const cases: Array<[s.AnySchema, Array<() => unknown>]> = [
			[
				s.object(entries({ a: s.with_default(s.string, 'd') })),
				[
					() => JSON.parse('{"__proto__":"x"}'),
					() => JSON.parse('{"__proto__":"x","a":"y"}'),
					() => ({})
				]
			],
			[
				s.strip_object(entries({ a: s.string })),
				[
					() => JSON.parse('{"__proto__":"x","a":"y","z":1}'),
					() => JSON.parse('{"__proto__":"x","a":"y"}')
				]
			],
			[
				s.loose_object({ ['__proto__']: s.loose_object({}), a: s.with_default(s.string, 'd') }),
				[() => JSON.parse('{"__proto__":{"p":1},"z":2}'), () => ({ z: 2 })]
			],
			[
				s.object_with_rest(entries({}), s.with_default(s.number, 1)),
				[() => JSON.parse('{"__proto__":"x","z":2}'), () => ({ z: undefined })]
			],
			[
				s.variant('__proto__', [
					s.loose_object({ ['__proto__']: s.literal('x'), a: s.with_default(s.number, 1) })
				]),
				[() => JSON.parse('{"__proto__":"x"}'), () => ({})]
			]
		];
		for (const [schema, inputs] of cases) {
			assert.deepEqual(find_compile_differences(schema, inputs), [], schema.kind);
		}
	});

	test('a one_of of more values than are tested one by one, with undefined and NaN among them', () => {
		for (const size of [11, 12, 13, 14, 30]) {
			const values: Array<s.SchemaLiteral> = [
				...Array.from({ length: size - 2 }, (_, i) => 'v' + i),
				NaN,
				undefined
			];
			const inputs = [
				() => ({}),
				() => ({ a: undefined }),
				() => ({ a: NaN }),
				() => ({ a: 'v0' }),
				() => ({ a: 'v' + (size - 3) }),
				() => ({ a: 'z' }),
				() => ({ a: null })
			];
			for (const schema of [
				s.object({ a: s.one_of(values) }),
				s.loose_object({ a: s.nullable(s.one_of(values)) }),
				s.object({ a: s.one_of(values.slice(0, -1)) }),
				s.strip_object({ a: s.with_default(s.one_of(values.slice(0, -2)), 'v1') })
			]) {
				assert.deepEqual(find_compile_differences(schema, inputs), [], `${size} values`);
			}
			assert.deepEqual(
				find_compile_differences(s.one_of(values), [() => undefined, () => NaN, () => 'm']),
				[]
			);
		}
	});

	test('a default and a literal of -0', () => {
		const result = compile_parse(s.object({ a: s.with_default(s.number, -0) }))({});
		assert(result.ok);
		assert.isTrue(Object.is(result.value.a, -0));
		assert.deepEqual(
			find_compile_differences(s.array(s.with_default(s.number, -0)), [() => [undefined, 0, -0]]),
			[]
		);
	});

	test('a guard calls the make of a with_default_fn, as is does', () => {
		let made = 0;
		const schema = s.object({ a: s.with_default_fn(s.number, () => (made++, 1)), b: s.string });
		s.is(schema, { b: 'b' });
		const by_is = made;
		made = 0;
		compile_guard(schema)({ b: 'b' });
		assert.strictEqual(made, by_is);
		assert.strictEqual(made, 1);
	});

	test('an array’s length is read once, so an item added while it is walked is not', () => {
		let target: Array<unknown> = [];
		const grows = s.array(
			s.pipe(
				s.number,
				s.check(() => {
					if (target.length < 4) target.push('no number');
					return true;
				})
			)
		);
		const make = (): unknown => (target = [1, 2]);
		assert.isTrue(s.is(grows, make()));
		assert.isTrue(compile_guard(grows)(make()));
		assert.isTrue(compile_parse(grows)(make()).ok);
		// and a copy is of the length read
		let copied: Array<unknown> = [];
		const copies = s.array(
			s.pipe(
				s.number,
				s.transform((v: number) => {
					if (copied.length < 4) copied.push(9);
					return v + 1;
				})
			)
		);
		const expected = s.parse(copies, (copied = [1, 2]));
		assert.deepEqual(compile_parse(copies)((copied = [1, 2])), expected);
		assert.deepEqual(expected, { ok: true, value: [2, 3] });
	});
});

// Each is declared in `docs/design.md`, under what may differ from the
// interpreter, and pinned here so a change of one is seen.
describe('what is declared to differ from the interpreter', () => {
	test('a getter that gives another value at its second read: a compiled parse that fails asks parse', () => {
		const schema = s.object({ a: s.string });
		const make = (): unknown => {
			let reads = 0;
			return Object.defineProperty({}, 'a', { enumerable: true, get: () => (reads++ ? 'x' : 1) });
		};
		assert.isFalse(s.parse(schema, make()).ok);
		// the compiled code read `1` and failed, and `parse`, called for the issues, read `'x'`
		assert.deepEqual(compile_parse(schema)(make()), { ok: true, value: { a: 'x' } } as any);
		assert.isFalse(compile_guard(schema)(make()));
	});

	test('a Proxy that says a key is missing and gives a value for it: the key stays out of a compiled copy', () => {
		const schema = s.strip_object({
			a: s.pipe(
				s.optional(s.string),
				s.transform((v) => v)
			)
		});
		const make = (): unknown =>
			new Proxy({}, { has: () => false, get: (_, key) => (key === 'a' ? 'given' : undefined) });
		const expected: any = s.parse(schema, make());
		assert.isTrue(expected.ok);
		assert.isTrue(Object.hasOwn(expected.value, 'a'));
		assert.isUndefined(expected.value.a);
		const actual: any = compile_parse(schema)(make());
		assert.isTrue(actual.ok);
		assert.isFalse(Object.hasOwn(actual.value, 'a'));
		assert.deepEqual(actual.value, {});
	});

	test('a parse that matches first reads each value of the input in the library’s order', () => {
		// the values read, each the first time, in order: what a getter sees first
		let reads: Array<string> = [];
		let ids: Map<object, number> = new Map();
		const handler: ProxyHandler<object> = {
			get: (target, key, receiver) => {
				if (typeof key === 'string' && key !== 'slice' && key !== 'constructor') {
					if (!ids.has(target)) ids.set(target, ids.size);
					const read = `${ids.get(target)}.${key}`;
					if (!reads.includes(read)) reads.push(read);
				}
				return Reflect.get(target, key, receiver);
			}
		};
		const watched = (value: unknown): unknown => {
			if (value === null || typeof value !== 'object') return value;
			if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
			const copy: any = Array.isArray(value) ? [] : {};
			for (const key of Object.keys(value)) copy[key] = watched((value as any)[key]);
			return new Proxy(copy, handler);
		};
		const reads_of = (run: (value: unknown) => { ok: boolean }, value: unknown) => {
			reads = [];
			ids = new Map();
			const { ok } = run(watched(value));
			return { ok, reads };
		};
		let matched = 0;
		for (const [name, schema] of Object.entries(COMPILE_HAND_SCHEMAS)) {
			const compiled = compile_parse(schema);
			for (const [i, make] of COMPILE_HAND_INPUTS.entries()) {
				let expected;
				try {
					expected = reads_of((value) => s.parse(schema, value), make());
				} catch {
					continue;
				}
				if (!expected.ok) continue;
				matched++;
				assert.deepEqual(reads_of(compiled, make()), expected, `${name}, input ${i}`);
			}
		}
		assert.isAbove(matched, COMPILE_HAND_INPUTS.length);
	});

	test('a schema with a library kind’s name and a run of its own is compiled by its kind and def', () => {
		const string_by_name = { kind: 'string', def: undefined, run: s.number.run } as s.AnySchema;
		assert.isFalse(s.is(string_by_name, 'a'));
		assert.isTrue(compile_guard(string_by_name)('a'));
		// but a format test and `to_integer` are reached by the schema’s `run`
		const uuid_of_any = s.pipe(s.string, {
			kind: 'uuid',
			def: undefined,
			run: (v: unknown) => v
		});
		assert.isTrue(s.is(uuid_of_any, 'no uuid'));
		assert.isTrue(compile_guard(uuid_of_any)('no uuid'));
	});
});
