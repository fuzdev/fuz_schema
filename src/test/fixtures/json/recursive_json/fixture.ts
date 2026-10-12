import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// any JSON value but one that holds a number that is not a whole one, as a
// recursive union: the lazy is the root, and its options come back to it
const json: s.AnySchema = s.lazy(() =>
	s.union([
		s.literal(null),
		s.boolean,
		s.pipe(s.number, s.integer),
		s.string,
		s.array(json),
		s.record(json)
	])
);

const nested = (depth: number, leaf: string): string =>
	`${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`;

export const fixture: JsonFixture = {
	schema: json,
	cases: {
		null: 'null',
		true: 'true',
		integer: '12',
		integer_as_float: '12.0',
		fraction: '1.5',
		string: '"a"',
		empty_array: '[]',
		empty_object: '{}',
		mixed: '{"a":[1,"b",null,{"c":[true,[[]],{}]}],"d":{"e":{"f":2}}}',
		fraction_in_array: '[1,2,[3,[4.5]]]',
		fraction_in_object: '{"a":{"b":{"c":0.1}}}',
		fraction_first: '[0.5,{"a":1}]',
		// each array and object is matched as it is read, by the one option it
		// could match, so every occurrence of a key is checked
		duplicate_last_good: { text: '{"a":1.5,"a":1}', diverges: 'duplicate_keys' },
		duplicate_last_bad: '{"a":1,"a":1.5}',
		proto_key: '{"__proto__":{"a":1.5}}',
		depth_100: nested(100, '1'),
		depth_100_fraction: nested(100, '1.5'),
		depth_127: nested(127, ''),
		depth_126_fraction: nested(126, '0.5'),
		depth_128: { text: nested(128, ''), diverges: 'depth_limit' },
		depth_200_fraction: { text: nested(200, '1.5'), diverges: 'depth_limit' }
	}
};
