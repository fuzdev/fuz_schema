/**
 * The comparative claims the README's Measurements section makes, each the
 * exact sentence the README says and a predicate over a results file that
 * must hold for it to stay. `readme_claims.test.ts` holds the checker to the
 * fixture, and `readme_measurements.test.ts` holds the README itself to the
 * published run, so a sentence can't outlive the numbers it summarizes, and
 * the README carries no hand-copied timed figure. Only those tests read this
 * module: the site renders the file, and makes no claim of its own.
 *
 * In the README the claims are the bullets between a `README_CLAIMS_OPEN` and
 * the `README_CLAIMS_CLOSE` after it, of every such block of the section. A
 * bullet there with no row here fails, and so does a row whose sentence is
 * gone.
 *
 * The claims are like for like. A library either interprets a schema or
 * generates code for one, and this one does either: as it is imported it is
 * set against the libraries that interpret, `README_CLAIMS_INTERPRETERS`, and
 * with each schema compiled against those that generate code,
 * `README_CLAIMS_GENERATORS`. A claim whose `subject` is
 * `README_CLAIMS_COMPILED_SUBJECT` is of the compiled mode, and any other of
 * the library as it is imported. Neither mode is set against the other. Three
 * claims of the library as it is imported hold against every library, whatever
 * it does: its bundle, its cold start, and the memory it holds. The claims
 * come in three blocks: what each mode is ahead on in its tier, and then
 * where either is behind, across the tiers and inside them.
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
 * A close call is not given a direction. Two libraries whose geometric means
 * are within `README_CLAIMS_ABOUT_EQUAL` of each other are called about
 * equal, whichever is ahead and whether or not their bands overlap: a gap
 * that small is one the next run can close or turn round, and a sentence that
 * named the faster would be rewritten at each.
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
	to_harvest_sets,
	to_heap_groups,
	to_section_data,
	to_time_groups,
	type TimeInput
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import type { BenchmarkResults } from '../benchmarks/results_schema.ts';

/**
 * Whether the README's Measurements section carries its claims, and so
 * whether `readme_measurements.test.ts` holds it to the published run. While
 * it is `false` that test holds the README to having no claims block, so the
 * blocks and this can only change together: a README that gains one fails
 * until this is `true`, and from then a missing published run, a README with
 * no block, and a claim the results don't bear out each fail.
 */
export const README_CLAIMS_HELD = true;

/** The heading of the README section the claims are in. */
export const README_SECTION_HEADING = '## Measurements';

/** The line that opens the README's claims: every bullet from it to `README_CLAIMS_CLOSE` is one. */
export const README_CLAIMS_OPEN =
	'<!-- claims: each bullet is held to results/latest.json by src/test/readme_measurements.test.ts -->';

/** The line that closes the README's claims. */
export const README_CLAIMS_CLOSE = '<!-- /claims -->';

/** The library every claim is about, as it is imported, but a claim of its compiled mode. */
export const README_CLAIMS_SUBJECT = 'fuz_schema';

/** The library's compiled mode, the subject of the claims that are not of the library as it is imported. */
export const README_CLAIMS_COMPILED_SUBJECT = 'fuz_schema_compiled';

/**
 * The libraries that interpret a schema, which this library as it is imported
 * is set against. Zod as it is imported is among them, though it generates
 * code for an object schema where it may: it is what an import of it gives.
 */
export const README_CLAIMS_INTERPRETERS: ReadonlyArray<string> = [
	'valibot',
	'valita',
	'zod',
	'zod_mini'
];

/** The libraries that generate code for a schema, which this library's compiled mode is set against. */
export const README_CLAIMS_GENERATORS: ReadonlyArray<string> = ['zod_compiled', 'typebox', 'sury'];

const SUBJECT = README_CLAIMS_SUBJECT;

/**
 * What a claim that names "the libraries compared" is checked against: the
 * other libraries of the roster, this library's own modes left out. A mode of
 * this library, as `fuz_schema_compiled` is, is the entry the roster records
 * with this library's package, which a mode shares with its library: it is
 * this library and not one compared with it, so these claims never set the
 * two modes against each other.
 */
export const README_CLAIMS_EVERY_OTHER = 'every other';

/** A claim the README makes. */
export interface ReadmeClaim {
	/** The sentence, exactly as the README's bullet says it, without the bullet. */
	sentence: string;
	/**
	 * The mode of this library the sentence is of, by id:
	 * `README_CLAIMS_SUBJECT` when absent, the library as it is imported. A
	 * sentence is of one mode, so a file that lacks a mode fails only the
	 * claims of it.
	 */
	subject?: string;
	/**
	 * The libraries the sentence compares this one with, by id, or
	 * `README_CLAIMS_EVERY_OTHER`. The predicate is given exactly these, so a
	 * library the sentence names is one the results are asked about.
	 */
	others: ReadonlyArray<string> | typeof README_CLAIMS_EVERY_OTHER;
	/**
	 * Whether the results bear the sentence out. Called through
	 * `check_readme_claim`, which hands it the claim's own subject, so a
	 * predicate reads the mode from what it is given and can't be of another.
	 *
	 * @param others - the libraries of `others`, by id
	 * @param subject - the mode of this library the sentence is of, by id
	 * @returns null when they do, and otherwise what they show instead
	 */
	check: (
		results: BenchmarkResults,
		others: ReadonlyArray<string>,
		subject: string
	) => string | null;
}

/**
 * The entries of a results file's roster that are this library, in any mode:
 * those of the package the roster records for it. Empty where the roster
 * lacks it.
 */
export const to_subject_modes = (results: BenchmarkResults): Array<string> => {
	const subject = results.meta.libs.find((lib) => lib.id === SUBJECT);
	if (!subject) return [];
	return results.meta.libs.filter((lib) => lib.package === subject.package).map((lib) => lib.id);
};

/**
 * The libraries a claim compares this one with, in a results file: those it
 * names, or for `README_CLAIMS_EVERY_OTHER` every entry of the roster that is
 * not this library in any of its modes.
 */
export const to_claim_others = (claim: ReadmeClaim, results: BenchmarkResults): Array<string> => {
	if (claim.others !== README_CLAIMS_EVERY_OTHER) return [...claim.others];
	const modes = to_subject_modes(results);
	return results.meta.libs
		.map((lib) => lib.id)
		.filter((id) => id !== SUBJECT && !modes.includes(id));
};

/**
 * Checks a claim against a results file, as of the mode the claim is of.
 *
 * @param others - the libraries to ask the results about, the claim's own by default
 * @returns null when the results bear the sentence out, and otherwise what they show instead
 */
export const check_readme_claim = (
	claim: ReadmeClaim,
	results: BenchmarkResults,
	others: ReadonlyArray<string> = to_claim_others(claim, results)
): string | null => claim.check(results, others, claim.subject ?? README_CLAIMS_SUBJECT);

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
const check_row_is_faster = (row: MatrixRow, other: string, subject: string): string | null => {
	const ratio = to_matrix_ratios(row, [subject, other], other)[subject];
	if (ratio === undefined) return `${row.key}: ${subject} and ${other} have no figures to compare`;
	if (ratio.level === 'floor') {
		return `${row.key}: a time of ${subject} or ${other} is at the call floor, so the two are not told apart`;
	}
	if (ratio.level === 'spread') {
		return `${row.key}: ${subject} and ${other} are inside what the two range over`;
	}
	return ratio.ratio < 1 ? null : `${row.key}: ${subject} is not faster than ${other}`;
};

/**
 * Checks that `subject` is faster than each of `others` on every row both
 * have a figure of. A row either has no figure of is not compared, which a
 * sentence held by this must say, and a library with no row to compare fails.
 */
const check_faster_on_every_row = (
	rows: ReadonlyArray<MatrixRow> | string,
	others: ReadonlyArray<string>,
	subject: string
): string | null => {
	if (typeof rows === 'string') return rows;
	for (const other of others) {
		let compared = 0;
		for (const row of rows) {
			if (
				matrix_row_entry(row, subject).kind !== 'value' ||
				matrix_row_entry(row, other).kind !== 'value'
			) {
				continue;
			}
			compared++;
			const failure = check_row_is_faster(row, other, subject);
			if (failure !== null) return failure;
		}
		if (!compared) return `no row has a figure of both ${subject} and ${other}`;
	}
	return null;
};

// the geometric means of two libraries' times over the rows of an input both have a
// figure of and neither has at the call floor, or what the file lacks
const to_geomeans = (
	results: BenchmarkResults,
	input: TimeInput,
	other: string,
	subject: string
): { level: boolean; ours: number; theirs: number; ratio: string } | string => {
	const rows = to_time_rows(results, input);
	if (typeof rows === 'string') return rows;
	const columns = [subject, other];
	const mean = to_geomean_row(rows, columns, `claim:${input}:${other}`, 'every scenario');
	const ours = mean && matrix_row_entry(mean, subject);
	const theirs = mean && matrix_row_entry(mean, other);
	if (!mean || mean.empty !== null || ours?.kind !== 'value' || theirs?.kind !== 'value') {
		return `no ${input} row has a figure of both ${subject} and ${other} past the call floor`;
	}
	return {
		level: matrix_values_are_level(ours, theirs),
		ours: ours.value,
		theirs: theirs.value,
		ratio: (ours.value / theirs.value).toFixed(2)
	};
};

/**
 * Checks which way the geometric means of this library's time and another's
 * run, over the rows of an input both have a figure of and neither has at the
 * call floor. The two must differ: means whose bands overlap bear out neither
 * direction.
 *
 * @param faster - whether `subject` is claimed to be the faster of the two
 * @param subject - the mode of this library the claim is of
 */
const check_geomean = (
	results: BenchmarkResults,
	input: TimeInput,
	other: string,
	faster: boolean,
	subject: string
): string | null => {
	const means = to_geomeans(results, input, other, subject);
	if (typeof means === 'string') return means;
	if (means.level) {
		return `on ${input} rows the geometric means of ${subject} and ${other} are inside each other's bands, at ${means.ratio} times: neither is the faster`;
	}
	return means.ours < means.theirs === faster
		? null
		: `on ${input} rows ${subject} takes ${means.ratio} times what ${other} does, as a geometric mean`;
};

/**
 * How far apart two geometric means may be and still be called about equal:
 * the greater at most this many times the lesser.
 */
export const README_CLAIMS_ABOUT_EQUAL = 1.25;

/**
 * Checks that the geometric means of two libraries' times are about equal,
 * the greater within `README_CLAIMS_ABOUT_EQUAL` of the lesser, whichever it
 * is: what a sentence says of a close call, in place of a direction.
 */
const check_geomean_is_about_equal = (
	results: BenchmarkResults,
	input: TimeInput,
	other: string,
	subject: string
): string | null => {
	const means = to_geomeans(results, input, other, subject);
	if (typeof means === 'string') return means;
	return Math.max(means.ours / means.theirs, means.theirs / means.ours) <= README_CLAIMS_ABOUT_EQUAL
		? null
		: `on ${input} rows ${subject} takes ${means.ratio} times what ${other} does, as a geometric mean: the two are not about equal`;
};

/**
 * Checks that `subject`'s bytes are under each of `others`' on every row
 * of a group, by more than what the two figures range over, the tolerance the
 * page gives the group's figures. A zero is a figure here: a parse that
 * allocates nothing allocates less than one that allocates.
 */
const check_fewer_bytes_on_every_row = (
	group: MatrixGroup | undefined,
	what: string,
	others: ReadonlyArray<string>,
	subject: string
): string | null => {
	if (!group?.rows.length) return `the file has no rows of ${what}`;
	if (!others.length) return `no library to compare ${what} with`;
	for (const row of group.rows) {
		const ours = matrix_row_entry(row, subject);
		if (ours.kind !== 'value') return `${row.key}: ${subject} has no ${what}`;
		for (const other of others) {
			const theirs = matrix_row_entry(row, other);
			if (theirs.kind !== 'value') return `${row.key}: ${other} has no ${what}`;
			if (matrix_values_are_level(ours, theirs)) {
				return `${row.key}: ${subject}'s ${what} and ${other}'s are inside what the two range over`;
			}
			if (!(ours.value < theirs.value)) {
				return `${row.key}: ${subject}'s ${what} is not under ${other}'s`;
			}
		}
	}
	return null;
};

const first_failure = (checks: ReadonlyArray<string | null>): string | null =>
	checks.find((check) => check !== null) ?? null;

/**
 * Checks that `subject`'s figure is the least of every row's, against
 * each of `others`. The figures are exact: bytes, or instantiations.
 */
const check_least = <T>(
	rows: ReadonlyArray<{ name: string; libs: Readonly<Record<string, T>> }>,
	to_value: (figures: T) => number,
	what: string,
	others: ReadonlyArray<string>,
	subject: string
): string | null => {
	if (!rows.length) return `the file has no rows of ${what}`;
	if (!others.length) return `no library to compare ${what} with`;
	for (const row of rows) {
		const ours = row.libs[subject];
		if (!ours) return `${row.name}: ${subject} has no ${what}`;
		for (const other of others) {
			const theirs = row.libs[other];
			if (!theirs) return `${row.name}: ${other} has no ${what}`;
			if (!(to_value(ours) < to_value(theirs))) {
				return `${row.name}: ${subject}'s ${what} is not under ${other}'s`;
			}
		}
	}
	return null;
};

/** The scenario the claim about the one real recursive schema is of. */
export const README_CLAIMS_RECURSIVE_SCENARIO = 'type_json';

/**
 * The libraries the compiled mode's claim of allocation holds of invalid
 * input too, where it holds of the rest on valid input alone.
 */
export const README_CLAIMS_COMPILED_FEWER_BYTES_ON_INVALID: ReadonlyArray<string> = [
	'zod_compiled'
];

/**
 * The libraries the claim of what compiling costs says reach a parse sooner
 * than the compiled mode, on every row of a cold start, beside having the
 * smaller bundle and holding less.
 */
export const README_CLAIMS_COMPILED_STARTS_SLOWER_THAN: ReadonlyArray<string> = ['valita'];

/** The forms of entry the cold start claims are of, as a row of the file names them. */
export const README_CLAIMS_COLDSTART_FORMS: ReadonlyArray<string> = ['bundled', 'unbundled'];

/**
 * Checks that another library is the faster on at least one row, by the rule a
 * table marks a difference by: the half of a claim that a mean is not every row.
 */
const check_other_faster_on_some_row = (
	rows: ReadonlyArray<MatrixRow> | string,
	other: string,
	subject: string
): string | null => {
	if (typeof rows === 'string') return rows;
	for (const row of rows) {
		const ratio = to_matrix_ratios(row, [subject, other], other)[subject];
		if (
			ratio !== undefined &&
			ratio.level !== 'floor' &&
			ratio.level !== 'spread' &&
			ratio.ratio > 1
		) {
			return null;
		}
	}
	return `no row has ${other} faster than ${subject}`;
};

// the gzipped bundles of every scenario and of all of them together, as rows
const to_bundle_rows = (
	results: BenchmarkResults
): Array<{ name: string; libs: Readonly<Record<string, { gzip: number }>> }> | string => {
	const data = to_section_data(results, 'bundle');
	if (!data) return 'the file has no bundle sizes';
	return [
		...data.rows.map((row) => ({ name: row.scenario, libs: row.libs })),
		{ name: 'every scenario together', libs: data.all }
	];
};

// the rows of a cold start a claim reads, of both forms of entry: a first parse and a hundredth
const to_coldstart_rows = (results: BenchmarkResults): Array<MatrixRow> | string => {
	const groups = to_coldstart_groups(results);
	// both forms, which a sentence names: a file with one of them bears out half
	for (const form of README_CLAIMS_COLDSTART_FORMS) {
		if (!groups.some((group) => group.key.endsWith(`:${form}`))) {
			return `the file has no cold start of an entry that is ${form}`;
		}
	}
	return groups.flatMap((group) =>
		group.rows.filter(
			(row) => row.key.endsWith(`:${COLDSTART_SUMMARY_STAGE}`) || row.key.endsWith(':parse_100')
		)
	);
};

const to_allocation_group = (results: BenchmarkResults, key: string): MatrixGroup | undefined =>
	to_allocation_groups(results).find((g) => g.key === key);

const to_held_group = (results: BenchmarkResults): MatrixGroup | undefined =>
	to_heap_groups(results).find((group) => group.key === 'heap:total');

/**
 * Checks that another library's bytes are under this library's on at least one
 * row of a group, by more than what the two figures range over: the half of
 * an allocation claim that names who allocates less somewhere.
 */
const check_other_fewer_bytes_on_some_row = (
	group: MatrixGroup | undefined,
	what: string,
	other: string,
	subject: string
): string | null => {
	if (!group?.rows.length) return `the file has no rows of ${what}`;
	for (const row of group.rows) {
		const ours = matrix_row_entry(row, subject);
		const theirs = matrix_row_entry(row, other);
		if (
			ours.kind === 'value' &&
			theirs.kind === 'value' &&
			!matrix_values_are_level(ours, theirs) &&
			theirs.value < ours.value
		) {
			return null;
		}
	}
	return `no row has ${other}'s ${what} under ${subject}'s`;
};

/**
 * Checks what a claim says a mode costs: each of `cheaper` has a smaller
 * gzipped bundle than `subject`, of every scenario and of all of them
 * together, and holds less memory on every row, past what the two figures
 * range over, and each of `sooner` reaches a first parse and a hundredth in
 * less time, in both forms of entry.
 */
const check_costs = (
	results: BenchmarkResults,
	cheaper: ReadonlyArray<string>,
	sooner: ReadonlyArray<string>,
	subject: string
): string | null => {
	const bundles = to_bundle_rows(results);
	if (typeof bundles === 'string') return bundles;
	const held = to_held_group(results);
	if (!held?.rows.length) return 'the file has no rows of retained heap';
	for (const other of cheaper) {
		for (const row of bundles) {
			const ours = row.libs[subject];
			const theirs = row.libs[other];
			if (!ours || !theirs) return `${row.name}: ${subject} or ${other} has no gzipped bundle`;
			if (!(theirs.gzip < ours.gzip)) {
				return `${row.name}: ${other}'s gzipped bundle is not under ${subject}'s`;
			}
		}
		for (const row of held.rows) {
			const ours = matrix_row_entry(row, subject);
			const theirs = matrix_row_entry(row, other);
			if (ours.kind !== 'value' || theirs.kind !== 'value') {
				return `${row.key}: ${subject} or ${other} has no retained heap`;
			}
			if (matrix_values_are_level(ours, theirs) || !(theirs.value < ours.value)) {
				return `${row.key}: ${other}'s retained heap is not under ${subject}'s`;
			}
		}
	}
	// the other way round: the library named is the faster of the two on every row
	return first_failure(
		sooner.map((other) => check_faster_on_every_row(to_coldstart_rows(results), [subject], other))
	);
};

/**
 * Checks the claim of a consumer's schemas, a harvested set whose consumer
 * wrote them in `other`: this library's gzipped bundle is the smaller, it is
 * the faster as a geometric mean over the set's documents, and a parse
 * allocates fewer heap bytes on every one. The sentence names one consumer, so
 * a file with no such set, or with more than one, fails.
 */
const check_harvest_set = (
	results: BenchmarkResults,
	other: string,
	subject: string
): string | null => {
	const names = (to_section_data(results, 'harvest')?.sets ?? [])
		.filter((set) => set.reference === other)
		.map((set) => set.name);
	if (names.length !== 1) {
		return `the file has ${names.length} harvested sets written in ${other}, and the sentence is of one`;
	}
	const view = to_harvest_sets(results).find((set) => set.name === names[0])!;
	const to_group = (id: string): MatrixGroup | undefined => {
		const group = view.groups.find((g) => g.key === `harvest:${view.name}:${id}`);
		return group && { ...group, rows: group.rows.filter((row) => row.kind !== 'summary') };
	};
	const bundle = view.groups
		.find((g) => g.key === `harvest:${view.name}:bundle`)
		?.rows.find((row) => row.kind === 'summary');
	const ours_bundle = bundle && matrix_row_entry(bundle, subject);
	const theirs_bundle = bundle && matrix_row_entry(bundle, other);
	if (ours_bundle?.kind !== 'value' || theirs_bundle?.kind !== 'value') {
		return `${view.name}: ${subject} or ${other} has no gzipped bundle`;
	}
	if (!(ours_bundle.value < theirs_bundle.value)) {
		return `${view.name}: ${subject}'s gzipped bundle is not under ${other}'s`;
	}
	const times = to_group('time');
	const mean =
		times && to_geomean_row(times.rows, [subject, other], `claim:${view.name}:time`, 'every row');
	const ours = mean && matrix_row_entry(mean, subject);
	const theirs = mean && matrix_row_entry(mean, other);
	if (!mean || mean.empty !== null || ours?.kind !== 'value' || theirs?.kind !== 'value') {
		return `${view.name}: no document has a time of both ${subject} and ${other}`;
	}
	if (matrix_values_are_level(ours, theirs) || !(ours.value < theirs.value)) {
		return `${view.name}: ${subject} is not faster than ${other} as a geometric mean`;
	}
	return check_fewer_bytes_on_every_row(
		to_group('bytes'),
		`bytes per parse of ${view.name}`,
		[other],
		subject
	);
};

/**
 * Checks what a sentence says of a library whose module only builds its
 * schemas: fewer instantiations than this library's for that module, and more
 * once the types are inferred, a consumer's reads of them counted or not.
 */
const check_fewer_instantiations_uninferred = (
	results: BenchmarkResults,
	other: string,
	subject: string
): string | null => {
	const data = to_section_data(results, 'types');
	if (!data) return 'the file has no type-checking cost';
	const ours = data.modules[subject];
	const theirs = data.modules[other];
	if (!ours || !theirs) return `a module of every scenario: ${other} has no instantiations`;
	if (!(theirs.instantiations < ours.instantiations)) {
		return `a module of every scenario: ${other}'s instantiations are not under ${subject}'s`;
	}
	// the same file before its reads: what inferring the types costs alone
	const inferred = Object.fromEntries(
		Object.entries(data.with_reads).map(([lib, cost]) => [
			lib,
			{ ...cost, instantiations: cost.instantiations - cost.reads_add }
		])
	);
	return check_least(
		[
			{ name: 'the types inferred and read', libs: data.with_reads },
			{ name: 'the types inferred and not read', libs: inferred }
		],
		(cost) => cost.instantiations,
		'instantiations',
		[other],
		subject
	);
};

const COMPILED = README_CLAIMS_COMPILED_SUBJECT;

type Check = ReadmeClaim['check'];

// a claim of one input's times: `subject` the faster of each pair as a geometric mean
const faster_as_a_mean =
	(input: TimeInput): Check =>
	(results, others, subject) =>
		first_failure(others.map((other) => check_geomean(results, input, other, true, subject)));

// a claim of type-checking cost: `subject` has the fewest instantiations, for a module
// that builds its schemas and for a file that reads the types they infer
const fewer_instantiations: Check = (results, others, subject) => {
	const data = to_section_data(results, 'types');
	if (!data) return 'the file has no type-checking cost';
	return check_least(
		[
			{ name: 'a module of every scenario', libs: data.modules },
			{ name: "the same with a consumer's reads", libs: data.with_reads }
		],
		(cost) => cost.instantiations,
		'instantiations',
		others,
		subject
	);
};

// a claim of close calls: `subject` and each other about equal on each of the inputs
const about_equal =
	(inputs: ReadonlyArray<TimeInput>): Check =>
	(results, others, subject) =>
		first_failure(
			others.flatMap((other) =>
				inputs.map((input) => check_geomean_is_about_equal(results, input, other, subject))
			)
		);

/**
 * The claims, in the order the README makes them: what the library is ahead
 * on as it is imported, what its compiled mode is ahead on, and where either
 * is behind. Each sentence states a direction, or that two are about equal,
 * and no figure: the numbers are on the benchmarks page, rendered from the
 * same file.
 */
export const README_CLAIMS: ReadonlyArray<ReadmeClaim> = [
	// as it is imported
	{
		sentence:
			'**Size:** the smallest bundle of the libraries compared, minified and gzipped, for every scenario and for all of them together.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (
			results: BenchmarkResults,
			others: ReadonlyArray<string>,
			subject: string
		): string | null => {
			const rows = to_bundle_rows(results);
			return typeof rows === 'string'
				? rows
				: check_least(rows, (sizes) => sizes.gzip, 'gzipped bundle', others, subject);
		}
	},
	{
		sentence:
			'**Cold start:** an entry, bundled or importing the package, imports, builds its schema, and parses once, and a hundred times, in less time than any of the libraries compared, on every scenario measured.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (results, others, subject) =>
			check_faster_on_every_row(to_coldstart_rows(results), others, subject)
	},
	{
		sentence:
			'**Retained memory:** the least held of the libraries compared once a schema is built and has parsed once, on every scenario measured.',
		others: README_CLAIMS_EVERY_OTHER,
		check: (results, others, subject) =>
			check_fewer_bytes_on_every_row(to_held_group(results), 'retained heap', others, subject)
	},
	{
		sentence:
			'**On valid input:** faster than Valibot, Zod, and Zod Mini as a geometric mean over the scenarios.',
		others: ['valibot', 'zod', 'zod_mini'],
		check: faster_as_a_mean('valid')
	},
	{
		sentence:
			'**As a guard,** where a library only answers whether a valid input matches: faster than Valibot, Zod, and Zod Mini as a geometric mean over the scenarios.',
		others: ['valibot', 'zod', 'zod_mini'],
		check: faster_as_a_mean('guard')
	},
	{
		sentence: '**On invalid input:** faster than Valibot, Zod, and Zod Mini on every scenario.',
		others: ['valibot', 'zod', 'zod_mini'],
		check: (results, others, subject) =>
			check_faster_on_every_row(to_time_rows(results, 'invalid'), others, subject)
	},
	{
		sentence:
			'**Against Valita:** about equal on valid input, on invalid input, and as a guard, as geometric means over the scenarios.',
		others: ['valita'],
		check: about_equal(['valid', 'invalid', 'guard'])
	},
	{
		sentence:
			"**Allocation:** a parse allocates fewer heap bytes than Valibot's, Zod's, or Zod Mini's on every scenario, of valid input and of invalid.",
		others: ['valibot', 'zod', 'zod_mini'],
		check: (results, others, subject) =>
			first_failure([
				check_fewer_bytes_on_every_row(
					to_allocation_group(results, 'allocation:valid_bytes'),
					'bytes per valid parse',
					others,
					subject
				),
				check_fewer_bytes_on_every_row(
					to_allocation_group(results, 'allocation:invalid_bytes'),
					'bytes per invalid parse',
					others,
					subject
				)
			])
	},
	{
		sentence:
			"**Type-checking cost:** fewer instantiations than Valibot, Valita, Zod, and Zod Mini, for a module of every scenario, and for a file of a consumer's reads of the types its schemas infer.",
		others: README_CLAIMS_INTERPRETERS,
		check: fewer_instantiations
	},
	{
		sentence:
			'**On the recursive scenario,** `type_json`, a real schema: faster on valid input and as a guard than Valibot, Zod, Zod Mini, and TypeBox.',
		others: ['valibot', 'zod', 'zod_mini', 'typebox'],
		check: (
			results: BenchmarkResults,
			others: ReadonlyArray<string>,
			subject: string
		): string | null => {
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
				others,
				subject
			);
		}
	},
	{
		sentence:
			"**On a consumer's schemas,** svelte-docinfo's, as it wrote them in Valibot and written again in this library: a smaller bundle, faster as a geometric mean over its documents, and fewer heap bytes a parse on every one.",
		others: ['valibot'],
		check: (results, others, subject) =>
			first_failure(others.map((other) => check_harvest_set(results, other, subject)))
	},
	// compiled
	{
		sentence:
			"**Compiled size, cold start, and memory:** a smaller bundle than compiled Zod's, TypeBox's, or Sury's, a quicker cold start, bundled or importing the package, to a first parse and to a hundredth, and less memory held, on every scenario measured.",
		subject: COMPILED,
		others: README_CLAIMS_GENERATORS,
		check: (
			results: BenchmarkResults,
			others: ReadonlyArray<string>,
			subject: string
		): string | null => {
			const bundles = to_bundle_rows(results);
			return first_failure([
				typeof bundles === 'string'
					? bundles
					: check_least(bundles, (sizes) => sizes.gzip, 'gzipped bundle', others, subject),
				check_faster_on_every_row(to_coldstart_rows(results), others, subject),
				check_fewer_bytes_on_every_row(to_held_group(results), 'retained heap', others, subject)
			]);
		}
	},
	{
		sentence:
			'**Compiled on valid input:** faster than compiled Zod and TypeBox as a geometric mean over the scenarios each has a figure of.',
		subject: COMPILED,
		others: ['zod_compiled', 'typebox'],
		check: faster_as_a_mean('valid')
	},
	{
		sentence:
			'**Compiled as a guard:** faster than compiled Zod and TypeBox as a geometric mean over the scenarios each has a figure of.',
		subject: COMPILED,
		others: ['zod_compiled', 'typebox'],
		check: faster_as_a_mean('guard')
	},
	{
		sentence:
			'**Compiled on invalid input:** faster than compiled Zod on every scenario it has a figure of.',
		subject: COMPILED,
		others: ['zod_compiled'],
		check: (results, others, subject) =>
			check_faster_on_every_row(to_time_rows(results, 'invalid'), others, subject)
	},
	{
		sentence:
			'**Compiled against Sury:** about equal on valid input and as a guard, as geometric means over the scenarios, and faster on invalid input.',
		subject: COMPILED,
		others: ['sury'],
		check: (results, others, subject) =>
			first_failure([
				about_equal(['valid', 'guard'])(results, others, subject),
				faster_as_a_mean('invalid')(results, others, subject)
			])
	},
	{
		sentence:
			"**Compiled allocation:** a parse of valid input allocates fewer heap bytes than compiled Zod's or Sury's on every scenario, and a parse of invalid input fewer than compiled Zod's on every scenario.",
		subject: COMPILED,
		others: ['zod_compiled', 'sury'],
		check: (results, others, subject) =>
			first_failure([
				check_fewer_bytes_on_every_row(
					to_allocation_group(results, 'allocation:valid_bytes'),
					'bytes per valid parse',
					others,
					subject
				),
				check_fewer_bytes_on_every_row(
					to_allocation_group(results, 'allocation:invalid_bytes'),
					'bytes per invalid parse',
					others.filter((other) => README_CLAIMS_COMPILED_FEWER_BYTES_ON_INVALID.includes(other)),
					subject
				)
			])
	},
	{
		sentence:
			"**Compiled type-checking cost:** fewer instantiations than compiled Zod and Sury, for a module of every scenario, and for a file of a consumer's reads of the types its schemas infer.",
		subject: COMPILED,
		others: ['zod_compiled', 'sury'],
		check: fewer_instantiations
	},
	{
		sentence:
			'**Compiled across the tiers:** faster on valid input and as a guard than Valibot, Valita, Zod, and Zod Mini too, as a geometric mean over the scenarios.',
		subject: COMPILED,
		others: README_CLAIMS_INTERPRETERS,
		check: (results, others, subject) =>
			first_failure([
				faster_as_a_mean('valid')(results, others, subject),
				faster_as_a_mean('guard')(results, others, subject)
			])
	},
	// where it is behind
	{
		sentence:
			'**Across the tiers:** compiled Zod, TypeBox, and Sury each check valid input and answer a guard faster than this library as it is imported, as a geometric mean over the scenarios each has a figure of.',
		others: README_CLAIMS_GENERATORS,
		check: (results, others, subject) =>
			first_failure(
				others.flatMap((other) => [
					check_geomean(results, 'valid', other, false, subject),
					check_geomean(results, 'guard', other, false, subject)
				])
			)
	},
	{
		sentence:
			"**What compiling costs:** compiled, its bundle is larger than Valibot's and Valita's and it holds more memory than either, on every scenario measured, and it reaches a first parse and a hundredth later than Valita, bundled or importing the package.",
		subject: COMPILED,
		others: ['valibot', 'valita'],
		check: (results, others, subject) =>
			check_costs(
				results,
				others,
				others.filter((other) => README_CLAIMS_COMPILED_STARTS_SLOWER_THAN.includes(other)),
				subject
			)
	},
	{
		sentence:
			'**Valita** allocates fewer heap bytes than a parse of this library on every scenario of invalid input, and on at least one of valid input.',
		others: ['valita'],
		check: (results, others, subject) =>
			first_failure(
				others.flatMap((other) => [
					// the other way round: the library named is the one under this one on every row
					check_fewer_bytes_on_every_row(
						to_allocation_group(results, 'allocation:invalid_bytes'),
						'bytes per invalid parse',
						[subject],
						other
					),
					check_other_fewer_bytes_on_some_row(
						to_allocation_group(results, 'allocation:valid_bytes'),
						'bytes per valid parse',
						other,
						subject
					)
				])
			)
	},
	{
		sentence:
			'**Zod and Valita** are each faster than this library as it is imported on at least one scenario of valid input, and on at least one as a guard.',
		others: ['zod', 'valita'],
		check: (results, others, subject) =>
			first_failure(
				others.flatMap((other) =>
					(['valid', 'guard'] as const).map((input) =>
						check_other_faster_on_some_row(to_time_rows(results, input), other, subject)
					)
				)
			)
	},
	{
		sentence:
			'**TypeBox,** whose check stops at the first failure and builds no output and no issues, refuses invalid input faster than this library as it is imported, as a geometric mean.',
		others: ['typebox'],
		check: (results, others, subject) =>
			first_failure(others.map((other) => check_geomean(results, 'invalid', other, false, subject)))
	},
	{
		sentence:
			'**TypeBox against the compiled mode** refuses invalid input faster too, as a geometric mean, and is faster on at least one scenario of valid input.',
		subject: COMPILED,
		others: ['typebox'],
		check: (results, others, subject) =>
			first_failure(
				others.flatMap((other) => [
					check_geomean(results, 'invalid', other, false, subject),
					check_other_faster_on_some_row(to_time_rows(results, 'valid'), other, subject)
				])
			)
	},
	{
		sentence:
			"**TypeBox's check allocates** fewer heap bytes than a parse of this library on at least one scenario of each input, and TypeBox has fewer instantiations for a module, which infers nothing, though more once the types are inferred, read or not.",
		others: ['typebox'],
		check: (results, others, subject) =>
			first_failure(
				others.flatMap((other) => [
					check_other_fewer_bytes_on_some_row(
						to_allocation_group(results, 'allocation:valid_bytes'),
						'bytes per valid parse',
						other,
						subject
					),
					check_other_fewer_bytes_on_some_row(
						to_allocation_group(results, 'allocation:invalid_bytes'),
						'bytes per invalid parse',
						other,
						subject
					),
					check_fewer_instantiations_uninferred(results, other, subject)
				])
			)
	}
];

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The claims a README makes: the bullets of the claims blocks of its
 * Measurements section, in order, each on one line with its whitespace
 * collapsed and without its bullet. What is between two blocks is no claim.
 *
 * @returns the sentences, or null when the README has no Measurements section with a claims block
 */
export const find_readme_claims = (readme: string): Array<string> | null => {
	const section_start = readme.indexOf(`\n${README_SECTION_HEADING}\n`);
	if (section_start === -1) return null;
	const next_section = readme.indexOf('\n## ', section_start + 1);
	const section = readme.slice(section_start, next_section === -1 ? undefined : next_section);
	const sentences: Array<string> = [];
	let from = 0;
	for (;;) {
		const open = section.indexOf(README_CLAIMS_OPEN, from);
		const close = open === -1 ? -1 : section.indexOf(README_CLAIMS_CLOSE, open);
		if (close === -1) break;
		const block = section.slice(open + README_CLAIMS_OPEN.length, close);
		sentences.push(
			...block
				.split(/\n(?=- )/)
				.map((bullet) => normalize(bullet))
				.filter((bullet) => bullet !== '')
				.map((bullet) => bullet.replace(/^- /, ''))
		);
		from = close + README_CLAIMS_CLOSE.length;
	}
	return from ? sentences : null;
};

/**
 * Holds a README's claims to a results file.
 *
 * @param readme - the README's text
 * @param results - the published results
 * @param claims - the table of claims, `README_CLAIMS` by default
 * @returns what is wrong, a line each: no claims block, a bullet with no row,
 * a row whose sentence is gone, a sentence that states a figure, a claim the
 * results no longer bear out, or a library of the roster that is in neither
 * tier or in both, which no claim is then like for like with. None when the
 * README says what the results show.
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
	const modes = to_subject_modes(results);
	for (const lib of results.meta.libs.map((entry) => entry.id)) {
		if (modes.includes(lib)) continue;
		const tiers =
			Number(README_CLAIMS_INTERPRETERS.includes(lib)) +
			Number(README_CLAIMS_GENERATORS.includes(lib));
		if (tiers !== 1) {
			problems.push(
				`the results compare ${lib}, which is in ${tiers ? 'both tiers' : 'neither tier'} of the claims: a library interprets a schema or generates code for one`
			);
		}
	}
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
		const failure = check_readme_claim(claim, results);
		if (failure !== null) {
			problems.push(`the results no longer bear out "${sentence}": ${failure}`);
		}
	}
	return problems;
};
