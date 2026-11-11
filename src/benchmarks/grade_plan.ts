/**
 * What `grade` plans before it runs a process: how many instances of each
 * version a process holds, the cases timed apart by default, the scenarios
 * cold start samples, and the arms of each kind of job. Kept apart from
 * `grade.ts`, which runs as it is loaded, so a test can hold the names here to
 * the cases and scenarios they name, and the arms to what a process needs.
 *
 * @module
 */

import type { GradeJob, GradeJobArm } from './grade_job.ts';

/** How many module instances of each version a timing process holds. */
export const INSTANCES = 3;

/**
 * How many processes of each version a case of the `apart` regime is timed in,
 * a run. A process there stands where an instance does in the other regimes,
 * so it is the same count, and the same reading of them.
 */
export const APART_PROCESSES = INSTANCES;

/**
 * The cases timed apart by default: mostly ones the engine folds whole in a
 * process that runs nothing else, each of another construction. Such a case is where
 * a change to the state a process shares shows, as little else is left of
 * the parse to hide it.
 *
 * - an array of primitives, small and large, where a parse is the array's
 *   loop and a call an item
 * - the same through a wrapper
 * - a flat object, its loop over its entries
 * - a recursive schema, which runs a `lazy` itself
 *
 * The recursive one is not folded. It is here as the case that uses a `lazy`
 * itself, so a change to `lazy` is read apart on what it is for.
 */
export const APART_CASES: ReadonlyArray<string> = [
	'each/string/valid',
	'each/optional_present/valid',
	'scale/array_10_numbers/valid',
	'object/6_keys/valid',
	'real/docinfo_types/valid'
];

/** The scenarios cold start samples: one small schema, one large, and an app's many. */
export const COLDSTART_SCENARIOS: ReadonlyArray<string> = ['object_flat', 'type_json', 'app'];

/** The files of the two versions a grade loads, both in one directory. */
export interface GradePaths {
	baseline_path: string;
	new_path: string;
}

/**
 * The arms of a timing process of `matrix` or `alone`: the versions in turn,
 * so that neither's instances are all loaded first, and the graded one's
 * last, which is where a process looks for it.
 */
export const to_time_arms = ({ baseline_path, new_path }: GradePaths): GradeJob['arms'] =>
	Array.from({ length: INSTANCES }, (_, i) => [
		{ id: `base${i}`, path: baseline_path, graded: false },
		{ id: `new${i}`, path: new_path, graded: true }
	]).flat();

/**
 * The arms of a bytes process: two of each version, so that a case whose
 * bytes are not settled shows as one, and a version allocates more only
 * where both of its instances say so.
 */
export const to_bytes_arms = ({ baseline_path, new_path }: GradePaths): GradeJob['arms'] => [
	{ id: 'base0', path: baseline_path, graded: false },
	{ id: 'new0', path: new_path, graded: true },
	{ id: 'base1', path: baseline_path, graded: false },
	{ id: 'new1', path: new_path, graded: true }
];

/**
 * The arms of a process of the `apart` regime: one version, as an instance
 * that uses the library and one that is timed.
 */
export const to_apart_arms = (paths: GradePaths, graded: boolean): Array<GradeJobArm> => {
	const path = graded ? paths.new_path : paths.baseline_path;
	return [
		{ id: 'user', path, graded, program: true },
		{ id: graded ? 'new0' : 'base0', path, graded }
	];
};

/** Items in at most `count` chunks of one size, the last the smaller. */
export const to_chunks = <T>(items: Array<T>, count: number): Array<Array<T>> => {
	const size = Math.ceil(items.length / count);
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size)
	);
};
