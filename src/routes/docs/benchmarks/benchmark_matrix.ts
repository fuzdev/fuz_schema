/**
 * The shape every table and chart of the benchmarks page shares: rows of one
 * entry per column, in groups. A column is a library, or a side of a harvested
 * set. The modules that read a results file build these, and two components
 * render them, so size, time, and memory are compared the same way.
 *
 * An entry is a number or the reason there is none, and only a number ever
 * enters a ratio or a geometric mean. A number that can't be ranked, like a
 * figure of one kept definition repeated, has no ratio and never hands "best"
 * to the runner-up: its row has no baseline until a reader picks one.
 *
 * A difference is read against what the numbers' readings range over. Two
 * numbers of a row are level when the gap between them is inside their two
 * spreads together, and two means when their bands overlap, a mean's band
 * running from the mean of its rows' least readings to the mean of their most.
 * A level number is not ranked, in a table or in a chart.
 *
 * @module
 */

import {
	format_bytes,
	format_count,
	format_ms,
	format_ns,
	format_seconds
} from './benchmark_format.ts';
import {
	bands_overlap,
	to_geomean,
	to_ratio,
	to_spread_band,
	values_are_within_spread,
	type RatioDirection,
	type ValueBand
} from './benchmark_ratio.ts';

/** What a row's numbers are, which decides how they print. */
export type MatrixUnit = 'ns' | 'ms' | 'seconds' | 'bytes' | 'count';

/** A column of a table: a library, or a side of a harvested set. */
export interface MatrixColumn {
	id: string;
	label: string;
	/** Whether the maintainer of these benchmarks also maintains it. A page marks it wherever it is named. */
	by_maintainer: boolean;
	/** The color of its bars, the same in every chart. */
	color: string;
	/** What of the library was measured, or null. */
	note: string | null;
	/**
	 * What qualifies its figures, each with the kinds of figure it is about, as
	 * the results file's roster names them: a chart or table prints the ones
	 * about what it measures.
	 */
	notes: ReadonlyArray<{ about: ReadonlyArray<string>; text: string }>;
}

/**
 * The notes to print under a chart or table of some kinds of figure: for each
 * column in order, its notes about any of the kinds, each text once.
 *
 * @param about - the kinds of figure the chart or table measures
 */
export const to_column_notes = (
	columns: ReadonlyArray<MatrixColumn>,
	about: ReadonlyArray<string>
): Array<{ column: MatrixColumn; texts: Array<string> }> =>
	columns.flatMap((column) => {
		const texts = [
			...new Set(
				column.notes
					.filter((note) => note.about.some((kind) => about.includes(kind)))
					.map((note) => note.text)
			)
		];
		return texts.length ? [{ column, texts }] : [];
	});

/** A number in a row, with what a reader may want to know about it. */
export interface MatrixValue {
	kind: 'value';
	value: number;
	/** Printed in place of the number, when the number itself would mislead. */
	text: string | null;
	/**
	 * Half of what the number's readings range over, as a share of it, or null
	 * for an exact number. A gap to another number inside the two spreads
	 * together is not a difference.
	 */
	spread: number | null;
	/**
	 * The least and the most of the number's readings, where the data has both,
	 * as a timing's fastest and slowest pass, or null. A mean has no spread and
	 * is read by its band: the geometric mean of its rows' least readings to
	 * that of their most. Two means whose bands overlap are not a difference.
	 */
	band: ValueBand | null;
	/** A mark printed after the number, like `†`, with what it says, or null. */
	mark: { text: string; title: string } | null;
	details: Array<string>;
	/**
	 * Why the number can't be compared with another, or null when it can. Such a
	 * number has no ratio, and its row is left out of a geometric mean.
	 */
	unranked: string | null;
}

/** One column's place in a row: a number, or why there is none. */
export type MatrixEntry = MatrixValue | { kind: 'none'; text: string; why: string | null };

/** One row of a table: one thing measured, or a summary over rows. */
export interface MatrixRow {
	key: string;
	kind: 'cell' | 'summary';
	label: string;
	note: string | null;
	unit: MatrixUnit;
	direction: RatioDirection;
	/** Whether the row's numbers are compared: a row that is not has no ratios. */
	compared: boolean;
	/**
	 * A time at or under this is mostly the call it was timed through, in the
	 * row's unit, or null for a row with no such floor. A ratio with either
	 * number at the floor is not a difference.
	 */
	call_floor: number | null;
	/** By column id. A column with no entry has nothing here. */
	entries: Record<string, MatrixEntry>;
	/** Set in place of entries when the row has nothing to show for any column. */
	empty: string | null;
}

/** Rows under one heading. */
export interface MatrixGroup {
	key: string;
	label: string;
	note: string | null;
	rows: Array<MatrixRow>;
}

/** An entry holding a number. */
export const to_value_entry = (
	value: number,
	options: Partial<Omit<MatrixValue, 'kind' | 'value'>> = {}
): MatrixValue => ({
	kind: 'value',
	value,
	text: null,
	spread: null,
	band: null,
	mark: null,
	details: [],
	unranked: null,
	...options
});

/** A row with the defaults filled in. */
export const to_matrix_row = (
	row: Pick<MatrixRow, 'key' | 'label' | 'unit' | 'direction'> & Partial<MatrixRow>
): MatrixRow => ({
	kind: 'cell',
	note: null,
	compared: true,
	call_floor: null,
	entries: {},
	empty: null,
	...row
});

/** What a column with no entry in a row reads as. */
const NOT_MEASURED: MatrixEntry = { kind: 'none', text: 'not measured', why: null };

/** A column's entry in a row. */
export const matrix_row_entry = (row: MatrixRow, column: string): MatrixEntry =>
	Object.hasOwn(row.entries, column) ? row.entries[column]! : NOT_MEASURED;

/** A column's number in a row, or null when its entry is anything else. */
export const matrix_row_value = (row: MatrixRow, column: string): number | null => {
	const entry = matrix_row_entry(row, column);
	return entry.kind === 'value' ? entry.value : null;
};

/**
 * The largest finite number of these columns over these rows, which a full
 * bar stands for: 0 when there is none.
 */
export const matrix_rows_max = (
	rows: ReadonlyArray<MatrixRow>,
	columns: ReadonlyArray<string>
): number => {
	let max = 0;
	for (const row of rows) {
		for (const column of columns) {
			const value = matrix_row_value(row, column);
			if (value !== null && Number.isFinite(value)) max = Math.max(max, value);
		}
	}
	return max;
};

/** Whether a number can enter a ratio: positive, finite, and not marked as unranked. */
const is_ranked = (entry: MatrixEntry): entry is MatrixValue =>
	entry.kind === 'value' &&
	entry.unranked === null &&
	entry.value > 0 &&
	Number.isFinite(entry.value);

/**
 * Whether every one of the columns has a number in the row that a ratio can
 * be made from. Only such a row enters a geometric mean.
 */
export const matrix_row_is_complete = (row: MatrixRow, columns: ReadonlyArray<string>): boolean =>
	columns.length > 0 && columns.every((column) => is_ranked(matrix_row_entry(row, column)));

/**
 * Whether any of the columns' numbers in the row is at the row's call floor:
 * such a time is mostly the call it was timed through, so the row is in no
 * geometric mean. A row with no floor never is.
 */
export const matrix_row_is_at_floor = (row: MatrixRow, columns: ReadonlyArray<string>): boolean =>
	row.call_floor !== null &&
	columns.some((column) => {
		const value = matrix_row_value(row, column);
		return value !== null && value <= row.call_floor!;
	});

/**
 * What a number's readings range over: its band where it has one, and
 * otherwise its spread to either side of it. An exact number's is the number.
 */
export const matrix_value_band = (entry: MatrixValue): ValueBand =>
	entry.band ?? to_spread_band(entry.value, entry.spread);

/**
 * Whether two numbers are level, so the gap between them is not a difference.
 * Where either has a spread, the gap is inside the two spreads together, the
 * rule the scripts mark a row by. Two numbers with no spread and a band, as
 * two means are, are level when the bands overlap. Two exact numbers are level
 * only when they are equal.
 */
export const matrix_values_are_level = (a: MatrixValue, b: MatrixValue): boolean =>
	a.spread === null && b.spread === null && (a.band !== null || b.band !== null)
		? bands_overlap(matrix_value_band(a), matrix_value_band(b))
		: values_are_within_spread(a.value, a.spread, b.value, b.spread);

/**
 * The column a row's ratios are taken against: the anchor a reader chose, or
 * the best among the columns when none is chosen.
 *
 * When any of the columns' numbers can't be ranked (one that isn't positive,
 * or one marked `unranked`), the best of the rest is never used: the number
 * set aside may be the smallest in the row. Such a row has a baseline only
 * when a reader anchors it on a number that can be ranked.
 *
 * @param anchor - a column id, or null for the best in the row
 * @returns the baseline's column, or null when the row isn't compared, a
 * number in it can't be ranked and no anchor is chosen, the anchor has no
 * rankable number, or no column has one
 */
export const matrix_row_baseline = (
	row: MatrixRow,
	columns: ReadonlyArray<string>,
	anchor: string | null
): string | null => {
	if (!row.compared) return null;
	if (anchor !== null) return is_ranked(matrix_row_entry(row, anchor)) ? anchor : null;
	const numbered = columns.filter((column) => matrix_row_entry(row, column).kind === 'value');
	if (!numbered.every((column) => is_ranked(matrix_row_entry(row, column)))) return null;
	let best: string | null = null;
	for (const column of numbered) {
		const value = matrix_row_value(row, column)!;
		const best_value = best === null ? null : matrix_row_value(row, best)!;
		if (
			best_value === null ||
			(row.direction === 'lower' ? value < best_value : value > best_value)
		) {
			best = column;
		}
	}
	return best;
};

/** A column's ratio in a row, and whether it is a difference. */
export interface MatrixRatio {
	/** How many times worse than the baseline: 1 is the baseline itself. */
	ratio: number;
	/** Whether this column is the baseline. */
	baseline: boolean;
	/**
	 * Why the ratio is not a difference, or null when it is one: `spread` when
	 * the two numbers are level, inside their spreads together or with bands
	 * that overlap, and `floor` when either is at the row's call floor. The
	 * baseline's own is `spread` when any other number is level with it: it is
	 * then one of several the readings don't tell apart, and not the best of
	 * them.
	 */
	level: 'spread' | 'floor' | null;
}

/**
 * Each column's ratio against the row's baseline. A number that can't be
 * ranked has no ratio, and a row where fewer than two of the columns have a
 * number has none at all: there is nothing to compare.
 *
 * @param anchor - a column id, or null for the best in the row
 * @returns the ratios by column id, for the columns that have one
 */
export const to_matrix_ratios = (
	row: MatrixRow,
	columns: ReadonlyArray<string>,
	anchor: string | null
): Record<string, MatrixRatio> => {
	const ratios: Record<string, MatrixRatio> = {};
	const baseline = matrix_row_baseline(row, columns, anchor);
	const numbered = columns.filter((column) => matrix_row_value(row, column) !== null);
	if (baseline === null || numbered.length < 2) return ratios;
	const base = matrix_row_entry(row, baseline) as MatrixValue;
	for (const column of columns) {
		const entry = matrix_row_entry(row, column);
		if (!is_ranked(entry)) continue;
		const ratio = to_ratio(entry.value, base.value, row.direction);
		if (ratio === null) continue;
		const at_floor = row.call_floor !== null && Math.min(entry.value, base.value) <= row.call_floor;
		ratios[column] = {
			ratio,
			baseline: column === baseline,
			level:
				column === baseline
					? null
					: at_floor
						? 'floor'
						: matrix_values_are_level(entry, base)
							? 'spread'
							: null
		};
	}
	// a baseline another number is level with is not set apart from it
	const base_ratio = ratios[baseline];
	if (base_ratio && Object.values(ratios).some((ratio) => ratio.level === 'spread')) {
		base_ratio.level = 'spread';
	}
	return ratios;
};

/**
 * A summary row holding each column's geometric mean over the rows that are
 * complete for every one of the columns. A mean over a different set of rows
 * for each column would favor whichever skipped the slow ones, so a row
 * missing any column is left out for all of them, as is a row holding a
 * number that can't be ranked or a time at its call floor, and the row's note
 * says how many it covers. With no complete row there is no mean, and the row
 * says so in place of its entries.
 *
 * A mean is no more exact than its rows. Where any of them has readings that
 * range, the mean carries a band, from the geometric mean of the rows' least
 * readings to that of their most, and two means whose bands overlap are level:
 * neither is ranked against the other. A mean of exact numbers has no band.
 *
 * @param rows - the rows to summarize, sharing a unit and a direction
 * @param columns - the column ids
 * @returns the summary row, or null when there are no rows to summarize
 */
export const to_geomean_row = (
	rows: ReadonlyArray<MatrixRow>,
	columns: ReadonlyArray<string>,
	key: string,
	label: string
): MatrixRow | null => {
	const first = rows[0];
	if (!first) return null;
	const complete = rows.filter(
		(row) => matrix_row_is_complete(row, columns) && !matrix_row_is_at_floor(row, columns)
	);
	const entries: Record<string, MatrixEntry> = {};
	for (const column of columns) {
		const values = complete.map((row) => matrix_row_entry(row, column) as MatrixValue);
		const mean = to_geomean(values.map((entry) => entry.value));
		if (mean === null) continue;
		const bands = values.map(matrix_value_band);
		const ranges = bands.some((band, i) => band.low !== values[i]!.value || band.high !== band.low);
		// a least reading at or under zero has no geometric mean: the band then starts at zero
		const low = bands.every((band) => band.low > 0) ? to_geomean(bands.map((b) => b.low))! : 0;
		const high = to_geomean(bands.map((band) => band.high))!;
		entries[column] = to_value_entry(
			mean,
			ranges
				? {
						band: { low, high },
						details: [
							`its rows' least readings come to ${format_matrix_value(low, first.unit)} and their most to ${format_matrix_value(high, first.unit)}`
						]
					}
				: {}
		);
	}
	const covers = `${complete.length} of ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
	return to_matrix_row({
		key,
		kind: 'summary',
		label,
		note:
			complete.length === rows.length || complete.length === 0
				? `geometric mean over ${covers}`
				: `geometric mean over ${covers}: the others have no number to compare for one of these${rows.some((row) => row.call_floor !== null) ? ', or a time at the call floor,' : ''} and are left out`,
		unit: first.unit,
		direction: first.direction,
		entries,
		empty:
			complete.length === 0
				? 'no row has a number that can be compared for every library shown'
				: null
	});
};

/** A row's number as text, in the row's unit. */
export const format_matrix_value = (value: number, unit: MatrixUnit): string => {
	switch (unit) {
		case 'ns':
			return format_ns(value);
		case 'ms':
			return format_ms(value);
		case 'seconds':
			return format_seconds(value);
		case 'bytes':
			return format_bytes(value);
		case 'count':
			return format_count(value);
	}
};

/** An entry as text: its number in the row's unit with its mark, or what it says in place of one. */
export const format_matrix_entry = (entry: MatrixEntry, unit: MatrixUnit): string =>
	entry.kind === 'value'
		? (entry.text ?? format_matrix_value(entry.value, unit)) + (entry.mark?.text ?? '')
		: entry.text;

/** One column's bar in a chart of a row. */
export interface MatrixBar {
	column: string;
	/** The number as text, or what the entry says in place of one. */
	text: string;
	/** Why there is no number, where the entry says, for a title. */
	why: string | null;
	has_value: boolean;
	/** The bar's length, as a fraction of the row's largest number: 0, and no bar, with no number. */
	fraction: number;
	ratio: MatrixRatio | undefined;
	details: Array<string>;
}

/**
 * The bars of a row, in the order of `columns`. A bar's length is its number
 * over the largest in the row, whichever direction is better, so a longer bar
 * is always more of the row's unit.
 *
 * @param anchor - the column the ratios are taken against, or null for the best in the row
 */
export const to_matrix_bars = (
	row: MatrixRow,
	columns: ReadonlyArray<string>,
	anchor: string | null
): Array<MatrixBar> => {
	const ratios = to_matrix_ratios(row, columns, anchor);
	const max = matrix_rows_max([row], columns);
	return columns.map((column) => {
		const entry = matrix_row_entry(row, column);
		return {
			column,
			text: format_matrix_entry(entry, row.unit),
			why: entry.kind === 'value' ? (entry.mark?.title ?? entry.unranked) : entry.why,
			has_value: entry.kind === 'value',
			fraction: entry.kind === 'value' && max > 0 && entry.value > 0 ? entry.value / max : 0,
			ratio: ratios[column],
			details: entry.kind === 'value' ? entry.details : []
		};
	});
};
