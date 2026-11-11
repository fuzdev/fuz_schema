/**
 * The names of the libraries under comparison, in display order, each the
 * basename of a module in `libs/`. `libs.ts` holds the modules themselves, and
 * `src/test/benchmarks.test.ts` holds its `LIBS` to this list.
 *
 * This module imports nothing, so a script that only names the libraries, to
 * start a process for each or to check one by `tsc`, loads none of them.
 *
 * @module
 */

export const LIB_NAMES = [
	'fuz_schema',
	'valibot',
	'zod',
	'zod_mini',
	'typebox',
	'arktype'
] as const;
export type LibName = (typeof LIB_NAMES)[number];
