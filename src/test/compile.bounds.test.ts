import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse, to_guard_source } from '#lib/compile.ts';
import * as scenario_schemas from '../benchmarks/libs/schemas/fuz_schema.ts';
import { COMPILE_UNBOUNDED_REFUSAL } from './compile_test_helpers.ts';

// The bound of compiled code, by counted work and never by time: a slice of
// an enumeration of small recursive schemas, each built with `union` and with
// `memo_union`, over inputs at two sizes. The work is the traps sprung on a
// `Proxy` of every array and object of the input. A `union` form is refused
// or it compiles, and what compiles grows no faster than the size of the
// input times its depth on a tree, in a guard, a parse that matches, and a
// parse that fails. A `memo_union` form always compiles, is held to the same,
// and on an input that holds one object in several places grows no faster
// than the interpreter's does.

const TRUE = (): boolean => true;

interface BoundsOption {
	id: string;
	/** The option's schema, `N` being what a child is read by and `i` the option's place. */
	make: (N: s.AnySchema, i: number) => s.AnySchema;
	/** A value the option matches, holding `children`, or one it refuses late. */
	node: (children: Array<unknown>, i: number, ok: boolean) => unknown;
	/** Whether it holds more than one child. */
	many: boolean;
}

const OTHER: s.AnySchema = s.lazy(() => s.loose_object({ x: s.array(OTHER) }));

const tagged = (
	id: string,
	make: (entries: Record<string, s.AnySchema>) => s.AnySchema,
	first = false
): BoundsOption => ({
	id,
	make: (N, i) =>
		make(
			first ? { t: s.literal('t' + i), x: s.array(N) } : { x: s.array(N), t: s.literal('t' + i) }
		),
	node: (children, i, ok) => ({ x: children, t: ok ? 't' + i : 'zz' }),
	many: true
});

const BOUNDS_OPTIONS: Array<BoundsOption> = [
	tagged('object, the literal last', s.object),
	tagged('object, the literal first', s.object, true),
	tagged('strip_object', s.strip_object),
	tagged('loose_object', s.loose_object),
	tagged('object in a pipe with a check', (entries) => s.pipe(s.object(entries), s.check(TRUE))),
	{
		id: 'object, no literal',
		make: (N) => s.object({ x: s.array(N) }),
		node: (children, _i, ok) => ({ x: children, ...(ok ? {} : { bad: 1 }) }),
		many: true
	},
	{
		id: 'object of one child',
		make: (N, i) => s.object({ x: s.optional(N), t: s.literal('t' + i) }),
		node: (children, i, ok) => ({
			...(children.length ? { x: children[0] } : {}),
			t: ok ? 't' + i : 'zz'
		}),
		many: false
	},
	{
		id: 'object of two children',
		make: (N, i) => s.object({ x: s.optional(N), y: s.optional(N), t: s.literal('t' + i) }),
		node: (children, i, ok) => ({
			...(children.length ? { x: children[0] } : {}),
			...(children.length > 1 ? { y: children[1] } : {}),
			t: ok ? 't' + i : 'zz'
		}),
		many: true
	},
	{ id: 'array', make: (N) => s.array(N), node: (children) => children, many: true },
	{
		id: 'record',
		make: (N) => s.record(N),
		node: (children) => Object.fromEntries(children.map((child, j) => ['k' + j, child])),
		many: true
	},
	{
		id: 'another recursive schema',
		make: () => OTHER,
		node: (children, _i, ok) => (ok ? { x: children } : { x: 'zz' }),
		many: true
	},
	{ id: 'leaf', make: () => s.number, node: () => 1, many: false }
];

type Union = (options: Array<s.AnySchema>) => s.AnySchema;

// the recursive schema of `options`, through one lazy or through two
const build_bounds = (options: Array<BoundsOption>, union: Union, lazies: number): s.AnySchema => {
	const made: Array<s.AnySchema> = [];
	const unions: Array<s.AnySchema> = [];
	for (let j = 0; j < lazies; j++) made.push(s.lazy(() => unions[j]!));
	for (let j = 0; j < lazies; j++) {
		unions.push(union(options.map((o, i) => o.make(made[(j + 1) % lazies]!, i))));
	}
	return made[0]!;
};

interface BoundsInput {
	family: string;
	dag: boolean;
	nodes: number;
	depth: number;
	value: unknown;
}

const depth_of = (value: unknown, seen: Map<object, number> = new Map()): number => {
	if (value === null || typeof value !== 'object') return 0;
	const known = seen.get(value);
	if (known !== undefined) return known;
	let deepest = 0;
	for (const key of Object.keys(value)) {
		deepest = Math.max(deepest, depth_of((value as any)[key], seen));
	}
	seen.set(value, deepest + 1);
	return deepest + 1;
};

// each family at a small size and a large one
const bounds_families = (options: Array<BoundsOption>): Array<[BoundsInput, BoundsInput]> => {
	const last = options.length - 1;
	let nodes = 0;
	const mk = (j: number, children: Array<unknown>, ok = true): unknown => {
		nodes++;
		const o = options[j]!;
		return o.node(o.many ? children : children.slice(0, 1), j, ok);
	};
	const chain = (
		d: number,
		pick: (level: number) => number,
		leaf?: unknown,
		spoiled = false
	): unknown => {
		let node: unknown = leaf === undefined ? mk(pick(d), [], !spoiled) : leaf;
		for (let level = d - 1; level >= 0; level--) node = mk(pick(level), [node], !spoiled);
		return node;
	};
	const tree = (d: number, pick: (level: number) => number, level = 0, spoil = false): unknown =>
		mk(
			pick(level),
			level < d ? [tree(d, pick, level + 1), tree(d, pick, level + 1)] : [],
			!(spoil && level === 0)
		);
	const dag = (d: number): unknown => {
		let node: unknown = mk(last, []);
		for (let level = 0; level < d; level++) node = mk(last, [node, node]);
		return node;
	};
	const out: Array<[BoundsInput, BoundsInput]> = [];
	const family = (
		name: string,
		is_dag: boolean,
		sizes: [number, number],
		make: (n: number) => unknown
	): void => {
		out.push(
			sizes.map((n): BoundsInput => {
				nodes = 0;
				const value = make(n);
				return {
					family: name,
					dag: is_dag,
					nodes: Math.max(nodes, 1),
					depth: Math.max(depth_of(value), 1),
					value
				};
			}) as [BoundsInput, BoundsInput]
		);
	};
	const CHAIN: [number, number] = [6, 24];
	const TREE: [number, number] = [2, 5];
	family('a chain of the first option', false, CHAIN, (d) => chain(d, () => 0));
	family('a chain of the last option', false, CHAIN, (d) => chain(d, () => last));
	family('a chain of the options in turn', false, CHAIN, (d) =>
		chain(d, (l) => l % options.length)
	);
	family('a chain whose deepest leaf matches nothing', false, CHAIN, (d) =>
		chain(d, () => last, true)
	);
	family('a chain whose every node fails late', false, CHAIN, (d) =>
		chain(d, () => last, undefined, true)
	);
	if (options.some((o) => o.many)) {
		family('a tree of the options in turn', false, TREE, (d) => tree(d, (l) => l % options.length));
		family('a tree whose root fails late', false, TREE, (d) => tree(d, () => last, 0, true));
	}
	if (options[last]!.many) family('each level held twice', true, [5, 14], dag);
	return out;
};

const CAPPED = {};
const counting = { ops: 0, cap: Infinity };
const count_op = (): void => {
	// eslint-disable-next-line @typescript-eslint/only-throw-error
	if (++counting.ops > counting.cap) throw CAPPED;
};
const COUNTING: ProxyHandler<object> = {
	get: (target, key, receiver) => (count_op(), Reflect.get(target, key, receiver)),
	has: (target, key) => (count_op(), Reflect.has(target, key)),
	ownKeys: (target) => (count_op(), Reflect.ownKeys(target)),
	getOwnPropertyDescriptor: (target, key) => (
		count_op(),
		Reflect.getOwnPropertyDescriptor(target, key)
	)
};

// `value` with every array and object of it a counting `Proxy`, one for each object
const wrap_counting = (value: unknown, seen: Map<object, object> = new Map()): unknown => {
	if (value === null || typeof value !== 'object') return value;
	const known = seen.get(value);
	if (known) return known;
	const copy: any = Array.isArray(value) ? [] : {};
	const proxy = new Proxy(copy, COUNTING);
	seen.set(value, proxy);
	for (const key of Object.keys(value)) copy[key] = wrap_counting((value as any)[key], seen);
	return proxy;
};

// the traps `fn` springs, `Infinity` past `cap`
const count_ops = (fn: () => unknown, cap: number): number => {
	counting.ops = 0;
	counting.cap = cap;
	try {
		fn();
		return counting.ops;
	} catch (error) {
		if (error === CAPPED) return Infinity;
		throw error;
	} finally {
		counting.cap = Infinity;
	}
};

type Growth = 'linear' | 'by the depth' | 'faster';
const GROWTHS: Array<Growth> = ['linear', 'by the depth', 'faster'];

// how the work for each node grows from the small input to the large one
const growth_of = (
	fn: (value: unknown) => unknown,
	[small, large]: [BoundsInput, BoundsInput]
): Growth => {
	const cap = (input: BoundsInput): number => 60 * input.nodes * input.depth + 2000;
	const a = count_ops(() => fn(wrap_counting(small.value)), cap(small)) / small.nodes;
	const b = count_ops(() => fn(wrap_counting(large.value)), cap(large)) / large.nodes;
	return b <= 1.6 * a + 4
		? 'linear'
		: b / large.depth <= (1.6 * a) / small.depth + 0.5
			? 'by the depth'
			: 'faster';
};

describe('the work of compiled code on recursive schemas, counted', () => {
	const configs: Array<[options: Array<BoundsOption>, lazies: number]> = [];
	for (const a of BOUNDS_OPTIONS) for (const b of BOUNDS_OPTIONS) configs.push([[a, b], 1]);
	for (const a of BOUNDS_OPTIONS.slice(0, 6)) {
		for (const b of BOUNDS_OPTIONS.slice(0, 6)) configs.push([[a, b], 2]);
	}
	for (const a of BOUNDS_OPTIONS.slice(0, 4)) {
		for (const b of BOUNDS_OPTIONS.slice(8)) configs.push([[a, b, BOUNDS_OPTIONS[1]!], 1]);
	}

	test('a union that compiles, and every memo_union, grows no faster than the size times the depth', () => {
		const broken: Array<string> = [];
		let refused = 0;
		let compiled = 0;
		let written = 0;
		// whether no option holds a function
		const union_would_write = (options: Array<BoundsOption>): boolean =>
			options.every((o) => !o.id.includes('check'));
		for (const [options, lazies] of configs) {
			const name = `${options.map((o) => o.id).join(' + ')}, through ${lazies}`;
			const of_memo = build_bounds(options, s.memo_union as Union, lazies);
			const of_union = build_bounds(options, s.union as Union, lazies);
			// a `memo_union` is never refused
			const memo_guard = compile_guard(of_memo);
			const memo_parse = compile_parse(of_memo);
			// and written, but where an option holds a function, which has no text
			try {
				to_guard_source(of_memo, 'guard');
				if (union_would_write(options)) written++;
			} catch (error) {
				// the check, or the `memo_union` a guard runs in place under the pipe that holds it
				assert.match((error as Error).message, /^cannot write `(check|union)` at /, name);
				assert.isFalse(union_would_write(options), name);
			}
			let union_guard: ((value: unknown) => unknown) | undefined;
			let union_parse: ((value: unknown) => unknown) | undefined;
			try {
				union_guard = compile_guard(of_union);
				union_parse = compile_parse(of_union);
				compiled++;
			} catch (error) {
				assert.match((error as Error).message, COMPILE_UNBOUNDED_REFUSAL, name);
				assert.throws(() => compile_parse(of_union), COMPILE_UNBOUNDED_REFUSAL, name);
				// a written guard is refused the same, in the same words
				assert.throws(() => to_guard_source(of_union, 'guard'), (error as Error).message, name);
				refused++;
			}
			for (const sizes of bounds_families(options)) {
				const at = `${name}, ${sizes[0].family}`;
				if (sizes[0].dag) {
					// what the interpreter's `memo_union` keeps on it, compiled code keeps
					for (const [compiled_fn, interpreted] of [
						[memo_guard, (v: unknown) => s.is(of_memo, v)],
						[memo_parse, (v: unknown) => s.parse(of_memo, v)]
					] as const) {
						const [ours, theirs] = [growth_of(compiled_fn, sizes), growth_of(interpreted, sizes)];
						if (GROWTHS.indexOf(ours) > GROWTHS.indexOf(theirs)) {
							broken.push(`${at}: compiled ${ours}, the interpreter ${theirs}`);
						}
					}
					continue;
				}
				const on_trees: Array<[string, ((value: unknown) => unknown) | undefined]> = [
					['guard of the memo_union', memo_guard],
					['parse of the memo_union', memo_parse],
					['guard of the union', union_guard],
					['parse of the union', union_parse]
				];
				for (const [of_fn, fn] of on_trees) {
					if (fn && growth_of(fn, sizes) === 'faster') broken.push(`${at}: ${of_fn}`);
				}
			}
		}
		assert.deepEqual(broken, []);
		// both happen: a union that is refused, and one that compiles
		assert.isAbove(refused, configs.length / 8);
		assert.isAbove(compiled, configs.length / 8);
		assert.isAbove(written, configs.length / 2);
	}, 60_000);

	test('what the test would see: the interpreter’s union on a refused schema grows faster', () => {
		const options = [BOUNDS_OPTIONS[0]!, BOUNDS_OPTIONS[0]!];
		const of_union = build_bounds(options, s.union as Union, 1);
		assert.throws(() => compile_guard(of_union), COMPILE_UNBOUNDED_REFUSAL);
		const growths = bounds_families(options)
			.filter(([small]) => !small.dag)
			.map((sizes) => growth_of((v) => s.is(of_union, v), sizes));
		assert.include(growths, 'faster');
		// and a size times the depth is told from linear: another recursive schema as an option
		const by_depth = [BOUNDS_OPTIONS[0]!, BOUNDS_OPTIONS[10]!];
		const of_memo = build_bounds(by_depth, s.memo_union as Union, 1);
		const seen = bounds_families(by_depth)
			.filter(([small]) => !small.dag)
			.map((sizes) => growth_of(compile_guard(of_memo), sizes));
		assert.include(seen, 'by the depth');
		assert.notInclude(seen, 'faster');
	});
});

describe('the depth of an input', () => {
	const nest = (depth: number, node: (child: unknown) => unknown, leaf: unknown): unknown => {
		let value = leaf;
		for (let i = 0; i < depth; i++) value = node(value);
		return value;
	};
	const attempt = (fn: () => unknown): unknown => {
		try {
			return fn();
		} catch (error) {
			return (error as Error).constructor.name;
		}
	};

	test('compiled code gives the interpreter’s answer where it runs out of stack first, and never throws where the interpreter answers', () => {
		// the benchmarks' recursive scenario, where compiled code runs out first,
		// and a small union, where the interpreter does
		const type_json: s.AnySchema = scenario_schemas.schema_type_json();
		const Tree: s.AnySchema = s.lazy(() => s.union([s.object({ x: s.array(Tree) }), s.number]));
		const array_of = (child: unknown): unknown => ({ kind: 'array', element: child });
		for (const [schema, node, leaf] of [
			[type_json, array_of, { kind: 'intrinsic', text: 'string' }],
			[type_json, array_of, { kind: 'bogus', text: 'string' }],
			[Tree, (child: unknown) => ({ x: [child] }), 1],
			[Tree, (child: unknown) => ({ x: [child] }), 'no']
		] as const) {
			const guard = compile_guard(schema);
			const parse = compile_parse(schema);
			let answered = 0;
			for (let depth = 250; depth <= 12_000; depth += 250) {
				const input = nest(depth, node, leaf);
				const expected = attempt(() => s.parse(schema, input));
				const expected_is = attempt(() => s.is(schema, input));
				// past where the interpreter throws, compiled code may answer or throw the same
				if (expected !== 'RangeError') {
					assert.deepEqual(
						attempt(() => parse(input)),
						expected,
						`parse at ${depth}`
					);
					answered++;
				}
				if (expected_is !== 'RangeError') {
					assert.strictEqual(
						attempt(() => guard(input)),
						expected_is,
						`guard at ${depth}`
					);
				}
				if (expected === 'RangeError' && expected_is === 'RangeError') {
					assert.include(
						['RangeError', true, false],
						attempt(() => guard(input))
					);
					break;
				}
			}
			assert.isAbove(answered, 0);
		}
	});

	// where the stack runs out moves with the engine, so the catch is held by a
	// RangeError a check throws
	test('a RangeError in compiled code is caught at the root, and the interpreter answers or throws its own', () => {
		let runs = 0;
		let throws: Array<Error | undefined> = [];
		const thrower = s.check(() => {
			const error = throws[runs++];
			if (error) throw error;
			return true;
		});
		const Tree: s.AnySchema = s.lazy(() => s.object({ c: thrower, kids: s.array(Tree) }));
		// and a kind of one's own, run in place, with no lazy around it
		const Own: s.AnySchema = {
			kind: 'thrower',
			def: undefined,
			run: (value: unknown) => {
				const error = throws[runs++];
				if (error) throw error;
				return value;
			}
		};
		const Holder = s.object({ kids: Own });
		const input = { kids: [] };
		const cases: Array<[(value: unknown) => unknown, unknown]> = [
			[compile_guard(Tree), true],
			[compile_parse(Tree), { ok: true, value: input }],
			[compile_guard(Holder), true],
			[compile_parse(Holder), { ok: true, value: input }]
		];
		// declared: a `RangeError` a function of the user's throws once is taken
		// for the stack's, so compiled code answers where the interpreter throws
		for (const schema of [Tree, Holder]) {
			runs = 0;
			throws = [new RangeError('once')];
			assert.throws(() => s.is(schema, input), 'once');
			runs = 0;
			assert.throws(() => s.parse(schema, input), 'once');
		}
		// and so is one a getter of the input throws once
		const getter_once = (): unknown => {
			let read = false;
			return {
				get kids() {
					if (!read) {
						read = true;
						throw new RangeError('a getter');
					}
					return [];
				}
			};
		};
		throws = [];
		runs = 0;
		assert.throws(() => s.is(Tree, getter_once()), 'a getter');
		assert.isTrue(compile_guard(Tree)(getter_once()));
		for (const [compiled, expected] of cases) {
			// once, in compiled code: the interpreter runs the check again, and answers
			runs = 0;
			throws = [new RangeError('once')];
			assert.deepEqual(compiled(input), expected);
			assert.strictEqual(runs, 2);
			// both times: the error is the one the interpreter met
			runs = 0;
			const second = new RangeError('twice');
			throws = [new RangeError('once'), second];
			try {
				compiled(input);
				assert.fail('no throw');
			} catch (error) {
				assert.strictEqual(error, second);
			}
			assert.strictEqual(runs, 2);
			// any other error is thrown as it is, and nothing is run again
			runs = 0;
			const other = new TypeError('other');
			throws = [other];
			try {
				compiled(input);
				assert.fail('no throw');
			} catch (error) {
				assert.strictEqual(error, other);
			}
			assert.strictEqual(runs, 1);
		}
	});
});
