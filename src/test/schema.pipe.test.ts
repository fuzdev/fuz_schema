import { describe, test, assert, expectTypeOf } from 'vitest';

import * as s from '#lib/schema.ts';
import { meta } from '#lib/meta.ts';
import { assert_schema_error, issues_of } from './schema_test_helpers.ts';

describe('pipe and actions', () => {
	test('stops at the first failure whatever it starts with, as an entry and alone', () => {
		// each of a pipe's three closures: one that starts with an `optional`,
		// one whose first schema takes the object and the key, and the other
		const firsts: Array<[string, s.Schema]> = [
			['optional', s.optional(s.string)],
			[
				'a pipe that starts with an optional',
				s.pipe(
					s.optional(s.string),
					s.check(() => true)
				)
			],
			['unknown', s.unknown],
			['string', s.string]
		];
		for (const [name, first] of firsts) {
			let ran = 0;
			const Entry = s.pipe(
				first,
				s.check(() => false),
				s.check(() => {
					ran++;
					return true;
				})
			);
			assert.deepEqual(
				issues_of(Entry, 'abc').map((i) => i.kind),
				['check'],
				name
			);
			assert.deepEqual(
				issues_of(s.object({ a: Entry }), { a: 'abc' }).map((i) => [i.kind, i.path]),
				[['check', ['a']]],
				name
			);
			assert.strictEqual(ran, 0, name);
		}
	});

	test('runs its first schema once, and no step after one that fails', () => {
		// a first schema that changes the value, under each closure a string reaches
		const firsts: Array<[string, s.Schema]> = [
			[
				'optional',
				s.optional(
					s.pipe(
						s.string,
						s.transform((v) => v + '!')
					)
				)
			],
			[
				'string',
				s.pipe(
					s.string,
					s.transform((v) => v + '!')
				)
			],
			[
				'lazy',
				s.lazy(() =>
					s.pipe(
						s.string,
						s.transform((v) => v + '!')
					)
				)
			]
		];
		for (const [name, first] of firsts) {
			let ran = 0;
			const Entry = s.pipe(
				first,
				s.check(() => {
					ran++;
					return true;
				})
			);
			assert.strictEqual(s.parse_or_throw(Entry, 'abc'), 'abc!', name);
			assert.deepEqual(s.parse_or_throw(s.object({ a: Entry }), { a: 'abc' }), { a: 'abc!' }, name);
			assert.strictEqual(ran, 2, name);
			// the first schema fails, and the step after it would report again
			ran = 0;
			const Failing = s.pipe(
				first,
				s.check(() => {
					ran++;
					return false;
				})
			);
			assert.deepEqual(
				issues_of(Failing, 5).map((i) => i.kind),
				['string'],
				name
			);
			assert.deepEqual(
				issues_of(s.object({ a: Failing }), { a: 5 }).map((i) => [i.kind, i.path]),
				[['string', ['a']]],
				name
			);
			assert.strictEqual(ran, 0, name);
		}
	});

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
		// the pattern as `String` writes it, unless one is given
		assert.strictEqual(issues_of(s.pipe(s.string, s.regex(/^a/i)), 'b')[0]!.expected, '/^a/i');
		assert.strictEqual(
			issues_of(s.pipe(s.string, s.regex(/^a/, 'an a')), 'b')[0]!.expected,
			'an a'
		);
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

	test('transform hands its function the value alone', () => {
		const count = s.transform((...args: Array<unknown>) => args.length);
		assert.strictEqual(s.parse_or_throw(s.pipe(s.string, count), '11'), 1);
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
		// the format tests ask the type first, so they are not a hole
		assert(!s.is(s.uuid, ['123e4567-e89b-12d3-a456-426614174000']));
		assert(!s.is(s.iso_datetime, ['2024-01-01T00:00:00Z']));
		assert(!s.is(s.object({ a: s.uuid }), {}));
	});

	describe('to_lower_case', () => {
		test('lowercases, and never fails', () => {
			const Lower = s.pipe(s.string, s.to_lower_case);
			assert.strictEqual(s.parse_or_throw(Lower, 'AbC'), 'abc');
			// a string already lowercase comes back as it is
			assert.strictEqual(s.parse_or_throw(Lower, 'abc'), 'abc');
			assert.strictEqual(s.parse_or_throw(Lower, 'İ'), 'i̇');
			assert.strictEqual(s.parse_or_throw(Lower, 'ΑΣ'), 'ας');
			assert.deepEqual(issues_of(Lower, 1), [
				{ kind: 'string', expected: 'string', received: 'number', path: [], message: undefined }
			]);
			// an object it changes is copied, with the lowercase in it
			const input = { id: 'A', n: 1 };
			const O = s.object({ id: Lower, n: s.number });
			const output = s.parse_or_throw(O, input);
			assert.notStrictEqual(output, input);
			assert.deepEqual(output, { id: 'a', n: 1 });
			assert.strictEqual(s.parse_or_throw(O, { id: 'a', n: 1 }).id, 'a');
		});

		test('a step after it is given the lowercase, and one before it the input', () => {
			// a dotted capital I is two units lowercase
			assert(!s.is(s.pipe(s.string, s.to_lower_case, s.max_length(1)), 'İ'));
			assert(s.is(s.pipe(s.string, s.max_length(1), s.to_lower_case), 'İ'));
			const at = '2024-01-01T00:00:00Z';
			assert(!s.is(s.pipe(s.string, s.to_lower_case, s.iso_datetime), at));
			assert.strictEqual(
				s.parse_or_throw(s.pipe(s.string, s.iso_datetime, s.to_lower_case), at),
				'2024-01-01t00:00:00z'
			);
			// through a pipe it starts with
			assert.deepEqual(
				issues_of(
					s.pipe(
						s.pipe(s.string, s.to_lower_case),
						s.check((v) => v === 'a')
					),
					'B'
				),
				[{ kind: 'check', expected: 'check', received: 'string', path: [], message: undefined }]
			);
		});

		test('a uuid of either case comes out lowercase, branded', () => {
			const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
			assert.strictEqual(
				s.parse_or_throw(Uuid, '123E4567-E89B-42D3-A456-426614174000'),
				'123e4567-e89b-42d3-a456-426614174000'
			);
			assert.strictEqual(
				s.parse_or_throw(Uuid, 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'),
				'ffffffff-ffff-ffff-ffff-ffffffffffff'
			);
			assert.deepEqual(
				issues_of(Uuid, 'x').map((i) => i.kind),
				['uuid']
			);
			expectTypeOf<s.Infer<typeof Uuid>>().toEqualTypeOf<s.Branded<string, 'Uuid'>>();
			expectTypeOf<s.InferInput<typeof Uuid>>().toEqualTypeOf<string>();
		});

		test('outputs a string, as its value is a new one', () => {
			// a literal before it is not kept, as the lowercase is another
			const _literal = s.pipe(s.one_of(['A', 'B']), s.to_lower_case);
			expectTypeOf<s.Infer<typeof _literal>>().toEqualTypeOf<string>();
			// a brand before it is not kept, and one around the pipe is
			const _inner = s.pipe(s.string, s.brand(s.uuid, 'Uuid'), s.to_lower_case);
			expectTypeOf<s.Infer<typeof _inner>>().toEqualTypeOf<string>();
			// a refinement after it keeps its string
			const _after = s.pipe(s.string, s.to_lower_case, s.min_length(1));
			expectTypeOf<s.Infer<typeof _after>>().toEqualTypeOf<string>();
			// @ts-expect-error `to_lower_case` takes a string
			s.pipe(s.number, s.to_lower_case);
			// @ts-expect-error `null` would reach it
			s.pipe(s.nullable(s.string), s.to_lower_case);
		});

		test('outside a pipe it throws on a value with no toLowerCase', () => {
			assert.strictEqual(s.parse_or_throw(s.to_lower_case, 'A'), 'a');
			assert.throws(() => s.parse(s.to_lower_case, 1), TypeError);
			assert.throws(() => s.parse(s.object({ a: s.to_lower_case }), {}), TypeError);
		});
	});

	describe('to_integer', () => {
		const SIGNED = 'a safe integer in decimal digits';

		test('the bounds after it are of the integer', () => {
			const Limit = s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000));
			assert.strictEqual(s.parse_or_throw(Limit, '1'), 1);
			assert.strictEqual(s.parse_or_throw(Limit, '+01000'), 1000);
			assert.deepEqual(issues_of(Limit, '0'), [
				{ kind: 'min_value', expected: '>= 1', received: 'number', path: [], message: undefined }
			]);
			assert.deepEqual(
				issues_of(Limit, '1001').map((i) => i.kind),
				['max_value']
			);
			// the string's steps before it, and the grammar before the bounds
			const Short = s.pipe(s.pipe(s.string, s.max_length(3)), s.to_integer(), s.min_value(5));
			assert.deepEqual(
				issues_of(Short, '1000').map((i) => i.kind),
				['max_length']
			);
			assert.deepEqual(
				issues_of(Short, 'x').map((i) => i.kind),
				['to_integer']
			);
			assert.strictEqual(
				s.parse_or_throw(s.pipe(s.pipe(s.string, s.to_integer()), s.max_value(9)), '9'),
				9
			);
			// a `to_lower_case` before it changes nothing it reads
			assert.strictEqual(
				s.parse_or_throw(s.pipe(s.string, s.to_lower_case, s.to_integer()), '7'),
				7
			);
		});

		test('as an entry, with a default, and in a container', () => {
			const Query = s.object({
				offset: s.with_default(s.pipe(s.string, s.to_integer(), s.min_value(0)), 0),
				limit: s.with_default(s.pipe(s.string, s.to_integer(), s.max_value(1000)), 100)
			});
			assert.deepEqual(s.parse_or_throw(Query, {}), { offset: 0, limit: 100 });
			const input = { offset: '20', limit: '5' };
			const output = s.parse_or_throw(Query, input);
			// a new value, so a copy, and the input as it was
			assert.deepEqual(output, { offset: 20, limit: 5 });
			assert.notStrictEqual<unknown>(output, input);
			assert.deepEqual(input, { offset: '20', limit: '5' });
			assert.deepEqual(issues_of(Query, { offset: '-0', limit: '1e3' }), [
				{
					kind: 'to_integer',
					expected: SIGNED,
					received: 'string',
					path: ['limit'],
					message: undefined
				}
			]);
			// a `-0` is a `0`, which the bound takes
			assert.deepEqual(s.parse_or_throw(Query, { offset: '-0' }), { offset: 0, limit: 100 });
			assert.deepEqual(
				issues_of(s.array(s.pipe(s.string, s.to_integer())), ['1', 2, 'x']).map((i) => [
					i.kind,
					i.received,
					i.path
				]),
				[
					['string', 'number', [1]],
					['to_integer', 'string', [2]]
				]
			);
			// a missing key is the string's to refuse
			assert.deepEqual(
				issues_of(s.object({ n: s.pipe(s.string, s.to_integer()) }), {}).map((i) => i.kind),
				['string']
			);
		});

		test('message and meta wrap it, and a union probes it', () => {
			const Labeled = s.pipe(s.string, s.message(s.to_integer(), 'digits, please'));
			assert.strictEqual(issues_of(Labeled, 'x')[0]!.message, 'digits, please');
			assert.strictEqual(s.parse_or_throw(Labeled, '3'), 3);
			const Described = s.pipe(
				s.string,
				meta(s.to_integer({ unsigned: true }), { description: 'd' })
			);
			assert.strictEqual(s.parse_or_throw(Described, '3'), 3);
			assert(!s.is(Described, '-3'));
			// a failed option is only probed: one issue, of the union, naming the pipe by its first schema
			const Either = s.union([s.pipe(s.string, s.to_integer()), s.literal(true)]);
			assert.strictEqual(s.parse_or_throw(Either, '5'), 5);
			assert.strictEqual(s.parse_or_throw(Either, true), true);
			assert.deepEqual(issues_of(Either, 'x'), [
				{
					kind: 'union',
					expected: 'string | true',
					received: 'string',
					path: [],
					message: undefined
				}
			]);
			assert(s.is(s.pipe(s.string, s.to_integer()), '5'));
			assert(!s.is(s.pipe(s.string, s.to_integer()), 'x'));
		});

		test('past the cap it counts and builds no issue', () => {
			const List = s.array(s.pipe(s.string, s.to_integer()));
			const bad = Array.from({ length: 150 }, () => 'x');
			assert.strictEqual(issues_of(List, bad).length, 100);
			assert.match(
				assert_schema_error(() => s.parse_or_throw(List, bad)).message,
				/\nand 140 more$/
			);
		});

		test('reads a string and outputs a number, so only a string comes before it', () => {
			const _Limit = s.pipe(s.string, s.to_integer(), s.min_value(1));
			expectTypeOf<s.Infer<typeof _Limit>>().toEqualTypeOf<number>();
			expectTypeOf<s.InferInput<typeof _Limit>>().toEqualTypeOf<string>();
			const _literal = s.pipe(s.one_of(['1', '2']), s.to_integer());
			expectTypeOf<s.Infer<typeof _literal>>().toEqualTypeOf<number>();
			// @ts-expect-error `to_integer` takes a string
			s.pipe(s.number, s.to_integer());
			// @ts-expect-error `undefined` would reach it
			s.pipe(s.optional(s.string), s.to_integer());
			// @ts-expect-error a string's action after it is given a number
			s.pipe(s.string, s.to_integer(), s.min_length(1));
			// a wrapper of the action is typed from the step before it, and one around the pipe marks the integer
			const _wrapped = s.pipe(
				s.string,
				s.message(meta(s.to_integer(), { description: 'd' }), 'm'),
				s.max_value(65535)
			);
			expectTypeOf<s.Infer<typeof _wrapped>>().toEqualTypeOf<number>();
			const _Port = s.brand(s.pipe(s.string, s.to_integer({ unsigned: true })), 'Port');
			expectTypeOf<s.Infer<typeof _Port>>().toEqualTypeOf<s.Branded<number, 'Port'>>();
			expectTypeOf<s.InferInput<typeof _Port>>().toEqualTypeOf<string>();
			const _defaulted = s.with_default(s.pipe(s.string, s.to_integer()), 100);
			expectTypeOf<s.Infer<typeof _defaulted>>().toEqualTypeOf<number>();
			expectTypeOf<s.InferInput<typeof _defaulted>>().toEqualTypeOf<string | undefined>();
		});
	});
});

describe('check_at', () => {
	const Passwords = s.pipe(
		s.object({ password: s.string, confirm: s.optional(s.string) }),
		s.check_at('confirm', (v) => v.password === v.confirm, 'the password again')
	);

	test('fails as check does, at the path below the value', () => {
		assert.deepEqual(s.parse(Passwords, { password: 'a', confirm: 'a' }), {
			ok: true,
			value: { password: 'a', confirm: 'a' }
		});
		assert.deepEqual(issues_of(Passwords, { password: 'a', confirm: 'b' }), [
			{
				kind: 'check',
				expected: 'the password again',
				received: 'string',
				path: ['confirm'],
				message: undefined
			}
		]);
		// the type received is of the value at the path, a missing key's `undefined` too
		assert.deepEqual(issues_of(Passwords, { password: 'a' })[0]!.received, 'undefined');
		// a refinement: the output is the input, typed as the step before
		const input = { password: 'a', confirm: 'a' };
		assert.strictEqual(s.parse_or_throw(Passwords, input), input);
		expectTypeOf<s.Infer<typeof Passwords>>().toEqualTypeOf<{
			password: string;
			confirm?: string | undefined;
		}>();
	});

	test('a path of keys, outermost first, below the keys above it', () => {
		const Deep = s.object({
			outer: s.pipe(
				s.array(s.object({ a: s.number })),
				s.check_at([0, 'a'], (v) => v.length === 0 || v[0]!.a > 0)
			)
		});
		const value = { outer: [{ a: 0 }] };
		const [issue] = issues_of(Deep, value);
		assert.deepEqual(issue!.path, ['outer', 0, 'a']);
		assert.strictEqual(issue!.received, 'number');
		assert.deepEqual(s.get_issue_value(issue!, value), { ok: true, value: 0 });
		assert.strictEqual(s.format_issue(issue!), 'outer.0.a: expected check, received number');
		// an empty path is the value's own, as with check
		assert.deepEqual(
			issues_of(
				s.check_at([], () => false),
				1
			)[0]!.path,
			[]
		);
		// a path through what isn't an object receives `undefined`
		assert.strictEqual(
			issues_of(
				s.check_at(['a', 'b'], () => false),
				{ a: 1 }
			)[0]!.received,
			'undefined'
		);
		// the path is each issue's own array
		const issues = issues_of(s.array(s.check_at('k', () => false)), [{}, {}]);
		assert.deepEqual(
			issues.map((i) => i.path),
			[
				[0, 'k'],
				[1, 'k']
			]
		);
		assert.notStrictEqual(issues[0]!.path, issues[1]!.path);
	});

	test('a message labels it, and probing builds no issue', () => {
		const Invite = s.pipe(
			s.object({ email: s.nullable(s.string), username: s.nullable(s.string) }),
			s.message(
				s.check_at('email', (v) => v.email !== null || v.username !== null),
				'at least one of email or username is required'
			)
		);
		assert.deepEqual(issues_of(Invite, { email: null, username: null }), [
			{
				kind: 'check',
				expected: 'check',
				received: 'null',
				path: ['email'],
				message: 'at least one of email or username is required'
			}
		]);
		assert(!s.is(Invite, { email: null, username: null }));
		assert(s.is(Invite, { email: null, username: 'u' }));
		const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
		Invite.run({ email: null, username: null }, ctx);
		assert.strictEqual(ctx.fails, 1);
		assert.strictEqual(ctx.issues, undefined);
	});

	test('past the cap it counts and builds no issue', () => {
		const result = s.parse(
			s.array(s.check_at(['k', 'j'], () => false)),
			Array.from({ length: 150 }, () => ({}))
		);
		assert(!result.ok);
		assert.strictEqual(result.issues.length, 100);
		assert.deepEqual(result.issues[99]!.path, [99, 'k', 'j']);
	});

	test('reads the path only where an issue is built', () => {
		let reads = 0;
		const input = {
			get a(): { b: number } {
				reads++;
				return { b: 1 };
			}
		};
		const At = s.pipe(
			s.unknown,
			s.check_at(['a', 'b'], () => false)
		);
		assert(!s.is(At, input));
		assert.strictEqual(reads, 0, 'a probe');
		const ctx: s.SchemaContext = { issues: undefined, fails: 100, probe: false };
		At.run(input, ctx);
		assert.strictEqual(reads, 0, 'past the cap');
		assert.strictEqual(ctx.fails, 101);
		assert.strictEqual(ctx.issues, undefined);
		assert.deepEqual(issues_of(At, input)[0]!.path, ['a', 'b']);
		assert.strictEqual(reads, 1, 'an issue built');
	});

	test('its path is of keys of the value, a typo failing to compile', () => {
		const Base = s.object({
			email: s.string,
			user: s.nullable(s.object({ name: s.string, tags: s.array(s.string) })),
			pair: s.array(s.object({ a: s.number })),
			counts: s.record(s.number)
		});
		type Base = s.Infer<typeof Base>;
		// `fn` is typed from the step before, in either form
		s.pipe(
			Base,
			s.check_at('email', (v) => {
				expectTypeOf(v).toEqualTypeOf<Base>();
				return v.email !== '';
			}),
			s.check_at(['user', 'name'], (v) => {
				expectTypeOf(v).toEqualTypeOf<Base>();
				return v.user?.name !== '';
			}),
			s.message(
				s.check_at(['pair', 0, 'a'], (v) => v.pair.length > 0),
				'm'
			)
		);
		s.pipe(
			Base,
			s.check_at(['user', 'tags', 3], () => true),
			s.check_at(['counts', 'any key'], () => true),
			s.check_at([], () => true)
		);
		s.pipe(
			Base,
			// @ts-expect-error a key the value lacks
			s.check_at('emial', () => true)
		);
		s.pipe(
			Base,
			// @ts-expect-error a key the value lacks, inside the path
			s.check_at(['user', 'nmae'], () => true)
		);
		s.pipe(
			Base,
			// @ts-expect-error an array's key is a number
			s.check_at(['pair', 'a'], () => true)
		);
		s.pipe(
			Base,
			// @ts-expect-error past an array's item
			s.check_at(['pair', 0, 'b'], () => true)
		);
		s.pipe(
			Base,
			s.message(
				// @ts-expect-error inside a message
				s.check_at('emial', () => true),
				'm'
			)
		);
		// of a union, a key of every member
		const Either = s.union([
			s.object({ kind: s.literal('a'), a: s.string }),
			s.object({ kind: s.literal('b'), b: s.string })
		]);
		s.pipe(
			Either,
			s.check_at('kind', () => true)
		);
		s.pipe(
			Either,
			// @ts-expect-error a key of one member only
			s.check_at('a', () => true)
		);
		// an array's keys are numbers
		s.pipe(
			s.array(s.string),
			s.check_at(0, (v) => v.length > 0)
		);
		// of `unknown`, any path
		s.pipe(
			s.unknown,
			s.check_at(['a', 0, 'b'], () => true)
		);
		// of a generic value a key is checked against its constraint, and a path
		// of keys is not, unless `fn` names the type it is checked against
		const _generic = <T extends s.Schema<{ b: Array<string> }>>(x: T) => [
			s.pipe(
				x,
				s.check_at('b', (v) => v.b.length > 0)
			),
			s.pipe(
				x,
				s.check_at(['b', 0], (_v: { b: Array<string> }) => true)
			),
			s.pipe(
				x,
				// @ts-expect-error a path of keys through a type not yet known
				s.check_at(['b', 0], () => true)
			)
		];
		expectTypeOf(_generic).toBeFunction();
	});

	test('its path never types the value', () => {
		// alone, the value is what `fn` takes, and a path of an unknown value is any
		const _annotated = s.check_at('a', (v: { a: number }) => v.a > 0);
		expectTypeOf<s.Infer<typeof _annotated>>().toEqualTypeOf<{ a: number }>();
		// @ts-expect-error a key of what `fn` takes
		s.check_at('b', (v: { a: number }) => v.a > 0);
		const _bare = s.check_at('a', () => true);
		expectTypeOf<s.Infer<typeof _bare>>().toEqualTypeOf<unknown>();
		const _bare_path = s.check_at(['a', 'b'], () => true);
		expectTypeOf<s.Infer<typeof _bare_path>>().toEqualTypeOf<unknown>();
		const _message = s.message(
			s.check_at('a', () => true),
			'm'
		);
		expectTypeOf<s.Infer<typeof _message>>().toEqualTypeOf<unknown>();
		// in a pipe the output is the step before's, not one the path would make
		const _piped = s.pipe(
			s.object({ a: s.number, b: s.string }),
			s.check_at('a', () => true)
		);
		expectTypeOf<s.Infer<typeof _piped>>().toEqualTypeOf<{ a: number; b: string }>();
	});

	test('one for each path, in a pipe, stopping at the first that fails', () => {
		const Auth = s.pipe(
			s.object({ roles: s.array(s.string), actor: s.string }),
			s.check_at('roles', (v) => !v.roles.length || v.actor === 'required'),
			s.check_at('actor', (v) => v.actor !== 'x')
		);
		assert.deepEqual(
			issues_of(Auth, { roles: ['a'], actor: 'x' }).map((i) => i.path),
			[['roles']]
		);
		assert.deepEqual(
			issues_of(Auth, { roles: [], actor: 'x' }).map((i) => i.path),
			[['actor']]
		);
	});

	test('is a check to every reader', () => {
		const fn = (): boolean => true;
		const schema = s.check_at('k', fn);
		assert.strictEqual(schema.kind, 'check');
		assert.strictEqual(schema.def, fn);
		expectTypeOf(schema).toExtend<s.SchemaNode<'check'>>();
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
