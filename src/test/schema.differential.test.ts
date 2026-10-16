import { describe, test, assert } from 'vitest';

import { DIFFERENCES, SIDES } from './conformance_tables.ts';
import {
	DIFFERENTIAL_KINDS,
	DIFFERENTIAL_RULES,
	DIFFERENTIAL_UNRULED,
	SPLIT_RECOGNIZERS,
	create_differential_rng,
	format_differential_report,
	gen_root_spec,
	run_differential,
	spec_has_kind
} from './differential_helpers.ts';

// The differential at a fixed depth: the same seeds and counts on every run
// and in CI, so what passes here passes there. A deeper run, of any seed, is
// `npm run differential`.
const SEEDS = [1, 2, 3];
const COUNT = 5000;

describe('the differential', () => {
	for (const seed of SEEDS) {
		test(`seed ${seed}: no undeclared difference, no throw, no invariant broken`, () => {
			const report = run_differential({ seed, count: COUNT, minimize_limit: 5 });
			const { tally } = report;
			if (tally.undeclared || tally.throws || report.invariants.length) {
				assert.fail(
					'\n' +
						format_differential_report(report) +
						'\n\nPaste each finding into CONFORMANCE_CASES, then conform, or declare the difference in DIFFERENCES and docs/design.md with a rule in DIFFERENTIAL_RULES.'
				);
			}
			assert.ok(tally.agree > COUNT / 2, 'most cases agree');
		}, 30_000);
	}

	test('every rule is of a declared difference', () => {
		for (const rule of DIFFERENTIAL_RULES) {
			const difference = DIFFERENCES.find((d) => Object.hasOwn(d.rows, rule.row));
			assert.ok(difference, `${rule.name}: "${rule.row}" is no row of DIFFERENCES`);
			assert.strictEqual(difference.status, 'declared', rule.name);
		}
	});

	test('every declared difference has a rule, or a reason it has none', () => {
		const ruled = new Set([
			...DIFFERENTIAL_RULES.map((rule) => rule.row),
			...Object.keys(DIFFERENTIAL_UNRULED)
		]);
		for (const difference of DIFFERENCES) {
			if (difference.status !== 'declared') continue;
			assert.ok(
				Object.keys(difference.rows).some((row) => ruled.has(row)),
				`no rule for: ${difference.reason}`
			);
		}
		for (const row of Object.keys(DIFFERENTIAL_UNRULED)) {
			assert.ok(
				DIFFERENCES.some((d) => d.status === 'declared' && Object.hasOwn(d.rows, row)),
				`"${row}" in DIFFERENTIAL_UNRULED is no row of a declared difference`
			);
		}
	});

	test('every recognizer of a split is of a SIDES row and of a declared combination', () => {
		for (const entry of SPLIT_RECOGNIZERS) {
			const side = SIDES[entry.row];
			assert.ok(side, `"${entry.row}" is no row of SIDES`);
			assert.strictEqual(
				side.side === 'neither',
				!!entry.neither,
				`${entry.row}: a neither row, and only one, says what ours is held to`
			);
			assert.ok(
				DIFFERENCES.some(
					(d) => d.status === 'declared' && Object.hasOwn(d.rows, entry.combination)
				),
				`${entry.row}: "${entry.combination}" is no row of a declared difference`
			);
		}
	});

	test('every kind is generated', () => {
		const rng = create_differential_rng(1);
		const specs = Array.from({ length: 2000 }, () => gen_root_spec(rng));
		assert.deepEqual(
			DIFFERENTIAL_KINDS.filter(
				(kind) => kind !== 'object' && !specs.some((s) => spec_has_kind(s, kind))
			),
			[]
		);
	});
});
