/**
 * The command-line args of the benchmark scripts, parsed through an instance
 * of the library of their own: `schema.ts` and `meta.ts` imported under the
 * query `?args`, as `grade_child.ts` imports an arm under `?arm=`. A script's
 * `Args` is built with this module's `s` and `meta` and parsed with
 * `parse_args`, whose `args_parse` runs it through the `@fuzdev/fuz_schema`
 * fuz_util imports, so parsing it runs no function of the instance a
 * measurement uses. The query reaches only the two modules it is put on, which
 * import nothing at runtime; a runtime import added to either is shared with
 * the measured instance.
 *
 * Imported only by the scripts a benchmark is started from, never by a module
 * a measured process loads.
 *
 * @module
 */

import { args_parse, argv_parse, type ArgValue } from '@fuzdev/fuz_util/args.ts';

import type * as Schema from '#lib/schema.ts';
import type * as Meta from '#lib/meta.ts';

const ARGS_QUERY = '?args';

/** The library, an instance apart from the one any measurement uses. */
export const s: typeof Schema = await import(
	new URL('../lib/schema.ts', import.meta.url).href + ARGS_QUERY
);

/**
 * `meta` of the args instance, whose registry no measured schema is in. It
 * records a description and nothing `args_parse` reads: fuz_util reads
 * metadata through the `@fuzdev/fuz_schema` it imports, whose registry this
 * isn't, so an alias given here is never expanded.
 */
export const { meta }: typeof Meta = await import(
	new URL('../lib/meta.ts', import.meta.url).href + ARGS_QUERY
);

/**
 * Parses the process's args with `Args`, a schema of the args instance,
 * printing each issue and exiting on failure.
 */
export const parse_args = <T extends Record<string, ArgValue>>(Args: Schema.Schema<T, any>): T => {
	const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
	if (!parsed.ok) {
		console.error(parsed.issues.map(s.format_issue).join('\n'));
		process.exit(1);
	}
	return parsed.value;
};
