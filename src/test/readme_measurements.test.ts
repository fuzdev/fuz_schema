import { assert, describe, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	README_CLAIMS_HELD,
	README_CLAIMS_OPEN,
	check_readme_claims,
	find_readme_claims
} from './readme_claims.ts';
import { SITE_LATEST_PATH } from '#routes/docs/benchmarks/site_benchmarks.server.ts';
import { parse_benchmark_results } from '../benchmarks/results_schema.ts';

// The gate on the README's Measurements section: each claim it makes is held to
// the published run. Two switches read another file in place of each, to try
// the gate on a README or a run that is not the repository's: with
// `README_CLAIMS_README` it reads that README, and holds it as though
// `README_CLAIMS_HELD` were set, and with `README_CLAIMS_RESULTS` that
// results file, which need not be published.
const README_PATH_ENV = 'README_CLAIMS_README';
const RESULTS_PATH_ENV = 'README_CLAIMS_RESULTS';

const readme_path = resolve(process.env[README_PATH_ENV] ?? 'README.md');
const results_path = resolve(process.env[RESULTS_PATH_ENV] ?? SITE_LATEST_PATH);
const held = README_CLAIMS_HELD || process.env[README_PATH_ENV] !== undefined;

const readme = readFileSync(readme_path, 'utf8');

// one of the two is defined, and never one skipped: which is the state `README_CLAIMS_HELD` names
if (held) {
	describe("the README's Measurements section", () => {
		test('a run is published for its claims to be held to', () => {
			assert.ok(
				existsSync(results_path),
				`${results_path} is missing, so nothing holds the README's claims: publish a run, as results/README.md says (\`npm run results -- --machine <name>\`, then \`npm run results:publish -- results/<file>.json\`)`
			);
		});

		test('every claim it makes has a row, every row its sentence, and the published run bears each out', () => {
			const results = parse_benchmark_results(JSON.parse(readFileSync(results_path, 'utf8')));
			assert.deepStrictEqual(check_readme_claims(readme, results), []);
		});
	});
} else {
	test('while the README makes no claims, it has no claims block, which nothing would hold', () => {
		assert.strictEqual(
			find_readme_claims(readme),
			null,
			`README.md has a claims block (\`${README_CLAIMS_OPEN}\`): set README_CLAIMS_HELD in src/test/readme_claims.ts, so each claim is held to ${SITE_LATEST_PATH}`
		);
	});
}
