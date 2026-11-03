/**
 * One arm of a grading process: its copy of the case matrix.
 *
 * `grade_child.ts` loads this module once for each arm, under a URL of the
 * arm's own, and its imports with it, and loads the loops of `timing.ts` the
 * same way. So every arm has its own functions for the cases and for the
 * loops they are called from, and the engine keeps what it learns about one
 * arm's calls apart from the next arm's. A loop shared by two arms is
 * specialized to the first it is given, and two arms holding the same library
 * then read apart, so each arm has its own.
 *
 * Nothing here is shared with another arm, so this module imports the cases,
 * the program a process of the `apart` regime runs first, and nothing of the
 * harness.
 *
 * The `create` cases are built with a second instance of the arm's library,
 * which only they call. The engine pretenures by allocation site, from how
 * many objects of a site survive a collection: the factories that build the
 * case matrix, whose schemas live as long as the process, are pretenured or
 * not by where the collections fall in each arm's build, and a creation
 * through them read far slower in some arms of one file than in others.
 *
 * @module
 */

import {
	CASE_GROUPS,
	CREATE_GROUP,
	create_case,
	create_cases,
	type Case,
	type SchemaLib
} from './cases.ts';
import { run_program } from './program.ts';

/** Tells one arm's instance of the case matrix from another's. */
export const instance: unknown = CASE_GROUPS;

const PARSE_GROUPS = CASE_GROUPS.filter((group) => group !== CREATE_GROUP);

/**
 * Builds every case the arm's library supports, for the matrix. With `strict`,
 * a group that throws fails it.
 *
 * @param lib - the arm's library, which every case through `parse` is built and run with
 * @param create_lib - another instance of the same, which only the `create` cases call
 */
export const build_cases = (
	lib: SchemaLib,
	create_lib: SchemaLib,
	strict: boolean
): Array<Case> => [
	...create_cases(lib, strict, PARSE_GROUPS),
	...create_cases(create_lib, strict, [CREATE_GROUP])
];

/**
 * Builds one case and as little else as it can, for a process that runs that
 * case alone. With `strict`, a group that throws on the way fails it.
 *
 * @param lib - the arm's library, for a case through `parse`
 * @param create_lib - another instance of the same, for a `create` case
 */
export const build_case = (
	lib: SchemaLib,
	create_lib: SchemaLib,
	name: string,
	strict: boolean
): Case | undefined =>
	name.startsWith('create/')
		? create_case(create_lib, name, strict, [CREATE_GROUP])
		: create_case(lib, name, strict, PARSE_GROUPS);

/** Runs the program of `program.ts` with the arm's library, for a process of the `apart` regime. With `strict`, an entry that fails fails it. */
export const run_arm_program = (lib: SchemaLib, strict: boolean): number =>
	run_program(lib, strict);
