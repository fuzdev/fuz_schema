import { assert, describe, test } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import Layout from '#routes/+layout.svelte';
import Home from '#routes/+page.svelte';
import { to_headline_charts } from '#routes/docs/benchmarks/benchmark_headline.ts';
import {
	to_allocation_groups,
	to_coldstart_groups,
	to_creation_group,
	to_harvest_sets,
	to_lib_columns,
	to_survey_columns,
	to_survey_summary,
	to_time_groups,
	to_types_group
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import { matrix_row_value, to_column_notes } from '#routes/docs/benchmarks/benchmark_matrix.ts';
import BenchmarksChart from '#routes/docs/benchmarks/BenchmarksChart.svelte';
import BenchmarksIntro from '#routes/docs/benchmarks/BenchmarksIntro.svelte';
import BenchmarksNotes from '#routes/docs/benchmarks/BenchmarksNotes.svelte';
import BenchmarksProvenance from '#routes/docs/benchmarks/BenchmarksProvenance.svelte';
import BenchmarksSurveySummary from '#routes/docs/benchmarks/BenchmarksSurveySummary.svelte';
import BenchmarksTable from '#routes/docs/benchmarks/BenchmarksTable.svelte';
import BenchmarksText from '#routes/docs/benchmarks/BenchmarksText.svelte';
import SiteHarness from './SiteHarness.svelte';
import {
	load_fixture,
	load_fixture_without_compiled,
	load_full_run,
	to_measured
} from './results_test_helpers.ts';

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
	// without the compiled mode, which leads the fixture's guards, so TypeBox and ArkType,
	// level with each other, are the best of a guard
	const results = load_fixture_without_compiled();
	const columns = to_lib_columns(results.meta.libs);
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

	test("a chart's bars are ranked best first, whatever the order of its columns", () => {
		const html = render_html(BenchmarksChart, { columns, row: guard.row, title: guard.title });
		const shown = [...html.matchAll(/data-column="([^"]+)"/g)].map((match) => match[1]);
		const reversed = render_html(BenchmarksChart, {
			columns: columns.toReversed(),
			row: guard.row,
			title: guard.title
		});
		assert.lengthOf(shown, columns.length);
		assert.deepStrictEqual(
			[...reversed.matchAll(/data-column="([^"]+)"/g)].map((match) => match[1]),
			shown
		);
		const values = shown.map((column) => matrix_row_value(guard.row, column!)!);
		assert.deepStrictEqual(
			values,
			values.toSorted((a, b) => a - b)
		);
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

describe('this library in its compiled mode is a column of its own, and reads as this library', () => {
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
	const without = to_lib_columns(load_fixture_without_compiled().meta.libs);

	test("its label begins with the library's, beside it, and it carries the library's mark", () => {
		const text = render_text(BenchmarksTable, {
			columns,
			groups: to_time_groups(results),
			heading: 'scenario',
			label: 'times'
		});
		assert.include(
			text,
			"scenario fuz_schema maintainer's fuz_schema compiled maintainer's Valibot Zod"
		);
		// and no other column is marked
		assert.lengthOf(text.match(/maintainer's/g)!, 2);
	});

	test('the introduction names one library compared with the others, and the mode as that library', () => {
		const text = render_text(BenchmarksIntro, { columns });
		assert.match(
			text,
			/This page compares fuz_schema maintainer's with Valibot ?, Zod ?, Zod compiled ?, Zod Mini ?, TypeBox ?, and ArkType ?:/
		);
		assert.include(
			text,
			"fuz_schema compiled maintainer's is fuz_schema in another mode and not another library, a column of its own beside it: what its figures include is under each table."
		);
		assert.match(
			text,
			/also maintains fuz_schema ?, so that library is marked wherever it is named, in each mode ?, and/
		);
		// it is not among what this library is compared with, and not a second library maintained
		assert.notMatch(text, /with[^:]*fuz_schema compiled[^:]*:/);
		assert.notMatch(text, /also maintains[^,]*compiled/);
	});

	test('the introduction of a file with no such column says nothing of a mode', () => {
		const text = render_text(BenchmarksIntro, { columns: without });
		assert.match(
			text,
			/This page compares fuz_schema maintainer's with Valibot ?, Zod ?, Zod compiled ?, Zod Mini ?, TypeBox ?, and ArkType ?:/
		);
		assert.match(
			text,
			/also maintains fuz_schema ?, so that library is marked wherever it is named ?, and/
		);
		assert.notInclude(text, 'another mode');
		assert.notInclude(text, 'in each mode');
		assert.notInclude(text, 'fuz_schema compiled');
	});

	test('under a figure is what a compiled figure of that kind includes', () => {
		// a parse of valid input is compiled code, and gives the input back where the interpreter does
		assert.include(
			to_chart_text('Parsing valid input'),
			'fuz_schema compiled: Each schema through compile_parse , whose compiled code builds what parse returns for a valid input: the input itself where nothing changed.'
		);
		// a parse of invalid input is the interpreter's
		const invalid = to_chart_text('Rejecting invalid input');
		assert.include(
			invalid,
			"fuz_schema compiled: Compiled code builds no issue: an invalid input is handed to parse , so a figure is the interpreter's parse after the compiled code has run to its first failure."
		);
		assert.notInclude(invalid, 'whose compiled code builds what');
		assert.include(
			to_chart_text('Answering only whether it matches'),
			'fuz_schema compiled: Each schema through compile_guard , which gives what is gives.'
		);
		// the bytes shipped, a cold start, and what is held each carry the compiler and the compile
		for (const title of ['Bundle size', 'Cold start', 'Memory held']) {
			const text = to_chart_text(title);
			assert.include(
				text,
				'fuz_schema compiled: It carries the compiler of compile.ts , and compiles while the schema is built.',
				title
			);
			assert.notInclude(text, 'handed to parse', title);
		}
	});

	test('under the tables of creation, allocation, and type-checking too', () => {
		const to_table_text = (groups: Array<unknown>, about: Array<string>): string =>
			render_text(BenchmarksTable, {
				columns,
				groups,
				heading: 'scenario',
				label: 'a table',
				about
			});
		assert.include(
			to_table_text([to_creation_group(results)!], ['creation']),
			'fuz_schema compiled: It carries the compiler of compile.ts , and compiles while the schema is built.'
		);
		const allocation = to_table_text(to_allocation_groups(results), ['allocation', 'creation']);
		assert.include(allocation, 'fuz_schema compiled: Each schema through compile_parse');
		assert.include(allocation, 'an invalid input is handed to parse');
		assert.include(allocation, 'compiles while the schema is built');
		assert.include(
			to_table_text([to_types_group(results)!], ['types']),
			'fuz_schema compiled: Its module calls compile_parse on each schema, and its reads are of what a compiled parse gives'
		);
	});

	test('a table of a file with no such column has no line of it', () => {
		const older = load_fixture_without_compiled();
		const text = render_text(BenchmarksTable, {
			columns: without,
			groups: to_time_groups(older),
			heading: 'scenario',
			label: 'times',
			about: ['valid', 'invalid', 'guard']
		});
		assert.notInclude(text, 'compile_parse');
		assert.notInclude(text, 'fuz_schema compiled');
		assert.include(text, "scenario fuz_schema maintainer's Valibot Zod");
	});

	test('the landing page compares against the other libraries, and says the mode is this library', () => {
		const to_home = (of: typeof results): string =>
			render_text(Home, {
				data: {
					benchmarks: {
						columns: to_lib_columns(of.meta.libs),
						charts: to_headline_charts(of),
						machine: of.meta.machine.name,
						generated_at: of.meta.generated_at
					}
				}
			});
		const home = to_home(results);
		assert.match(
			home,
			/Against Valibot, Zod, Zod compiled, Zod Mini, TypeBox, ArkType, from one run/
		);
		assert.include(
			home,
			'fuz_schema compiled is fuz_schema in another mode, and not another library.'
		);
		// each chart has its bar, the label not followed by a note's colon or the intro's
		// sentence, and no chart marks the maintainer's libraries
		assert.lengthOf(home.match(/fuz_schema compiled(?!:| is )/g)!, charts.length);
		assert.notInclude(home, "maintainer's");
		const older = to_home(load_fixture_without_compiled());
		assert.match(
			older,
			/Against Valibot, Zod, Zod compiled, Zod Mini, TypeBox, ArkType, from one run/
		);
		assert.notInclude(older, 'another mode');
		assert.notInclude(older, 'fuz_schema compiled');
	});

	test('the survey summary is of this library as it is imported, over each other column, the mode among them', () => {
		const survey_columns = to_survey_columns(results);
		const text = render_text(BenchmarksSurveySummary, {
			rows: to_survey_summary(to_measured(results, 'survey')),
			subject: survey_columns[0],
			others: survey_columns.slice(1)
		});
		assert.match(text, /The time of fuz_schema maintainer's over that of each other column/);
		assert.include(
			text,
			"over fuz_schema compiled maintainer's over Valibot over Zod over Zod compiled"
		);
		// a roster with the mode before the library still reads the subject the file names
		const reordered = load_fixture();
		reordered.meta.libs = [reordered.meta.libs[1]!, reordered.meta.libs[0]!].concat(
			reordered.meta.libs.slice(2)
		);
		assert.deepStrictEqual(
			to_survey_columns(reordered).map((column) => column.id),
			['fuz_schema', 'fuz_schema_compiled', 'valibot', 'zod', 'zod_compiled']
		);
	});

	test("the provenance says it is this repository's source compiled, and no other library", () => {
		const text = render_text(SiteHarness, { component: BenchmarksProvenance, props: { results } });
		assert.match(
			text,
			/fuz_schema compiled: @fuzdev\/fuz_schema \S+\. This repository's source at the run's commit, with each schema through compile_parse , or compile_guard for a guard: fuz_schema in its compiled mode, and no other library\./
		);
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

	test('has this library as it is imported, and no side of it compiled', () => {
		for (const of_set of to_harvest_sets(results)) {
			const ids = of_set.columns.map((column) => column.id);
			assert.include(ids, 'fuz_schema', of_set.name);
			assert.notInclude(ids, 'fuz_schema_compiled', of_set.name);
		}
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
