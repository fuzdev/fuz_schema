import { assert, describe, test } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import Layout from '#routes/+layout.svelte';
import Home from '#routes/+page.svelte';
import { to_headline_charts } from '#routes/docs/benchmarks/benchmark_headline.ts';
import {
	to_coldstart_groups,
	to_creation_group,
	to_harvest_sets,
	to_lib_columns,
	to_survey_columns,
	to_survey_summary,
	to_time_groups
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import { to_column_notes } from '#routes/docs/benchmarks/benchmark_matrix.ts';
import BenchmarksChart from '#routes/docs/benchmarks/BenchmarksChart.svelte';
import BenchmarksNotes from '#routes/docs/benchmarks/BenchmarksNotes.svelte';
import BenchmarksProvenance from '#routes/docs/benchmarks/BenchmarksProvenance.svelte';
import BenchmarksSurveySummary from '#routes/docs/benchmarks/BenchmarksSurveySummary.svelte';
import BenchmarksTable from '#routes/docs/benchmarks/BenchmarksTable.svelte';
import BenchmarksText from '#routes/docs/benchmarks/BenchmarksText.svelte';
import SiteHarness from './SiteHarness.svelte';
import { load_fixture, load_full_run, to_measured } from './results_test_helpers.ts';

/**
 * What a component renders on the server, as the text a reader sees: the
 * markup without its tags, its comments, and what only a pointer reaches, the
 * `title` attributes, which are attributes and so gone with the tags.
 */
const render_text = (component: Component<any>, props: Record<string, unknown>): string =>
	render(component, { props }).body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ');

const results = load_fixture();
const columns = to_lib_columns(results.meta.libs);

describe('the banner', () => {
	const to_layout = (benchmarks_source: string): string =>
		render_text(Layout, { data: { benchmarks_source }, children: () => {} });

	test('every page of a build over the fixture says its numbers are invented', () => {
		assert.include(to_layout('fixture'), 'fixture data — invented numbers, not measurements');
	});

	test('every page of a build over a named run says its numbers are not results', () => {
		assert.include(to_layout('file'), 'an unpublished run — these numbers are not results');
	});

	test('a build over the published run, or over none, has no banner', () => {
		for (const source of ['published', 'none']) {
			assert.notInclude(to_layout(source), 'invented');
			assert.notInclude(to_layout(source), 'not results');
		}
	});
});

describe("what qualifies a library's figure is on the page as text, where the figure is", () => {
	const charts = to_headline_charts(results);
	const to_chart_text = (title: string): string => {
		const chart = charts.find((c) => c.title === title)!;
		return render_text(BenchmarksChart, {
			columns,
			row: chart.row,
			title: chart.title,
			note: chart.note,
			about: chart.about
		});
	};

	test('the notes are a line a library, with its code as code and no backtick', () => {
		const html = render(BenchmarksNotes, { props: { columns, about: ['invalid'] } }).body;
		const text = render_text(BenchmarksNotes, { columns, about: ['invalid'] });
		assert.include(text, 'TypeBox: Every row is a Check of its compiled validator');
		assert.include(text, 'builds no issues and no output');
		assert.notInclude(text, '`');
		assert.include(html, '<code>Check</code>');
		// a library with nothing to say of such a figure has no line
		assert.notInclude(text, 'Valibot:');
		assert.notInclude(text, 'fuz_schema:');
		// and with no kind of figure named there is no list at all
		assert.strictEqual(
			render(BenchmarksNotes, { props: { columns, about: [] } }).body.includes('<ul'),
			false
		);
	});

	test('a valid parse says that this library returns its input where others return a copy', () => {
		const text = to_chart_text('Parsing valid input');
		assert.include(
			text,
			'fuz_schema: A strict or identity parse of valid input returns the input itself, where Valibot and Zod return a copy.'
		);
		assert.include(text, 'TypeBox: Every row is a Check');
		assert.include(text, 'ArkType: A parse that drops keys deep-clones its input');
	});

	test('an invalid parse says compiled Zod falls back to the regular parser, and TypeBox builds no issues', () => {
		const text = to_chart_text('Rejecting invalid input');
		assert.include(
			text,
			"Zod compiled: Each root through z.compile , which hands an invalid input to Zod's regular parser"
		);
		assert.include(text, 'TypeBox: Every row is a Check');
		// what is about a valid parse alone is not under it
		assert.notInclude(text, 'returns the input itself');
	});

	test('a guard says which guards run the parser', () => {
		const text = to_chart_text('Answering only whether it matches');
		assert.include(text, 'Valibot: Its guard, is , runs the parser');
		assert.notInclude(text, 'deep-clones');
	});

	test('a chart prints only the notes about what it measures', () => {
		// a check that builds no issues says nothing of the bytes of a bundle
		const size = to_chart_text('Bundle size');
		assert.notInclude(size, 'Check');
		assert.notInclude(size, 'returns the input itself');
		assert.include(size, 'Zod compiled: It carries the compiler');
		const memory = to_chart_text('Memory held');
		assert.include(memory, 'ArkType: It keeps one schema of a definition');
		assert.notInclude(memory, 'Check');
		// and no two charts of different figures print the same lines
		const lines = charts.map((chart) =>
			JSON.stringify(to_column_notes(columns, chart.about).map(({ texts }) => texts))
		);
		assert.strictEqual(new Set(lines).size, lines.length);
	});

	test('the landing page draws every chart with the notes about it', () => {
		const home = render_text(Home, {
			data: {
				benchmarks: {
					columns,
					charts,
					machine: results.meta.machine.name,
					generated_at: results.meta.generated_at
				}
			}
		});
		assert.include(home, 'Rejecting invalid input');
		assert.include(home, 'returns the input itself, where Valibot and Zod return a copy');
		assert.include(home, "hands an invalid input to Zod's regular parser");
		// each chart's own, so a note about one figure is not repeated under all six
		assert.lengthOf(home.match(/returns the input itself/g)!, 1);
		assert.isBelow(home.match(/Every row is a Check/g)!.length, charts.length);
	});

	test('the landing page says what 1.00× is without calling it the best', () => {
		const home = render_text(Home, {
			data: {
				benchmarks: {
					columns,
					charts,
					machine: results.meta.machine.name,
					generated_at: results.meta.generated_at
				}
			}
		});
		assert.include(home, 'the least figure in its chart, which reads 1.00×');
		assert.notMatch(home, /is the best|the best library/);
	});

	test('under a table of the kinds it names, and under none that names no kind', () => {
		const groups = to_time_groups(results);
		const props = { columns, groups, heading: 'scenario', label: 'times' };
		const text = render_text(BenchmarksTable, { ...props, about: ['valid', 'invalid', 'guard'] });
		assert.include(text, 'TypeBox: Every row');
		assert.include(text, 'returns the input itself');
		assert.include(text, "hands an invalid input to Zod's regular parser");
		assert.notInclude(render_text(BenchmarksTable, props), 'TypeBox: Every row');
		assert.notInclude(render_text(BenchmarksTable, { ...props, about: ['bundle'] }), 'Check');
	});
});

describe('a chart and a table mark what is not a difference', () => {
	const charts = to_headline_charts(results);
	const guard = charts.find((chart) => chart.title === 'Answering only whether it matches')!;

	test('two means inside each other are marked on a chart, which says what the mark is', () => {
		const text = render_text(BenchmarksChart, { columns, row: guard.row, title: guard.title });
		assert.match(text, /≈1\.\d\d×/);
		assert.include(text, 'not a difference, and not ranked');
		// a chart with no such pair says nothing of the mark
		const size = charts.find((chart) => chart.title === 'Bundle size')!;
		assert.notInclude(render_text(BenchmarksChart, { columns, row: size.row, title: 't' }), '≈');
	});

	test('a mean prints its band under it in a table, and a row its spread', () => {
		const text = render_text(BenchmarksTable, {
			columns,
			groups: to_time_groups(results),
			heading: 'scenario',
			label: 'times'
		});
		assert.match(text, /\d ns [\d.]+ ns to [\d.]+ ns ≈1\.\d\d×/);
		assert.include(text, '±3.0%');
		assert.match(text, /~\d/);
	});

	test('the time to build a schema has its figures and no ratio', () => {
		const text = render_text(BenchmarksTable, {
			columns,
			groups: [to_creation_group(results)!],
			heading: 'scenario',
			label: 'creation'
		});
		assert.include(text, 'shown, not compared');
		assert.match(text, /\d ns|\d µs/);
		assert.notInclude(text, '×');
	});

	test('a cold-start memory row has ratios with the band of its samples, and none without', () => {
		const to_memory_text = (of: typeof results): string => {
			const [group] = to_coldstart_groups(of);
			return render_text(BenchmarksTable, {
				columns,
				groups: [{ ...group!, rows: group!.rows.filter((row) => row.key.endsWith(':memory')) }],
				heading: 'row',
				label: 'memory'
			});
		};
		const banded = to_memory_text(results);
		assert.match(banded, /±\d/);
		assert.include(banded, '×');
		assert.notInclude(banded, 'shown, not compared');
		const older = load_fixture();
		for (const row of to_measured(older, 'coldstart').rows) {
			for (const figures of Object.values(row.libs)) delete figures.rss_band_kb;
		}
		const unbanded = to_memory_text(older);
		assert.include(unbanded, 'shown, not compared');
		assert.match(unbanded, /\d kB|\d MB/);
		assert.notInclude(unbanded, '×');
	});

	// the markup of a rendered component, each tag's attributes as they are
	const render_html = (component: Component<any>, props: Record<string, unknown>): string =>
		render(component, { props }).body.replace(/<!--[\s\S]*?-->/g, '');

	// the opening tag of each table cell whose text matches, with the text
	const find_cells = (html: string, matcher: RegExp): Array<{ tag: string; text: string }> =>
		[...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)]
			.map((match) => ({ tag: match[1]!, text: match[2]!.replace(/<[^>]+>/g, ' ') }))
			.filter((cell) => matcher.test(cell.text));

	test('a level cell of a table is not tinted, and a cell that differs is', () => {
		const html = render_html(BenchmarksTable, {
			columns,
			groups: to_time_groups(results),
			heading: 'scenario',
			label: 'times'
		});
		const level = find_cells(html, /≈\d/);
		const floor = find_cells(html, /~\d/);
		const differs = find_cells(html, /\s\d[\d.,]*×/).filter((cell) => !/[≈~]/.test(cell.text));
		assert.isAbove(level.length, 0);
		assert.isAbove(floor.length, 0);
		assert.isAbove(differs.length, 0);
		for (const cell of [...level, ...floor]) {
			assert.notInclude(cell.tag, 'tinted', cell.text);
			assert.notInclude(cell.tag, '--ratio_color', cell.text);
		}
		for (const cell of differs) {
			assert.include(cell.tag, 'tinted', cell.text);
			assert.include(cell.tag, '--ratio_color', cell.text);
		}
		// a baseline another number is level with is marked and untinted with it
		assert.ok(level.some((cell) => cell.text.includes('≈1.00×')));
	});

	test('a level bar of a chart has no ratio color, and a bar that differs has one', () => {
		const html = render_html(BenchmarksChart, { columns, row: guard.row, title: guard.title });
		const ratios = [
			...html.matchAll(/<span\b([^>]*class="[^"]*bar-ratio[^"]*"[^>]*)>([\s\S]*?)<\/span>/g)
		].map((match) => ({ tag: match[1]!, text: match[2]!.trim() }));
		assert.lengthOf(ratios, columns.length);
		const level = ratios.filter((ratio) => ratio.text.startsWith('≈'));
		const differs = ratios.filter((ratio) => /^\d/.test(ratio.text));
		// the fixture's TypeBox and ArkType, the least of them among the level
		assert.deepStrictEqual(level.map((ratio) => ratio.text).sort(), ['≈1.00×', '≈1.05×']);
		assert.isAbove(differs.length, 0);
		for (const ratio of level) assert.notInclude(ratio.tag, 'color', ratio.text);
		for (const ratio of differs) assert.match(ratio.tag, /style="[^"]*color:/, ratio.text);
	});

	test('a survey mean whose band holds 1 is marked, and prints its band', () => {
		const data = structuredClone(to_measured(results, 'survey'));
		const row = data.rows.find((r) => r.does === 'array')!;
		const ours = row.libs.fuz_schema as { ns: number };
		(row.libs.zod_compiled as { ns: number }).ns = ours.ns * 1.02;
		const survey_columns = to_survey_columns(results);
		const text = render_text(BenchmarksSurveySummary, {
			rows: to_survey_summary(data),
			subject: survey_columns[0],
			others: survey_columns.slice(1)
		});
		assert.match(text, /≈0\.98× 0\.9\d× to 1\.0\d×/);
	});
});

describe('a harvested set', () => {
	const [set] = to_harvest_sets(results);
	const props = {
		columns: set!.columns,
		groups: set!.groups,
		heading: 'row',
		label: 'a set',
		fold: true
	};

	test('shows a summary of each group while its rows are folded away', () => {
		const text = render_text(BenchmarksTable, props);
		// each group's heading, its summary with how many rows it covers, and a way to open it
		for (const group of set!.groups) assert.include(text, group.label);
		assert.include(text, 'minified and gzipped');
		assert.include(text, 'every row geometric mean over 2 of 3 rows');
		assert.include(text, 'show 3 rows');
		assert.match(text, /\d\d\.\d µs|\d µs/);
		// and none of the rows themselves
		assert.notInclude(text, 'a report, last presence unknown');
	});

	test('names its sides as the roster does, each capitalized', () => {
		const text = render_text(BenchmarksTable, props);
		assert.include(text, 'Zod jitless');
		assert.include(text, 'Zod compiled');
		assert.notInclude(text, 'zod jitless');
	});
});

describe('text of the results file', () => {
	test('prints what is between backticks as code, and no backtick', () => {
		const html = render(BenchmarksText, {
			props: { text: 'the schemas of `repos status`, in zod and `this`' }
		}).body;
		assert.include(html, '<code>repos status</code>');
		assert.include(html, '<code>this</code>');
		assert.notInclude(html, '`');
		assert.include(render_text(BenchmarksText, { text: 'no code here' }), 'no code here');
	});
});

describe('the provenance', () => {
	const to_provenance = (of: typeof results): string =>
		render_text(SiteHarness, { component: BenchmarksProvenance, props: { results: of } });

	test("says in its text that this library's figures are of the source, not the package", () => {
		const text = to_provenance(results);
		assert.match(
			text,
			/fuz_schema: @fuzdev\/fuz_schema \S+\. This repository's source at the run's commit, not the published package/
		);
		// and what was measured of every other library that has a note
		assert.match(text, /TypeBox: typebox \S+\. The Check of its compiled validator\./);
		assert.match(text, /Zod Mini: zod \S+\. zod\/mini \./);
		assert.notInclude(text, '`');
	});

	test('says a fixture is no run, and a smoke run that its numbers mean nothing', () => {
		assert.include(to_provenance(results), 'It is a fixture and no run: every number is invented.');
		const smoke = load_full_run();
		smoke.meta.kind = 'smoke';
		assert.include(to_provenance(smoke), 'It is a smoke run');
		const full = to_provenance(load_full_run());
		assert.notInclude(full, 'fixture and no run');
		assert.notInclude(full, 'smoke run');
	});

	test('says a tree that changed as the run started or ended, and a commit that moved', () => {
		const clean = to_provenance(load_full_run());
		assert.notInclude(clean, 'changes the commit does not record');
		assert.notInclude(clean, 'as the run ended');
		for (const key of ['dirty', 'dirty_end'] as const) {
			const changed = load_full_run();
			changed.meta[key] = true;
			assert.include(to_provenance(changed), 'from a tree with changes the commit does not record');
		}
		const moved = load_full_run();
		moved.meta.commit_end = 'c'.repeat(40);
		assert.include(to_provenance(moved), 'which was at cccccccccc as the run ended');
	});
});
