import { assert, describe, test } from 'vitest';

import {
	BENCHMARK_SECTION_TITLES,
	to_headline_charts
} from '#routes/docs/benchmarks/benchmark_headline.ts';
import {
	matrix_row_entry,
	matrix_row_value,
	to_matrix_bars,
	to_ranked_columns
} from '#routes/docs/benchmarks/benchmark_matrix.ts';
import {
	HEAP_TOTAL_TOLERANCE_BYTES,
	to_run_call_floor
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import { to_geomean } from '#routes/docs/benchmarks/benchmark_ratio.ts';
import { load_fixture, to_measured } from './results_test_helpers.ts';

const to_titles = (charts: ReturnType<typeof to_headline_charts>): Array<string> =>
	charts.map((chart) => chart.title);

describe('to_headline_charts', () => {
	test('with a whole run, every figure, each a number for every library', () => {
		const results = load_fixture();
		const charts = to_headline_charts(results);
		assert.deepStrictEqual(to_titles(charts), [
			'Bundle size',
			'Parsing valid input',
			'Rejecting invalid input',
			'Answering only whether it matches',
			'Cold start',
			'Memory held',
			'Memory per further schema'
		]);
		for (const { row, section } of charts) {
			assert.strictEqual(row.empty, null, row.key);
			for (const { id } of results.meta.libs) {
				assert.strictEqual(matrix_row_entry(row, id).kind, 'value', `${row.key} ${id}`);
			}
			assert.ok(Object.hasOwn(BENCHMARK_SECTION_TITLES, section));
		}
	});

	test('the figures are the whole of a comparison, whoever leads it', () => {
		const results = load_fixture();
		const charts = to_headline_charts(results);
		const by_title = new Map(charts.map((chart) => [chart.title, chart.row]));
		// the one bundle of every scenario
		assert.strictEqual(
			matrix_row_value(by_title.get('Bundle size')!, 'typebox'),
			to_measured(results, 'bundle').all.typebox!.gzip
		);
		// a mean over every scenario all the libraries have past the call floor, not a scenario
		// picked for its outcome
		const run = to_measured(results, 'run');
		const rows = run.rows.filter(
			(row) =>
				row.input === 'guard' &&
				Object.values(row.libs).every((cell) =>
					'none' in cell ? cell.none === 'uncompiled' : cell.ns > to_run_call_floor(run)
				)
		);
		assert.approximately(
			matrix_row_value(by_title.get('Answering only whether it matches')!, 'typebox')!,
			to_geomean(rows.map((row) => (row.libs.typebox as { ns: number }).ns))!,
			1e-9
		);
		assert.include(charts[1]!.note, `${rows.length} of`);
		// and this library is drawn where it trails, as the fixture has it on valid input
		const valid = by_title.get('Parsing valid input')!;
		assert.isAbove(matrix_row_value(valid, 'fuz_schema')!, matrix_row_value(valid, 'typebox')!);
	});

	test('a timed figure is a mean with a band, and two inside each other are not ranked', () => {
		const results = load_fixture();
		const charts = to_headline_charts(results);
		const columns = results.meta.libs.map((lib) => lib.id);
		for (const title of [
			'Parsing valid input',
			'Rejecting invalid input',
			'Answering only whether it matches',
			'Cold start'
		]) {
			const { row } = charts.find((chart) => chart.title === title)!;
			for (const column of columns) {
				const entry = matrix_row_entry(row, column);
				assert.ok(entry.kind === 'value' && entry.band !== null, `${title} ${column}`);
				assert.isBelow(entry.band.low, entry.band.high, `${title} ${column}`);
			}
		}
		// the fixture's TypeBox and compiled Zod are level as guards, the best but for the compiled
		// mode: the bars say so
		const guard = charts.find((chart) => chart.title === 'Answering only whether it matches')!;
		const bars = to_matrix_bars(
			guard.row,
			columns.filter((column) => column !== 'fuz_schema_compiled'),
			null
		);
		const of = (column: string) => bars.find((bar) => bar.column === column)!.ratio!;
		assert.ok(of('typebox').baseline);
		assert.strictEqual(of('zod_compiled').level, 'spread');
		assert.strictEqual(of('fuz_schema').level, null);
		// the bytes of a bundle are exact, so its figures have no band and every gap is a difference
		const size = charts.find((chart) => chart.title === 'Bundle size')!;
		for (const column of columns) {
			const entry = matrix_row_entry(size.row, column);
			assert.ok(entry.kind === 'value' && entry.band === null, column);
		}
	});

	test('a chart ranks its bars best first, and those with no number last', () => {
		const results = load_fixture();
		const columns = results.meta.libs.map((lib) => lib.id);
		for (const { row, title } of to_headline_charts(results)) {
			const values = to_ranked_columns(row, columns).map((column) =>
				matrix_row_value(row, column)!
			);
			const sorted = values.toSorted((a, b) => (row.direction === 'lower' ? a - b : b - a));
			assert.deepStrictEqual(values, sorted, title);
		}
		// a column with no number goes last, and equals keep the order given
		const { row } = to_headline_charts(results)[0]!;
		const rest = Object.fromEntries(
			Object.entries(row.entries).filter(([column]) => column !== columns[0])
		);
		const ranked = to_ranked_columns({ ...row, entries: rest }, columns);
		assert.strictEqual(ranked.at(-1), columns[0]);
		const level = Object.fromEntries(columns.map((column) => [column, row.entries[columns[0]!]!]));
		assert.deepStrictEqual(to_ranked_columns({ ...row, entries: level }, columns), columns);
		assert.deepStrictEqual(
			to_ranked_columns({ ...row, direction: 'higher' }, columns),
			to_ranked_columns(row, columns).reverse()
		);
	});

	test('memory held is a mean of totals, each read with what a total repeats to', () => {
		const results = load_fixture();
		const { row } = to_headline_charts(results).find((chart) => chart.title === 'Memory held')!;
		const totals = to_measured(results, 'heap').rows.map((r) => r.libs.zod!.total_bytes);
		const entry = matrix_row_entry(row, 'zod');
		assert.ok(entry.kind === 'value' && entry.band !== null);
		assert.approximately(
			entry.band.low,
			to_geomean(totals.map((total) => total - HEAP_TOTAL_TOLERANCE_BYTES))!,
			1e-6
		);
		assert.approximately(
			entry.band.high,
			to_geomean(totals.map((total) => total + HEAP_TOTAL_TOLERANCE_BYTES))!,
			1e-6
		);
		// two libraries whose totals are within that of each other are level in the chart
		const close = load_fixture();
		for (const r of to_measured(close, 'heap').rows) {
			r.libs.valibot!.total_bytes = r.libs.fuz_schema!.total_bytes + 900;
		}
		const of_close = to_headline_charts(close).find((chart) => chart.title === 'Memory held')!;
		const ratios = to_matrix_bars(
			of_close.row,
			results.meta.libs.map((lib) => lib.id),
			null
		);
		assert.strictEqual(ratios.find((bar) => bar.column === 'valibot')!.ratio!.level, 'spread');
		assert.strictEqual(ratios.find((bar) => bar.column === 'fuz_schema')!.ratio!.level, 'spread');
		assert.strictEqual(ratios.find((bar) => bar.column === 'zod')!.ratio!.level, null);
	});

	test('each chart says what kinds of figure it is of, for the notes under it', () => {
		const about = Object.fromEntries(
			to_headline_charts(load_fixture()).map((chart) => [chart.title, chart.about])
		);
		assert.deepStrictEqual(about, {
			'Bundle size': ['bundle'],
			'Parsing valid input': ['valid'],
			'Rejecting invalid input': ['invalid'],
			'Answering only whether it matches': ['guard'],
			'Cold start': ['coldstart'],
			'Memory held': ['heap'],
			'Memory per further schema': ['heap']
		});
	});

	test('memory is two figures: what one schema leaves held, and what each further one adds', () => {
		const results = load_fixture();
		const charts = to_headline_charts(results);
		const rows = to_measured(results, 'heap').rows;
		const further = charts.find((chart) => chart.title === 'Memory per further schema')!;
		assert.approximately(
			matrix_row_value(further.row, 'valibot')!,
			to_geomean(rows.map((row) => row.libs.valibot!.further_schema_bytes))!,
			1e-6
		);
		assert.include(further.note, 'read between processes holding');
		// and not the total, which is another chart's
		const held = charts.find((chart) => chart.title === 'Memory held')!;
		assert.notStrictEqual(
			matrix_row_value(further.row, 'valibot'),
			matrix_row_value(held.row, 'valibot')
		);
		// a file with no retained heap has neither
		const without = load_fixture();
		without.heap = { status: 'skipped', reason: 'left out' };
		assert.notInclude(to_titles(to_headline_charts(without)), 'Memory per further schema');
	});

	test('cold start reads the bundled form, and memory the total held', () => {
		const results = load_fixture();
		const charts = to_headline_charts(results);
		const bundled = to_measured(results, 'coldstart').rows.filter((row) => row.form === 'bundled');
		assert.approximately(
			matrix_row_value(charts.find((chart) => chart.title === 'Cold start')!.row, 'zod')!,
			to_geomean(bundled.map((row) => row.libs.zod!.stages.first_parse.work_ms))!,
			1e-9
		);
		assert.approximately(
			matrix_row_value(charts.find((chart) => chart.title === 'Memory held')!.row, 'zod')!,
			to_geomean(to_measured(results, 'heap').rows.map((row) => row.libs.zod!.total_bytes))!,
			1e-6
		);
	});

	test('a figure the file has no number for is left out', () => {
		const results = load_fixture();
		results.run = { status: 'skipped', reason: 'left out' };
		results.heap = {
			status: 'failed',
			script: 'x',
			command: 'x',
			args: [],
			duration_ms: 1,
			error: 'e'
		};
		assert.deepStrictEqual(to_titles(to_headline_charts(results)), ['Bundle size', 'Cold start']);
		// and a mean no scenario is complete for has no number
		const partial = load_fixture();
		for (const row of to_measured(partial, 'run').rows) {
			if (row.input === 'guard') row.libs.zod_compiled = { none: 'differs', why: null };
		}
		assert.notInclude(to_titles(to_headline_charts(partial)), 'Answering only whether it matches');
	});
});
