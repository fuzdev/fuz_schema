import * as s from '#lib/schema.ts';
import { SCHEMA_JSON_MAX_DEPTH, SCHEMA_JSON_MAX_NESTING } from '#lib/schema_json.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// the deepest frames the evaluators take: at every level of the deepest text
// the parser reads, an array in a pipe inside as many unions as fit around one
// value, the most nesting there may be, so that a build with small stacks,
// as the wasm one is, runs out of none
const deepest: s.AnySchema = s.lazy(() => {
	let schema: s.AnySchema = s.pipe(s.array(deepest), s.min_length(0));
	// the lazy and the pipe are two of the nesting
	for (let i = 0; i < SCHEMA_JSON_MAX_NESTING - 2; i++) schema = s.union([s.bigint, schema]);
	return schema;
});

const nested = (depth: number, leaf: string): string =>
	`${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`;

export const fixture: JsonFixture = {
	schema: deepest,
	cases: {
		empty: '[]',
		deepest: nested(SCHEMA_JSON_MAX_DEPTH, ''),
		// the innermost value a number, which none of the options takes
		deepest_wrong: nested(SCHEMA_JSON_MAX_DEPTH - 1, '1'),
		past_deepest: { text: nested(SCHEMA_JSON_MAX_DEPTH + 1, ''), diverges: 'depth_limit' }
	}
};
