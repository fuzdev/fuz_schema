import { describe, test, assert } from 'vitest';

import { DIFFERENCES, SIDES, type ConformanceSidesRow } from './conformance_tables.ts';
import {
	classify_differential_case,
	format_differential_report,
	run_differential,
	type DifferentialVerdict
} from './differential_classify.ts';
import {
	DIFFERENTIAL_KINDS,
	create_differential_rng,
	gen_root_spec,
	show_input,
	show_spec,
	spec_has_kind,
	type DifferentialInput,
	type DifferentialSpec
} from './differential_generate.ts';
import { SPLIT_RECOGNIZERS } from './differential_recognizers.ts';
import {
	DIFFERENTIAL_RULES,
	DIFFERENTIAL_UNRULED,
	type DifferentialRuleName
} from './differential_rules.ts';

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

// a plain object input of own keys, with a prototype of `proto` keys or of
// `ConformancePoint`
const obj = (
	own: Array<[string, DifferentialInput]> = [],
	{
		proto = [],
		base = 'plain'
	}: { proto?: Array<[string, DifferentialInput]>; base?: 'plain' | 'class' } = {}
): DifferentialInput => ({ t: 'obj', own, base, proto, hidden: [], symbol: null, frozen: false });
const v = (value: unknown): DifferentialInput => ({ t: 'v', v: value });
const arr = (items: Array<DifferentialInput>): DifferentialInput => ({
	t: 'arr',
	items,
	extra: [],
	sub: false
});
const check_true: DifferentialSpec = { t: 'check', fn: 'true' };
const loose = (entries: Array<[string, DifferentialSpec]>): DifferentialSpec => ({
	t: 'object',
	flavor: 'loose',
	entries
});
const strip = (entries: Array<[string, DifferentialSpec]>): DifferentialSpec => ({
	t: 'object',
	flavor: 'strip',
	entries
});

interface DifferentialPin {
	/** The entries of `SPLIT_RECOGNIZERS`, by row, without any of which the case is not declared. */
	recognizers: Array<ConformanceSidesRow>;
	/** The rules the case is credited to. */
	rules: Array<DifferentialRuleName>;
	spec: DifferentialSpec;
	input: DifferentialInput;
}

// a case declared through each entry of `SPLIT_RECOGNIZERS`, and through each
// rule of the splits and of the prototype, which the seeds above may never
// reach
const PINS: Array<DifferentialPin> = [
	{
		recognizers: ['unknown key named constructor / loose'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: loose([['a', check_true]]),
		input: obj([['constructor', v(1)]])
	},
	{
		recognizers: ['record, own key named prototype, wrong'],
		rules: ['prototype_ignored', 'split_on_a_side'],
		spec: { t: 'refine', of: { t: 'record', of: { t: 'string' } }, fn: 'false' },
		input: obj([['prototype', v(undefined)]], { base: 'class' })
	},
	{
		recognizers: ['unknown inherited key / loose'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: loose([['a', check_true]]),
		input: obj([], { proto: [['z', v('x')]] })
	},
	{
		recognizers: ['optional(default) entry, key undefined / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', { t: 'optional', of: { t: 'default', of: { t: 'string' }, v: 'x' } }],
			['b', check_true]
		]),
		input: obj()
	},
	{
		recognizers: ['default of undefined entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', check_true],
			['b', { t: 'default', of: { t: 'optional', of: { t: 'string' } }, v: undefined }]
		]),
		input: obj()
	},
	{
		recognizers: ['a default of a transform to undefined then a check, a value given'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: {
			t: 'rest',
			entries: [['a', check_true]],
			rest: { t: 'default', of: { t: 'transform', fn: 'to_undefined' }, v: 'x' }
		},
		input: obj([['z', v(1)]])
	},
	{
		recognizers: ['default of a wrong value entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', check_true],
			['z', { t: 'default', of: { t: 'map', of: { t: 'string' }, fn: 'to_T' }, v: 'x' }]
		]),
		input: obj()
	},
	{
		recognizers: ['default of undefined then a transform to "T" entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', check_true],
			[
				'b',
				{
					t: 'map',
					of: { t: 'default', of: { t: 'optional', of: { t: 'string' } }, v: undefined },
					fn: 'to_T'
				}
			]
		]),
		input: obj()
	},
	{
		recognizers: ['bare transform to "T" entry, key missing / *'],
		rules: ['prototype_ignored', 'split_on_a_side'],
		spec: {
			t: 'union',
			of: [
				{ t: 'rest', entries: [['a', { t: 'transform', fn: 'or_d' }]], rest: { t: 'string' } },
				{ t: 'string' }
			]
		},
		input: obj([], { proto: [['q', v(undefined)]] })
	},
	{
		recognizers: ['a check after an object with an unknown key'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: {
			t: 'refine',
			of: { t: 'object', flavor: 'strict', entries: [['a', check_true]] },
			fn: 'false'
		},
		input: obj([['z', v(1)]])
	},
	{
		recognizers: ['loose, a default of a transform, an unknown key named constructor'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: loose([
			['a', check_true],
			['d', { t: 'default', of: { t: 'transform', fn: 'to_T' }, v: 'x' }]
		]),
		input: obj([['constructor', v(1)]])
	},
	{
		recognizers: ['loose, a default of undefined, an unknown key named constructor'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: loose([
			['a', check_true],
			['d', { t: 'default', of: { t: 'optional', of: { t: 'string' } }, v: undefined }]
		]),
		input: obj([['constructor', v(1)]])
	},
	{
		recognizers: ['a max_length after an array too long, an item wrong'],
		rules: ['too_long_zod_items'],
		spec: {
			t: 'max_length',
			of: {
				t: 'array',
				of: {
					t: 'record',
					of: { t: 'max_length', of: { t: 'array', of: { t: 'string' } }, n: 0 }
				}
			},
			n: 0
		},
		input: arr([obj([['prototype', arr([v(1)])]])])
	},
	{
		recognizers: ['max_length, a string of a surrogate pair', 'record, array'],
		rules: ['union_options_split'],
		spec: strip([
			['a', { t: 'string' }],
			[
				'b',
				{
					t: 'union',
					of: [
						{ t: 'array', of: { t: 'max_length', of: { t: 'string' }, n: 1 } },
						{ t: 'record', of: { t: 'string' } }
					]
				}
			]
		]),
		input: obj([['b', arr([v('\u{1F600}')])]])
	},
	{
		recognizers: [],
		rules: ['too_long_zod_items'],
		spec: { t: 'max_length', of: { t: 'array', of: { t: 'number' } }, n: 1 },
		input: arr([v(Infinity), v(1)])
	},
	{
		recognizers: [],
		rules: ['constructor_valibot_verdict'],
		spec: {
			t: 'record',
			of: { t: 'record', of: { t: 'max_length', of: { t: 'string' }, n: 1 } }
		},
		input: obj([
			['a', v('x')],
			['z', obj([['prototype', v('\u{1F600}')]])]
		])
	}
];

// the verdict on a case with an entry of `SPLIT_RECOGNIZERS` recognizing
// nothing, put back after
const classify_without = (
	row: ConformanceSidesRow,
	spec: DifferentialSpec,
	input: DifferentialInput
): DifferentialVerdict => {
	const entry = SPLIT_RECOGNIZERS.find((e) => e.row === row);
	assert.ok(entry, `"${row}" is no entry of SPLIT_RECOGNIZERS`);
	const { at } = entry;
	entry.at = () => false;
	try {
		return classify_differential_case(spec, input);
	} finally {
		entry.at = at;
	}
};

describe('the differential pins', () => {
	for (const pin of PINS) {
		test(`${show_spec(pin.spec)} on ${show_input(pin.input)}`, () => {
			const verdict = classify_differential_case(pin.spec, pin.input);
			assert(verdict.kind === 'declared', `${verdict.kind}, not declared`);
			assert.deepEqual([...verdict.rules].sort(), [...pin.rules].sort());
			for (const row of pin.recognizers) {
				assert.notDeepEqual(
					classify_without(row, pin.spec, pin.input),
					verdict,
					`declared without "${row}"`
				);
			}
		});
	}

	test('every entry of SPLIT_RECOGNIZERS and every rule of a split or the prototype has a pin', () => {
		const pinned = new Set(PINS.flatMap((pin) => pin.recognizers));
		assert.deepEqual(
			SPLIT_RECOGNIZERS.map((entry) => entry.row).filter((row) => !pinned.has(row)),
			[]
		);
		const credited = new Set(PINS.flatMap((pin) => pin.rules));
		const rules: Array<DifferentialRuleName> = [
			'split_on_a_side',
			'union_options_split',
			'too_long_zod_items',
			'constructor_valibot_verdict',
			'prototype_ignored'
		];
		assert.deepEqual(
			rules.filter((rule) => !credited.has(rule)),
			[]
		);
	});
});
