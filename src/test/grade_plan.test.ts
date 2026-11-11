import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { create_cases } from '../benchmarks/cases.ts';
import { CORE_SCENARIO } from '../benchmarks/grade_bytes.ts';
import {
	APART_CASES,
	APART_PROCESSES,
	COLDSTART_SCENARIOS,
	INSTANCES,
	to_apart_jobs,
	to_bytes_arms,
	to_chunks,
	to_grade_lock_state,
	to_time_arms,
	type GradeApartJob
} from '../benchmarks/grade_plan.ts';
import { SCENARIOS } from '../benchmarks/scenarios.ts';

// a name the grader leans on that names nothing drops out of what it reads
// without an error: a case out of the `apart` regime, a scenario out of cold
// start, the core scenario out of core, which leaves `parse` alone
describe('grade_plan', () => {
	const case_names = create_cases(s, true).map((c) => c.name);
	const scenario_names = SCENARIOS.map((scenario) => scenario.name);

	test('every case timed apart by default is a case of the matrix', () => {
		for (const name of APART_CASES) assert.include(case_names, name);
	});

	test('every scenario cold start samples is a scenario', () => {
		for (const name of COLDSTART_SCENARIOS) assert.include(scenario_names, name);
	});

	test('the core scenario is a scenario of one schema', () => {
		const core = SCENARIOS.find((scenario) => scenario.name === CORE_SCENARIO);
		assert(core);
		assert(!core.many_schemas);
	});

	const paths = { baseline_path: '/g/against_schema.ts', new_path: '/g/new_schema.ts' };

	test('the two versions apart differ only in path, timed id, and graded', () => {
		// a job with what tells the versions apart taken out of it
		const to_neutral = ({ job }: GradeApartJob) => ({
			...job,
			arms: job.arms.map((arm) => ({
				...arm,
				id: arm.id.replace(/^(base|new)/, ''),
				path: '',
				graded: false
			}))
		});
		for (const run of [0, 1, 2, 3]) {
			for (const index of [0, 1]) {
				const jobs = to_apart_jobs(paths, 'each/string/valid', run, index, 1);
				assert.strictEqual(jobs.length, 2 * APART_PROCESSES);
				for (let at = 0; at < APART_PROCESSES; at++) {
					const [a, b] = [jobs[2 * at]!, jobs[2 * at + 1]!];
					assert.notStrictEqual(a.graded, b.graded);
					assert.deepEqual(to_neutral(a), to_neutral(b));
					for (const { graded, job } of [a, b]) {
						for (const arm of job.arms) {
							assert.strictEqual(arm.graded, graded);
							assert.strictEqual(arm.path, graded ? paths.new_path : paths.baseline_path);
						}
					}
				}
			}
		}
	});

	test('which version goes first apart moves on by a process, a case, and a run', () => {
		const firsts = (run: number, index: number): Array<boolean> => {
			const jobs = to_apart_jobs(paths, 'each/string/valid', run, index, 1);
			return Array.from({ length: APART_PROCESSES }, (_, at) => jobs[2 * at]!.graded);
		};
		assert.deepEqual(firsts(0, 0), [false, true, false]);
		assert.deepEqual(firsts(1, 0), [true, false, true]);
		assert.deepEqual(firsts(0, 1), [true, false, true]);
		assert.deepEqual(firsts(1, 1), [false, true, false]);
	});

	test('time arms put each version in turn, the graded one last', () => {
		const arms = to_time_arms(paths);
		assert.strictEqual(arms.length, 2 * INSTANCES);
		assert.deepEqual(
			arms.map((a) => a.graded),
			Array.from({ length: INSTANCES }, () => [false, true]).flat()
		);
		for (const arm of arms) {
			assert.strictEqual(arm.path, arm.graded ? paths.new_path : paths.baseline_path);
		}
	});

	test('bytes arms hold two instances of each version', () => {
		const arms = to_bytes_arms(paths);
		for (const graded of [false, true]) {
			assert.strictEqual(arms.filter((a) => a.graded === graded).length, 2);
		}
		assert.deepEqual(
			arms.map((a) => a.id),
			['base0', 'new0', 'base1', 'new1']
		);
	});

	test('a lock is free, held by a process alive, stale, or names none', () => {
		const alive = (pid: number): boolean => pid === 42;
		assert.deepEqual(to_grade_lock_state(undefined, alive), { state: 'free' });
		assert.deepEqual(to_grade_lock_state('42', alive), { state: 'held', pid: 42 });
		assert.deepEqual(to_grade_lock_state('42\n', alive), { state: 'held', pid: 42 });
		assert.deepEqual(to_grade_lock_state('7', alive), { state: 'stale', pid: 7 });
		for (const text of ['', 'x', '0', '-3', '4.5']) {
			assert.deepEqual(to_grade_lock_state(text, alive), { state: 'unreadable', text });
		}
	});

	test('chunks hold every item once, in order', () => {
		const items = Array.from({ length: 11 }, (_, i) => i);
		for (const count of [1, 2, 3, 6, 11, 20]) {
			const chunks = to_chunks(items, count);
			assert(chunks.length <= count);
			assert.deepEqual(chunks.flat(), items);
		}
	});
});
