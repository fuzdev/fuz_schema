/**
 * The rows of one library for `survey.ts`, loaded by a process
 * `timing_child.ts` is: a row for each input of each shape the library has.
 *
 * The library is imported by name, and no other, so the process holds one
 * library. A shape's rows share its schema, as a consumer's inputs do.
 *
 * @module
 */

import { isDeepStrictEqual } from 'node:util';

import type { ScenarioRunner } from './scenarios.ts';
import {
	SURVEY_LIBS,
	SURVEY_SHAPES,
	to_survey_row_name,
	type SurveyInput,
	type SurveyLibName,
	type SurveyRun,
	type SurveyShape
} from './survey_shapes.ts';
import type { LoadTimingRows, TimingRow } from './timing_job.ts';

/** What a process of `survey.ts` holds. */
export interface SurveyRowsOf {
	lib: SurveyLibName;
	/** The rows to build, with the rest of their shapes' rows, every shape's when left out. */
	rows?: Array<string>;
}

/** Imports one library, as a shape's builder takes it. */
export const load_survey_lib = (lib: SurveyLibName): Promise<unknown> =>
	lib === 'fuz_schema' ? import('#lib/schema.ts') : import(lib);

/**
 * Builds a shape's schema in one library.
 *
 * @param module - the library, as `load_survey_lib` returns it
 * @returns the shape in that library, or `undefined` when the shape leaves the library out
 */
export const create_survey_run = (
	shape: SurveyShape,
	lib: SurveyLibName,
	module: unknown
): SurveyRun | undefined => {
	// each builder is typed to its own library, which the name picks
	const create = shape[lib] as ((module: unknown) => SurveyRun) | undefined;
	return create?.(module);
};

/** Whether a row is timed for a library: the shape has it, and it gives the verdict the input names. */
export const is_survey_row_of = (
	shape: SurveyShape,
	input: SurveyInput,
	lib: SurveyLibName
): boolean => !!shape[lib] && !input.differs?.[lib];

// a verdict, where a throw is a miss: `parse_or_throw` and its like
const to_verdict = (matches: ScenarioRunner, value: unknown): boolean => {
	try {
		return matches(value);
	} catch {
		return false;
	}
};

/**
 * Holds every library to what the shapes say of it: the verdict each input
 * names, or the other one where the input says the library differs, one
 * output from the libraries that match an input, and a reason wherever a
 * shape leaves a library out or returns no output. A verdict alone would pass
 * a shape that drops a key in one library and keeps it in another.
 *
 * @param modules - the libraries, each as `load_survey_lib` returns it
 * @returns what is wrong, a line each, none when the shapes are right
 */
export const find_survey_disagreements = (
	modules: Record<SurveyLibName, unknown>
): Array<string> => {
	const wrong: Array<string> = [];
	const names: Set<string> = new Set();
	for (const shape of SURVEY_SHAPES) {
		if (names.has(shape.name)) wrong.push(`${shape.name}: two shapes of the name`);
		names.add(shape.name);
		const runs = SURVEY_LIBS.map((lib) => create_survey_run(shape, lib, modules[lib]));
		for (const [i, lib] of SURVEY_LIBS.entries()) {
			const run = runs[i];
			if (!run === !shape.skips?.[lib]) {
				wrong.push(
					`${shape.name}: ${lib} ` +
						(run ? 'has a builder and a reason it has none' : 'has no builder and no reason')
				);
			}
			if (!run) continue;
			if (!run.output === !shape.no_output) {
				wrong.push(
					`${shape.name}: ${lib} ` +
						(run.output ? 'gives an output the shape says it has none of' : 'gives no output')
				);
			}
			for (const [name, input] of Object.entries(shape.inputs)) {
				const differs = !!input.differs?.[lib];
				const verdict = to_verdict(run.matches, input.value);
				if (verdict !== (input.valid !== differs)) {
					wrong.push(
						`${to_survey_row_name(shape.name, name)}: ${lib} returned ${verdict}` +
							(differs ? ', which it is declared to differ from' : '')
					);
				}
			}
		}
		// on an input that matches, what each other library returns is what this one does
		const subject = runs[0];
		for (const [name, input] of Object.entries(shape.inputs)) {
			if (!input.valid || !subject?.output) continue;
			const expected = subject.output(input.value);
			for (const [i, lib] of SURVEY_LIBS.entries()) {
				const output = runs[i]?.output;
				if (i === 0 || !output || input.differs?.[lib]) continue;
				if (!isDeepStrictEqual(output(input.value), expected)) {
					wrong.push(
						`${to_survey_row_name(shape.name, name)}: ${lib} returned another output than ${SURVEY_LIBS[0]}`
					);
				}
			}
		}
		for (const [name, input] of Object.entries(shape.inputs)) {
			for (const lib of Object.keys(input.differs ?? {}) as Array<SurveyLibName>) {
				if (lib === 'fuz_schema' || !shape[lib]) {
					wrong.push(`${to_survey_row_name(shape.name, name)}: ${lib} can't be declared to differ`);
				}
			}
		}
	}
	return wrong;
};

export const load_rows: LoadTimingRows = async (of: SurveyRowsOf) => {
	const module = await load_survey_lib(of.lib);
	const rows: Array<TimingRow> = [];
	for (const shape of SURVEY_SHAPES) {
		const inputs = Object.entries(shape.inputs).filter(
			([name, input]) =>
				is_survey_row_of(shape, input, of.lib) &&
				(!of.rows || of.rows.includes(to_survey_row_name(shape.name, name)))
		);
		if (!inputs.length) continue;
		const { matches } = create_survey_run(shape, of.lib, module)!;
		for (const [input_name, { value, valid }] of inputs) {
			const name = to_survey_row_name(shape.name, input_name);
			if (to_verdict(matches, value) !== valid) {
				throw new Error(`${name}: ${of.lib} returned ${!valid}`);
			}
			// a match is told from a miss by what is returned, so the answer is read.
			// A row that matches is one whose runner doesn't throw
			rows.push({ name, run: () => (matches(value) ? true : undefined) });
		}
	}
	return rows;
};
