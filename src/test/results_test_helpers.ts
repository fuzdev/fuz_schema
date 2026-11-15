import { assert } from 'vitest';

import * as s from '#lib/schema.ts';

import { BenchmarkResults } from '../benchmarks/results_schema.ts';
import { create_fixture_results } from './fixtures/results/fixture_results.ts';

/** A fresh, mutable copy of the fixture: a whole results file of invented numbers, never publishable. */
export const load_fixture = (): BenchmarkResults => structuredClone(create_fixture_results());

/**
 * The fixture's sections under the kind of a full run: what a publishable run
 * looks like, for the tests of what is publishable. No run wrote it.
 */
export const load_full_run = (): BenchmarkResults => {
	const results = load_fixture();
	results.meta.kind = 'full';
	results.meta.machine.name = 'laptop1';
	results.meta.commit = 'a'.repeat(40);
	results.meta.commit_end = 'a'.repeat(40);
	return results;
};

/**
 * Takes a library out of a results file: its entry of the roster, its cell of
 * every per-library record, and its column of the survey. What is left is the
 * file a run without the library writes, as one from before it was entered is.
 *
 * @mutates results - removes every trace of the library
 */
export const remove_lib = (results: BenchmarkResults, id: string): void => {
	results.meta.libs = results.meta.libs.filter((lib) => lib.id !== id);
	const records: Array<Record<string, unknown>> = [];
	const { bundle, types, allocations, heap, coldstart, run, survey } = results;
	if (bundle.status === 'measured') records.push(bundle.data.all);
	if (types.status === 'measured') records.push(types.data.modules, types.data.with_reads);
	for (const section of [bundle, allocations, heap, coldstart, run, survey]) {
		if (section.status === 'measured') records.push(...section.data.rows.map((row) => row.libs));
	}
	for (const record of records) delete record[id];
	if (survey.status === 'measured') {
		survey.data.others = survey.data.others.filter((other) => other !== id);
	}
};

/** The id of this library in its compiled mode, which a file may or may not have. */
export const COMPILED_LIB = 'fuz_schema_compiled';

/**
 * The fixture as a file with no `fuz_schema_compiled` is, as a run that left
 * the mode out writes it: the roster of a file is what the file has.
 */
export const load_fixture_without_compiled = (): BenchmarkResults => {
	const results = load_fixture();
	remove_lib(results, COMPILED_LIB);
	return results;
};

/** The data of a section of the fixture, which measured every one. */
export const to_measured = <TId extends keyof Omit<BenchmarkResults, 'meta'>>(
	results: BenchmarkResults,
	id: TId
): Extract<BenchmarkResults[TId], { status: 'measured' }>['data'] => {
	const section = results[id];
	assert.strictEqual(section.status, 'measured', id);
	return (section as Extract<BenchmarkResults[TId], { status: 'measured' }>).data;
};

/** Asserts that parsing fails with an issue whose path and message together include `expected`. */
export const assert_rejects = (data: unknown, expected: string): void => {
	const parsed = s.parse(BenchmarkResults, data);
	assert.ok(!parsed.ok, 'expected the parse to fail');
	const messages = parsed.issues.map(
		(i) =>
			`${i.path.map(String).join('.')}: ${i.message ?? `expected ${i.expected}, received ${i.received}`}`
	);
	assert.ok(
		messages.some((m) => m.includes(expected)),
		`expected an issue including "${expected}", got:\n${messages.join('\n')}`
	);
};
