/**
 * A small program that uses every kind of schema, for the `apart` regime of
 * `grade`: one schema of each kind the library makes, each built and run on
 * an input that matches and one that doesn't.
 *
 * A process that times one case has used only what that case reaches. A
 * change that costs every schema once some other schema has run, such as a
 * `lazy` that writes to itself on first use, costs such a process nothing
 * unless its case happens to hold a `lazy`. So a process of the `apart`
 * regime runs this first, the same for either version, and its case is then
 * timed in a process where every kind has been used, as in a program that
 * uses the library and not only one schema of it.
 *
 * It takes the library as a parameter, as the cases do, so each version runs
 * its own. `src/test/shape_test_helpers.ts` has a fuller list of the same
 * sort, bound to the working tree's library and with what a test needs. This
 * one is a deliberate second list, kept short: `src/test/program.test.ts`
 * holds it to every kind that one has.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

import type { SchemaLib } from './cases.ts';

export interface ProgramEntry {
	/** The export that makes the schema, or of the action the schema is a `pipe` of. */
	name: string;
	/** Builds the schema. */
	create: (s: SchemaLib) => schema_lib.AnySchema;
	/** An input that matches. */
	valid: unknown;
	/** One that doesn't, or `undefined` where every input matches. */
	invalid?: unknown;
}

interface ProgramTree {
	value: string;
	next?: ProgramTree;
}

/**
 * The program: an entry for every kind of schema, and for the exports that
 * make a schema with no kind of their own. An action is run inside a `pipe`,
 * as it is used.
 */
export const PROGRAM: ReadonlyArray<ProgramEntry> = [
	{ name: 'string', create: (s) => s.string, valid: 'a', invalid: 1 },
	{ name: 'number', create: (s) => s.number, valid: 1, invalid: 'a' },
	{ name: 'boolean', create: (s) => s.boolean, valid: true, invalid: 1 },
	{ name: 'bigint', create: (s) => s.bigint, valid: 1n, invalid: 1 },
	{ name: 'unknown', create: (s) => s.unknown, valid: 1 },
	{ name: 'literal', create: (s) => s.literal('a'), valid: 'a', invalid: 'b' },
	{ name: 'one_of', create: (s) => s.one_of(['a', 1]), valid: 1, invalid: 'b' },
	{ name: 'optional', create: (s) => s.optional(s.string), valid: undefined, invalid: 1 },
	{ name: 'nullable', create: (s) => s.nullable(s.string), valid: null, invalid: 1 },
	{
		name: 'with_default',
		create: (s) => s.with_default(s.string, 'd'),
		valid: undefined,
		invalid: 1
	},
	{
		name: 'with_default_fn',
		create: (s) => s.with_default_fn(s.array(s.string), () => []),
		valid: undefined,
		invalid: 1
	},
	{ name: 'lazy', create: (s) => s.lazy(() => s.string), valid: 'a', invalid: 1 },
	{ name: 'message', create: (s) => s.message(s.string, 'm'), valid: 'a', invalid: 1 },
	{ name: 'flavor', create: (s) => s.flavor(s.string, 'Flavor'), valid: 'a', invalid: 1 },
	{ name: 'brand', create: (s) => s.brand(s.string, 'Brand'), valid: 'a', invalid: 1 },
	{
		name: 'object',
		create: (s: SchemaLib): schema_lib.AnySchema => {
			// a recursive one, so a `lazy` is run as an entry too
			const tree: schema_lib.Schema<ProgramTree> = s.object({
				value: s.string,
				next: s.optional(s.lazy(() => tree))
			});
			return tree;
		},
		valid: { value: 'a', next: { value: 'b' } },
		invalid: { value: 'a', next: { value: 1 } }
	},
	{
		name: 'loose_object',
		create: (s) => s.loose_object({ a: s.string, c: s.with_default(s.number, 1) }),
		valid: { a: 'a', d: 1 },
		invalid: { a: 1 }
	},
	{
		name: 'strip_object',
		create: (s) => s.strip_object({ a: s.string, c: s.optional(s.number) }),
		valid: { a: 'a', d: 1 },
		invalid: { a: 1 }
	},
	{
		name: 'object_with_rest',
		create: (s) => s.object_with_rest({ a: s.string, c: s.with_default(s.number, 1) }, s.number),
		valid: { a: 'a', d: 1 },
		invalid: { a: 'a', d: 'd' }
	},
	{ name: 'record', create: (s) => s.record(s.number), valid: { a: 1 }, invalid: { a: 'a' } },
	{ name: 'array', create: (s) => s.array(s.string), valid: ['a'], invalid: ['a', 1] },
	{ name: 'union', create: (s) => s.union([s.string, s.number]), valid: 1, invalid: true },
	{
		name: 'variant',
		create: (s) =>
			s.variant('k', [
				s.object({ k: s.literal('a'), v: s.string }),
				s.object({ k: s.literal('b'), v: s.number })
			]),
		valid: { k: 'b', v: 1 },
		invalid: { k: 'c' }
	},
	{ name: 'pipe', create: (s) => s.pipe(s.string, s.min_length(2)), valid: 'ab', invalid: 1 },
	{
		name: 'min_length',
		create: (s) => s.pipe(s.string, s.min_length(2)),
		valid: 'ab',
		invalid: 'a'
	},
	{
		name: 'max_length',
		create: (s) => s.pipe(s.string, s.max_length(2)),
		valid: 'ab',
		invalid: 'abc'
	},
	{ name: 'min_value', create: (s) => s.pipe(s.number, s.min_value(1)), valid: 1, invalid: 0 },
	{ name: 'max_value', create: (s) => s.pipe(s.number, s.max_value(1)), valid: 1, invalid: 2 },
	{ name: 'integer', create: (s) => s.pipe(s.number, s.integer), valid: 1, invalid: 1.5 },
	{
		name: 'safe_integer',
		create: (s) => s.pipe(s.number, s.safe_integer),
		valid: 1,
		invalid: 2 ** 60
	},
	{ name: 'regex', create: (s) => s.pipe(s.string, s.regex(/^a/)), valid: 'a', invalid: 'b' },
	{
		name: 'check',
		create: (s) =>
			s.pipe(
				s.number,
				s.check((v: number) => v > 0)
			),
		valid: 1,
		invalid: 0
	},
	{
		name: 'transform',
		create: (s) =>
			s.pipe(
				s.number,
				s.transform((v: number) => v + 1)
			),
		valid: 1,
		invalid: 'a'
	}
];

// how many times each input is run each way, enough that a `run` which
// changes itself after its first calls has
const PROGRAM_ROUNDS = 4;

/**
 * Builds every entry's schema and runs it, through `parse` and through `is`,
 * on both of its inputs.
 *
 * @param strict - whether an entry that throws or gives the wrong answer fails the whole, where otherwise the version goes without it. For a version that is to have every entry, as the one a grade is of, where another may have an older API.
 * @returns how many entries ran
 * @throws Error when `strict` and an entry throws or gives the wrong answer, naming it
 */
export const run_program = (s: SchemaLib, strict = false): number => {
	let ran = 0;
	for (const entry of PROGRAM) {
		try {
			const schema = entry.create(s);
			const inputs: Array<[unknown, boolean]> = [[entry.valid, true]];
			if ('invalid' in entry) inputs.push([entry.invalid, false]);
			for (const [input, valid] of inputs) {
				for (let round = 0; round < PROGRAM_ROUNDS; round++) {
					if (s.parse(schema, input).ok !== valid || s.is(schema, input) !== valid) {
						throw new Error(`expected ${valid ? 'a match' : 'no match'}`);
					}
				}
			}
			ran++;
		} catch (error) {
			if (strict) {
				throw new Error(
					`the program's \`${entry.name}\` did not run: ` +
						(error instanceof Error ? error.message : String(error)),
					{ cause: error }
				);
			}
		}
	}
	return ran;
};
