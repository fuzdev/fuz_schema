import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';

import {
	create_survey_run,
	find_survey_disagreements,
	is_survey_row_of,
	load_survey_lib
} from '../benchmarks/survey_rows.ts';
import {
	SURVEY_DOES,
	SURVEY_LIBS,
	SURVEY_SHAPES,
	to_survey_builder_name,
	to_survey_row_name,
	to_survey_skip
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
			const { schema } = shape.fuz_schema(s, undefined);
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

	test("this library compiled is this library's builder, compiled once a shape, but where a shape says it has no form of it", async () => {
		const module = await load_survey_lib('fuz_schema_compiled');
		// how many functions a builder makes from text, which is what a compile does
		const original = globalThis.Function;
		let count = 0;
		globalThis.Function = new Proxy(original, {
			construct: (target, args) => {
				// counted once made, so a compile the environment refused counts none
				const made = Reflect.construct(target, args);
				count++;
				return made;
			}
		});
		const left_out: Array<string> = [];
		const wrong: Array<string> = [];
		try {
			for (const shape of SURVEY_SHAPES) {
				const before = count;
				const run = create_survey_run(shape, 'fuz_schema_compiled', module);
				const skip = to_survey_skip(shape, 'fuz_schema_compiled');
				if (!run) left_out.push(shape.name);
				if (!run !== (skip !== undefined)) wrong.push(`${shape.name}: left out with no reason`);
				// one schema a shape, compiled as the shape is built, and the interpreter makes none
				if (count - before !== (run ? 1 : 0))
					wrong.push(`${shape.name}: ${count - before} compiles`);
				shape.fuz_schema(s, undefined);
				if (count - before !== (run ? 1 : 0)) wrong.push(`${shape.name}: the interpreter compiled`);
				for (const input of Object.values(shape.inputs)) {
					if (is_survey_row_of(shape, input, 'fuz_schema_compiled') !== !!run) {
						wrong.push(`${shape.name}: timed where it has no run, or not where it has one`);
					}
				}
				// and a call makes none, as a timing calls it
				const built = count;
				for (const input of Object.values(shape.inputs)) run?.matches(input.value);
				if (count !== built) wrong.push(`${shape.name}: ${count - built} compiles in its calls`);
			}
		} finally {
			globalThis.Function = original;
		}
		assert.deepEqual(wrong, []);
		// the one shape that calls `parse_or_throw`, which a compiled parse has no form of
		assert.deepEqual(left_out, ['throw_string']);
		// it reads this library's builder and differences, and no shape says this library differs
		assert.strictEqual(to_survey_builder_name('fuz_schema_compiled'), 'fuz_schema');
		assert.strictEqual(SURVEY_LIBS[0], 'fuz_schema');
		for (const shape of SURVEY_SHAPES) {
			assert.strictEqual(to_survey_skip(shape, 'fuz_schema'), undefined, shape.name);
		}
	});

	test('every kind of row has a row', () => {
		const does = new Set(
			SURVEY_SHAPES.flatMap((shape) => Object.values(shape.inputs).map((input) => input.does))
		);
		assert.sameMembers([...does], [...SURVEY_DOES]);
	});
});
