/**
 * The statistics `grade` reads its timings by, kept apart from `grade.ts`,
 * which runs as it is loaded, so a test can read them over made-up samples:
 * a case's runs read together against its floor, and a set of cases read as
 * one figure against its A/A. Every figure is the logarithm of a time, or of
 * a ratio of two, so a mean of them is a geometric mean of the times.
 *
 * @module
 */

import { stats_median } from '@fuzdev/fuz_util/stats.ts';

import type { GradeChildCase } from './grade_job.ts';

/**
 * A case's floor, in the logarithm of a time ratio: this many times what two
 * instances of one version differ by on it, and never under
 * `CASE_FLOOR_LEAST`. A spread read from a few instances can be near nothing,
 * and a floor of nothing would flag anything.
 */
export const CASE_FLOOR_SPREADS = 2;
/** The least a case's floor is, as the logarithm of a ratio. */
export const CASE_FLOOR_LEAST = Math.log(1.01);
/**
 * The fewest runs a difference can be confirmed or a rule on time judged
 * from. A case must show a difference in every run below `RUNS_ALL_BELOW`
 * runs, and in `RUNS_SHARE` of them, rounded up, from there: a share of so
 * few runs would ask less of four than of three.
 */
export const RUNS_TO_CONFIRM = 3;
export const RUNS_ALL_BELOW = 5;
export const RUNS_SHARE = 0.75;
/**
 * A summary's A/A is this, over the root of the runs, times the standard
 * deviation of one version's instances over the summary's cases. The figure
 * it stands beside is a median over runs of a difference of medians over
 * instances, which moves by about a third of this, so the A/A is near three
 * of its standard errors: two copies of one file read past it on about one
 * line in a hundred, at three runs.
 */
export const SUMMARY_BAND_DEVIATIONS = 3.3;

/** One case in one process, or in the processes of a run: the logarithm of each instance's nanoseconds per call, by version. */
export interface Reading {
	base: Array<number>;
	new: Array<number>;
}

/** Adds what a process read of a case to a reading, the arms of the baseline and of the new version apart. */
export const to_reading = (
	c: GradeChildCase,
	reading: Reading = { base: [], new: [] }
): Reading => {
	for (const arm of c.arms) {
		reading[arm.startsWith('base') ? 'base' : 'new'].push(Math.log(stats_median(c.ns![arm]!)));
	}
	return reading;
};

/** The arithmetic mean. */
export const mean = (values: Array<number>): number =>
	values.reduce((sum, v) => sum + v, 0) / values.length;

/** What the instances of one version are from their median, the median itself left out. */
export const to_deviations = (values: Array<number>): Array<number> => {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = stats_median(sorted);
	return sorted
		.filter((_, i) => sorted.length % 2 === 0 || i !== sorted.length >> 1)
		.map((v) => Math.abs(v - middle));
};

/** Whether a difference can be confirmed, or a rule on time judged, from this many runs. */
export const is_confirmable = (runs: number): boolean => runs >= RUNS_TO_CONFIRM;

/** How many of the runs a case must show a difference in to be confirmed. */
export const to_runs_needed = (runs: number): number =>
	runs < RUNS_ALL_BELOW ? runs : Math.ceil(runs * RUNS_SHARE);

/** A case's time in one regime, over the runs. */
export interface CaseTime {
	readings: Array<Reading>;
	base_ns: number;
	new_ns: number;
	/** The logarithm of new over base: the median over the runs of each run's. */
	ratio: number;
	/** The logarithm a run's ratio must be past for the run to show a difference. */
	floor: number;
	/** How many runs showed the new version slower, and faster. */
	slower_runs: number;
	faster_runs: number;
	/** Confirmed: shown in `to_runs_needed` of the runs, where there are enough runs to confirm from. */
	flag: 'slower' | 'faster' | undefined;
	/** Shown in one run fewer than confirms it, or, with too few runs to confirm from, in every one. */
	candidate: boolean;
}

/**
 * Reads a case's runs together.
 *
 * A run shows the case slower when every instance of the new version took
 * longer than every instance of the baseline, and the medians of the two
 * differ by more than the case's floor. Faster is the same the other way. The
 * floor is `CASE_FLOOR_SPREADS` times what an instance is from the median of
 * its own version, at its median over both versions and every run, and never
 * under `CASE_FLOOR_LEAST`.
 *
 * @param readings - a reading a run, every run's
 */
export const to_case_time = (readings: Array<Reading>): CaseTime => {
	const confirmable = is_confirmable(readings.length);
	const runs_needed = to_runs_needed(readings.length);
	const new_ns = Math.exp(stats_median(readings.map((r) => stats_median(r.new))));
	if (!readings.every((r) => r.base.length)) {
		return {
			readings,
			base_ns: NaN,
			new_ns,
			ratio: NaN,
			floor: NaN,
			slower_runs: 0,
			faster_runs: 0,
			flag: undefined,
			candidate: false
		};
	}
	const deviations = readings.flatMap((r) => [...to_deviations(r.base), ...to_deviations(r.new)]);
	const floor = Math.max(
		CASE_FLOOR_LEAST,
		CASE_FLOOR_SPREADS * (deviations.length ? stats_median(deviations) : 0)
	);
	const deltas = readings.map((r) => stats_median(r.new) - stats_median(r.base));
	const slower_runs = readings.filter(
		(r, i) => deltas[i]! > floor && Math.min(...r.new) > Math.max(...r.base)
	).length;
	const faster_runs = readings.filter(
		(r, i) => deltas[i]! < -floor && Math.max(...r.new) < Math.min(...r.base)
	).length;
	const ratio = stats_median(deltas);
	const shown =
		slower_runs >= runs_needed ? 'slower' : faster_runs >= runs_needed ? 'faster' : undefined;
	const flag = confirmable ? shown : undefined;
	return {
		readings,
		base_ns: Math.exp(stats_median(readings.map((r) => stats_median(r.base)))),
		new_ns,
		ratio,
		floor,
		slower_runs,
		faster_runs,
		flag,
		candidate: confirmable
			? !flag && Math.max(slower_runs, faster_runs) === runs_needed - 1
			: Math.max(slower_runs, faster_runs) === readings.length
	};
};

/** A mean over cases of their time ratios, beside what the instances of one version differ by on the same cases. */
export interface Summary {
	cases: number;
	/** The logarithm of new over base, a mean over the cases: the median of the runs'. */
	ratio: number;
	/** Each run's. */
	runs: Array<number>;
	/** The A/A of the same cases in the same processes, as a logarithm. */
	band: number;
}

/** The sample variance. */
export const to_variance = (values: Array<number>): number => {
	const middle = mean(values);
	return values.reduce((sum, v) => sum + (v - middle) ** 2, 0) / (values.length - 1);
};

/**
 * Reads a set of cases together.
 *
 * A run's figure is the mean over the cases of the logarithm of the new
 * version's median instance over the baseline's, and the summary's is the
 * median of the runs'. Its A/A is taken from the same cases in the same
 * processes: each instance's mean over the cases, the variance of those among
 * the instances of one version, pooled over the versions and the runs, and
 * `SUMMARY_BAND_DEVIATIONS` of its root over the root of the runs.
 *
 * @param times - the cases, each read over the same runs; one compared on nothing is left out
 */
export const to_summary = (times: Array<CaseTime>): Summary => {
	const compared = times.filter((t) => !Number.isNaN(t.ratio));
	if (!compared.length) return { cases: 0, ratio: NaN, runs: [], band: NaN };
	const run_count = compared[0]!.readings.length;
	const runs: Array<number> = [];
	const variances: Array<number> = [];
	for (let run = 0; run < run_count; run++) {
		const readings = compared.map((t) => t.readings[run]!);
		runs.push(mean(readings.map((r) => stats_median(r.new) - stats_median(r.base))));
		for (const version of ['base', 'new'] as const) {
			variances.push(
				to_variance(readings[0]![version].map((_, i) => mean(readings.map((r) => r[version][i]!))))
			);
		}
	}
	return {
		cases: compared.length,
		ratio: stats_median(runs),
		runs,
		band: (SUMMARY_BAND_DEVIATIONS * Math.sqrt(mean(variances))) / Math.sqrt(run_count)
	};
};

/** Whether a summary's figure is past its A/A. */
export const is_outside = (s: Summary): boolean => Math.abs(s.ratio) > s.band;
