import { describe, test, assert } from 'vitest';
import { readFileSync } from 'node:fs';
import * as z from 'zod';
import * as zm from 'zod/mini';
import * as v from 'valibot';
import { type } from 'arktype';
import { Type as T } from 'typebox';
import { Value } from 'typebox/value';

import * as s from '#lib/schema.ts';
import {
	CONFORMANCE_FLAVORS,
	ConformancePoint,
	is_same_result,
	run_conformance,
	type ConformanceRow,
	type InformationalLibName
} from './conformance_test_helpers.ts';

// The rule: where zod and valibot agree on what a schema does with an input,
// this library does the same, unless the difference is declared here and in
// `docs/design.md`. Where the two disagree, which one this library goes with
// is recorded here. The matrix of cases is in `conformance_test_helpers.ts`.
//
// A row is a case's name, with ` / strip`, ` / strict` or ` / loose` after it
// when the case is run through the object flavors. A key of a table that ends
// in ` / *` stands for the three, which then gave the same results. A result
// is the text `render_parsed` writes.
//
// One difference is in no table: this library returns its input where nothing
// in it changed, and the others always copy. `is_same_result` allows for it,
// and the tests at the end of this file hold it.

interface ConformanceDifference {
	/** What this library does, in a line. */
	reason: string;
	/**
	 * `declared` is deliberate, and in `docs/design.md`. `undecided` is a
	 * difference the test found that nobody has ruled on: it passes, and is
	 * printed on every run until it is conformed to or declared. The table is
	 * kept free of them.
	 */
	status: 'declared' | 'undecided';
	/** Words of `docs/design.md` that declare it, whatever the line breaks. */
	docs?: string;
	/** The rows it covers, each with what zod and valibot both did and what this library did. */
	rows: Record<string, { both: string; ours: string }>;
}

/** Where zod and valibot agree and this library differs. */
const DIFFERENCES: Array<ConformanceDifference> = [
	{
		reason:
			'a `check` that is the entry itself, or that another schema holds as one, takes a missing key as `undefined`',
		status: 'declared',
		docs: 'a `check` that is the entry itself, or that another schema holds in one of those places',
		rows: {
			'bare check entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'nullable(check) entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'lazy(check) entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'union[string, check] entry, key missing / *': { both: 'fail at a', ours: 'ok {}' }
		}
	},
	{
		reason:
			'a key read through the prototype stays inherited in an input that comes back, where a copy has it as an own key',
		status: 'declared',
		docs: 'A key read through the prototype stays inherited in an input that comes back',
		rows: {
			'required inherited / *': { both: 'ok {a: "x"}', ours: 'ok {} proto=other' },
			'optional inherited undefined / *': {
				both: 'ok {a: "x", b: undefined}',
				ours: 'ok {a: "x"} proto=other'
			},
			'unknown entry, key inherited / *': { both: 'ok {a: undefined}', ours: 'ok {} proto=other' },
			'literal(undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'one_of with undefined entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'nullable(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'lazy(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'message(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'literal(undefined) then a check entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'union[number, undefined] entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'nullable(one_of with undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'lazy(one_of with undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'union[number, one_of with undefined] entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'one_of with undefined then a check entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'variant, a literal(undefined) discriminator, key inherited': {
				both: 'ok {t: undefined, x: "x"}',
				ours: 'ok {x: "x"} proto=other'
			},
			'optional inherited undefined + unknown key / loose': {
				both: 'ok {a: "x", b: undefined, z: 1}',
				ours: 'ok {a: "x", z: 1} proto=other'
			},
			'entry named constructor, unknown, missing / *': {
				both: 'ok {constructor: fn}',
				ours: 'ok {}'
			}
		}
	},
	{
		reason:
			'a `loose_object` input that comes back keeps an own `__proto__` key, which a copy leaves out',
		status: 'declared',
		docs: 'The input returned as it is keeps them all',
		rows: {
			'unknown own __proto__ key / loose': {
				both: 'ok {a: "x"}',
				ours: 'ok {a: "x", __proto__: {q: 1}}'
			}
		}
	},
	{
		reason: 'an entry named `__proto__` is not guarded, so an input that comes back keeps the key',
		status: 'declared',
		docs: 'an input that comes back keeps its own `__proto__` key',
		rows: {
			'entry named __proto__, own / *': { both: 'ok {a: "x"}', ours: 'ok {a: "x", __proto__: "p"}' }
		}
	},
	{
		reason:
			"`record` validates the value of every own key, so that of an own `__proto__` key too, before leaving the key out of a copy, where both drop it unread: the stricter answer, and the Rust crate's",
		status: 'declared',
		docs: '`record` validates the value of an own `__proto__` key',
		rows: {
			'record, own __proto__ key whose value is wrong': {
				both: 'ok {a: 1}',
				ours: 'fail at __proto__'
			}
		}
	},
	{
		reason:
			'an enumerable key the input inherits is still read through a `record` input that comes back, unvalidated, where a copy has only the own keys',
		status: 'declared',
		docs: 'An enumerable key the input inherits is still read through an input that comes back',
		rows: {
			'record, inherited key': { both: 'ok {a: 1}', ours: 'ok {a: 1} proto=other' }
		}
	},
	{
		reason:
			'a hole of an array stays a hole in an array that comes back, where both write `undefined`',
		status: 'declared',
		docs: 'a hole stays a hole',
		rows: {
			'array of optionals, a hole': {
				both: 'ok ["x", undefined, "y"]',
				ours: 'ok ["x", <hole>, "y"]'
			}
		}
	},
	{
		reason:
			'a copy of an array is a `slice`, so a hole before the first item that changed stays a hole in it, where both write `undefined`',
		status: 'declared',
		docs: 'a hole before the first item that changed stays a hole in it',
		rows: {
			'array of optionals, a hole before an item that changes': {
				both: 'ok [undefined, "x!"]',
				ours: 'ok [<hole>, "x!"]'
			}
		}
	},
	{
		reason: 'an array that comes back keeps its own keys that are not items, where a copy has none',
		status: 'declared',
		docs: 'its own keys that are not items stay',
		rows: {
			'array with another key': { both: 'ok ["x"]', ours: 'ok ["x"] with {z: 1}' }
		}
	},
	{
		reason:
			"a copy of an array is a `slice`, so an instance of the input's `Array` subclass, where both give a plain array",
		status: 'declared',
		docs: "it is an instance of the input's `Array` subclass",
		rows: {
			'array of a subclass, an item changes': { both: 'ok ["x!"]', ours: 'ok ["x!"] proto=other' }
		}
	}
];

interface ConformanceSide {
	/** Whose result this library's is, as `is_same_result` tells. */
	side: 'zod' | 'valibot' | 'neither' | 'both';
	zod: string;
	valibot: string;
	/** This library's result, where it isn't the text of its side's. Always given for `neither`. */
	ours?: string;
}

/** Where zod and valibot disagree: which of them this library goes with. */
const SIDES: Record<string, ConformanceSide> = {
	// arrays given to object and record schemas: valibot takes one as an object.
	// The first is a refusal by all three, which differ in the path
	'array / *': { side: 'zod', zod: 'fail at <root>', valibot: 'fail at a' },
	'array with the keys / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {a: "x"}' },
	'array, all entries optional / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'empty schema, array / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'schema names length, array / *': {
		side: 'zod',
		zod: 'fail at <root>',
		valibot: 'ok {length: 0}'
	},
	'record, array': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'variant, array': { side: 'zod', zod: 'fail at <root>', valibot: 'fail at t' },
	'variant, array with the key': {
		side: 'zod',
		zod: 'fail at <root>',
		valibot: 'ok {t: "b", d: "D"}'
	},

	// a discriminator that is missing, of an option that has other entries:
	// valibot stops at the discriminator
	'variant, a literal(undefined) discriminator, key missing, an entry wrong': {
		side: 'zod',
		zod: 'fail at t, x',
		valibot: 'fail at t'
	},

	// the unknown keys of a loose object. An enumerable one the input inherits
	// zod copies and valibot drops: a copy here drops it, and an input that
	// comes back is neither's, as the key is still read through it, and not as
	// an own key
	'unknown inherited key / loose': {
		side: 'neither',
		zod: 'ok {a: "x", z: 1}',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},
	'default + unknown inherited key / loose': {
		side: 'valibot',
		zod: 'ok {a: "x", d: "D", z: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	'unknown key named constructor / loose': {
		side: 'zod',
		zod: 'ok {a: "x", constructor: 1}',
		valibot: 'ok {a: "x"}'
	},
	'unknown key named prototype / loose': {
		side: 'zod',
		zod: 'ok {a: "x", prototype: 1}',
		valibot: 'ok {a: "x"}'
	},
	'default + unknown key named constructor / loose': {
		side: 'zod',
		zod: 'ok {a: "x", d: "D", constructor: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	'default + unknown key named prototype / loose': {
		side: 'zod',
		zod: 'ok {a: "x", d: "D", prototype: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},

	// an optional key under another schema: valibot needs the key
	'union[string, optional(number)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[unknown, optional(string)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[literal(undefined), optional(string)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'nullable(optional(string)) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'lazy(optional(string)) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'nullable(default) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'fail at a'
	},
	'lazy(default) entry, key missing / *': { side: 'zod', zod: 'ok {a: "D"}', valibot: 'fail at a' },
	// valibot's has a schema before it, which needs the key
	'bare transform entry, key missing / *': { side: 'zod', zod: 'ok {}', valibot: 'fail at a' },
	'bare transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	// valibot leaves the key out without running the steps after the optional
	'optional(string) then a transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},

	// a default under an optional, and a default of `undefined`: zod fills them in
	'optional(default) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {}'
	},
	'optional(default) entry, key undefined / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: undefined}'
	},
	'default of undefined entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: undefined}',
		valibot: 'ok {}'
	},

	// an entry named `__proto__`: zod neither reads nor writes it. The others
	// read `Object.prototype` for it when the input lacks the key, and set the
	// output's prototype by writing it
	'entry named __proto__, missing / *': {
		side: 'valibot',
		zod: 'ok {a: "x"}',
		valibot: 'fail at __proto__'
	},
	'entry named __proto__, own object, beside a default / *': {
		side: 'valibot',
		zod: 'ok {d: "D"}',
		valibot: 'ok {d: "D"} proto=other'
	},

	// what a record is given: zod refuses a symbol key, whatever its value, and a
	// class instance
	'record, symbol key': {
		side: 'valibot',
		zod: 'fail at Symbol(sym)',
		valibot: 'ok {a: 1}',
		ours: 'ok {a: 1, Symbol(sym): "x"}'
	},
	'record, symbol key whose value is right': {
		side: 'valibot',
		zod: 'fail at Symbol(sym)',
		valibot: 'ok {a: 1}',
		ours: 'ok {a: 1, Symbol(sym): 2}'
	},
	'record, class instance': {
		side: 'valibot',
		zod: 'fail at <root>',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},

	// zod's `number` refuses the infinities, and its integer is a safe one
	'number, Infinity': { side: 'valibot', zod: 'fail at <root>', valibot: 'ok Infinity' },
	'number, -Infinity': { side: 'valibot', zod: 'fail at <root>', valibot: 'ok -Infinity' },
	'integer, past the safe ones': {
		side: 'valibot',
		zod: 'fail at <root>',
		valibot: 'ok 9007199254740992'
	}
};

/**
 * What arktype and typebox did with the cases that name them in `also`.
 * They are not part of the rule: nothing here is right or wrong, and the
 * results are pinned so that an upgrade which changes one shows. Of a refusal
 * only the verdict is kept. typebox has no object that drops unknown keys.
 */
const INFORMATIONAL: Record<string, Partial<Record<InformationalLibName, string>>> = {
	'exact / strip': { arktype: 'ok {a: "x", b: "y"}' },
	'exact / strict': { arktype: 'ok {a: "x", b: "y"}', typebox: 'ok {a: "x", b: "y"}' },
	'exact / loose': { arktype: 'ok {a: "x", b: "y"}', typebox: 'ok {a: "x", b: "y"}' },
	'optional missing / strip': { arktype: 'ok {a: "x"}' },
	'optional missing / strict': { arktype: 'ok {a: "x"}', typebox: 'ok {a: "x"}' },
	'optional missing / loose': { arktype: 'ok {a: "x"}', typebox: 'ok {a: "x"}' },
	// arktype's optional key may be missing and may not be `undefined`
	'optional undefined / strip': { arktype: 'fail' },
	'optional undefined / strict': { arktype: 'fail', typebox: 'ok {a: "x", b: undefined}' },
	'optional undefined / loose': { arktype: 'fail', typebox: 'ok {a: "x", b: undefined}' },
	'required missing / strip': { arktype: 'fail' },
	'required missing / strict': { arktype: 'fail', typebox: 'fail' },
	'required missing / loose': { arktype: 'fail', typebox: 'fail' },
	'unknown key / strip': { arktype: 'ok {a: "x"}' },
	'unknown key / strict': { arktype: 'fail', typebox: 'fail' },
	'unknown key / loose': { arktype: 'ok {a: "x", z: 1}', typebox: 'ok {a: "x", z: 1}' },
	'array / strip': { arktype: 'fail' },
	'array / strict': { arktype: 'fail', typebox: 'fail' },
	'array / loose': { arktype: 'fail', typebox: 'fail' },
	'empty schema, empty object / strip': { arktype: 'ok {}' },
	'empty schema, empty object / strict': { arktype: 'ok {}', typebox: 'ok {}' },
	'empty schema, empty object / loose': { arktype: 'ok {}', typebox: 'ok {}' },
	'default missing / *': { arktype: 'ok {a: "x", d: "D"}' },
	'default + unknown key / strip': { arktype: 'ok {a: "x", d: "D"}' },
	'default + unknown key / strict': { arktype: 'fail' },
	// a copy of the input with the default after it, so in the input's order
	'default + unknown key / loose': { arktype: 'ok {z: 1, a: "x", d: "D"}' }
};

// a table by row, its ` / *` keys written out
const expand = <TValue>(table: Record<string, TValue>): Map<string, TValue> => {
	const by_row: Map<string, TValue> = new Map();
	for (const [key, value] of Object.entries(table)) {
		const names = key.endsWith(' / *')
			? CONFORMANCE_FLAVORS.map((flavor) => key.slice(0, -1) + flavor)
			: [key];
		for (const name of names) {
			assert.ok(!by_row.has(name), `"${name}" is in a table twice`);
			by_row.set(name, value);
		}
	}
	return by_row;
};

const rows = run_conformance();
const differences = expand(
	Object.fromEntries(
		DIFFERENCES.flatMap((difference) =>
			Object.entries(difference.rows).map(([key, results]) => [key, { difference, results }])
		)
	)
);
const sides = expand(SIDES);
const informational = expand(INFORMATIONAL);

const describe_row = (row: ConformanceRow): string =>
	`\n  input       ${row.input_text}` +
	`\n  zod         ${row.results.zod.text}` +
	`\n  valibot     ${row.results.valibot.text}` +
	`\n  fuz_schema  ${row.results.fuz_schema.text}\n`;

// fails unless the row is what the rule and the tables say
const assert_conforms = (row: ConformanceRow): void => {
	const { zod, valibot, fuz_schema: ours } = row.results;
	const fail = (problem: string, fix: string): never =>
		assert.fail(`"${row.name}" ${problem}${describe_row(row)}${fix}`);
	const difference = differences.get(row.name);
	const side = sides.get(row.name);
	if (zod.text === valibot.text) {
		if (side) fail('is in SIDES, and zod and valibot agree on it.', 'Remove it from SIDES.');
		const same = is_same_result(ours, zod);
		if (!difference) {
			if (!same) {
				fail(
					'is a difference: zod and valibot agree and this library does something else.',
					'Conform, or declare the difference in DIFFERENCES and in docs/design.md.'
				);
			}
			return;
		}
		if (same) {
			fail(
				`is in DIFFERENCES and is no longer a difference (${difference.difference.reason}).`,
				'Remove it from DIFFERENCES, and from docs/design.md when no row is left of it.'
			);
		}
		if (difference.results.both !== zod.text || difference.results.ours !== ours.text) {
			fail(
				'is in DIFFERENCES with results that are no longer what the libraries do.',
				`DIFFERENCES has:\n  zod, valibot  ${difference.results.both}\n  fuz_schema    ${difference.results.ours}`
			);
		}
		return;
	}
	const is_zod = is_same_result(ours, zod);
	const is_valibot = is_same_result(ours, valibot);
	const found = is_zod ? (is_valibot ? 'both' : 'zod') : is_valibot ? 'valibot' : 'neither';
	if (difference) {
		fail(
			'is in DIFFERENCES, and zod and valibot no longer agree on it.',
			`Move it to SIDES. This library is on the side of: ${found}.`
		);
	}
	if (!side) {
		return fail(
			'has no entry in SIDES, and zod and valibot disagree on it.',
			`Add one. This library is on the side of: ${found}.`
		);
	}
	if (found !== side.side) {
		fail(
			`has this library on the side of: ${found}. SIDES records: ${side.side}.`,
			'Conform to the side it was on, or change SIDES and docs/design.md.'
		);
	}
	// this library's text is its side's unless the entry gives another
	const recorded = side.ours ?? (side.side === 'valibot' ? side.valibot : side.zod);
	if (side.side === 'neither' && side.ours === undefined) {
		fail('is in SIDES as neither, with no result of this library.', 'Give it as `ours`.');
	}
	if (side.zod !== zod.text || side.valibot !== valibot.text || recorded !== ours.text) {
		fail(
			'is in SIDES with results that are no longer what the libraries do.',
			`SIDES has:\n  zod         ${side.zod}\n  valibot     ${side.valibot}\n  fuz_schema  ${recorded}`
		);
	}
};

describe('conformance with zod and valibot', () => {
	describe('every row conforms, is a declared difference, or is on a recorded side', () => {
		for (const row of rows) {
			test(row.name, () => assert_conforms(row));
		}
	});

	test('every row has a name of its own', () => {
		const names = rows.map((row) => row.name);
		assert.deepEqual(
			names.filter((name, i) => names.indexOf(name) !== i),
			[]
		);
	});

	test('every key of a table is a row', () => {
		const names = new Set(rows.map((row) => row.name));
		for (const table of [differences, sides, informational]) {
			assert.deepEqual(
				[...table.keys()].filter((name) => !names.has(name)),
				[]
			);
		}
	});

	test('no library throws', () => {
		assert.deepEqual(
			rows
				.filter((row) => Object.values(row.results).some((r) => r.text.startsWith('throws')))
				.map(describe_row),
			[]
		);
	});

	test('every declared difference is in docs/design.md', () => {
		const docs = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8').replace(
			/\s+/g,
			' '
		);
		for (const difference of DIFFERENCES) {
			if (difference.status === 'undecided') {
				assert.strictEqual(difference.docs, undefined, difference.reason);
			} else {
				assert.ok(difference.docs, `no words of the docs for: ${difference.reason}`);
				assert.include(docs, difference.docs, difference.reason);
			}
		}
	});

	// tolerated, and printed so that each is ruled on
	test('the undecided differences are printed', () => {
		const undecided = DIFFERENCES.filter((difference) => difference.status === 'undecided');
		if (undecided.length) {
			// written directly, as the runner may keep what a passing test logs
			process.stdout.write(
				'\nconformance: differences from zod and valibot that are neither conformed to nor declared:\n' +
					undecided
						.flatMap((difference) =>
							Object.entries(difference.rows).map(
								([name, results]) =>
									`  ${name}\n    ${difference.reason}\n    zod, valibot  ${results.both}\n    fuz_schema    ${results.ours}`
							)
						)
						.join('\n') +
					'\n'
			);
		}
	});

	describe('arktype and typebox do what is pinned', () => {
		for (const row of rows) {
			const pinned = informational.get(row.name);
			if (!pinned && !Object.keys(row.informational).length) continue;
			test(row.name, () => {
				assert.deepEqual(row.informational, pinned ?? {}, 'in INFORMATIONAL');
			});
		}
	});
});

// The one difference no table has a row for. arktype and typebox are here as
// information the tests pin, and are not part of the rule.
describe('returning the input', () => {
	describe('across the matrix', () => {
		test('zod and valibot never return it', () => {
			assert.deepEqual(
				rows
					.filter((row) => row.results.zod.is_input || row.results.valibot.is_input)
					.map((row) => row.name),
				[]
			);
		});

		test('this library returns it exactly when its output has nothing the input lacks', () => {
			for (const row of rows) {
				const ours = row.results.fuz_schema;
				if (!ours.ok || typeof ours.value !== 'object' || ours.value === null) continue;
				assert.strictEqual(
					ours.is_input,
					ours.text === 'ok ' + row.input_text,
					`"${row.name}"${describe_row(row)}`
				);
			}
		});
	});

	class Nested extends ConformancePoint {
		n = { b: 1 };
	}

	const inputs: Record<string, () => any> = {
		plain: () => ({ a: 'x', n: { b: 1 } }),
		'keys in another order': () => ({ n: { b: 1 }, a: 'x' }),
		'class instance': () => new Nested(),
		'symbol key': () => ({ a: 'x', n: { b: 1 }, [Symbol.for('sym')]: 1 })
	};

	// an object of `a` and a nested `n`, neither taking unknown keys
	const strict: Record<string, (input: any) => unknown> = {
		zod: (input) =>
			z.strictObject({ a: z.string(), n: z.strictObject({ b: z.number() }) }).parse(input),
		'zod/mini': (input) =>
			zm.parse(zm.strictObject({ a: zm.string(), n: zm.strictObject({ b: zm.number() }) }), input),
		valibot: (input) =>
			v.parse(v.strictObject({ a: v.string(), n: v.strictObject({ b: v.number() }) }), input),
		arktype: (input) =>
			type({ '+': 'reject', a: 'string', n: { '+': 'reject', b: 'number' } })(input),
		typebox: (input) =>
			Value.Parse(T.Object({ a: T.String(), n: T.Object({ b: T.Number() }) }), input),
		fuz_schema: (input) =>
			s.parse_or_throw(s.object({ a: s.string, n: s.object({ b: s.number }) }), input)
	};

	// the same with a default to fill, so with an output that isn't the input
	const with_default: Record<string, (input: any) => unknown> = {
		zod: (input) =>
			z
				.object({ a: z.string(), n: z.object({ b: z.number() }), d: z.string().default('D') })
				.parse(input),
		valibot: (input) =>
			v.parse(
				v.object({ a: v.string(), n: v.object({ b: v.number() }), d: v.optional(v.string(), 'D') }),
				input
			),
		arktype: (input) => type({ a: 'string', n: { b: 'number' }, d: 'string = "D"' })(input),
		fuz_schema: (input) =>
			s.parse_or_throw(
				s.object({ a: s.string, n: s.object({ b: s.number }), d: s.with_default(s.string, 'D') }),
				input
			)
	};

	const describe_output = (output: any, input: any): string =>
		output instanceof type.errors
			? 'refused'
			: output === input
				? 'the input'
				: `a copy, its nested object ${output.n === input.n ? "the input's" : 'a copy'}`;

	const COPY = 'a copy, its nested object a copy';

	describe('when nothing changes', () => {
		const expected: Record<string, Record<string, string>> = {
			zod: {
				plain: COPY,
				'keys in another order': COPY,
				'class instance': COPY,
				'symbol key': COPY
			},
			'zod/mini': {
				plain: COPY,
				'keys in another order': COPY,
				'class instance': COPY,
				'symbol key': COPY
			},
			valibot: {
				plain: COPY,
				'keys in another order': COPY,
				'class instance': COPY,
				'symbol key': COPY
			},
			arktype: {
				plain: 'the input',
				'keys in another order': 'the input',
				'class instance': 'the input',
				// a symbol key is an unknown key to it
				'symbol key': 'refused'
			},
			typebox: {
				plain: 'the input',
				'keys in another order': 'the input',
				'class instance': 'the input',
				'symbol key': 'the input'
			},
			fuz_schema: {
				plain: 'the input',
				'keys in another order': 'the input',
				'class instance': 'the input',
				'symbol key': 'the input'
			}
		};
		for (const [lib, run] of Object.entries(strict)) {
			for (const [name, make] of Object.entries(inputs)) {
				test(`${lib}, ${name}: ${expected[lib]![name]}`, () => {
					const input = make();
					assert.strictEqual(describe_output(run(input), input), expected[lib]![name]);
				});
			}
		}
	});

	describe('when a default is filled in', () => {
		const expected: Record<string, string> = {
			zod: COPY,
			valibot: COPY,
			arktype: COPY,
			// only the path to the change is copied
			fuz_schema: "a copy, its nested object the input's"
		};
		for (const [lib, run] of Object.entries(with_default)) {
			test(`${lib}: ${expected[lib]}`, () => {
				const input = inputs.plain!();
				assert.strictEqual(describe_output(run(input), input), expected[lib]);
				assert.deepEqual(input, inputs.plain!(), 'the input is not mutated');
			});
		}
	});

	// what an input that comes back keeps, which a copy by zod or valibot doesn't
	describe('what it keeps', () => {
		const schema = s.object({ a: s.string });
		const theirs = (input: unknown): Array<unknown> => [
			z.object({ a: z.string() }).parse(input),
			v.parse(v.object({ a: v.string() }), input)
		];

		test('its prototype', () => {
			for (const input of [
				new ConformancePoint(),
				Object.assign(Object.create(null), { a: 'x' })
			]) {
				assert.strictEqual(s.parse_or_throw(schema, input), input);
				for (const copy of theirs(input)) {
					assert.strictEqual(Object.getPrototypeOf(copy), Object.prototype);
				}
			}
		});

		test('its symbol keys and its keys that are not enumerable', () => {
			const input = Object.defineProperty({ a: 'x', [Symbol.for('sym')]: 1 }, 'z', { value: 1 });
			assert.strictEqual(s.parse_or_throw(schema, input), input);
			for (const copy of theirs(input)) assert.deepEqual(Reflect.ownKeys(copy as object), ['a']);
		});

		test('its key order', () => {
			const ab = s.object({ a: s.string, b: s.string });
			const input = { b: 'y', a: 'x' };
			assert.strictEqual(s.parse_or_throw(ab, input), input);
			assert.deepEqual(Object.keys(z.object({ a: z.string(), b: z.string() }).parse(input)), [
				'a',
				'b'
			]);
			assert.deepEqual(Object.keys(v.parse(v.object({ a: v.string(), b: v.string() }), input)), [
				'a',
				'b'
			]);
		});
	});
});
