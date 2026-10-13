import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';

import { find_survey_disagreements, load_survey_lib } from '../benchmarks/survey_rows.ts';
import {
	SURVEY_DOES,
	SURVEY_LIBS,
	SURVEY_SHAPES,
	to_survey_row_name
} from '../benchmarks/survey_shapes.ts';

// the survey only compares like with like if every library gives the verdict
// a row names, or the row says which doesn't
describe('survey shape parity', () => {
	test('every library gives the verdict each input names and one output, or is declared not to', async () => {
		const modules = Object.fromEntries(
			await Promise.all(SURVEY_LIBS.map(async (lib) => [lib, await load_survey_lib(lib)]))
		);
		assert.deepEqual(find_survey_disagreements(modules), []);
	});

	test('a row named for the depth of its issue has its first issue that deep', () => {
		const wrong: Array<string> = [];
		for (const shape of SURVEY_SHAPES) {
			const { schema } = shape.fuz_schema(s);
			for (const [name, input] of Object.entries(shape.inputs)) {
				const depth =
					input.does === 'issue at the root' ? 0 : /^issue at depth (\d+)$/.exec(input.does)?.[1];
				if (depth === undefined) continue;
				const result = schema && s.parse(schema, input.value);
				const length = result && !result.ok ? result.issues[0]!.path.length : undefined;
				if (length !== Number(depth)) {
					wrong.push(`${to_survey_row_name(shape.name, name)}: ${input.does}, path of ${length}`);
				}
			}
		}
		assert.deepEqual(wrong, []);
	});

	test('every kind of row has a row', () => {
		const does = new Set(
			SURVEY_SHAPES.flatMap((shape) => Object.values(shape.inputs).map((input) => input.does))
		);
		assert.sameMembers([...does], [...SURVEY_DOES]);
	});
});
