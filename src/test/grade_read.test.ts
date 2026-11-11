import { describe, test, assert } from 'vitest';

import type { CasePath, GradeChildCase, GradeChildOutput } from '../benchmarks/grade_job.ts';
import { CORE_SCENARIO } from '../benchmarks/grade_bytes.ts';
import {
	WARN_LEAST_CASES,
	format_grade_record,
	format_speed,
	judge_core_speed,
	load_grade,
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
	to_speed,
	to_speed_band,
	to_summary_lines,
	to_valid_by_regime,
	to_warn_unread,
	to_warned,
	is_more_alloc,
	type GradeBundleMeasures,
	type GradeCase,
	type GradeOutputs,
	type GradeRecord
} from '../benchmarks/grade_read.ts';
import { is_outside, to_case_time, type Summary } from '../benchmarks/grade_stats.ts';

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
		apart = [],
		program_ran = { base: 10, new: 10 }
	}: {
		runs?: number;
		times?: (c: GradeCase, run: number) => Times;
		alone?: Array<string>;
		apart?: Array<string>;
		/** What a process apart of each version says it ran of the program. */
		program_ran?: { base: number; new: number };
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
		realistic_total: cases.filter((c) => c.realistic).length,
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
							program_ran: program_ran.base,
							sink: 0
						}
					},
					{
						graded: true,
						output: {
							cases: [to_child_case(name, { base: [], new: [t.new[i]!] })],
							disagreed: [],
							program_ran: program_ran.new,
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

// `count` realistic valid cases of a path, named for it
const to_realistic = (path: CasePath, count: number): Array<GradeCase> =>
	Array.from({ length: count }, (_, i) => to_case(`real/${path}_${i}/valid`, path, true));

// the names of lines as the verdict prints them, without their figures
const to_line_names = (lines: Array<string>): Array<string> =>
	lines.map((line) => line.replace(/ [+-][\d.]+% \(.*$/, ''));

// a summary of a speed beside an A/A, given as a ratio's band
const to_speed_summary = (speed: number, band: number, cases = 5): Summary => ({
	cases,
	ratio: Math.log(1 - speed),
	runs: [],
	band
});

// a record's bundles, every figure the same in both versions but `parse`,
// which grows by `core_growth`
const to_bundle = (core_growth: number): GradeBundleMeasures => ({
	scenarios: [{ name: CORE_SCENARIO, base: 1000, new: 1000, valibot: 2000 }],
	unshared: [],
	many_schemas: [],
	new_scenario_libs: [],
	all: { base: 1000, new_shared: 1000, valibot: 2000 },
	base_exports: { parse: 500, library: 3000, exports: [] },
	new_exports: { parse: 500 + core_growth, library: 3000 + core_growth, exports: [] },
	new_scenario_rows: [],
	many_schema_rows: []
});

describe('grade_read', () => {
	test('an A/A passes every rule and warns of nothing', () => {
		const grade = to_grade(CASES);
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the valid path is not slowed'),
			'the valid path is not slowed: pass'
		);
		assert.strictEqual(
			find_line(verdict, 'a realistic path is not slowed').split('\n')[0],
			// every path here rests on fewer cases than the warning reads
			'a realistic path is not slowed, a warning: nothing read'
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
			to_grade([...CASES, ...to_realistic('copy', 4), ...to_realistic('identity', 8)], {
				times: (c) => (c.path === 'copy' && c.realistic ? to_shifted(1.003) : SAME)
			})
		);
		assert.deepEqual(to_slowed(copy), []);
		assert.deepEqual(
			to_warned(copy).map((line) => line.split(' (')[0]!.replace(/ [+-][\d.]+%$/, '')),
			['realistic copy matrix']
		);
		const invalid_cases = Array.from({ length: 4 }, (_, i) =>
			to_case(`real/bad_${i}/invalid`, 'issues', true)
		);
		const invalid = to_graded_of(
			to_grade([...CASES, ...invalid_cases], {
				times: (c) => (c.realistic && !c.valid ? to_shifted(1.05) : SAME)
			})
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
			find_line(verdict, 'a realistic path is not slowed').split('\n')[0],
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

	test('the warning reads every path of the realistic valid cases, in matrix and alone', () => {
		const cases = [
			...to_realistic('identity', WARN_LEAST_CASES),
			...to_realistic('copy', WARN_LEAST_CASES),
			to_case('real/z/invalid', 'issues', true)
		];
		const names = cases.map((c) => c.name);
		for (const path of ['identity', 'copy'] as const) {
			// slower on one path, in the matrix and alone
			const graded = to_graded_of(
				to_grade(cases, {
					alone: names,
					times: (c) => (c.path === path ? to_shifted(1.003) : SAME)
				})
			);
			assert.deepEqual(to_line_names(to_warned(graded)), [
				`realistic ${path} matrix`,
				`realistic ${path} alone`
			]);
		}
		// slower alone and not in the matrix: the line alone warns by itself
		const grade = to_grade(cases, { alone: names });
		for (const run of grade.outputs.alone) {
			for (const c of run) {
				if (!c.name.includes('copy')) continue;
				for (const arm of c.arms) {
					if (arm.startsWith('new')) c.ns![arm] = c.ns![arm]!.map((v) => v * 1.003);
				}
			}
		}
		assert.deepEqual(to_line_names(to_warned(to_graded_of(grade))), ['realistic copy alone']);
	});

	test('the warning reads a line of four cases or more, and prints one of fewer unread', () => {
		for (const count of [WARN_LEAST_CASES - 1, WARN_LEAST_CASES]) {
			const graded = to_graded_of(
				to_grade([...to_realistic('identity', 8), ...to_realistic('copy', count)], {
					times: (c) => (c.path === 'copy' ? to_shifted(1.003) : SAME)
				})
			);
			const read = count >= WARN_LEAST_CASES;
			assert.deepEqual(to_line_names(to_warned(graded)), read ? ['realistic copy matrix'] : []);
			assert.deepEqual(
				to_line_names(to_warn_unread(graded)),
				read ? [] : ['realistic copy matrix']
			);
			const copy = to_summary_lines(graded).find((l) => l.name === 'realistic copy matrix');
			assert(copy);
			assert.strictEqual(copy.read, read);
			assert.strictEqual(copy.summary.cases, count);
		}
		// printed in the verdict with its count, however it reads
		const grade = to_grade([...to_realistic('identity', 4), ...to_realistic('probe', 1)]);
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.match(
			find_line(verdict, 'a realistic path is not slowed'),
			/^a realistic path is not slowed, a warning: none\n {2}on fewer than 4 cases, reported and not read: realistic probe matrix [+-][\d.]+% \(A\/A ±[\d.]+%, 1 case\)$/
		);
	});

	test('rule 6 and the warning read the lines they name, and no other', () => {
		// a realistic invalid case that is no issues case, so the invalid line
		// and the issues line rest on different counts, and the invalid case
		// that isn't realistic is in neither
		const cases = [...CASES, { ...to_case('real/g/invalid', 'probe', true), valid: false }];
		const lines = to_summary_lines(to_graded_of(to_grade(cases, { alone: ['real/a/valid'] })));
		assert.deepEqual(
			lines.map((l) => [l.name, l.family, l.summary.cases]),
			[
				['realistic valid matrix', 'rule 6', 2],
				['realistic valid alone', 'rule 6', 1],
				['every valid case matrix', 'rule 6', 3],
				['realistic identity matrix', 'warn', 1],
				['realistic copy matrix', 'warn', 1],
				['realistic invalid matrix', 'warn', 2],
				['realistic issues matrix', 'warn', 1],
				['realistic identity alone', 'warn', 1]
			]
		);
	});

	test('a warning with no line read says so', () => {
		const grade = to_grade(to_realistic('probe', 1));
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.match(
			find_line(verdict, 'a realistic path is not slowed'),
			/^a realistic path is not slowed, a warning: nothing read\n {2}on fewer than 4 cases, reported and not read: /
		);
	});

	test('the lists of marks read each its own mark', () => {
		const grade = to_grade(CASES, {
			// one case shown slower in every run, and one in all but the first
			times: (c, run) =>
				c.name === 'each/d/valid' || (c.name === 'real/a/valid' && run > 0) ? to_shifted(1.2) : SAME
		});
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'cases slower, matrix'),
			'cases slower, matrix: each/d/valid'
		);
		assert.strictEqual(
			find_line(verdict, 'cases marked ?, matrix'),
			'cases marked ?, matrix: real/a/valid'
		);
		assert.strictEqual(find_line(verdict, 'cases faster, matrix'), 'cases faster, matrix: none');
	});

	test('a filtered grade says so, with the realistic cases of the whole, and still reads rule 4', () => {
		const grade = to_grade(CASES);
		grade.record.args = { ...grade.record.args, filter: 'real/', bundle: true };
		grade.record.realistic_total = 10;
		grade.record.bundle = to_bundle(20);
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'a subset'),
			'a subset, --filter real/: 3 of the 10 realistic cases graded, and rules 4 and 6 read on those alone'
		);
		assert.match(
			find_line(verdict, '  core bytes'),
			/^ {2}core bytes \(.*\): \+20 gzip, .*: FAIL, /
		);
		// a record from before the count was kept reads without it
		delete grade.record.realistic_total;
		assert.strictEqual(
			find_line(read_grade(grade.record, grade.outputs).verdict, 'a subset'),
			'a subset, --filter real/: 3 realistic cases graded, of a count in the whole matrix the record ' +
				'does not hold, and rules 4 and 6 read on those alone'
		);
		// and a whole grade has no such line
		const whole = to_grade(CASES);
		assert(!read_grade(whole.record, whole.outputs).verdict.some((l) => l.startsWith('a subset')));
	});

	test('a speed prints with the count of its cases, and its A/A on its own side', () => {
		const band = Math.log(1.0202);
		assert.strictEqual(format_speed(to_speed_summary(0.05, band)), '+5.0% (A/A ±2.0%, 5 cases)');
		assert.strictEqual(format_speed(to_speed_summary(-0.05, band, 1)), '-5.0% (A/A ±2.0%, 1 case)');
		// on the faster side a speed is compared with 1 - exp(-band), the narrower
		assert.closeTo(to_speed_band(to_speed_summary(0.01, band)), 1 - 1 / 1.0202, 1e-12);
		assert.closeTo(to_speed_band(to_speed_summary(-0.01, band)), 0.0202, 1e-12);
	});

	test('a speed past its A/A never prints as its equal, nor one inside it as past it', () => {
		const to_printed = (text: string): [number, number] => {
			const match = /^[+-]([\d.]+)% \(A\/A ±([\d.]+)%/.exec(text);
			assert(match, text);
			return [Number(match[1]), Number(match[2])];
		};
		for (const band of [Math.log(1.0202), Math.log(1.025), Math.log(1.001), Math.log(1.1)]) {
			for (const side of [1, -1]) {
				// the speed at the band on its side, and a hair either way of it
				const edge = side > 0 ? 1 - Math.exp(-band) : -(Math.exp(band) - 1);
				for (const by of [-1e-4, -1e-5, -1e-6, 1e-6, 1e-5, 1e-4]) {
					const summary = to_speed_summary(edge * (1 + by), band);
					const [figure, printed_band] = to_printed(format_speed(summary));
					assert.strictEqual(figure > printed_band, is_outside(summary), format_speed(summary));
					assert.strictEqual(Math.sign(to_speed(summary)), side);
				}
			}
		}
		// faster by 1.99% beside a band of 2.02% on the slower side is past it
		const faster = to_speed_summary(0.0199, Math.log(1.0202));
		assert(is_outside(faster));
		assert.strictEqual(format_speed(faster), '+1.99% (A/A ±1.98%, 5 cases)');
		// one digit where one tells them apart
		assert.strictEqual(
			format_speed(to_speed_summary(0.012, Math.log(1.02))),
			'+1.2% (A/A ±2.0%, 5 cases)'
		);
	});

	test('a case is compared only where the baseline was timed on it in every run', () => {
		const grade = to_grade(CASES);
		const lacking = grade.outputs.matrix[1]!.cases.find((c) => c.name === 'each/d/valid')!;
		lacking.arms = lacking.arms.filter((arm) => arm.startsWith('new'));
		assert.deepEqual(
			to_graded_of(grade)
				.filter((g) => !g.compared)
				.map((g) => g.c.name),
			['each/d/valid']
		);
	});

	test('a case allocates more only where both instances of the new version are past both of the baseline', () => {
		const to_bytes = (base0: number, base1: number, new0: number, new1: number) =>
			to_case_bytes({ ...to_bytes_case('a'), bytes: { base0, base1, new0, new1 } });
		// one instance of the new version past, the other not, the two settled
		const one_new = to_bytes(100, 100, 108, 104);
		assert(one_new.settled && !is_more_alloc(one_new));
		// one instance of the baseline near the new version's, the other not
		const one_base = to_bytes(100, 104, 110, 110);
		assert(one_base.settled && !is_more_alloc(one_base));
		assert(is_more_alloc(to_bytes(100, 100, 108, 108)));
	});

	test('the program apart is counted of the processes of the baseline alone', () => {
		const grade = to_grade(CASES, { apart: ['each/d/valid'], program_ran: { base: 7, new: 5 } });
		assert.strictEqual(to_apart_program_ran(grade.record, grade.outputs), 7);
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'the program, apart'),
			'the program, apart: the baseline ran 7 of its 10 entries, the rest throwing or giving ' +
				'another answer in it, where the new version ran them all'
		);
	});

	test('a case whose output identity changed is listed', () => {
		const grade = to_grade(CASES);
		const changed = grade.outputs.matrix[0]!.cases.find((c) => c.name === 'real/b/valid')!;
		for (const arm of changed.arms) if (arm.startsWith('base')) changed.same[arm] = false;
		const { verdict } = read_grade(grade.record, grade.outputs);
		assert.strictEqual(
			find_line(verdict, 'cases whose output identity changed'),
			'cases whose output identity changed: real/b/valid'
		);
	});

	test('an export whose process of retained heap threw is printed, and is in the report', () => {
		const grade = to_grade(CASES);
		grade.record.args = { ...grade.record.args, process: true };
		grade.record.heap = {
			scenarios: [],
			base_exports: [
				{ name: 'memo_union', further_schema_bytes: NaN, failed: 'no memo_union' },
				{ name: 'string', further_schema_bytes: 0, failed: null }
			],
			new_exports: [
				{ name: 'memo_union', further_schema_bytes: 100, failed: null },
				{ name: 'string', further_schema_bytes: 0, failed: null }
			]
		};
		grade.record.coldstart = [];
		const { tables, report } = read_grade(grade.record, grade.outputs);
		assert.deepEqual(report.heap_export_failures, [
			{ name: 'memo_union', version: 'base', failed: 'no memo_union' }
		]);
		assert.include(tables, 'memo_union: the baseline threw, compared on nothing: no memo_union');
	});

	test('a grade is loaded from its files, or refused with what is missing', () => {
		const grade = to_grade(CASES, { runs: 1 });
		grade.record.jobs = {
			matrix: [0],
			alone: [[]],
			apart: [[]],
			bytes_matrix: [1],
			bytes_alone: []
		};
		const files: Record<string, string> = {
			'record.json': format_grade_record(grade.record),
			'jobs/0.out.json': JSON.stringify(grade.outputs.matrix[0]),
			'jobs/1.out.json': JSON.stringify({
				cases: grade.outputs.bytes_matrix,
				disagreed: [],
				sink: 0
			})
		};
		const load = (overrides: Record<string, string | undefined> = {}) =>
			load_grade((path) => (path in overrides ? overrides[path] : files[path]));
		const loaded = load();
		assert(loaded.ok);
		assert.deepEqual(loaded.record, grade.record);
		assert.deepEqual(loaded.outputs.bytes_matrix, grade.outputs.bytes_matrix);
		const to_message = (overrides: Record<string, string | undefined>): string => {
			const failed = load(overrides);
			assert(!failed.ok);
			return failed.message;
		};
		assert.match(to_message({ 'record.json': undefined }), /^no record\.json: /);
		assert.match(to_message({ 'record.json': '{' }), /^record\.json is not JSON: /);
		assert.strictEqual(to_message({ 'record.json': '[]' }), 'record.json holds no object');
		assert.strictEqual(
			to_message({ 'jobs/1.out.json': undefined }),
			'the record names job 1, and jobs/1.out.json is missing'
		);
		assert.match(to_message({ 'jobs/1.out.json': '{' }), /^jobs\/1\.out\.json is not JSON: /);
		const { jobs: _jobs, ...no_jobs } = grade.record;
		assert.match(
			to_message({ 'record.json': JSON.stringify(no_jobs) }),
			/^record\.json lacks jobs, /
		);
		const { runs: _runs, ...no_runs } = grade.record.args;
		assert.match(
			to_message({ 'record.json': JSON.stringify({ ...grade.record, args: no_runs }) }),
			/^record\.json lacks args\.runs, /
		);
		// a field read with a default is not refused
		const { realistic_total: _total, ...no_total } = grade.record;
		assert(load({ 'record.json': format_grade_record(no_total) }).ok);
	});
});
