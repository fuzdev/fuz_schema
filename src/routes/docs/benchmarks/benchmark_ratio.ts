/**
 * Ratios between libraries and the one color scale every table and chart of
 * the benchmarks page shares. A ratio is always "how many times worse than the
 * baseline": 1 is the baseline itself, 2 is twice as slow or twice as large,
 * and under 1 is better, which only happens against a library a reader chose
 * by hovering it.
 *
 * @module
 */

/** Whether a smaller or a larger number is the better one. */
export type RatioDirection = 'lower' | 'higher';

/**
 * How many times worse `value` is than `baseline`.
 *
 * @returns the ratio, or null when either number isn't positive and finite, so
 * a ratio is never made from a zero
 */
export const to_ratio = (
	value: number,
	baseline: number,
	direction: RatioDirection
): number | null => {
	if (!(value > 0) || !(baseline > 0) || !Number.isFinite(value) || !Number.isFinite(baseline)) {
		return null;
	}
	return direction === 'lower' ? value / baseline : baseline / value;
};

/**
 * The ratios under which each level of the scale ends. A ratio at or past the
 * last one is the last level. The scale reaches 100, since the libraries here
 * are up to hundreds of times apart on some rows: a scale that stopped at a
 * few times would color most of a table alike.
 */
export const RATIO_LEVEL_LIMITS: ReadonlyArray<number> = [0.9, 1.1, 2, 5, 10, 100];

/**
 * The color of each level, as fuz_css variables that adapt to the color
 * scheme: better than the baseline, level with it, then five steps worse.
 */
export const RATIO_LEVEL_COLORS: ReadonlyArray<string> = [
	'var(--palette_j_50)',
	'var(--palette_b_50)',
	'var(--palette_e_50)',
	'var(--palette_h_40)',
	'var(--palette_c_50)',
	'var(--palette_d_50)',
	'var(--palette_d_70)'
];

/** One level of the color scale as a key shows it: its color and the ratios it covers. */
export interface RatioLegendEntry {
	color: string;
	label: string;
	/** What the level means, beyond its ratios, or null. */
	note: string | null;
}

/**
 * The color scale as a key, level by level, from the limits it is drawn from,
 * so the key can't disagree with the cells.
 */
export const to_ratio_legend = (): Array<RatioLegendEntry> =>
	RATIO_LEVEL_COLORS.map((color, level) => {
		const low = level === 0 ? null : RATIO_LEVEL_LIMITS[level - 1]!;
		const high = level < RATIO_LEVEL_LIMITS.length ? RATIO_LEVEL_LIMITS[level]! : null;
		return {
			color,
			label:
				low === null ? `under ${high}×` : high === null ? `${low}× or more` : `${low}–${high}×`,
			note: level === 0 ? 'better than the baseline' : level === 1 ? 'level' : null
		};
	});

/**
 * The level of the color scale a ratio falls in, from 0 (better than the
 * baseline) to the last index of `RATIO_LEVEL_COLORS`. It never decreases as
 * the ratio grows.
 */
export const to_ratio_level = (ratio: number): number => {
	const level = RATIO_LEVEL_LIMITS.findIndex((limit) => ratio < limit);
	return level === -1 ? RATIO_LEVEL_LIMITS.length : level;
};

/** The color of a ratio. A table tints a cell with it and always prints the ratio too. */
export const to_ratio_color = (ratio: number): string => RATIO_LEVEL_COLORS[to_ratio_level(ratio)]!;

/** The color of a ratio that is not a difference: the level one, whatever the ratio. */
export const RATIO_LEVEL_COLOR = RATIO_LEVEL_COLORS[1]!;

/**
 * Whether two numbers are inside their spreads: they differ by no more than
 * the two spreads together, each a share of its own number, which is the rule
 * the survey marks a row by. A number with no spread has none to give, so two
 * exact numbers are inside only when they are equal.
 *
 * @param spread - half of what the value's readings range over, as a share of it, or null for an exact number
 */
export const values_are_within_spread = (
	value: number,
	spread: number | null,
	baseline: number,
	baseline_spread: number | null
): boolean =>
	Math.abs(value - baseline) <= value * (spread ?? 0) + baseline * (baseline_spread ?? 0);

/** The least and the most a number's readings came to. */
export interface ValueBand {
	low: number;
	high: number;
}

/**
 * A number's band from its spread: the spread to either side of it. An exact
 * number's band is the number itself.
 *
 * @param spread - half of what the value's readings range over, as a share of it, or null for an exact number
 */
export const to_spread_band = (value: number, spread: number | null): ValueBand => ({
	low: value * (1 - (spread ?? 0)),
	high: value * (1 + (spread ?? 0))
});

/**
 * Whether two bands overlap: neither's least reading is past the other's
 * most. Two numbers whose bands overlap are not told apart by their readings.
 */
export const bands_overlap = (a: ValueBand, b: ValueBand): boolean =>
	a.low <= b.high && b.low <= a.high;

/** The geometric mean of positive numbers, or null for none. */
export const to_geomean = (values: ReadonlyArray<number>): number | null => {
	if (values.length === 0) return null;
	let sum = 0;
	for (const value of values) sum += Math.log(value);
	return Math.exp(sum / values.length);
};
