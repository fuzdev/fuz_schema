import { assert, describe, test } from 'vitest';

import {
	README_CLAIMS,
	README_CLAIMS_CLOSE,
	README_CLAIMS_ABOUT_EQUAL,
	README_CLAIMS_COMPILED_FEWER_BYTES_ON_INVALID,
	README_CLAIMS_COMPILED_STARTS_SLOWER_THAN,
	README_CLAIMS_COMPILED_SUBJECT,
	README_CLAIMS_EVERY_OTHER,
	README_CLAIMS_COLDSTART_FORMS,
	README_CLAIMS_GENERATORS,
	README_CLAIMS_INTERPRETERS,
	README_CLAIMS_RECURSIVE_SCENARIO,
	README_CLAIMS_OPEN,
	README_CLAIMS_SUBJECT,
	README_SECTION_HEADING,
	check_readme_claim,
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

	test('the bullets of every block of the section, in order, and nothing between two', () => {
		const readme = [
			README_SECTION_HEADING,
			'',
			README_CLAIMS_OPEN,
			'- one',
			README_CLAIMS_CLOSE,
			'',
			'### A heading of the section',
			'',
			'Words between two blocks.',
			'',
			'- a bullet between them, which is no claim',
			'',
			README_CLAIMS_OPEN,
			'',
			'- two,',
			'  wrapped',
			'- three',
			'',
			README_CLAIMS_CLOSE,
			'',
			// a block that never closes is none
			README_CLAIMS_OPEN,
			'- four',
			'',
			'## Develop',
			''
		].join('\n');
		assert.deepStrictEqual(find_readme_claims(`\n${readme}`), ['one', 'two, wrapped', 'three']);
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

// every timed row of an input, with one library's time made a multiple of this library's,
// or of the mode `subject` names
const scale_times = (
	results: BenchmarkResults,
	input: RunRows[number]['input'],
	lib: string,
	factor: number,
	subject: string = README_CLAIMS_SUBJECT
): void => {
	for (const row of to_measured(results, 'run').rows) {
		const ours = row.libs[subject]!;
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

type AllocationBytes = 'valid_bytes' | 'invalid_bytes';

// one row's time of a library made this library's and a little more, a gap inside the two
// spreads together: enough to fail a claim of every row
const level_a_row = (
	results: BenchmarkResults,
	input: RunRows[number]['input'],
	lib: string,
	subject: string = README_CLAIMS_SUBJECT
): void => {
	const row = to_measured(results, 'run').rows.find(
		(r) => r.input === input && r.scenario === 'list'
	)!;
	const ours = row.libs[subject]!;
	if ('none' in ours) throw new Error('the fixture times this library on every row');
	row.libs[lib] = { ...ours, ns: ours.ns * 1.02, min_ns: ours.ns, max_ns: ours.ns * 1.1 };
};

/**
 * For each claim, a change to the results that it no longer survives, made
 * to one library it names: the claim must fail for every one of them.
 */
const FLIPS: Array<[starts: string, change: (results: BenchmarkResults, lib: string) => void]> = [
	['**Size:**', (results, lib) => (to_measured(results, 'bundle').rows[2]!.libs[lib]!.gzip = 1)],
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
	// a library said to be slower as a mean made faster
	['**On valid input:**', (results, lib) => scale_times(results, 'valid', lib, 0.5)],
	['**As a guard,**', (results, lib) => scale_times(results, 'guard', lib, 0.5)],
	// one row is enough, and so is a gap that is inside the two spreads together
	['**On invalid input:**', (results, lib) => level_a_row(results, 'invalid', lib)],
	// about equal made three times apart
	['**Against Valita:**', (results, lib) => scale_times(results, 'invalid', lib, 3)],
	// a library said to allocate more on every row made to allocate nothing on one
	[
		'**Allocation:**',
		(results, lib) => (to_measured(results, 'allocations').rows[1]!.libs[lib]!.invalid_bytes = 0)
	],
	[
		'**Type-checking cost:**',
		(results, lib) => (to_measured(results, 'types').modules[lib]!.instantiations = 1)
	],
	[
		'**On the recursive scenario,**',
		// the one row made faster for the library
		(results, lib) => {
			const row = to_measured(results, 'run').rows.find(
				(r) => r.input === 'valid' && r.scenario === README_CLAIMS_RECURSIVE_SCENARIO
			)!;
			const ours = row.libs[README_CLAIMS_SUBJECT]!;
			if ('none' in ours) throw new Error('the fixture times this library on every row');
			row.libs[lib] = {
				...ours,
				ns: ours.ns * 0.5,
				batch_ns: ours.batch_ns * 0.5,
				min_ns: ours.min_ns * 0.5,
				max_ns: ours.max_ns * 0.5
			};
		}
	],
	[
		"**On a consumer's schemas,**",
		(results, lib) => {
			const set = to_measured(results, 'harvest').sets.find((s) => s.reference === lib)!;
			set.bundles[lib]!.gzip = 1;
		}
	],
	[
		'**Compiled size, cold start, and memory:**',
		(results, lib) => (to_measured(results, 'heap').rows[1]!.libs[lib]!.total_bytes = 1)
	],
	[
		'**Compiled on valid input:**',
		(results, lib) => scale_times(results, 'valid', lib, 0.5, README_CLAIMS_COMPILED_SUBJECT)
	],
	[
		'**Compiled as a guard:**',
		(results, lib) => scale_times(results, 'guard', lib, 0.5, README_CLAIMS_COMPILED_SUBJECT)
	],
	[
		'**Compiled on invalid input:**',
		(results, lib) => level_a_row(results, 'invalid', lib, README_CLAIMS_COMPILED_SUBJECT)
	],
	[
		'**Compiled against Sury:**',
		(results, lib) => scale_times(results, 'guard', lib, 3, README_CLAIMS_COMPILED_SUBJECT)
	],
	[
		'**Compiled allocation:**',
		(results, lib) => (to_measured(results, 'allocations').rows[1]!.libs[lib]!.valid_bytes = 0)
	],
	[
		'**Compiled type-checking cost:**',
		(results, lib) => (to_measured(results, 'types').with_reads[lib]!.instantiations = 1)
	],
	// a library said to be slower than the mode made a tenth of its time
	[
		'**Compiled across the tiers:**',
		(results, lib) => scale_times(results, 'guard', lib, 0.1, README_CLAIMS_COMPILED_SUBJECT)
	],
	// a library said to be faster than this one as it is imported made slower
	['**Across the tiers:**', (results, lib) => scale_times(results, 'guard', lib, 3)],
	[
		'**What compiling costs:**',
		(results, lib) => {
			const { all } = to_measured(results, 'bundle');
			all[lib]!.gzip = all[README_CLAIMS_COMPILED_SUBJECT]!.gzip + 1;
		}
	],
	// said to allocate fewer on every row of invalid input, made to allocate more on one
	[
		'**Valita**',
		(results, lib) => {
			const row = to_measured(results, 'allocations').rows[3]!;
			row.libs[lib]!.invalid_bytes = row.libs[README_CLAIMS_SUBJECT]!.invalid_bytes * 2;
		}
	],
	['**Zod and Valita**', (results, lib) => scale_times(results, 'guard', lib, 3)],
	['**TypeBox,**', (results, lib) => scale_times(results, 'invalid', lib, 3)],
	[
		"**TypeBox's check allocates**",
		// said to allocate fewer somewhere, made to allocate more on every row
		(results, lib) => {
			for (const row of to_measured(results, 'allocations').rows) {
				row.libs[lib]!.valid_bytes = row.libs[README_CLAIMS_SUBJECT]!.valid_bytes * 3 + 8;
			}
		}
	],
	[
		'**TypeBox against the compiled mode**',
		(results, lib) => scale_times(results, 'invalid', lib, 3, README_CLAIMS_COMPILED_SUBJECT)
	]
];

/**
 * What a sentence calls each library, most specific first: a name is taken
 * out of the sentence as it is found, so `Zod` alone is the package as it is
 * imported.
 */
const LIB_NAMES_IN_PROSE: Array<[RegExp, Array<string> | typeof README_CLAIMS_EVERY_OTHER]> = [
	[/the libraries compared/, README_CLAIMS_EVERY_OTHER],
	[/Zod with its roots compiled|compiled Zod/, ['zod_compiled']],
	[/Zod Mini/, ['zod_mini']],
	[/Zod/, ['zod']],
	[/Valibot/, ['valibot']],
	[/Valita/, ['valita']],
	[/TypeBox/, ['typebox']],
	[/Sury/, ['sury']]
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
				check_readme_claim(claim, results, to_claim_others(claim, results)),
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

	// every claim against every library it names, each on a fixture of its own: more than a
	// test's default time when the whole suite runs beside it
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
				const failure = check_readme_claim(claim, results, others);
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
	}, 30_000);

	test('a claim of the compiled mode is never against the library as it is imported, nor one of it against the mode', () => {
		const results = load_fixture();
		const modes = [README_CLAIMS_SUBJECT, README_CLAIMS_COMPILED_SUBJECT];
		for (const claim of README_CLAIMS) {
			const others = to_claim_others(claim, results);
			for (const mode of modes) assert.notInclude(others, mode, claim.sentence);
			// a sentence that opens on the mode is of it, and so is what the mode costs
			if (
				/^\*\*(Compiled|What compiling costs|TypeBox against the compiled mode)/.test(
					claim.sentence
				)
			) {
				assert.strictEqual(claim.subject, README_CLAIMS_COMPILED_SUBJECT, claim.sentence);
			} else {
				assert.strictEqual(claim.subject, undefined, claim.sentence);
			}
		}
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Compiled as a guard:**'))!;
		const others = to_claim_others(claim, results);
		// this library as it is imported made faster than the compiled mode changes nothing
		scale_times(results, 'guard', README_CLAIMS_SUBJECT, 0.1, README_CLAIMS_COMPILED_SUBJECT);
		assert.strictEqual(check_readme_claim(claim, results, others), null);
	});

	test('a claim of the compiled mode reads the mode, and not the library as it is imported', () => {
		// the mode alone made slower than every library on invalid input, the library left as it is
		const slower = load_fixture();
		for (const row of to_measured(slower, 'run').rows) {
			const ours = row.libs[README_CLAIMS_COMPILED_SUBJECT]!;
			if (row.input !== 'invalid' || 'none' in ours) continue;
			row.libs[README_CLAIMS_COMPILED_SUBJECT] = {
				...ours,
				ns: ours.ns * 20,
				batch_ns: ours.batch_ns * 20,
				min_ns: ours.min_ns * 20,
				max_ns: ours.max_ns * 20
			};
		}
		const on_invalid = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**Compiled on invalid input:**')
		)!;
		for (const lib of to_claim_others(on_invalid, slower)) {
			assert.include(check_readme_claim(on_invalid, slower, [lib]), lib);
		}
		// and the same claims of the library as it is imported still hold
		for (const starts of ['**On invalid input:**', '**Against Valita:**', '**TypeBox,**']) {
			const claim = README_CLAIMS.find((c) => c.sentence.startsWith(starts))!;
			assert.strictEqual(check_readme_claim(claim, slower), null, starts);
		}
		// the mode alone made faster than TypeBox's check fails what is said of TypeBox against it
		const faster = load_fixture();
		for (const row of to_measured(faster, 'run').rows) {
			const ours = row.libs[README_CLAIMS_COMPILED_SUBJECT]!;
			if (row.input !== 'invalid' || 'none' in ours) continue;
			row.libs[README_CLAIMS_COMPILED_SUBJECT] = {
				...ours,
				ns: ours.ns * 0.01,
				batch_ns: ours.batch_ns * 0.01,
				min_ns: ours.min_ns * 0.01,
				max_ns: ours.max_ns * 0.01
			};
		}
		const against = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**TypeBox against the compiled mode**')
		)!;
		assert.include(check_readme_claim(against, faster), 'as a geometric mean');
		const imported = README_CLAIMS.find((c) => c.sentence.startsWith('**TypeBox,**'))!;
		assert.strictEqual(check_readme_claim(imported, faster), null);
		// a predicate is handed the mode its claim names, and reads no other
		for (const claim of README_CLAIMS) {
			const results = load_fixture();
			const others = to_claim_others(claim, results);
			assert.strictEqual(
				claim.check(results, others, claim.subject ?? README_CLAIMS_SUBJECT),
				null,
				claim.sentence
			);
		}
	});

	test('a sentence of two inputs fails on either alone', () => {
		const tiers = README_CLAIMS.find((c) => c.sentence.startsWith('**Across the tiers:**'))!;
		for (const input of ['valid', 'guard'] as const) {
			for (const lib of to_claim_others(tiers, load_fixture())) {
				const results = load_fixture();
				scale_times(results, input, lib, 3);
				assert.include(check_readme_claim(tiers, results), `on ${input} rows`, lib);
			}
		}
		const compiled = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**Compiled across the tiers:**')
		)!;
		for (const input of ['valid', 'guard'] as const) {
			for (const lib of to_claim_others(compiled, load_fixture())) {
				const results = load_fixture();
				scale_times(results, input, lib, 0.1, README_CLAIMS_COMPILED_SUBJECT);
				assert.include(check_readme_claim(compiled, results), `on ${input} rows`, lib);
			}
		}
		// the compiled mode's claim of allocation is of invalid input for compiled Zod alone
		const compiled_bytes = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**Compiled allocation:**')
		)!;
		assert.deepStrictEqual(README_CLAIMS_COMPILED_FEWER_BYTES_ON_INVALID, ['zod_compiled']);
		for (const lib of to_claim_others(compiled_bytes, load_fixture())) {
			const results = load_fixture();
			to_measured(results, 'allocations').rows[1]!.libs[lib]!.invalid_bytes = 0;
			const failure = check_readme_claim(compiled_bytes, results);
			if (README_CLAIMS_COMPILED_FEWER_BYTES_ON_INVALID.includes(lib)) {
				assert.include(failure, 'bytes per invalid parse', lib);
			} else {
				assert.strictEqual(failure, null, lib);
			}
		}
		const allocation = README_CLAIMS.find((c) => c.sentence.startsWith('**Allocation:**'))!;
		for (const bytes of [
			'valid_bytes',
			'invalid_bytes'
		] as const satisfies Array<AllocationBytes>) {
			for (const lib of to_claim_others(allocation, load_fixture())) {
				const results = load_fixture();
				to_measured(results, 'allocations').rows[1]!.libs[lib]![bytes] = 0;
				assert.include(
					check_readme_claim(allocation, results),
					`bytes per ${bytes === 'valid_bytes' ? 'valid' : 'invalid'} parse`,
					lib
				);
			}
		}
	});

	test('what compiling costs reads a cold start of the library it names for one, in both forms', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**What compiling costs:**'))!;
		assert.deepStrictEqual(README_CLAIMS_COMPILED_STARTS_SLOWER_THAN, ['valita']);
		for (const form of README_CLAIMS_COLDSTART_FORMS) {
			const results = load_fixture();
			const row = to_measured(results, 'coldstart').rows.find((r) => r.form === form)!;
			// the compiled mode made the sooner on one row
			row.libs[README_CLAIMS_COMPILED_SUBJECT]!.stages.parse_100.work_ms = 0.01;
			assert.include(check_readme_claim(claim, results), 'valita is not faster', form);
		}
	});

	test('each tier holds the libraries of its kind, and every library of the roster is in one', () => {
		const results = load_fixture();
		const roster = results.meta.libs
			.map((lib) => lib.id)
			.filter((id) => id !== README_CLAIMS_SUBJECT && id !== README_CLAIMS_COMPILED_SUBJECT);
		assert.deepStrictEqual(
			[...README_CLAIMS_INTERPRETERS, ...README_CLAIMS_GENERATORS].sort(),
			[...roster].sort()
		);
		// a library in neither fails a README, whatever it claims
		results.meta.libs.push({ ...results.meta.libs.at(-1)!, id: 'another', package: 'another' });
		// ahead of what the claims of every library then say of it, having no figure of it
		const problems = check_readme_claims(to_readme(SENTENCES), results);
		assert.include(problems[0], 'another, which is in neither tier');
	});

	test("what compiling costs is of each library it names: one's bundle made the larger fails it, and so does one made to hold more", () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**What compiling costs:**'))!;
		for (const lib of ['valibot', 'valita']) {
			const smaller = load_fixture();
			to_measured(smaller, 'bundle').all[lib]!.gzip =
				to_measured(smaller, 'bundle').all[README_CLAIMS_COMPILED_SUBJECT]!.gzip + 1;
			assert.include(
				check_readme_claim(claim, smaller, to_claim_others(claim, smaller)),
				`${lib}'s gzipped bundle is not under`
			);
			const lighter = load_fixture();
			const held = to_measured(lighter, 'heap').rows[0]!.libs;
			held[lib]!.total_bytes = held[README_CLAIMS_COMPILED_SUBJECT]!.total_bytes * 2;
			assert.include(
				check_readme_claim(claim, lighter, to_claim_others(claim, lighter)),
				`${lib}'s retained heap is not under`
			);
		}
	});

	test('each half of the compiled size, cold start, and memory claim is read', () => {
		const claim = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**Compiled size, cold start, and memory:**')
		)!;
		const bundle = load_fixture();
		to_measured(bundle, 'bundle').rows[2]!.libs.sury!.gzip = 1;
		assert.include(check_readme_claim(claim, bundle, ['sury']), "sury's");
		const cold = load_fixture();
		to_measured(cold, 'coldstart').rows.find(
			(r) => r.form === 'unbundled'
		)!.libs.typebox!.stages.parse_100.work_ms = 0.01;
		assert.include(check_readme_claim(claim, cold, ['typebox']), 'typebox');
		// and this library as it is imported, the lighter of the two, is not asked about
		assert.strictEqual(
			check_readme_claim(claim, load_fixture(), to_claim_others(claim, load_fixture())),
			null
		);
	});

	test('two libraries called about equal are within the margin either way, and fail the claim past it', () => {
		const valita = README_CLAIMS.find((c) => c.sentence.startsWith('**Against Valita:**'))!;
		const sury = README_CLAIMS.find((c) => c.sentence.startsWith('**Compiled against Sury:**'))!;
		// each library's times made a multiple of the mode's own, on every row of an input
		const inside = README_CLAIMS_ABOUT_EQUAL * 0.98;
		const outside = README_CLAIMS_ABOUT_EQUAL * 1.05;
		for (const [claim, lib, inputs, subject] of [
			[valita, 'valita', ['valid', 'invalid', 'guard'], README_CLAIMS_SUBJECT],
			[sury, 'sury', ['valid', 'guard'], README_CLAIMS_COMPILED_SUBJECT]
		] as const) {
			for (const input of inputs) {
				// just inside the margin, behind and ahead, bears it out, whichever is the faster
				for (const factor of [inside, 1 / inside]) {
					const results = load_fixture();
					scale_times(results, input, lib, factor, subject);
					assert.strictEqual(check_readme_claim(claim, results), null, `${lib} ${input} ${factor}`);
				}
				// and just past it, either way, does not
				for (const factor of [outside, 1 / outside]) {
					const results = load_fixture();
					scale_times(results, input, lib, factor, subject);
					assert.include(
						check_readme_claim(claim, results),
						'the two are not about equal',
						`${lib} ${input} ${factor}`
					);
				}
			}
		}
		// the other half of Sury's sentence is a direction: the mode the faster on invalid input
		const results = load_fixture();
		scale_times(results, 'invalid', 'sury', 0.5, README_CLAIMS_COMPILED_SUBJECT);
		assert.include(check_readme_claim(sury, results), 'as a geometric mean');
	});

	test('a library the predicate is not given is one the results are not asked about', () => {
		// what dropping a library from a claim does, which the test of names above refuses
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**On invalid input:**'))!;
		const results = load_fixture();
		FLIPS.find(([starts]) => starts === '**On invalid input:**')![1](results, 'zod_mini');
		assert.isString(check_readme_claim(claim, results, to_claim_others(claim, results)));
		assert.strictEqual(
			check_readme_claim(
				claim,
				results,
				to_claim_others(claim, results).filter((lib) => lib !== 'zod_mini')
			),
			null
		);
	});

	test("two means inside each other's bands bear out neither direction", () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Across the tiers:**'))!;
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
		const failure = check_readme_claim(claim, results, ['typebox']);
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
		const failure = check_readme_claim(claim, results, ['typebox']);
		assert.isString(failure);
		assert.include(failure, 'inside what the two range over');
		// and with a band that narrow again, it is
		row.libs.typebox!.stages.first_parse.band_ms = 0.05;
		assert.strictEqual(check_readme_claim(claim, results, ['typebox']), null);
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
		const failure = check_readme_claim(claim, results, ['valibot']);
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
		assert.strictEqual(check_readme_claim(claim, results, ['valibot']), null);
	});

	test('the claim that TypeBox is faster on invalid input is a mean, the other way round', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**TypeBox,**'))!;
		const results = load_fixture();
		// the fixture's TypeBox is the faster on every row, which the row rule would refuse
		assert.strictEqual(check_readme_claim(claim, results, ['typebox']), null);
		scale_times(results, 'invalid', 'typebox', 3);
		const failure = check_readme_claim(claim, results, ['typebox']);
		assert.isString(failure);
		assert.include(failure, 'as a geometric mean');
	});

	test('a library said to be faster on some scenario fails the claim when it is faster on none', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Zod and Valita**'))!;
		for (const input of ['valid', 'guard'] as const) {
			for (const lib of to_claim_others(claim, load_fixture())) {
				const results = load_fixture();
				scale_times(results, input, lib, 3);
				const failure = check_readme_claim(claim, results, to_claim_others(claim, results));
				assert.isString(failure, `${input} ${lib}`);
				assert.include(failure, `no row has ${lib} faster`);
			}
		}
		// and of the compiled mode, the half of TypeBox's claim about valid input
		const typebox = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**TypeBox against the compiled mode**')
		)!;
		const results = load_fixture();
		scale_times(results, 'valid', 'typebox', 1.5, README_CLAIMS_COMPILED_SUBJECT);
		assert.include(check_readme_claim(typebox, results, ['typebox']), 'no row has typebox faster');
	});

	test('the library Valita is said to allocate fewer bytes than is this one, on every row of invalid input and on one of valid', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Valita**'))!;
		// fewer on no row of valid input fails the half that says it is on one
		const none = load_fixture();
		for (const row of to_measured(none, 'allocations').rows) {
			row.libs.valita!.valid_bytes = row.libs[README_CLAIMS_SUBJECT]!.valid_bytes * 2 + 8;
		}
		assert.include(check_readme_claim(claim, none), "no row has valita's bytes per valid parse");
		const results = load_fixture();
		const row = to_measured(results, 'allocations').rows[3]!;
		row.libs.valita!.invalid_bytes = row.libs[README_CLAIMS_SUBJECT]!.invalid_bytes * 2;
		const failure = check_readme_claim(claim, results, ['valita']);
		assert.isString(failure);
		assert.include(
			failure,
			`valita's bytes per invalid parse is not under ${README_CLAIMS_SUBJECT}'s`
		);
	});

	test("the cold start claim reads the hundredth parse, and the types claim a consumer's reads", () => {
		const cold = README_CLAIMS.find((c) => c.sentence.startsWith('**Cold start:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'coldstart').rows.find((r) => r.form === 'bundled')!;
		row.libs.valibot!.stages.parse_100.work_ms = 0.01;
		assert.include(check_readme_claim(cold, results, ['valibot']), 'valibot');
		const types = README_CLAIMS.find((c) => c.sentence.startsWith('**Type-checking cost:**'))!;
		const typed = load_fixture();
		to_measured(typed, 'types').with_reads.zod!.instantiations = 1;
		assert.include(check_readme_claim(types, typed, ['zod']), 'zod');
		// TypeBox has fewer for a module that infers nothing, and its claim fails where it has more
		const typebox = README_CLAIMS.find((c) =>
			c.sentence.startsWith("**TypeBox's check allocates**")
		)!;
		const more = load_fixture();
		const { modules } = to_measured(more, 'types');
		modules.typebox!.instantiations = modules[README_CLAIMS_SUBJECT]!.instantiations + 1;
		assert.include(
			more && check_readme_claim(typebox, more, ['typebox']),
			"typebox's instantiations are not under"
		);
		// and where it has fewer once the types are inferred
		const fewer = load_fixture();
		to_measured(fewer, 'types').with_reads.typebox!.instantiations = 1;
		assert.include(check_readme_claim(typebox, fewer, ['typebox']), 'typebox');
	});

	test('retained memory is the least only by more than what a total repeats to', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Retained memory:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'heap').rows[0]!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!.total_bytes;
		// more held than this library, by less than the two tolerances together
		row.libs.valibot!.total_bytes = ours + 2 * HEAP_TOTAL_TOLERANCE_BYTES - 100;
		const failure = check_readme_claim(claim, results, ['valibot']);
		assert.isString(failure);
		assert.include(failure, 'inside what the two range over');
		// and by more than them, it is the least
		row.libs.valibot!.total_bytes = ours + 2 * HEAP_TOTAL_TOLERANCE_BYTES + 100;
		assert.strictEqual(check_readme_claim(claim, results, ['valibot']), null);
	});

	test('fewer bytes a parse is by more than a percent either side, and a zero is fewer', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Allocation:**'))!;
		const results = load_fixture();
		const row = to_measured(results, 'allocations').rows[1]!;
		const ours = row.libs[README_CLAIMS_SUBJECT]!.valid_bytes;
		row.libs.zod!.valid_bytes = ours * 1.015;
		assert.include(check_readme_claim(claim, results, ['zod']), 'inside what the two range over');
		row.libs.zod!.valid_bytes = ours * 1.03;
		assert.strictEqual(check_readme_claim(claim, results, ['zod']), null);
		// a parse that allocates nothing allocates fewer than one that does
		row.libs[README_CLAIMS_SUBJECT]!.valid_bytes = 0;
		assert.strictEqual(check_readme_claim(claim, results, ['zod']), null);
		row.libs.zod!.valid_bytes = 0;
		assert.isString(check_readme_claim(claim, results, ['zod']));
	});

	test('a library said to allocate fewer bytes somewhere fails the claim when it does on no row', () => {
		const claim = README_CLAIMS.find((c) =>
			c.sentence.startsWith("**TypeBox's check allocates**")
		)!;
		const lib = 'typebox';
		for (const bytes of [
			'valid_bytes',
			'invalid_bytes'
		] as const satisfies Array<AllocationBytes>) {
			const results = load_fixture();
			const rows = to_measured(results, 'allocations').rows;
			// under this library's on one row alone bears the half out
			for (const row of rows) row.libs[lib]![bytes] = row.libs[README_CLAIMS_SUBJECT]![bytes] * 2;
			const ours = rows[2]!.libs[README_CLAIMS_SUBJECT]![bytes];
			rows[2]!.libs[lib]![bytes] = ours * 0.5;
			assert.strictEqual(check_readme_claim(claim, results, [lib]), null, bytes);
			// and inside what the two figures range over, it is under on none
			rows[2]!.libs[lib]![bytes] = ours * 0.995;
			const failure = check_readme_claim(claim, results, [lib]);
			assert.isString(failure, bytes);
			assert.include(failure, `no row has ${lib}'s`);
		}
	});

	test('the cold start claim is of both forms of entry, and fails on a file with one', () => {
		const claim = README_CLAIMS.find((c) => c.sentence.startsWith('**Cold start:**'))!;
		for (const form of README_CLAIMS_COLDSTART_FORMS) {
			// a library ahead in one form alone fails it
			const results = load_fixture();
			const row = to_measured(results, 'coldstart').rows.find((r) => r.form === form)!;
			row.libs.valibot!.stages.first_parse.work_ms = 0.01;
			assert.include(check_readme_claim(claim, results, ['valibot']), 'valibot', form);
			// and so does a file that measured only the other
			const one = load_fixture();
			const data = to_measured(one, 'coldstart');
			data.rows = data.rows.filter((r) => r.form !== form);
			assert.include(check_readme_claim(claim, one, ['valibot']), `an entry that is ${form}`);
		}
	});

	test('a row a library has no figure of is not compared, and one with none at all fails', () => {
		const claim = README_CLAIMS.find((c) =>
			c.sentence.startsWith('**Compiled on invalid input:**')
		)!;
		const results = load_fixture();
		const rows = to_measured(results, 'run').rows.filter((row) => row.input === 'invalid');
		// the fixture has one such row already, and the claim holds over it
		assert.ok(rows.some((row) => 'none' in row.libs.zod_compiled!));
		assert.strictEqual(check_readme_claim(claim, results, ['zod_compiled']), null);
		for (const row of rows) row.libs.zod_compiled = { none: 'uncompiled', why: null };
		assert.include(
			check_readme_claim(claim, results, ['zod_compiled']),
			'no row has a figure of both'
		);
	});

	test('a section the file did not measure fails the claims that read it', () => {
		const results = load_fixture();
		results.run = { status: 'skipped', reason: 'left out' };
		const problems = check_readme_claims(to_readme(SENTENCES), results);
		// every claim but those that read no time
		const untimed = [
			'**Size:**',
			'**Cold start:**',
			'**Retained memory:**',
			'**Allocation:**',
			'**Type-checking cost:**',
			"**On a consumer's schemas,**",
			'**Compiled size, cold start, and memory:**',
			'**What compiling costs:**',
			'**Compiled allocation:**',
			'**Compiled type-checking cost:**',
			'**Valita**',
			"**TypeBox's check allocates**"
		];
		assert.lengthOf(problems, README_CLAIMS.length - untimed.length);
		for (const problem of problems) {
			assert.match(problem, /the file has no \w+ parse times/);
			assert.ok(!untimed.some((starts) => problem.includes(starts)), problem);
		}
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
