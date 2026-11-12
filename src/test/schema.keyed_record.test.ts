import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { issues_of } from './schema_test_helpers.ts';

const Name = s.pipe(s.string, s.regex(/^[a-z]+$/));
const Lower = s.pipe(s.string, s.to_lower_case);

// the kind, path, and expected of each issue
const summary = (
	schema: s.AnySchema,
	input: unknown
): Array<[string, Array<PropertyKey>, string]> =>
	issues_of(schema, input).map((i) => [i.kind, i.path, i.expected]);

describe('keyed_record', () => {
	test('checks every key and every value', () => {
		const R = s.keyed_record(Name, s.number);
		for (const input of [{}, { a: 1 }, { a: 1, bc: 2 }]) {
			assert.strictEqual<unknown>(s.parse_or_throw(R, input), input);
			assert(s.is(R, input));
		}
		assert.deepEqual(summary(R, { A: 1 }), [['invalid_key', ['A'], '/^[a-z]+$/']]);
		assert.deepEqual(summary(R, { a: 'x' }), [['number', ['a'], 'number']]);
		assert(!s.is(R, { A: 1 }));
		assert(!s.is(R, { a: 'x' }));
	});

	test("a bad key's issue is about the key, received a string", () => {
		const [issue] = issues_of(s.keyed_record(Name, s.number), { 'b-c': 1 });
		assert.deepEqual(issue, {
			kind: 'invalid_key',
			expected: '/^[a-z]+$/',
			received: 'string',
			path: ['b-c'],
			message: undefined
		});
		assert.deepEqual(Object.keys(issue!), ['kind', 'expected', 'received', 'path', 'message']);
		assert.strictEqual(s.format_issue(issue!), '"b-c": expected /^[a-z]+$/, received string');
	});

	test('the expected text is the key schema’s', () => {
		assert.deepEqual(summary(s.keyed_record(s.one_of(['a', 'b']), s.number), { c: 1 }), [
			['invalid_key', ['c'], '"a" | "b"']
		]);
		assert.deepEqual(summary(s.keyed_record(s.literal('x'), s.number), { y: 1 }), [
			['invalid_key', ['y'], '"x"']
		]);
		const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
		assert.deepEqual(summary(s.keyed_record(Uuid, s.number), { nope: 1 }), [
			['invalid_key', ['nope'], 'uuid']
		]);
		assert.deepEqual(
			summary(s.keyed_record(s.pipe(s.string, s.min_length(2)), s.number), { a: 1 }),
			[['invalid_key', ['a'], 'length >= 2']]
		);
	});

	test('value is not run on the value of a bad key, which no copy after it reads', () => {
		let reads = 0;
		const input = Object.defineProperty({}, 'A', {
			get: () => (reads++, 'x'),
			enumerable: true
		});
		assert.deepEqual(summary(s.keyed_record(Name, s.number), input), [
			['invalid_key', ['A'], '/^[a-z]+$/']
		]);
		assert(!s.is(s.keyed_record(Name, s.number), input));
		assert.strictEqual(reads, 0);
		// and the value schema is not run on it
		let runs = 0;
		const counted = s.check(() => (runs++, true));
		assert.deepEqual(summary(s.keyed_record(Name, counted), { A: 1, b: 2 }), [
			['invalid_key', ['A'], '/^[a-z]+$/']
		]);
		assert.strictEqual(runs, 1);
	});

	test('only the first issue of a key schema that reports several is an invalid_key', () => {
		const Twice: s.Schema<string> = {
			kind: 'twice',
			def: undefined,
			run: (value, ctx) => {
				if (value === 'ok') return value;
				s.fail(ctx, 'first', value);
				return s.fail(ctx, 'second', value);
			}
		};
		const issues = issues_of(s.keyed_record(Twice, s.number), { ok: 1, bad: 2 });
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path]),
			[
				['invalid_key', ['bad']],
				['second', ['bad']]
			]
		);
	});

	test("received is the key schema's, and a check_at in it adds to the path", () => {
		// a step that changes the key's type leaves the issue received as it changed it
		const Whole = s.pipe(s.string, s.transform(Number), s.integer, s.transform(String));
		const [issue] = issues_of(s.keyed_record(Whole, s.number), { '1.5': 1 });
		assert.deepEqual(
			[issue!.kind, issue!.received, issue!.path],
			['invalid_key', 'number', ['1.5']]
		);
		// a check_at reports below the key, so the path ends at its key and not the record's
		const Short = s.pipe(
			s.string,
			s.check_at('length', (k) => k.length < 4)
		);
		const input = { abcd: 1 };
		const [at] = issues_of(s.keyed_record(Short, s.number), input);
		assert.deepEqual([at!.kind, at!.path], ['invalid_key', ['abcd', 'length']]);
		assert.deepEqual(s.get_issue_value(at!, input), { ok: true, value: 'length' });
	});

	test("issues come in the input's order, keys among values", () => {
		const R = s.keyed_record(Name, s.number);
		assert.deepEqual(summary(R, { A: 1, b: 'x', C: 2, d: 3 }), [
			['invalid_key', ['A'], '/^[a-z]+$/'],
			['number', ['b'], 'number'],
			['invalid_key', ['C'], '/^[a-z]+$/']
		]);
		assert.deepEqual(summary(R, { b: 'x', A: 1 }), [
			['number', ['b'], 'number'],
			['invalid_key', ['A'], '/^[a-z]+$/']
		]);
	});

	test('nested, the path is from the root', () => {
		const R = s.object({ m: s.keyed_record(Name, s.keyed_record(Name, s.number)) });
		assert.deepEqual(summary(R, { m: { a: { B: 1, c: 'x' } } }), [
			['invalid_key', ['m', 'a', 'B'], '/^[a-z]+$/'],
			['number', ['m', 'a', 'c'], 'number']
		]);
	});

	test('a finite key set needs no key', () => {
		const R = s.keyed_record(s.one_of(['a', 'b']), s.number);
		for (const input of [{}, { a: 1 }, { b: 2, a: 1 }]) {
			assert.strictEqual(s.parse_or_throw(R, input), input);
		}
		// the input's order, not the set's
		assert.deepEqual(Object.keys(s.parse_or_throw(R, { b: 2, a: 1 })), ['b', 'a']);
		assert.deepEqual(summary(R, { a: 1, c: 3 }), [['invalid_key', ['c'], '"a" | "b"']]);
		// a value that may be missing is not filled in for a key that isn't there
		const D = s.keyed_record(s.one_of(['a', 'b']), s.with_default(s.number, 0));
		assert.deepEqual(s.parse_or_throw(D, { a: undefined }), { a: 0 });
		assert.deepEqual(s.parse_or_throw(D, {}), {});
	});

	test('what the key schema gives is the key', () => {
		const R = s.keyed_record(Lower, s.number);
		const lower = { a: 1, b: 2 };
		assert.strictEqual(s.parse_or_throw(R, lower), lower);
		const upper = { a: 1, B: 2, c: 3 };
		const output = s.parse_or_throw(R, upper);
		assert.notStrictEqual(output, upper);
		assert.deepEqual(output, { a: 1, b: 2, c: 3 });
		assert.deepEqual(Object.keys(output), ['a', 'b', 'c']);
		// the input is left as it was
		assert.deepEqual(upper, { a: 1, B: 2, c: 3 });
	});

	test("two keys that give one are the last one's value in the first one's place", () => {
		const R = s.keyed_record(Lower, s.number);
		const output = s.parse_or_throw(R, { a: 1, x: 0, A: 2 });
		assert.deepEqual(output, { a: 2, x: 0 });
		assert.deepEqual(Object.keys(output), ['a', 'x']);
		assert.deepEqual(Object.keys(s.parse_or_throw(R, { A: 1, x: 0, a: 2 })), ['a', 'x']);
	});

	test('a copy begun by a value has the keys before it', () => {
		const R = s.keyed_record(Name, s.with_default(s.number, 0));
		const input = { a: 1, b: undefined, c: 3 };
		assert.deepEqual(s.parse_or_throw(R, input), { a: 1, b: 0, c: 3 });
		const same = { a: 1 };
		assert.strictEqual(s.parse_or_throw(R, same), same);
	});

	test('an own __proto__ key is run through both schemas, then left out', () => {
		const R = s.keyed_record(s.string, s.number);
		const input = JSON.parse('{"a": 1, "__proto__": 2, "b": 3}');
		const output = s.parse_or_throw(R, input);
		assert.notStrictEqual(output, input);
		assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
		assert.deepEqual(Object.keys(output), ['a', 'b']);
		// its value is validated
		assert.deepEqual(summary(R, JSON.parse('{"__proto__": "x"}')), [
			['number', ['__proto__'], 'number']
		]);
		// a key schema that refuses it reports the key
		assert.deepEqual(summary(s.keyed_record(Name, s.number), JSON.parse('{"__proto__": 1}')), [
			['invalid_key', ['__proto__'], '/^[a-z]+$/']
		]);
	});

	test('a key that gives __proto__ is left out', () => {
		const R = s.keyed_record(
			s.pipe(
				s.string,
				s.transform((k: string) => (k === 'x' ? '__proto__' : k))
			),
			s.number
		);
		const output = s.parse_or_throw(R, { a: 1, x: 2, b: 3 });
		assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
		assert.deepEqual(Object.keys(output), ['a', 'b']);
		assert.deepEqual(s.parse_or_throw(R, { x: 2 }), {});
	});

	test('keys are read as record reads them', () => {
		const R = s.keyed_record(Name, s.number);
		// a symbol key is not run, and stays in an input that comes back
		const sym = Symbol('s');
		const with_symbol = { a: 1, [sym]: 'x' };
		assert.strictEqual(s.parse_or_throw(R, with_symbol), with_symbol);
		// an inherited key is not run either
		const inherits = Object.create({ B: 'x' });
		inherits.a = 1;
		assert.strictEqual(s.parse_or_throw(R, inherits), inherits);
		// nor one that isn't enumerable
		const hidden = Object.defineProperty({ a: 1 }, 'B', { value: 'x', enumerable: false });
		assert.strictEqual(s.parse_or_throw(R, hidden), hidden);
		// a class instance is taken by its own keys
		class C {
			a = 1;
		}
		const instance = new C();
		assert.strictEqual<unknown>(s.parse_or_throw(R, instance), instance);
		// an own `constructor` key is a key as any other
		assert.deepEqual(summary(R, { constructor: 'x' }), [['number', ['constructor'], 'number']]);
		// what isn't an object is refused, an array among them
		for (const input of [[], [1], null, undefined, 'a', 1]) {
			assert.deepEqual(
				issues_of(R, input).map((i) => [i.kind, i.expected]),
				[['keyed_record', 'object']]
			);
		}
	});

	test('a missing key of an entry is refused as any value that is not an object', () => {
		assert.deepEqual(summary(s.object({ m: s.keyed_record(s.string, s.number) }), {}), [
			['keyed_record', ['m'], 'object']
		]);
		assert.deepEqual(
			s.parse_or_throw(s.object({ m: s.optional(s.keyed_record(s.string, s.number)) }), {}),
			{}
		);
	});

	test('a message on the key labels its issue, and its function is handed the key', () => {
		const handed: Array<unknown> = [];
		const R = s.keyed_record(
			s.message(Name, (issue, key) => {
				handed.push([issue.kind, key]);
				return `invalid key ${JSON.stringify(key)}`;
			}),
			s.number
		);
		const issues = issues_of(R, { A: 1, 'b-c': 2, d: 'x' });
		assert.deepEqual(
			issues.map((i) => [i.kind, i.path, i.message]),
			[
				['invalid_key', ['A'], 'invalid key "A"'],
				['invalid_key', ['b-c'], 'invalid key "b-c"'],
				['number', ['d'], undefined]
			]
		);
		// the issue the key schema reported, before it is made an `invalid_key`
		assert.deepEqual(handed, [
			['regex', 'A'],
			['regex', 'b-c']
		]);
		// a message around the record labels a key's issue as any child's
		assert.deepEqual(
			issues_of(s.message(s.keyed_record(Name, s.number), 'bad'), { A: 1 }).map((i) => [
				i.kind,
				i.message
			]),
			[['invalid_key', 'bad']]
		);
	});

	test('in a union it is probed, and fails as an object', () => {
		const U = s.union([s.keyed_record(Name, s.number), s.string]);
		assert.deepEqual(s.parse_or_throw(U, { a: 1 }), { a: 1 });
		assert.deepEqual(summary(U, { A: 1 }), [['union', [], 'object | string']]);
		assert.deepEqual(summary(U, { a: 'x' }), [['union', [], 'object | string']]);
		// a later option takes what the record refuses
		const V = s.union([s.keyed_record(Name, s.number), s.record(s.unknown)]);
		const input = { A: 'x' };
		assert.strictEqual(s.parse_or_throw(V, input), input);
		// probing stops at the first failure: the key after it is not run
		let runs = 0;
		const counted = s.pipe(
			s.string,
			s.check((k) => (runs++, k !== 'A'))
		);
		assert(!s.is(s.keyed_record(counted, s.number), { A: 1, b: 2, c: 3 }));
		assert.strictEqual(runs, 1);
	});

	test('past the cap its issues are counted', () => {
		const many: Record<string, number> = {};
		for (let i = 0; i < 150; i++) many['K' + i] = 1;
		const R = s.keyed_record(Name, s.number);
		const issues = issues_of(R, many);
		assert.strictEqual(issues.length, 100);
		assert(issues.every((i) => i.kind === 'invalid_key' && i.path.length === 1));
		assert.deepEqual(issues.at(-1)!.path, ['K99']);
		let thrown: unknown;
		try {
			s.parse_or_throw(R, many);
		} catch (error) {
			thrown = error;
		}
		assert(thrown instanceof s.SchemaError);
		assert.strictEqual(thrown.message.split('\n').at(-1), 'and 140 more');
		// a value's failures past the cap are counted the same
		const values: Record<string, string> = {};
		for (let i = 0; i < 150; i++)
			values['k' + String.fromCharCode(97 + (i % 26)).repeat(1 + Math.floor(i / 26))] = 'x';
		assert.strictEqual(issues_of(R, values).length, 100);
	});

	test('the context is kept: is agrees with parse, and parsing twice gives the same', () => {
		const R = s.keyed_record(Lower, s.with_default(s.number, 0));
		for (const input of [
			{},
			{ A: undefined, b: 1 },
			{ a: 'x', B: 1 },
			JSON.parse('{"__proto__": 1}')
		]) {
			const first = s.parse(R, input);
			assert.strictEqual(s.is(R, input), first.ok);
			assert.deepEqual(s.parse(R, input), first);
		}
	});
});
