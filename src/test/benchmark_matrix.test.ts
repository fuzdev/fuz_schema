import { assert, describe, test } from 'vitest';

import {
	format_matrix_entry,
	matrix_row_baseline,
	matrix_row_is_complete,
	matrix_rows_max,
	matrix_row_entry,
	matrix_row_is_at_floor,
	matrix_value_band,
	matrix_values_are_level,
	to_column_notes,
	to_geomean_row,
	to_matrix_bars,
	to_matrix_ratios,
	to_matrix_row,
	to_value_entry,
	type MatrixColumn,
	type MatrixEntry,
	type MatrixRow
} from '#routes/docs/benchmarks/benchmark_matrix.ts';
import { bands_overlap } from '#routes/docs/benchmarks/benchmark_ratio.ts';

const COLUMNS = ['a', 'b', 'c'];

const to_row = (
	entries: Record<string, MatrixEntry | number>,
	options: Partial<MatrixRow> = {}
): MatrixRow =>
	to_matrix_row({
		key: 'row',
		label: 'row',
		unit: 'ns',
		direction: 'lower',
		entries: Object.fromEntries(
			Object.entries(entries).map(([column, entry]) => [
				column,
				typeof entry === 'number' ? to_value_entry(entry) : entry
			])
		),
		...options
	});

const NONE: MatrixEntry = { kind: 'none', text: 'not compiled', why: 'a reason' };

describe('to_matrix_ratios', () => {
	test('the best in the row is the baseline, and every ratio is how many times worse', () => {
		const ratios = to_matrix_ratios(to_row({ a: 200, b: 100, c: 450 }), COLUMNS, null);
		assert.deepStrictEqual(
			Object.fromEntries(Object.entries(ratios).map(([column, r]) => [column, r.ratio])),
			{ a: 2, b: 1, c: 4.5 }
		);
		assert.ok(ratios.b!.baseline);
		assert.ok(!ratios.a!.baseline);
	});

	test('where higher is better the largest is the baseline', () => {
		const row = to_row({ a: 200, b: 100 }, { direction: 'higher' });
		assert.strictEqual(matrix_row_baseline(row, COLUMNS, null), 'a');
		assert.strictEqual(to_matrix_ratios(row, COLUMNS, null).b!.ratio, 2);
	});

	test('an anchor re-baselines the row, and a ratio under one is better than it', () => {
		const ratios = to_matrix_ratios(to_row({ a: 200, b: 100, c: 450 }), COLUMNS, 'a');
		assert.strictEqual(ratios.a!.ratio, 1);
		assert.ok(ratios.a!.baseline);
		assert.strictEqual(ratios.b!.ratio, 0.5);
		assert.strictEqual(ratios.c!.ratio, 2.25);
	});

	test('only a number enters a ratio: an entry that is none has none, and the rest compare', () => {
		const ratios = to_matrix_ratios(to_row({ a: 200, b: NONE, c: 100 }), COLUMNS, null);
		assert.deepStrictEqual(Object.keys(ratios), ['a', 'c']);
		assert.strictEqual(ratios.a!.ratio, 2);
	});

	test('a number that can not be ranked never hands best to the runner-up', () => {
		// the unranked figure is the smallest: calling `a` the best would be wrong
		const row = to_row({ a: 200, b: 300, c: to_value_entry(1, { unranked: 'one kept schema' }) });
		assert.strictEqual(matrix_row_baseline(row, COLUMNS, null), null);
		assert.deepStrictEqual(to_matrix_ratios(row, COLUMNS, null), {});
		// a reader's anchor on a number that can be ranked compares the rest
		const ratios = to_matrix_ratios(row, COLUMNS, 'a');
		assert.deepStrictEqual(Object.keys(ratios), ['a', 'b']);
		// and an anchor on the one that can't is no anchor
		assert.deepStrictEqual(to_matrix_ratios(row, COLUMNS, 'c'), {});
	});

	test('a zero is not ranked either, so a row with one has no ratios of its own', () => {
		const row = to_row({ a: 0, b: 88, c: 416 }, { unit: 'bytes' });
		assert.deepStrictEqual(to_matrix_ratios(row, COLUMNS, null), {});
		assert.strictEqual(to_matrix_ratios(row, COLUMNS, 'b').c!.ratio, 416 / 88);
	});

	test('a row that is not compared, or has one number, has no ratios', () => {
		assert.deepStrictEqual(
			to_matrix_ratios(to_row({ a: 1, b: 2 }, { compared: false }), COLUMNS, null),
			{}
		);
		assert.deepStrictEqual(to_matrix_ratios(to_row({ a: 1, b: NONE }), COLUMNS, null), {});
	});

	test('a gap inside the two spreads together is not a difference', () => {
		const row = to_row({
			a: to_value_entry(100, { spread: 0.05 }),
			b: to_value_entry(108, { spread: 0.03 }),
			c: to_value_entry(120, { spread: 0.03 })
		});
		const ratios = to_matrix_ratios(row, COLUMNS, null);
		assert.strictEqual(ratios.b!.level, 'spread');
		assert.strictEqual(ratios.c!.level, null);
	});

	test('a baseline another number is level with is level too: it is not the best of them', () => {
		const row = to_row({
			a: to_value_entry(100, { spread: 0.05 }),
			b: to_value_entry(108, { spread: 0.03 }),
			c: to_value_entry(120, { spread: 0.03 })
		});
		const ratios = to_matrix_ratios(row, COLUMNS, null);
		assert.ok(ratios.a!.baseline);
		assert.strictEqual(ratios.a!.ratio, 1);
		assert.strictEqual(ratios.a!.level, 'spread');
		// with nothing level with it, the baseline is set apart, and is a difference from the rest
		const apart = to_matrix_ratios(to_row({ a: 100, b: 108, c: 120 }), COLUMNS, null);
		assert.strictEqual(apart.a!.level, null);
		assert.strictEqual(apart.b!.level, null);
		// an anchor a reader chose is marked the same way
		const anchored = to_matrix_ratios(row, COLUMNS, 'b');
		assert.strictEqual(anchored.b!.level, 'spread');
		assert.strictEqual(anchored.a!.level, 'spread');
		// and a number at the call floor doesn't make the baseline level
		const floored = to_matrix_ratios(to_row({ a: 8, b: 30 }, { call_floor: 8.8 }), COLUMNS, null);
		assert.strictEqual(floored.a!.level, null);
		// the bars of a chart carry it
		const bars = to_matrix_bars(row, COLUMNS, null);
		assert.strictEqual(bars[0]!.ratio!.level, 'spread');
	});

	test('a time at the call floor makes a ratio of two calls, whichever side it is on', () => {
		const row = to_row({ a: 8, b: 30, c: 40 }, { call_floor: 8.8 });
		const ratios = to_matrix_ratios(row, COLUMNS, null);
		assert.strictEqual(ratios.b!.level, 'floor');
		assert.strictEqual(ratios.c!.level, 'floor');
		// against a baseline past the floor, a time past it is a difference
		assert.strictEqual(to_matrix_ratios(row, COLUMNS, 'b').c!.level, null);
		assert.strictEqual(to_matrix_ratios(row, COLUMNS, 'b').a!.level, 'floor');
	});
});

describe('to_geomean_row', () => {
	const rows = [
		to_row({ a: 2, b: 4, c: 10 }, { key: 'one' }),
		to_row({ a: 8, b: 4, c: 10 }, { key: 'two' }),
		// left out for every column: one lacks a number here
		to_row({ a: 1000, b: NONE, c: 1 }, { key: 'three' })
	];

	test('covers only the rows complete for every column, and says how many of how many', () => {
		const mean = to_geomean_row(rows, COLUMNS, 'mean', 'every row')!;
		assert.strictEqual(mean.kind, 'summary');
		assert.approximately((mean.entries.a as { value: number }).value, 4, 1e-12);
		assert.approximately((mean.entries.c as { value: number }).value, 10, 1e-12);
		assert.include(mean.note, '2 of 3 rows');
		assert.strictEqual(mean.empty, null);
	});

	test('with fewer columns asked for, a row they all have comes back in', () => {
		const mean = to_geomean_row(rows, ['a', 'c'], 'mean', 'every row')!;
		assert.include(mean.note, '3 of 3 rows');
	});

	test('a row with a number that can not be ranked is left out too', () => {
		const unranked = to_row({ a: 2, b: 4, c: to_value_entry(1, { unranked: 'kept' }) });
		assert.ok(!matrix_row_is_complete(unranked, COLUMNS));
		assert.include(to_geomean_row([unranked, rows[0]!], COLUMNS, 'm', 'm')!.note, '1 of 2 rows');
	});

	test('with no complete row there is no mean, and the row says so', () => {
		const mean = to_geomean_row([rows[2]!], COLUMNS, 'mean', 'every row')!;
		assert.deepStrictEqual(mean.entries, {});
		assert.include(mean.empty, 'no row');
		assert.strictEqual(to_geomean_row([], COLUMNS, 'mean', 'every row'), null);
	});

	test('a row with a time at its call floor is left out too, for every column', () => {
		const floored = to_row({ a: 3, b: 400, c: 1000 }, { key: 'floored', call_floor: 5 });
		assert.ok(matrix_row_is_at_floor(floored, COLUMNS));
		assert.ok(!matrix_row_is_at_floor(floored, ['b', 'c']));
		assert.ok(!matrix_row_is_at_floor(rows[0]!, COLUMNS));
		const mean = to_geomean_row([floored, rows[0]!, rows[1]!], COLUMNS, 'mean', 'every row')!;
		assert.include(mean.note, '2 of 3 rows');
		assert.include(mean.note, 'a time at the call floor');
		assert.approximately((mean.entries.c as { value: number }).value, 10, 1e-12);
	});
});

describe('a mean and what it ranges over', () => {
	// two rows, each number with the fastest and the slowest of its passes
	const timed = (value: number, low: number, high: number): MatrixEntry =>
		to_value_entry(value, { spread: (high - low) / 2 / value, band: { low, high } });
	const rows = [
		to_row({ a: timed(100, 90, 120), b: timed(110, 100, 115), c: timed(400, 390, 410) }),
		to_row({ a: timed(400, 360, 480), b: timed(440, 400, 460), c: timed(1600, 1560, 1640) })
	];
	const mean = to_geomean_row(rows, COLUMNS, 'mean', 'every row')!;
	const entry = (column: string) => {
		const e = matrix_row_entry(mean, column);
		assert.ok(e.kind === 'value');
		return e;
	};

	test("its band runs from the mean of its rows' least readings to the mean of their most", () => {
		assert.approximately(entry('a').value, 200, 1e-9);
		assert.approximately(entry('a').band!.low, 180, 1e-9);
		assert.approximately(entry('a').band!.high, 240, 1e-9);
		assert.approximately(entry('b').band!.low, 200, 1e-9);
		assert.approximately(entry('b').band!.high, 230, 1e-9);
		// a mean has a band and no spread of its own
		assert.strictEqual(entry('a').spread, null);
		assert.include(entry('a').details.join(' '), 'least readings');
	});

	test('two means whose bands overlap are level: neither is ranked, and neither is a win', () => {
		const ratios = to_matrix_ratios(mean, COLUMNS, null);
		assert.ok(ratios.a!.baseline);
		assert.approximately(ratios.b!.ratio, 1.1, 1e-9);
		assert.strictEqual(ratios.b!.level, 'spread');
		// a mean whose band is clear of the baseline's is a difference
		assert.strictEqual(ratios.c!.level, null);
		// from the other side too
		assert.strictEqual(to_matrix_ratios(mean, COLUMNS, 'b').a!.level, 'spread');
		assert.ok(matrix_values_are_level(entry('a'), entry('b')));
		assert.ok(!matrix_values_are_level(entry('a'), entry('c')));
		// and the bars of a chart carry the same verdict
		const bars = to_matrix_bars(mean, COLUMNS, null);
		assert.strictEqual(bars[1]!.ratio!.level, 'spread');
		assert.strictEqual(bars[2]!.ratio!.level, null);
	});

	test('a mean of rows with one reading each is exact, and any gap between two is a difference', () => {
		const exact = to_geomean_row(
			[to_row({ a: 100, b: 110, c: 400 }), to_row({ a: 400, b: 440, c: 1600 })],
			COLUMNS,
			'mean',
			'every row'
		)!;
		const a = matrix_row_entry(exact, 'a');
		assert.ok(a.kind === 'value' && a.band === null);
		assert.deepStrictEqual(a.details, []);
		assert.strictEqual(to_matrix_ratios(exact, COLUMNS, null).b!.level, null);
	});

	test('rows with a spread and no readings of their own give the mean the spread to either side', () => {
		const spread = to_geomean_row(
			[
				to_row({
					a: to_value_entry(100, { spread: 0.1 }),
					b: to_value_entry(115, { spread: 0.1 })
				}),
				to_row({ a: to_value_entry(400, { spread: 0.1 }), b: to_value_entry(460, { spread: 0.1 }) })
			],
			['a', 'b'],
			'mean',
			'every row'
		)!;
		const a = matrix_row_entry(spread, 'a');
		assert.ok(a.kind === 'value' && a.band !== null);
		assert.approximately(a.band.low, 180, 1e-9);
		assert.approximately(a.band.high, 220, 1e-9);
		assert.deepStrictEqual(matrix_value_band(a), a.band);
		assert.strictEqual(to_matrix_ratios(spread, ['a', 'b'], null).b!.level, 'spread');
	});

	test('a least reading at zero or under starts the band at zero', () => {
		const wide = to_geomean_row(
			[to_row({ a: to_value_entry(1, { spread: 1.5 }), b: 10 })],
			['a', 'b'],
			'mean',
			'every row'
		)!;
		const a = matrix_row_entry(wide, 'a');
		assert.ok(a.kind === 'value');
		assert.deepStrictEqual(a.band, { low: 0, high: 2.5 });
	});

	const a_of = (row: MatrixRow) => row.entries.a as Extract<MatrixEntry, { kind: 'value' }>;
	const b_of = (row: MatrixRow) => row.entries.b as Extract<MatrixEntry, { kind: 'value' }>;

	test('a number of a row is still read by its spread, as the scripts mark a row', () => {
		// the passes range to one side, so the bands are apart where the spreads together cover the gap
		const row = to_row({ a: timed(100, 99, 101), b: timed(103, 102.5, 115) });
		assert.ok(!bands_overlap(matrix_value_band(a_of(row)), matrix_value_band(b_of(row))));
		assert.strictEqual(to_matrix_ratios(row, ['a', 'b'], null).b!.level, 'spread');
		const apart = to_row({ a: timed(100, 99, 101), b: timed(120, 119, 121) });
		assert.strictEqual(to_matrix_ratios(apart, ['a', 'b'], null).b!.level, null);
	});
});

describe('bars and text', () => {
	test('a bar is its number over the largest in the row, and an entry with none has no bar', () => {
		const bars = to_matrix_bars(to_row({ a: 50, b: NONE, c: 200 }), COLUMNS, null);
		assert.deepStrictEqual(
			bars.map((bar) => bar.fraction),
			[0.25, 0, 1]
		);
		assert.ok(!bars[1]!.has_value);
		assert.strictEqual(bars[1]!.text, 'not compiled');
		assert.strictEqual(bars[1]!.why, 'a reason');
		assert.strictEqual(bars[1]!.ratio, undefined);
		assert.ok(bars[0]!.ratio!.baseline);
		assert.strictEqual(matrix_rows_max([to_row({ a: 50, b: NONE, c: 200 })], COLUMNS), 200);
	});

	test('an entry prints its number in the row unit, with its mark, or what it says in place of one', () => {
		assert.strictEqual(format_matrix_entry(to_value_entry(1500), 'ns'), '1.50 µs');
		assert.strictEqual(format_matrix_entry(to_value_entry(1500), 'bytes'), '1.50 kB');
		assert.strictEqual(format_matrix_entry(to_value_entry(14175), 'count'), '14,175');
		assert.strictEqual(
			format_matrix_entry(to_value_entry(134, { mark: { text: '†', title: 't' } }), 'bytes'),
			'134 B†'
		);
		assert.strictEqual(
			format_matrix_entry(to_value_entry(0, { text: '≈ bare' }), 'bytes'),
			'≈ bare'
		);
		assert.strictEqual(format_matrix_entry(NONE, 'ns'), 'not compiled');
	});
});

describe('to_column_notes', () => {
	const to_column = (id: string, notes: MatrixColumn['notes']): MatrixColumn => ({
		id,
		label: id.toUpperCase(),
		by_maintainer: false,
		color: 'red',
		note: 'what of the package was measured',
		notes
	});
	const columns = [
		to_column('a', [
			{ about: ['valid', 'allocation'], text: 'returns its input' },
			{ about: ['heap'], text: 'keeps a schema' }
		]),
		to_column('b', []),
		to_column('c', [
			{ about: ['valid', 'invalid'], text: 'a check' },
			{ about: ['valid'], text: 'a check' },
			{ about: ['invalid'], text: 'stops at the first failure' }
		])
	];
	const texts = (about: Array<string>) =>
		to_column_notes(columns, about).map(({ column, texts: t }) => [column.id, t]);

	test('only the notes about what the chart or table measures, a column in its order', () => {
		assert.deepStrictEqual(texts(['valid']), [
			['a', ['returns its input']],
			['c', ['a check']]
		]);
		assert.deepStrictEqual(texts(['heap']), [['a', ['keeps a schema']]]);
		assert.deepStrictEqual(texts(['bundle']), []);
		assert.deepStrictEqual(texts([]), []);
	});

	test('a table of several kinds prints the notes about any of them, each text once', () => {
		assert.deepStrictEqual(texts(['valid', 'invalid']), [
			['a', ['returns its input']],
			['c', ['a check', 'stops at the first failure']]
		]);
	});

	test('what of the package was measured is not a note about a figure', () => {
		assert.ok(!JSON.stringify(texts(['valid', 'heap'])).includes('what of the package'));
	});
});
