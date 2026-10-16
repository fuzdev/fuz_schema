import { describe, test, assert } from 'vitest';

import { DIFFERENCES, SIDES, type ConformanceSidesRow } from './conformance_tables.ts';
import { render_parsed, type ConformanceParsed } from './conformance_test_helpers.ts';
import {
	classify_differential_case,
	format_differential_report,
	run_differential,
	type DifferentialVerdict
} from './differential_classify.ts';
import {
	DIFFERENTIAL_KINDS,
	DIFFERENTIAL_SYMBOL,
	gen_root_spec,
	run_differential_case,
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
import { create_seeded_rng } from './seeded_rng.ts';

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
		const rng = create_seeded_rng(1);
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
// `ConformancePoint`, and the symbol key where `symbol` is given
const obj = (
	own: Array<[string, DifferentialInput]> = [],
	{
		proto = [],
		base = 'plain',
		symbol = null
	}: {
		proto?: Array<[string, DifferentialInput]>;
		base?: 'plain' | 'class';
		symbol?: DifferentialInput | null;
	} = {}
): DifferentialInput => ({ t: 'obj', own, base, proto, hidden: [], symbol, frozen: false });
const v = (value: unknown): DifferentialInput => ({ t: 'v', v: value });
const arr = (items: Array<DifferentialInput>): DifferentialInput => ({
	t: 'arr',
	items,
	extra: [],
	sub: false
});
const check_true: DifferentialSpec = { t: 'check', fn: 'true' };
const to_t: DifferentialSpec = { t: 'transform', fn: 'to_T' };
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
// rule of the splits, of the prototype, and of a symbol key, which the seeds
// above may never reach
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
	...(['union', 'nullable', 'lazy'] as const).map((kind): DifferentialPin => ({
		recognizers: [
			kind === 'union'
				? 'union[string, bare transform to "T"] entry, key missing / *'
				: `${kind}(bare transform to "T") entry, key missing / *`
		],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: {
			t: 'union',
			of: [
				{ t: 'string' },
				strip([
					['a', check_true],
					[
						'b',
						kind === 'union' ? { t: 'union', of: [{ t: 'string' }, to_t] } : { t: kind, of: to_t }
					]
				])
			]
		},
		input: obj()
	})),
	{
		recognizers: ['a check after an object of unknown then a check that fails, key missing'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: {
			t: 'refine',
			of: strip([
				['a', check_true],
				['b', { t: 'refine', of: { t: 'unknown' }, fn: 'false' }]
			]),
			fn: 'false'
		},
		input: obj()
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
		recognizers: ['default of a wrong value entry, key missing / *'],
		rules: ['symbol_ignored', 'split_on_a_side'],
		spec: {
			t: 'union',
			of: [{ t: 'string' }, { t: 'record', of: { t: 'default', of: { t: 'string' }, v: 1 } }]
		},
		input: obj([['k0', v(undefined)]], { symbol: v('x') })
	},
	// nested defaults of `undefined` beside a bare check, which valibot reads as
	// an optional of the schema past them
	{
		recognizers: ['default of undefined entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', { t: 'default', of: { t: 'default', of: { t: 'string' }, v: 'x' }, v: undefined }],
			['b', check_true]
		]),
		input: obj()
	},
	{
		recognizers: ['optional(string) then a transform to "T" entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', check_true],
			['b', { t: 'map', of: { t: 'optional', of: { t: 'string' } }, fn: 'to_T' }]
		]),
		input: obj()
	},
	{
		recognizers: [
			'a default of a wrong value entry and a default of undefined entry, keys missing / *'
		],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: {
			t: 'union',
			of: [
				{ t: 'string' },
				strip([
					['a', { t: 'default', of: { t: 'string' }, v: 1 }],
					['b', check_true],
					['d', { t: 'default', of: { t: 'string' }, v: undefined }]
				])
			]
		},
		input: obj()
	},
	{
		recognizers: ['number, Infinity'],
		rules: ['record_own_proto', 'split_on_a_side'],
		spec: {
			t: 'union',
			of: [
				{ t: 'record', of: { t: 'number' } },
				{ t: 'transform', fn: 'to_undefined' }
			]
		},
		input: obj([['__proto__', v(Infinity)]])
	},
	// a pipe that starts with a transform, then a check that fails, beside a
	// bare check, after which zod runs a check, and valibot refuses the key
	{
		recognizers: ['transform to "T" then a transform entry, key missing / *'],
		rules: ['check_missing_key', 'split_on_a_side', 'pipe_stops'],
		spec: {
			t: 'refine',
			of: strip([
				['a', check_true],
				['b', { t: 'refine', of: { t: 'transform', fn: 'neg' }, fn: 'false' }]
			]),
			fn: 'false'
		},
		input: obj()
	},
	// a default an optional holds under a nullable, beside a bare check
	{
		recognizers: ['optional(default) entry, key undefined / *'],
		rules: ['check_missing_key', 'split_on_a_side'],
		spec: strip([
			['a', check_true],
			[
				'z',
				{
					t: 'optional',
					of: { t: 'nullable', of: { t: 'default', of: { t: 'string' }, v: 'x' } }
				}
			]
		]),
		input: obj()
	},
	// a key given only where its check takes it: the union beside the check
	// needs the key, as its `unknown` does
	{
		recognizers: [],
		rules: ['check_missing_key'],
		spec: strip([
			['a', check_true],
			['b', { t: 'union', of: [{ t: 'check', fn: 'is_string' }, { t: 'unknown' }] }]
		]),
		input: obj()
	},
	// a strict option that doesn't name the key and refuses the object without it
	{
		recognizers: [],
		rules: ['check_missing_key'],
		spec: {
			t: 'union',
			of: [
				{ t: 'object', flavor: 'strict', entries: [['x', { t: 'string' }]] },
				strip([['a', check_true]])
			]
		},
		input: obj()
	},
	// the options dropped of the union at the key given, and not of the one
	// beside it, whose check would take its value
	{
		recognizers: [],
		rules: ['check_missing_key', 'check_after_keyed_option'],
		spec: strip([
			['a', { t: 'union', of: [{ t: 'map', of: { t: 'unknown' }, fn: 'to_T' }, check_true] }],
			['b', { t: 'union', of: [{ t: 'unknown' }, { t: 'check', fn: 'is_string' }] }]
		]),
		input: obj([['b', v(undefined)]])
	},
	// the options dropped before the last that reaches a check, and not the first
	{
		recognizers: [],
		rules: ['check_missing_key', 'check_after_keyed_option'],
		spec: strip([
			[
				'a',
				{
					t: 'union',
					of: [
						{ t: 'check', fn: 'defined' },
						{ t: 'map', of: { t: 'unknown' }, fn: 'to_null' },
						check_true
					]
				}
			]
		]),
		input: obj()
	},
	// an own `__proto__` key renamed, which zod and valibot keep in their input
	// returned as it is
	{
		recognizers: [],
		rules: ['record_own_proto'],
		spec: {
			t: 'union',
			of: [
				{ t: 'record', of: { t: 'one_of', vs: [0, true, undefined] } },
				{
					t: 'union',
					of: [{ t: 'unknown' }, { t: 'one_of', vs: ['y', 1] }]
				}
			]
		},
		input: obj([['__proto__', v('x')]])
	},
	{
		recognizers: [],
		rules: ['record_own_proto'],
		spec: { t: 'union', of: [{ t: 'record', of: { t: 'string' } }, { t: 'unknown' }] },
		input: obj([['__proto__', v(undefined)]])
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

	// ours as though it wrote the symbol key into a copy, which `symbol_ignored`
	// takes away and is not what it is for
	test('a symbol key in a copy of ours is not taken away', () => {
		const spec: DifferentialSpec = {
			t: 'union',
			of: [{ t: 'record', of: { t: 'number' } }, strip([['a', to_t]])]
		};
		const input = obj([['a', v('x')]], { symbol: v('y') });
		const results = run_differential_case(spec, input);
		const ours = results.fuz_schema;
		assert(ours.ok && ours.value !== ours.input, 'ours copies');
		const value = { ...(ours.value as object), [DIFFERENTIAL_SYMBOL]: 'MUT' };
		const parsed: ConformanceParsed = { ok: true, value };
		const written = { ...ours, value, parsed, text: render_parsed(parsed) };
		assert.deepEqual(classify_differential_case(spec, input, results), { kind: 'agree' });
		assert.deepEqual(classify_differential_case(spec, input, { ...results, fuz_schema: written }), {
			kind: 'undeclared',
			split: null
		});
	});

	test('every entry of SPLIT_RECOGNIZERS and every rule of a split, the prototype, or a symbol key has a pin', () => {
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
			'prototype_ignored',
			'symbol_ignored'
		];
		assert.deepEqual(
			rules.filter((rule) => !credited.has(rule)),
			[]
		);
	});
});
