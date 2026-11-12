import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';

// A parse reads the input it is given, every time: an input parsed once,
// changed in place, and parsed again gives the second parse's answer. A cache
// keyed by the input's identity, or a fast path for the last input seen, would
// read as a win in every timing, which gives a case the same objects again, so
// it is caught here.

interface FreshCase {
	name: string;
	schema: s.AnySchema;
	/** A fresh input that matches. */
	input: () => any;
	/** Changes the input in place so that it no longer matches. */
	spoil: (input: any) => void;
	/** Changes the input in place so that it matches with another value, which `read` reads from an output. */
	change: (input: any) => void;
	read: (output: any) => unknown;
	/** What `read` gives of an output of the input first, and after `change`. */
	before: unknown;
	after: unknown;
}

const Row = s.object({ id: s.number, name: s.string });

const CASES: Array<FreshCase> = [
	{
		name: 'object, its input itself',
		schema: Row,
		input: () => ({ id: 1, name: 'a' }),
		spoil: (v) => (v.id = 'x'),
		change: (v) => (v.name = 'b'),
		read: (o) => o.name,
		before: 'a',
		after: 'b'
	},
	{
		name: 'strip_object, a copy',
		schema: s.strip_object({ id: s.number, name: s.string }),
		input: () => ({ id: 1, name: 'a', extra: true }),
		spoil: (v) => (v.id = 'x'),
		change: (v) => (v.name = 'b'),
		read: (o) => o.name,
		before: 'a',
		after: 'b'
	},
	{
		name: 'object with a default, a copy',
		schema: s.object({ id: s.number, role: s.with_default(s.string, 'user') }),
		input: () => ({ id: 1 }),
		spoil: (v) => (v.id = 'x'),
		change: (v) => (v.role = 'admin'),
		read: (o) => o.role,
		before: 'user',
		after: 'admin'
	},
	{
		name: 'loose_object',
		schema: s.loose_object({ id: s.number }),
		input: () => ({ id: 1, extra: 'a' }),
		spoil: (v) => (v.id = 'x'),
		change: (v) => (v.extra = 'b'),
		read: (o) => o.extra,
		before: 'a',
		after: 'b'
	},
	{
		name: 'object_with_rest',
		schema: s.object_with_rest({ id: s.number }, s.string),
		input: () => ({ id: 1, extra: 'a' }),
		spoil: (v) => (v.extra = 2),
		change: (v) => (v.extra = 'b'),
		read: (o) => o.extra,
		before: 'a',
		after: 'b'
	},
	{
		name: 'array',
		schema: s.array(Row),
		input: () => [
			{ id: 1, name: 'a' },
			{ id: 2, name: 'b' }
		],
		spoil: (v) => v.push(3),
		change: (v) => v.pop(),
		read: (o) => o.length,
		before: 2,
		after: 1
	},
	{
		name: 'record',
		schema: s.record(s.number),
		input: () => ({ a: 1, b: 2 }),
		spoil: (v) => (v.c = 'x'),
		change: (v) => (v.b = 3),
		read: (o) => o.b,
		before: 2,
		after: 3
	},
	{
		name: 'keyed_record',
		schema: s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.number),
		input: () => ({ a: 1, b: 2 }),
		spoil: (v) => (v.C = 1),
		change: (v) => (v.b = 3),
		read: (o) => o.b,
		before: 2,
		after: 3
	},
	{
		name: 'union',
		schema: s.union([Row, s.object({ kind: s.literal('other') })]),
		input: () => ({ id: 1, name: 'a' }),
		spoil: (v) => (v.name = 2),
		change: (v) => (v.name = 'b'),
		read: (o) => o.name,
		before: 'a',
		after: 'b'
	},
	{
		name: 'memo_union',
		schema: s.array(s.memo_union([Row, s.object({ kind: s.literal('other') })])),
		input: () => [{ id: 1, name: 'a' }],
		spoil: (v) => (v[0].name = 2),
		change: (v) => (v[0].name = 'b'),
		read: (o) => o[0].name,
		before: 'a',
		after: 'b'
	},
	{
		name: 'variant',
		schema: s.variant('type', [
			s.object({ type: s.literal('a'), value: s.number }),
			s.object({ type: s.literal('b'), value: s.string })
		]),
		input: () => ({ type: 'a', value: 1 }),
		spoil: (v) => (v.type = 'b'),
		change: (v) => (v.value = 2),
		read: (o) => o.value,
		before: 1,
		after: 2
	},
	{
		name: 'lazy',
		schema: s.lazy(() => Row),
		input: () => ({ id: 1, name: 'a' }),
		spoil: (v) => delete v.name,
		change: (v) => (v.name = 'b'),
		read: (o) => o.name,
		before: 'a',
		after: 'b'
	}
];

// puts a spoiled input back as it was made, the same object
const restore = (input: any, fresh: any): void => {
	if (Array.isArray(input)) {
		input.length = 0;
		input.push(...fresh);
		return;
	}
	for (const key of Object.keys(input)) delete input[key];
	Object.assign(input, fresh);
};

describe('a parse reads its input afresh', () => {
	for (const c of CASES) {
		test(`${c.name}: an input changed in place after a parse`, () => {
			// spoiled after a match, and then restored, many times over, as a timing calls it
			const input = c.input();
			for (let i = 0; i < 3; i++) {
				const first = s.parse(c.schema, input);
				assert(first.ok, c.name);
				assert(s.is(c.schema, input), c.name);
				const spoiled = c.input();
				c.spoil(input);
				c.spoil(spoiled);
				assert(!s.parse(c.schema, input).ok, c.name);
				assert(!s.is(c.schema, input), c.name);
				assert(!s.parse(c.schema, spoiled).ok, c.name);
				restore(input, c.input());
			}

			// a value changed in place reaches the output of the next parse
			const output = s.parse_or_throw(c.schema, input);
			assert.strictEqual(c.read(output), c.before, c.name);
			c.change(input);
			assert.strictEqual(c.read(s.parse_or_throw(c.schema, input)), c.after, c.name);
		});
	}
});
