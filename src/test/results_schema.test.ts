import { assert, describe, test } from 'vitest';
import { readFileSync } from 'node:fs';

import * as s from '#lib/schema.ts';

import { plan_results_steps } from '../benchmarks/results_plan.ts';
import {
	BENCHMARK_FULL_ARGS,
	BENCHMARK_IDS,
	BenchmarkResults,
	benchmark_results_find_args,
	benchmark_results_find_gaps,
	benchmark_results_find_single_passes,
	benchmark_results_is_complete,
	benchmark_results_is_publishable,
	benchmark_run_is_recorded,
	describe_benchmark_run,
	order_keys_by_schema,
	parse_benchmark_data,
	parse_benchmark_results,
	serialize_benchmark_results
} from '../benchmarks/results_schema.ts';
import {
	assert_rejects,
	load_fixture,
	load_full_run,
	to_measured
} from './results_test_helpers.ts';

const fixture_text = readFileSync(
	new URL('./fixtures/results/fixture_run.json', import.meta.url),
	'utf8'
);

describe('the fixture run', () => {
	test('fixture_run.json is what the builder builds', () => {
		assert.strictEqual(
			fixture_text,
			serialize_benchmark_results(parse_benchmark_results(load_fixture())),
			'src/test/fixtures/results/fixture_run.json is stale, run `gro task src/test/fixtures/results/update.task.ts`'
		);
	});

	test('parses and serializes back to itself', () => {
		const parsed = parse_benchmark_results(JSON.parse(fixture_text));
		assert.strictEqual(serialize_benchmark_results(parsed), fixture_text);
		assert.deepStrictEqual(parsed, load_fixture());
	});

	test('measures every section, and says it is invented wherever it names itself', () => {
		const results = load_fixture();
		for (const id of BENCHMARK_IDS) assert.strictEqual(results[id].status, 'measured', id);
		assert.strictEqual(results.meta.kind, 'fixture');
		assert.include(results.meta.machine.cpu, 'invented');
		assert.match(results.meta.commit, /^0+$/);
	});

	test('has one of every kind of cell a page must draw', () => {
		const results = load_fixture();
		const reasons = new Set<string>();
		const cells = [
			...to_measured(results, 'run').rows.flatMap((row) => Object.values(row.libs)),
			...to_measured(results, 'survey').rows.flatMap((row) => Object.values(row.libs))
		];
		for (const cell of cells) if ('none' in cell) reasons.add(cell.none);
		assert.sameMembers([...reasons], ['uncompiled', 'no_equivalent', 'differs']);
		const allocations = to_measured(results, 'allocations').rows.flatMap((row) =>
			Object.values(row.libs)
		);
		assert.ok(allocations.some((figures) => figures.interned));
		assert.ok(allocations.some((figures) => !figures.interned));
		assert.ok(allocations.some((figures) => figures.valid_bytes === 0));
	});
});

describe('strictness', () => {
	test('refuses an unknown key, at the top and nested, with its path', () => {
		assert_rejects({ ...load_fixture(), extra: 1 }, 'expected no unknown keys');
		const results = load_fixture();
		(results.meta.machine as any).hostname = 'x';
		assert_rejects(results, 'meta.machine');
	});

	test('refuses a missing section and a missing field', () => {
		const { heap: _, ...without } = load_fixture();
		assert_rejects(without, 'heap');
		const results = load_fixture();
		delete (results.meta as any).commit;
		assert_rejects(results, 'meta.commit');
	});

	test('names the path of a wrong value inside a section', () => {
		const results = load_fixture();
		(to_measured(results, 'bundle').rows[1]!.libs.valibot as any).gzip = '1300';
		assert_rejects(results, 'bundle.data.rows.1.libs.valibot.gzip');
		const results2 = load_fixture();
		to_measured(results2, 'heap').rows[0]!.libs.zod!.total_bytes = -1;
		assert_rejects(results2, 'heap.data.rows.0.libs.zod.total_bytes');
	});

	test('a commit is a full hash, and a version is known', () => {
		const results = load_fixture();
		results.meta.commit = 'abc123';
		assert_rejects(results, 'meta.commit');
		const results2 = load_fixture();
		results2.meta.libs[1]!.version = 'missing';
		assert_rejects(results2, 'which version');
	});

	test('parse_benchmark_results throws one readable error', () => {
		const results = load_fixture();
		(results.meta as any).node = 24;
		assert.throws(
			() => parse_benchmark_results(results),
			/invalid benchmark results:\n✖ .*\n {2}→ at meta\.node/
		);
	});
});

describe('cells', () => {
	test('a cell with no number says why, with a reason the schema knows', () => {
		const results = load_fixture();
		const row = to_measured(results, 'run').rows.find((r) => r.scenario === 'type_json')!;
		assert.deepStrictEqual(Object.keys(row.libs.zod_compiled!), ['none', 'why']);
		(row.libs.zod_compiled as any).none = 'skipped';
		assert_rejects(results, 'read as missing: none');
	});

	test('a null or a zero is no cell', () => {
		for (const cell of [null, 0, {}]) {
			const results = load_fixture();
			(to_measured(results, 'run').rows[0]!.libs as any).zod = cell;
			assert_rejects(results, 'run.data.rows.0.libs.zod: a cell is a figure or {none, why}');
		}
		const results = load_fixture();
		(to_measured(results, 'run').rows[0]!.libs.zod as any).ns = 0;
		assert_rejects(results, 'read as a figure: ns');
	});

	test('a timing orders its passes around its median', () => {
		const results = load_fixture();
		const cell = to_measured(results, 'run').rows[0]!.libs.valibot!;
		assert.ok(!('none' in cell));
		cell.min_ns = cell.ns * 2;
		assert.ok(!s.parse(BenchmarkResults, results).ok);
	});
});

describe('the sections agree with the roster and with themselves', () => {
	test('a scenario table names exactly the libraries of the roster', () => {
		const results = load_fixture();
		delete to_measured(results, 'run').rows[2]!.libs.typebox;
		assert_rejects(results, 'run.data.rows.2.libs: library "typebox" has no entry here');
		const results2 = load_fixture();
		const libs = to_measured(results2, 'bundle').all;
		libs.joi = libs.zod!;
		assert_rejects(results2, 'bundle.data.all.joi: unknown library "joi"');
		const results3 = load_fixture();
		delete to_measured(results3, 'types').with_reads.arktype;
		assert_rejects(results3, 'types.data.with_reads: library "arktype" has no entry here');
	});

	test('refuses a library id twice, and a row twice', () => {
		const results = load_fixture();
		results.meta.libs.push(results.meta.libs[0]!);
		assert_rejects(results, 'duplicate library id "fuz_schema"');
		const results2 = load_fixture();
		const rows = to_measured(results2, 'run').rows;
		rows.push(rows[0]!);
		assert_rejects(results2, 'duplicate row "string/valid"');
		const results3 = load_fixture();
		const heap = to_measured(results3, 'heap').rows;
		heap.push(heap[0]!);
		assert_rejects(results3, 'duplicate scenario "object_flat"');
	});

	test('a spread is null exactly where there was one pass', () => {
		const results = load_fixture();
		const cell = to_measured(results, 'run').rows[0]!.libs.fuz_schema!;
		assert.ok(!('none' in cell));
		cell.spread = null;
		assert_rejects(results, 'a spread is null exactly where there was one pass');
		const results2 = load_fixture();
		to_measured(results2, 'survey').passes = 1;
		assert_rejects(results2, 'a spread is null exactly where there was one pass');
	});

	test('the survey names its libraries, and every row is of its subject', () => {
		const results = load_fixture();
		to_measured(results, 'survey').others.push('joi');
		assert_rejects(results, 'unknown library "joi"');
		const results2 = load_fixture();
		const row = to_measured(results2, 'survey').rows[0]!;
		row.libs.fuz_schema = { none: 'differs', why: null };
		assert_rejects(results2, 'every row is of the subject library');
		const results3 = load_fixture();
		delete to_measured(results3, 'survey').rows[0]!.libs.zod;
		assert_rejects(results3, 'survey.data.rows.0.libs: library "zod" has no entry here');
	});

	test('a harvested set names its sides', () => {
		const results = load_fixture();
		const set = to_measured(results, 'harvest').sets[0]!;
		set.rows[0]!.sides.joi = set.rows[0]!.sides.zod!;
		assert_rejects(results, 'unknown side "joi"');
		const results2 = load_fixture();
		delete to_measured(results2, 'harvest').sets[1]!.rows[0]!.sides.valibot;
		assert_rejects(results2, 'side "valibot" has no entry here');
	});

	test('a section a run was narrowed away from holds no data', () => {
		const results = load_fixture();
		results.meta.only = ['bundle'];
		assert_rejects(results, 'run.status: the run was narrowed to bundle, so run was skipped');
	});
});

/** The fixture with one section replaced by one that holds no data. */
const without_section = (
	id: (typeof BENCHMARK_IDS)[number],
	section: { status: 'skipped'; reason: string } | { status: 'failed'; error: string }
): BenchmarkResults => {
	const results = load_full_run();
	(results as any)[id] =
		section.status === 'skipped'
			? section
			: { ...section, script: 'x', command: 'node x.ts', args: [], duration_ms: 1 };
	return parse_benchmark_results(results);
};

describe('what is publishable', () => {
	test('a full run of every section from a clean commit', () => {
		assert.ok(benchmark_results_is_publishable(parse_benchmark_results(load_full_run())));
		assert.ok(benchmark_results_is_complete(load_full_run()));
	});

	test('never the fixture, whatever else it says of itself', () => {
		const fixture = parse_benchmark_results(load_fixture());
		assert.ok(!benchmark_results_is_publishable(fixture));
		// every other fact of it is a publishable run's: only its kind refuses it
		assert.ok(benchmark_results_is_complete(fixture));
		assert.ok(benchmark_run_is_recorded(fixture.meta));
		assert.deepStrictEqual(benchmark_results_find_args(fixture), []);
		assert.strictEqual(fixture.meta.only, null);
		assert.include(describe_benchmark_run(fixture), 'kind: fixture, whose numbers are invented');
		// with a machine and a commit of its own it is still the fixture
		const renamed = load_fixture();
		renamed.meta.machine.name = 'laptop1';
		renamed.meta.commit = renamed.meta.commit_end = 'b'.repeat(40);
		assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(renamed)));
	});

	test('not a smoke run, a narrowed one, or one from a tree with changes', () => {
		const changes: Array<(results: BenchmarkResults) => void> = [
			(results) => (results.meta.kind = 'smoke'),
			(results) => (results.meta.dirty = true),
			(results) => {
				results.meta.only = ['bundle'];
				for (const id of BENCHMARK_IDS) {
					if (id !== 'bundle') (results as any)[id] = { status: 'skipped', reason: 'narrowed' };
				}
			}
		];
		for (const [i, change] of changes.entries()) {
			const results = load_full_run();
			change(results);
			assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(results)), `change ${i}`);
		}
	});

	test('not a run whose tree changed while it ran, or whose commit moved', () => {
		const changed = load_full_run();
		changed.meta.dirty_end = true;
		assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(changed)));
		assert.ok(!benchmark_run_is_recorded(changed.meta));
		assert.include(
			describe_benchmark_run(changed),
			'commit as it ended: the same, with changes it does not record'
		);
		const moved = load_full_run();
		moved.meta.commit_end = 'c'.repeat(40);
		assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(moved)));
		assert.ok(!benchmark_run_is_recorded(moved.meta));
		assert.include(describe_benchmark_run(moved), `commit as it ended: ${'c'.repeat(40)}, clean`);
		assert_rejects({ ...moved, meta: { ...moved.meta, commit_end: 'c0ffee' } }, 'meta.commit_end');
	});

	test('not a run a script was started in with args a full run does not give', () => {
		// a script narrowed by its own args, under the kind of a full run
		const narrowed = load_full_run();
		assert.ok(narrowed.run.status === 'measured');
		narrowed.run.args = ['--passes', '1', '--scenario', 'string'];
		assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(narrowed)));
		assert.deepStrictEqual(benchmark_results_find_args(narrowed), [
			{ id: 'run', args: ['--passes', '1', '--scenario', 'string'] }
		]);
		assert.include(describe_benchmark_run(narrowed), 'run (--passes 1 --scenario string)');
		// a failed script's args count as a measured one's do
		const failed = load_full_run();
		(failed as any).heap = {
			status: 'failed',
			script: 'benchmark:heap',
			command: 'node x.ts',
			args: ['--lib', 'zod'],
			duration_ms: 1,
			error: 'it exited with 1'
		};
		assert.deepStrictEqual(benchmark_results_find_args(failed), [
			{ id: 'heap', args: ['--lib', 'zod'] }
		]);
	});

	test('not a smoke run relabeled as a full one: its scripts still have their brief args', () => {
		const smoke = load_full_run();
		smoke.meta.kind = 'smoke';
		for (const planned of plan_results_steps({
			kind: 'smoke',
			only: null,
			wasm: true,
			machine: null
		})) {
			const section = smoke[planned.step.id];
			if (planned.run && section.status === 'measured') section.args = [...planned.args];
		}
		const relabeled = structuredClone(smoke);
		relabeled.meta.kind = 'full';
		assert.ok(!benchmark_results_is_publishable(parse_benchmark_results(relabeled)));
		// by its args alone: the kind, the tree, and the sections are a full run's
		assert.isAbove(benchmark_results_find_args(relabeled).length, 0);
		for (const section of benchmark_results_find_args(relabeled))
			relabeled[section.id] = load_full_run()[section.id] as any;
		assert.ok(benchmark_results_is_publishable(parse_benchmark_results(relabeled)));
	});

	test('not a run whose timed section took one pass: nothing says what its times range over', () => {
		for (const id of ['run', 'survey', 'harvest'] as const) {
			const results = load_full_run();
			const section = results[id];
			assert.ok(section.status === 'measured');
			section.data.passes = 1;
			// one pass has no spread, which the schema holds a file to
			const cells =
				id === 'harvest'
					? to_measured(results, 'harvest').sets.flatMap((set) =>
							set.rows.flatMap((row) => Object.values(row.sides).map((side) => side.time))
						)
					: to_measured(results, id).rows.flatMap((row) => Object.values(row.libs));
			for (const cell of cells) if (!('none' in cell)) cell.spread = null;
			const parsed = parse_benchmark_results(results);
			assert.deepStrictEqual(benchmark_results_find_single_passes(parsed), [id]);
			assert.ok(!benchmark_results_is_publishable(parsed), id);
			assert.include(describe_benchmark_run(parsed), `timed sections of one pass: ${id}`);
		}
		assert.deepStrictEqual(benchmark_results_find_single_passes(load_full_run()), []);
		assert.include(describe_benchmark_run(load_full_run()), 'timed sections of one pass: none');
	});

	test('the args of a full run are the ones a run plans', () => {
		for (const planned of plan_results_steps({
			kind: 'full',
			only: null,
			wasm: true,
			machine: 'laptop1'
		})) {
			assert.ok(planned.run, planned.step.id);
			assert.deepStrictEqual([...planned.args], [...BENCHMARK_FULL_ARGS], planned.step.id);
		}
	});

	test('not a run a script failed in, or one that skipped a section it needs', () => {
		const failed = without_section('survey', { status: 'failed', error: 'it exited with 1' });
		assert.ok(!benchmark_results_is_publishable(failed));
		assert.deepStrictEqual(benchmark_results_find_gaps(failed), [
			{ id: 'survey', why: 'it exited with 1' }
		]);
		const skipped = without_section('types', { status: 'skipped', reason: 'left out' });
		assert.ok(!benchmark_results_is_complete(skipped));
	});

	test('the wasm section is optional when skipped, and never when it failed', () => {
		const skipped = without_section('wasm', { status: 'skipped', reason: 'not asked for' });
		assert.ok(benchmark_results_is_publishable(skipped));
		const failed = without_section('wasm', { status: 'failed', error: 'it exited with 1' });
		assert.ok(!benchmark_results_is_publishable(failed));
	});

	test('describe_benchmark_run states the facts a refusal rests on', () => {
		const results = load_full_run();
		results.meta.kind = 'smoke';
		results.meta.dirty = true;
		const described = describe_benchmark_run(results);
		for (const part of [
			'kind: smoke',
			'with changes it does not record',
			'sections without data: none',
			'sections started with args a full run does not give: none'
		]) {
			assert.include(described, part);
		}
		assert.include(
			describe_benchmark_run(
				without_section('heap', { status: 'failed', error: 'it exited with 2' })
			),
			'heap (it exited with 2)'
		);
	});
});

describe('parse_benchmark_data', () => {
	test("takes a script's data, and refuses another script's or a malformed one", () => {
		const data = to_measured(load_fixture(), 'heap');
		assert.deepStrictEqual(parse_benchmark_data('heap', { benchmark: 'heap', data }), data);
		assert.throws(
			() => parse_benchmark_data('bundle', { benchmark: 'heap', data }),
			/not of bundle/
		);
		assert.throws(() => parse_benchmark_data('heap', null), /not of heap/);
		assert.throws(
			() => parse_benchmark_data('heap', { benchmark: 'heap', data: { ...data, counts: null } }),
			/invalid heap data:\n✖ .*\n {2}→ at counts/
		);
	});
});

describe('order_keys_by_schema', () => {
	test("puts every object's keys in the schema's order, through a variant and a cell", () => {
		const results = load_fixture();
		const reversed = <T extends object>(o: T): T =>
			Object.fromEntries(Object.entries(o).reverse()) as T;
		results.meta = reversed(results.meta);
		results.run = reversed(results.run);
		const rows = to_measured(results, 'run').rows;
		rows[0]!.libs.zod = reversed(rows[0]!.libs.zod!);
		assert.notStrictEqual(JSON.stringify(results, null, '\t') + '\n', fixture_text);
		assert.strictEqual(
			JSON.stringify(order_keys_by_schema(BenchmarkResults, results), null, '\t') + '\n',
			fixture_text
		);
	});
});
