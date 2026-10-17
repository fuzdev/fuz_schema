import { describe, test, assert } from 'vitest';

import {
	CORRECTNESS_PRICE,
	SIZE_JITTER,
	format_backstop_line,
	format_opt_in_line,
	format_size_figures,
	judge_backstop,
	is_priced_as_correctness,
	judge_core_correctness,
	judge_opt_in,
	to_size_delta,
	type SizeFigure
} from '../benchmarks/grade_bytes.ts';

const to_figure = (
	name: string,
	base: number,
	added: number,
	{ core = false, kind = 'export' }: Partial<Pick<SizeFigure, 'core' | 'kind'>> = {}
): SizeFigure => ({ name, kind, core, base, new: base + added });

describe('grade_bytes', () => {
	test('a side that has no figure counts as 0', () => {
		assert.strictEqual(to_size_delta({ ...to_figure('added', NaN, 0), new: 40 }), 40);
		assert.strictEqual(to_size_delta({ ...to_figure('removed', 40, 0), new: NaN }), -40);
	});

	test('opt-in jitter is not growth, and core is read exactly', () => {
		const figures = [
			to_figure('jitter', 100, SIZE_JITTER),
			to_figure('grew', 100, SIZE_JITTER + 1),
			to_figure('shrank', 100, -20),
			to_figure('core', 800, 1, { core: true, kind: 'scenario' })
		];
		const speed = judge_opt_in(figures, 'speed');
		assert.strictEqual(speed.verdict, 'read');
		assert.deepEqual(
			speed.grew.map((f) => f.name),
			['grew']
		);
		assert.deepEqual(speed.over, []);
		assert.deepEqual(
			judge_core_correctness(figures).map((f) => f.name),
			[]
		);
		assert.strictEqual(judge_opt_in([figures[0]!, figures[2]!], 'speed').verdict, 'pass');
	});

	test('a correctness change pays its price, and past it the user rules', () => {
		const at_price = [
			to_figure('core', 800, CORRECTNESS_PRICE.core, { core: true, kind: 'scenario' }),
			to_figure('pipe', 100, CORRECTNESS_PRICE.opt_in + SIZE_JITTER),
			to_figure('union', 100, 12)
		];
		assert.deepEqual(judge_core_correctness(at_price), []);
		const passed = judge_opt_in(at_price, 'correctness');
		assert.strictEqual(passed.verdict, 'pass');
		assert.deepEqual(
			passed.grew.map((f) => f.name),
			['pipe', 'union']
		);

		const over_price = [
			to_figure('core', 800, CORRECTNESS_PRICE.core + 1, { core: true, kind: 'scenario' }),
			to_figure('pipe', 100, CORRECTNESS_PRICE.opt_in + SIZE_JITTER + 1, { kind: 'scenario' }),
			to_figure('added', NaN, 0)
		];
		over_price[2]!.new = 70;
		assert.deepEqual(
			judge_core_correctness(over_price).map((f) => f.name),
			['core']
		);
		const asked = judge_opt_in(over_price, 'correctness');
		assert.strictEqual(asked.verdict, 'ask');
		assert.deepEqual(
			asked.over.map((f) => f.name),
			['added', 'pipe']
		);
		// the same figures under speed are only listed
		assert.strictEqual(judge_opt_in(over_price, 'speed').verdict, 'read');
	});

	test('a shared helper that grows is missed by last in and priced alone', () => {
		// two exports share a helper that grew by 60: removing either leaves it for the other,
		// so neither last in moves, and a consumer of either alone pays the 60
		const grown = 60;
		const figures = [
			to_figure('nullable', 30, 1),
			to_figure('union', 90, 0),
			to_figure('nullable', 140, grown, { kind: 'alone' }),
			to_figure('union', 200, grown, { kind: 'alone' })
		];
		const last_in_only = judge_opt_in(
			figures.filter((f) => f.kind === 'export'),
			'correctness'
		);
		assert.strictEqual(last_in_only.verdict, 'pass');
		assert.deepEqual(last_in_only.grew, []);
		const asked = judge_opt_in(figures, 'correctness');
		assert.strictEqual(asked.verdict, 'ask');
		assert.deepEqual(
			asked.over.map((f) => `${f.kind} ${f.name}`),
			['alone nullable', 'alone union']
		);
		const speed = judge_opt_in(figures, 'speed');
		assert.strictEqual(speed.verdict, 'read');
		assert.deepEqual(
			speed.grew.map((f) => `${f.kind} ${f.name}`),
			['alone nullable', 'alone union']
		);
	});

	test('the opt-in line reports the library, unpriced', () => {
		// growth split across many exports, none past the jitter, shows only in the library
		const figures = ['a', 'b', 'c', 'd'].map((name) => to_figure(name, 50, SIZE_JITTER));
		const line = format_opt_in_line(judge_opt_in(figures, 'correctness'), 'correctness', 12);
		assert.strictEqual(
			line,
			`opt-in bytes, which may be up to +${CORRECTNESS_PRICE.opt_in}, read past ±${SIZE_JITTER}, ` +
				`on any one figure, last in or alone: pass, none grew past ±${SIZE_JITTER}; ` +
				'the library +12, reported and not priced'
		);
		const asked = format_opt_in_line(
			judge_opt_in([to_figure('pipe', 100, 60, { kind: 'alone' })], 'correctness'),
			'correctness',
			-2
		);
		assert.ok(asked.includes(': ASK, exports alone pipe +60 over it, the user rules;'));
		assert.ok(asked.endsWith('; the library -2, reported and not priced'));
		assert.strictEqual(
			format_opt_in_line(judge_opt_in(figures, 'speed'), 'speed', 0),
			`opt-in bytes, each to pay for itself in speed, by judgment: none grew past ±${SIZE_JITTER}; ` +
				'the library +0, reported and not priced'
		);
	});

	test('the backstop is read on each scenario', () => {
		assert.deepEqual(
			judge_backstop([
				{ name: 'under', gzip: 74, valibot: 100 },
				{ name: 'at', gzip: 75, valibot: 100 },
				{ name: 'over', gzip: 76, valibot: 100 }
			]).map((r) => r.name),
			['over']
		);
	});

	test('the backstop fails past it, and under security the user rules', () => {
		const rows = [
			{ name: 'union', gzip: 955, valibot: 1270 },
			{ name: 'pipe', gzip: 1078, valibot: 1582 }
		];
		assert.strictEqual(
			format_backstop_line(rows, 'speed'),
			"backstop, every scenario at most 0.75x valibot's: FAIL, union 0.75x"
		);
		assert.strictEqual(
			format_backstop_line(rows, 'correctness'),
			format_backstop_line(rows, 'speed')
		);
		assert.strictEqual(
			format_backstop_line(rows, 'security'),
			"backstop, every scenario at most 0.75x valibot's: ASK, union 0.75x, the user rules on a fix of security"
		);
		const under = [{ ...rows[0]!, gzip: 940 }, rows[1]!];
		for (const change_class of ['speed', 'correctness', 'security'] as const) {
			assert.strictEqual(
				format_backstop_line(under, change_class),
				"backstop, every scenario at most 0.75x valibot's: pass, the most union 0.74x"
			);
		}
	});

	test('a security change is priced as one of correctness', () => {
		assert.ok(is_priced_as_correctness('security'));
		assert.ok(is_priced_as_correctness('correctness'));
		assert.ok(!is_priced_as_correctness('speed'));
		const figures = [
			to_figure('pipe', 100, CORRECTNESS_PRICE.opt_in + SIZE_JITTER + 1, { kind: 'alone' }),
			to_figure('union', 100, 12)
		];
		assert.deepEqual(judge_opt_in(figures, 'security'), judge_opt_in(figures, 'correctness'));
		assert.strictEqual(
			format_opt_in_line(judge_opt_in(figures, 'security'), 'security', 7),
			format_opt_in_line(judge_opt_in(figures, 'correctness'), 'correctness', 7)
		);
	});

	test('figures are named by kind', () => {
		assert.strictEqual(
			format_size_figures([
				to_figure('pipe', 100, 60, { kind: 'scenario' }),
				to_figure('pipe', 100, 55),
				to_figure('union', 100, -4),
				to_figure('pipe', 120, 58, { kind: 'alone' })
			]),
			'scenarios pipe +60; exports last in pipe +55, union -4; exports alone pipe +58'
		);
	});
});
