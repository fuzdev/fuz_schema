import { runInNewContext } from 'node:vm';
import { inspect } from 'node:util';

import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { to_standard_schema } from '#lib/standard_schema.ts';
import { issues_of } from './schema_test_helpers.ts';

// a revoked `Proxy` throws on `Array.isArray`, which `fail` names `received` with and the
// containers check first: it is never accepted, only thrown on, see docs/declined.md
describe('a revoked Proxy', () => {
	const revoked = (target: object): object => {
		const { proxy, revoke } = Proxy.revocable(target, {});
		revoke();
		return proxy;
	};
	const targets: Array<[string, object]> = [
		['object', {}],
		['array', []],
		['function', () => {}]
	];
	const primitives: Array<s.AnySchema> = [
		s.string,
		s.number,
		s.literal('a'),
		s.one_of(['a', 1]),
		s.nullable(s.string),
		s.union([s.string, s.number]),
		s.pipe(s.string, s.min_length(1))
	];
	const containers: Array<s.AnySchema> = [
		s.object({ a: s.string }),
		s.array(s.string),
		s.record(s.string)
	];
	const assert_throws = (f: () => unknown, label: string): void => {
		let thrown: unknown;
		try {
			f();
		} catch (error) {
			thrown = error;
		}
		assert(thrown instanceof TypeError, label);
	};

	test('a primitive is false to is, and parse throws a TypeError', () => {
		for (const [name, target] of targets) {
			for (const schema of primitives) {
				const label = `${schema.kind} of a revoked ${name}`;
				assert.strictEqual(s.is(schema, revoked(target)), false, label);
				assert_throws(() => s.parse(schema, revoked(target)), label);
			}
		}
	});

	test('a container throws a TypeError in is and parse', () => {
		for (const [name, target] of targets) {
			for (const schema of containers) {
				const label = `${schema.kind} of a revoked ${name}`;
				assert_throws(() => s.parse(schema, revoked(target)), label);
				// a function is told from an object by `typeof` first, and only `array` checks it
				// with `Array.isArray`
				if (name === 'function' && schema.kind !== 'array') {
					assert.strictEqual(s.is(schema, revoked(target)), false, label);
				} else {
					assert_throws(() => s.is(schema, revoked(target)), label);
				}
			}
		}
	});

	test('unknown accepts it', () => {
		for (const [name, target] of targets) {
			const proxy = revoked(target);
			assert(s.is(s.unknown, proxy), name);
			const result = s.parse(s.unknown, proxy);
			assert(result.ok, name);
			assert.strictEqual(result.value, proxy, name);
		}
	});
});

describe('parse_or_throw', () => {
	test('throws SchemaError listing every issue', () => {
		const O = s.strip_object({ a: s.string, b: s.array(s.number) });
		try {
			s.parse_or_throw(O, { a: 1, b: [1, null] });
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 2);
			assert.strictEqual(
				error.message,
				'a: expected string, received number\nb.1: expected number, received null'
			);
		}
	});
});

describe('issues', () => {
	const SECRET = 'hunter2-do-not-log';

	test('reports the first hundred failures, and counts the rest', () => {
		const result = s.parse(s.object({ a: s.array(s.string), b: s.string }), {
			a: Array.from({ length: 150 }, (_, i) => i),
			b: 1
		});
		assert(!result.ok);
		assert.strictEqual(result.issues.length, 100);
		assert.deepEqual(result.issues[99]!.path, ['a', 99]);
		// exactly a hundred failures build a hundred issues
		assert.strictEqual(issues_of(s.array(s.string), Array(100).fill(1)).length, 100);
		assert.strictEqual(issues_of(s.array(s.string), Array(99).fill(1)).length, 99);
		// the count goes on past the issues
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		s.array(s.string).run(Array(150).fill(1), ctx);
		assert.strictEqual(ctx.fails, 150);
		assert.strictEqual(ctx.issues!.length, 100);
		// in probe mode every failure is counted and none is built
		const probe: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
		for (let i = 0; i < 150; i++) s.fail(probe, 'x', 1);
		assert.strictEqual(probe.fails, 150);
		assert.strictEqual(probe.issues, undefined);
		assert(!s.is(s.array(s.string), Array(200).fill(1)));
		assert(s.is(s.array(s.string), Array(200).fill('a')));
		// a Standard Schema's issues are the same hundred
		const standard = to_standard_schema(s.array(s.string))['~standard'].validate(
			Array(150).fill(1)
		);
		assert('issues' in standard && standard.issues);
		assert.strictEqual(standard.issues.length, 100);
	});

	test('a child that crosses the hundredth issue has its key on the issues it built', () => {
		// each item fails twice at depth 2, so item 49 builds the 99th and the
		// 100th, item 50 none
		const Item = s.object({ x: s.object({ p: s.string, q: s.string }) });
		const input = Array.from({ length: 60 }, () => ({ x: { p: 1, q: 1 } }));
		const issues = issues_of(s.object({ items: s.array(Item) }), { items: input });
		assert.strictEqual(issues.length, 100);
		assert.deepEqual(issues[98]!.path, ['items', 49, 'x', 'p']);
		assert.deepEqual(issues[99]!.path, ['items', 49, 'x', 'q']);
		// one item straddles the cap: three issues each, the 34th builds one
		const Three = s.object({ p: s.string, q: s.string, r: s.string });
		const straddle = issues_of(s.array(Three), Array(40).fill({ p: 1, q: 1, r: 1 }));
		assert.strictEqual(straddle.length, 100);
		assert.deepEqual(straddle[99]!.path, [33, 'p']);
		assert.deepEqual(straddle[98]!.path, [32, 'r']);
		// an unknown key past the cap builds nothing, and one before it has its key
		const unknown = issues_of(s.object({ a: s.array(s.string) }), {
			a: Array(99).fill(1),
			b: 1,
			c: 1
		});
		assert.strictEqual(unknown.length, 100);
		assert.deepEqual(unknown[99]!.path, ['b']);
	});

	test('a union past the hundredth failure still tells a match from a miss', () => {
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
		s.array(s.string).run(Array(150).fill(1), ctx);
		const union = s.union([s.string, s.object({ k: s.string })]);
		union.run({ k: 'x' }, ctx);
		assert.strictEqual(ctx.fails, 150);
		union.run({ k: 1 }, ctx);
		assert.strictEqual(ctx.fails, 151);
		assert.strictEqual(ctx.probe, false);
		assert.strictEqual(ctx.issues!.length, 100);
	});

	test('past the hundredth issue a message, a union, and parse_or_throw see only the issues built', () => {
		const seen: Array<Array<PropertyKey>> = [];
		const Labeled = s.message(s.object({ p: s.string, q: s.string }), (issue) => {
			seen.push(issue.path);
			return 'm';
		});
		const S = s.object({
			a: s.array(s.string),
			b: Labeled,
			c: s.union([s.string, s.number]),
			d: s.memo_union([s.array(s.string), s.string])
		});
		const input = { a: Array(99).fill(1), b: { p: 1, q: 1 }, c: true, d: [1] };
		const issues = issues_of(S, input);
		assert.strictEqual(issues.length, 100);
		// the message labeled the one of its two issues that was built
		assert.deepEqual(seen, [['p']]);
		assert.deepEqual(issues[99], {
			kind: 'string',
			expected: 'string',
			received: 'number',
			path: ['b', 'p'],
			message: 'm'
		});
		const matched = s.parse(s.object({ a: s.array(s.string), c: s.union([s.string, s.number]) }), {
			a: Array(120).fill(1),
			c: 1
		});
		assert(!matched.ok);
		assert.strictEqual(matched.issues.length, 100);
		const unmatched = s.parse(
			s.object({ a: s.array(s.string), c: s.union([s.string, s.number]) }),
			{ a: Array(120).fill(1), c: true }
		);
		assert(!unmatched.ok);
		assert.strictEqual(unmatched.issues.length, 100);
		try {
			s.parse_or_throw(S, input);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 100);
			assert.deepEqual(error.issues[99]!.path, ['b', 'p']);
		}
	});

	test("a SchemaError's message lists the first ten issues and counts the rest", () => {
		const message_of = (count: number): string => {
			try {
				s.parse_or_throw(s.array(s.string), Array(count).fill(1));
			} catch (error) {
				assert(error instanceof s.SchemaError);
				return error.message;
			}
			throw Error('expected a throw');
		};
		const lines = (count: number): Array<string> =>
			Array.from({ length: count }, (_, i) => `${i}: expected string, received number`);
		assert.deepEqual(message_of(9).split('\n'), lines(9));
		assert.deepEqual(message_of(10).split('\n'), lines(10));
		assert.deepEqual(message_of(11).split('\n'), [...lines(10), 'and 1 more']);
		// the count is of the issues built
		assert.deepEqual(message_of(150).split('\n'), [...lines(10), 'and 90 more']);
		// a long key many issues share is in ten lines, not one per issue
		const key = 'k'.repeat(10_000);
		try {
			s.parse_or_throw(s.record(s.array(s.string)), { [key]: Array(100).fill(1) });
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 100);
			assert.isBelow(error.message.length, 11 * (key.length + 40));
			assert.strictEqual(error.message.split('\n').length, 11);
		}
		// one issue is its line alone
		assert.strictEqual(
			new s.SchemaError(issues_of(s.string, 1)).message,
			'expected string, received number'
		);
	});

	test('a path is outermost first at any depth, from parse and parse_or_throw', () => {
		const Node: s.AnySchema = s.lazy(() =>
			s.object({ c: s.optional(Node), xs: s.array(s.string) })
		);
		let input: unknown = { xs: [1, 'a', 2] };
		for (let i = 0; i < 50; i++) input = { c: input, xs: [] };
		const deep = Array.from({ length: 50 }, () => 'c');
		const expected = [
			[...deep, 'xs', 0],
			[...deep, 'xs', 2]
		];
		assert.deepEqual(
			issues_of(Node, input).map((i) => i.path),
			expected
		);
		try {
			s.parse_or_throw(Node, input);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.deepEqual(
				error.issues.map((i) => i.path),
				expected
			);
			// the message is written from the paths as they are returned
			assert.strictEqual(error.message, error.issues.map(s.format_issue).join('\n'));
		}
		// a function under the spine is handed the path below it
		const seen: Array<Array<PropertyKey>> = [];
		const Labeled = s.object({
			c: s.message(Node, (issue) => {
				seen.push(issue.path);
				return 'x';
			})
		});
		const labeled = issues_of(Labeled, { c: input });
		assert.deepEqual(seen, expected);
		assert.deepEqual(
			labeled.map((i) => i.path),
			expected.map((path) => ['c', ...path])
		);
	});

	test('a message function is handed a copy of the five fields, which it cannot change', () => {
		const handed: Array<s.SchemaIssue> = [];
		const Labeled = s.object({
			a: s.message(s.object({ b: s.array(s.string) }), (issue) => {
				handed.push(issue);
				issue.path.push('x');
				issue.expected = 'changed';
				return 'm';
			})
		});
		const issues = issues_of(Labeled, { a: { b: ['ok', 1] } });
		assert.strictEqual(handed.length, 1);
		assert.deepEqual(Object.keys(handed[0]!), ['kind', 'expected', 'received', 'path', 'message']);
		assert.notStrictEqual(handed[0], issues[0]);
		assert.deepEqual(issues, [
			{ kind: 'string', expected: 'string', received: 'number', path: ['a', 'b', 1], message: 'm' }
		]);
	});

	// every value reachable through own properties, for checking what a result holds
	const reachable = (root: unknown): Set<unknown> => {
		const seen: Set<unknown> = new Set();
		const visit = (value: unknown): void => {
			if (seen.has(value)) return;
			seen.add(value);
			if (typeof value !== 'object' || value === null) return;
			for (const key of Reflect.ownKeys(value)) visit((value as any)[key]);
		};
		visit(root);
		return seen;
	};

	const failing: Array<[name: string, schema: s.AnySchema, input: unknown]> = [
		['the root', s.number, SECRET],
		['an object root', s.string, { password: SECRET }],
		['an array root', s.string, [SECRET]],
		['an entry', s.object({ password: s.number }), { password: SECRET }],
		['an unknown key', s.object({}), { extra: SECRET }],
		['a record value', s.record(s.number), { a: SECRET }],
		['an array item', s.array(s.number), [SECRET]],
		['a union', s.union([s.number, s.boolean]), SECRET],
		[
			'a variant discriminator',
			s.variant('kind', [s.object({ kind: s.literal('a') })]),
			{
				kind: SECRET
			}
		],
		[
			'a variant option',
			s.variant('kind', [s.object({ kind: s.literal('a'), x: s.number })]),
			{
				kind: 'a',
				x: SECRET
			}
		],
		['a literal', s.literal('x'), SECRET],
		['a one_of', s.one_of(['x', 'y']), SECRET],
		['an action', s.pipe(s.string, s.max_length(3)), SECRET],
		['a regex', s.pipe(s.string, s.regex(/^\d+$/)), SECRET],
		[
			'a check',
			s.pipe(
				s.string,
				s.check((v) => v === 'x')
			),
			SECRET
		],
		[
			'a transformed value',
			s.pipe(
				s.string,
				s.transform((v: string) => v + v),
				s.max_length(3)
			),
			SECRET
		],
		['a wrapper', s.optional(s.nullable(s.with_default(s.number, 0))), SECRET],
		['a lazy schema', s.lazy(() => s.number), SECRET],
		['a schema with a message', s.message(s.number, 'not a number'), SECRET],
		['a strip_object', s.strip_object({ a: s.number }), { a: SECRET, extra: SECRET }],
		['a loose_object', s.loose_object({ a: s.number }), { a: SECRET, extra: SECRET }]
	];

	test('a path is outermost first at every depth, through every container', () => {
		const Leaf = s.variant('t', [
			s.object({ t: s.literal('a'), v: s.string }),
			s.object({ t: s.literal('b'), v: s.number })
		]);
		const Deep = s.object({
			top: s.string,
			list: s.array(s.record(s.strip_object({ inner: s.loose_object({ leaves: s.array(Leaf) }) })))
		});
		const input = {
			top: 1,
			list: [
				1,
				{ k: 1, m: { inner: { leaves: [{ t: 'a', v: 1 }, { t: 'c' }, { t: 'b', v: 'x', w: 1 }] } } }
			]
		};
		assert.deepEqual(
			issues_of(Deep, input).map((i) => [i.kind, i.path]),
			[
				['string', ['top']],
				['record', ['list', 0]],
				['strip_object', ['list', 1, 'k']],
				['string', ['list', 1, 'm', 'inner', 'leaves', 0, 'v']],
				['variant', ['list', 1, 'm', 'inner', 'leaves', 1, 't']],
				['number', ['list', 1, 'm', 'inner', 'leaves', 2, 'v']],
				['unknown_key', ['list', 1, 'm', 'inner', 'leaves', 2, 'w']]
			]
		);
		assert.deepEqual(
			issues_of(s.array(s.array(s.string)), [['a', 1], [2]]).map((i) => i.path),
			[
				[0, 1],
				[1, 0]
			]
		);
		assert.deepEqual(issues_of(s.record(s.string), { a: 1 })[0]!.path, ['a']);
	});

	test('every issue has a path array of its own', () => {
		const O = s.object({
			a: s.string,
			b: s.object({ c: s.string, d: s.array(s.number) }),
			e: s.record(s.string)
		});
		const input = { a: 1, b: { c: 1, d: ['x', 'y'], z: 1 }, e: { f: 1, g: 2 } };
		const expected = [
			['a'],
			['b', 'c'],
			['b', 'd', 0],
			['b', 'd', 1],
			['b', 'z'],
			['e', 'f'],
			['e', 'g']
		];
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((i) => i.path),
			expected
		);
		assert.strictEqual(new Set(issues.map((i) => i.path)).size, issues.length);
		// writing to one path changes no other
		for (const issue of issues) issue.path.push('written');
		assert.deepEqual(
			issues.map((i) => i.path),
			expected.map((path) => [...path, 'written'])
		);
		// the issues at the root too, which no container prefixed
		const [first, second] = [issues_of(s.string, 1)[0]!, issues_of(s.string, 2)[0]!];
		assert.notStrictEqual(first.path, second.path);
		first.path.push('written');
		assert.deepEqual(second.path, []);
	});

	test('a path is replaced as it grows, so one a message function keeps stays empty', () => {
		const kept: Array<Array<PropertyKey>> = [];
		const Leaf = s.message(s.string, (issue) => {
			kept.push(issue.path);
			return 'text';
		});
		const issues = issues_of(s.object({ a: s.array(Leaf) }), { a: [1, 2] });
		assert.deepEqual(
			issues.map((i) => [i.message, i.path]),
			[
				['text', ['a', 0]],
				['text', ['a', 1]]
			]
		);
		assert.deepEqual(kept, [[], []]);
	});

	test('an issue is kind, expected, received, path, and message, in that order', () => {
		for (const [name, schema, input] of failing) {
			for (const issue of issues_of(schema, input)) {
				assert.deepEqual(
					Object.keys(issue),
					['kind', 'expected', 'received', 'path', 'message'],
					name
				);
				assert.typeOf(issue.received, 'string', name);
			}
		}
	});

	test('received names the type of the value that failed', () => {
		const Never = s.literal('never');
		const values: Array<[value: unknown, received: string]> = [
			[null, 'null'],
			[[], 'array'],
			[[1], 'array'],
			[{}, 'object'],
			[new Date(0), 'object'],
			[undefined, 'undefined'],
			['a', 'string'],
			[1, 'number'],
			[-0, 'number'],
			[Number.MAX_VALUE, 'number'],
			[NaN, 'NaN'],
			[Infinity, 'Infinity'],
			[-Infinity, '-Infinity'],
			[Object(NaN), 'object'],
			[true, 'boolean'],
			[1n, 'bigint'],
			[Symbol('a'), 'symbol'],
			[() => 1, 'function']
		];
		for (const [value, received] of values) {
			const issue = issues_of(Never, value)[0]!;
			assert.strictEqual(issue.received, received);
			// `get_issue_value` names types the same way, or it would refuse
			assert.deepEqual(s.get_issue_value(issue, value), { ok: true, value });
		}
		assert.strictEqual(issues_of(s.number, NaN)[0]!.received, 'NaN');
		// a value of another type is refused by its type, a non-finite number by its value
		assert.deepEqual(s.get_issue_value(issues_of(Never, NaN)[0]!, Infinity), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, Infinity)[0]!, -Infinity), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, Infinity)[0]!, 1), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, 1)[0]!, NaN), { ok: false });
		assert.deepEqual(s.get_issue_value(issues_of(Never, '')[0]!, NaN), { ok: false });
		assert.strictEqual(issues_of(s.object({ a: s.string }), {})[0]!.received, 'undefined');
	});

	test('a number that is not finite is received as String writes it, wherever it fails', () => {
		const cases: Array<[schema: s.AnySchema, value: unknown, text: string]> = [
			[s.string, NaN, 'expected string, received NaN'],
			[s.boolean, Infinity, 'expected boolean, received Infinity'],
			[s.bigint, -Infinity, 'expected bigint, received -Infinity'],
			[s.integer, Infinity, 'expected integer, received Infinity'],
			[s.integer, NaN, 'expected integer, received NaN'],
			[s.safe_integer, -Infinity, 'expected safe_integer, received -Infinity'],
			[s.min_value(0), NaN, 'expected >= 0, received NaN'],
			[s.min_value(0), -Infinity, 'expected >= 0, received -Infinity'],
			[s.max_value(0), Infinity, 'expected <= 0, received Infinity'],
			[s.literal(1), NaN, 'expected 1, received NaN'],
			[s.literal(Infinity), -Infinity, 'expected Infinity, received -Infinity'],
			[s.one_of([1, 'a']), Infinity, 'expected 1 | "a", received Infinity'],
			[s.union([s.string, s.number]), NaN, 'expected string | number, received NaN'],
			[s.array(s.number), [1, NaN], '1: expected number, received NaN'],
			[s.object({ a: s.number }), { a: -Infinity }, 'a: expected number, received -Infinity'],
			[s.record(s.string), { a: Infinity }, 'a: expected string, received Infinity'],
			[s.array(s.string), NaN, 'expected array, received NaN'],
			[s.object({}), Infinity, 'expected object, received Infinity'],
			[s.check(() => false, 'finite'), NaN, 'expected finite, received NaN'],
			[
				s.variant('k', [s.object({ k: s.literal('a') })]),
				{ k: NaN },
				'k: expected "a", received NaN'
			],
			[s.pipe(s.number, s.integer), Infinity, 'expected number, received Infinity']
		];
		for (const [schema, value, text] of cases) {
			const issues = issues_of(schema, value);
			assert.deepEqual(issues.map(s.format_issue), [text], text);
			// and the value is read back by it
			assert.deepEqual(s.get_issue_value(issues[0]!, value), {
				ok: true,
				value: issues[0]!.path.reduce((v: any, key) => v[key], value)
			});
		}
		// as Standard Schema writes it too
		const result = to_standard_schema(s.number)['~standard'].validate(-Infinity);
		assert(!(result instanceof Promise) && result.issues);
		assert.strictEqual(result.issues[0]!.message, 'expected number, received -Infinity');
		// a finite number, and a boxed one, are received by their type
		assert.strictEqual(issues_of(s.string, Number.MAX_VALUE)[0]!.received, 'number');
		assert.strictEqual(issues_of(s.string, -Number.MIN_VALUE)[0]!.received, 'number');
		assert.strictEqual(issues_of(s.string, Object(Infinity))[0]!.received, 'object');
	});

	test('nothing in a failed result or a SchemaError holds the input', () => {
		for (const [name, schema, input] of failing) {
			const result = s.parse(schema, input);
			assert(!result.ok, name);
			let error: unknown;
			try {
				s.parse_or_throw(schema, input);
			} catch (thrown) {
				error = thrown;
			}
			assert(error instanceof s.SchemaError, name);
			const texts = [
				JSON.stringify(result),
				JSON.stringify(result.issues),
				result.issues.map(s.format_issue).join('\n'),
				error.message,
				String(error),
				error.stack ?? '',
				JSON.stringify(error),
				inspect(error, { depth: null, showHidden: true, getters: true }),
				inspect(result, { depth: null, showHidden: true, getters: true })
			];
			for (const text of texts) assert.notInclude(text, SECRET, name);
			for (const held of [...reachable(result), ...reachable(error)]) {
				assert.notStrictEqual(held, input, name);
				assert.notStrictEqual(held, SECRET, name);
				if (typeof held === 'string') assert.notInclude(held, SECRET, name);
			}
		}
	});

	test('a path holds the keys the input named', () => {
		const issues = issues_of(s.object({ known: s.record(s.number) }), {
			known: { 'a.b': 'x' },
			'not known': 1
		});
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path]),
			[
				['number', ['known', 'a.b']],
				['unknown_key', ['not known']]
			]
		);
	});

	test('received sees through realms and proxies, and not into objects', () => {
		const Never = s.literal('never');
		const values: Array<[value: unknown, received: string]> = [
			[runInNewContext('[1]'), 'array'],
			[new Proxy([], {}), 'array'],
			[new Proxy({}, {}), 'object'],
			[Object('a'), 'object'],
			[Object.create(null), 'object'],
			[new Map(), 'object'],
			[new Uint8Array(1), 'object'],
			[{ length: 0 }, 'object'],
			[Symbol, 'function']
		];
		for (const [value, received] of values) {
			assert.strictEqual(issues_of(Never, value)[0]!.received, received);
		}
	});

	test('a SchemaError has its issues and nothing else of its own', () => {
		try {
			s.parse_or_throw(s.string, 1);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.deepEqual(
				Reflect.ownKeys(error)
					.map(String)
					.sort((a, b) => a.localeCompare(b)),
				['issues', 'message', 'name', 'stack']
			);
			assert.strictEqual(error.cause, undefined);
		}
	});

	test('a message function can put the value in an issue, and only it can', () => {
		const SECRET = 'hunter2-do-not-log';
		const Quiet = s.object({ password: s.message(s.number, (issue) => `not a ${issue.expected}`) });
		const Loud = s.object({
			password: s.message(s.number, (_issue, value) => `got ${String(value)}`)
		});
		assert.notInclude(JSON.stringify(issues_of(Quiet, { password: SECRET })), SECRET);
		assert.include(JSON.stringify(issues_of(Loud, { password: SECRET })), SECRET);
		const result = to_standard_schema(Loud)['~standard'].validate({ password: SECRET });
		assert.include(JSON.stringify(result), SECRET);
	});
});

describe('format_issue', () => {
	const format_key = (key: string): string =>
		s.format_issue(issues_of(s.record(s.number), JSON.parse(JSON.stringify({ [key]: 'x' })))[0]!);

	test('writes keys of word characters as they are', () => {
		for (const key of ['a', 'a_1', 'A', '_', '0', '12', '__proto__']) {
			assert.strictEqual(format_key(key), `${key}: expected number, received string`);
		}
		const Nested = s.object({ list: s.array(s.object({ id: s.number })) });
		assert.strictEqual(
			s.format_issue(issues_of(Nested, { list: [{ id: 1 }, { id: 'x' }] })[0]!),
			'list.1.id: expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(s.string, 1)[0]!),
			'expected string, received number'
		);
	});

	test('quotes any other key as JSON', () => {
		const quoted: Array<[key: string, text: string]> = [
			['a.b', '"a.b"'],
			['', '""'],
			['a b', '"a b"'],
			['a-b', '"a-b"'],
			['$id', '"$id"'],
			['é', '"é"'],
			['"a"', '"\\"a\\""'],
			['a: expected string, received number', '"a: expected string, received number"'],
			['a\nb', '"a\\nb"'],
			['a\n', '"a\\n"'],
			['\na', '"\\na"'],
			['a\r\nb', '"a\\r\\nb"'],
			['a\\', '"a\\\\"']
		];
		for (const [key, text] of quoted) {
			assert.strictEqual(format_key(key), `${text}: expected number, received string`);
		}
		// a dotted key and a nested one read differently
		const R = s.record(s.record(s.number));
		assert.strictEqual(
			s.format_issue(issues_of(R, { 'a.b': { c: 'x' } })[0]!),
			'"a.b".c: expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(R, { a: { 'b.c': 'x' } })[0]!),
			'a."b.c": expected number, received string'
		);
		assert.strictEqual(
			s.format_issue(issues_of(R, { a: { b: 'x' } })[0]!),
			'a.b: expected number, received string'
		);
	});

	test('takes any property key', () => {
		const issue: s.SchemaIssue = {
			kind: 'x',
			expected: 'x',
			received: 'string',
			path: [Symbol('s'), 2, 1.5, -1, 'a'],
			message: undefined
		};
		assert.strictEqual(
			s.format_issue(issue),
			'"Symbol(s)".2."1.5"."-1".a: expected x, received string'
		);
	});

	test('a key cannot add a line to a SchemaError', () => {
		const forged = 'a: expected string, received number\nb';
		const input = JSON.parse(JSON.stringify({ [forged]: 1, c: 2 }));
		try {
			s.parse_or_throw(s.object({}), input);
			assert.fail('expected a throw');
		} catch (error) {
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 2);
			assert.deepEqual(error.message.split('\n'), [
				'"a: expected string, received number\\nb": expected no unknown keys, received number',
				'c: expected no unknown keys, received number'
			]);
		}
	});

	test('uses the text set by message as it is', () => {
		const O = s.object({ 'a.b': s.message(s.string, 'line one\nline two') });
		assert.strictEqual(s.format_issue(issues_of(O, {})[0]!), '"a.b": line one\nline two');
	});

	test('an index and a key of the same digits read the same', () => {
		const to_issue = (path: Array<PropertyKey>): s.SchemaIssue => ({
			kind: 'x',
			expected: 'x',
			received: 'string',
			path,
			message: undefined
		});
		assert.strictEqual(s.format_issue(to_issue([0])), s.format_issue(to_issue(['0'])));
	});

	test('quotes a key with a Unicode line or paragraph separator, which JSON leaves as it is', () => {
		// JSON.stringify escapes the C0 controls and not U+2028, U+2029, or U+0085,
		// so such a key is quoted and still holds the character
		for (const separator of ['\u2028', '\u2029', '\u0085']) {
			const key = `a${separator}b`;
			const text = s.format_issue(issues_of(s.record(s.number), { [key]: 'x' })[0]!);
			assert.strictEqual(text, `"${key}": expected number, received string`);
			assert.strictEqual(text.split('\n').length, 1);
		}
	});
});

describe('get_issue_value', () => {
	const NOT_FOUND = { ok: false };

	const value_of = (schema: s.AnySchema, input: unknown, index = 0): unknown =>
		s.get_issue_value(issues_of(schema, input)[index]!, input);

	const to_issue = (path: Array<PropertyKey>, received: string): s.SchemaIssue => ({
		kind: 'x',
		expected: 'x',
		received,
		path,
		message: undefined
	});

	test('finds the root with an empty path', () => {
		assert.deepEqual(value_of(s.string, 1), { ok: true, value: 1 });
		assert.deepEqual(value_of(s.string, undefined), { ok: true, value: undefined });
		assert.deepEqual(value_of(s.string, null), { ok: true, value: null });
		const input = { a: 1 };
		const found = s.get_issue_value(issues_of(s.string, input)[0]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, input);
	});

	test('finds the value of every issue of a parse', () => {
		const O = s.object({
			name: s.string,
			tags: s.array(s.string),
			by_id: s.record(s.object({ n: s.number })),
			shape: s.variant('kind', [s.object({ kind: s.literal('a') })]),
			either: s.union([s.string, s.number])
		});
		const nested = { n: 'x' };
		const either = { not: 'either' };
		const input = {
			name: 1,
			tags: ['a', 2, null],
			by_id: { first: nested, second: { n: 1 } },
			shape: { kind: 'line' },
			either,
			extra: [3]
		};
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((issue) => [issue.path, s.get_issue_value(issue, input)]),
			[
				[['name'], { ok: true, value: 1 }],
				[['tags', 1], { ok: true, value: 2 }],
				[['tags', 2], { ok: true, value: null }],
				[['by_id', 'first', 'n'], { ok: true, value: 'x' }],
				[['shape', 'kind'], { ok: true, value: 'line' }],
				[['either'], { ok: true, value: either }],
				[['extra'], { ok: true, value: [3] }]
			]
		);
		const found = s.get_issue_value(issues[5]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, either);
	});

	test('finds a missing key as undefined, which is what the schema saw', () => {
		const O = s.object({ name: s.string });
		assert.strictEqual(issues_of(O, {})[0]!.received, 'undefined');
		assert.deepEqual(value_of(O, {}), { ok: true, value: undefined });
		assert.deepEqual(value_of(O, { name: undefined }), { ok: true, value: undefined });
		// and one an `unknown` entry needs, whose issue is a `missing_key`
		const U = s.object({ a: s.object({ name: s.unknown }) });
		assert.strictEqual(issues_of(U, { a: {} })[0]!.kind, 'missing_key');
		assert.deepEqual(issues_of(U, { a: {} })[0]!.path, ['a', 'name']);
		assert.deepEqual(value_of(U, { a: {} }), { ok: true, value: undefined });
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		assert.deepEqual(issues_of(V, {})[0]!.path, ['kind']);
		assert.deepEqual(value_of(V, {}), { ok: true, value: undefined });
		// a hole in an array
		assert.deepEqual(value_of(s.array(s.number), new Array(1)), { ok: true, value: undefined });
	});

	test('finds an unknown key by the last element of its path', () => {
		const O = s.object({ a: s.object({}) });
		const input = { a: { extra: 5 } };
		const issue = issues_of(O, input)[0]!;
		assert.strictEqual(issue.kind, 'unknown_key');
		assert.deepEqual(issue.path, ['a', 'extra']);
		assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: 5 });
	});

	test('refuses when the path leads through something that is not an object', () => {
		const issue = to_issue(['a', 'b'], 'undefined');
		assert.deepEqual(s.get_issue_value(issue, { a: {} }), { ok: true, value: undefined });
		for (const input of [
			{},
			{ a: undefined },
			{ a: null },
			{ a: 'text' },
			{ a: 1 },
			{ a: () => 1 },
			null,
			undefined,
			'ab',
			1
		]) {
			assert.deepEqual(s.get_issue_value(issue, input), NOT_FOUND);
		}
		// through an array, by index
		assert.deepEqual(s.get_issue_value(to_issue([1, 'b'], 'number'), [{}, { b: 2 }]), {
			ok: true,
			value: 2
		});
		assert.deepEqual(s.get_issue_value(to_issue([2, 'b'], 'undefined'), [{}, { b: 2 }]), NOT_FOUND);
	});

	test('refuses when the value is not of the type the issue received', () => {
		const O = s.object({ a: s.string });
		const issue = issues_of(O, { a: 1 })[0]!;
		for (const input of [{ a: 'x' }, { a: null }, { a: [1] }, { a: { b: 1 } }, {}, { b: 1 }, [1]]) {
			assert.deepEqual(s.get_issue_value(issue, input), NOT_FOUND);
		}
		// a `pipe` step that changed the type before the one that failed
		const Count = s.pipe(
			s.string,
			s.transform((v: string) => Number(v)),
			s.min_value(5)
		);
		assert.strictEqual(issues_of(Count, '1')[0]!.received, 'number');
		assert.deepEqual(value_of(Count, '1'), NOT_FOUND);
		assert.deepEqual(value_of(s.object({ count: Count }), { count: '1' }), NOT_FOUND);
		// a default applied before the step that failed
		const Name = s.pipe(s.with_default(s.string, ''), s.min_length(1));
		assert.deepEqual(value_of(Name, undefined), NOT_FOUND);
		assert.deepEqual(value_of(s.object({ name: Name }), {}), NOT_FOUND);
	});

	test('cannot tell a value from another of the same type', () => {
		// a step that replaced the value with one of its own type: the issue is
		// about the replacement, and what comes back is the input's value
		const Trimmed = s.pipe(
			s.string,
			s.transform((v: string) => v.trim()),
			s.min_length(1)
		);
		assert.deepEqual(value_of(Trimmed, '  '), { ok: true, value: '  ' });
		const Stripped = s.pipe(
			s.strip_object({ a: s.number }),
			s.check((v) => Object.keys(v).length > 1)
		);
		const input = { a: 1, extra: 2 };
		const found = s.get_issue_value(issues_of(Stripped, input)[0]!, input);
		assert(found.ok);
		assert.strictEqual(found.value, input);
		// and an input other than the one parsed
		const issue = issues_of(s.object({ a: s.string }), { a: 1 })[0]!;
		assert.deepEqual(s.get_issue_value(issue, { a: 2 }), { ok: true, value: 2 });
	});

	test('reads own keys only, so an inherited value is never returned', () => {
		// the schema reads through the prototype, and the walk doesn't
		const inherits = Object.create({ a: 1, extra: 2 });
		const issues = issues_of(s.object({ a: s.string }), inherits);
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path, i.received]),
			[
				['string', ['a'], 'number'],
				['unknown_key', ['extra'], 'number']
			]
		);
		for (const issue of issues) assert.deepEqual(s.get_issue_value(issue, inherits), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['toString'], 'function'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['constructor'], 'function'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue(['length'], 'number'), 'abc'), NOT_FOUND);
		// an own key of an array that is not an index is still its own
		assert.deepEqual(s.get_issue_value(to_issue(['length'], 'number'), [1, 2]), {
			ok: true,
			value: 2
		});
	});

	test('reads a __proto__ key only where the input has one of its own', () => {
		const input = JSON.parse('{"__proto__": 1, "a": {"__proto__": {"b": 2}}}');
		assert.deepEqual(value_of(s.record(s.string), input), { ok: true, value: 1 });
		const unknown = issues_of(s.object({ a: s.unknown }), input)[0]!;
		assert.deepEqual(unknown.path, ['__proto__']);
		assert.deepEqual(s.get_issue_value(unknown, input), { ok: true, value: 1 });
		assert.deepEqual(s.get_issue_value(to_issue(['a', '__proto__', 'b'], 'number'), input), {
			ok: true,
			value: 2
		});
		// an object without one: the schema read `Object.prototype`, and the walk refuses
		const Proto = s.loose_object({ ['__proto__']: s.string });
		const issue = issues_of(Proto, {})[0]!;
		assert.deepEqual([issue.path, issue.received], [['__proto__'], 'object']);
		assert.deepEqual(s.get_issue_value(issue, {}), NOT_FOUND);
		assert.deepEqual(
			s.get_issue_value(to_issue(['__proto__', 'polluted'], 'undefined'), {}),
			NOT_FOUND
		);
		assert.strictEqual(({} as any).polluted, undefined);
	});

	test('takes any property key', () => {
		const sym = Symbol('s');
		assert.deepEqual(s.get_issue_value(to_issue([sym], 'number'), { [sym]: 1 }), {
			ok: true,
			value: 1
		});
		assert.deepEqual(s.get_issue_value(to_issue([sym], 'number'), {}), NOT_FOUND);
		assert.deepEqual(s.get_issue_value(to_issue([0], 'string'), { 0: 'a' }), {
			ok: true,
			value: 'a'
		});
		assert.deepEqual(s.get_issue_value(to_issue(['0'], 'string'), ['a']), { ok: true, value: 'a' });
		assert.deepEqual(s.get_issue_value(to_issue([1.5], 'string'), { '1.5': 'a' }), {
			ok: true,
			value: 'a'
		});
		assert.deepEqual(s.get_issue_value(to_issue([-1], 'string'), ['a']), NOT_FOUND);
	});

	test('leaves the input alone', () => {
		const input = Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) });
		const before = JSON.stringify(input);
		assert.deepEqual(s.get_issue_value(to_issue(['a', 0, 'b'], 'number'), input), {
			ok: true,
			value: 1
		});
		assert.deepEqual(s.get_issue_value(to_issue(['a', 0, 'c', 'd'], 'number'), input), NOT_FOUND);
		assert.strictEqual(JSON.stringify(input), before);
	});

	test('narrows on ok', () => {
		const found = s.get_issue_value(to_issue([], 'number'), 1);
		expectTypeOf(found).toEqualTypeOf<{ ok: true; value: unknown } | { ok: false }>();
		if (found.ok) expectTypeOf(found.value).toBeUnknown();
		// @ts-expect-error no value without checking `ok`
		assert.strictEqual(found.value, 1);
	});

	test('finds an inherited undefined as undefined, the one inherited read it answers', () => {
		const O = s.object({ a: s.string });
		const input = Object.create({ a: undefined, extra: undefined });
		const issues = issues_of(O, input);
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path, i.received]),
			[
				['string', ['a'], 'undefined'],
				['unknown_key', ['extra'], 'undefined']
			]
		);
		for (const issue of issues) {
			assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: undefined });
		}
	});

	test('refuses a discriminator the variant read through the prototype', () => {
		const V = s.variant('kind', [s.object({ kind: s.literal('a') })]);
		const input = Object.create({ kind: 'line' });
		const issue = issues_of(V, input)[0]!;
		assert.deepEqual([issue.path, issue.received], [['kind'], 'string']);
		assert.deepEqual(s.get_issue_value(issue, input), { ok: false });
	});

	test('a found undefined or null is always the value that failed', () => {
		// a replaced value can only be told apart by type, and these types have one value each
		const Replaced = s.pipe(
			s.unknown,
			s.transform(() => ({})),
			s.object({ a: s.string })
		);
		for (const input of [{ b: 1 }, { a: undefined }]) {
			const issue = issues_of(Replaced, input)[0]!;
			assert.strictEqual(issue.received, 'undefined');
			assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: undefined });
		}
		// and where the input has another type there, it refuses
		const present = { a: 'present' };
		assert.deepEqual(s.get_issue_value(issues_of(Replaced, present)[0]!, present), { ok: false });
	});

	test('reads the input again, so a getter runs again', () => {
		let reads = 0;
		const input = {
			get a(): number {
				return reads++;
			}
		};
		const issue = issues_of(s.object({ a: s.string }), input)[0]!;
		assert.strictEqual(reads, 1);
		// the schema saw 0, and the walk reads 1: the input has to be unchanged since
		assert.deepEqual(s.get_issue_value(issue, input), { ok: true, value: 1 });
		assert.strictEqual(reads, 2);
	});
});
