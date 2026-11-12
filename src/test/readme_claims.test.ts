import { assert, describe, test } from 'vitest';

import {
	README_CLAIMS,
	README_CLAIMS_CLOSE,
	README_CLAIMS_EVERY_OTHER,
	README_CLAIMS_OPEN,
	README_CLAIMS_SUBJECT,
	README_SECTION_HEADING,
	check_readme_claims,
	find_readme_claims,
	to_claim_others
} from './readme_claims.ts';
import {
	HEAP_TOTAL_TOLERANCE_BYTES,
	to_run_call_floor
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import type { BenchmarkResults } from '../benchmarks/results_schema.ts';
import { load_fixture, to_measured } from './results_test_helpers.ts';

/** A README whose Measurements section makes these claims, wrapped as a person would. */
const to_readme = (sentences: ReadonlyArray<string>): string =>
	[
		'# a library',
		'',
		'## Usage',
		'',
		'- a bullet that is no claim',
		'',
		README_SECTION_HEADING,
		'',
		'Some words before the claims.',
		'',
		README_CLAIMS_OPEN,
		'',
		// a long bullet wraps onto indented lines
		...sentences.map((sentence) => `- ${sentence.replace(/(.{60,}?) /g, '$1\n  ')}`),
		'',
		README_CLAIMS_CLOSE,
		'',
		'- a caveat, which is outside the claims',
		'',
		'## Develop',
		''
	].join('\n');

const SENTENCES = README_CLAIMS.map((claim) => claim.sentence);

describe('find_readme_claims', () => {
	test('the bullets of the claims block, each on one line, and nothing outside it', () => {
		assert.deepStrictEqual(find_readme_claims(to_readme(SENTENCES)), SENTENCES);
	});

	test('a README with no section, or a section with no block, has none to find', () => {
		assert.strictEqual(find_readme_claims('# a library\n\n## Usage\n'), null);
		assert.strictEqual(find_readme_claims(`\n${README_SECTION_HEADING}\n\n- a claim\n`), null);
		// a block under another heading is not the section's
		assert.strictEqual(
			find_readme_claims(
				`\n${README_SECTION_HEADING}\n\nwords\n\n## Other\n\n${README_CLAIMS_OPEN}\n- x\n${README_CLAIMS_CLOSE}\n`
			),
			null
		);
	});
});

type RunRows = ReturnType<typeof to_measured<'run'>>['rows'];

// every timed row of an input, with one library's time made a multiple of this library's
const scale_times = (
	results: BenchmarkResults,
	input: RunRows[number]['input'],
	lib: string,
	factor: number
): void => {
	for (const row of to_measured(results, 'run').rows) {
		const ours = row.libs[README_CLAIMS_SUBJECT]!;
		if (row.input !== input || 'none' in ours || 'none' in row.libs[lib]!) continue;
		row.libs[lib] = {
			...ours,
			ns: ours.ns * factor,
			batch_ns: ours.batch_ns * factor,
			min_ns: ours.min_ns * factor,
			max_ns: ours.max_ns * factor
		};
	}
};

/**
 * For each claim, a change to the results that it no longer survives, made
 * to one library it names: the claim must fail for every one of them.
 */
const FLIPS: Array<[starts: string, change: (results: BenchmarkResults, lib: string) => void]> = [
	['**Size:**', (results, lib) => (to_measured(results, 'bundle').rows[2]!.libs[lib]!.gzip = 1)],
	['**Warm speed against Valibot:**', (results, lib) => scale_times(results, 'guard', lib, 0.5)],
	['**Not the fastest on valid input:**', (results, lib) => scale_times(results, 'valid', lib, 3)],
	[
		'**On invalid input:**',
		// one row is enough, and so is a gap that is inside the two spreads together; TypeBox
		// is the half of the sentence that is a mean, and the other way round
		(results, lib) => {
			if (lib === 'typebox') {
				scale_times(results, 'invalid', lib, 3);
				return;
			}
			const row = to_measured(results, 'run').rows.find(
				(r) => r.input === 'invalid' && r.scenario === 'list'
			)!;
			const ours = row.libs[README_CLAIMS_SUBJECT]!;
			if ('none' in ours) throw new Error('the fixture times this library on every row');
			row.libs[lib] = { ...ours, ns: ours.ns * 1.02, min_ns: ours.ns, max_ns: ours.ns * 1.1 };
		}
	],
	['**As a guard:**', (results, lib) => scale_times(results, 'guard', lib, 3)],
	[
		'**Allocation:**',
		(results, lib) => (to_measured(results, 'allocations').rows[1]!.libs[lib]!.valid_bytes = 0)
	],
	[
		'**Cold start:**',
		(results, lib) => {
			const row = to_measured(results, 'coldstart').rows.find((r) => r.form === 'bundled')!;
			row.libs[lib]!.stages.first_parse.work_ms = 0.01;
		}
	],
	[
		'**Retained memory:**',
		(results, lib) => (to_measured(results, 'heap').rows[1]!.libs[lib]!.total_bytes = 1)
	],
	[
		'**Type-checking cost:**',
		(results, lib) => {
			const modules = to_measured(results, 'types').modules;
			modules[lib]!.instantiations = lib === 'typebox' ? 10_000_000 : 1;
		}
	]
];

/**
 * What a sentence calls each library, most specific first: a name is taken
 * out of the sentence as it is found, so `Zod` alone is the package as it is
 * imported.
 */
const LIB_NAMES_IN_PROSE: Array<[RegExp, Array<string> | typeof README_CLAIMS_EVERY_OTHER]> = [
	[/the libraries compared/, README_CLAIMS_EVERY_OTHER],
	[/Zod in each of its modes/, ['zod', 'zod_compiled', 'zod_mini']],
	[/Zod with its roots compiled|compiled Zod/, ['zod_compiled']],
	[/Zod Mini/, ['zod_mini']],
	[/Zod/, ['zod']],
	[/Valibot/, ['valibot']],
	[/TypeBox/, ['typebox']],
	[/ArkType/, ['arktype']]
];

// the libraries a sentence names, read from its words alone
const find_named_libs = (sentence: string): Array<string> | typeof README_CLAIMS_EVERY_OTHER => {
	let rest = sentence;
	const named: Array<string> = [];
	for (const [matcher, libs] of LIB_NAMES_IN_PROSE) {
		if (!matcher.test(rest)) continue;
		if (libs === README_CLAIMS_EVERY_OTHER) return libs;
		named.push(...libs);
		rest = rest.replace(new RegExp(matcher, 'g'), '');
	}
	return named;
};

describe('the claims', () => {
	test('every one holds on the fixture, which is built to bear them out', () => {
		const results = load_fixture();
		for (const claim of README_CLAIMS) {
			assert.strictEqual(
				claim.check(results, to_claim_others(claim, results)),
				null,
				claim.sentence
			);
		}
		assert.deepStrictEqual(check_readme_claims(to_readme(SENTENCES), results), []);
	});

	test('no sentence states a figure, and no two are alike', () => {
		for (const sentence of SENTENCES) assert.notMatch(sentence, /\d/, sentence);
		assert.strictEqual(new Set(SENTENCES).size, SENTENCES.length);
	});

	test('each is checked against exactly the libraries its sentence names', () => {
		for (const claim of README_CLAIMS) {
			const named = find_named_libs(claim.sentence);
			assert.deepStrictEqual(
				typeof claim.others === 'string' ? claim.others : [...claim.others].sort(),
				typeof named === 'string' ? named : named.sort(),
				claim.sentence
			);
		}
		// the reading itself: plain Zod is not its modes, and a mode is not plain Zod
		assert.deepStrictEqual(find_named_libs('than Zod Mini or compiled Zod'), [
			'zod_compiled',
			'zod_mini'
		]);
		assert.deepStrictEqual(find_named_libs("than plain Zod's"), ['zod']);
	});

	test('each has a change to the results that fails it, for every library it names', () => {
		assert.strictEqual(FLIPS.length, README_CLAIMS.length);
		for (const [starts, change] of FLIPS) {
			const claim = README_CLAIMS.find((c) => c.sentence.startsWith(starts));
			assert.ok(claim, starts);
			const others = to_claim_others(claim, load_fixture());
			assert.isAbove(others.length, 0, starts);
			for (const lib of others) {
				const results = load_fixture();
				change(results, lib);
				const failure = claim.check(results, others);
				assert.isString(failure, `${starts} ${lib}`);
				assert.include(failure, lib, starts);
				const problems = check_readme_claims(to_readme(SENTENCES), results);
				assert.ok(
					problems.some(
						(problem) =>
							problem.includes('the results no longer bear out') && problem.includes(claim.sentence)
					),
					`${starts} ${lib}: ${problems.join('\n')}`
				);
			}
		}
	});

	test('a library the predicate is not given is one the results are not asked about', () => {
		// what dropping a library from a claim does, which the test of names above refuses
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**On invalid input:**'))!;
		const results = load_fixture();
		FLIPS.find(([starts]) => starts === '**On invalid input:**')![1](results, 'zod_compiled');
		assert.isString(claim.check(results, to_claim_others(claim, results)));
		assert.strictEqual(
			claim.check(
				results,
				to_claim_others(claim, results).filter((lib) => lib !== 'zod_compiled')
			),
			null
		);
	});

	test("two means inside each other's bands bear out neither direction", () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**As a guard:**'))!;
		const results = load_fixture();
		// TypeBox a little faster as a mean, with passes that range past this library's
		for (const row of to_measured(results, 'run').rows) {
			const ours = row.libs[README_CLAIMS_SUBJECT]!;
			if (row.input !== 'guard' || 'none' in ours) continue;
			row.libs.typebox = {
				...ours,
				ns: ours.ns * 0.9,
				min_ns: ours.ns * 0.7,
				max_ns: ours.ns * 1.2,
				spread: 0.25
			};
		}
		const failure = claim.check(results, ['typebox']);
		assert.isString(failure);
		assert.include(failure, "inside each other's bands");
	});

	test('a cold start inside the two bands is not less time', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Cold start:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'coldstart').rows.find((r) => r.form === 'bundled')!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!.stages.first_parse;
		// slower by less than half of each band
		row.libs.typebox!.stages.first_parse = { work_ms: ours.work_ms + 0.2, band_ms: 0.5 };
		const failure = claim.check(results, ['typebox']);
		assert.isString(failure);
		assert.include(failure, 'inside what the two range over');
		// and with a band that narrow again, it is
		row.libs.typebox!.stages.first_parse.band_ms = 0.05;
		assert.strictEqual(claim.check(results, ['typebox']), null);
	});

	test('a time at the call floor tells the two apart no more than a gap inside their spreads', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**On invalid input:**'))!;
		const results = load_fixture();
		const run = to_measured(results, 'run');
		const floor = to_run_call_floor(run);
		const row = run.rows.find((r) => r.input === 'invalid' && r.scenario === 'list')!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!;
		assert.ok(!('none' in ours));
		// this library far faster on the row, and its time at the floor: mostly the call
		row.libs[README_CLAIMS_SUBJECT] = {
			...ours,
			ns: floor * 0.9,
			batch_ns: floor * 0.9,
			min_ns: floor * 0.88,
			max_ns: floor * 0.92
		};
		const failure = claim.check(results, ['valibot']);
		assert.isString(failure);
		assert.include(failure, 'time:invalid:list');
		assert.include(failure, 'at the call floor');
		// just past the floor, the same row bears the claim out
		row.libs[README_CLAIMS_SUBJECT] = {
			...ours,
			ns: floor * 1.2,
			batch_ns: floor * 1.2,
			min_ns: floor * 1.17,
			max_ns: floor * 1.23
		};
		assert.strictEqual(claim.check(results, ['valibot']), null);
	});

	test('the half of the invalid-input claim about TypeBox is a mean, the other way round', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**On invalid input:**'))!;
		const results = load_fixture();
		// the fixture's TypeBox is the faster on every row, which the row rule would refuse
		assert.strictEqual(claim.check(results, ['typebox']), null);
		scale_times(results, 'invalid', 'typebox', 3);
		const failure = claim.check(results, ['typebox']);
		assert.isString(failure);
		assert.include(failure, 'as a geometric mean');
	});

	test('retained memory is the least only by more than what a total repeats to', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Retained memory:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'heap').rows[0]!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!.total_bytes;
		// more held than this library, by less than the two tolerances together
		row.libs.valibot!.total_bytes = ours + 2 * HEAP_TOTAL_TOLERANCE_BYTES - 100;
		const failure = claim.check(results, ['valibot']);
		assert.isString(failure);
		assert.include(failure, 'inside what the two range over');
		// and by more than them, it is the least
		row.libs.valibot!.total_bytes = ours + 2 * HEAP_TOTAL_TOLERANCE_BYTES + 100;
		assert.strictEqual(claim.check(results, ['valibot']), null);
	});

	test('fewer bytes a parse is by more than a percent either side, and a zero is fewer', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Allocation:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'allocations').rows[1]!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!.valid_bytes;
		row.libs.zod!.valid_bytes = ours * 1.015;
		assert.include(claim.check(results, ['zod']), 'inside what the two range over');
		row.libs.zod!.valid_bytes = ours * 1.03;
		assert.strictEqual(claim.check(results, ['zod']), null);
		// a parse that allocates nothing allocates fewer than one that does
		row.libs[README_CLAIMS_SUBJECT]!.valid_bytes = 0;
		assert.strictEqual(claim.check(results, ['zod']), null);
		row.libs.zod!.valid_bytes = 0;
		assert.isString(claim.check(results, ['zod']));
	});

	test('a row a library has no figure of is not compared, and one with none at all fails', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**On invalid input:**'))!;
		const results = load_fixture();
		const rows = to_measured(results, 'run').rows.filter((row) => row.input === 'invalid');
		// the fixture has one such row already, and the claim holds over it
		assert.ok(rows.some((row) => 'none' in row.libs.zod_compiled!));
		assert.strictEqual(claim.check(results, ['zod_compiled']), null);
		for (const row of rows) row.libs.zod_compiled = { none: 'uncompiled', why: null };
		assert.include(claim.check(results, ['zod_compiled']), 'no row has a figure of both');
	});

	test('a section the file did not measure fails the claims that read it', () => {
		const results = load_fixture();
		results.run = { status: 'skipped', reason: 'left out' };
		const problems = check_readme_claims(to_readme(SENTENCES), results);
		assert.lengthOf(problems, 4);
		assert.ok(problems.every((problem) => /the file has no \w+ parse times/.test(problem)));
	});
});

describe('check_readme_claims', () => {
	const results = load_fixture();

	test('a README with no claims block fails, and says what it looks for', () => {
		const problems = check_readme_claims('# a library\n', results);
		assert.lengthOf(problems, 1);
		assert.include(problems[0], README_CLAIMS_OPEN);
	});

	test('a claim in the README with no row fails', () => {
		const problems = check_readme_claims(
			to_readme([...SENTENCES, '**Speed:** the fastest of them all.']),
			results
		);
		assert.lengthOf(problems, 1);
		assert.include(problems[0], 'no row of README_CLAIMS holds it');
	});

	test('a row whose sentence is gone from the README fails, and so does one reworded', () => {
		const gone = check_readme_claims(to_readme(SENTENCES.slice(1)), results);
		assert.lengthOf(gone, 1);
		assert.include(gone[0], 'the README no longer says it');
		const reworded = check_readme_claims(
			to_readme([SENTENCES[0]!.replace('smallest', 'tiniest'), ...SENTENCES.slice(1)]),
			results
		);
		// the new wording has no row, and the row's own is gone
		assert.lengthOf(reworded, 2);
	});

	test('a claim that states a figure fails, row or no row', () => {
		const claims = [
			{ sentence: '**Size:** about 0.84x of the next.', others: [], check: () => null }
		];
		const problems = check_readme_claims(to_readme([claims[0]!.sentence]), results, claims);
		assert.lengthOf(problems, 1);
		assert.include(problems[0], 'states a figure');
	});
});
