import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

describe('pipe and actions', () => {
	test('runs actions in order and stops at the first failure', () => {
		const Name = s.pipe(s.string, s.min_length(2), s.max_length(4));
		assert.strictEqual(s.parse_or_throw(Name, 'abc'), 'abc');
		assert.deepEqual(
			issues_of(Name, 'a').map((i) => i.kind),
			['min_length']
		);
		assert.deepEqual(
			issues_of(Name, 1).map((i) => i.kind),
			['string']
		);
	});

	test('number actions', () => {
		const Age = s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150));
		assert(s.is(Age, 36));
		assert(!s.is(Age, 36.5));
		assert(!s.is(Age, -1));
		assert(!s.is(Age, 151));
		assert(!s.is(s.pipe(s.number, s.safe_integer), 2 ** 53));
	});

	test('the expected text is the same on every failure, and each schema has its own', () => {
		for (const [schema, value, expected] of [
			[s.min_length(2), 'a', 'length >= 2'],
			[s.max_length(2), 'abc', 'length <= 2'],
			[s.min_value(0), -1, '>= 0'],
			[s.max_value(10n), 11n, '<= 10'],
			[s.union([s.string, s.number]), true, 'string | number']
		] as const) {
			// first as a probe, which builds no issue
			assert(!s.is(schema, value));
			assert.strictEqual(issues_of(schema, value)[0]!.expected, expected);
			assert.strictEqual(issues_of(schema, value)[0]!.expected, expected);
		}
		for (const [a, b, value, expected_a, expected_b] of [
			[s.min_length(1), s.min_length(3), '', 'length >= 1', 'length >= 3'],
			[s.max_length(1), s.max_length(3), 'abcd', 'length <= 1', 'length <= 3'],
			[s.min_value(1), s.min_value(3), 0, '>= 1', '>= 3'],
			[s.max_value(1), s.max_value(3), 4, '<= 1', '<= 3'],
			[s.union([s.string]), s.union([s.number]), true, 'string', 'number']
		] as const) {
			assert.strictEqual(issues_of(a, value)[0]!.expected, expected_a);
			assert.strictEqual(issues_of(b, value)[0]!.expected, expected_b);
			assert.strictEqual(issues_of(a, value)[0]!.expected, expected_a);
		}
	});

	test('regex, check, transform', () => {
		assert(s.is(s.pipe(s.string, s.regex(/^a/)), 'ab'));
		assert(!s.is(s.pipe(s.string, s.regex(/^a/)), 'ba'));
		const Even = s.pipe(
			s.number,
			s.check((v) => v % 2 === 0, 'an even number')
		);
		assert.strictEqual(issues_of(Even, 3)[0]!.expected, 'an even number');
		const Length = s.pipe(
			s.string,
			s.transform((v) => v.length)
		);
		assert.strictEqual(s.parse_or_throw(Length, 'abc'), 3);
	});

	test('transform ignores the context argument', () => {
		assert.strictEqual(s.parse_or_throw(s.pipe(s.string, s.transform(parseInt)), '11'), 11);
	});

	// KNOWN: an action used as a schema itself, outside a `pipe`, is handed the
	// input unchecked, as its `run` assumes the type a `pipe` gives it. Its type
	// is inferred from what it reads, see `schema.inference.test.ts`, which the
	// input is not checked against. A guard would cost bytes in every action, so
	// these are pinned and not fixed
	test('an action outside a pipe is handed the input unchecked, a known hole', () => {
		// a length action reads `length`, so `parse` and `is` throw on a missing key and on null
		const Entry = s.object({ a: s.min_length(1) });
		assert.throws(() => s.parse(Entry, {}), TypeError);
		assert.throws(() => s.is(Entry, {}), TypeError);
		assert.throws(() => s.parse(Entry, { a: null }), TypeError);
		assert.throws(() => s.parse(s.min_length(1), null), TypeError);
		assert.throws(() => s.parse(s.max_length(1), undefined), TypeError);
		assert.throws(() => s.parse(s.union([s.min_length(1), s.number]), null), TypeError);
		// `RegExp.prototype.test` converts what it is given to a string
		assert(s.is(s.regex(/5/), 5));
		assert(s.is(s.object({ a: s.regex(/5/) }), { a: 5 }));
		// and a value action compares what it is given
		assert(s.is(s.min_value(1), '5'));
		// in a `pipe` each is given only what the schema before it accepts
		assert(!s.is(s.object({ a: s.pipe(s.string, s.min_length(1)) }), {}));
		assert(!s.is(s.pipe(s.string, s.regex(/5/)), 5));
		assert(!s.is(s.pipe(s.number, s.min_value(1)), '5'));
	});
});

describe('message', () => {
	test('labels every issue of the schema it wraps that has no message, at any path', () => {
		const O = s.message(
			s.strip_object({ a: s.message(s.string, 'a must be text'), b: s.number }),
			'not an object'
		);
		assert.deepEqual(
			issues_of(O, { a: 1, b: 'x' }).map((i) => i.message),
			['a must be text', 'not an object']
		);
		assert.deepEqual(
			issues_of(O, null).map((i) => i.message),
			['not an object']
		);
		assert.strictEqual(s.format_issue(issues_of(O, { a: 1, b: 2 })[0]!), 'a: a must be text');
		// only the issues of its own run: an earlier sibling's stay unlabeled
		assert.deepEqual(
			issues_of(s.object({ a: s.string, b: s.message(s.string, 'm') }), { a: 1, b: 1 }).map(
				(i) => i.message
			),
			[undefined, 'm']
		);
	});

	test('wraps actions, takes a function, and the innermost wins', () => {
		const Name = s.message(
			s.pipe(
				s.string,
				s.message(
					s.min_length(2),
					(issue, value) => `too short: ${String(value)} (${issue.received})`
				)
			),
			'bad name'
		);
		assert.strictEqual(issues_of(Name, 'a')[0]!.message, 'too short: a (string)');
		assert.strictEqual(issues_of(Name, 1)[0]!.message, 'bad name');
		assert.strictEqual(s.parse_or_throw(Name, 'ab'), 'ab');
	});

	test('a function is handed the value the wrapped schema was given', () => {
		const seen: Array<unknown> = [];
		const note = (issue: s.SchemaIssue, value: unknown): string => {
			seen.push(value);
			return `${issue.kind} of ${issue.received}`;
		};
		const trim = s.transform((v: string) => v.trim());
		// around an action: the action's input, the output of the steps before it
		const Action = s.pipe(s.string, trim, s.message(s.min_length(2), note));
		assert.strictEqual(issues_of(Action, ' a ')[0]!.message, 'min_length of string');
		assert.deepEqual(seen.splice(0), ['a']);
		// and nothing when it's an earlier step that fails
		assert.strictEqual(issues_of(Action, 1)[0]!.message, undefined);
		assert.deepEqual(seen.splice(0), []);
		// around a whole pipe: the pipe's input, whichever step failed
		const Piped = s.message(s.pipe(s.string, trim, s.min_length(2)), note);
		assert.strictEqual(issues_of(Piped, ' a ')[0]!.message, 'min_length of string');
		assert.strictEqual(issues_of(Piped, 1)[0]!.message, 'string of number');
		assert.deepEqual(seen.splice(0), [' a ', 1]);
		// around an entry: its value, the same object, and `undefined` when missing
		const O = s.object({ a: s.message(s.string, note) });
		const value = { nested: true };
		issues_of(O, { a: value });
		issues_of(O, {});
		assert.strictEqual(seen[0], value);
		assert.deepEqual(seen.splice(0), [value, undefined]);
		// around an object: the object, for its own issue and for its entries'
		issues_of(s.message(O, note), null);
		const input = { a: 1 };
		assert.strictEqual(
			issues_of(s.message(s.object({ a: s.string }), note), input)[0]!.message,
			'string of number'
		);
		assert.deepEqual(seen.splice(0), [null, input]);
		// the path is relative to that value, so the child's value can be found from it
		const Found = s.message(s.object({ a: s.object({ b: s.string }) }), (issue, v) => {
			const found = s.get_issue_value(issue, v);
			return found.ok ? `got ${String(found.value)} at ${issue.path.join('.')}` : 'none';
		});
		const found_issue = issues_of(s.object({ o: Found }), { o: { a: { b: 1 } } })[0]!;
		assert.strictEqual(found_issue.message, 'got 1 at a.b');
		assert.deepEqual(found_issue.path, ['o', 'a', 'b']);
		// never for a value that matches, or when only whether it matches is asked
		assert(s.is(Piped, 'ab'));
		assert(!s.is(Piped, 1));
		assert(!s.is(s.union([Piped, s.number]), true));
		s.parse_or_throw(Piped, 'ab');
		assert.deepEqual(seen, []);
		// the text is the function's, so the value is in the issue only if it put it there
		const Echo = s.message(s.string, (_issue, v) => `got ${String(v)}`);
		assert.strictEqual(issues_of(Echo, 1)[0]!.message, 'got 1');
		s.message(s.string, (issue, v) => {
			expectTypeOf(issue).toEqualTypeOf<s.SchemaIssue>();
			expectTypeOf(v).toBeUnknown();
			return '';
		});
	});

	test('is transparent to introspection and optional keys', () => {
		const O = s.strip_object({ a: s.message(s.optional(s.string), 'x') });
		assert.strictEqual(O.def.a.kind, 'optional');
		assert.deepEqual(s.parse_or_throw(O, {}), {});
		const V = s.variant('kind', [
			s.message(s.object({ kind: s.literal('a') }), 'x'),
			s.object({ kind: s.literal('b') })
		]);
		assert(s.is(V, { kind: 'a' }));
	});

	test('labels the issues of every kind of child, and leaves a labeled one alone', () => {
		const labeled = (schema: s.AnySchema, value: unknown): Array<[Array<PropertyKey>, unknown]> =>
			issues_of(s.message(schema, 'm'), value).map((i) => [i.path, i.message]);
		const V = s.variant('t', [
			s.object({ t: s.literal('a'), x: s.string }),
			s.object({ t: s.literal('b') })
		]);
		const A = s.object({ a: s.string });
		const cases: Array<
			[name: string, schema: s.AnySchema, value: unknown, path: Array<PropertyKey>]
		> = [
			['object unknown_key', A, { a: '', b: 1 }, ['b']],
			['object entry', A, { a: 1 }, ['a']],
			['strip_object entry', s.strip_object({ a: A }), { a: { a: 1 } }, ['a', 'a']],
			['loose_object entry', s.loose_object({ a: s.string }), { a: 1 }, ['a']],
			[
				'object_with_rest rest',
				s.object_with_rest({ a: s.string }, s.number),
				{ a: '', b: '' },
				['b']
			],
			['record value', s.record(s.number), { k: '' }, ['k']],
			['array item', s.array(s.number), [0, ''], [1]],
			['variant discriminator', V, { t: 'z' }, ['t']],
			['variant missing discriminator', V, {}, ['t']],
			['variant option entry', V, { t: 'a', x: 1 }, ['x']],
			['variant option unknown_key', V, { t: 'b', q: 1 }, ['q']],
			[
				'pipe',
				s.pipe(
					A,
					s.check(() => true)
				),
				{ a: 1 },
				['a']
			],
			['lazy', s.lazy(() => A), { a: 1 }, ['a']],
			['nullable', s.nullable(A), { a: 1 }, ['a']],
			['optional', s.optional(A), { a: 1 }, ['a']],
			['with_default', s.with_default(A, { a: '' }), { a: 1 }, ['a']],
			// a failed union is one issue, its own: its options are only probed
			['union', s.union([s.string, A]), { a: 1 }, []]
		];
		for (const [name, schema, value, path] of cases) {
			assert.deepEqual(labeled(schema, value), [[path, 'm']], name);
		}
		// the innermost wins, around the child and around the whole
		assert.deepEqual(
			labeled(s.object({ a: s.message(s.string, 'inner'), b: s.number }), { a: 1, b: '' }),
			[
				[['a'], 'inner'],
				[['b'], 'm']
			]
		);
		assert.deepEqual(
			issues_of(s.message(s.message(A, 'inner'), 'outer'), { a: 1, b: 1 }).map((i) => i.message),
			['inner', 'inner']
		);
		// an outer function is not called for an issue an inner message labeled
		let calls = 0;
		const Counted = s.message(s.object({ a: s.message(s.string, 'inner'), b: s.number }), () => {
			calls++;
			return 'outer';
		});
		assert.deepEqual(
			issues_of(Counted, { a: 1, b: '' }).map((i) => i.message),
			['inner', 'outer']
		);
		assert.strictEqual(calls, 1);
	});

	test('labels nothing when only whether a value matches is asked', () => {
		const seen: Array<unknown> = [];
		const O = s.message(s.object({ a: s.array(s.string) }), (issue, value) => {
			seen.push(value);
			return issue.kind;
		});
		assert(!s.is(O, { a: [1] }));
		assert(!s.is(O, { a: [], b: 1 }));
		assert(!s.is(s.union([O, s.number]), { a: [1] }));
		assert.deepEqual(seen, []);
		// the issues a parse gives are its own, labeled once
		assert.deepEqual(
			issues_of(O, { a: [1] }).map((i) => [i.path, i.message]),
			[[['a', 0], 'string']]
		);
		assert.strictEqual(seen.length, 1);
	});

	test('a function is handed the input of a wrapper, a union, and a schema that fails twice', () => {
		const seen: Array<unknown> = [];
		const note = (_issue: s.SchemaIssue, value: unknown): string => {
			seen.push(value);
			return 'noted';
		};
		// around a default: the input, and not at all when the default applies
		const Default = s.message(s.with_default(s.string, 'd'), note);
		issues_of(Default, 1);
		assert.strictEqual(s.parse_or_throw(Default, undefined), 'd');
		assert.deepEqual(seen.splice(0), [1]);
		// a default applied by an earlier step is what an action's function sees
		issues_of(s.pipe(s.with_default(s.string, ''), s.message(s.min_length(1), note)), undefined);
		assert.deepEqual(seen.splice(0), ['']);
		// around a union: the value no option took
		issues_of(s.message(s.union([s.string, s.number]), note), true);
		assert.deepEqual(seen.splice(0), [true]);
		// inside a union's option: never, the option is only probed
		issues_of(s.union([s.message(s.string, note), s.number]), true);
		assert.deepEqual(seen.splice(0), []);
		// the innermost function is the one called
		const inner: Array<unknown> = [];
		issues_of(
			s.message(
				s.message(s.string, (_issue, value) => (inner.push(value), 'inner')),
				note
			),
			1
		);
		assert.deepEqual([inner, seen.splice(0)], [[1], []]);
		// a schema reporting two issues of its own: called for each, with the one value
		const Twice: s.Schema = {
			kind: 'twice',
			def: undefined,
			run: (value, ctx) => s.fail(ctx, 'twice', s.fail(ctx, 'twice', value))
		};
		const value = { a: 1 };
		assert.strictEqual(issues_of(s.message(Twice, note), value).length, 2);
		assert.strictEqual(seen[0], value);
		assert.strictEqual(seen[1], value);
	});
});
