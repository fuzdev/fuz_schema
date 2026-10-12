import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';
import { SCHEMA_JSON_MAX_NESTING } from '../../../schema_json.ts';

// as many wrappers, lazies, unions, and pipes around one value as there can be,
// at every level of a recursive schema
const nest = (schema: s.AnySchema, levels: number): s.AnySchema => {
	let nested = schema;
	for (let i = 0; i < levels; i++) {
		const inner = nested;
		nested = [
			(): s.AnySchema => s.nullable(inner),
			(): s.AnySchema => s.union([s.bigint, inner]),
			(): s.AnySchema => s.lazy(() => inner),
			(): s.AnySchema => s.optional(inner),
			(): s.AnySchema => s.with_default(inner, null)
		][i % 5]!();
	}
	return nested;
};

// the pipe is the innermost step, and the lazy that comes back is the outermost
const list: s.AnySchema = s.lazy(() =>
	nest(s.union([s.pipe(s.string, s.max_length(1)), s.array(list)]), SCHEMA_JSON_MAX_NESTING - 3)
);

export const fixture: JsonFixture = {
	schema: list,
	cases: {
		string: '"a"',
		long_string: '"ab"',
		null: 'null',
		number: '1',
		empty: '[]',
		nested: '[["a",null,[[]]],"b",[null]]',
		nested_wrong: '[["a",null,[[1]]],"b"]',
		nested_long_string: '[[[["ab"]]]]',
		object: '{}',
		deepest: `${'['.repeat(127)}${']'.repeat(127)}`,
		deepest_wrong: `${'['.repeat(127)}0${']'.repeat(127)}`,
		too_deep: { text: `${'['.repeat(128)}${']'.repeat(128)}`, diverges: 'depth_limit' }
	}
};
