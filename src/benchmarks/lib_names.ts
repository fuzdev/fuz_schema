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
	'zod_compiled',
	'zod_mini',
	'typebox',
	'arktype'
] as const;

/** The name of a library under comparison, and of its module in `libs/`. */
export type LibName = (typeof LIB_NAMES)[number];

/**
 * The libraries that keep the schema of a definition and hand it back when
 * the same definition is built again, as ArkType does for a `type` (and not
 * for a `scope`). A figure that builds a scenario's schema from its one
 * definition again and again, the creation figures of `allocations.ts` and the
 * retained heap per further schema of `run_heap.ts`, reads far lower for one
 * of them than an app's distinct definitions cost it, where it hands the
 * schema back: those cells are marked with `INTERNED_MARK`.
 */
export const INTERNING_LIBS: ReadonlyArray<LibName> = ['arktype'];

/** What marks a figure of a library in `INTERNING_LIBS` that its keeping flatters. */
export const INTERNED_MARK = '†';

/**
 * A figure of schemas built from one definition again, with `INTERNED_MARK`
 * after it for a library of `INTERNING_LIBS` where it hands the schema back.
 *
 * @param kept - whether building the scenario's schema again hands back the
 *   one built before, `is_scenario_schema_kept`
 */
export const format_interned_figure = (lib: LibName, figure: string, kept: boolean): string =>
	kept && INTERNING_LIBS.includes(lib) ? figure + INTERNED_MARK : figure;
