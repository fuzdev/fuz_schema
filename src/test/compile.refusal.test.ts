import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';
import { COMPILE_UNBOUNDED_REFUSAL } from './compile_test_helpers.ts';

// Every condition of the refusal, a shape for each: the kinds a cycle is seen
// through, what could take an array and what an object, and what tells
// options apart. A shape that is refused is shown to need it wherever an
// input can nest through it, by the runs of a check under the interpreter,
// counted and never timed. A shape that compiles is held to a walk.

const DEPTH = 12;
const CAP = 200_000;

let runs = 0;
const counted = (result: boolean): s.AnySchema =>
	s.check(() => {
		if (++runs > CAP) throw new Error('cap');
		return result;
	});
const PASS = counted(true);
const FAIL = counted(false);
const c = PASS;

const count = (run: () => unknown): number => {
	runs = 0;
	run();
	return runs;
};
const chain = (depth: number, node: (child: unknown) => unknown, leaf: unknown): unknown => {
	let value = leaf;
	for (let i = 0; i < depth; i++) value = node(value);
	return value;
};
const lazy_of = (make: (N: s.AnySchema) => s.AnySchema): s.AnySchema => {
	const N: s.AnySchema = s.lazy(() => made);
	const made = make(N);
	return N;
};
const assert_refused = (schema: s.AnySchema, name: string): void => {
	assert.throws(() => compile_guard(schema), COMPILE_UNBOUNDED_REFUSAL, name);
	assert.throws(() => compile_parse(schema), COMPILE_UNBOUNDED_REFUSAL, name);
};
// the interpreter walks it twice a level: past what a walk of every node takes, many times over
const assert_exponential = (schema: s.AnySchema, input: unknown, name: string): void => {
	assert.isAbove(
		count(() => s.is(schema, input)),
		2 ** DEPTH,
		name
	);
};
// compiled, and a walk: a bounded count of runs a level, in a guard and in a parse
const assert_walk = (schema: s.AnySchema, input: unknown, name: string): void => {
	const guard = compile_guard(schema);
	const parse = compile_parse(schema);
	assert.strictEqual(guard(input), s.is(schema, input), name);
	assert.deepEqual(parse(input), s.parse(schema, input), name);
	for (const run of [guard, parse, (v: unknown) => s.is(schema, v)]) {
		assert.isAtMost(
			count(() => run(input)),
			6 * (DEPTH + 2),
			name
		);
	}
};

describe('the refusal: a cycle is seen through every kind that holds a schema', () => {
	// what an entry reads the cycle through, and the value of that entry around a child
	const SLOTS: Record<string, [(N: s.AnySchema) => s.AnySchema, (child: unknown) => unknown]> = {
		optional: [(N) => N, (child) => child],
		nullable: [(N) => s.nullable(N), (child) => child],
		with_default: [(N) => s.with_default(N, undefined), (child) => child],
		with_default_fn: [(N) => s.with_default_fn(N, () => undefined as any), (child) => child],
		lazy: [(N) => s.lazy(() => N), (child) => child],
		object: [(N) => s.object({ n: N }), (child) => ({ n: child })],
		loose_object: [(N) => s.loose_object({ n: N }), (child) => ({ n: child })],
		strip_object: [(N) => s.strip_object({ n: N }), (child) => ({ n: child })],
		'object_with_rest, an entry': [
			(N) => s.object_with_rest({ n: N }, s.number),
			(child) => ({ n: child })
		],
		'object_with_rest, the rest': [(N) => s.object_with_rest({}, N), (child) => ({ k: child })],
		record: [(N) => s.record(N), (child) => ({ k: child })],
		array: [(N) => s.array(N), (child) => [child]],
		'keyed_record, the value': [(N) => s.keyed_record(s.string, N), (child) => ({ k: child })],
		union: [(N) => s.union([N, s.string]), (child) => child],
		pipe: [
			(N) =>
				s.pipe(
					N,
					s.check(() => true)
				),
			(child) => child
		],
		variant: [
			(N) => s.variant('k', [s.object({ k: s.literal('v'), n: N })]),
			(child) => ({ k: 'v', n: child })
		]
	};

	for (const [name, [slot, value]] of Object.entries(SLOTS)) {
		test(`through ${name}`, () => {
			// two options that read the entry, the first failing after it
			const N = lazy_of((self) =>
				s.union([
					s.object({ c, x: s.optional(slot(self)), u: s.string }),
					s.object({ c, x: s.optional(slot(self)) })
				])
			);
			assert_refused(N, name);
			assert_exponential(
				N,
				chain(DEPTH, (child) => ({ x: value(child) }), {}),
				name
			);
		});
	}

	test('a union on one cycle is refused whatever other cycle the schema holds, before it or after', () => {
		// a second lazy that loops, with no union on its cycle
		const other = lazy_of((self) => s.loose_object({ y: s.array(self) }));
		const N = lazy_of((self) =>
			s.union([
				s.pipe(s.loose_object({ x: s.array(self) }), FAIL),
				s.pipe(s.loose_object({ x: s.array(self) }), PASS)
			])
		);
		assert_refused(s.object({ a: N, b: other }), 'the other cycle after');
		assert_refused(s.object({ a: other, b: N }), 'the other cycle before');
		assert_exponential(
			N,
			chain(DEPTH, (child) => ({ x: [child] }), { x: [] }),
			'the union'
		);
	});

	test('through a keyed_record’s key, which no input nests through: refused as any schema that reaches a cycle is', () => {
		const N = lazy_of((self) =>
			s.union([
				s.object({ x: s.keyed_record(self as any, s.number), u: s.string }),
				s.object({ x: s.keyed_record(self as any, s.number) })
			])
		);
		assert_refused(N, 'the key');
	});

	test('and a pipe’s steps through each of them', () => {
		for (const [name, [slot]] of Object.entries(SLOTS)) {
			const N = lazy_of((self) =>
				s.pipe(
					s.loose_object({ x: s.optional(slot(self)) }),
					s.loose_object({ x: s.optional(slot(self)) })
				)
			);
			assert_refused(N, name);
		}
	});
});

describe('the refusal: what could take an array, and what an object', () => {
	// each kind that takes an object, holding the cycle, and a value of it around a child
	const OBJECT_KINDS: Record<
		string,
		[(N: s.AnySchema) => s.AnySchema, (child?: unknown) => unknown]
	> = {
		object: [(N) => s.object({ x: s.array(N) }), (child) => ({ x: child ? [child] : [] })],
		loose_object: [
			(N) => s.loose_object({ x: s.array(N) }),
			(child) => ({ x: child ? [child] : [] })
		],
		strip_object: [
			(N) => s.strip_object({ x: s.array(N) }),
			(child) => ({ x: child ? [child] : [] })
		],
		object_with_rest: [(N) => s.object_with_rest({}, N), (child) => (child ? { k: child } : {})],
		record: [(N) => s.record(N), (child) => (child ? { k: child } : {})],
		keyed_record: [(N) => s.keyed_record(s.string, N), (child) => (child ? { k: child } : {})],
		variant: [
			(N) => s.variant('k', [s.object({ k: s.literal('v'), x: s.array(N) })]),
			(child) => ({ k: 'v', x: child ? [child] : [] })
		]
	};
	const an_object = OBJECT_KINDS.loose_object![0];
	const object_node = OBJECT_KINDS.loose_object![1];

	for (const [name, [make, node]] of Object.entries(OBJECT_KINDS)) {
		test(`two options of ${name} are refused, and one beside an array option is not`, () => {
			const two = lazy_of((N) =>
				s.union([s.pipe(make(N) as any, FAIL), s.pipe(make(N) as any, PASS)])
			);
			assert_refused(two, name);
			assert_exponential(two, chain(DEPTH, node, node()), name);
			// it takes no array: the option beside it that does is the only one for an array
			const beside = lazy_of((N) =>
				s.union([s.pipe(s.array(N), PASS), s.pipe(make(N) as any, PASS)])
			);
			assert_walk(beside, chain(DEPTH, node, node()), name);
		});
	}

	test('two array options are refused', () => {
		const two = lazy_of((N) => s.union([s.pipe(s.array(N), FAIL), s.pipe(s.array(N), PASS)]));
		assert_refused(two, 'array');
		assert_exponential(
			two,
			chain(DEPTH, (child) => [child], []),
			'array'
		);
	});

	// a kind that matches no array and no object, as the first step of an option that walks on
	const SCALARS: Record<string, s.AnySchema> = {
		string: s.string,
		number: s.number,
		boolean: s.boolean,
		bigint: s.bigint,
		literal: s.literal('a'),
		one_of: s.one_of(['a', 1]),
		integer: s.integer,
		safe_integer: s.safe_integer,
		uuid: s.uuid,
		iso_datetime: s.iso_datetime,
		to_integer: s.to_integer(),
		to_lower_case: s.to_lower_case
	};
	for (const [name, scalar] of Object.entries(SCALARS)) {
		test(`an option that starts with ${name} takes no array and no object`, () => {
			const N = lazy_of((self) =>
				s.union([
					s.pipe(s.array(self), PASS),
					s.pipe(an_object(self) as any, PASS),
					s.pipe(scalar as any, self as any)
				])
			);
			assert.doesNotThrow(() => compile_guard(N), name);
			assert.doesNotThrow(() => compile_parse(N), name);
			assert.isTrue(compile_guard(N)(chain(DEPTH, object_node, object_node())));
		});
	}

	// a kind that reads a value as it likes, as the first step of two options that walk on
	const own: s.AnySchema = { kind: 'own', def: undefined, run: (value: unknown) => value };
	const EITHER: Record<string, [s.AnySchema, boolean]> = {
		unknown: [s.unknown, true],
		check: [s.check(() => true), true],
		transform: [s.transform((value: unknown) => value), true],
		'a kind of one’s own': [own, true],
		regex: [s.regex(/o/), true],
		// these take no plain object of the test's, and are read as able to all the same
		min_length: [s.min_length(0), false],
		max_length: [s.max_length(9), false],
		min_value: [s.min_value(0), false],
		max_value: [s.max_value(9), false]
	};
	for (const [name, [first, passes]] of Object.entries(EITHER)) {
		test(`two options that start with ${name} could take the same object`, () => {
			const N = lazy_of((self) =>
				s.union([
					s.pipe(first as any, an_object(self) as any, FAIL),
					s.pipe(first as any, an_object(self) as any, PASS)
				])
			);
			assert_refused(N, name);
			if (passes) assert_exponential(N, chain(DEPTH, object_node, object_node()), name);
		});
	}

	// an input does nest through a length or a bound as a first step: an array has a
	// length, and an array of one array, or of none, compares as a number does
	const NESTS: Record<string, s.AnySchema> = {
		min_length: s.min_length(0),
		max_length: s.max_length(1),
		min_value: s.min_value(0),
		max_value: s.max_value(0)
	};
	for (const [name, first] of Object.entries(NESTS)) {
		test(`two options that start with ${name} and walk an array are refused, and need it`, () => {
			const N = lazy_of((self) =>
				s.union([
					s.pipe(first as any, s.array(self) as any, FAIL),
					s.pipe(first as any, s.array(self) as any, PASS)
				])
			);
			assert_refused(N, name);
			assert_exponential(
				N,
				chain(DEPTH, (child) => [child], []),
				name
			);
		});
	}

	// what an option is looked through to: it could take what the schema under it could
	const THROUGH: Record<string, (schema: s.AnySchema) => s.AnySchema> = {
		optional: (schema) => s.optional(schema),
		nullable: (schema) => s.nullable(schema),
		with_default: (schema) => s.with_default(schema, undefined),
		with_default_fn: (schema) => s.with_default_fn(schema, () => undefined as any),
		lazy: (schema) => s.lazy(() => schema),
		'a union of one': (schema) => s.union([schema]),
		'a union, its second option': (schema) => s.union([s.string, schema]),
		'a pipe, by its first step': (schema) =>
			s.pipe(
				schema,
				s.check(() => true)
			)
	};
	for (const [name, through] of Object.entries(THROUGH)) {
		test(`an option under ${name} could take what it holds could`, () => {
			const two = lazy_of((N) =>
				s.union([
					through(s.pipe(an_object(N) as any, FAIL)),
					through(s.pipe(an_object(N) as any, PASS))
				])
			);
			assert_refused(two, name);
			assert_exponential(two, chain(DEPTH, object_node, object_node()), name);
			// and no more: an array under it is no object
			const beside = lazy_of((N) =>
				s.union([through(s.pipe(s.array(N), PASS)), s.pipe(an_object(N) as any, PASS)])
			);
			assert_walk(beside, chain(DEPTH, object_node, object_node()), name);
		});
	}

	test('a pipe could take what its first step could, whatever its later steps are', () => {
		// an array and then a check, which alone could take either: it takes arrays
		const N = lazy_of((self) =>
			s.union([
				s.pipe(
					s.array(self),
					s.check(() => true)
				),
				s.pipe(an_object(self) as any, PASS)
			])
		);
		// sound, as a pipe fails at its first step unless the value passes it
		assert_walk(N, chain(DEPTH, object_node, object_node()), 'the first step');
	});

	test('one option that walks on beside options that don’t is not refused', () => {
		const N = lazy_of((self) =>
			s.union([
				s.object({ c, kids: s.array(self) }),
				s.object({ c, value: s.string }),
				s.object({ c, other: s.array(s.number) })
			])
		);
		assert_walk(
			N,
			chain(DEPTH, (child) => ({ kids: [child] }), { value: 'v' }),
			'one walker'
		);
	});
});

describe('the refusal: a memo_union ends a walk', () => {
	test('an option that reaches the cycle only through a memo_union doesn’t walk on', () => {
		// the second option reads the union again only under `M`, which keeps its verdict
		const N: s.AnySchema = s.lazy(() =>
			s.union([
				s.loose_object({ c, x: s.array(N), u: s.string }),
				s.loose_object({ c, m: s.optional(M) })
			])
		);
		const M: s.AnySchema = s.memo_union([s.loose_object({ x: s.array(N) })]);
		const node = (child: unknown): unknown => ({ x: [child], m: { x: [child] } });
		const input = chain(DEPTH, node, {});
		const guard = compile_guard(N);
		const parse = compile_parse(N);
		assert.isTrue(guard(input));
		assert.deepEqual(parse(input), s.parse(N, input));
		// the size times the depth, and no more
		for (const run of [guard, parse, (v: unknown) => s.is(N, v)]) {
			assert.isAtMost(
				count(() => run(input)),
				4 * (DEPTH + 2) ** 2
			);
		}
	});

	test('a lazy whose only cycle is through a memo_union is on no cycle', () => {
		// `P` comes back to itself only under `M`
		const P: s.AnySchema = s.lazy(() => s.loose_object({ m: s.optional(M) }));
		const M: s.AnySchema = s.memo_union([P]);
		// the second option reads `P`, and walks nothing on
		const N: s.AnySchema = s.lazy(() =>
			s.union([s.loose_object({ c, x: s.array(N), u: s.string }), s.loose_object({ c, p: P })])
		);
		assert_walk(
			N,
			chain(DEPTH, (child) => ({ x: [child], p: { m: { m: {} } } }), { x: [], p: {} }),
			'through a memo_union'
		);
	});

	test('a union whose only cycle is through a memo_union is not asked, though its options walk another cycle', () => {
		const other = lazy_of((self) => s.loose_object({ c, y: s.array(self) }));
		const N = lazy_of((self) =>
			s.memo_union([
				s.union([
					s.loose_object({ x: s.array(self), k: other, u: s.string }),
					s.loose_object({ x: s.array(self), k: other })
				])
			])
		);
		assert_walk(
			N,
			chain(DEPTH, (child) => ({ x: [child], k: { y: [] } }), { x: [], k: { y: [] } }),
			'through a memo_union'
		);
	});

	test('a pipe a step of which reaches the cycle only through a memo_union is not refused', () => {
		const N: s.AnySchema = s.lazy(() =>
			s.pipe(s.loose_object({ c, x: s.array(N) }), s.loose_object({ m: s.optional(M) }) as any)
		);
		const M: s.AnySchema = s.memo_union([s.loose_object({ x: s.array(N) })]);
		const input = chain(DEPTH, (child) => ({ x: [child], m: { x: [child] } }), { x: [] });
		assert.isTrue(compile_guard(N)(input));
		assert.isAtMost(
			count(() => compile_guard(N)(input)),
			4 * (DEPTH + 2) ** 2
		);
		assert.deepEqual(compile_parse(N)(input), s.parse(N, input));
	});
});

describe('the refusal: what tells options apart', () => {
	type Entries = Record<string, s.AnySchema>;
	type Make = (first: Entries, self: s.AnySchema, i: number) => s.AnySchema;
	// two options with `first` before the entry that walks on, the first failing late
	const two_of = (
		firsts: [Entries, Entries],
		make: Make = (first, self, i) =>
			s.loose_object({ ...first, c, x: s.array(self), ...(i ? {} : { u: s.string }) })
	): s.AnySchema => lazy_of((self) => s.union(firsts.map((first, i) => make(first, self, i))));
	const node_of =
		(tag: Record<string, unknown>) =>
		(child: unknown): unknown => ({ ...tag, x: [child] });

	test('a literal first in each, with a value of its own, and the union compiles', () => {
		const cases: Record<string, [s.AnySchema, Record<string, unknown>]> = {
			'two strings': [two_of([{ t: s.literal('a') }, { t: s.literal('b') }]), { t: 'b' }],
			'undefined and a string': [
				two_of([{ t: s.literal(undefined) }, { t: s.literal('b') }]),
				{ t: 'b' }
			],
			'under a message': [
				two_of([{ t: s.message(s.literal('a'), 'an a') }, { t: s.literal('b') }]),
				{ t: 'b' }
			],
			'after an entry that reaches no cycle': [
				two_of([
					{ id: s.string, t: s.literal('a') },
					{ id: s.string, t: s.literal('b') }
				]),
				{ id: 'i', t: 'b' }
			],
			'the second of two keys, the first alike in both': [
				two_of([
					{ kind: s.literal('node'), t: s.literal('a') },
					{ kind: s.literal('node'), t: s.literal('b') }
				]),
				{ kind: 'node', t: 'b' }
			],
			'the first of two keys': [
				two_of([
					{ t: s.literal('a'), kind: s.literal('node') },
					{ t: s.literal('b'), kind: s.literal('node') }
				]),
				{ kind: 'node', t: 'b' }
			]
		};
		for (const flavor of [s.object, s.loose_object, s.strip_object]) {
			cases[
				`each a ${flavor === s.object ? 'object' : flavor === s.loose_object ? 'loose_object' : 'strip_object'}`
			] = [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self, i) =>
					flavor({ ...first, c, x: s.array(self), ...(i ? {} : { u: s.optional(s.string) }) })
				),
				{ t: 'b' }
			];
		}
		const wrappers: Record<string, (schema: s.AnySchema) => s.AnySchema> = {
			optional: (schema) => s.optional(schema),
			nullable: (schema) => s.nullable(schema),
			with_default: (schema) => s.with_default(schema, undefined),
			with_default_fn: (schema) => s.with_default_fn(schema, () => undefined as any),
			lazy: (schema) => s.lazy(() => schema)
		};
		for (const [name, wrap] of Object.entries(wrappers)) {
			cases[`each under ${name}`] = [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self, i) =>
					wrap(s.loose_object({ ...first, c, x: s.array(self), ...(i ? {} : { u: s.string }) }))
				),
				{ t: 'b' }
			];
		}
		for (const [name, [schema, tag]] of Object.entries(cases)) {
			assert.doesNotThrow(() => compile_guard(schema), name);
			assert_walk(schema, chain(DEPTH, node_of(tag), { ...tag, x: [] }), name);
			// and where the deepest leaf matches nothing, so every level fails
			assert_walk(schema, chain(DEPTH, node_of(tag), 1), name);
		}
	});

	test('a literal tells the options that take an object apart beside one that takes only an array', () => {
		const N = lazy_of((self) =>
			s.union([
				s.object({ t: s.literal('a'), c, x: s.array(self) }),
				s.object({ t: s.literal('b'), c, x: s.array(self) }),
				s.array(self)
			])
		);
		assert_walk(
			N,
			chain(DEPTH, (child) => ({ t: 'b', x: [[child]] }), { t: 'b', x: [] }),
			'beside an array'
		);
	});

	test('what is no literal first in each tells nothing apart, and the union is refused', () => {
		// each with a node both options take but for the first's last entry
		const cases: Record<string, [s.AnySchema, Record<string, unknown> | null]> = {
			'a one_of': [two_of([{ t: s.one_of(['a', 'b']) }, { t: s.one_of(['b', 'c']) }]), { t: 'b' }],
			'an optional of a literal': [
				two_of([{ t: s.optional(s.literal('a')) }, { t: s.optional(s.literal('b')) }]),
				{}
			],
			'a nullable of a literal': [
				two_of([{ t: s.nullable(s.literal('a')) }, { t: s.nullable(s.literal('b')) }]),
				{ t: null }
			],
			'a with_default of a literal': [
				two_of([
					{ t: s.with_default(s.literal('a'), 'a') },
					{ t: s.with_default(s.literal('b'), 'b') }
				]),
				{}
			],
			'a string held to a regex': [
				two_of([
					{ t: s.pipe(s.string, s.regex(/^[ab]$/)) },
					{ t: s.pipe(s.string, s.regex(/^[bc]$/)) }
				]),
				{ t: 'b' }
			],
			'one value in both': [two_of([{ t: s.literal('a') }, { t: s.literal('a') }]), { t: 'a' }],
			'zero and minus zero, which a literal of either takes': [
				two_of([{ t: s.literal(0) }, { t: s.literal(-0) }]),
				{ t: 0 }
			],
			'NaN in both': [two_of([{ t: s.literal(NaN) }, { t: s.literal(NaN) }]), { t: NaN }],
			'a literal at a key of its own in each': [
				two_of([{ a: s.literal('x') }, { b: s.literal('y') }]),
				{ a: 'x', b: 'y' }
			],
			'a literal in the second option alone': [two_of([{}, { t: s.literal('b') }]), { t: 'b' }],
			'a literal in the first option alone': [two_of([{ t: s.literal('b') }, {}]), { t: 'b' }],
			'a literal after the entry that walks on, in one': [
				lazy_of((self) =>
					s.union([
						s.loose_object({ c, x: s.array(self), t: s.literal('a') }),
						s.loose_object({ t: s.literal('b'), c, x: s.array(self) })
					])
				),
				{ t: 'b' }
			],
			'a literal first in each, each option an object in a pipe': [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self) =>
					s.pipe(
						s.loose_object({ ...first, c, x: s.array(self) }),
						s.check(() => true)
					)
				),
				null
			],
			'a literal first in each, each option an object_with_rest': [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self) =>
					s.object_with_rest({ ...first, c, x: s.array(self) }, s.unknown)
				),
				null
			],
			'a literal first in each, each option a variant': [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self) =>
					s.variant('t', [s.object({ ...first, c, x: s.array(self) })])
				),
				null
			],
			'a literal first in each, each option a union of one': [
				two_of([{ t: s.literal('a') }, { t: s.literal('b') }], (first, self) =>
					s.union([s.loose_object({ ...first, c, x: s.array(self) })])
				),
				null
			],
			'two a literal tells apart, and a record beside them': [
				lazy_of((self) =>
					s.union([
						s.loose_object({ t: s.literal('a'), c, x: s.array(self) }),
						s.loose_object({ t: s.literal('b'), c, x: s.array(self) }),
						s.record(self)
					])
				),
				null
			]
		};
		for (const [name, [schema, tag]] of Object.entries(cases)) {
			assert_refused(schema, name);
			// where a node passes what stands first in both, the library walks it twice a level
			if (tag) assert_exponential(schema, chain(DEPTH, node_of(tag), { ...tag, x: [] }), name);
		}
	});
});

describe('the refusal: what the error says to write compiles', () => {
	const options = (self: s.AnySchema, first: boolean): Array<s.AnySchema> =>
		['a', 'b'].map((tag) =>
			s.object(
				first
					? { op: s.literal(tag), c, args: s.array(self) }
					: { c, args: s.array(self), op: s.literal(tag) }
			)
		);
	const node = (child: unknown): unknown => ({ args: [child], op: 'b' });
	const leaf = { args: [], op: 'b' };

	test('a union of object schemas: a memo_union, a variant, and the literal first in each', () => {
		const refused = lazy_of((self) => s.union(options(self, false)));
		assert.throws(
			() => compile_guard(refused),
			/: make it a memo_union, or where each option is an object schema, a variant, or put the literal entry that tells them apart first in each$/
		);
		for (const [name, fixed] of [
			['a memo_union', lazy_of((self) => s.memo_union(options(self, false)))],
			['a variant', lazy_of((self) => s.variant('op', options(self, false) as any))],
			['the literal first', lazy_of((self) => s.union(options(self, true)))]
		] as const) {
			assert_walk(fixed, chain(DEPTH, node, leaf), name);
		}
	});

	test('a union an option of which is no object schema: a memo_union, and the other two don’t apply', () => {
		const in_pipes = (self: s.AnySchema, first: boolean): Array<s.AnySchema> =>
			options(self, first).map((option) =>
				s.pipe(
					option,
					s.check(() => true)
				)
			);
		assert_refused(
			lazy_of((self) => s.union(in_pipes(self, false))),
			'as written'
		);
		// the literal first in each is still refused, as no literal is looked for in a pipe
		assert_refused(
			lazy_of((self) => s.union(in_pipes(self, true))),
			'the literal first'
		);
		assert_walk(
			lazy_of((self) => s.memo_union(in_pipes(self, false))),
			chain(DEPTH, node, leaf),
			'a memo_union'
		);
	});

	test('a pipe: the one option of a memo_union', () => {
		const steps = (self: s.AnySchema): [s.AnySchema, s.AnySchema] => [
			s.object({ c, k: s.array(self) }),
			s.loose_object({ k: s.array(self) })
		];
		const refused = lazy_of((self) => s.pipe(steps(self)[0], steps(self)[1] as any));
		assert.throws(() => compile_guard(refused), /: make it the one option of a memo_union$/);
		const fixed = lazy_of((self) => s.memo_union([s.pipe(steps(self)[0], steps(self)[1] as any)]));
		assert_walk(
			fixed,
			chain(DEPTH, (child) => ({ k: [child] }), { k: [] }),
			'a memo_union'
		);
	});
});
