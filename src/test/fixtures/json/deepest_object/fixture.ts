import * as s from '#lib/schema.ts';
import { SCHEMA_JSON_MAX_DEPTH, SCHEMA_JSON_MAX_NESTING } from '#lib/schema_json.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// at every level of the deepest text the parser reads, a record inside as
// many unions as fit around one value, each with an option that comes back
// and fails at once, so that the crate keeps the verdicts of every one of
// them, and is asked through the frames that keep them
const deepest: s.AnySchema = s.lazy(() => {
	let schema: s.AnySchema = s.record(deepest);
	// the lazy is one of the nesting
	for (let i = 0; i < SCHEMA_JSON_MAX_NESTING - 1; i++) {
		schema = s.union([s.object({ t: s.literal('never'), a: deepest }), schema]);
	}
	return schema;
});

const nested = (depth: number, leaf: string): string =>
	`${'{"a":'.repeat(depth)}${leaf}${'}'.repeat(depth)}`;

export const fixture: JsonFixture = {
	schema: deepest,
	cases: {
		empty: '{}',
		deepest: nested(SCHEMA_JSON_MAX_DEPTH - 1, '{}'),
		// the innermost value a number, which none of the options takes
		deepest_wrong: nested(SCHEMA_JSON_MAX_DEPTH - 1, '1'),
		past_deepest: { text: nested(SCHEMA_JSON_MAX_DEPTH, '{}'), diverges: 'depth_limit' }
	}
};
