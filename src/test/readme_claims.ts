/**
 * The comparative claims the README's Measurements section makes, each the
 * exact sentence the README says and a predicate over a results file that
 * must hold for it to stay. `readme_claims.test.ts` holds the checker to the
 * fixture, and `readme_measurements.test.ts` holds the README itself to the
 * published run, so a sentence can't outlive the numbers it summarizes, and
 * the README carries no hand-copied timed figure. Only those tests read this
 * module: the site renders the file, and makes no claim of its own.
 *
 * In the README the claims are the bullets between `README_CLAIMS_OPEN` and
 * `README_CLAIMS_CLOSE`. A bullet there with no row here fails, and so does a
 * row whose sentence is gone.
 *
 * A direction holds only outside what the numbers range over, by the rules
 * the benchmarks page marks a difference by, through the functions it draws
 * its tables with. Two times of a row differ when the gap is more than their
 * two spreads together and neither is at the call floor. Two geometric means
 * differ when their bands don't overlap, a mean's band running from the mean
 * of its rows' fastest passes to the mean of their slowest. Heap bytes a parse
 * allocates and bytes retained are compared with the tolerance the page gives
 * each. Bundle bytes and instantiations are exact, and compared as they are.
 *
 * The rule is the page's and the rows are not always. A mean here is of two
 * libraries, over the rows both have a figure of, where a mean on the page is
 * of every library shown, over the rows they all have: a claim about Valibot
 * covers a scenario the page's mean leaves out for a library that has no
 * figure of it. So a claim and the page's mean can be of different rows, and
 * the sentence says which: "over the scenarios", or "over the scenarios each
 * has a figure of".
 *
 * @module
 */

import {
	matrix_row_entry,
	matrix_values_are_level,
	to_geomean_row,
	to_matrix_ratios,
	type MatrixGroup,
	type MatrixRow
} from '#routes/docs/benchmarks/benchmark_matrix.ts';
import {
	COLDSTART_SUMMARY_STAGE,
	to_allocation_groups,
	to_coldstart_groups,
	to_heap_groups,
	to_section_data,
	to_time_groups,
	type TimeInput
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import type { BenchmarkResults } from '../benchmarks/results_schema.ts';

/**
 * Whether the README's Measurements section carries its claims block, and so
 * whether `readme_measurements.test.ts` holds it to the published run. While
 * it is `false` that test holds the README to having no claims block, so the
 * block and this can only change together: a README that gains the block fails
 * until this is `true`, and from then a missing published run, a missing
 * block, and a claim the results don't bear out each fail.
 */
export const README_CLAIMS_HELD = true;

/** The heading of the README section the claims are in. */
export const README_SECTION_HEADING = '## Measurements';

/** The line that opens the README's claims: every bullet from it to `README_CLAIMS_CLOSE` is one. */
export const README_CLAIMS_OPEN =
	'<!-- claims: each bullet is held to results/latest.json by src/test/readme_measurements.test.ts -->';

/** The line that closes the README's claims. */
export const README_CLAIMS_CLOSE = '<!-- /claims -->';

/** The library every claim is about. */
export const README_CLAIMS_SUBJECT = 'fuz_schema';

const SUBJECT = README_CLAIMS_SUBJECT;

/** What a claim that names "the libraries compared" is checked against: every other library of the roster. */
export const README_CLAIMS_EVERY_OTHER = 'every other';

/** A claim the README makes. */
export interface ReadmeClaim {
	/** The sentence, exactly as the README's bullet says it, without the bullet. */
	sentence: string;
	/**
	 * The libraries the sentence compares this one with, by id, or
	 * `README_CLAIMS_EVERY_OTHER`. The predicate is given exactly these, so a
	 * library the sentence names is one the results are asked about.
	 */
	others: ReadonlyArray<string> | typeof README_CLAIMS_EVERY_OTHER;
	/**
	 * Whether the results bear the sentence out.
	 *
	 * @param others - the libraries of `others`, by id
	 * @returns null when they do, and otherwise what they show instead
	 */
	check: (results: BenchmarkResults, others: ReadonlyArray<string>) => string | null;
}

/** The libraries a claim compares this one with, in a results file. */
export const to_claim_others = (claim: ReadmeClaim, results: BenchmarkResults): Array<string> =>
	claim.others === README_CLAIMS_EVERY_OTHER
		? results.meta.libs.map((lib) => lib.id).filter((id) => id !== SUBJECT)
		: [...claim.others];

// the rows of an input's parse times, as the page draws them, without its mean
const to_time_rows = (results: BenchmarkResults, input: TimeInput): Array<MatrixRow> | string => {
	const group = to_time_groups(results).find((g) => g.key === `time:${input}`);
	const rows = group?.rows.filter((row) => row.kind === 'cell') ?? [];
	return rows.length ? rows : `the file has no ${input} parse times`;
};

/**
 * Checks that this library is the faster of two on a row, by the rule a table
 * marks a difference by: the gap is more than the two spreads together, and
 * neither time is at the row's call floor.
 */
const check_row_is_faster = (row: MatrixRow, other: string): string | null => {
	const ratio = to_matrix_ratios(row, [SUBJECT, other], other)[SUBJECT];
	if (ratio === undefined) return `${row.key}: ${SUBJECT} and ${other} have no figures to compare`;
	if (ratio.level === 'floor') {
		return `${row.key}: a time of ${SUBJECT} or ${other} is at the call floor, so the two are not told apart`;
	}
	if (ratio.level === 'spread') {
		return `${row.key}: ${SUBJECT} and ${other} are inside what the two range over`;
	}
	return ratio.ratio < 1 ? null : `${row.key}: ${SUBJECT} is not faster than ${other}`;
};

/**
 * Checks that this library is faster than each of `others` on every row both
 * have a figure of. A row either has no figure of is not compared, which a
 * sentence held by this must say, and a library with no row to compare fails.
 */
const check_faster_on_every_row = (
	rows: ReadonlyArray<MatrixRow> | string,
	others: ReadonlyArray<string>
): string | null => {
	if (typeof rows === 'string') return rows;
	for (const other of others) {
		let compared = 0;
		for (const row of rows) {
			if (
				matrix_row_entry(row, SUBJECT).kind !== 'value' ||
				matrix_row_entry(row, other).kind !== 'value'
			) {
				continue;
			}
			compared++;
			const failure = check_row_is_faster(row, other);
			if (failure !== null) return failure;
		}
		if (!compared) return `no row has a figure of both ${SUBJECT} and ${other}`;
	}
	return null;
};

/**
 * Checks which way the geometric means of this library's time and another's
 * run, over the rows of an input both have a figure of and neither has at the
 * call floor. The two must differ: means whose bands overlap bear out neither
 * direction.
 *
 * @param faster - whether this library is claimed to be the faster of the two
 */
const check_geomean = (
	results: BenchmarkResults,
	input: TimeInput,
	other: string,
	faster: boolean
): string | null => {
	const rows = to_time_rows(results, input);
	if (typeof rows === 'string') return rows;
	const columns = [SUBJECT, other];
	const mean = to_geomean_row(rows, columns, `claim:${input}:${other}`, 'every scenario');
	const ours = mean && matrix_row_entry(mean, SUBJECT);
	const theirs = mean && matrix_row_entry(mean, other);
	if (!mean || mean.empty !== null || ours?.kind !== 'value' || theirs?.kind !== 'value') {
		return `no ${input} row has a figure of both ${SUBJECT} and ${other} past the call floor`;
	}
	const ratio = (ours.value / theirs.value).toFixed(2);
	if (matrix_values_are_level(ours, theirs)) {
		return `on ${input} rows the geometric means of ${SUBJECT} and ${other} are inside each other's bands, at ${ratio} times: neither is the faster`;
	}
	return ours.value < theirs.value === faster
		? null
		: `on ${input} rows ${SUBJECT} takes ${ratio} times what ${other} does, as a geometric mean`;
};

/**
 * Checks that this library's bytes are under each of `others`' on every row
 * of a group, by more than what the two figures range over, the tolerance the
 * page gives the group's figures. A zero is a figure here: a parse that
 * allocates nothing allocates less than one that allocates.
 */
const check_fewer_bytes_on_every_row = (
	group: MatrixGroup | undefined,
	what: string,
	others: ReadonlyArray<string>
): string | null => {
	if (!group?.rows.length) return `the file has no rows of ${what}`;
	if (!others.length) return `no library to compare ${what} with`;
	for (const row of group.rows) {
		const ours = matrix_row_entry(row, SUBJECT);
		if (ours.kind !== 'value') return `${row.key}: ${SUBJECT} has no ${what}`;
		for (const other of others) {
			const theirs = matrix_row_entry(row, other);
			if (theirs.kind !== 'value') return `${row.key}: ${other} has no ${what}`;
			if (matrix_values_are_level(ours, theirs)) {
				return `${row.key}: ${SUBJECT}'s ${what} and ${other}'s are inside what the two range over`;
			}
			if (!(ours.value < theirs.value)) {
				return `${row.key}: ${SUBJECT}'s ${what} is not under ${other}'s`;
			}
		}
	}
	return null;
};

const first_failure = (checks: ReadonlyArray<string | null>): string | null =>
	checks.find((check) => check !== null) ?? null;

/**
 * Checks that this library's figure is the least of every row's, against
 * each of `others`. The figures are exact: bytes, or instantiations.
 */
const check_least = <T>(
	rows: ReadonlyArray<{ name: string; libs: Readonly<Record<string, T>> }>,
	to_value: (figures: T) => number,
	what: string,
	others: ReadonlyArray<string>
): string | null => {
	if (!rows.length) return `the file has no rows of ${what}`;
	if (!others.length) return `no library to compare ${what} with`;
	for (const row of rows) {
		const ours = row.libs[SUBJECT];
		if (!ours) return `${row.name}: ${SUBJECT} has no ${what}`;
		for (const other of others) {
			const theirs = row.libs[other];
			if (!theirs) return `${row.name}: ${other} has no ${what}`;
			if (!(to_value(ours) < to_value(theirs))) {
				return `${row.name}: ${SUBJECT}'s ${what} is not under ${other}'s`;
			}
		}
	}
	return null;
};

/** The libraries the valid-input claim says are faster than this one, as a geometric mean. */
export const README_CLAIMS_FASTER_ON_VALID: ReadonlyArray<string> = ['zod_compiled', 'typebox'];

/** The libraries the valid-input claim says are slower as a mean and faster on some scenario. */
export const README_CLAIMS_FASTER_ON_SOME_VALID: ReadonlyArray<string> = ['zod', 'arktype'];

/** The libraries the guard claim says are faster than this one, as a geometric mean. */
export const README_CLAIMS_FASTER_AS_GUARD: ReadonlyArray<string> = [
	'typebox',
	'arktype',
	'zod_compiled'
];

/** The libraries the guard claim says are slower as a mean and faster on some scenario. */
export const README_CLAIMS_FASTER_ON_SOME_GUARD: ReadonlyArray<string> = ['zod'];

/** The scenario the claim about the one real recursive schema is of. */
export const README_CLAIMS_RECURSIVE_SCENARIO = 'type_json';

/**
 * Checks that another library is the faster on at least one row, by the rule a
 * table marks a difference by: the half of a claim that a mean is not every row.
 */
const check_other_faster_on_some_row = (
	rows: ReadonlyArray<MatrixRow> | string,
	other: string
): string | null => {
	if (typeof rows === 'string') return rows;
	for (const row of rows) {
		const ratio = to_matrix_ratios(row, [SUBJECT, other], other)[SUBJECT];
		if (
			ratio !== undefined &&
			ratio.level !== 'floor' &&
			ratio.level !== 'spread' &&
			ratio.ratio > 1
		) {
			return null;
		}
	}
	return `no row has ${other} faster than ${SUBJECT}`;
};

/**
 * Checks a mean claim of one input: this library faster than each of `others`
 * as a geometric mean but those of `faster`, which are the faster, and each of
 * `some` the faster on at least one row.
 */
const check_input_means = (
	results: BenchmarkResults,
	input: TimeInput,
	others: ReadonlyArray<string>,
	faster: ReadonlyArray<string>,
	some: ReadonlyArray<string>
): string | null =>
	first_failure([
		...others.map((other) => check_geomean(results, input, other, !faster.includes(other))),
		...others
			.filter((other) => some.includes(other))
			.map((other) => check_other_faster_on_some_row(to_time_rows(results, input), other))
	]);

/**
 * The claims, in the order the README makes them. Each sentence states a
 * direction and no figure: the numbers are on the benchmarks page, rendered
 * from the same file.
 */
export const README_CLAIMS: ReadonlyArray<ReadmeClaim> = [
	{
		sentence:
			'**Size:** the smallest bundle of the libraries compared, minified and gzipped, for every scenario and for all of them together.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null => {
			const data = to_section_data(results, 'bundle');
			if (!data) return 'the file has no bundle sizes';
			return check_least(
				[
					...data.rows.map((row) => ({ name: row.scenario, libs: row.libs })),
					{ name: 'every scenario together', libs: data.all }
				],
				(sizes) => sizes.gzip,
				'gzipped bundle',
				others
			);
		}
	},
	{
		sentence:
			'**On valid input:** faster than Valibot, Zod as it is imported, Zod Mini, and ArkType as a geometric mean over the scenarios, though Zod as it is imported and ArkType are each faster on some of them; Zod with its roots compiled ahead of time by `z.compile` is faster over the scenarios it compiles, and so is TypeBox, whose check builds no output and no issues.',
		others: ['valibot', 'zod', 'zod_mini', 'arktype', 'zod_compiled', 'typebox'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null =>
			check_input_means(
				results,
				'valid',
				others,
				README_CLAIMS_FASTER_ON_VALID,
				README_CLAIMS_FASTER_ON_SOME_VALID
			)
	},
	{
		sentence:
			'**On invalid input:** faster than Valibot, ArkType, and Zod in each of its modes on every scenario each has a figure of; TypeBox, whose check stops at the first failure and builds no issues, is faster as a geometric mean.',
		others: ['valibot', 'arktype', 'zod', 'zod_compiled', 'zod_mini', 'typebox'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null =>
			first_failure([
				check_faster_on_every_row(
					to_time_rows(results, 'invalid'),
					others.filter((other) => other !== 'typebox')
				),
				// the half of the sentence about the one library that is the faster
				...others
					.filter((other) => other === 'typebox')
					.map((other) => check_geomean(results, 'invalid', other, false))
			])
	},
	{
		sentence:
			'**As a guard,** where a library only answers whether a valid input matches: faster than Valibot, Zod as it is imported, and Zod Mini as a geometric mean over the scenarios, though Zod as it is imported is faster on some of them; TypeBox, ArkType, and compiled Zod are faster over the scenarios each has a figure of.',
		others: ['valibot', 'zod', 'zod_mini', 'typebox', 'arktype', 'zod_compiled'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null =>
			check_input_means(
				results,
				'guard',
				others,
				README_CLAIMS_FASTER_AS_GUARD,
				README_CLAIMS_FASTER_ON_SOME_GUARD
			)
	},
	{
		sentence:
			'**On the recursive scenario,** `type_json`, a real schema: faster on valid input and as a guard than Valibot, Zod as it is imported, Zod Mini, TypeBox, and ArkType.',
		others: ['valibot', 'zod', 'zod_mini', 'typebox', 'arktype'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null => {
			const rows = (['valid', 'guard'] as const).flatMap((input) => {
				const found = to_time_rows(results, input);
				return typeof found === 'string'
					? []
					: found.filter((row) => row.key === `time:${input}:${README_CLAIMS_RECURSIVE_SCENARIO}`);
			});
			return check_faster_on_every_row(
				rows.length === 2
					? rows
					: `the file has no ${README_CLAIMS_RECURSIVE_SCENARIO} parse times`,
				others
			);
		}
	},
	{
		sentence:
			"**Allocation:** a parse of valid input allocates fewer heap bytes than Valibot's, plain Zod's, or Zod Mini's on every scenario.",
		others: ['valibot', 'zod', 'zod_mini'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null =>
			check_fewer_bytes_on_every_row(
				to_allocation_groups(results).find((group) => group.key === 'allocation:valid_bytes'),
				'bytes per valid parse',
				others
			)
	},
	{
		sentence:
			'**Cold start:** a bundled entry imports, builds its schema, and parses once, and a hundred times, in less time than any of the libraries compared, on every scenario measured.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null => {
			const rows = to_coldstart_groups(results)
				.filter((group) => group.key.endsWith(':bundled'))
				.flatMap((group) =>
					group.rows.filter(
						(row) =>
							row.key.endsWith(`:${COLDSTART_SUMMARY_STAGE}`) || row.key.endsWith(':parse_100')
					)
				);
			return check_faster_on_every_row(
				rows.length ? rows : 'the file has no cold start of a bundled entry',
				others
			);
		}
	},
	{
		sentence:
			'**Retained memory:** the least held of the libraries compared once a schema is built and has parsed once, on every scenario measured.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null =>
			check_fewer_bytes_on_every_row(
				to_heap_groups(results).find((group) => group.key === 'heap:total'),
				'retained heap',
				others
			)
	},
	{
		sentence:
			"**Type-checking cost:** fewer instantiations than Valibot, Zod as it is imported, compiled Zod, and ArkType, for a module of every scenario and with a consumer's reads of the types it infers.",
		others: ['valibot', 'zod', 'zod_compiled', 'arktype'],
		check: (results: BenchmarkResults, others: ReadonlyArray<string>): string | null => {
			const data = to_section_data(results, 'types');
			if (!data) return 'the file has no type-checking cost';
			return check_least(
				[
					{ name: 'a module of every scenario', libs: data.modules },
					{ name: "the same with a consumer's reads", libs: data.with_reads }
				],
				(cost) => cost.instantiations,
				'instantiations',
				others
			);
		}
	}
];

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The claims a README makes: the bullets of its claims block, each on one
 * line with its whitespace collapsed and without its bullet.
 *
 * @returns the sentences, or null when the README has no Measurements section with a claims block
 */
export const find_readme_claims = (readme: string): Array<string> | null => {
	const section_start = readme.indexOf(`\n${README_SECTION_HEADING}\n`);
	if (section_start === -1) return null;
	const next_section = readme.indexOf('\n## ', section_start + 1);
	const section = readme.slice(section_start, next_section === -1 ? undefined : next_section);
	const open = section.indexOf(README_CLAIMS_OPEN);
	const close = section.indexOf(README_CLAIMS_CLOSE);
	if (open === -1 || close === -1 || close < open) return null;
	const block = section.slice(open + README_CLAIMS_OPEN.length, close);
	return block
		.split(/\n(?=- )/)
		.map((bullet) => normalize(bullet))
		.filter((bullet) => bullet !== '')
		.map((bullet) => bullet.replace(/^- /, ''));
};

/**
 * Holds a README's claims to a results file.
 *
 * @param readme - the README's text
 * @param results - the published results
 * @param claims - the table of claims, `README_CLAIMS` by default
 * @returns what is wrong, a line each: no claims block, a bullet with no row,
 * a row whose sentence is gone, a sentence that states a figure, or a claim
 * the results no longer bear out. None when the README says what the results
 * show.
 */
export const check_readme_claims = (
	readme: string,
	results: BenchmarkResults,
	claims: ReadonlyArray<ReadmeClaim> = README_CLAIMS
): Array<string> => {
	const sentences = find_readme_claims(readme);
	if (sentences === null) {
		return [
			`the README has no \`${README_SECTION_HEADING}\` section with its claims between \`${README_CLAIMS_OPEN}\` and \`${README_CLAIMS_CLOSE}\``
		];
	}
	const problems: Array<string> = [];
	const known = new Map(claims.map((claim) => [normalize(claim.sentence), claim]));
	for (const sentence of sentences) {
		if (!known.has(sentence)) {
			problems.push(`the README claims "${sentence}", and no row of README_CLAIMS holds it`);
		}
		// a claim is a direction: its figures are on the page, rendered from the file
		if (/\d/.test(sentence)) {
			problems.push(`the README's claim "${sentence}" states a figure, which no test holds`);
		}
	}
	for (const [sentence, claim] of known) {
		if (!sentences.includes(sentence)) {
			problems.push(`README_CLAIMS has "${sentence}", and the README no longer says it`);
			continue;
		}
		const failure = claim.check(results, to_claim_others(claim, results));
		if (failure !== null) {
			problems.push(`the results no longer bear out "${sentence}": ${failure}`);
		}
	}
	return problems;
};
