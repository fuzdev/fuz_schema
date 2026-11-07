import { describe, test, assert } from 'vitest';

import {
	type CaseTime,
	CASE_FLOOR_LEAST,
	CASE_FLOOR_SPREADS,
	SUMMARY_BAND_DEVIATIONS,
	is_confirmable,
	is_outside,
	mean,
	to_case_time,
	to_deviations,
	to_reading,
	to_runs_needed,
	to_summary,
	to_variance,
	type Reading,
	type Summary
} from '../benchmarks/grade_stats.ts';
import { create_seeded_rng } from './seeded_rng.ts';

const log = Math.log;

// the trial loops run thousands of simulated grades, past the default 5s on a loaded machine
const TRIALS_TIMEOUT = 30_000;

// one run of a case: each instance's time, in ns, by version
const to_run = (base: Array<number>, next: Array<number>): Reading => ({
	base: base.map(log),
	new: next.map(log)
});

// a normal draw from a seeded generator, by Box-Muller
const create_normal = (seed: number): (() => number) => {
	const rng = create_seeded_rng(seed);
	const uniform = (): number => (rng.int(2 ** 32) + 0.5) / 2 ** 32;
	return () => Math.sqrt(-2 * log(uniform())) * Math.cos(2 * Math.PI * uniform());
};

// `runs` readings of a case at `ns`, the new version `shift` times it, each
// instance off by a normal draw of `spread` in the logarithm
const to_noisy_readings = (
	normal: () => number,
	{ ns = 100, shift = 1, spread = 0.02, instances = 3, runs = 3 } = {}
): Array<Reading> =>
	Array.from({ length: runs }, () => ({
		base: Array.from({ length: instances }, () => log(ns) + spread * normal()),
		new: Array.from({ length: instances }, () => log(ns * shift) + spread * normal())
	}));

describe('grade_stats', () => {
	test('the runs needed to confirm', () => {
		assert.ok(!is_confirmable(2));
		assert.ok(is_confirmable(3));
		assert.deepEqual([1, 2, 3, 4, 5, 6, 8, 10].map(to_runs_needed), [1, 2, 3, 4, 4, 5, 6, 8]);
	});

	test('deviations leave the median out of an odd count', () => {
		assert.deepEqual(to_deviations([4, 1, 2]), [1, 2]);
		assert.deepEqual(to_deviations([1, 2, 3, 5]), [1.5, 0.5, 0.5, 2.5]);
	});

	test('a reading takes the median of each arm, and the mean of the whole slice, by version', () => {
		const c = {
			name: 'a',
			arms: ['base0', 'new0', 'base1'],
			ns: { base0: [10, 30, 20], new0: [40], base1: [5, 6, 7] },
			whole_ns: { base0: [10, 10, 40], new0: [40], base1: [5, 6, 10] },
			same: {}
		};
		assert.deepEqual(to_reading(c), { base: [log(20), log(6)], new: [log(40)] });
		// a round a collection landed in counts in the whole slice's
		assert.deepEqual(to_reading(c, undefined, 'whole_ns'), {
			base: [log(20), log(7)],
			new: [log(40)]
		});
	});

	test('equal samples read no difference, at the least floor', () => {
		const readings = Array.from({ length: 3 }, () => to_run([100, 100, 100], [100, 100, 100]));
		const time = to_case_time(readings);
		assert.strictEqual(time.ratio, 0);
		assert.strictEqual(time.floor, CASE_FLOOR_LEAST);
		assert.strictEqual(time.flag, undefined);
		assert.ok(!time.candidate);
		assert.closeTo(time.base_ns, 100, 1e-9);
		assert.closeTo(time.new_ns, 100, 1e-9);
	});

	test('the floor is twice the median deviation, and never under the least', () => {
		// deviations from each version's median, the median left out: base 0.02 and 0.03, new 0.01 and 0.05
		const readings = [
			{
				base: [-0.02, 0, 0.03].map((d) => log(100) + d),
				new: [-0.01, 0, 0.05].map((d) => log(110) + d)
			}
		];
		const time = to_case_time(readings);
		assert.closeTo(time.floor, CASE_FLOOR_SPREADS * 0.025, 1e-12);
		assert.closeTo(time.ratio, log(1.1), 1e-12);
	});

	test('a clear shift is marked in every run, and none from fewer than three runs', () => {
		const slower = to_case_time(
			Array.from({ length: 3 }, () => to_run([100, 101, 99], [120, 121, 119]))
		);
		assert.strictEqual(slower.flag, 'slower');
		assert.strictEqual(slower.slower_runs, 3);
		assert.closeTo(Math.exp(slower.ratio), 1.2, 1e-9);
		const faster = to_case_time(
			Array.from({ length: 3 }, () => to_run([100, 101, 99], [80, 81, 79]))
		);
		assert.strictEqual(faster.flag, 'faster');

		const two = to_case_time(
			Array.from({ length: 2 }, () => to_run([100, 101, 99], [120, 121, 119]))
		);
		assert.strictEqual(two.flag, undefined);
		assert.ok(two.candidate);
	});

	test('a run shows a difference only when every instance is past every other', () => {
		// medians 20% apart, but one instance of the new version sits among the baseline's
		const overlapping = to_run([100, 101, 99], [120, 121, 100.5]);
		const clear = to_run([100, 101, 99], [120, 121, 119]);
		const time = to_case_time([overlapping, clear, clear]);
		assert.strictEqual(time.slower_runs, 2);
		assert.strictEqual(time.flag, undefined);
		// one run fewer than confirms is a candidate
		assert.ok(time.candidate);
	});

	test('a case the baseline was not timed on compares on nothing', () => {
		const time = to_case_time([to_run([], [100, 100, 100])]);
		assert.ok(Number.isNaN(time.ratio));
		assert.closeTo(time.new_ns, 100, 1e-9);
		assert.strictEqual(to_summary([time]).cases, 0);
	});

	test('the variance is the sample variance', () => {
		assert.strictEqual(to_variance([1, 2, 3]), 1);
	});

	test('the A/A is from the instance means over the cases, pooled', () => {
		// one run, two cases, three instances a version: instance i's mean over the cases
		const a = to_case_time([to_run([100, 102, 104], [100, 100, 100])]);
		const b = to_case_time([to_run([100, 104, 108], [110, 110, 110])]);
		const summary = to_summary([a, b]);
		const base_means = [0, 1, 2].map((i) =>
			mean([log([100, 102, 104][i]!), log([100, 104, 108][i]!)])
		);
		const pooled = mean([to_variance(base_means), 0]);
		assert.closeTo(summary.band, SUMMARY_BAND_DEVIATIONS * Math.sqrt(pooled), 1e-12);
		assert.closeTo(summary.ratio, mean([log(100) - log(102), log(110) - log(104)]), 1e-12);
		assert.strictEqual(summary.cases, 2);
	});

	test('a summary of an A/A sits inside its band, and a clear shift outside it', () => {
		const normal = create_normal(7);
		const aa = to_summary(
			Array.from({ length: 10 }, () => to_case_time(to_noisy_readings(normal)))
		);
		assert.ok(!is_outside(aa));
		const shifted = to_summary(
			Array.from({ length: 10 }, () => to_case_time(to_noisy_readings(normal, { shift: 1.1 })))
		);
		assert.ok(is_outside(shifted));
		assert.closeTo(Math.exp(shifted.ratio), 1.1, 0.02);
	});

	// A grade's readings: each instance off by a draw of its own on every case,
	// `common`, as an instance of the desk's A/A reads a percent from the others on
	// all of its cases at once, and by another draw on each case, `spread`.
	const to_grade = (
		normal: () => number,
		{ cases = 120, realistic = 17, shift = 1, spread = 0.01, common = 0.006, runs = 4 } = {}
	): { realistic: Array<CaseTime>; all: Array<CaseTime> } => {
		const offsets = Array.from({ length: runs }, () => ({
			base: [0, 1, 2].map(() => common * normal()),
			new: [0, 1, 2].map(() => common * normal())
		}));
		const all = Array.from({ length: cases }, (_, c) =>
			to_case_time(
				offsets.map((o) => ({
					base: o.base.map((u) => log(100) + u + spread * normal()),
					new: o.new.map((u) => log(100) + (c < realistic ? log(shift) : 0) + u + spread * normal())
				}))
			)
		);
		return { realistic: all.slice(0, realistic), all };
	};

	interface Grade {
		realistic: Array<CaseTime>;
		all: Array<CaseTime>;
		alone: Array<CaseTime>;
	}

	// a grade of both regimes rule 6 reads, `alone` in processes of its own over the realistic cases
	const to_both = (normal: () => number, shift = 1): Grade => {
		const { realistic, all } = to_grade(normal, { shift });
		return { realistic, all, alone: to_grade(normal, { cases: 17, shift }).all };
	};

	// the summary lines rule 6 fails on: the realistic one in `matrix` and `alone`, and every case's
	const to_lines = (grade: Grade): Array<Summary> => [
		to_summary(grade.realistic),
		to_summary(grade.alone),
		to_summary(grade.all)
	];

	test(
		'two copies read past the A/A of each line rule 6 fails on about once in a few hundred',
		{ timeout: TRIALS_TIMEOUT },
		() => {
			const normal = create_normal(5);
			const trials = 1500;
			let outside = 0;
			let lines = 0;
			for (let i = 0; i < trials; i++) {
				for (const s of to_lines(to_both(normal))) {
					lines++;
					if (is_outside(s)) outside++;
				}
			}
			// either way, at the default four runs: a band too narrow reads past far more,
			// and one too wide never
			assert.isAbove(outside / lines, 0.0005);
			assert.isBelow(outside / lines, 0.01);
		}
	);

	test(
		'two copies fail rule 6 in few grades, and its lines find a realistic slowdown of 3%',
		{ timeout: TRIALS_TIMEOUT },
		() => {
			const normal = create_normal(11);
			const trials = 800;
			let false_fails = 0;
			let flagged = 0;
			let read = 0;
			let found = 0;
			for (let i = 0; i < trials; i++) {
				const grade = to_both(normal);
				const cases = [...grade.all, ...grade.alone];
				const flags = cases.filter((t) => t.flag === 'slower').length;
				flagged += flags;
				read += cases.length;
				if (flags || to_lines(grade).some((s) => is_outside(s) && s.ratio > 0)) false_fails++;
				// by the lines alone, which the cases would otherwise stand in for
				if (to_lines(to_both(normal, 1.03)).some((s) => is_outside(s) && s.ratio > 0)) found++;
			}
			// the family's rate, every line and case it fails on, at the default four runs
			assert.isBelow(false_fails / trials, 0.02);
			assert.isBelow(flagged / read, 0.001);
			assert.isAbove(found / trials, 0.9);
		}
	);
});
