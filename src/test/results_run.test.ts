import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RESULTS_STEPS, type ResultsRunOptions } from '../benchmarks/results_plan.ts';
import {
	ResultsRunError,
	find_missing_need,
	format_results_plan,
	format_results_summary,
	plan_results_run,
	read_results_commit,
	run_results,
	type ResultsRunDeps
} from '../benchmarks/results_run.ts';
import { parse_benchmark_results, type BenchmarkId } from '../benchmarks/results_schema.ts';
import { load_fixture, to_measured } from './results_test_helpers.ts';

const COMMIT = 'a'.repeat(40);

let dir: string;
let lines: Array<string>;

// a repository with the builds a run reads, and nothing else of one
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'results_run_'));
	lines = [];
	mkdirSync(join(dir, 'src/lib'), { recursive: true });
	mkdirSync(join(dir, 'dist'));
	writeFileSync(join(dir, 'src/lib/schema.ts'), '');
	writeFileSync(join(dir, 'dist/schema.js'), '');
	writeFileSync(join(dir, 'dist/schema.d.ts'), '');
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: '@fuzdev/fuz_schema', version: '9.9.9' })
	);
});

afterEach(() => {
	rmSync(dir, { recursive: true });
});

/**
 * A run's dependencies with every script standing in: each writes its
 * section of the fixture as its data, unless `fail` names it.
 */
const create_deps = (
	options: {
		dirty?: boolean;
		/** What the tree reads as when the run ends, where that is not what it started as. */
		end?: { commit: string; dirty: boolean };
		fail?: BenchmarkId;
		garbage?: BenchmarkId;
	} = {}
): ResultsRunDeps & { started: Array<{ script: string; args: Array<string> }> } => {
	const started: Array<{ script: string; args: Array<string> }> = [];
	const fixture = load_fixture();
	let readings = 0;
	return {
		dir,
		scripts: Object.fromEntries(RESULTS_STEPS.map((step) => [step.script, `node ${step.id}.ts`])),
		// the first reading is the plan's, before any script, and the next the end's
		read_commit: () =>
			readings++ > 0 && options.end
				? options.end
				: { commit: COMMIT, dirty: options.dirty ?? false },
		run_step: (script, args, log_path) => {
			started.push({ script, args: [...args] });
			const { id } = RESULTS_STEPS.find((step) => step.script === script)!;
			writeFileSync(log_path, `the output of ${id}\n`);
			if (id === options.fail) return { status: 1, signal: null, error: null };
			const data_path = args[args.indexOf('--data') + 1]!;
			writeFileSync(
				data_path,
				id === options.garbage
					? '{"benchmark": "other"}'
					: JSON.stringify({ benchmark: id, data: to_measured(fixture, id) })
			);
			return { status: 0, signal: null, error: null };
		},
		log: (line) => lines.push(line),
		started
	};
};

const FULL: ResultsRunOptions = { kind: 'full', only: null, wasm: false, machine: 'laptop1' };

const assert_refused = (run: () => unknown, includes: string): void => {
	try {
		run();
	} catch (error) {
		assert(error instanceof ResultsRunError);
		assert.strictEqual(error.exit_code, 2);
		assert.include(error.message, includes);
		return;
	}
	assert.fail('expected the run to be refused');
};

describe('plan_results_run', () => {
	test('a full run of everything from a clean tree is planned for its dated file', () => {
		const plan = plan_results_run(FULL, create_deps(), new Date('2026-11-12T08:00:00.000Z'));
		assert.deepStrictEqual(plan.unpublishable, []);
		assert.strictEqual(plan.path, join(dir, 'results/2026-11-12_laptop1.json'));
		assert.strictEqual(plan.commit, COMMIT);
		const text = format_results_plan(plan);
		assert.include(text, 'nothing is measured');
		assert.include(text, 'publishable  yes');
		assert.include(text, 'wasm         left out');
		// planning changes nothing on disk
		assert.ok(!existsSync(join(dir, 'results')));
	});

	test('refuses a full run of everything with no machine name, and a name no file can have', () => {
		assert_refused(() => plan_results_run({ ...FULL, machine: null }, create_deps()), '--machine');
		assert_refused(() => plan_results_run({ ...FULL, machine: 'a/b' }, create_deps()), 'file name');
		// a smoke run takes the hostname
		assert.ok(plan_results_run({ ...FULL, kind: 'smoke', machine: null }, create_deps()).machine);
	});

	test('refuses a script package.json lacks, and a build that is missing or stale', () => {
		const deps = create_deps();
		const { benchmark: _, ...scripts } = deps.scripts;
		assert_refused(() => plan_results_run(FULL, { ...deps, scripts }), 'no script "benchmark"');
		rmSync(join(dir, 'dist/schema.d.ts'));
		assert_refused(() => plan_results_run(FULL, create_deps()), 'dist/schema.d.ts is missing');
		// a run narrowed away from what reads the build goes ahead
		assert.ok(plan_results_run({ ...FULL, only: ['bundle'] }, create_deps()));
	});

	test('a build older than the source it is built from is stale', () => {
		assert.strictEqual(find_missing_need('dist', dir), null);
		const past = new Date(Date.now() - 60_000);
		utimesSync(join(dir, 'dist/schema.js'), past, past);
		assert.include(find_missing_need('dist', dir), 'older than src/lib/schema.ts');
		assert.include(find_missing_need('wasm', dir), 'npm run build:wasm');
	});

	test('refuses to write over a run of the same date and machine', () => {
		mkdirSync(join(dir, 'results'));
		writeFileSync(join(dir, 'results/2026-11-12_laptop1.json'), '{}');
		assert_refused(
			() => plan_results_run(FULL, create_deps(), new Date('2026-11-12T08:00:00.000Z')),
			'exists'
		);
	});

	test('a run that can not be published is planned for scratch, and says why', () => {
		const plan = plan_results_run(FULL, create_deps({ dirty: true }));
		assert.strictEqual(plan.path, join(dir, 'results/scratch/full_laptop1.json'));
		assert.include(format_results_plan(plan), 'publishable  no: the working tree has changes');
	});
});

describe('run_results', () => {
	test('starts every script once, in order, each with its data path, and composes one file', () => {
		const deps = create_deps();
		const run = run_results(FULL, deps);
		assert.deepStrictEqual(
			deps.started.map((s) => s.script),
			RESULTS_STEPS.filter((step) => step.id !== 'wasm').map((step) => step.script)
		);
		for (const { args } of deps.started) assert.strictEqual(args.at(-2), '--data');
		assert.ok(run.publishable);
		assert.match(run.path, /results\/\d{4}-\d\d-\d\d_laptop1\.json$/);
		// the file on disk is the validated results, with what each script wrote
		const written = parse_benchmark_results(JSON.parse(readFileSync(run.path, 'utf8')));
		assert.deepStrictEqual(written, run.results);
		assert.deepStrictEqual(to_measured(written, 'survey'), to_measured(load_fixture(), 'survey'));
		assert.strictEqual(written.wasm.status, 'skipped');
		assert.strictEqual(written.meta.machine.name, 'laptop1');
		assert.strictEqual(written.meta.commit, COMMIT);
		// this library's version is the tree's own, and the others' are the installed ones
		assert.strictEqual(written.meta.libs.find((lib) => lib.id === 'fuz_schema')!.version, '9.9.9');
		assert.match(written.meta.libs.find((lib) => lib.id === 'valibot')!.version, /^\d/);
		// each section records the command it ran
		assert.ok(written.run.status === 'measured');
		assert.strictEqual(written.run.command, 'node run.ts');
		assert.include(format_results_summary(run), 'it is publishable');
		// each script's output is kept
		assert.strictEqual(
			readFileSync(join(dir, 'results/scratch/full_laptop1.steps/run.txt'), 'utf8'),
			'the output of run\n'
		);
	});

	test('the tree is read again as the run ends, and the file records both readings', () => {
		const clean = run_results(FULL, create_deps());
		assert.strictEqual(clean.results.meta.commit_end, COMMIT);
		assert.strictEqual(clean.results.meta.dirty_end, false);
		rmSync(clean.path);
		// an edit made while the scripts ran: clean as it started, and not as it ended
		const edited = run_results(FULL, create_deps({ end: { commit: COMMIT, dirty: true } }));
		assert.strictEqual(edited.results.meta.dirty, false);
		assert.strictEqual(edited.results.meta.dirty_end, true);
		assert.ok(!edited.publishable);
		assert.strictEqual(edited.path, join(dir, 'results/scratch/full_laptop1.json'));
		assert.include(
			format_results_summary(edited),
			'commit as it ended: the same, with changes it does not record'
		);
		// a commit made while they ran: clean both times, at two commits
		const moved = 'b'.repeat(40);
		const committed = run_results(FULL, create_deps({ end: { commit: moved, dirty: false } }));
		assert.strictEqual(committed.results.meta.commit, COMMIT);
		assert.strictEqual(committed.results.meta.commit_end, moved);
		assert.ok(!committed.publishable);
		assert.include(committed.path, 'results/scratch/');
		assert.ok(!existsSync(clean.path), 'no dated file is written for a run no commit records');
	});

	test('the end is read after the last script, not before it', () => {
		let started = 0;
		const deps = create_deps();
		const { run_step } = deps;
		const readings: Array<number> = [];
		deps.run_step = (...args) => (started++, run_step(...args));
		deps.read_commit = () => (readings.push(started), { commit: COMMIT, dirty: false });
		run_results(FULL, deps);
		assert.deepStrictEqual(readings, [0, RESULTS_STEPS.length - 1]);
	});

	test('a script that fails is recorded, the rest still run, and the run goes to scratch', () => {
		const deps = create_deps({ fail: 'heap' });
		const run = run_results(FULL, deps);
		assert.ok(!run.publishable);
		assert.strictEqual(run.path, join(dir, 'results/scratch/full_laptop1.json'));
		assert.ok(run.results.heap.status === 'failed');
		assert.include(run.results.heap.error, 'exited with 1');
		assert.strictEqual(run.results.harvest.status, 'measured');
		assert.lengthOf(deps.started, RESULTS_STEPS.length - 1);
		assert.include(format_results_summary(run), 'heap         FAILED');
		assert.ok(lines.some((line) => line.includes('FAILED')));
	});

	test('a script that exits cleanly with data that is not its own has failed', () => {
		const run = run_results(FULL, create_deps({ garbage: 'types' }));
		assert.ok(run.results.types.status === 'failed');
		assert.include(run.results.types.error, 'its data could not be read');
	});

	test('a smoke run gives its scripts their brief args, and is written to scratch', () => {
		const deps = create_deps();
		assert_refused(
			() => run_results({ kind: 'smoke', only: null, wasm: true, machine: null }, deps),
			'npm run build:wasm'
		);
		mkdirSync(join(dir, 'target/fuz_schema_wasm'), { recursive: true });
		writeFileSync(join(dir, 'target/fuz_schema_wasm/fuz_schema_wasm_bg.wasm'), '');
		const run = run_results({ kind: 'smoke', only: null, wasm: true, machine: null }, deps);
		assert.ok(!run.publishable);
		assert.include(run.path, 'results/scratch/smoke_');
		assert.strictEqual(run.results.wasm.status, 'measured');
		const survey = deps.started.find((s) => s.script === 'benchmark:survey')!;
		assert.deepStrictEqual(survey.args.slice(0, 4), ['--passes', '1', '--duration', '20']);
	});

	test('a narrowed run skips the rest, and the file says what it was narrowed to', () => {
		const deps = create_deps();
		const run = run_results({ ...FULL, only: ['bundle', 'run'] }, deps);
		assert.lengthOf(deps.started, 2);
		assert.deepStrictEqual(run.results.meta.only, ['bundle', 'run']);
		assert.strictEqual(run.results.survey.status, 'skipped');
		assert.ok(!run.publishable);
	});
});

describe('read_results_commit', () => {
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
				'-c',
				'init.defaultBranch=main',
				...args
			],
			{ cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);

	// a repository of its own under the OS's temporary directory, with one commit
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'results_commit_'));
		git('init', '--quiet');
		mkdirSync(join(repo, 'src'));
		mkdirSync(join(repo, 'results/scratch'), { recursive: true });
		writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
		writeFileSync(join(repo, 'results/README.md'), 'results\n');
		git('add', '.');
		git('commit', '--quiet', '-m', 'first');
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	test('a clean tree reads as its commit, in full, and clean', () => {
		const state = read_results_commit(repo);
		assert.strictEqual(state.commit, git('rev-parse', 'HEAD').trim());
		assert.match(state.commit, /^[0-9a-f]{40}$/);
		assert.strictEqual(state.dirty, false);
	});

	test('an edit to a tracked file, an untracked file, and a staged one each read as changes', () => {
		writeFileSync(join(repo, 'src/a.ts'), 'export const a = 2;\n');
		assert.strictEqual(read_results_commit(repo).dirty, true);
		git('checkout', '--quiet', '--', 'src/a.ts');
		assert.strictEqual(read_results_commit(repo).dirty, false);
		writeFileSync(join(repo, 'src/b.ts'), '');
		assert.strictEqual(read_results_commit(repo).dirty, true);
		git('add', 'src/b.ts');
		assert.strictEqual(read_results_commit(repo).dirty, true);
		git('commit', '--quiet', '-m', 'second');
		assert.strictEqual(read_results_commit(repo).dirty, false);
		// outside `src` too: the whole tree is read, not a directory of it
		writeFileSync(join(repo, 'package.json'), '{}');
		assert.strictEqual(read_results_commit(repo).dirty, true);
	});

	test('what a run writes under results/ is not a change, and nothing else is excused', () => {
		writeFileSync(join(repo, 'results/2026-11-12_laptop1.json'), '{}');
		writeFileSync(join(repo, 'results/scratch/smoke_laptop1.json'), '{}');
		writeFileSync(join(repo, 'results/README.md'), 'edited\n');
		assert.strictEqual(read_results_commit(repo).dirty, false);
		// a directory of the same name elsewhere is not the results directory
		mkdirSync(join(repo, 'src/results'));
		writeFileSync(join(repo, 'src/results/a.json'), '{}');
		assert.strictEqual(read_results_commit(repo).dirty, true);
	});

	test('a commit made between two readings moves the commit read', () => {
		const before = read_results_commit(repo);
		writeFileSync(join(repo, 'src/a.ts'), 'export const a = 3;\n');
		git('commit', '--quiet', '-am', 'second');
		const after = read_results_commit(repo);
		assert.notStrictEqual(after.commit, before.commit);
		assert.strictEqual(after.dirty, false);
	});

	test('reading writes nothing to the repository', () => {
		const index = readFileSync(join(repo, '.git/index'));
		writeFileSync(join(repo, 'src/a.ts'), 'export const a = 4;\n');
		read_results_commit(repo);
		assert.ok(readFileSync(join(repo, '.git/index')).equals(index));
	});

	test('outside a checkout it fails, since a run must say what produced it', () => {
		const bare = mkdtempSync(join(tmpdir(), 'results_no_commit_'));
		try {
			assert.throws(() => read_results_commit(bare), ResultsRunError);
		} finally {
			rmSync(bare, { recursive: true });
		}
	});
});
