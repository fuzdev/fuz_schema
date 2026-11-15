import { assert, describe, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'svelte/server';
import type { Component } from 'svelte';

import Home from '#routes/+page.svelte';
import { to_headline_charts } from '#routes/docs/benchmarks/benchmark_headline.ts';
import {
	matrix_row_entry,
	to_maintained_columns,
	type MatrixGroup
} from '#routes/docs/benchmarks/benchmark_matrix.ts';
import {
	to_allocation_groups,
	to_coldstart_groups,
	to_creation_group,
	to_harvest_sets,
	to_heap_groups,
	to_lib_columns,
	to_section_data,
	to_size_group,
	to_survey_columns,
	to_survey_groups,
	to_survey_summary,
	to_time_groups,
	to_types_group
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import { SITE_LATEST_PATH } from '#routes/docs/benchmarks/site_benchmarks.server.ts';
import BenchmarksIntro from '#routes/docs/benchmarks/BenchmarksIntro.svelte';
import BenchmarksProvenance from '#routes/docs/benchmarks/BenchmarksProvenance.svelte';
import BenchmarksSurveySummary from '#routes/docs/benchmarks/BenchmarksSurveySummary.svelte';
import BenchmarksTable from '#routes/docs/benchmarks/BenchmarksTable.svelte';
import { LIB_NAMES } from '../benchmarks/lib_names.ts';
import { RESULTS_LIB_INFO } from '../benchmarks/results_plan.ts';
import {
	parse_benchmark_results,
	serialize_benchmark_results,
	type BenchmarkResults
} from '../benchmarks/results_schema.ts';
import { SURVEY_LIBS } from '../benchmarks/survey_shapes.ts';
import SiteHarness from './SiteHarness.svelte';
import {
	README_CLAIMS,
	README_CLAIMS_EVERY_OTHER,
	README_CLAIMS_SUBJECT,
	to_claim_others,
	to_subject_modes
} from './readme_claims.ts';
import {
	COMPILED_LIB,
	load_fixture,
	load_fixture_without_compiled,
	remove_lib,
	to_measured
} from './results_test_helpers.ts';

// The roster of a results file is what the file has. This library's compiled
// mode is an entry a file may have or lack: the published run lacks it until a
// run is taken with it, and every reader must take both kinds of file.

const COMPILED_LABEL = RESULTS_LIB_INFO[COMPILED_LIB].label;

/** What a component renders on the server, as the text a reader sees. */
const render_text = (component: Component<any>, props: Record<string, unknown>): string =>
	render(component, { props }).body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ');

/** The published run, where there is one: a file of whatever roster its run had. */
const load_published = (): BenchmarkResults | null => {
	const path = resolve(SITE_LATEST_PATH);
	return existsSync(path) ? parse_benchmark_results(JSON.parse(readFileSync(path, 'utf8'))) : null;
};

/** Each kind of file a reader is given, by what it is. */
const FILES: Array<[name: string, load: () => BenchmarkResults | null]> = [
	['a file with this library compiled', load_fixture],
	['a file without it', load_fixture_without_compiled],
	['the published run', load_published]
];

/** Every table of the benchmarks page, as the page builds them from a file. */
const to_tables = (
	results: BenchmarkResults
): Array<{
	name: string;
	columns: ReturnType<typeof to_lib_columns>;
	groups: Array<MatrixGroup>;
}> => {
	const columns = to_lib_columns(results.meta.libs);
	const creation = to_creation_group(results);
	const types = to_types_group(results);
	return [
		...(['gzip', 'brotli', 'minified'] as const).flatMap((measure) => {
			const group = to_size_group(results, measure);
			return group ? [{ name: `size ${measure}`, columns, groups: [group] }] : [];
		}),
		{ name: 'time', columns, groups: to_time_groups(results) },
		{ name: 'cold start', columns, groups: to_coldstart_groups(results) },
		...(creation ? [{ name: 'creation', columns, groups: [creation] }] : []),
		{ name: 'allocation', columns, groups: to_allocation_groups(results) },
		{ name: 'heap', columns, groups: to_heap_groups(results) },
		...(types ? [{ name: 'types', columns, groups: [types] }] : []),
		{ name: 'survey', columns: to_survey_columns(results), groups: to_survey_groups(results) },
		...to_harvest_sets(results).map((set) => ({
			name: `harvest ${set.name}`,
			columns: set.columns,
			groups: set.groups
		}))
	];
};

describe('a results file has the roster it has', () => {
	test('a file with this library compiled and a file without it both parse, and serialize as they are', () => {
		const with_it = parse_benchmark_results(load_fixture());
		const without = parse_benchmark_results(load_fixture_without_compiled());
		assert.include(
			with_it.meta.libs.map((lib) => lib.id),
			COMPILED_LIB
		);
		// the one without has no trace of it: no entry, no cell, no column of the survey
		assert.deepStrictEqual(
			without.meta.libs.map((lib) => lib.id),
			with_it.meta.libs.map((lib) => lib.id).filter((id) => id !== COMPILED_LIB)
		);
		assert.notInclude(serialize_benchmark_results(without), COMPILED_LIB);
		assert.notInclude(serialize_benchmark_results(without), COMPILED_LABEL);
		assert.deepStrictEqual(
			parse_benchmark_results(JSON.parse(serialize_benchmark_results(without))),
			without
		);
		// and nothing else of the file went with it
		const restored = load_fixture();
		remove_lib(restored, COMPILED_LIB);
		assert.deepStrictEqual(to_measured(restored, 'harvest'), to_measured(with_it, 'harvest'));
		assert.deepStrictEqual(to_measured(restored, 'wasm'), to_measured(with_it, 'wasm'));
	});

	test('a file that names the library in its roster and lacks a cell of it is refused, and the other way', () => {
		// what holds the two kinds of file apart: a roster and its cells agree, either way
		const lacks = load_fixture();
		delete to_measured(lacks, 'run').rows[0]!.libs[COMPILED_LIB];
		assert.throws(
			() => parse_benchmark_results(lacks),
			`library "${COMPILED_LIB}" has no entry here`
		);
		const extra = load_fixture_without_compiled();
		to_measured(extra, 'heap').rows[0]!.libs[COMPILED_LIB] = to_measured(load_fixture(), 'heap')
			.rows[0]!.libs[COMPILED_LIB]!;
		assert.throws(() => parse_benchmark_results(extra), `unknown library "${COMPILED_LIB}"`);
	});

	test('the roster a run records has this library compiled, and the published run has what its run had', () => {
		// a run taken now enters it, beside the library it is
		assert.strictEqual(LIB_NAMES[LIB_NAMES.indexOf('fuz_schema') + 1], COMPILED_LIB);
		assert.include(SURVEY_LIBS, COMPILED_LIB);
		// the published run is read as it is, whichever it is: every library of its roster is
		// one the page can label, and this library is among them
		const published = load_published();
		if (published) {
			const ids = published.meta.libs.map((lib) => lib.id);
			assert.include(ids, README_CLAIMS_SUBJECT);
			for (const lib of published.meta.libs) assert.isAbove(lib.label.length, 0, lib.id);
		}
	});
});

describe('each kind of file renders', () => {
	for (const [name, load] of FILES) {
		test(`${name}: every table has a cell for each library of its roster, and for no other`, () => {
			const results = load();
			if (!results) return;
			const roster = results.meta.libs;
			const has_compiled = roster.some((lib) => lib.id === COMPILED_LIB);
			const tables = to_tables(results);
			assert.isAbove(tables.length, 8);
			for (const table of tables) {
				assert.isAbove(table.groups.length, 0, table.name);
				// no column of a table is without an entry: a cell is a figure or says why it is none
				for (const group of table.groups) {
					for (const row of group.rows) {
						if (row.empty !== null) continue;
						for (const column of table.columns) {
							const entry = matrix_row_entry(row, column.id);
							assert.ok(
								entry.kind === 'value' || entry.text !== 'not measured',
								`${table.name} ${row.key} ${column.id}`
							);
						}
						assert.sameMembers(
							Object.keys(row.entries),
							table.columns.map((column) => column.id),
							`${table.name} ${row.key}`
						);
					}
				}
				const text = render_text(BenchmarksTable, {
					columns: table.columns,
					groups: table.groups,
					heading: 'row',
					label: table.name
				});
				for (const column of table.columns) assert.include(text, column.label, table.name);
				assert.notInclude(text, 'not measured', table.name);
				// a library in another mode is in a table only where the file has it
				if (!has_compiled) assert.notInclude(text, COMPILED_LABEL, table.name);
			}
			// the tables of the roster carry the compiled column exactly where the file has it
			const of_roster = tables.filter((table) => table.columns.length === roster.length);
			assert.isAbove(of_roster.length, 6);
			for (const table of of_roster) {
				assert.strictEqual(
					table.columns.some((column) => column.id === COMPILED_LIB),
					has_compiled,
					table.name
				);
			}
		});

		test(`${name}: the landing page, the introduction, the survey summary, and the provenance`, () => {
			const results = load();
			if (!results) return;
			const columns = to_lib_columns(results.meta.libs);
			const has_compiled = columns.some((column) => column.id === COMPILED_LIB);
			const charts = to_headline_charts(results);
			assert.isAbove(charts.length, 0);
			for (const chart of charts) {
				for (const column of columns) {
					assert.strictEqual(
						matrix_row_entry(chart.row, column.id).kind,
						'value',
						`${chart.title} ${column.id}`
					);
				}
			}
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
			const intro = render_text(BenchmarksIntro, { columns });
			const survey = to_section_data(results, 'survey')!;
			const survey_columns = to_survey_columns(results);
			const summary = render_text(BenchmarksSurveySummary, {
				rows: to_survey_summary(survey),
				subject: survey_columns[0],
				others: survey_columns.slice(1)
			});
			const provenance = render_text(SiteHarness, {
				component: BenchmarksProvenance,
				props: { results }
			});
			for (const text of [home, intro, summary, provenance]) {
				assert.strictEqual(text.includes(COMPILED_LABEL), has_compiled);
				assert.notInclude(text, 'undefined');
			}
			// what the page compares is this library with the others, in either kind of file
			assert.match(intro, /This page compares fuz_schema maintainer's with Valibot/);
			assert.match(intro, /also maintains fuz_schema ?, so that library is marked/);
			assert.strictEqual(survey_columns[0]!.id, README_CLAIMS_SUBJECT);
			assert.match(summary, /The time of fuz_schema maintainer's over that of each other column/);
		});
	}
});

describe("each kind of file bears the README's claims", () => {
	for (const [name, load] of FILES.slice(0, 2)) {
		test(`${name}: every claim holds, each about this library as it is imported`, () => {
			const results = load()!;
			for (const claim of README_CLAIMS) {
				const others = to_claim_others(claim, results);
				assert.notInclude(others, README_CLAIMS_SUBJECT, claim.sentence);
				assert.strictEqual(claim.check(results, others), null, claim.sentence);
				// "the libraries compared" are the other libraries of the roster the file has,
				// never this library's compiled mode, which is this library
				if (claim.others === README_CLAIMS_EVERY_OTHER) {
					assert.notInclude(others, COMPILED_LIB, claim.sentence);
					assert.sameMembers(
						[...others, ...to_subject_modes(results)],
						results.meta.libs.map((lib) => lib.id),
						claim.sentence
					);
				} else {
					// and no claim that names its libraries names the mode: no published run has it
					assert.notInclude(claim.others, COMPILED_LIB, claim.sentence);
				}
			}
		});
	}

	test("this library's modes are the entries of its package, as the roster records them", () => {
		assert.deepStrictEqual(to_subject_modes(load_fixture()), [README_CLAIMS_SUBJECT, COMPILED_LIB]);
		assert.deepStrictEqual(to_subject_modes(load_fixture_without_compiled()), [
			README_CLAIMS_SUBJECT
		]);
		// by the package and not the id: Zod Mini shares Zod's package and is no mode of this library
		assert.notInclude(to_subject_modes(load_fixture()), 'zod_mini');
	});

	test('the claims about the libraries compared hold where the compiled mode leads, and fail where another library does', () => {
		// each made to lead on what the claim is of: this library's own figure, a little less
		const changes: Array<
			[starts: string, change: (results: BenchmarkResults, lib: string) => void]
		> = [
			[
				'**Size:**',
				(results, lib) => {
					const { all } = to_measured(results, 'bundle');
					all[lib] = { ...all[README_CLAIMS_SUBJECT]!, gzip: all[README_CLAIMS_SUBJECT]!.gzip - 1 };
				}
			],
			[
				'**Cold start:**',
				(results, lib) => {
					for (const row of to_measured(results, 'coldstart').rows) {
						const ours = row.libs[README_CLAIMS_SUBJECT]!.stages.parse_100;
						row.libs[lib]!.stages.parse_100 = { ...ours, work_ms: ours.work_ms * 0.5 };
					}
				}
			],
			[
				'**Retained memory:**',
				(results, lib) => {
					for (const row of to_measured(results, 'heap').rows) {
						row.libs[lib]!.total_bytes = row.libs[README_CLAIMS_SUBJECT]!.total_bytes / 2;
					}
				}
			]
		];
		const every_other = README_CLAIMS.filter((claim) => claim.others === README_CLAIMS_EVERY_OTHER);
		assert.deepStrictEqual(
			every_other.map((claim) => claim.sentence.slice(0, claim.sentence.indexOf(':**') + 3)),
			changes.map(([starts]) => starts)
		);
		for (const [starts, change] of changes) {
			const claim = README_CLAIMS.find((c) => c.sentence.startsWith(starts))!;
			// the compiled mode is this library, not one compared with it: its lead fails nothing
			const compiled = load_fixture();
			change(compiled, COMPILED_LIB);
			assert.strictEqual(claim.check(compiled, to_claim_others(claim, compiled)), null, starts);
			// every other library is compared, and its lead fails the claim, naming it
			const others = to_claim_others(claim, load_fixture());
			assert.isAbove(others.length, 0, starts);
			for (const lib of others) {
				const results = load_fixture();
				change(results, lib);
				const failure = claim.check(results, to_claim_others(claim, results));
				assert.isString(failure, `${starts} ${lib}`);
				assert.include(failure, lib, `${starts} ${lib}`);
			}
		}
	});

	test('the maintained columns of each file are this library, and its mode where the file has it', () => {
		for (const [name, load] of FILES) {
			const results = load();
			if (!results) continue;
			const { libs, modes } = to_maintained_columns(to_lib_columns(results.meta.libs));
			assert.deepStrictEqual(
				libs.map((column) => column.id),
				[README_CLAIMS_SUBJECT],
				name
			);
			assert.deepStrictEqual(
				modes.map(({ column }) => column.id),
				results.meta.libs.some((lib) => lib.id === COMPILED_LIB) ? [COMPILED_LIB] : [],
				name
			);
		}
	});
});
