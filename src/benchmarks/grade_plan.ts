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
 * - the same with a default at its last entry, whose parse copies the
 *   object, so a change to the copy is read apart too
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
	'object/7_keys_last_defaulted/valid',
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

/**
 * A job of a grade.
 *
 * @param offset - moves on which arm is loaded first and which order leads
 */
export const to_grade_job = (
	mode: GradeJob['mode'],
	regime: GradeJob['regime'],
	cases: Array<string>,
	offset: number,
	arms: Array<GradeJobArm>,
	slice_ms: number
): GradeJob => ({ mode, regime, arms, cases, slice_ms, offset });

/** A job of the `apart` regime, and which version its process holds. */
export interface GradeApartJob {
	graded: boolean;
	job: GradeJob;
}

/**
 * The jobs of one case apart in one run, in the order they run:
 * `APART_PROCESSES` processes of each version, a process of one and then of
 * the other, and which goes first moves on by a process, a case, and a run.
 * The two versions' jobs at one place differ in the path of their arms, the
 * id of the timed one, and which is graded, and in nothing else.
 *
 * @param index - the case's place among the cases apart
 */
export const to_apart_jobs = (
	paths: GradePaths,
	name: string,
	run: number,
	index: number,
	slice_ms: number
): Array<GradeApartJob> =>
	Array.from({ length: APART_PROCESSES }, (_, at) =>
		((run + index + at) % 2 ? [true, false] : [false, true]).map((graded): GradeApartJob => ({
			graded,
			job: to_grade_job('time', 'apart', [name], run + at, to_apart_arms(paths, graded), slice_ms)
		}))
	).flat();

/** Items in at most `count` chunks of one size, the last the smaller. */
export const to_chunks = <T>(items: Array<T>, count: number): Array<Array<T>> => {
	const size = Math.ceil(items.length / count);
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size)
	);
};

/** The name of the file under the grader's directory that a grade measuring holds. */
export const GRADE_LOCK_FILE = 'lock';

/**
 * What a lock file says of the grade that wrote it:
 *
 * - `free` - there is none
 * - `held` - a process of its pid is alive, as another grade still measuring
 * - `stale` - none of its pid is, as a grade that was killed leaves
 * - `unreadable` - it names no pid
 */
export type GradeLockState =
	| { state: 'free' }
	| { state: 'held'; pid: number }
	| { state: 'stale'; pid: number }
	| { state: 'unreadable'; text: string };

/**
 * Reads a lock file's text. Two grades at once in one checkout write the same
 * copies of the two versions, which each other's processes load, so a grade
 * measures only while it holds the lock.
 *
 * @param text - the file's text, `undefined` where there is none
 * @param is_alive - whether a process of a pid is alive
 */
export const to_grade_lock_state = (
	text: string | undefined,
	is_alive: (pid: number) => boolean
): GradeLockState => {
	if (text === undefined) return { state: 'free' };
	const pid = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
	if (!Number.isSafeInteger(pid) || pid <= 0) return { state: 'unreadable', text };
	return is_alive(pid) ? { state: 'held', pid } : { state: 'stale', pid };
};
