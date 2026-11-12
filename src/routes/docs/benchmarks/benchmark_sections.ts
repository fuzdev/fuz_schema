/**
 * The sections of the benchmarks page, read from a results file: each a list
 * of `MatrixGroup`s, built here so the page and the landing summary draw the
 * same rows and no component reduces a number of its own.
 *
 * A section the file didn't measure gives no groups, and a cell that is not a
 * number becomes an entry that says what it is in its place.
 *
 * The results schema is taken as types only: the file is validated where it
 * is read, in the server loads.
 *
 * @module
 */

import type {
	BenchmarkData,
	BenchmarkId,
	BenchmarkLib,
	BenchmarkMissing,
	BenchmarkResults
} from '../../../benchmarks/results_schema.ts';
import { format_bytes, format_ms, format_ns } from './benchmark_format.ts';
import {
	to_geomean_row,
	to_matrix_row,
	to_value_entry,
	type MatrixColumn,
	type MatrixEntry,
	type MatrixGroup,
	type MatrixRow,
	type MatrixValue
} from './benchmark_matrix.ts';
import { to_geomean, to_spread_band, type ValueBand } from './benchmark_ratio.ts';

/**
 * One color per library, by its place in the roster, so a library's bars are
 * the same color in every chart. The ratio beside a bar carries the verdict,
 * colored by the ratio scale.
 */
export const LIB_COLORS: ReadonlyArray<string> = [
	'var(--palette_d_40)',
	'var(--palette_g_40)',
	'var(--palette_h_40)',
	'var(--palette_i_40)',
	'var(--palette_a_40)',
	'var(--palette_e_40)',
	'var(--palette_j_40)',
	'var(--palette_f_40)'
];

/** The color of the library at `index` in the roster, cycling past the last. */
export const to_lib_color = (index: number): string => LIB_COLORS[index % LIB_COLORS.length]!;

/** The roster as columns, in its order. */
export const to_lib_columns = (libs: ReadonlyArray<BenchmarkLib>): Array<MatrixColumn> =>
	libs.map((lib, i) => ({
		id: lib.id,
		label: lib.label,
		by_maintainer: lib.by_maintainer,
		color: to_lib_color(i),
		note: lib.note,
		notes: lib.notes
	}));

/** The data of a section, or null when the file didn't measure it. */
export const to_section_data = <TId extends BenchmarkId>(
	results: BenchmarkResults,
	id: TId
): BenchmarkData[TId] | null => {
	const section = results[id];
	return section.status === 'measured' ? (section.data as BenchmarkData[TId]) : null;
};

const is_missing = (cell: object): cell is BenchmarkMissing => 'none' in cell;

/** What a cell with no number reads, by why it has none. */
export const MISSING_TEXT: Readonly<Record<BenchmarkMissing['none'], string>> = {
	uncompiled: 'not compiled',
	no_equivalent: 'no equivalent',
	differs: 'other verdict'
};

const to_missing_entry = (cell: BenchmarkMissing): MatrixEntry => ({
	kind: 'none',
	text: MISSING_TEXT[cell.none],
	why: cell.why
});

/** What marks a figure of one kept definition repeated, and what the mark says. */
export const INTERNED_MARK = {
	text: '†',
	title:
		'the library hands back the schema it built before for the same definition, so this is of one schema kept and not of the distinct schemas an app defines'
};

const to_interned_options = (interned: boolean): Partial<MatrixValue> =>
	interned ? { mark: INTERNED_MARK, unranked: INTERNED_MARK.title } : {};

const to_entries = <T>(
	libs: Readonly<Record<string, T>>,
	to_entry: (cell: T, lib: string) => MatrixEntry
): Record<string, MatrixEntry> =>
	Object.fromEntries(Object.entries(libs).map(([lib, cell]) => [lib, to_entry(cell, lib)]));

/**
 * What a figure of heap bytes a parse allocates, or building a schema does,
 * repeats within, as a share of it: a row of `benchmark:allocations` repeats
 * within about a percent from process to process, which the benchmarks'
 * documentation says under "Reading the numbers". The script takes one figure
 * a process and has no spread of its own, so this stands in for one: two such
 * figures whose one-percent bands overlap are level.
 */
export const ALLOCATION_TOLERANCE = 0.01;

/**
 * What a retained-heap total repeats to, in bytes either side of it: about a
 * kilobyte, by the same passage of the documentation.
 */
export const HEAP_TOTAL_TOLERANCE_BYTES = 1000;

/**
 * What a retained-heap figure per further schema repeats to, in bytes either
 * side of it: the documentation has it within a byte, and this allows two.
 */
export const HEAP_FURTHER_TOLERANCE_BYTES = 2;

// a figure with a stated tolerance in its own unit either side, never under zero
const to_tolerance_band = (value: number, tolerance: number): ValueBand => ({
	low: Math.max(0, value - tolerance),
	high: value + tolerance
});

/** The measures a bundle is reported in, the one the page leads with first. */
export const SIZE_MEASURES = ['gzip', 'brotli', 'minified'] as const;
export type SizeMeasure = (typeof SIZE_MEASURES)[number];

/**
 * Bundle size: every scenario in one bundle, then each scenario's own, in one
 * measure. Bytes are exact, so no row has a spread.
 *
 * @returns the group, or null when the file measured no bundle
 */
export const to_size_group = (
	results: BenchmarkResults,
	measure: SizeMeasure
): MatrixGroup | null => {
	const data = to_section_data(results, 'bundle');
	if (!data) return null;
	const to_row = (key: string, label: string, libs: (typeof data)['all']): MatrixRow =>
		to_matrix_row({
			key: `size:${measure}:${key}`,
			label,
			unit: 'bytes',
			direction: 'lower',
			entries: to_entries(libs, (sizes) => to_value_entry(sizes[measure]))
		});
	return {
		key: `size:${measure}`,
		label:
			measure === 'minified'
				? 'Minified'
				: `Minified and ${measure === 'gzip' ? 'gzipped' : 'brotli-compressed'}`,
		note: null,
		rows: [
			{ ...to_row('all', 'every scenario in one bundle', data.all), kind: 'summary' },
			...data.rows.map((row) => to_row(row.scenario, row.scenario, row.libs))
		]
	};
};

/** The three questions a scenario is timed on, with how the page names each. */
export const TIME_INPUTS = [
	{ id: 'valid', label: 'Parsing valid input' },
	{ id: 'invalid', label: 'Rejecting invalid input' },
	{ id: 'guard', label: 'Answering only whether it matches' }
] as const;
export type TimeInput = (typeof TIME_INPUTS)[number]['id'];

/**
 * How many times what a function that does nothing takes a time may be and
 * still be at the call floor, which is the survey script's rule: at twice the
 * call or under, a time is mostly the call it was timed through.
 */
export const CALL_FLOOR_CALLS = 2;

/** The call floor of the parse-time rows: `CALL_FLOOR_CALLS` of the slowest empty call. */
export const to_run_call_floor = (data: BenchmarkData['run']): number =>
	CALL_FLOOR_CALLS * data.call.max_ns;

/**
 * Parse time: a group for each of `TIME_INPUTS`, led by the geometric mean
 * over the scenarios every library has a figure of, then a row a scenario.
 * A row carries the call floor, read as the survey reads its own, and each
 * time its fastest and slowest pass, which a mean's band is made of.
 *
 * @returns the groups, none when the file timed no scenario
 */
export const to_time_groups = (results: BenchmarkResults): Array<MatrixGroup> => {
	const data = to_section_data(results, 'run');
	if (!data) return [];
	const columns = results.meta.libs.map((lib) => lib.id);
	const call_floor = to_run_call_floor(data);
	return TIME_INPUTS.flatMap(({ id, label }) => {
		const rows = data.rows
			.filter((row) => row.input === id)
			.map((row) =>
				to_matrix_row({
					key: `time:${id}:${row.scenario}`,
					label: row.scenario,
					unit: 'ns',
					direction: 'lower',
					call_floor,
					entries: to_entries(row.libs, (cell) =>
						is_missing(cell)
							? to_missing_entry(cell)
							: to_value_entry(cell.ns, {
									spread: cell.spread,
									band: { low: cell.min_ns, high: cell.max_ns },
									details: [
										`passes from ${format_ns(cell.min_ns)} to ${format_ns(cell.max_ns)}`,
										`median batch ${format_ns(cell.batch_ns)}`
									]
								})
					)
				})
			);
		const mean = to_geomean_row(rows, columns, `time:${id}`, 'every scenario');
		return mean ? [{ key: `time:${id}`, label, note: null, rows: [mean, ...rows] }] : [];
	});
};

/** The stages of a cold start, with how the page names each. */
const COLDSTART_STAGE_LABELS = [
	['import', 'import'],
	['create', 'and build the schema'],
	['first_parse', 'and parse once'],
	['parse_10', 'to the tenth parse'],
	['parse_100', 'to the hundredth parse']
] as const;

/** The stage a cold start is summarized by: everything up to one parse. */
export const COLDSTART_SUMMARY_STAGE = 'first_parse';

/**
 * Cold start: a group for each scenario in each form of entry, led by the
 * work inside a fresh process up to its first parse, then every stage, the
 * parses after the first, and what the first parse added to the whole
 * process and to its peak memory over a bare one.
 *
 * A stage's spread is half of its samples' p10 to p90 band. An addition to the
 * whole process is read against the bare process's own band: inside it the
 * addition can't be told from zero and is not ranked, and past it that band is
 * its spread. The parses after the first and the peak memory each carry half
 * of their own samples' p10 to p90 band as a spread where the file has it. A
 * file written before the script emitted those bands has figures with no
 * measure of what they range over, and their rows are then shown and not
 * compared.
 *
 * @returns the groups, none when the file measured no cold start
 */
export const to_coldstart_groups = (results: BenchmarkResults): Array<MatrixGroup> => {
	const data = to_section_data(results, 'coldstart');
	if (!data) return [];
	const { bare } = data;
	// a row whose figures have no band in the file is drawn and not ranked
	const to_unbanded_options = (banded: boolean): Partial<MatrixRow> =>
		banded
			? {}
			: {
					compared: false,
					note: 'one figure a library, with no measure of what it ranges over in this file: shown, not compared'
				};
	return data.rows.map((row) => {
		const libs = Object.values(row.libs);
		const key = `coldstart:${row.scenario}:${row.form}`;
		const to_row = (
			id: string,
			label: string,
			unit: MatrixRow['unit'],
			to_entry: (figures: (typeof row.libs)[string]) => MatrixEntry,
			options: Partial<MatrixRow> = {}
		): MatrixRow =>
			to_matrix_row({
				key: `${key}:${id}`,
				label,
				unit,
				direction: 'lower',
				entries: to_entries(row.libs, to_entry),
				...options
			});
		return {
			key,
			label: `${row.scenario}, ${row.form}`,
			note: null,
			rows: [
				...COLDSTART_STAGE_LABELS.map(([stage, label]) => ({
					...to_row(stage, label, 'ms', (figures) => {
						const { work_ms, band_ms } = figures.stages[stage];
						return to_value_entry(work_ms, {
							spread: work_ms > 0 ? band_ms / 2 / work_ms : null,
							details: [`p10 to p90 band ${format_ms(band_ms)}`]
						});
					}),
					kind: stage === COLDSTART_SUMMARY_STAGE ? ('summary' as const) : ('cell' as const)
				})),
				to_row(
					'later',
					'parses 2 to 100 alone',
					'ms',
					(figures) =>
						to_value_entry(figures.later_ms, {
							spread:
								figures.later_band_ms !== undefined && figures.later_ms > 0
									? figures.later_band_ms / 2 / figures.later_ms
									: null,
							details:
								figures.later_band_ms === undefined
									? []
									: [`p10 to p90 band ${format_ms(figures.later_band_ms)}`]
						}),
					to_unbanded_options(libs.every((figures) => figures.later_band_ms !== undefined))
				),
				to_row('process', 'the whole process, over a bare one', 'ms', (figures) =>
					figures.added_ms < bare.band_ms
						? to_value_entry(figures.added_ms, {
								text: `under ${format_ms(bare.band_ms)}`,
								unranked:
									"inside the bare process's own p10 to p90 band, so it can't be told from zero"
							})
						: to_value_entry(figures.added_ms, {
								spread: bare.band_ms / 2 / figures.added_ms,
								details: [
									`read against the bare process's p10 to p90 band, ${format_ms(bare.band_ms)}`
								]
							})
				),
				to_row(
					'memory',
					'peak memory, over a bare one',
					'bytes',
					(figures) =>
						figures.added_rss_kb <= 0
							? to_value_entry(0, { text: '≈ bare', unranked: 'no more than a bare process' })
							: to_value_entry(figures.added_rss_kb * 1024, {
									spread:
										figures.rss_band_kb === undefined
											? null
											: figures.rss_band_kb / 2 / figures.added_rss_kb,
									details:
										figures.rss_band_kb === undefined
											? []
											: [`p10 to p90 band ${format_bytes(figures.rss_band_kb * 1024)}`]
								}),
					to_unbanded_options(libs.every((figures) => figures.rss_band_kb !== undefined))
				)
			]
		};
	});
};

/**
 * Allocation: heap bytes a parse of valid input allocates, then one of
 * invalid input, then building a schema, a row a scenario. A figure is exact
 * for the code the engine is running, which is settled per process and not
 * always the same way, so each is read with `ALLOCATION_TOLERANCE` either side
 * of it. A figure of building one kept definition again is marked and not
 * ranked.
 *
 * @returns the groups, none when the file measured no allocation
 */
export const to_allocation_groups = (results: BenchmarkResults): Array<MatrixGroup> => {
	const data = to_section_data(results, 'allocations');
	if (!data) return [];
	const to_group = (
		id: 'valid_bytes' | 'invalid_bytes' | 'create_bytes',
		label: string
	): MatrixGroup => ({
		key: `allocation:${id}`,
		label,
		note: null,
		rows: data.rows.map((row) =>
			to_matrix_row({
				key: `allocation:${id}:${row.scenario}`,
				label: row.scenario,
				unit: 'bytes',
				direction: 'lower',
				entries: to_entries(row.libs, (figures) =>
					to_value_entry(figures[id], {
						band: to_spread_band(figures[id], ALLOCATION_TOLERANCE),
						...(id === 'create_bytes' ? to_interned_options(figures.interned) : {})
					})
				)
			})
		)
	});
	return [
		to_group('valid_bytes', 'A parse of valid input'),
		to_group('invalid_bytes', 'A parse of invalid input'),
		to_group('create_bytes', 'Building a schema')
	];
};

/**
 * The time to build a scenario's schema, warm, from the allocation
 * benchmark's processes, a row a scenario. It is timed once in one process a
 * library, so it has no measure of what it ranges over, and is shown and not
 * compared.
 *
 * @returns the group, or null when the file measured no allocation
 */
export const to_creation_group = (results: BenchmarkResults): MatrixGroup | null => {
	const data = to_section_data(results, 'allocations');
	if (!data) return null;
	return {
		key: 'creation',
		label: 'Building a schema, warm',
		note: 'one timing in one process a library: shown, not compared',
		rows: data.rows.map((row) =>
			to_matrix_row({
				key: `creation:${row.scenario}`,
				label: row.scenario,
				unit: 'ns',
				direction: 'lower',
				compared: false,
				entries: to_entries(row.libs, (figures) =>
					to_value_entry(figures.create_ns, to_interned_options(figures.interned))
				)
			})
		)
	};
};

/**
 * Retained heap: what a library holds after one schema is built and has
 * parsed once, over a bare process, then what each further schema adds, a row
 * a scenario. A total is read with `HEAP_TOTAL_TOLERANCE_BYTES` either side
 * of it and a figure per further schema with `HEAP_FURTHER_TOLERANCE_BYTES`,
 * what each repeats to. A figure per further schema of one kept definition
 * repeated is marked and not ranked.
 *
 * @returns the groups, none when the file measured no retained heap
 */
export const to_heap_groups = (results: BenchmarkResults): Array<MatrixGroup> => {
	const data = to_section_data(results, 'heap');
	if (!data) return [];
	const to_row = (
		id: string,
		scenario: string,
		libs: (typeof data.rows)[number]['libs'],
		to_entry: (figures: (typeof libs)[string]) => MatrixEntry
	): MatrixRow =>
		to_matrix_row({
			key: `heap:${id}:${scenario}`,
			label: scenario,
			unit: 'bytes',
			direction: 'lower',
			entries: to_entries(libs, to_entry)
		});
	return [
		{
			key: 'heap:total',
			label: 'Held after one schema is built and has parsed once',
			note: null,
			rows: data.rows.map((row) =>
				to_row('total', row.scenario, row.libs, (figures) =>
					to_value_entry(figures.total_bytes, {
						band: to_tolerance_band(figures.total_bytes, HEAP_TOTAL_TOLERANCE_BYTES),
						details: [
							`heap ${format_bytes(figures.heap_bytes)}`,
							`machine code ${format_bytes(figures.code_bytes)}`,
							`external ${format_bytes(figures.external_bytes)}`
						]
					})
				)
			)
		},
		{
			key: 'heap:further',
			label: 'Each further schema',
			note: `read between processes holding ${data.counts.few} schemas and ${data.counts.many}`,
			rows: data.rows.map((row) =>
				to_row('further', row.scenario, row.libs, (figures) =>
					to_value_entry(figures.further_schema_bytes, {
						band: to_tolerance_band(figures.further_schema_bytes, HEAP_FURTHER_TOLERANCE_BYTES),
						...to_interned_options(figures.interned)
					})
				)
			)
		}
	];
};

/**
 * Type-checking cost: the instantiations of each library's scenario module
 * and of its schemas module with a consumer's reads, which are the same on
 * every run, then the check time of the first, which is not, so it is shown
 * and not compared.
 *
 * @returns the group, or null when the file measured no type-checking
 */
export const to_types_group = (results: BenchmarkResults): MatrixGroup | null => {
	const data = to_section_data(results, 'types');
	if (!data) return null;
	const to_details = (cost: (typeof data)['empty']): Array<string> => [
		`${cost.types.toLocaleString('en-US')} types`,
		`${format_bytes(cost.memory_kb * 1000)} of compiler memory`
	];
	return {
		key: 'types',
		label: 'What tsc reports of one file',
		note: null,
		rows: [
			to_matrix_row({
				key: 'types:module',
				label: 'instantiations, a module of every scenario',
				unit: 'count',
				direction: 'lower',
				entries: to_entries(data.modules, (cost) =>
					to_value_entry(cost.instantiations, { details: to_details(cost) })
				)
			}),
			to_matrix_row({
				key: 'types:reads',
				label: "instantiations, the schemas with a consumer's reads of what they infer",
				unit: 'count',
				direction: 'lower',
				entries: to_entries(data.with_reads, (cost) =>
					to_value_entry(cost.instantiations, {
						details: [
							`the reads add ${cost.reads_add.toLocaleString('en-US')}`,
							...to_details(cost)
						]
					})
				)
			}),
			to_matrix_row({
				key: 'types:check',
				label: 'check time, a module of every scenario',
				note: `the median of ${data.runs} ${data.runs === 1 ? 'run' : 'runs'}, which moves from run to run: shown, not compared`,
				unit: 'seconds',
				direction: 'lower',
				compared: false,
				entries: to_entries(data.modules, (cost) => to_value_entry(cost.check_s))
			})
		]
	};
};

/** How this library compares with one other over the survey rows of one kind. */
export interface SurveySummaryCell {
	/**
	 * The geometric mean of this library's time over the other's, without the
	 * rows at the call floor: under 1 this library is faster. Null with no row
	 * past the floor.
	 */
	ratio: number | null;
	/**
	 * What the mean ranges over: from the mean of the rows' ratios with this
	 * library at its least and the other at its most, to the mean with each the
	 * other way. Null with no row past the floor.
	 */
	band: ValueBand | null;
	/** Whether the band holds 1, so the mean says neither library is the faster. */
	level: boolean;
	/** The rows the other library is ahead on by more than the two spreads together. */
	ahead: number;
	/** The rows the two are compared on: the ones the other library has a figure of. */
	compared: number;
}

/** The survey rows of one kind of work, summarized against each other library. */
export interface SurveySummaryRow {
	/** What the rows' parses do, or `all` for every row. */
	does: string;
	/** How many rows there are of it, in this library. */
	rows: number;
	/** By library id. Null for a library with no figure of any of the rows. */
	others: Record<string, SurveySummaryCell | null>;
}

/** The kinds of work the survey has a row of, in the order the script summarizes them. */
export const to_survey_kinds = (data: BenchmarkData['survey']): Array<string> =>
	data.kinds.filter((kind) => data.rows.some((row) => row.does === kind));

/** The name of the summary row over every survey row. */
export const SURVEY_ALL = 'all';

/**
 * The survey by what a row does, as the script summarizes it: for each other
 * library the geometric mean of this library's time over its own, and how
 * many of the rows it is ahead on. A row where either time is at the call
 * floor is mostly a ratio of two calls, so it is in no mean and is never
 * counted as ahead, and a row of one pass has no spread, so it is never
 * counted either. A mean is read with its band, and one whose band holds 1 is
 * level: it names neither library the faster.
 *
 * @returns a row for each kind of work that has a row, in the order the script summarizes them, then one over every row
 */
export const to_survey_summary = (data: BenchmarkData['survey']): Array<SurveySummaryRow> => {
	const kinds = to_survey_kinds(data);
	return [...kinds, SURVEY_ALL].map((does) => {
		const rows = data.rows.filter((row) => does === SURVEY_ALL || row.does === does);
		return {
			does,
			rows: rows.length,
			others: Object.fromEntries(
				data.others.map((other) => {
					const ratios: Array<number> = [];
					const lows: Array<number> = [];
					const highs: Array<number> = [];
					let ahead = 0;
					let compared = 0;
					for (const row of rows) {
						const subject = row.libs[data.subject];
						const theirs = row.libs[other];
						if (!subject || !theirs || is_missing(subject) || is_missing(theirs)) continue;
						compared++;
						if (Math.min(subject.ns, theirs.ns) <= data.call_floor_ns) continue;
						ratios.push(subject.ns / theirs.ns);
						const ours = to_spread_band(subject.ns, subject.spread);
						const other_band = to_spread_band(theirs.ns, theirs.spread);
						lows.push(ours.low / other_band.high);
						// a spread of the whole number or more leaves no least reading to divide by
						highs.push(other_band.low > 0 ? ours.high / other_band.low : Infinity);
						if (
							subject.spread !== null &&
							theirs.spread !== null &&
							subject.ns - theirs.ns > subject.ns * subject.spread + theirs.ns * theirs.spread
						) {
							ahead++;
						}
					}
					const ratio = to_geomean(ratios);
					const band = ratio === null ? null : { low: to_geomean(lows)!, high: to_geomean(highs)! };
					return [
						other,
						compared
							? {
									ratio,
									band,
									level: band !== null && band.low <= 1 && 1 <= band.high,
									ahead,
									compared
								}
							: null
					];
				})
			)
		};
	});
};

/**
 * The survey row by row: a group for each kind of work, each row one input of
 * one shape, with the call floor every ratio is read against.
 *
 * @returns the groups, none when the file ran no survey
 */
export const to_survey_groups = (results: BenchmarkResults): Array<MatrixGroup> => {
	const data = to_section_data(results, 'survey');
	if (!data) return [];
	return to_survey_kinds(data).map((does) => ({
		key: `survey:${does}`,
		label: does,
		note: null,
		rows: data.rows
			.filter((row) => row.does === does)
			.map((row) =>
				to_matrix_row({
					key: `survey:${row.shape}/${row.input}`,
					label: `${row.shape}/${row.input}`,
					unit: 'ns',
					direction: 'lower',
					call_floor: data.call_floor_ns,
					entries: to_entries(row.libs, (cell) =>
						is_missing(cell)
							? to_missing_entry(cell)
							: to_value_entry(cell.ns, { spread: cell.spread })
					)
				})
			)
	}));
};

/** The libraries of the survey as columns, the subject first, each as the roster has it. */
export const to_survey_columns = (results: BenchmarkResults): Array<MatrixColumn> => {
	const data = to_section_data(results, 'survey');
	if (!data) return [];
	const ids = [data.subject, ...data.others];
	return to_lib_columns(results.meta.libs).filter((column) => ids.includes(column.id));
};

/** One harvested set as the page shows it. */
export interface HarvestSetView {
	name: string;
	title: string;
	/** The set's sides as columns. */
	columns: Array<MatrixColumn>;
	/** The bundle of a module that parses one document, then time, then allocation. */
	groups: Array<MatrixGroup>;
	/** Checks that are a rewrite's own code and no library's, each as a sentence's worth of figures. */
	asides: Array<{ name: string; time: string; bytes: string }>;
}

/**
 * The harvested sets: each with its sides as columns and three groups, the
 * bundle of a module that parses one document, parse time, and allocation,
 * each led by a row that summarizes it: the gzipped bundle, and a geometric
 * mean over the rows every side has a number of. A side that is a library of
 * the roster takes its label, its color, and its mark, and any other, a mode
 * of the consumer's library, that library's label before its own and a color
 * no library has.
 *
 * @returns the sets, none when the file ran no harvest
 */
export const to_harvest_sets = (results: BenchmarkResults): Array<HarvestSetView> => {
	const data = to_section_data(results, 'harvest');
	if (!data) return [];
	const lib_columns = to_lib_columns(results.meta.libs);
	return data.sets.map((set) => {
		const columns = set.sides.map((side): MatrixColumn => {
			const lib = lib_columns.find((column) => column.id === side.id);
			// a mode of a library, as `zod_jitless` is of `zod`, is named after it
			const of = lib_columns.find((column) => side.id.startsWith(`${column.id}_`));
			return {
				id: side.id,
				label:
					lib?.label ??
					(of ? `${of.label} ${side.id.slice(of.id.length + 1).replaceAll('_', ' ')}` : side.label),
				by_maintainer: lib?.by_maintainer ?? false,
				color: lib?.color ?? to_lib_color(lib_columns.length),
				note: lib?.note ?? null,
				notes: lib?.notes ?? []
			};
		});
		const key = `harvest:${set.name}`;
		const side_ids = columns.map((column) => column.id);
		const to_led_rows = (id: string, rows: Array<MatrixRow>): Array<MatrixRow> => {
			const mean = to_geomean_row(rows, side_ids, `${key}:${id}`, 'every row');
			return mean ? [mean, ...rows] : rows;
		};
		const to_bundle_row = (measure: 'gzip' | 'minified', label: string): MatrixRow =>
			to_matrix_row({
				key: `${key}:bundle:${measure}`,
				label,
				unit: 'bytes',
				direction: 'lower',
				entries: Object.fromEntries(
					set.sides.map((side): [string, MatrixEntry] => [
						side.id,
						Object.hasOwn(set.bundles, side.id)
							? to_value_entry(set.bundles[side.id]![measure])
							: { kind: 'none', text: 'no bundle of its own', why: null }
					])
				)
			});
		return {
			name: set.name,
			title: set.title,
			columns,
			groups: [
				{
					key: `${key}:bundle`,
					label: `A module that parses one ${set.root}`,
					note: null,
					rows: [
						{ ...to_bundle_row('gzip', 'minified and gzipped'), kind: 'summary' },
						to_bundle_row('minified', 'minified')
					]
				},
				{
					key: `${key}:time`,
					label: 'Parse time',
					note: null,
					rows: to_led_rows(
						'time',
						set.rows.map((row) =>
							to_matrix_row({
								key: `${key}:time:${row.name}`,
								label: row.name,
								note: row.valid ? null : "a document that doesn't match",
								unit: 'ns',
								direction: 'lower',
								entries: to_entries(row.sides, ({ time }) =>
									is_missing(time)
										? to_missing_entry(time)
										: to_value_entry(time.ns, {
												spread: time.spread,
												details: [`median batch ${format_ns(time.batch_ns)}`]
											})
								)
							})
						)
					)
				},
				{
					key: `${key}:bytes`,
					label: 'Heap bytes a parse allocates',
					note: null,
					rows: to_led_rows(
						'bytes',
						set.rows.map((row) =>
							to_matrix_row({
								key: `${key}:bytes:${row.name}`,
								label: row.name,
								note: row.valid ? null : "a document that doesn't match",
								unit: 'bytes',
								direction: 'lower',
								entries: to_entries(row.sides, ({ bytes }) =>
									is_missing(bytes)
										? to_missing_entry(bytes)
										: to_value_entry(bytes.bytes, {
												band: to_spread_band(bytes.bytes, ALLOCATION_TOLERANCE)
											})
								)
							})
						)
					)
				}
			],
			asides: set.asides.map((aside) => ({
				name: aside.name,
				time: format_ns(aside.ns),
				bytes: format_bytes(aside.bytes)
			}))
		};
	});
};
