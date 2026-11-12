/**
 * The headline figures of the landing page, each one row drawn as bars, read
 * from a results file by the functions the benchmarks page builds its tables
 * with, so a chart never shows a number the page doesn't.
 *
 * They are chosen by rule and not by outcome: the whole of each section's
 * comparison, as a geometric mean over every row all the libraries have a
 * figure of, or the one bundle of every scenario. So a figure this library
 * trails on is drawn like one it leads.
 *
 * @module
 */

import type { BenchmarkFigureKind, BenchmarkResults } from '../../../benchmarks/results_schema.ts';
import { to_geomean_row, type MatrixRow } from './benchmark_matrix.ts';
import {
	COLDSTART_SUMMARY_STAGE,
	TIME_INPUTS,
	to_coldstart_groups,
	to_heap_groups,
	to_size_group,
	to_time_groups
} from './benchmark_sections.ts';

/**
 * The titles of the benchmarks page's sections, which its in-page anchors and
 * the landing page's links slugify, so a rename can't orphan a link.
 */
export const BENCHMARK_SECTION_TITLES = {
	size: 'Bundle size',
	time: 'Parse time',
	coldstart: 'Cold start',
	memory: 'Memory',
	types: 'Type-checking cost',
	survey: 'Survey',
	harvest: 'Harvested sets',
	method: 'How it was measured'
} as const;
export type BenchmarkSectionId = keyof typeof BENCHMARK_SECTION_TITLES;

/** A headline figure drawn as bars, with what its heading says and the section it summarizes. */
export interface HeadlineChart {
	row: MatrixRow;
	title: string;
	/** Under the bars: the unit and what was measured. */
	note: string;
	/** The kinds of figure it is of, by which the roster's notes about it are found. */
	about: Array<BenchmarkFigureKind>;
	/** The section of the benchmarks page that has every row behind the figure. */
	section: BenchmarkSectionId;
}

/** The form of entry the cold-start headline reads: the chunk a bundler makes. */
export const HEADLINE_COLDSTART_FORM = 'bundled';

/**
 * The headline figures: the bundle of every scenario gzipped, parse time on
 * valid input, on invalid input, and as a guard, the cold start of a bundled
 * entry to its first parse, and the memory held after one schema. Each timed
 * one is a geometric mean over the rows every library has a figure of, and
 * its note says how many of how many. A figure the file holds no number for
 * is left out.
 */
export const to_headline_charts = (results: BenchmarkResults): Array<HeadlineChart> => {
	const columns = results.meta.libs.map((lib) => lib.id);
	const charts: Array<HeadlineChart> = [];
	const to_note = (unit: string, row: MatrixRow): string =>
		row.note ? `${unit}, ${row.note}` : unit;

	const size = to_size_group(results, 'gzip')?.rows.find((row) => row.kind === 'summary');
	if (size) {
		charts.push({
			row: size,
			title: 'Bundle size',
			note: 'bytes of every scenario in one bundle, minified and gzipped',
			about: ['bundle'],
			section: 'size'
		});
	}

	const time_groups = to_time_groups(results);
	for (const { id, label } of TIME_INPUTS) {
		const row = time_groups
			.find((group) => group.key === `time:${id}`)
			?.rows.find((r) => r.kind === 'summary');
		if (row) {
			charts.push({
				row,
				title: label,
				note: to_note('time per call', row),
				about: [id],
				section: 'time'
			});
		}
	}

	const first_parses = to_coldstart_groups(results)
		.filter((group) => group.key.endsWith(`:${HEADLINE_COLDSTART_FORM}`))
		.flatMap((group) =>
			group.rows.filter((row) => row.key.endsWith(`:${COLDSTART_SUMMARY_STAGE}`))
		);
	const coldstart = to_geomean_row(first_parses, columns, 'headline:coldstart', 'every scenario');
	if (coldstart) {
		charts.push({
			row: coldstart,
			title: 'Cold start',
			note: to_note(
				`work inside a fresh process to import a ${HEADLINE_COLDSTART_FORM} entry, build a schema, and parse once`,
				coldstart
			),
			about: ['coldstart'],
			section: 'coldstart'
		});
	}

	const held = to_heap_groups(results).find((group) => group.key === 'heap:total');
	const memory = held && to_geomean_row(held.rows, columns, 'headline:memory', 'every scenario');
	if (memory) {
		charts.push({
			row: memory,
			title: 'Memory held',
			note: to_note(
				'what a process holds after one schema is built and has parsed once, over a bare one',
				memory
			),
			about: ['heap'],
			section: 'memory'
		});
	}

	return charts.filter(
		(chart) => chart.row.empty === null && Object.keys(chart.row.entries).length > 0
	);
};
