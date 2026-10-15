/**
 * A survey of this library against Valibot and Zod over many small shapes,
 * to see where another library is ahead: `survey_shapes.ts` has the shapes,
 * and a row is one input of one.
 *
 * It is a benchmark and no gate. The scenarios of `run.ts` are a few schemas
 * for every library, each with one figure for a match and one for a miss.
 * Here a row is one thing a parse does, and the summary is by that: which
 * kinds of work this library is ahead on, and which not.
 *
 * It times as `run.ts` does, in a process for each library and in passes: see
 * `timing_passes.ts`. **Two regimes**, the same two. By default a library's
 * process builds every shape and runs every row before it times any, so each
 * is timed in library code that has seen many schemas. With `--alone` every
 * row has a process of its own, which builds its shape and runs only that
 * row: what a program with one schema pays, and many more processes.
 *
 * Before anything is timed every library is held to the verdict each input
 * names, here and again in each process.
 *
 * Usage:
 *   npm run benchmark:survey
 *   npm run benchmark:survey -- --filter object/ --lib valibot
 *   npm run benchmark:survey -- --alone --passes 5 --duration 300
 *
 * @module
 */

import { fileURLToPath } from 'node:url';

import { meta, parse_args, s } from './args.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_table,
	geometric_mean,
	has_some_allocation_node_flag,
	hold_benchmark_lock
} from './measure.ts';
import {
	find_survey_disagreements,
	is_survey_row_of,
	load_survey_lib,
	type SurveyRowsOf
} from './survey_rows.ts';
import {
	SURVEY_DOES,
	SURVEY_LIBS,
	SURVEY_SHAPES,
	to_survey_row_name,
	type SurveyDoes,
	type SurveyLibName
} from './survey_shapes.ts';
import { TIMING_PRELUDE_MS } from './timing_job.ts';
import {
	TIMING_CALL_ROW,
	format_spread,
	time_units,
	to_pooled_timing,
	type TimingPlan,
	type TimingUnit
} from './timing_passes.ts';

/** This library, which every row is of and every ratio is taken from. */
const SUBJECT_LIB: SurveyLibName = 'fuz_schema';
const OTHER_LIBS = SURVEY_LIBS.filter((lib) => lib !== SUBJECT_LIB);

const Names = s.pipe(
	s.union([s.string, s.array(s.string)]),
	s.transform((v: string | Array<string>) => (Array.isArray(v) ? v : [v]))
);

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	filter: meta(s.optional(s.string), {
		description: 'only time rows whose name includes this'
	}),
	lib: meta(s.optional(Names), {
		description: `the libraries to compare this one with, defaulting to ${OTHER_LIBS.join(' and ')}`
	}),
	duration: meta(
		s.with_default(
			s.pipe(
				s.number,
				s.check((n: number) => n > 0, '> 0')
			),
			150
		),
		{ description: 'measurement ms per row of each library, shared out over the passes' }
	),
	passes: meta(s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(1)), 3), {
		description: 'how many times the whole is repeated, in fresh processes'
	}),
	alone: meta(s.with_default(s.boolean, false), {
		description: 'a process for each row of each library, not one for each library'
	})
});

const args = parse_args(Args);

const unknown = (args.lib ?? []).filter((name) => !OTHER_LIBS.some((lib) => lib === name));
if (unknown.length) {
	console.error(
		`no library ${unknown.join(', ')} to compare with: there are ${OTHER_LIBS.join(' and ')}`
	);
	process.exit(1);
}
const others = OTHER_LIBS.filter((lib) => !args.lib || args.lib.includes(lib));
const libs: Array<SurveyLibName> = [SUBJECT_LIB, ...others];
if (has_some_allocation_node_flag()) {
	console.error(
		`the survey times under the flags a consumer has: take \`${ALLOCATION_NODE_FLAGS}\` off ` +
			'the command line and out of NODE_OPTIONS'
	);
	process.exit(1);
}

interface Row {
	name: string;
	does: SurveyDoes;
	/** The libraries it is timed for. */
	libs: Array<SurveyLibName>;
}

const rows: Array<Row> = SURVEY_SHAPES.flatMap((shape) =>
	Object.entries(shape.inputs).map(([input_name, input]) => ({
		name: to_survey_row_name(shape.name, input_name),
		does: input.does,
		libs: libs.filter((lib) => is_survey_row_of(shape, input, lib))
	}))
).filter((row) => !args.filter || row.name.includes(args.filter));
if (!rows.length) {
	console.error('no rows matched');
	process.exit(1);
}

hold_benchmark_lock('fuz_schema survey');

// a survey only compares like with like if every library gives the verdict a
// row names, or the row says which doesn't
const modules = Object.fromEntries(
	await Promise.all(SURVEY_LIBS.map(async (lib) => [lib, await load_survey_lib(lib)]))
) as Record<SurveyLibName, unknown>;
const disagreements = find_survey_disagreements(modules);
if (disagreements.length) {
	console.error(disagreements.join('\n'));
	process.exit(1);
}

// A row is warmed this long before its timing. A process that holds one row
// has everything still to compile, so it warms for longer. The rows are many
// and small, so both are shorter than `run.ts` has them.
const WARM_MS = { shared: 60, alone: 250 };
const regime = args.alone ? 'alone' : 'shared';
const plan: TimingPlan = {
	module: fileURLToPath(new URL('./survey_rows.ts', import.meta.url)),
	prelude: !args.alone,
	warm_ms: WARM_MS[regime],
	duration_ms: args.duration / args.passes
};

const to_unit_id = (lib: string, row: string): string => (args.alone ? `${lib} ${row}` : lib);

const units: Array<TimingUnit> = libs.flatMap((lib): Array<TimingUnit> => {
	const of_lib = rows.filter((row) => row.libs.includes(lib)).map((row) => row.name);
	if (!args.alone) {
		// the process holds every shape, whichever rows are timed
		const of: SurveyRowsOf = { lib };
		return of_lib.length ? [{ id: lib, of, rows: of_lib }] : [];
	}
	return of_lib.map((row) => {
		const of: SurveyRowsOf = { lib, rows: [row] };
		return { id: to_unit_id(lib, row), of, rows: [row] };
	});
});

const format_seconds = (seconds: number): string =>
	seconds < 90 ? `${Math.round(seconds)}s` : `${(seconds / 60).toFixed(1)} min`;

// what a process takes to start and load a library, fitted to runs of this
const PROCESS_SECONDS = 0.25;
const row_seconds = (plan.warm_ms + plan.duration_ms) / 1000;
const all_rows = SURVEY_SHAPES.reduce((sum, shape) => sum + Object.keys(shape.inputs).length, 0);
// a process also times a function that does nothing, as it does a row
const pass_seconds = units.reduce(
	(sum, unit) =>
		sum +
		PROCESS_SECONDS +
		(args.alone ? 0 : (all_rows * TIMING_PRELUDE_MS) / 1000) +
		(unit.rows!.length + 1) * row_seconds,
	0
);

console.log(
	`survey: ${SUBJECT_LIB} against ${others.join(' and ')} on ${rows.length} ` +
		`${rows.length === 1 ? 'row' : 'rows'}, ` +
		(args.alone ? 'a process for each row of each library' : 'a process for each library') +
		`, ${args.passes} ${args.passes === 1 ? 'pass' : 'passes'}, ` +
		`about ${format_seconds(pass_seconds * args.passes)}\n`
);

const readings = await time_units(units, plan, args.passes, (pass, ms) => {
	console.log(`pass ${pass + 1} of ${args.passes}: ${format_seconds(ms / 1000)}`);
});

const format_ns = (ns: number): string =>
	ns >= 100 ? ns.toFixed(0) : ns >= 10 ? ns.toFixed(1) : ns.toFixed(2);

/** What the passes read of one row in one library. */
interface Timed {
	ns: number;
	spread: number;
}

const to_timed = (lib: SurveyLibName, row: Row): Timed | undefined => {
	if (!row.libs.includes(lib)) return undefined;
	const passes = readings.get(to_unit_id(lib, row.name))!.get(row.name)!.ns;
	const { median, spread } = to_pooled_timing(passes);
	return { ns: median, spread };
};

const call_ns = units.map(
	(unit) => to_pooled_timing(readings.get(unit.id)!.get(TIMING_CALL_ROW)!.ns).median
);
// A time at or under this is mostly the call it was timed through: twice what
// a function that does nothing took, at the most a process read of it.
const CALL_FLOOR_CALLS = 2;
const call_floor_ns = CALL_FLOOR_CALLS * Math.max(...call_ns);

/** A row beside another library: this library's time over the other's, and whether the other is ahead. */
interface Compared {
	ratio: number;
	/** Either time is at the call floor, so the ratio is mostly of two calls and is not marked. */
	floor: boolean;
	/**
	 * The other library is faster by more than the two spreads together, and
	 * neither time is at the call floor. Never of one pass, which has no spread.
	 */
	ahead: boolean;
}

const compare = (subject: Timed, other: Timed | undefined): Compared | undefined => {
	if (!other) return undefined;
	const floor = Math.min(subject.ns, other.ns) <= call_floor_ns;
	return {
		ratio: subject.ns / other.ns,
		floor,
		// a spread of one pass is `NaN`, which nothing is past
		ahead: !floor && subject.ns - other.ns > subject.ns * subject.spread + other.ns * other.spread
	};
};

const compared_rows = rows.map((row) => {
	const subject = to_timed(SUBJECT_LIB, row)!;
	const timed = others.map((lib) => to_timed(lib, row));
	return { row, subject, timed, compared: timed.map((t) => compare(subject, t)) };
});

console.log(
	`\nsurvey, ${regime}: nanoseconds per parse, the median of the passes, beside the spread, which is ` +
		'half of\nwhat the passes range over. `x` is this library over the other: under one it is ' +
		'ahead. `<` marks a row\nthe other library is ahead on, `~` one at the call floor, and `-` is ' +
		'a row the other library has\nno equivalent of.\n'
);
console.log(
	format_table(
		[
			['row', 'does', SUBJECT_LIB, 'spread', ...others.flatMap((lib) => [lib, 'spread', 'x'])],
			...compared_rows.map(({ row, subject, timed, compared }) => [
				row.name,
				row.does,
				format_ns(subject.ns),
				format_spread(subject.spread),
				...others.flatMap((_, i) => {
					const t = timed[i];
					const c = compared[i];
					return t && c
						? [
								format_ns(t.ns),
								format_spread(t.spread),
								c.ratio.toFixed(2) + (c.ahead ? '<' : c.floor ? '~' : ' ')
							]
						: ['-', '-', '-'];
				})
			])
		],
		2
	)
);

console.log(
	'\nby what a row does: the geometric mean of the ratios, the rows at the call floor left out, ' +
		'and how\nmany of the rows the other library is ahead on\n'
);
console.log(
	format_table([
		['does', 'rows', ...others.flatMap((lib) => [`x ${lib}`, 'ahead'])],
		...[...SURVEY_DOES, 'all' as const].flatMap((does) => {
			const of_does = compared_rows.filter((c) => does === 'all' || c.row.does === does);
			if (!of_does.length) return [];
			return [
				[
					does,
					String(of_does.length),
					...others.flatMap((_, i) => {
						const compared = of_does.map((c) => c.compared[i]).filter((c) => c !== undefined);
						// a row at the call floor is mostly a ratio of two calls, so it is in no mean
						const past_floor = compared.filter((c) => !c.floor);
						return compared.length
							? [
									past_floor.length
										? geometric_mean(past_floor.map((c) => c.ratio)).toFixed(2)
										: '-',
									String(compared.filter((c) => c.ahead).length)
								]
							: ['-', '-'];
					})
				]
			];
		})
	])
);

for (const [i, lib] of others.entries()) {
	const ahead = compared_rows.filter((c) => c.compared[i]?.ahead);
	console.log(
		`\n${lib} is ahead on ${ahead.length} of ${compared_rows.filter((c) => c.compared[i]).length} rows` +
			(ahead.length
				? ':\n' + ahead.map((c) => `  ${c.row.name} ${c.compared[i]!.ratio.toFixed(2)}x`).join('\n')
				: '')
	);
}

console.log(
	`\nEvery figure has a call in it: a function that does nothing takes ${format_ns(Math.min(...call_ns))} to ` +
		`${format_ns(Math.max(...call_ns))} ns\nthrough the loop the rows are timed in, across the processes. ` +
		`A row where either library takes\n${format_ns(call_floor_ns)} ns or less, twice that, is at the call floor: ` +
		'it is marked `~`, its ratio is mostly of\ntwo calls, it is in no mean of the summary, and it is never marked `<`.'
);
console.log(
	'\n`<` is a row where the other library is faster by more than the two spreads together, ' +
		"this\nlibrary's and its own, and neither time is at the call floor." +
		(args.passes === 1 ? ' One pass has no spread, so no row is marked.' : '')
);
console.log(
	'\nA gap inside the spreads is not a finding, and a spread is of a few passes. ' +
		(args.alone
			? "Each row had a process\nof its own: the engine specialized the library to that row's schema."
			: "Each library's process ran\nevery row before it timed any: `--alone` gives each row a process of its own.")
);
