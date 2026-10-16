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
	ConformancePoint,
	is_same_result,
	run_conformance,
	type ConformanceRow
} from './conformance_test_helpers.ts';
import {
	DIFFERENCES,
	INFORMATIONAL,
	SIDES,
	expand_conformance_table
} from './conformance_tables.ts';

// The rule: where zod and valibot agree on what a schema does with an input,
// this library does the same, unless the difference is declared in the
// tables of `conformance_tables.ts` and in `docs/design.md`. Where the two
// disagree, which one this library goes with is recorded there. The matrix of
// cases is in `conformance_test_helpers.ts`.
//
// One difference is in no table: this library returns its input where nothing
// in it changed, and the others always copy. `is_same_result` allows for it,
// and the tests at the end of this file hold it.

const rows = run_conformance();
const differences = expand_conformance_table(
	Object.fromEntries(
		DIFFERENCES.flatMap((difference) =>
			Object.entries(difference.rows).map(([key, results]) => [key, { difference, results }])
		)
	)
);
const sides = expand_conformance_table(SIDES);
const informational = expand_conformance_table(INFORMATIONAL);

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
