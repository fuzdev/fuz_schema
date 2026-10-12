import { test, assert, describe } from 'vitest';
import type { z } from 'zod';

import * as s from '#lib/schema.ts';
import * as repos_status_zod from '../benchmarks/repos_status/repos_status_zod.ts';
import { create_repos_status } from '../benchmarks/repos_status/repos_status_fuz_schema.ts';
import * as package_json_zod from '../benchmarks/package_json/package_json_zod.ts';
import { create_package_json } from '../benchmarks/package_json/package_json_fuz_schema.ts';
import * as bench_results_zod from '../benchmarks/bench_results/bench_results_zod.ts';
import { create_bench_results } from '../benchmarks/bench_results/bench_results_fuz_schema.ts';
import {
	paths_are_within,
	read_benchmark_json,
	to_changed,
	to_paths
} from './harvest_test_helpers.ts';

interface HarvestedDocument {
	name: string;
	value: unknown;
}

interface HarvestedSet {
	name: string;
	/** The consumer's schema, in zod as it has it. */
	theirs: z.ZodType;
	/** The same in this library. */
	ours: s.AnySchema;
	documents: Array<HarvestedDocument>;
	/**
	 * The schemas below a set's unions, whose issues are at the same paths in
	 * both, or `null` to compare the whole schema's more loosely. Both report a
	 * failed `union` as one issue at its path, but zod reports the issues of an
	 * option in its place when that option alone came near, and those are
	 * under the union's path.
	 */
	narrow: ((document: HarvestedDocument) => { theirs: z.ZodType; ours: s.AnySchema }) | null;
	/** Whether to try a document changed, which a very large one is too slow for. */
	change?: (document: HarvestedDocument) => boolean;
	/** Whether a place to change is told from another by its path as well as its keys. */
	change_by_path: boolean;
}

const repos_status = create_repos_status(s);

const sets: Array<HarvestedSet> = [
	{
		name: 'fuz_repos status documents',
		theirs: repos_status_zod.ReposStatusDocument,
		ours: repos_status.ReposStatusDocument,
		documents: read_benchmark_json('repos_status/repos_status_documents.json').documents,
		// the document is a union of a report and an error, each of them without one
		narrow: (document) =>
			document.name.startsWith('error_report')
				? {
						theirs: repos_status_zod.ReposStatusErrorReport,
						ours: repos_status.ReposStatusErrorReport
					}
				: { theirs: repos_status_zod.ReposStatusReport, ours: repos_status.ReposStatusReport },
		// many of its objects are a `kind` and no more
		change_by_path: true
	},
	{
		name: 'fuz_util package.json manifests',
		theirs: package_json_zod.PackageJson,
		ours: create_package_json(s).PackageJson,
		documents: read_benchmark_json('package_json/package_json_manifests.json').manifests,
		// unions all the way down
		narrow: null,
		change_by_path: true
	},
	{
		name: 'syntax-highlighter-bench results documents',
		theirs: bench_results_zod.BenchResults,
		ours: create_bench_results(s).BenchResults,
		documents: read_benchmark_json('bench_results/bench_results_documents.json').documents,
		// unions among its entries
		narrow: null,
		change: (document) => document.name === 'fixture_run',
		// its objects are told apart by their keys, and by path there are too many
		change_by_path: false
	}
];

// zod reports the unknown keys of an object as one issue that lists them,
// where this library reports each at its own path
const to_zod_paths = (issues: ReadonlyArray<z.core.$ZodIssue>): Array<string> =>
	to_paths(
		issues.flatMap((issue) =>
			issue.code === 'unrecognized_keys'
				? issue.keys.map((key) => ({ path: [...issue.path, key] }))
				: [{ path: issue.path }]
		)
	);

describe.each(sets)('$name, in zod and in this library', (set) => {
	const { theirs, ours, documents } = set;

	// the two give the same verdict, the same output when it matches, and when it
	// doesn't and the set allows, issues at the same paths
	const assert_agreement = (
		document: HarvestedDocument,
		value: unknown,
		message: string
	): boolean => {
		const expected = theirs.safeParse(value);
		const result = s.parse(ours, value);
		assert.strictEqual(result.ok, expected.success, message);
		assert.strictEqual(s.is(ours, value), expected.success, message);
		if (result.ok) {
			assert.deepEqual(result.value, expected.data, message);
		} else if (set.narrow) {
			const narrowed = set.narrow(document);
			const narrowed_expected = narrowed.theirs.safeParse(value);
			const narrowed_result = s.parse(narrowed.ours, value);
			assert(!narrowed_expected.success && !narrowed_result.ok, message);
			assert.deepEqual(
				to_paths(narrowed_result.issues),
				to_zod_paths(narrowed_expected.error.issues),
				message
			);
		} else {
			assert(!expected.success, message);
			const paths = to_paths(result.issues);
			const expected_paths = to_zod_paths(expected.error.issues);
			// every issue of zod's is at or under one of ours, and every one of ours has one
			assert(paths_are_within(expected_paths, paths), `${message}: ${expected_paths.join(', ')}`);
			assert(
				paths.every((path) => expected_paths.some((under) => paths_are_within([under], [path]))),
				`${message}: ${paths.join(', ')}`
			);
		}
		return result.ok;
	};

	test('there are documents, each with a name of its own', () => {
		assert(documents.length > 0);
		assert.strictEqual(new Set(documents.map((d) => d.name)).size, documents.length);
	});

	test('both give the same answer for every document, and most match', () => {
		let matched = 0;
		for (const document of documents) {
			if (assert_agreement(document, document.value, document.name)) matched++;
		}
		assert(matched > documents.length / 2);
	});

	test('both give the same answer for every document changed in one place', () => {
		let rejected = 0;
		for (const document of documents) {
			if (set.change && !set.change(document)) continue;
			for (const { label, value } of to_changed(document.value, set.change_by_path)) {
				if (!assert_agreement(document, value, `${document.name}: ${label}`)) rejected++;
			}
		}
		assert(rejected > 0);
	}, 30_000);
});
