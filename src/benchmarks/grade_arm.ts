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
 * Nothing here is shared with another arm, so this module imports the cases
 * and nothing of the harness.
 *
 * @module
 */

import { CASE_GROUPS, create_case, create_cases, type Case, type SchemaLib } from './cases.ts';

/** Tells one arm's instance of the case matrix from another's. */
export const instance: unknown = CASE_GROUPS;

/** Builds every case the arm's library supports, for the matrix. With `strict`, a group that throws fails it. */
export const build_cases = (lib: SchemaLib, strict: boolean): Array<Case> =>
	create_cases(lib, strict);

/** Builds one case and as little else as it can, for a process that runs that case alone. With `strict`, a group that throws on the way fails it. */
export const build_case = (lib: SchemaLib, name: string, strict: boolean): Case | undefined =>
	create_case(lib, name, strict);
