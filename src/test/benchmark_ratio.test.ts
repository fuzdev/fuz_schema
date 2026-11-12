import { assert, describe, test } from 'vitest';

import {
	RATIO_LEVEL_COLORS,
	RATIO_LEVEL_LIMITS,
	bands_overlap,
	to_geomean,
	to_ratio,
	to_ratio_color,
	to_ratio_legend,
	to_ratio_level,
	to_spread_band,
	values_are_within_spread
} from '#routes/docs/benchmarks/benchmark_ratio.ts';

describe('to_ratio', () => {
	test('is how many times worse than the baseline, in either direction', () => {
		assert.strictEqual(to_ratio(200, 100, 'lower'), 2);
		assert.strictEqual(to_ratio(50, 100, 'lower'), 0.5);
		assert.strictEqual(to_ratio(50, 100, 'higher'), 2);
	});

	test('is never made from a zero, a negative, or a number that is not finite', () => {
		assert.strictEqual(to_ratio(0, 100, 'lower'), null);
		assert.strictEqual(to_ratio(100, 0, 'lower'), null);
		assert.strictEqual(to_ratio(-1, 100, 'lower'), null);
		assert.strictEqual(to_ratio(NaN, 100, 'lower'), null);
		assert.strictEqual(to_ratio(100, Infinity, 'lower'), null);
	});
});

describe('the color scale', () => {
	test('has a color for every level, and a level never falls as the ratio grows', () => {
		assert.strictEqual(RATIO_LEVEL_COLORS.length, RATIO_LEVEL_LIMITS.length + 1);
		let last = 0;
		for (const ratio of [0.1, 0.89, 0.9, 1, 1.09, 1.1, 2, 4.9, 5, 10, 99, 100, 1e6]) {
			const level = to_ratio_level(ratio);
			assert.isAtLeast(level, last, String(ratio));
			last = level;
		}
		assert.strictEqual(last, RATIO_LEVEL_COLORS.length - 1);
	});

	test('each level starts at its limit', () => {
		for (const limit of RATIO_LEVEL_LIMITS) {
			assert.notStrictEqual(to_ratio_color(limit - 1e-9), to_ratio_color(limit), String(limit));
		}
		assert.strictEqual(to_ratio_level(1), 1);
	});

	test('the legend is the scale itself, level by level', () => {
		const legend = to_ratio_legend();
		assert.deepStrictEqual(
			legend.map((entry) => entry.color),
			[...RATIO_LEVEL_COLORS]
		);
		assert.strictEqual(legend[0]!.label, 'under 0.9×');
		assert.strictEqual(legend[1]!.label, '0.9–1.1×');
		assert.strictEqual(legend.at(-1)!.label, '100× or more');
	});
});

describe('values_are_within_spread', () => {
	test('a gap is inside when it is no more than the two spreads together', () => {
		// 100 ±5% and 108 ±3%: 5 + 3.24 covers the 8 between them
		assert.ok(values_are_within_spread(108, 0.03, 100, 0.05));
		assert.ok(!values_are_within_spread(109, 0.03, 100, 0.05));
		// either way round
		assert.ok(values_are_within_spread(100, 0.05, 108, 0.03));
	});

	test('exact numbers are inside only when they are equal', () => {
		assert.ok(!values_are_within_spread(101, null, 100, null));
		assert.ok(values_are_within_spread(100, null, 100, null));
		// one spread is enough to cover a gap
		assert.ok(values_are_within_spread(101, null, 100, 0.02));
	});
});

describe('to_geomean', () => {
	test('is the geometric mean, and null of nothing', () => {
		assert.approximately(to_geomean([2, 8])!, 4, 1e-12);
		assert.approximately(to_geomean([0.5, 2])!, 1, 1e-12);
		assert.strictEqual(to_geomean([]), null);
	});
});

describe('bands', () => {
	test('a band from a spread is the spread to either side, and an exact number is its own', () => {
		assert.deepStrictEqual(to_spread_band(100, 0.05), { low: 95, high: 105 });
		assert.deepStrictEqual(to_spread_band(100, null), { low: 100, high: 100 });
	});

	test('two bands overlap when neither starts past where the other ends', () => {
		assert.ok(bands_overlap({ low: 90, high: 110 }, { low: 105, high: 130 }));
		assert.ok(bands_overlap({ low: 105, high: 130 }, { low: 90, high: 110 }));
		// one inside the other, and two that only touch
		assert.ok(bands_overlap({ low: 90, high: 130 }, { low: 100, high: 110 }));
		assert.ok(bands_overlap({ low: 90, high: 100 }, { low: 100, high: 110 }));
		assert.ok(!bands_overlap({ low: 90, high: 99 }, { low: 100, high: 110 }));
		assert.ok(!bands_overlap({ low: 100, high: 110 }, { low: 90, high: 99 }));
	});

	test('overlap of spread bands is the rule of the two spreads together', () => {
		for (const [a, sa, b, sb] of [
			[108, 0.03, 100, 0.05],
			[109, 0.03, 100, 0.05],
			[100, 0.05, 108, 0.03],
			[101, null, 100, 0.02],
			[101, null, 100, null]
		] as const) {
			assert.strictEqual(
				bands_overlap(to_spread_band(a, sa), to_spread_band(b, sb)),
				values_are_within_spread(a, sa, b, sb),
				`${a} ${sa} ${b} ${sb}`
			);
		}
	});
});
