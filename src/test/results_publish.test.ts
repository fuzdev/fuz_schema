import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, publish_results, results_commit_exists } from '../benchmarks/results_publish.ts';
import {
	serialize_benchmark_results,
	type BenchmarkResults
} from '../benchmarks/results_schema.ts';
import { load_fixture, load_full_run } from './results_test_helpers.ts';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'results_publish_'));
	mkdirSync(join(dir, 'scratch'));
});

afterEach(() => {
	rmSync(dir, { recursive: true });
});

const write = (name: string, change?: (results: BenchmarkResults) => void): string => {
	const results = load_full_run();
	change?.(results);
	const path = join(dir, name);
	writeFileSync(path, serialize_benchmark_results(results));
	return path;
};

// every commit is one the repository has, but where a test says otherwise
const has_commit = (): boolean => true;

const assert_refused = (path: string, includes: string): void => {
	const published = publish_results(path, dir, has_commit);
	assert.ok(!published.ok, 'expected the file to be refused');
	assert.include(published.message, includes);
	assert.ok(!existsSync(join(dir, 'latest.json')), 'nothing is written for a refused file');
};

describe('publish_results', () => {
	test('copies a publishable run to latest.json, byte for byte', () => {
		const path = write('2026-01-01_fixture.json');
		const published = publish_results(path, dir, has_commit);
		assert.ok(published.ok);
		assert.strictEqual(published.path, join(dir, 'latest.json'));
		assert.ok(readFileSync(published.path).equals(readFileSync(path)));
		// and replaces the one before
		const next = write('2026-01-02_fixture.json', (results) => (results.meta.duration_ms += 1));
		assert.ok(publish_results(next, dir, has_commit).ok);
		assert.ok(readFileSync(join(dir, 'latest.json')).equals(readFileSync(next)));
	});

	test('refuses a run that is not publishable, with the facts', () => {
		assert_refused(
			write('a.json', (results) => (results.meta.kind = 'smoke')),
			'not a publishable run: kind: smoke'
		);
		assert_refused(
			write('b.json', (results) => (results.meta.dirty = true)),
			'with changes it does not record'
		);
		assert_refused(
			write('c.json', (results) => {
				results.heap = { status: 'skipped', reason: 'left out' };
			}),
			'sections without data: heap (left out)'
		);
		assert_refused(
			write('d.json', (results) => (results.meta.dirty_end = true)),
			'commit as it ended: the same, with changes it does not record'
		);
	});

	test('refuses the fixture copied into the results directory', () => {
		const path = join(dir, '2026-01-01_fixture.json');
		writeFileSync(path, serialize_benchmark_results(load_fixture()));
		assert_refused(path, 'not a publishable run: kind: fixture, whose numbers are invented');
		// and the committed file itself, byte for byte
		const copy = join(dir, '2026-01-02_fixture.json');
		writeFileSync(
			copy,
			readFileSync(new URL('./fixtures/results/fixture_run.json', import.meta.url))
		);
		assert_refused(copy, 'kind: fixture');
	});

	test('refuses a run whose timed section took one pass, which has no spread to read it by', () => {
		assert_refused(
			write('one_pass.json', (results) => {
				assert.ok(results.run.status === 'measured');
				results.run.data.passes = 1;
				for (const row of results.run.data.rows) {
					for (const cell of Object.values(row.libs)) if (!('none' in cell)) cell.spread = null;
				}
			}),
			'timed sections of one pass: run'
		);
	});

	test('refuses a run of a commit the repository does not have, and nothing is written', () => {
		const path = write('2026-01-01_laptop1.json');
		const asked: Array<string> = [];
		const published = publish_results(path, dir, (commit) => (asked.push(commit), false));
		assert.ok(!published.ok);
		assert.include(published.message, `records the commit ${'a'.repeat(40)}`);
		assert.include(published.message, "this repository doesn't have");
		assert.deepStrictEqual(asked, ['a'.repeat(40)]);
		assert.ok(!existsSync(join(dir, 'latest.json')));
		// and by default it is git that is asked: a directory in no checkout has no commit
		const by_default = publish_results(path, dir);
		assert.ok(!by_default.ok);
		assert.include(by_default.message, "this repository doesn't have");
		assert.strictEqual(main([path], dir), 2);
	});

	test('refuses a run under the kind of a full one whose scripts were given args', () => {
		assert_refused(
			write('narrowed.json', (results) => {
				if (results.run.status === 'measured') {
					results.run.args = ['--passes', '1', '--scenario', 'string'];
				}
			}),
			'sections started with args a full run does not give: run (--passes 1 --scenario string)'
		);
	});

	test('refuses a file that is not a results file, or can not be read', () => {
		const path = join(dir, 'broken.json');
		writeFileSync(path, '{"meta": {}}');
		assert_refused(path, 'is not a results file');
		writeFileSync(path, 'not json');
		assert_refused(path, 'is not a results file');
		assert_refused(join(dir, 'absent.json'), "can't read");
	});

	test('refuses a run in scratch, one elsewhere, and a link to either', () => {
		assert_refused(write('scratch/full_fixture.json'), 'in scratch/');
		const elsewhere = mkdtempSync(join(tmpdir(), 'results_elsewhere_'));
		try {
			const outside = join(elsewhere, 'run.json');
			writeFileSync(outside, serialize_benchmark_results(load_full_run()));
			assert_refused(outside, 'is not in the results directory');
			const link = join(dir, 'linked.json');
			symlinkSync(outside, link);
			assert_refused(link, 'is not in the results directory');
		} finally {
			rmSync(elsewhere, { recursive: true });
		}
	});

	test('refuses latest.json itself', () => {
		const published = publish_results(write('latest.json'), dir, has_commit);
		assert.ok(!published.ok);
		assert.include(published.message, 'is latest.json itself');
	});
});

describe('the publish command', () => {
	test('takes exactly one path, and exits with 2 for a file it refuses', () => {
		assert.strictEqual(main([], dir), 2);
		assert.strictEqual(main(['a.json', 'b.json'], dir), 2);
		assert.strictEqual(main(['--unknown'], dir), 2);
		assert.strictEqual(main([write('scratch/smoke_x.json')], dir, has_commit), 2);
		assert.strictEqual(main([write('2026-01-01_fixture.json')], dir, has_commit), 0);
		assert.ok(existsSync(join(dir, 'latest.json')));
	});
});

describe('results_commit_exists', () => {
	let repo: string;

	const git = (...args: Array<string>): string =>
		execFileSync(
			'git',
			[
				'-c',
				'user.name=test',
				'-c',
				'user.email=test@example.invalid',
				'-c',
				'commit.gpgsign=false',
				...args
			],
			{ cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);

	// a repository of its own under the OS's temporary directory, with one commit
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'results_commit_exists_'));
		git('init', '--quiet');
		mkdirSync(join(repo, 'results'));
		writeFileSync(join(repo, 'results/README.md'), 'results\n');
		git('add', '.');
		git('commit', '--quiet', '-m', 'first');
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	test('a commit the repository has, asked from its results directory', () => {
		const commit = git('rev-parse', 'HEAD').trim();
		assert.ok(results_commit_exists(join(repo, 'results'), commit));
	});

	test("not a hash it has no commit of, the fixture's among them, nor an object that is no commit", () => {
		assert.ok(!results_commit_exists(join(repo, 'results'), 'a'.repeat(40)));
		assert.ok(!results_commit_exists(join(repo, 'results'), '0'.repeat(40)));
		const tree = git('rev-parse', 'HEAD^{tree}').trim();
		assert.ok(!results_commit_exists(join(repo, 'results'), tree));
	});

	test('publishing a run of the commit it has succeeds, and of another is refused', () => {
		const commit = git('rev-parse', 'HEAD').trim();
		const results = load_full_run();
		results.meta.commit = results.meta.commit_end = commit;
		const path = join(repo, 'results/2026-01-01_laptop1.json');
		writeFileSync(path, serialize_benchmark_results(results));
		assert.ok(publish_results(path, join(repo, 'results')).ok);
		rmSync(join(repo, 'results/latest.json'));
		results.meta.commit = results.meta.commit_end = 'b'.repeat(40);
		writeFileSync(path, serialize_benchmark_results(results));
		assert.ok(!publish_results(path, join(repo, 'results')).ok);
		assert.ok(!existsSync(join(repo, 'results/latest.json')));
	});
});
