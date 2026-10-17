import { assert } from 'vitest';

import * as s from '#lib/schema.ts';

/** Parses `value`, asserts it fails, and returns the issues. */
export const issues_of = (schema: s.AnySchema, value: unknown): Array<s.SchemaIssue> => {
	const result = s.parse(schema, value);
	assert(!result.ok);
	return result.issues;
};
