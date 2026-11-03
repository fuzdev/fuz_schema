import { readFileSync } from 'node:fs';
import { describe, test, assert } from 'vitest';

import {
	BACKSTOP_PINS,
	BACKSTOP_VS_VALIBOT,
	CORRECTNESS_PRICE,
	SIZE_JITTER,
	format_backstop_line,
	format_opt_in_line,
	format_size_figures,
	judge_backstop,
	is_priced_as_correctness,
	judge_core_correctness,
	judge_core_feature,
	judge_opt_in,
	to_backstop_rows,
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

	test('the backstop leaves out a scenario of many schemas', () => {
		const rows = to_backstop_rows(
			[
				{ name: 'one', new: 80, valibot: 100 },
				{ name: 'many', new: 90, valibot: 100 }
			],
			['many']
		);
		assert.deepEqual(rows, [{ name: 'one', gzip: 80, valibot: 100 }]);
		assert.deepEqual(
			judge_backstop(rows, {}).over.map((r) => r.name),
			['one']
		);
	});

	test('the backstop is read on each scenario', () => {
		const verdict = judge_backstop(
			[
				{ name: 'under', gzip: 74, valibot: 100 },
				{ name: 'at', gzip: 75, valibot: 100 },
				{ name: 'over', gzip: 76, valibot: 100 }
			],
			{}
		);
		assert.deepEqual(
			verdict.over.map((r) => r.name),
			['over']
		);
		assert.deepEqual(verdict.pinned, []);
		assert.deepEqual(verdict.stale, []);
		assert.deepEqual(verdict.lower, []);
	});

	test('a pinned scenario over the backstop fails only past its pin', () => {
		const pins = { union: { gzip: 973, reason: 'ruled' } };
		const rows = [
			{ name: 'union', gzip: 973, valibot: 1270 },
			{ name: 'pipe', gzip: 1078, valibot: 1582 }
		];
		const at_pin = judge_backstop(rows, pins);
		assert.deepEqual(at_pin.over, []);
		assert.deepEqual(
			at_pin.pinned.map((r) => r.name),
			['union']
		);
		assert.strictEqual(
			format_backstop_line(rows, 'speed', pins),
			"backstop, every scenario of one schema at most 0.75x valibot's: pass, the most unpinned pipe 0.681x; " +
				'pinned: union 0.766x at 973, its pin 973'
		);
		const grown = [{ ...rows[0]!, gzip: 974 }, rows[1]!];
		assert.deepEqual(
			judge_backstop(grown, pins).over.map((r) => r.name),
			['union']
		);
		assert.strictEqual(
			format_backstop_line(grown, 'speed', pins),
			"backstop, every scenario of one schema at most 0.75x valibot's: FAIL, union 0.767x at 974, past its pin 973"
		);
		assert.ok(format_backstop_line(grown, 'security', pins).includes(': ASK, union 0.767x'));
		// a pin names one scenario and covers no other
		const other = [rows[0]!, { name: 'pipe', gzip: 1200, valibot: 1582 }];
		assert.deepEqual(
			judge_backstop(other, pins).over.map((r) => r.name),
			['pipe']
		);
	});

	test('a pin no longer needed fails as stale, under every class', () => {
		const pins = {
			union: { gzip: 973, reason: 'ruled' },
			gone: { gzip: 500, reason: 'a scenario since removed' }
		};
		const rows = [
			{ name: 'union', gzip: 950, valibot: 1270 },
			{ name: 'pipe', gzip: 1078, valibot: 1582 }
		];
		const verdict = judge_backstop(rows, pins);
		assert.deepEqual(verdict.over, []);
		assert.deepEqual(verdict.pinned, []);
		assert.deepEqual(verdict.stale, ['union', 'gone']);
		for (const change_class of ['speed', 'correctness', 'security', 'feature'] as const) {
			assert.strictEqual(
				format_backstop_line(rows, change_class, pins),
				"backstop, every scenario of one schema at most 0.75x valibot's: FAIL, stale pins union, gone, " +
					'at or under the backstop or no scenario: remove from `BACKSTOP_PINS`'
			);
		}
	});

	test('a pin above its scenario fails as stale, to be lowered, under every class', () => {
		const pins = { union: { gzip: 973, reason: 'ruled' } };
		// shrunk, and still over the backstop
		const rows = [
			{ name: 'union', gzip: 960, valibot: 1270 },
			{ name: 'pipe', gzip: 1078, valibot: 1582 }
		];
		const verdict = judge_backstop(rows, pins);
		assert.deepEqual(verdict.over, []);
		assert.deepEqual(
			verdict.pinned.map((r) => r.name),
			['union']
		);
		assert.deepEqual(verdict.stale, []);
		assert.deepEqual(
			verdict.lower.map((r) => r.name),
			['union']
		);
		for (const change_class of ['speed', 'correctness', 'security', 'feature'] as const) {
			assert.strictEqual(
				format_backstop_line(rows, change_class, pins),
				"backstop, every scenario of one schema at most 0.75x valibot's: FAIL, stale pin union at 960, " +
					'under its pin 973: lower to the size in `BACKSTOP_PINS`; ' +
					'pinned: union 0.756x at 960, its pin 973'
			);
		}
		// at its pin, it is not stale
		assert.deepEqual(judge_backstop([{ ...rows[0]!, gzip: 973 }, rows[1]!], pins).lower, []);
	});

	test('every pin stands over the backstop in sizes.json, at its pin', () => {
		const sizes: { scenarios: Record<string, number>; vs_valibot: Record<string, number> } =
			JSON.parse(readFileSync('src/benchmarks/sizes.json', 'utf8'));
		for (const [name, pin] of Object.entries(BACKSTOP_PINS)) {
			assert.ok(pin.reason, name);
			assert.ok(sizes.vs_valibot[name]! > BACKSTOP_VS_VALIBOT, `${name} is not over the backstop`);
			assert.strictEqual(sizes.scenarios[name], pin.gzip, `${name} is not at its pin`);
		}
	});

	test('the backstop fails past it, and under security the user rules', () => {
		const rows = [
			{ name: 'union', gzip: 955, valibot: 1270 },
			{ name: 'pipe', gzip: 1078, valibot: 1582 }
		];
		assert.strictEqual(
			format_backstop_line(rows, 'speed', {}),
			"backstop, every scenario of one schema at most 0.75x valibot's: FAIL, union 0.752x"
		);
		for (const change_class of ['correctness', 'feature'] as const) {
			assert.strictEqual(
				format_backstop_line(rows, change_class, {}),
				format_backstop_line(rows, 'speed', {})
			);
		}
		assert.strictEqual(
			format_backstop_line(rows, 'security', {}),
			"backstop, every scenario of one schema at most 0.75x valibot's: ASK, union 0.752x, the user rules on a fix of security"
		);
		const under = [{ ...rows[0]!, gzip: 940 }, rows[1]!];
		for (const change_class of ['speed', 'correctness', 'security', 'feature'] as const) {
			assert.strictEqual(
				format_backstop_line(under, change_class, {}),
				"backstop, every scenario of one schema at most 0.75x valibot's: pass, the most union 0.740x"
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

	test('a feature keeps core at +0 exactly', () => {
		const figures = [
			to_figure('strict_nested', 900, 1, { core: true, kind: 'scenario' }),
			to_figure('parse', 168, 0, { core: true })
		];
		assert.deepEqual(
			judge_core_feature(figures).map((f) => f.name),
			['strict_nested']
		);
		// what correctness lets through with no return, a feature does not
		assert.deepEqual(judge_core_correctness(figures), []);
		assert.deepEqual(judge_core_feature([to_figure('parse', 168, -2, { core: true })]), []);
	});

	test('a feature prices what the baseline has as correctness, and reports its new figures', () => {
		const added_last_in: SizeFigure = { ...to_figure('json_schema', NaN, 0), new: 400 };
		const added_alone: SizeFigure = {
			...to_figure('json_schema', NaN, 0, { kind: 'alone' }),
			new: 900
		};
		const figures = [
			to_figure('strict_nested', 900, 0, { core: true, kind: 'scenario' }),
			to_figure('union', 300, 8),
			to_figure('pipe', 200, CORRECTNESS_PRICE.opt_in + SIZE_JITTER + 1, { kind: 'alone' }),
			added_last_in,
			added_alone
		];
		const verdict = judge_opt_in(figures, 'feature');
		assert.strictEqual(verdict.verdict, 'ask');
		assert.deepEqual(
			verdict.grew.map((f) => `${f.kind} ${f.name}`),
			['alone pipe', 'export union']
		);
		assert.deepEqual(
			verdict.over.map((f) => f.name),
			['pipe']
		);
		assert.deepEqual(verdict.added, [added_alone, added_last_in]);
		// the same figures under correctness price the new export too
		const correctness = judge_opt_in(figures, 'correctness');
		assert.deepEqual(
			correctness.over.map((f) => `${f.kind} ${f.name}`),
			['alone json_schema', 'export json_schema', 'alone pipe']
		);
		assert.deepEqual(correctness.added, []);

		const passed = judge_opt_in([figures[1]!, added_last_in, added_alone], 'feature');
		assert.strictEqual(passed.verdict, 'pass');
		assert.strictEqual(
			format_opt_in_line(passed, 'feature', 1300),
			`opt-in bytes, which may be up to +${CORRECTNESS_PRICE.opt_in}, read past ±${SIZE_JITTER}, ` +
				'on any one figure the baseline has, last in or alone: pass, grew past ±3: ' +
				'exports last in union +8; new figures, reported and not priced: ' +
				'exports last in json_schema +400; exports alone json_schema +900; ' +
				'the library +1300, reported and not priced'
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
