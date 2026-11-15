import { describe, test, assert } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as s from '#lib/schema.ts';
import { COMPILE_MAX_DEPTH, compile_guard, compile_parse } from '#lib/compile.ts';
import type { CompileFallbackOutput } from './compile_fallback_test_child.ts';
import {
	COMPILE_HAND_SCHEMAS,
	find_compile_differences,
	to_compiled_pair
} from './compile_test_helpers.ts';

// What a compile reads of a schema, what it refuses, what it emits, and what
// it leaves to a schema's own `run`.

describe('what a compile reads and what it refuses', () => {
	// freezes every schema and every `def` a schema reaches, through each lazy
	const deep_freeze = (root: unknown, seen: Set<unknown> = new Set()): void => {
		if (root === null || typeof root !== 'object' || seen.has(root) || root instanceof RegExp) {
			return;
		}
		seen.add(root);
		Object.freeze(root);
		if (s.is_schema(root) && root.kind === 'lazy') deep_freeze(root.def(), seen);
		for (const value of Object.values(root)) deep_freeze(value, seen);
	};

	test('a schema frozen to its last def compiles and runs, so nothing is written to one', () => {
		for (const [name, schema] of Object.entries(COMPILE_HAND_SCHEMAS)) {
			deep_freeze(schema);
			assert.doesNotThrow(() => to_compiled_pair(schema), undefined, undefined, name);
		}
		// and a def that is a work list of the walk is as long as it was
		const options = [s.string, s.number, s.array(s.lazy(() => Union))];
		const Union: s.Schema = s.union(options);
		compile_guard(Union);
		compile_parse(
			s.pipe(
				Union,
				s.check(() => true)
			)
		);
		assert.lengthOf(Union.def as Array<unknown>, 3);
		assert.strictEqual(Union.def, options);
	});

	test('a lazy is called once at the compile, and never by the compiled function', () => {
		let calls = 0;
		const Node: s.Schema = s.object({
			next: s.optional(s.lazy(() => (calls++, Node))),
			other: s.optional(
				s.message(
					s.lazy(() => Node),
					'text'
				)
			)
		});
		const guard = compile_guard(Node);
		const before = calls;
		assert.isAtMost(before, 1);
		assert(guard({ next: { next: {}, other: {} } }));
		assert.strictEqual(calls, before);
	});

	test('a value that is no schema is refused where the compiler must read one, with its path', () => {
		assert.throws(() => compile_guard(5 as any), 'cannot compile at /: not a schema');
		assert.throws(
			() => compile_guard(s.lazy(() => 5 as any)),
			'cannot compile at /def(): not a schema'
		);
		assert.throws(
			() => compile_parse(s.object({ a: s.array(s.optional(s.lazy(() => undefined as any))) })),
			'cannot compile at /def/a/def/def/schema/def(): not a schema'
		);
	});

	test('a library kind whose def holds no schema is run in place, and throws what the interpreter throws', () => {
		for (const schema of [
			s.object({ a: 5 as any }),
			s.array(undefined as any),
			s.record({ kind: 'x' } as any),
			s.optional(null as any),
			{ kind: 'optional', def: {}, run: s.string.run } as s.AnySchema,
			{ kind: 'pipe', def: [], run: s.string.run } as s.AnySchema
		]) {
			const guard = compile_guard(schema);
			const parse = compile_parse(schema);
			for (const input of [{ a: 1 }, [1], 'x', undefined]) {
				let expected: unknown;
				try {
					expected = s.is(schema, input);
				} catch (error) {
					assert.throws(() => guard(input), (error as Error).constructor as ErrorConstructor);
					assert.throws(() => parse(input), (error as Error).constructor as ErrorConstructor);
					continue;
				}
				assert.strictEqual(guard(input), expected);
				assert.deepEqual(parse(input), s.parse(schema, input));
			}
		}
	});

	test('a schema is followed COMPILE_MAX_DEPTH schemas deep, and no deeper', () => {
		const nest = (depth: number): s.AnySchema => {
			let schema: s.AnySchema = s.string;
			for (let i = 0; i < depth; i++) schema = s.array(schema);
			return schema;
		};
		assert.strictEqual(COMPILE_MAX_DEPTH, 127);
		let input: unknown = 'x';
		for (let i = 0; i < COMPILE_MAX_DEPTH; i++) input = [input];
		assert.isTrue(compile_guard(nest(COMPILE_MAX_DEPTH))(input));
		assert.throws(
			() => compile_guard(nest(COMPILE_MAX_DEPTH + 1)),
			/^cannot compile `string` at (\/def){128}: more than 127 schemas around it, through every lazy$/
		);
	});

	test('a lazy that makes a new schema each call is refused past the depth it is followed to', () => {
		const endless = (): s.Schema => s.lazy(() => s.array(endless()));
		assert.throws(
			() => compile_guard(endless()),
			new RegExp(
				`^cannot compile \`(lazy|array)\` at (/def\\(\\)/def)+(/def\\(\\))?: more than ${COMPILE_MAX_DEPTH} schemas around it, through every lazy$`
			)
		);
		// a recursive schema comes back to itself, and ends
		const Tree: s.Schema = s.array(s.lazy(() => Tree));
		assert(compile_guard(Tree)([[], [[]]]));
		// and so does a lazy that only wraps itself, as an option the compiler asks for an object schema
		const Wrapped: s.Schema = s.lazy(() => s.nullable(Wrapped));
		const of_it = s.union([Wrapped, s.object({ a: s.string })]);
		assert.isTrue(compile_guard(of_it)(null));
		assert.deepEqual(compile_parse(of_it)(null), s.parse(of_it, null));
		assert.throws(() => s.is(of_it, { a: 'x' }), RangeError);
		assert.throws(() => compile_guard(of_it)({ a: 'x' }), RangeError);
	});

	test('only an EvalError of new Function falls back: any other is thrown', () => {
		const original = globalThis.Function;
		const throwing = (error: Error): void => {
			globalThis.Function = function () {
				throw error;
			} as unknown as FunctionConstructor;
		};
		const schema = s.object({ a: s.with_default(s.number, 1) });
		try {
			throwing(new SyntaxError('a bug of the emitter'));
			assert.throws(() => compile_guard(schema), SyntaxError);
			assert.throws(() => compile_parse(schema), SyntaxError);
			throwing(new TypeError('another'));
			assert.throws(() => compile_guard(schema), TypeError);
			throwing(new EvalError('refused'));
			const guard = compile_guard(schema);
			const parse = compile_parse(schema);
			globalThis.Function = original;
			assert.isTrue(guard({}));
			assert.isFalse(guard({ a: 'x' }));
			assert.deepEqual(parse({}), { ok: true, value: { a: 1 } });
			assert.deepEqual(parse({ a: 'x' }), s.parse(schema, { a: 'x' }));
		} finally {
			globalThis.Function = original;
		}
	});

	test('where new Function is refused the functions returned run the interpreter', async () => {
		const { stdout } = await promisify(execFile)(process.execPath, [
			'--disallow-code-generation-from-strings',
			fileURLToPath(new URL('./compile_fallback_test_child.ts', import.meta.url))
		]);
		const output: CompileFallbackOutput = JSON.parse(stdout.trim().split('\n').at(-1)!);
		assert.deepEqual(output, {
			refused: true,
			guard: [true, false],
			parse: [true, true],
			refusal: 'cannot compile at /def(): not a schema'
		});
	});

	// the source a compile hands `new Function`, read by standing in for it
	const source_of = (compile: () => unknown): string => {
		const original = globalThis.Function;
		let body = '';
		globalThis.Function = function (...args: Array<string>) {
			body = args.at(-1)!;
			return original(...args);
		} as unknown as FunctionConstructor;
		try {
			compile();
		} finally {
			globalThis.Function = original;
		}
		return body;
	};

	test('a schema held in more than one place is written once, so the source grows by the schemas and not the paths', () => {
		const checked = s.check(() => true);
		// what holds the level below, under two keys of each level: two paths a level
		const holders: Record<string, (node: s.AnySchema) => [s.AnySchema, s.AnySchema]> = {
			'the object, under an optional of its own at each key': (node) => [
				s.optional(node),
				s.optional(node)
			],
			'the object itself': (node) => [node, node],
			'one optional of it': (node) => {
				const held = s.optional(node);
				return [held, held];
			},
			'one nullable of it': (node) => {
				const held = s.nullable(node);
				return [held, held];
			},
			'one with_default of it': (node) => {
				const held = s.with_default(node, undefined);
				return [held, held];
			},
			'one with_default_fn of it': (node) => {
				const held = s.with_default_fn(node, () => ({ leaf: 'made' }) as any);
				return [held, held];
			},
			'one pipe of it and a check': (node) => {
				const held = s.pipe(node, checked);
				return [held, held];
			},
			'one optional of a pipe of it': (node) => {
				const held = s.optional(s.pipe(node, checked));
				return [held, held];
			}
		};
		for (const [name, hold] of Object.entries(holders)) {
			const nest = (depth: number): s.AnySchema => {
				let node: s.AnySchema = s.object({ leaf: s.optional(s.string) });
				for (let i = 0; i < depth; i++) {
					const [x, y] = hold(node);
					node = s.object({ x, y: s.optional(y), d: s.with_default(s.number, i) });
				}
				return node;
			};
			for (const compile of [compile_guard, compile_parse]) {
				const lengths = [10, 11, 12, 13].map(
					(depth) => source_of(() => compile(nest(depth))).length
				);
				const steps = lengths.slice(1).map((length, i) => length - lengths[i]!);
				assert.isAbove(steps[0]!, 0, name);
				// a level adds what a level is, give or take the digits of a counter
				assert.isAtMost(Math.max(...steps) - Math.min(...steps), 16, `${name}: ${lengths}`);
			}
			// and a nesting whose paths are past counting compiles, and runs
			const deep = nest(30);
			let input: any = { leaf: 'x' };
			for (let i = 0; i < 30; i++) input = i % 2 ? { x: input } : { x: input, d: i };
			assert.deepEqual(
				find_compile_differences(deep, [() => input, () => ({ x: { x: 1 } })]),
				[],
				name
			);
		}
	});

	test('a schema held once is written in line, and a leaf held often stays in line', () => {
		const leaf = s.pipe(s.string, s.min_length(1));
		const once = source_of(() =>
			compile_guard(s.object({ a: s.object({ b: leaf }), c: leaf, d: leaf }))
		);
		assert.notInclude(once, 'function _');
		const inner = s.object({ b: leaf });
		const twice = source_of(() => compile_guard(s.object({ a: inner, c: s.array(inner) })));
		assert.strictEqual(twice.split('function _').length - 1, 1);
	});
});

describe('emitted source is built from safe parts', () => {
	const MARK = '__compile_test_broke_out';
	const hostile = (text: string): string =>
		`${text}"]; globalThis.${MARK} = 1; //${String.fromCharCode(0x2028, 0x2029)}\\'\`\${globalThis.${MARK} = 1}\n`;
	const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`);
	const KEY = hostile('key');
	const VALUE = hostile('value');

	const CASES: Record<string, [s.AnySchema, Array<() => unknown>]> = {
		'a key of an object': [
			s.object({ [KEY]: s.number, [hostile('b')]: s.optional(s.string) }),
			[() => ({ [KEY]: 1 }), () => ({}), () => ({ [KEY]: 1, x: 1 })]
		],
		'a key of a copy': [
			s.strip_object({ [KEY]: s.with_default(s.number, 1), b: s.optional(s.unknown) }),
			[() => ({}), () => ({ [KEY]: 2, x: 1 }), () => ({ b: undefined })]
		],
		'a key of a loose_object and of a rest': [
			s.union([
				s.object_with_rest({ [KEY]: s.number }, s.string),
				s.loose_object({ [KEY]: s.with_default(s.string, VALUE) })
			]),
			[() => ({ [KEY]: 1, z: 'x' }), () => ({ z: 1 }), () => ({ [KEY]: 'x', z: 1 })]
		],
		'a literal and the values of a one_of': [
			s.union([s.literal(VALUE), s.one_of([hostile('one'), hostile('two')])]),
			[() => VALUE, () => hostile('two'), () => 'value']
		],
		'a default': [
			s.object({ a: s.with_default(s.string, VALUE) }),
			[() => ({}), () => ({ a: 'x' })]
		],
		'the key and the literals of a variant': [
			s.variant(KEY, [
				s.loose_object({ [KEY]: s.literal(VALUE) }),
				s.loose_object({ [KEY]: s.literal(1) })
			]),
			[() => ({ [KEY]: VALUE }), () => ({ [KEY]: 1 }), () => ({ [KEY]: 2 })]
		],
		'a bound that is no number': [
			s.pipe(
				s.string,
				s.min_length(hostile('1') as any),
				s.max_length({ valueOf: () => 3 } as any)
			),
			[() => 'ab', () => 'abcd']
		],
		'the bounds that are numbers': [
			s.pipe(s.number, s.min_value(-0), s.max_value(Infinity), s.min_value(-1e21)),
			[() => 0, () => -1, () => NaN]
		],
		'a bigint bound': [
			s.pipe(s.bigint, s.min_value(-5n), s.max_value(2n ** 70n)),
			[() => 1n, () => -6n]
		],
		'the source and the flags of a regex': [
			s.pipe(s.string, s.regex(new RegExp(`^x|"\\]; globalThis\\.${MARK} = 1; //`, 'i'))),
			[() => 'X', () => 'y']
		],
		'a kind that is no kind of the library': [
			{
				kind: KEY,
				def: VALUE,
				run: (v: unknown, ctx: s.SchemaContext) => (v === 1 ? v : s.fail(ctx, KEY, v))
			},
			[() => 1, () => 2]
		]
	};

	for (const [name, [schema, inputs]] of Object.entries(CASES)) {
		test(`${name} stays data`, () => {
			assert.deepEqual(find_compile_differences(schema, inputs), []);
			assert.isUndefined((globalThis as any)[MARK]);
			// a line separator of the schema's is escaped in the source
			assert.notMatch(String(compile_parse(schema)), SEPARATORS);
		});
	}

	test('a regex and a function are captured values, and not text', () => {
		const pattern = /^secret_pattern$/;
		const fn = (v: unknown): boolean => v === 'secret_function';
		const guard = compile_guard(s.union([s.pipe(s.string, s.regex(pattern)), s.check(fn)]));
		assert(guard('secret_pattern') && guard('secret_function') && !guard('other'));
		assert.notInclude(String(guard), 'secret');
	});
});

describe('a schema with no code of the compiler is run in place', () => {
	// the README's own kind
	const Even: s.Schema<number> = {
		kind: 'even',
		def: undefined,
		run: (value, ctx) =>
			typeof value === 'number' && value % 2 === 0
				? value
				: s.fail(ctx, 'even', value, 'an even number')
	};
	// one that needs its key, which declares the object and the key as parameters
	const Present: s.Schema = {
		kind: 'present',
		def: undefined,
		run: (value, ctx, parent, key) =>
			parent && !((key as string) in parent) ? s.fail(ctx, 'missing_key', value) : value
	};
	// one that gives another value
	const Doubled: s.Schema<number> = {
		kind: 'doubled',
		def: undefined,
		run: (value, ctx) => (typeof value === 'number' ? value * 2 : s.fail(ctx, 'doubled', value))
	};
	const INPUTS: Array<() => unknown> = [
		() => 2,
		() => 3,
		() => 'x',
		() => undefined,
		() => ({}),
		() => ({ a: 2 }),
		() => ({ a: 3 }),
		() => ({ a: undefined }),
		() => ({ a: null }),
		() => ({ a: 2, z: 1 }),
		() => [2, 4],
		() => [2, 3],
		() => ({ a: [{ a: 4 }, 2] })
	];
	const SCHEMAS: Record<string, s.AnySchema> = {
		'as the root': Even,
		'as an entry': s.object({ a: Even }),
		'under a union': s.union([s.string, Even, s.object({ a: s.union([s.string, Even]) })]),
		'in a pipe': s.pipe(s.unknown, Even, s.max_value(2)),
		'as the first schema of a pipe': s.object({
			a: s.pipe(
				Present,
				s.check(() => true)
			)
		}),
		'as an item and under wrappers': s.array(s.optional(s.nullable(Even))),
		'one that needs its key, as an entry': s.object({ a: Present }),
		'one that needs its key, under a nullable and a lazy': s.object({
			a: s.nullable(s.lazy(() => Present))
		}),
		'one that needs its key, under a union with a default': s.object({
			a: s.union([Present, s.with_default(s.number, 1)])
		}),
		'one that gives another value': s.strip_object({ a: s.optional(Doubled) }),
		'one that gives another value, in a recursive schema': s.lazy(() => Recursive),
		'a library kind whose def is not the kind’s': s.object({
			a: { kind: 'optional', def: undefined, run: Even.run } as s.AnySchema
		}),
		'a variant whose option has no entry at its key': {
			kind: 'variant',
			def: { key: 'a', options: [s.object({ b: s.literal(1) })] },
			run: Even.run
		}
	};
	const Recursive: s.Schema = s.union([
		Doubled,
		s.object({ a: s.optional(s.array(s.lazy(() => Recursive))) })
	]);

	for (const [name, schema] of Object.entries(SCHEMAS)) {
		test(name, () => {
			assert.deepEqual(find_compile_differences(schema, INPUTS), []);
		});
	}

	// A kind is handed the object and the key as the library hands them: where
	// its `run` declares more than two parameters, always as the entry itself,
	// and through a `lazy` whatever it declares. One that reads them from a
	// rest parameter is outside what `Schema.run` asks, and shows both ways
	test('a kind is handed the object and the key by the library’s rule', () => {
		const Rest: s.AnySchema = {
			kind: 'rest_reader',
			def: undefined,
			run: (value: unknown, ctx: s.SchemaContext, ...rest: Array<any>) =>
				rest[0] && !(rest[1] in rest[0]) ? s.fail(ctx, 'missing_key', value) : value
		};
		const inputs = [() => ({}), () => ({ a: undefined }), () => ({ a: 1 }), () => ({ a: null })];
		const cases: Record<string, [s.AnySchema, boolean]> = {
			'as the entry': [s.object({ a: Rest }), false],
			'under a nullable': [s.object({ a: s.nullable(Rest) }), true],
			'as an option': [s.object({ a: s.union([Rest, s.string]) }), true],
			'first in a pipe': [
				s.object({
					a: s.pipe(
						Rest,
						s.check(() => true)
					)
				}),
				true
			],
			'as an option beside one that takes them': [
				s.object({ a: s.union([Rest, s.unknown]) }),
				false
			],
			'through a lazy': [s.object({ a: s.lazy(() => Rest) }), false],
			'through a lazy under a nullable': [s.object({ a: s.nullable(s.lazy(() => Rest)) }), false]
		};
		for (const [name, [schema, takes_missing]] of Object.entries(cases)) {
			assert.strictEqual(s.is(schema, {}), takes_missing, name);
			assert.deepEqual(find_compile_differences(schema, inputs), [], name);
		}
	});
});
