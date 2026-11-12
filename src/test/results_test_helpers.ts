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
