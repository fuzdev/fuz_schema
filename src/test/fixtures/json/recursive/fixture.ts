import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const tree: s.AnySchema = s.object({
	value: s.number,
	children: s.array(s.lazy(() => tree))
});

/** A chain of `levels` nodes, each the only child of the one before, which nests twice per level. */
const chain = (levels: number, leaf = '{"value":0,"children":[]}'): string =>
	`${'{"value":1,"children":['.repeat(levels - 1)}${leaf}${']}'.repeat(levels - 1)}`;

export const fixture: JsonFixture = {
	schema: tree,
	cases: {
		leaf: '{"value":1,"children":[]}',
		small:
			'{"value":1,"children":[{"value":2,"children":[]},{"value":3,"children":[{"value":4,"children":[]}]}]}',
		other_order: '{"children":[{"children":[],"value":2}],"value":1}',
		missing_children: '{"value":1}',
		missing_inner_children: '{"value":1,"children":[{"value":2}]}',
		wrong_inner_value: '{"value":1,"children":[{"value":"2","children":[]}]}',
		wrong_deep_value: chain(10, '{"value":null,"children":[]}'),
		wrong_everywhere:
			'{"value":"a","children":[{"value":"b","children":[1,{"children":{}}]},null],"extra":1}',
		child_not_object: '{"value":1,"children":[1]}',
		unknown_inner_key: '{"value":1,"children":[{"value":2,"children":[],"extra":1}]}',
		array: '[]',
		levels_10: chain(10),
		levels_50: chain(50),
		// two levels of JSON per node: the deepest the crate's parser reads
		levels_63: chain(63),
		levels_63_wrong_leaf: chain(63, '{"value":0,"children":[null]}'),
		levels_64: { text: chain(64), diverges: 'depth_limit' },
		levels_100: { text: chain(100), diverges: 'depth_limit' },
		levels_100_wrong_leaf: { text: chain(100, 'null'), diverges: 'depth_limit' },
		// stopped at the first node, before any depth
		levels_100_wrong_root: {
			text: `{"value":"x","children":[${chain(99)}]}`,
			diverges: 'depth_limit_unread'
		}
	}
};
