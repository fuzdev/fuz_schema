/**
 * The command-line args of the benchmark scripts, parsed through an instance
 * of the library of their own: `schema.ts` and `meta.ts` imported under the
 * query `?args`, as `grade_child.ts` imports an arm under `?arm=`. A script's
 * `Args` is built with this module's `s` and `meta` and parsed with
 * `parse_args`, whose `args_parse` runs it through the `@fuzdev/fuz_schema`
 * fuz_util imports, so parsing it runs no function of the instance a
 * measurement uses. The query reaches only the two modules it is put on, which
 * import nothing at runtime; a runtime import added to either is shared with
 * the measured instance. The registry of metadata is shared with it too, as
 * with every copy of `meta.ts`: data, which no measurement reads.
 *
 * The arg schemas the scripts share are here too, so a name a script doesn't
 * know is refused in one way everywhere, and `--help` prints each arg of a
 * script's `Args` with its default and its description.
 *
 * Imported only by the scripts a benchmark is started from, never by a module
 * a measured process loads.
 *
 * @module
 */

import { args_parse, argv_parse, type ArgValue } from '@fuzdev/fuz_util/args.ts';

import type * as Schema from '#lib/schema.ts';
import type * as Meta from '#lib/meta.ts';
import { LIB_NAMES } from './lib_names.ts';
import { SCENARIOS } from './scenarios.ts';

const ARGS_QUERY = '?args';

/** The library, an instance apart from the one any measurement uses. */
export const s: typeof Schema = await import(
	new URL('../lib/schema.ts', import.meta.url).href + ARGS_QUERY
);

/**
 * `meta` of the args instance. fuz_util reads metadata through the
 * `@fuzdev/fuz_schema` it imports, so what this attaches, an alias included,
 * reaches `args_parse` only when that installed copy keeps its registry on
 * `globalThis` as this one does. One that keeps a registry of its own reads
 * nothing attached here.
 */
export const { meta, get_meta }: typeof Meta = await import(
	new URL('../lib/meta.ts', import.meta.url).href + ARGS_QUERY
);

/**
 * An arg of names, given once or more, each one of `known`: an array of them,
 * in the order given. A name not among them is refused with the names there
 * are, in the same words by every script.
 *
 * @param noun - what one name is of, as `library`
 * @param plural - the same of many, as `libraries`
 */
export const to_names_arg = <T extends string>(
	noun: string,
	plural: string,
	known: ReadonlyArray<T>
): Schema.Schema<Array<T>, string | Array<string>> =>
	s.pipe(
		s.union([s.string, s.array(s.string)]),
		s.transform((v: string | Array<string>) => (Array.isArray(v) ? v : [v])),
		s.message(
			s.check((names: Array<string>) => names.every((name) => known.includes(name as T))),
			(_, names) =>
				`no ${noun} ${(names as Array<string>).filter((name) => !known.includes(name as T)).join(', ')}: ` +
				`the ${plural} are ${known.join(', ')}`
		)
	) as any;

/** The names of libraries, any of `LIB_NAMES`. */
export const LibNamesArg = to_names_arg('library', 'libraries', LIB_NAMES);

/** The names of scenarios, any of `SCENARIOS`. */
export const ScenarioNamesArg = to_names_arg(
	'scenario',
	'scenarios',
	SCENARIOS.map((scenario) => scenario.name)
);

/** Milliseconds of a timing, past zero, `fallback` when not given. */
export const to_duration_arg = (fallback: number): Schema.Schema<number, number | undefined> =>
	s.with_default(
		s.pipe(
			s.number,
			s.check((n: number) => n > 0, '> 0')
		),
		fallback
	);

/** A count of at least `min`, `fallback` when not given. */
export const to_count_arg = (
	fallback: number,
	min = 1
): Schema.Schema<number, number | undefined> =>
	s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(min)), fallback);

// what `--help` prints of an arg's default: what it is filled in with
const to_default_text = (schema: Schema.AnySchema): string | undefined => {
	const node = schema as Schema.SchemaNode;
	if (node.kind === 'with_default') return JSON.stringify(node.def.value);
	if (node.kind === 'with_default_fn') return JSON.stringify(node.def.make());
	return undefined;
};

/**
 * The text `--help` prints: each arg of `Args` with its default and its
 * description, and none of the `no-` args that only turn another off.
 */
export const format_args_help = (Args: Schema.AnySchema): string => {
	const entries: Record<string, Schema.AnySchema> = (Args as Schema.SchemaNode).def as any;
	const names = Object.keys(entries);
	const rows = names
		.filter((name) => name !== '_' && !(name.startsWith('no-') && names.includes(name.slice(3))))
		.map((name) => {
			const fallback = to_default_text(entries[name]!);
			return [
				`--${name}`,
				fallback === undefined ? '' : `default ${fallback}`,
				(get_meta(entries[name]!)?.description ?? '') +
					(names.includes(`no-${name}`) ? `, off with --no-${name}` : '')
			];
		});
	const widths = [0, 1].map((i) => Math.max(...rows.map((row) => row[i]!.length)));
	return rows
		.map((row) =>
			`  ${row[0]!.padEnd(widths[0]!)}  ${row[1]!.padEnd(widths[1]!)}  ${row[2]}`.trimEnd()
		)
		.join('\n');
};

/**
 * Parses the process's args with `Args`, a schema of the args instance,
 * printing each issue and exiting on failure. With `--help` it prints the
 * args instead, see `format_args_help`, and exits.
 */
export const parse_args = <T extends Record<string, ArgValue>>(Args: Schema.Schema<T, any>): T => {
	const argv = argv_parse(process.argv.slice(2));
	if (argv.help) {
		console.log(`args:\n${format_args_help(Args)}`);
		process.exit(0);
	}
	const parsed = args_parse(argv, Args);
	if (!parsed.ok) {
		console.error(parsed.issues.map(s.format_issue).join('\n'));
		process.exit(1);
	}
	return parsed.value;
};
