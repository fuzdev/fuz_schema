import { assert, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import {
	SITE_FILE_ENV,
	SITE_FIXTURE_ENV,
	SITE_FIXTURE_PATH,
	SITE_LATEST_PATH
} from '#routes/docs/benchmarks/site_benchmarks.server.ts';
import {
	RESULTS_DATA_FLAG,
	RESULTS_DIR_NAME,
	RESULTS_LATEST_FILE_NAME,
	RESULTS_RUN_ARG_NAMES,
	RESULTS_SCRATCH_DIR_NAME,
	RESULTS_STEPS
} from '../benchmarks/results_plan.ts';

// the page states by hand what the scripts and `package.json` define
const page = readFileSync(new URL('../../results/README.md', import.meta.url), 'utf8');
const package_json = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { scripts: Record<string, string> };

test('every npm script the publishing page quotes exists', () => {
	const scripts = [...page.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1]!);
	assert.includeMembers(scripts, ['results', 'results:publish']);
	for (const script of scripts) {
		assert.ok(Object.hasOwn(package_json.scripts, script), `no script "${script}"`);
	}
});

test('the page lists every section of a run beside the npm script that measures it', () => {
	for (const step of RESULTS_STEPS) {
		const command = step.script === 'benchmark' ? 'npm run benchmark' : `npm run ${step.script}`;
		assert.include(page, `| \`${step.id}\` | \`${command}\` |`, step.id);
	}
});

test('every flag the publishing page quotes is one a command takes', () => {
	const known = new Set([
		...RESULTS_RUN_ARG_NAMES.map((name) => `--${name}`),
		RESULTS_DATA_FLAG,
		// of `git status` and `gro build`
		'--short',
		'--no-install'
	]);
	const quoted = [...page.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((match) => match[0]);
	for (const flag of quoted) assert.ok(known.has(flag), `unknown flag ${flag}`);
	// and it explains every flag a run takes
	for (const name of RESULTS_RUN_ARG_NAMES) assert.include(quoted, `--${name}`);
});

test('the page names the files and the switches the site reads', () => {
	assert.strictEqual(SITE_LATEST_PATH, `${RESULTS_DIR_NAME}/${RESULTS_LATEST_FILE_NAME}`);
	for (const name of [RESULTS_LATEST_FILE_NAME, `${RESULTS_SCRATCH_DIR_NAME}/`]) {
		assert.include(page, `\`${name}\``);
	}
	assert.include(page, `${SITE_FIXTURE_ENV}=1`);
	assert.include(page, `${SITE_FILE_ENV}=`);
	assert.include(page, `../${SITE_FIXTURE_PATH}`);
	// every path the page links resolves
	for (const [, path] of page.matchAll(/(?<![\w/`.])(\.\.\/[\w./-]+\w)/g)) {
		assert.ok(existsSync(new URL(`../../results/${path}`, import.meta.url)), path);
	}
});

test('the publishing page publishes through the script, never by hand', () => {
	assert.include(page, `npm run results:publish -- ${RESULTS_DIR_NAME}/`);
	assert.notMatch(page, /\b(cp|mv)\b[^\n]*latest\.json/, 'a hand copy to latest.json');
});

test('the page gives the order of a first publish, where the person publishing reads it', () => {
	const step = page.slice(page.indexOf('**Hold the README to it.**'));
	assert.isAbove(step.length, 0);
	// publish, then the claims block, then the constant, then the check
	const order = [
		'publish the run',
		'paste the claims block',
		'`README_CLAIMS_HELD`',
		'`gro check`'
	];
	const at = order.map((words) => step.indexOf(words));
	assert.ok(
		at.every((index, i) => index !== -1 && (i === 0 || index > at[i - 1]!)),
		`expected ${order.join(', then ')} in that order, found them at ${at.join(', ')}`
	);
	// and the files it names are the ones that hold the claims
	for (const path of ['src/test/readme_claims.ts', 'src/test/readme_measurements.test.ts']) {
		assert.include(step, path);
		assert.ok(existsSync(new URL(`../../${path}`, import.meta.url)), path);
	}
	assert.include(
		readFileSync(new URL('./readme_claims.ts', import.meta.url), 'utf8'),
		'export const README_CLAIMS_HELD'
	);
});

test('the page says what makes a file publishable as the schema decides it', () => {
	for (const words of [
		'`full`',
		'`fixture`',
		'never publishable',
		'as it ended',
		'no other',
		'more than one pass',
		"commit the repository doesn't have",
		'against accident',
		'not against forgery'
	]) {
		assert.include(page.replace(/\s+/g, ' '), words);
	}
});
