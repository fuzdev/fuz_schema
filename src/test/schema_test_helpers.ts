import { assert } from 'vitest';

import * as s from '#lib/schema.ts';

/** Parses `value`, asserts it fails, and returns the issues. */
export const issues_of = (schema: s.AnySchema, value: unknown): Array<s.SchemaIssue> => {
	const result = s.parse(schema, value);
	assert(!result.ok);
	return result.issues;
};

/** Calls `fn`, asserts it throws a `SchemaError`, and returns the error. */
export const assert_schema_error = (fn: () => unknown): s.SchemaError => {
	let thrown: unknown;
	try {
		fn();
	} catch (error) {
		thrown = error;
	}
	assert(thrown instanceof s.SchemaError, 'expected a SchemaError to be thrown');
	return thrown;
};

/**
 * A schema of the kind `regex` over any pattern, written by hand: `regex`
 * refuses a pattern with the `g` or `y` flag, and the modules that read a
 * schema by its `kind` and `def` still say what they do with one.
 */
export const regex_of_any_flags = (pattern: RegExp): s.Schema<string, string, 'regex', RegExp> => ({
	kind: 'regex',
	def: pattern,
	run: (value, ctx) => (pattern.test(value) ? value : s.fail(ctx, 'regex', value))
});

/**
 * A schema that runs as `schema` does and calls `on_run` first, each time. Its
 * `run` has the `length` of the schema's, so what holds it chooses the closure
 * it would for the schema itself: the one that hands the object and the key
 * on, or the one that doesn't.
 */
export const spy_on_run = (schema: s.AnySchema, on_run: () => void): s.AnySchema => ({
	kind: schema.kind,
	def: schema.def,
	run:
		schema.run.length > 2
			? (value, ctx, parent, key) => (on_run(), schema.run(value, ctx, parent, key))
			: (value, ctx) => (on_run(), schema.run(value, ctx))
});

/**
 * Calls `fn` and asserts it throws an `Error` whose message is exactly
 * `message`: a refusal says what it refuses and where, and a part of its
 * text matched would pass a message that came to say another place.
 */
export const assert_throws_exactly = (fn: () => unknown, message: string): void => {
	try {
		fn();
	} catch (error) {
		assert(error instanceof Error, `threw what is no Error: ${message}`);
		assert.strictEqual(error.message, message);
		return;
	}
	assert.fail(`did not throw: ${message}`);
};
