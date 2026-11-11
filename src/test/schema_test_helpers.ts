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
