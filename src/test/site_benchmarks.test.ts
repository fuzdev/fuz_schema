import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
	SITE_FILE_ENV,
	SITE_FIXTURE_ENV,
	SITE_FIXTURE_PATH,
	SITE_LATEST_PATH,
	load_site_benchmarks,
	resolve_site_benchmarks,
	to_site_benchmarks_request
} from '#routes/docs/benchmarks/site_benchmarks.server.ts';
import type { BenchmarkResults } from '../benchmarks/results_schema.ts';
import { load_fixture, load_full_run } from './results_test_helpers.ts';

const NONE = { latest: null, fixture: null, file: null };

const to_smoke = (): BenchmarkResults => {
	const results = load_full_run();
	results.meta.kind = 'smoke';
	results.meta.dirty = true;
	return results;
};

describe('resolve_site_benchmarks', () => {
	test('with no published run, nothing: no measured number is shown', () => {
		assert.deepStrictEqual(resolve_site_benchmarks(NONE), { source: 'none', results: null });
	});

	test('a published run is rendered when it is publishable', () => {
		const site = resolve_site_benchmarks({ ...NONE, latest: load_full_run() });
		assert.strictEqual(site.source, 'published');
		assert.deepStrictEqual(site.results, load_full_run());
	});

	test('the fixture as the published run fails: invented numbers are never results', () => {
		assert.throws(
			() => resolve_site_benchmarks({ ...NONE, latest: load_fixture() }),
			/results\/latest\.json is not a publishable run.*kind: fixture, whose numbers are invented/
		);
	});

	test('a published run that is not publishable fails, and the failure says why', () => {
		const changes: Array<[change: (results: BenchmarkResults) => void, says: string]> = [
			[(results) => (results.meta.kind = 'smoke'), 'kind: smoke'],
			[(results) => (results.meta.dirty = true), 'with changes it does not record'],
			[(results) => (results.meta.dirty_end = true), 'with changes it does not record'],
			[
				(results) => {
					if (results.run.status === 'measured') results.run.args = ['--passes', '1'];
				},
				'run (--passes 1)'
			],
			[
				(results) => (results.survey = { status: 'skipped', reason: 'left out' }),
				'survey (left out)'
			]
		];
		for (const [change, says] of changes) {
			const latest = load_full_run();
			change(latest);
			try {
				resolve_site_benchmarks({ ...NONE, latest });
			} catch (error) {
				assert(error instanceof Error);
				assert.include(error.message, 'results/latest.json is not a publishable run');
				assert.include(error.message, says);
				continue;
			}
			assert.fail(`expected the run to be refused: ${says}`);
		}
	});

	test('a file that does not parse fails, wherever it is', () => {
		const broken = { ...load_fixture(), extra: 1 };
		for (const key of ['latest', 'fixture', 'file'] as const) {
			assert.throws(
				() => resolve_site_benchmarks({ ...NONE, [key]: broken }),
				/invalid benchmark results/
			);
		}
	});

	test('the fixture is rendered as the fixture, with or without a published run', () => {
		for (const latest of [null, load_full_run()]) {
			const site = resolve_site_benchmarks({ latest, fixture: load_fixture(), file: to_smoke() });
			assert.strictEqual(site.source, 'fixture');
		}
	});

	test('a build over the fixture or a named run still fails on a bad published run', () => {
		for (const latest of [to_smoke(), load_fixture(), { ...load_full_run(), extra: 1 }]) {
			assert.throws(
				() => resolve_site_benchmarks({ latest, fixture: load_fixture(), file: null }),
				/not a publishable run|invalid benchmark results/
			);
			assert.throws(
				() => resolve_site_benchmarks({ latest, fixture: null, file: to_smoke() }),
				/not a publishable run|invalid benchmark results/
			);
		}
	});

	test('a named file that is the fixture is marked as the fixture', () => {
		const site = resolve_site_benchmarks({ ...NONE, file: load_fixture() });
		assert.strictEqual(site.source, 'fixture');
	});

	test('a named run need not be publishable, and must hold every section a page renders', () => {
		const site = resolve_site_benchmarks({ ...NONE, latest: load_full_run(), file: to_smoke() });
		assert.strictEqual(site.source, 'file');
		assert.strictEqual(site.results?.meta.kind, 'smoke');
		const narrowed = to_smoke();
		narrowed.heap = {
			status: 'failed',
			script: 'x',
			command: 'x',
			args: [],
			duration_ms: 1,
			error: 'it exited with 1'
		};
		assert.throws(
			() => resolve_site_benchmarks({ ...NONE, file: narrowed }),
			/lacks heap \(it exited with 1\)/
		);
		// the optional section may be left out
		const without_wasm = to_smoke();
		without_wasm.wasm = { status: 'skipped', reason: 'not asked for' };
		assert.strictEqual(resolve_site_benchmarks({ ...NONE, file: without_wasm }).source, 'file');
	});
});

describe('load_site_benchmarks', () => {
	let dir: string;

	const write = (path: string, results: unknown): void => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), JSON.stringify(results));
	};

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'site_benchmarks_'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true });
	});

	test('reads the published run where there is one, and nothing where there is none', () => {
		assert.strictEqual(load_site_benchmarks({ dir, fixture: false, file: null }).source, 'none');
		write(SITE_LATEST_PATH, load_full_run());
		assert.strictEqual(
			load_site_benchmarks({ dir, fixture: false, file: null }).source,
			'published'
		);
	});

	test('opens the fixture and a named file only when asked, and fails when one asked for is missing', () => {
		// neither is there, and a default build doesn't look
		assert.strictEqual(load_site_benchmarks({ dir, fixture: false, file: null }).source, 'none');
		assert.throws(() => load_site_benchmarks({ dir, fixture: true, file: null }), /ENOENT/);
		assert.throws(
			() => load_site_benchmarks({ dir, fixture: false, file: 'results/scratch/a.json' }),
			/ENOENT/
		);
		write(SITE_FIXTURE_PATH, load_fixture());
		write('results/scratch/a.json', to_smoke());
		assert.strictEqual(load_site_benchmarks({ dir, fixture: true, file: null }).source, 'fixture');
		assert.strictEqual(
			load_site_benchmarks({ dir, fixture: false, file: 'results/scratch/a.json' }).source,
			'file'
		);
	});

	test('the fixture path is the committed fixture', () => {
		assert.strictEqual(SITE_FIXTURE_PATH, 'src/test/fixtures/results/fixture_run.json');
		assert.strictEqual(
			load_site_benchmarks({ dir: process.cwd(), fixture: true, file: null }).source,
			'fixture'
		);
	});
});

describe('to_site_benchmarks_request', () => {
	test('the fixture is asked for by exactly 1, and a file by its path', () => {
		assert.deepStrictEqual(to_site_benchmarks_request({}), { fixture: false, file: null });
		assert.deepStrictEqual(to_site_benchmarks_request({ [SITE_FIXTURE_ENV]: '1' }), {
			fixture: true,
			file: null
		});
		for (const value of ['0', 'true', '']) {
			assert.ok(!to_site_benchmarks_request({ [SITE_FIXTURE_ENV]: value }).fixture, value);
		}
		assert.strictEqual(
			to_site_benchmarks_request({ [SITE_FILE_ENV]: 'results/scratch/smoke_x.json' }).file,
			'results/scratch/smoke_x.json'
		);
		assert.strictEqual(to_site_benchmarks_request({ [SITE_FILE_ENV]: '' }).file, null);
	});
});
