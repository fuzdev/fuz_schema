import { describe, test, assert } from 'vitest';

import type { CasePath } from '../benchmarks/cases.ts';
import type { GradeChildCase, GradeChildOutput } from '../benchmarks/grade_job.ts';
import {
	format_grade_record,
	judge_core_speed,
	parse_grade_record,
	read_grade,
	to_all_valid_matrix,
	to_apart_program_ran,
	to_case_bytes,
	to_flagged,
	to_grade_outputs,
	to_graded,
	to_mark,
	to_slowed,
	to_valid_by_regime,
	to_warned,
	is_more_alloc,
	type GradeCase,
	type GradeOutputs,
	type GradeRecord
} from '../benchmarks/grade_read.ts';
import { to_case_time } from '../benchmarks/grade_stats.ts';

const log = Math.log;

// a case as the reading has it, its name in the form the matrix's are
const to_case = (name: string, path: CasePath = 'identity', realistic = false): GradeCase => ({
	name,
	group: name.slice(0, name.indexOf('/')),
	realistic,
	path,
	valid: path !== 'issues'
});

// what each instance of each version took on a case in one run, in ns
interface Times {
	base: Array<number>;
	new: Array<number>;
}

// the instances of an A/A: three a version, close enough that a shift of a
// percent is past both a case's floor and a summary's A/A
const SAME: Times = { base: [100, 100.1, 99.9], new: [100, 100.1, 99.9] };
const to_shifted = (by: number): Times => ({ base: SAME.base, new: SAME.new.map((v) => v * by) });

// a process's reading of a case: each arm a round, the whole slice the same
const to_child_case = (name: string, times: Times, same = true): GradeChildCase => {
	const arms: Record<string, number> = {};
	times.base.forEach((v, i) => (arms[`base${i}`] = v));
	times.new.forEach((v, i) => (arms[`new${i}`] = v));
	const ids = Object.keys(arms);
	return {
		name,
		arms: ids,
		ns: Object.fromEntries(ids.map((id) => [id, [arms[id]!]])),
		whole_ns: Object.fromEntries(ids.map((id) => [id, [arms[id]!]])),
		same: Object.fromEntries(ids.map((id) => [id, same]))
	};
};

const to_bytes_case = (name: string, base = 100, next = base): GradeChildCase => ({
	name,
	arms: ['base0', 'new0', 'base1', 'new1'],
	bytes: { base0: base, new0: next, base1: base, new1: next },
	same: { base0: true, new0: true, base1: true, new1: true }
});

interface MadeGrade {
	record: GradeRecord;
	outputs: GradeOutputs;
}

// a grade of `cases`, each timed by `times` in every run and every regime it is in
const to_grade = (
	cases: Array<GradeCase>,
	{
		runs = 4,
		times = () => SAME,
		alone = [],
		apart = []
	}: {
		runs?: number;
		times?: (c: GradeCase, run: number) => Times;
		alone?: Array<string>;
		apart?: Array<string>;
	} = {}
): MadeGrade => {
	const record: GradeRecord = {
		graded: 'the working tree',
		against: 'HEAD',
		identical: false,
		args: { runs, class: 'speed', samples: 15, bundle: false, process: false },
		started_at: '2026-01-01T00:00:00.000Z',
		ended_at: '2026-01-01T00:10:00.000Z',
		elapsed_s: 600,
		setup: {
			hostname: 'host',
			node: '26.0.0',
			v8: '14',
			packages: {},
			head: {},
			base_hash: 'a',
			new_hash: 'b'
		},
		machine: { start: { node: 'v26', load: [0, 0, 0] }, end: { node: 'v26', load: [0, 0, 0] } },
		instances: 3,
		apart_processes: 3,
		program_entries: 10,
		cases,
		alone,
		apart,
		jobs: { matrix: [], alone: [], apart: [], bytes_matrix: [], bytes_alone: [] }
	};
	const of_name = (name: string): GradeCase => cases.find((c) => c.name === name)!;
	const run_list = Array.from({ length: runs }, (_, run) => run);
	const outputs: GradeOutputs = {
		matrix: run_list.map((run): GradeChildOutput => ({
			cases: cases.map((c) => to_child_case(c.name, times(c, run))),
			disagreed: [],
			sink: 0
		})),
		alone: run_list.map((run) =>
			alone.map((name) => to_child_case(name, times(of_name(name), run)))
		),
		apart: run_list.map((run) =>
			apart.map((name) => {
				const t = times(of_name(name), run);
				// a process of each version where an instance is elsewhere
				return t.base.flatMap((base, i) => [
					{
						graded: false,
						output: {
							cases: [to_child_case(name, { base: [base], new: [] })],
							disagreed: [],
							program_ran: 10,
							sink: 0
						}
					},
					{
						graded: true,
						output: {
							cases: [to_child_case(name, { base: [], new: [t.new[i]!] })],
							disagreed: [],
							program_ran: 10,
							sink: 0
						}
					}
				]);
			})
		),
		bytes_matrix: cases.map((c) => to_bytes_case(c.name)),
		bytes_alone: alone.map((name) => to_bytes_case(name))
	};
	return { record, outputs };
};

// a small matrix: realistic cases of each path, and the rest
const CASES: Array<GradeCase> = [
	to_case('real/a/valid', 'identity', true),
	to_case('real/b/valid', 'copy', true),
	to_case('real/c/invalid', 'issues', true),
	to_case('each/d/valid'),
	to_case('each/e/invalid', 'issues'),
	to_case('create/f/valid', 'create')
];

const to_graded_of = (grade: MadeGrade): ReturnType<typeof to_graded> =>
	to_graded(grade.record, grade.outputs);

const find_line = (verdict: Array<string>, start: string): string => {
	const found = verdict.find((line) => line.startsWith(start));
	assert(found, `no line starting ${start}`);
	return found;
};

describe('grade_read', () => {
	test('an A/A passes every rule and warns of nothing', () => {
		const grade = to_grade(CASES);
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the valid path is not slowed'),
			'the valid path is not slowed: pass'
		);
		assert.strictEqual(
			find_line(verdict, 'a realistic path is not slowed'),
			'a realistic path is not slowed, a warning: none'
		);
		assert.include(find_line(verdict, 'realistic valid-path speed, matrix'), 'inside its A/A');
		assert.strictEqual(find_line(verdict, 'cases slower, matrix'), 'cases slower, matrix: none');
	});

	test('rule 6 fails on the realistic valid line slower past its A/A, and not inside it', () => {
		const slower = to_graded_of(
			to_grade(CASES, { times: (c) => (c.realistic && c.valid ? to_shifted(1.05) : SAME) })
		);
		const slowed = to_slowed(slower);
		assert(slowed.some((line) => line.startsWith('realistic valid matrix')));
		// the cases it rests on are confirmed slower too
		assert(slowed.some((line) => line === '2 valid cases slower matrix'));
		// a shift well inside the A/A of instances that scatter more fails nothing
		const wide: Times = { base: [100, 110, 90], new: [100.5, 110.5, 90.5] };
		const inside = to_graded_of(
			to_grade(CASES, { times: (c) => (c.realistic && c.valid ? wide : SAME) })
		);
		assert.deepEqual(to_slowed(inside), []);
	});

	test('rule 6 reads every valid case in the matrix, and no creation', () => {
		// a non-realistic valid case slower, past the line of every valid case
		const cases = [...CASES, to_case('each/g/valid'), to_case('each/h/valid')];
		const graded = to_graded_of(
			to_grade(cases, { times: (c) => (c.group === 'each' && c.valid ? to_shifted(1.2) : SAME) })
		);
		const all = to_all_valid_matrix(graded);
		// the parses through the valid path: realistic or not, and never a creation
		assert.strictEqual(all.cases, 5);
		assert(to_slowed(graded).some((line) => line.startsWith('every valid case matrix')));
		// the realistic line reads none of them
		assert(!to_slowed(graded).some((line) => line.startsWith('realistic valid')));
		// a creation slower is listed and fails nothing
		const created = to_graded_of(
			to_grade(CASES, { times: (c) => (c.path === 'create' ? to_shifted(1.2) : SAME) })
		);
		assert.deepEqual(to_slowed(created), []);
		assert.deepEqual(
			to_flagged(created, 'matrix', 'slower').map((g) => g.c.name),
			['create/f/valid']
		);
	});

	test('a realistic path or the invalid one slower past its A/A warns, and fails nothing', () => {
		// past the copy path's A/A, inside the least floor of a case, and diluted
		// under the A/A of the valid line by the identity cases beside it
		const copy = to_graded_of(
			to_grade([...CASES, to_case('real/g/valid', 'identity', true)], {
				times: (c) => (c.path === 'copy' && c.realistic ? to_shifted(1.003) : SAME)
			})
		);
		assert.deepEqual(to_slowed(copy), []);
		assert.deepEqual(
			to_warned(copy).map((line) => line.split(' (')[0]!.replace(/ [+-][\d.]+%$/, '')),
			['realistic copy matrix']
		);
		const invalid = to_graded_of(
			to_grade(CASES, { times: (c) => (c.realistic && !c.valid ? to_shifted(1.05) : SAME) })
		);
		assert.deepEqual(
			to_warned(invalid).map((line) => line.split(' ').slice(0, 3).join(' ')),
			['realistic invalid matrix', 'realistic issues matrix']
		);
		assert.deepEqual(to_slowed(invalid), []);
	});

	test('the realistic valid line is read by path, of the realistic valid cases alone', () => {
		const [matrix] = to_valid_by_regime(to_graded_of(to_grade(CASES)));
		assert(matrix);
		assert.strictEqual(matrix.regime, 'matrix');
		assert.strictEqual(matrix.whole.cases, 2);
		assert.deepEqual(
			matrix.paths.map((p) => [p.path, p.summary.cases]),
			[
				['identity', 1],
				['copy', 1]
			]
		);
	});

	test('rule 6 and the warning read alone where cases ran alone', () => {
		const alone = ['real/a/valid', 'real/b/valid', 'real/c/invalid'];
		const graded = to_graded_of(
			to_grade(CASES, {
				alone,
				times: (c, run) => (c.realistic && c.valid && run >= 0 ? to_shifted(1.05) : SAME)
			})
		);
		assert.deepEqual(
			to_valid_by_regime(graded).map((v) => v.regime),
			['matrix', 'alone']
		);
		const slowed = to_slowed(graded);
		assert(slowed.some((line) => line.startsWith('realistic valid alone')));
		assert(slowed.some((line) => line === '2 valid cases slower alone'));
	});

	test('a case confirmed slower apart fails rule 6, and the apart summary fails nothing', () => {
		const graded = to_graded_of(
			to_grade(CASES, {
				apart: ['each/d/valid'],
				times: (c) => (c.name === 'each/d/valid' ? to_shifted(1.2) : SAME)
			})
		);
		assert.include(to_slowed(graded), '1 valid case slower apart');
		const program = to_grade(CASES, { apart: ['each/d/valid'] });
		assert.strictEqual(to_apart_program_ran(program.record, program.outputs), 10);
	});

	test('below three runs rule 6 and the warning are not judged', () => {
		const grade = to_grade(CASES, {
			runs: 2,
			times: (c) => (c.realistic && c.valid ? to_shifted(1.05) : SAME)
		});
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the valid path is not slowed'),
			'the valid path is not slowed: not judged, fewer than 3 runs'
		);
		assert.strictEqual(
			find_line(verdict, 'a realistic path is not slowed'),
			'a realistic path is not slowed, a warning: not judged, fewer than 3 runs'
		);
	});

	test('rule 4 for speed, on each side of its return', () => {
		const faster = (by: number) =>
			to_graded_of(
				to_grade(CASES, { times: (c) => (c.realistic && c.valid ? to_shifted(by) : SAME) })
			);
		assert.strictEqual(judge_core_speed(faster(1), 0, 4).verdict, 'pass, no bytes added');
		assert.strictEqual(judge_core_speed(faster(1), -10, 4).verdict, 'pass, no bytes added');
		// 25 bytes ask for the least speedup, 5%
		const fast = judge_core_speed(faster(0.9), 25, 4);
		assert.strictEqual(fast.required, 0.05);
		assert.match(fast.verdict, /^pass, valid \+10\.0%/);
		// 100 bytes ask for 20%, which 10% is short of
		assert.match(
			judge_core_speed(faster(0.9), 100, 4).verdict,
			/^FAIL, valid \+10\.0% .* is short of it/
		);
		assert.match(
			judge_core_speed(faster(1.05), 25, 4).verdict,
			/^FAIL, valid -5\.0% .* is slower past its A\/A$/
		);
		assert.match(judge_core_speed(faster(1), 25, 4).verdict, /no speedup past its A\/A/);
		assert.strictEqual(
			judge_core_speed(faster(0.9), 25, 2).verdict,
			'not judged, fewer than 3 runs'
		);
		// the return on the invalid path, with the valid path not slower
		const invalid = to_graded_of(
			to_grade(CASES, { times: (c) => (c.realistic && !c.valid ? to_shifted(0.9) : SAME) })
		);
		assert.match(
			judge_core_speed(invalid, 25, 4).verdict,
			/^pass, invalid \+10\.0%.*inside its A\/A$/
		);
	});

	test('the marks: * confirmed, ? one run short of it, and none', () => {
		const run = (by: number) => ({
			base: SAME.base.map(log),
			new: SAME.new.map((v) => log(v * by))
		});
		const confirmed = to_case_time([run(1.2), run(1.2), run(1.2), run(1.2)]);
		const one_short = to_case_time([run(1.2), run(1.2), run(1.2), run(1)]);
		const none = to_case_time([run(1.2), run(1.2), run(1), run(1)]);
		assert.deepEqual([confirmed, one_short, none].map(to_mark), ['*', '?', ' ']);
	});

	test('a case one version lacks is read apart from every summary, rule, and list', () => {
		const grade = to_grade(CASES, {
			times: (c) => (c.realistic && c.valid ? to_shifted(1.05) : SAME)
		});
		// the baseline lacks the slower cases, as an export added since
		for (const run of grade.outputs.matrix) {
			for (const c of run.cases) {
				if (c.name.startsWith('real/') && c.name.endsWith('/valid')) {
					c.arms = c.arms.filter((arm) => arm.startsWith('new'));
				}
			}
		}
		const graded = to_graded_of(grade);
		assert.deepEqual(
			graded.filter((g) => !g.compared).map((g) => g.c.name),
			['real/a/valid', 'real/b/valid']
		);
		const { verdict, tables } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the valid path is not slowed'),
			'the valid path is not slowed: pass'
		);
		assert.strictEqual(
			find_line(verdict, 'realistic valid-path speed'),
			'realistic valid-path speed: no realistic valid cases in this run'
		);
		assert(tables.some((t) => t.startsWith('\ncases not compared')));
		assert(tables.some((t) => t.includes('real/a/valid †  identity  new')));
	});

	test('a subset of the cases is read on itself alone, as a filtered grade', () => {
		// the slower case left out of the grade, as `--filter` leaves it out
		const subset = CASES.filter((c) => c.name !== 'real/a/valid');
		const grade = to_grade(subset, {
			times: (c) => (c.name === 'real/a/valid' ? to_shifted(1.2) : SAME)
		});
		const { verdict, report } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the valid path is not slowed'),
			'the valid path is not slowed: pass'
		);
		assert.strictEqual((report.cases as Array<unknown>).length, subset.length);
		assert.strictEqual(to_valid_by_regime(to_graded_of(grade))[0]!.whole.cases, 1);
	});

	test('bytes: a case allocates more when both instances of the new version say so', () => {
		const more = to_case_bytes(to_bytes_case('a', 100, 108));
		assert(more.settled && is_more_alloc(more));
		assert(!is_more_alloc(to_case_bytes(to_bytes_case('a', 100, 107))));
		// one instance of a version apart from the other leaves the case unsettled, and unlisted
		const unsettled = to_case_bytes({
			...to_bytes_case('a', 100, 120),
			bytes: { base0: 100, base1: 100, new0: 120, new1: 100 }
		});
		assert(!unsettled.settled && !is_more_alloc(unsettled));
		// a share of a large case, a fifth of a percent
		assert(!is_more_alloc(to_case_bytes(to_bytes_case('a', 10_000, 10_019))));
		assert(is_more_alloc(to_case_bytes(to_bytes_case('a', 10_000, 10_020))));
	});

	test('the outputs of jobs are read by what each job was', () => {
		const { outputs } = to_grade(CASES, { runs: 1, alone: ['real/a/valid'] });
		const by_job: Array<GradeChildOutput> = [
			outputs.matrix[0]!,
			{ cases: [outputs.alone[0]![0]!], disagreed: [], sink: 0 },
			{ cases: outputs.bytes_matrix, disagreed: [], sink: 0 },
			{ cases: outputs.bytes_alone, disagreed: [], sink: 0 }
		];
		const read = to_grade_outputs(
			{ matrix: [0], alone: [[1]], apart: [], bytes_matrix: [2], bytes_alone: [3] },
			(job) => by_job[job]!
		);
		assert.deepEqual(read, { ...outputs, apart: [] });
	});

	test('a record keeps a figure that is not finite, where the report writes null', () => {
		const text = format_grade_record({ a: NaN, b: [Infinity, -Infinity, 1], c: 'x' });
		assert.deepEqual(parse_grade_record(text), { a: NaN, b: [Infinity, -Infinity, 1], c: 'x' });
	});
});
