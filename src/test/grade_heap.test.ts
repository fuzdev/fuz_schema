import { describe, test, assert } from 'vitest';

import {
	HEAP_ALLOWANCE,
	HEAP_JITTER,
	format_heap_figures,
	format_heap_line,
	judge_heap,
	type HeapFigure
} from '../benchmarks/grade_heap.ts';

const to_figure = (
	name: string,
	base: number,
	added: number,
	kind: HeapFigure['kind'] = 'export'
): HeapFigure => ({ name, kind, base, new: base + added });

describe('grade_heap', () => {
	test('jitter is not growth, and the allowance is read past it', () => {
		const figures = [
			to_figure('jitter', 400, HEAP_JITTER),
			to_figure('grew', 400, HEAP_JITTER + 1),
			to_figure('at_allowance', 400, HEAP_ALLOWANCE + HEAP_JITTER, 'scenario'),
			to_figure('shrank', 400, -200)
		];
		const read = judge_heap(figures);
		assert.strictEqual(read.verdict, 'pass');
		assert.deepEqual(
			read.grew.map((f) => f.name),
			['at_allowance', 'grew']
		);
		assert.deepEqual(read.over, []);
		assert.deepEqual(judge_heap([figures[0]!, figures[3]!]).grew, []);
	});

	test('a figure over the allowance goes to the user, of a scenario or an export', () => {
		const figures = [
			to_figure('type_json', 10000, HEAP_ALLOWANCE + HEAP_JITTER + 1, 'scenario'),
			// a set built per schema, which no scenario has
			to_figure('one_of', 180, 250),
			to_figure('pipe', 400, 8)
		];
		const read = judge_heap(figures);
		assert.strictEqual(read.verdict, 'ask');
		assert.deepEqual(
			read.over.map((f) => f.name),
			['one_of', 'type_json']
		);
		assert.deepEqual(
			read.grew.map((f) => f.name),
			['one_of', 'type_json', 'pipe']
		);
	});

	test('a figure one version lacks is compared on nothing', () => {
		const figures: Array<HeapFigure> = [
			{ name: 'added', kind: 'export', base: NaN, new: 900 },
			{ name: 'removed', kind: 'export', base: 900, new: NaN },
			{ name: 'new_scenario', kind: 'scenario', base: NaN, new: 5000 }
		];
		const read = judge_heap(figures);
		assert.strictEqual(read.verdict, 'pass');
		assert.deepEqual(read.grew, []);
	});

	test('growth spread under the allowance on every figure passes', () => {
		// the allowance is per figure: a change may grow each by it
		const figures = ['a', 'b', 'c', 'd'].map((name) => to_figure(name, 300, HEAP_ALLOWANCE));
		assert.strictEqual(judge_heap(figures).verdict, 'pass');
	});

	test('the line', () => {
		const figures = [
			to_figure('pipe', 2000, 40, 'scenario'),
			to_figure('one_of', 180, 250),
			to_figure('union', 200, 6)
		];
		assert.strictEqual(
			format_heap_figures(judge_heap(figures).grew),
			'scenarios pipe +40; exports alone one_of +250, union +6'
		);
		assert.strictEqual(
			format_heap_line(judge_heap(figures), ['type_json']),
			`retained heap per further schema, which may grow by up to +${HEAP_ALLOWANCE} B, read past ` +
				`±${HEAP_JITTER}, on any one figure, scenario or export, under any class: ` +
				'ASK, scenarios pipe +40; exports alone one_of +250 over it, the user rules; ' +
				`grew past ±${HEAP_JITTER}: scenarios pipe +40; exports alone one_of +250, union +6; ` +
				'totals retaining more: type_json, reported and not priced'
		);
		assert.strictEqual(
			format_heap_line(judge_heap([to_figure('string', 5, 1)]), []),
			`retained heap per further schema, which may grow by up to +${HEAP_ALLOWANCE} B, read past ` +
				`±${HEAP_JITTER}, on any one figure, scenario or export, under any class: ` +
				`pass, none grew past ±${HEAP_JITTER}; totals retaining more: none, reported and not priced`
		);
	});
});
