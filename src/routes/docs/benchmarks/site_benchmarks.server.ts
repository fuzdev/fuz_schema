/**
 * Which results file the site renders, and whether it may: read from disk at
 * build time, in the server loads of the prerendered pages, so no results
 * file, no fixture, and no schema reaches the client bundle. A page receives
 * the validated data its load returns.
 *
 * The site shows one published run. With none published it shows no measured
 * number at all, and says so: bytes regenerate anywhere, but a page of them
 * alone would be most of a comparison missing. The fixture run, whose numbers
 * are invented, and a run named by path, which need not be publishable, are
 * rendered only when a build asks, and each is marked on every page.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	benchmark_results_find_gaps,
	benchmark_results_is_publishable,
	describe_benchmark_run,
	parse_benchmark_results,
	type BenchmarkResults
} from '../../../benchmarks/results_schema.ts';

/**
 * Where the results a page shows came from:
 *
 * - `published` - `results/latest.json`, the published run
 * - `fixture` - the test fixture, whose numbers are invented
 * - `file` - a run a build named by path, which may be a smoke run
 * - `none` - no run is published, and a page shows no measured number
 */
export type SiteBenchmarksSource = 'published' | 'fixture' | 'file' | 'none';

/** The results the site renders, and where they came from. */
export type SiteBenchmarks =
	| { source: 'none'; results: null }
	| { source: Exclude<SiteBenchmarksSource, 'none'>; results: BenchmarkResults };

/** The environment variable that makes a build render the fixture run: exactly `1`. */
export const SITE_FIXTURE_ENV = 'BENCH_RESULTS_FIXTURE';

/** The environment variable that makes a build render the run at a path, relative to the repository. */
export const SITE_FILE_ENV = 'BENCH_RESULTS_FILE';

/** The published run, relative to the repository. Absent until one is published. */
export const SITE_LATEST_PATH = 'results/latest.json';

/** The fixture run, whose numbers are invented, relative to the repository. */
export const SITE_FIXTURE_PATH = 'src/test/fixtures/results/fixture_run.json';

/** The parsed JSON of each results file the site may render, null for one that is absent or not asked for. */
export interface SiteBenchmarksFiles {
	/** The published run, or null when none is. */
	latest: unknown;
	/** The fixture run, given only when the build asked for it. */
	fixture: unknown;
	/** The run a build named by path, given only when it named one. */
	file: unknown;
}

/**
 * Chooses and validates the results the site renders. Every file given is
 * parsed through `parse_benchmark_results`, so no number reaches a page
 * unchecked.
 *
 * - A published run, where there is one, must pass
 *   `benchmark_results_is_publishable`, with no exception, whatever the build
 *   renders: a build over the fixture or a named file fails on a bad
 *   `latest.json` as any other does, so no build passes with one in the tree.
 * - With a fixture, the fixture, as `fixture`: the build asked for it.
 * - Otherwise with a named file, that run. It need not be publishable, and
 *   must hold every section a page renders. It is `file`, or `fixture` when
 *   the file says it is one, so invented numbers are marked as invented
 *   however a build came by them.
 * - Otherwise the published run, as `published`, or nothing, as `none`.
 *
 * @throws Error if a file doesn't parse, the named file lacks a section, or
 * the published run is not publishable
 */
export const resolve_site_benchmarks = (files: SiteBenchmarksFiles): SiteBenchmarks => {
	const latest = files.latest === null ? null : parse_benchmark_results(files.latest);
	if (latest && !benchmark_results_is_publishable(latest)) {
		throw new Error(
			`${SITE_LATEST_PATH} is not a publishable run, so the site won't show it as results: ${describe_benchmark_run(latest)}. Publish a full run of every section from a clean commit with \`npm run results:publish\`, or remove the file.`
		);
	}
	if (files.fixture !== null) {
		return { source: 'fixture', results: parse_benchmark_results(files.fixture) };
	}
	if (files.file !== null) {
		const results = parse_benchmark_results(files.file);
		const gaps = benchmark_results_find_gaps(results);
		if (gaps.length) {
			throw new Error(
				`the run ${SITE_FILE_ENV} names lacks ${gaps.map((gap) => `${gap.id} (${gap.why})`).join(', ')}, so the site can't render it: name a run of every section`
			);
		}
		return { source: results.meta.kind === 'fixture' ? 'fixture' : 'file', results };
	}
	return latest ? { source: 'published', results: latest } : { source: 'none', results: null };
};

/** Where the results files are, and what the build asked for. */
export interface LoadSiteBenchmarksOptions {
	/** The repository root. */
	dir: string;
	/** Whether the fixture run is rendered in place of real results. */
	fixture: boolean;
	/** A run to render in place of the published one, as a path under `dir`, or null. */
	file: string | null;
}

const read_json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Reads and validates the results the site renders. The fixture and a named
 * file are read only when asked for, so a default build opens neither.
 *
 * @throws Error if a file asked for is missing, or as `resolve_site_benchmarks` does
 */
export const load_site_benchmarks = (options: LoadSiteBenchmarksOptions): SiteBenchmarks => {
	const latest_path = join(options.dir, SITE_LATEST_PATH);
	return resolve_site_benchmarks({
		latest: existsSync(latest_path) ? read_json(latest_path) : null,
		fixture: options.fixture ? read_json(join(options.dir, SITE_FIXTURE_PATH)) : null,
		file: options.file === null ? null : read_json(join(options.dir, options.file))
	});
};

/** What an environment asks a build to render: the fixture, a named run, or neither. */
export const to_site_benchmarks_request = (
	env: Readonly<Record<string, string | undefined>>
): Pick<LoadSiteBenchmarksOptions, 'fixture' | 'file'> => ({
	fixture: env[SITE_FIXTURE_ENV] === '1',
	file: env[SITE_FILE_ENV] || null
});

/** The results for this process: the working directory's files, and its environment's choice. */
export const load_site_benchmarks_for_build = (): SiteBenchmarks =>
	load_site_benchmarks({ dir: process.cwd(), ...to_site_benchmarks_request(process.env) });
