import { describe, test, assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as s from '#lib/schema.ts';
import { compile_guard, to_guard_source } from '#lib/compile.ts';
import { COMPILE_HAND_INPUTS, COMPILE_HAND_SCHEMAS } from './compile_test_helpers.ts';
import { regex_of_any_flags } from './schema_test_helpers.ts';
import { create_seeded_rng, type SeededRng } from './seeded_rng.ts';

// `to_guard_source`: the text of a module, imported and run, held to `is` and
// to the guard `compile_guard` makes of the same schema. A text is loaded as
// a `data:` module, so nothing is written to a disk: it imports the library
// by the URL of its source in this tree.

const LIBRARY = pathToFileURL(fileURLToPath(new URL('../lib/schema.ts', import.meta.url))).href;
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);

type Guard = (value: unknown) => boolean;

const load = async (text: string): Promise<Record<string, any>> =>
	import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text));

const write = async (schema: s.AnySchema): Promise<Guard> =>
	(await load(to_guard_source(schema, 'guard', LIBRARY))).guard;

const UNWRITABLE =
	/^cannot write `[\w ]*` at \/.*: it is run by a function, or holds a value, that can't be written as source$/;

// what a guard did with a value: its verdict, or the kind of error it threw
const attempt = (guard: Guard, value: unknown): unknown => {
	try {
		return guard(value);
	} catch (error) {
		return (error as Error).constructor.name;
	}
};

// every kind `schema` holds, through every lazy
const kinds_of = (schema: s.AnySchema, seen: Set<unknown> = new Set()): Set<unknown> => {
	const visit = (value: any): void => {
		if (!s.is_schema(value) || seen.has(value)) return;
		seen.add(value);
		const { kind, def } = value as { kind: string; def: any };
		if (kind === 'lazy' && typeof def === 'function') visit(def());
		else if (Array.isArray(def)) def.forEach(visit);
		else if (def && typeof def === 'object') {
			visit(def);
			for (const of_def of Object.values(def)) {
				visit(of_def);
				if (Array.isArray(of_def)) of_def.forEach(visit);
				else if (of_def && typeof of_def === 'object') Object.values(of_def).forEach(visit);
			}
		}
	};
	visit(schema);
	return new Set([...seen].map((x: any) => x.kind));
};

describe('a written guard gives what is gives', () => {
	test('over the hand table, for every schema that can be written, and every kind that can', async () => {
		const written: Set<unknown> = new Set();
		let refused = 0;
		// and one schema of every kind that can be written
		const every_kind = s.object({
			a: s.boolean,
			b: s.optional(s.bigint),
			c: s.nullable(s.unknown),
			d: s.with_default(s.pipe(s.number, s.integer, s.min_value(0), s.max_value(9)), 1),
			e: s.pipe(s.string, s.min_length(1), s.max_length(3), s.regex(/^[a-z]+$/)),
			f: s.pipe(s.string, s.uuid),
			g: s.pipe(s.string, s.iso_datetime),
			h: s.pipe(s.string, s.to_integer(), s.safe_integer),
			i: s.pipe(s.string, s.to_lower_case),
			j: s.one_of(['a', 1]),
			k: s.literal('k'),
			l: s.lazy(() => s.array(s.record(s.keyed_record(s.string, s.number)))),
			m: s.union([s.loose_object({ x: s.number }), s.strip_object({ y: s.number })]),
			n: s.variant('t', [s.object({ t: s.literal('a') }), s.object({ t: s.literal('b') })]),
			o: s.object_with_rest({ p: s.string }, s.number)
		});
		const every_input = {
			a: true,
			c: null,
			e: 'ab',
			f: UUID,
			g: '2026-01-02T03:04:05Z',
			h: '12',
			i: 'Ab',
			j: 1,
			k: 'k',
			l: [{ r: { s: 1 } }],
			m: { y: 2 },
			n: { t: 'b' },
			o: { p: 'p', q: 3 }
		};
		const schemas: Array<[string, s.AnySchema, Array<() => unknown>]> = [
			...Object.entries(COMPILE_HAND_SCHEMAS).map(
				([name, schema]): [string, s.AnySchema, Array<() => unknown>] => [
					name,
					schema,
					COMPILE_HAND_INPUTS
				]
			),
			[
				'every kind',
				every_kind,
				[
					() => every_input,
					...Object.keys(every_input).map((key) => () => ({ ...every_input, [key]: [] })),
					...COMPILE_HAND_INPUTS
				]
			]
		];
		for (const [name, schema, inputs] of schemas) {
			let guard: Guard;
			try {
				guard = await write(schema);
			} catch (error) {
				// what holds a function, or is run in place, has no text
				assert.match((error as Error).message, UNWRITABLE, name);
				refused++;
				continue;
			}
			for (const kind of kinds_of(schema)) written.add(kind);
			const compiled = compile_guard(schema);
			for (const [i, make] of inputs.entries()) {
				const expected = attempt((value) => s.is(schema, value), make());
				assert.strictEqual(attempt(guard, make()), expected, `${name}, input ${i}`);
				assert.strictEqual(attempt(compiled, make()), expected, `${name}, input ${i}`);
			}
		}
		assert.isAbove(refused, 0);
		// every kind of the library but the three that hold a function
		for (const kind of [
			'string',
			'number',
			'boolean',
			'bigint',
			'unknown',
			'literal',
			'one_of',
			'optional',
			'nullable',
			'with_default',
			'lazy',
			'object',
			'loose_object',
			'strip_object',
			'object_with_rest',
			'record',
			'keyed_record',
			'array',
			'union',
			'variant',
			'pipe',
			'min_length',
			'max_length',
			'min_value',
			'max_value',
			'integer',
			'safe_integer',
			'regex',
			'uuid',
			'iso_datetime',
			'to_integer',
			'to_lower_case'
		]) {
			assert.isTrue(written.has(kind), kind);
		}
	});

	// schemas of what can be written alone: no `check`, `transform`, or `with_default_fn`
	type Drawn = [schema: s.AnySchema, valid: () => unknown];
	const gen_leaf = (rng: SeededRng, i: number): Drawn => {
		switch (rng.int(14)) {
			case 0:
				return [s.pipe(s.string, s.regex(new RegExp(`^[a-z"/]{1,${2 + i}}$`, 'i'))), () => 'a/"'];
			case 1:
				return [s.pipe(s.string, s.min_length(1), s.max_length(4 + i)), () => 'abc'];
			case 2:
				return [s.pipe(s.number, s.integer, s.min_value(-i), s.max_value(9 + i)), () => 3];
			case 3:
				return [s.pipe(s.string, s.uuid), () => UUID];
			case 4:
				return [s.pipe(s.string, s.iso_datetime), () => '2026-01-02T03:04:05Z'];
			case 5:
				return [
					s.pipe(s.string, s.to_integer({ unsigned: rng.chance(0.5) }), s.min_value(i)),
					() => String(i + 2)
				];
			case 6:
				return [s.pipe(s.string, s.to_lower_case, s.regex(/^[a-z]+$/)), () => 'Ab'];
			case 7: {
				const values: Array<s.SchemaLiteral> = Array.from(
					{ length: 9 + rng.int(8) },
					(_, j) => 'v' + j
				);
				if (rng.chance(0.3)) values.push(NaN, 12n, null, -0);
				const defined = values.slice();
				if (rng.chance(0.3)) values.push(undefined);
				return [s.one_of(values), () => rng.pick(defined)];
			}
			case 8:
				return [s.literal(rng.pick(['a', 1, true, null, 5n])), () => undefined];
			case 9:
				return [s.optional(s.boolean), () => (rng.chance(0.5) ? undefined : true)];
			case 10:
				return [s.with_default(s.number, i), () => (rng.chance(0.5) ? undefined : 2)];
			case 11:
				return [s.nullable(s.bigint), () => (rng.chance(0.5) ? null : 1n)];
			case 12:
				return [s.unknown, () => rng.pick([1, 'x', null, {}])];
			default:
				return [s.pipe(s.number, s.safe_integer), () => i];
		}
	};
	const gen_node = (rng: SeededRng, depth: number): Drawn => {
		const entries: Record<string, s.AnySchema> = {};
		const valids: Record<string, () => unknown> = {};
		const width = 1 + rng.int(depth > 1 ? 5 : 12);
		for (let i = 0; i < width; i++) {
			const reused = i && rng.chance(0.15) ? 'k' + rng.int(i) : null;
			const [schema, valid]: Drawn = reused
				? [entries[reused]!, valids[reused]!]
				: depth > 0 && rng.chance(0.35)
					? gen_container(rng, depth - 1)
					: gen_leaf(rng, i);
			entries['k' + i] = schema;
			valids['k' + i] = valid;
		}
		const value = (): Record<string, unknown> => {
			const made: Record<string, unknown> = {};
			for (const key of Object.keys(valids)) {
				const of_key = valids[key]!();
				// a literal entry is filled from its schema
				const entry = entries[key]!;
				if (entry.kind === 'literal') made[key] = entry.def;
				else if (of_key !== undefined) made[key] = of_key;
			}
			return made;
		};
		const flavor = rng.pick([s.object, s.strip_object, s.loose_object]);
		return [flavor(entries), value];
	};
	const gen_container = (rng: SeededRng, depth: number): Drawn => {
		const [node, valid] = gen_node(rng, depth);
		switch (rng.int(7)) {
			case 0:
				return [s.array(node), () => [valid(), valid()]];
			case 1:
				return [s.record(node), () => ({ r: valid() })];
			case 2:
				return [s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]$/)), node), () => ({ a: valid() })];
			case 3:
				return [s.object_with_rest({ n: s.number }, node), () => ({ n: 1, more: valid() })];
			case 4:
				return [s.union([s.string, node, s.array(s.number)]), valid];
			case 5: {
				const tagged = (tag: string): s.AnySchema => s.object({ t: s.literal(tag), of: node });
				return [s.variant('t', [tagged('a'), tagged('b')] as any), () => ({ t: 'b', of: valid() })];
			}
			default: {
				// a recursive schema, its union a `memo_union`
				const tree: s.AnySchema = s.lazy(() =>
					s.memo_union([
						s.object({ kids: s.array(tree), of: s.optional(node) }),
						s.object({ kids: s.array(tree), n: s.number })
					])
				);
				return [tree, () => ({ kids: [{ kids: [], n: 1 }, { kids: [] }], of: valid() })];
			}
		}
	};
	// a change of a value that matched, somewhere in it
	const vary = (rng: SeededRng, value: any): void => {
		const keys = Object.keys(value);
		const key = keys.length ? rng.pick(keys) : undefined;
		const at = key === undefined ? undefined : value[key];
		if (at !== null && typeof at === 'object' && rng.chance(0.6)) {
			vary(rng, Array.isArray(at) && at.length ? at[0] : at);
		} else if (key === undefined || rng.chance(0.3)) value.extra_key = 1;
		else if (rng.chance(0.4)) delete value[key];
		else value[key] = rng.pick(['NO', 7, null, {}, 'v99', '  ', undefined, 'not-a-uuid']);
	};

	for (const seed of [1, 2, 3]) {
		test(`over generated schemas of what can be written, seed ${seed}`, async () => {
			const rng = create_seeded_rng(seed);
			let matched = 0;
			for (let n = 0; n < 80; n++) {
				const [schema, valid] = gen_container(rng, 2);
				const guard = await write(schema);
				const compiled = compile_guard(schema);
				const inputs = [valid(), valid(), valid(), valid(), valid()];
				for (const input of inputs.slice(1)) vary(rng, input);
				for (const [i, input] of inputs.entries()) {
					const expected = s.is(schema, input);
					if (expected) matched++;
					assert.strictEqual(guard(input), expected, `case ${n}, input ${i}`);
					assert.strictEqual(compiled(input), expected, `case ${n}, input ${i}`);
				}
			}
			// both verdicts are drawn
			assert.isAbove(matched, 80);
			assert.isBelow(matched, 80 * 5);
		});
	}
});

describe('what a written module is', () => {
	test('JavaScript that a TypeScript file can hold: one export, and no library where no format is used', () => {
		const text = to_guard_source(s.object({ name: s.string, tags: s.array(s.string) }), 'is_user');
		assert.isTrue(text.startsWith('// @ts-nocheck\n/* eslint-disable */\n'));
		assert.isTrue(text.endsWith(' as is_user };\n'));
		assert.notInclude(text, 'import');
		assert.strictEqual(text.match(/^export /gm)?.length, 1);
		// nothing of the factory's is in it
		assert.notMatch(text, /fallback|\bctx\b|\bP\b|handoff|FAIL|RangeError/);
	});

	test('a format action is imported from the library, the default specifier the package’s', async () => {
		const schema = s.object({
			id: s.pipe(s.string, s.uuid),
			at: s.pipe(s.string, s.iso_datetime),
			n: s.pipe(s.string, s.to_integer({ unsigned: true, trim: true }), s.min_value(2)),
			m: s.pipe(s.string, s.to_integer())
		});
		const text = to_guard_source(schema, 'guard');
		assert.include(
			text,
			'import { uuid, iso_datetime, to_integer } from "@fuzdev/fuz_schema/schema.js";\n'
		);
		assert.include(text, 'to_integer({ unsigned: true, trim: true })');
		assert.include(text, 'to_integer({ unsigned: false, trim: false })');
		const guard = await write(schema);
		const valid = { id: UUID, at: '2026-01-02T03:04:05Z', n: ' 12 ', m: '-3' };
		for (const input of [
			valid,
			{ ...valid, id: 'x' },
			{ ...valid, at: 'yesterday' },
			{ ...valid, n: '-12' },
			{ ...valid, n: '1' },
			{ ...valid, m: ' 3' },
			valid
		]) {
			assert.strictEqual(guard(input), s.is(schema, input), JSON.stringify(input));
		}
		// a failure leaves nothing behind for the next call
		assert.isTrue(guard(valid));
	});

	test('the specifier of the library is written as a string, whatever it holds', () => {
		const hostile = `x"; throw 0; //${LINE_SEPARATORS}\n'\``;
		const text = to_guard_source(s.pipe(s.string, s.uuid), 'guard', hostile);
		assert.include(
			text,
			`import { uuid } from ${JSON.stringify(hostile).replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))};\n`
		);
		assert.notMatch(text, /[\u2028\u2029]/);
		assert.strictEqual(text.split('\n').filter((line) => line.includes('throw 0')).length, 1);
	});

	test('a format action is run with the value and a probing context, which a failure leaves as it was', async () => {
		// a stand-in for the library, whose action records what it is handed
		const spy =
			'data:text/javascript,' +
			encodeURIComponent(
				'export const seen = [];\n' +
					'export const uuid = { kind: "uuid", def: undefined, run(value, ctx) {\n' +
					'seen.push([arguments.length, Object.keys(ctx).join(), ctx.probe, ctx.issues, ctx.fails]);\n' +
					'if (value !== "ok") ctx.fails++;\nreturn value;\n} };\n'
			);
		const { guard } = await load(to_guard_source(s.pipe(s.string, s.uuid), 'guard', spy));
		const { seen } = await import(/* @vite-ignore */ spy);
		assert.deepEqual([guard('no'), guard('ok'), guard('no')], [false, true, false]);
		// the context has the keys of one the library makes, in its order
		let keys = '';
		s.is({ kind: 'keys', def: undefined, run: (_, ctx) => (keys = Object.keys(ctx).join()) }, 0);
		const call = [2, keys, true, undefined, 0];
		assert.deepEqual(seen, [call, call, call]);
	});

	test('a to_integer is written from two booleans, whatever its def holds', () => {
		const hostile = { unsigned: 'true }); throw 0; ({', trim: 0 };
		const schema = s.pipe(s.string, {
			kind: 'to_integer',
			def: hostile,
			run: (v: unknown) => v
		} as s.AnySchema);
		const text = to_guard_source(schema, 'guard');
		assert.include(text, 'const c0 = to_integer({ unsigned: true, trim: false });\n');
		assert.notInclude(text, 'throw 0');
	});

	test('a module that imports nothing has the value of a failure where its code reads it', async () => {
		// a lazy as the first step of a pipe that changes the value: its function gives the output or the failure
		const schema = s.pipe(
			s.lazy(() => s.strip_object({ a: s.string })),
			s.object({ a: s.string })
		);
		const text = to_guard_source(schema, 'guard');
		assert.notInclude(text, 'import');
		assert.include(text, 'FAIL');
		const guard = await write(schema);
		for (const input of [{ a: 'x' }, { a: 'x', more: 1 }, { a: 1 }, 5]) {
			assert.strictEqual(guard(input), s.is(schema, input), JSON.stringify(input));
		}
	});

	test('a TypeScript file holds the text, and the cast to a type predicate compiles where it is imported', () => {
		const options: ts.CompilerOptions = {
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			target: ts.ScriptTarget.ESNext,
			strict: true,
			noEmit: true,
			noUnusedLocals: true,
			allowUnusedLabels: false,
			allowUnreachableCode: false,
			allowImportingTsExtensions: true,
			skipLibCheck: true,
			types: []
		};
		const dir = fileURLToPath(new URL('.', import.meta.url));
		const schema = s.object({
			name: s.string,
			id: s.pipe(s.string, s.uuid),
			n: s.pipe(s.string, s.to_integer(), s.min_value(1)),
			kind: s.one_of(Array.from({ length: 14 }, (_, i) => 'k' + i)),
			tags: s.array(s.pipe(s.string, s.regex(/^[a-z]+$/))),
			tree: s.lazy(() => s.memo_union([s.string, s.array(s.number)]))
		});
		const files = new Map([
			[dir + 'written_guard.ts', to_guard_source(schema, 'is_user', '../lib/schema.ts')],
			[
				dir + 'written_guard_probe.ts',
				`import { is_user } from './written_guard.ts';
import * as s from '../lib/schema.ts';
const User = s.object({ name: s.string, tags: s.with_default(s.array(s.string), []) });
const guard = is_user as (value: unknown) => value is s.InferInput<typeof User>;
export const name_of = (value: unknown): string | undefined => (guard(value) ? value.name : undefined);
export const plain: boolean = is_user(1);
// @ts-expect-error the guard is typed, and gives a boolean
export const wrong: string = is_user(1);
`
			]
		]);
		const host = ts.createCompilerHost(options);
		const { getSourceFile, fileExists, readFile } = host;
		host.getSourceFile = (name, language, ...rest) => {
			const text = files.get(name);
			return text === undefined
				? getSourceFile.call(host, name, language, ...rest)
				: ts.createSourceFile(name, text, language);
		};
		host.fileExists = (name) => files.has(name) || fileExists.call(host, name);
		host.readFile = (name) => files.get(name) ?? readFile.call(host, name);
		const program = ts.createProgram([...files.keys()], options, host);
		const errors = ts
			.getPreEmitDiagnostics(program)
			.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
		assert.deepEqual(errors, []);
		// and without its first line the text is refused, so the line is what makes it hold
		files.set(dir + 'written_guard.ts', files.get(dir + 'written_guard.ts')!.replace(/^.*\n/, ''));
		const bare = ts.createProgram([...files.keys()], options, host);
		assert.isAbove(ts.getPreEmitDiagnostics(bare).length, 0);
	}, 30_000);

	test('a memo_union keeps its verdicts for a call, with no context', async () => {
		const tree: s.AnySchema = s.lazy(() =>
			s.memo_union([
				s.object({ kids: s.array(tree), t: s.literal('a') }),
				s.object({ kids: s.array(tree), t: s.literal('b') })
			])
		);
		const text = to_guard_source(tree, 'guard');
		assert.include(text, 'new WeakMap()');
		assert.notMatch(text, /\bctx\b|fallback|catch/);
		const guard = await write(tree);
		// each level held twice: as many objects as levels, and twice the places at each
		let ops = 0;
		const counting: ProxyHandler<object> = {
			get: (target, key, receiver) => (ops++, Reflect.get(target, key, receiver)),
			has: (target, key) => (ops++, Reflect.has(target, key)),
			ownKeys: (target) => (ops++, Reflect.ownKeys(target))
		};
		const dag = (depth: number): unknown => {
			let node: unknown = new Proxy({ kids: [], t: 'b' }, counting);
			for (let i = 0; i < depth; i++) node = new Proxy({ kids: [node, node], t: 'b' }, counting);
			return node;
		};
		const count = (run: Guard, value: unknown): number => {
			ops = 0;
			assert.isTrue(run(value));
			return ops;
		};
		const small = count(guard, dag(10));
		const large = count(guard, dag(20));
		// a walk for each object, where a walk for each place would be a thousand times more
		assert.isAtMost(large, 2 * small + 20);
		assert.strictEqual(large, count(compile_guard(tree), dag(20)));
		// a verdict kept in one call is not read by the next
		const input: any = { kids: [{ kids: [], t: 'a' }], t: 'b' };
		assert.isTrue(guard(input));
		input.kids[0].t = 'c';
		assert.isFalse(guard(input));
	});

	test('a call a getter of the input makes while one runs keeps verdicts of its own, and leaves the outer call its own', async () => {
		const tree: s.AnySchema = s.lazy(() =>
			s.memo_union([
				s.object({ kids: s.array(tree), t: s.literal('a') }),
				s.object({ kids: s.array(tree), t: s.literal('b') })
			])
		);
		const guard = await write(tree);
		// what a guard gives for an input that asks the same guard of a node the
		// outer call has walked, before and after it changes the node
		const reenter = (run: Guard): [outer: boolean, inner: Array<boolean>] => {
			const node = { kids: [], t: 'a' };
			const inner: Array<boolean> = [];
			const input = {
				kids: [
					node,
					{
						get kids() {
							inner.push(run(node));
							node.t = 'z';
							inner.push(run(node));
							return [];
						},
						t: 'a'
					},
					node
				],
				t: 'a'
			};
			return [run(input), inner];
		};
		const expected = reenter((value) => s.is(tree, value));
		// the outer call reads back the verdict it kept, and each inner call walks the node
		assert.deepEqual(expected, [true, [true, false]]);
		assert.deepEqual(reenter(guard), expected);
		assert.deepEqual(reenter(compile_guard(tree)), expected);
	});

	test('it has no interpreter behind it: a RangeError is thrown, where the runtime guard asks is', async () => {
		const tree: s.AnySchema = s.lazy(() => s.object({ kids: s.array(tree) }));
		const guard = await write(tree);
		const throwing_once = (): unknown => {
			let read = false;
			return {
				get kids() {
					if (!read) {
						read = true;
						throw new RangeError('once');
					}
					return [];
				}
			};
		};
		assert.throws(() => guard(throwing_once()), RangeError, 'once');
		assert.isTrue(compile_guard(tree)(throwing_once()));
		// and an input with no end runs it out of stack
		const cyclic: any = { kids: [] };
		cyclic.kids.push(cyclic);
		assert.throws(() => guard(cyclic), RangeError);
		assert.isTrue(guard({ kids: [{ kids: [] }] }));
	});
});

describe('the order captured values are written in', () => {
	test('a long one_of under unions and wrappers is one Set, however deep', () => {
		const values = Array.from({ length: 20 }, (_, i) => 'v' + i);
		let options: s.AnySchema = s.one_of(values);
		let wrapped: s.AnySchema = s.one_of(values);
		for (let i = 0; i < 4; i++) {
			options = s.union([options, s.object({ ['k' + i]: s.number })]);
			wrapped = s.optional(s.nullable(wrapped));
		}
		for (const schema of [options, s.object({ a: wrapped })]) {
			const text = to_guard_source(schema, 'guard');
			assert.strictEqual(text.split('new Set(').length - 1, 1, text);
			// and nothing is captured that the guard doesn't read
			assert.strictEqual(text.match(/^const c\d+ = /gm)?.length, 1, text);
		}
	});

	test('a value the text of a long one_of captures is written before the Set that holds it', async () => {
		// outside `SchemaLiteral`: a schema the module imports, held as a value
		const schema = s.one_of([...Array.from({ length: 13 }, (_, i) => i), s.uuid as any]);
		const text = to_guard_source(schema, 'guard');
		assert.include(
			text,
			'const c0 = uuid;\nconst c1 = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, c0]);\n'
		);
		const guard = await write(schema);
		assert.isTrue(guard(3));
		assert.isFalse(guard(13));
	});
});

describe('the name a guard is exported under', () => {
	test('what is no identifier is refused', () => {
		const schema = s.string;
		for (const name of [
			'',
			'a b',
			'a-b',
			'a.b',
			'1a',
			'a"',
			"a'",
			'a`',
			'a;b',
			'a\nb',
			'a\n',
			'\na',
			'a\r',
			'a' + LINE_SEPARATORS[0],
			'a}; throw 0; export { x as b',
			'a as b',
			'é',
			'a\\u0062',
			' a',
			'a '
		]) {
			assert.throws(
				() => to_guard_source(schema, name),
				/^cannot write a guard named ".*": not an identifier$/s,
				JSON.stringify(name)
			);
		}
		for (const name of [undefined, null, 5, ['a'], { toString: () => 'a' }]) {
			assert.throws(() => to_guard_source(schema, name as any), /^cannot write a guard named "/);
		}
		assert.throws(
			() => to_guard_source(schema, 'a' + LINE_SEPARATORS),
			'cannot write a guard named "a\\u2028\\u2029": not an identifier'
		);
	});

	test('then is refused, which would make the module a thenable that a dynamic import never settles', () => {
		assert.throws(
			() => to_guard_source(s.string, 'then'),
			'cannot write a guard named "then": the module would be a thenable, which a dynamic import never settles'
		);
	});

	test('a library that is no string is refused', () => {
		for (const library of [5, null, {}, ['x'], true]) {
			assert.throws(
				() => to_guard_source(s.pipe(s.string, s.uuid), 'guard', library as any),
				/^cannot import the format actions from ".*": not a string$/,
				JSON.stringify(library)
			);
		}
	});

	test('a name is only what the guard is exported as, so one the module uses, or a reserved word, shadows nothing', async () => {
		const schema = s.object({
			id: s.pipe(s.string, s.uuid),
			tags: s.array(s.pipe(s.string, s.regex(/^[a-z]+$/))),
			one: s.one_of(Array.from({ length: 14 }, (_, i) => i)),
			n: s.pipe(s.string, s.to_integer())
		});
		const valid = { id: UUID, tags: ['a'], one: 3, n: '4' };
		for (const name of [
			'_0',
			'_1',
			'c0',
			'c1',
			'v',
			'P',
			'FAIL',
			'handoff',
			'uuid',
			'to_integer',
			'Array',
			'Object',
			'RegExp',
			'Set',
			'undefined',
			'NaN',
			'__proto__',
			'constructor',
			'class',
			'function',
			'await',
			'import',
			'$',
			'_'
		]) {
			const module = await load(to_guard_source(schema, name, LIBRARY));
			assert.deepEqual(Object.keys(module), [name], name);
			const guard: Guard = module[name];
			assert.isTrue(guard(valid), name);
			assert.isFalse(guard({ ...valid, id: 'x' }), name);
			assert.isFalse(guard({ ...valid, tags: ['A'] }), name);
			assert.isFalse(guard({ ...valid, one: 14 }), name);
			assert.isFalse(guard({ ...valid, n: 'x' }), name);
		}
		// and `default` is the module's default export
		const module = await load(to_guard_source(schema, 'default', LIBRARY));
		assert.isTrue(module.default(valid));
	});
});

describe('a regex is written as its pattern and its flags', () => {
	test('a pattern stays a pattern, whatever it holds', async () => {
		// a pattern from a string, as a schema's author may make one
		const of = (source: string, flags = ''): RegExp => new RegExp(source, flags);
		const patterns: Array<[RegExp, Array<string>]> = [
			[/^a\/b$/, ['a/b', 'a\\/b']],
			[/"/, ['"', "'"]],
			[/^'\\'$/, ["'\\'", "''"]],
			[/^`\$\{x\}`$/, ['`${x}`', 'x']],
			[/\*\/ throw 0; \/\*/, ['*/ throw 0; /*', 'throw']],
			[/^\/\/$/, ['//', '/']],
			[/[\n\r]/, ['\n', 'n']],
			[of(`^[${LINE_SEPARATORS}]$`), [LINE_SEPARATORS[0]!, LINE_SEPARATORS[1]!, 'x']],
			[of('\n'), ['\n', '\\n']],
			[of('"\\); throw 0; \\("'), ['"); throw 0; ("', 'throw 0']],
			[of(''), ['', 'x']],
			[/^a$/i, ['A', 'b']],
			[/^.$/s, ['\n', 'ab']],
			[/^\p{L}$/u, ['é', '1']],
			[/^[\p{L}--[a-z]]$/v, ['é', 'a']],
			[/^a$/m, ['b\na', 'b']],
			[/^(?<year>\d{4})$/d, ['2026', '26']]
		];
		for (const [pattern, inputs] of patterns) {
			const schema = s.object({ a: s.pipe(s.string, s.regex(pattern)) });
			const text = to_guard_source(schema, 'guard');
			assert.notMatch(text, /[\u2028\u2029]/, String(pattern));
			assert.include(
				text,
				`new RegExp(${JSON.stringify(pattern.source).replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))}, ${JSON.stringify(pattern.flags)})`
			);
			const guard = await write(schema);
			for (const input of inputs) {
				assert.strictEqual(guard({ a: input }), pattern.test(input), `${pattern} on ${input}`);
			}
		}
	});

	test('with a g or a y flag the written regex keeps a lastIndex of its own, from 0', async () => {
		// declared: `regex` refuses a pattern with either flag, whose state a test
		// reads and writes, so the schema is one written by hand
		for (const flags of ['g', 'y']) {
			const pattern = new RegExp('a', flags);
			const schema = s.pipe(s.string, regex_of_any_flags(pattern));
			pattern.lastIndex = 1;
			assert.include(to_guard_source(schema, 'guard'), `new RegExp("a", "${flags}")`);
			const guard = await write(schema);
			assert.deepEqual([guard('a'), guard('a'), guard('a')], [true, false, true], flags);
			assert.strictEqual(pattern.lastIndex, 1, flags);
			assert.isFalse(s.is(schema, 'a'), flags);
		}
	});

	test('a regex that is more than its pattern is refused: a subclass, and one with a property of its own', () => {
		class Loud extends RegExp {
			override test(): boolean {
				return true;
			}
		}
		const with_test = /^a$/;
		with_test.test = () => true;
		const with_source = /^a$/;
		Object.defineProperty(with_source, 'source', { value: '^b$' });
		for (const pattern of [new Loud('^a$'), with_test, with_source]) {
			assert.throws(
				() => to_guard_source(s.object({ a: s.pipe(s.string, s.regex(pattern)) }), 'guard'),
				"cannot write `regex` at /def/a/def/1: it is run by a function, or holds a value, that can't be written as source"
			);
			// which the runtime guard captures as it is
			assert.isTrue(compile_guard(s.pipe(s.string, s.regex(with_test)))('zzz'));
		}
	});

	test('a Proxy of a regex is read through its own source and flags, and written as it says, which is declared', async () => {
		// a degenerate schema, which no bytes guard: `is` tests the target's pattern
		const lying = new Proxy(/^a$/, {
			get: (target, key) =>
				key === 'source'
					? '[^]*'
					: typeof (target as any)[key] === 'function'
						? (target as any)[key].bind(target)
						: (target as any)[key]
		});
		const schema = s.pipe(s.string, s.regex(lying));
		assert.include(to_guard_source(schema, 'guard'), 'const c0 = new RegExp("[^]*", "");\n');
		const guard = await write(schema);
		assert.deepEqual(
			[guard('zzz'), s.is(schema, 'zzz'), compile_guard(schema)('zzz')],
			[true, false, false]
		);
		// and one with no trap is refused as it is made, by the getter of a flag
		assert.throws(() => s.regex(new Proxy(/^a$/, {}), 'a pattern'), TypeError);
		// and in a schema made by hand it throws as `is` does, from the getter of `source`
		const bare = s.pipe(s.string, regex_of_any_flags(new Proxy(/^a$/, {})));
		assert.throws(() => to_guard_source(bare, 'guard'), TypeError);
		assert.throws(() => s.is(bare, 'a'), TypeError);
		// and what it says is written as a string, so its text stays a pattern and flags
		const hostile = '", 0), globalThis.PWNED = 1, ("';
		const lying_flags = new Proxy(/a/, {
			get: (target, key) =>
				key === 'flags' || key === 'source'
					? hostile
					: typeof (target as any)[key] === 'function'
						? (target as any)[key].bind(target)
						: (target as any)[key]
		});
		assert.include(
			to_guard_source(s.pipe(s.string, s.regex(lying_flags, 'a pattern')), 'guard'),
			`const c0 = new RegExp(${JSON.stringify(hostile)}, ${JSON.stringify(hostile)});\n`
		);
	});

	test("a regex that is a value of a literal or a one_of, and no regex's pattern, is refused", () => {
		const re = /x/;
		for (const [schema, kind, path] of [
			[s.literal(re as any), 'literal', '/'],
			[s.one_of([...Array.from({ length: 13 }, (_, i) => 'v' + i), re] as any), 'one_of', '/']
		] as const) {
			assert.throws(
				() => to_guard_source(schema as any, 'guard'),
				`cannot write \`${kind}\` at ${path}: it is run by a function, or holds a value, that can't be written as source`
			);
		}
	});
});

describe('what has no text is refused, by its kind and where it is', () => {
	const refusal = (kind: string, path: string): string =>
		`cannot write \`${kind}\` at ${path}: it is run by a function, or holds a value, that can't be written as source`;
	const own: s.AnySchema = { kind: 'own', def: undefined, run: (value: unknown) => value };

	test('a function a schema holds, and a schema run in place', () => {
		const keyed = s.keyed_record(s.string, s.number);
		const with_rest = s.object_with_rest({}, s.number);
		const cases: Array<[s.AnySchema, string, string]> = [
			[s.check(() => true), 'check', '/'],
			[
				s.object({
					a: s.pipe(
						s.string,
						s.check(() => true)
					)
				}),
				'check',
				'/def/a/def/1'
			],
			[
				s.object({
					a: s.pipe(
						s.string,
						s.min_length(1),
						s.transform((v) => v)
					)
				}),
				'transform',
				'/def/a/def/2'
			],
			[s.transform((v: unknown) => v), 'transform', '/'],
			[s.array(s.with_default_fn(s.number, () => 1)), 'with_default_fn', '/def'],
			[
				s.pipe(
					s.with_default_fn(s.number, () => 1),
					s.min_value(0)
				),
				'with_default_fn',
				'/def/0'
			],
			[own, 'own', '/'],
			// a discriminator that is no `literal` has no text as a `case`: refused
			// as the variant's, and not at the entry its option's body emitted last
			[
				s.object({
					v: s.variant('t', [
						s.object({ t: s.literal('a'), x: s.string }),
						s.object({ t: s.one_of(['b', 'c']), y: s.number })
					])
				}),
				'variant',
				'/def/v'
			],
			[s.object({ a: s.nullable(own) }), 'own', '/def/a/def/schema'],
			[s.lazy(() => s.union([own, s.string])), 'own', '/def()/def/0'],
			// a library kind whose `def` is not the kind's is run in place
			[{ kind: 'array', def: 5, run: s.array(s.string).run } as s.AnySchema, 'array', '/'],
			[{ kind: 'to_integer', def: 5, run: s.to_integer().run } as s.AnySchema, 'to_integer', '/'],
			// what a compiled guard runs by the schema's own `run`, under a pipe with a step after it
			[s.pipe(keyed, keyed), 'keyed_record', '/def/0'],
			[s.pipe(with_rest, with_rest), 'object_with_rest', '/def/0'],
			// and a default that is no primitive, where the next step is given it
			[s.pipe(s.with_default(s.array(s.string), []), s.min_length(0)), 'with_default', '/def/0'],
			[s.pipe(s.string, s.to_lower_case, s.one_of([{} as any, 'a'])), 'one_of', '/def/2']
		];
		for (const [schema, kind, path] of cases) {
			assert.throws(() => to_guard_source(schema, 'guard'), refusal(kind, path));
			// and each compiles to a runtime guard
			assert.doesNotThrow(() => compile_guard(schema));
		}
	});

	test('what compile_guard refuses is refused the same', () => {
		const walks: s.AnySchema = s.lazy(() =>
			s.union([
				s.object({ kids: s.array(walks), t: s.literal('a') }),
				s.object({ kids: s.array(walks), t: s.literal('b') })
			])
		);
		const twice: s.AnySchema = s.lazy(() =>
			s.pipe(s.object({ k: s.array(twice) }), s.loose_object({ k: s.array(twice) }) as any)
		);
		const endless = (): s.Schema => s.lazy(() => s.array(endless()));
		for (const make of [
			() => walks,
			() => twice,
			() => endless(),
			() => 5 as any,
			() => s.lazy(() => 5 as any)
		]) {
			let expected = '';
			try {
				compile_guard(make());
			} catch (error) {
				expected = (error as Error).message.replace(/(\/def\(\)\/def)+(\/def\(\))?/, '');
			}
			assert.isAbove(expected.length, 0);
			try {
				to_guard_source(make(), 'guard');
				assert.fail('written');
			} catch (error) {
				assert.strictEqual(
					(error as Error).message.replace(/(\/def\(\)\/def)+(\/def\(\))?/, ''),
					expected
				);
			}
		}
	});

	test('a schema with a format’s name and a run of its own is written as the library’s', async () => {
		// declared: a written module calls the library's action, by the kind and the `def`
		const schema = s.pipe(s.string, {
			kind: 'uuid',
			def: undefined,
			run: (v: unknown) => v
		});
		assert.isTrue(compile_guard(schema)('no uuid'));
		const guard = await write(schema);
		assert.isFalse(guard('no uuid'));
		assert.isTrue(guard(UUID));
	});
});
