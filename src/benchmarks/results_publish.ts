/**
 * Makes a run the published one: copies its results file to
 * `results/latest.json`, which the site renders, once the file is shown to be
 * publishable.
 *
 * ```bash
 * npm run results:publish -- results/<date>_<machine>.json
 * ```
 *
 * The file must be a run in `results/` itself, followed through any link, so
 * not one under `results/scratch/`, nor elsewhere, nor `latest.json`, must
 * parse as a results file and pass `benchmark_results_is_publishable`, and the
 * commit it records must be one the repository has. The copy is byte for
 * byte, written whole or not at all. Committing it is the publisher's step.
 *
 * These checks are against accident, as publishing a smoke run or the fixture
 * would be, and not against forgery: a file edited by hand to say what a
 * publishable run says passes them.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	RESULTS_DIR_NAME,
	RESULTS_LATEST_FILE_NAME,
	RESULTS_SCRATCH_DIR_NAME
} from './results_plan.ts';
import {
	benchmark_results_is_publishable,
	describe_benchmark_run,
	parse_benchmark_results
} from './results_schema.ts';

const RESULTS_DIR = fileURLToPath(new URL(`../../${RESULTS_DIR_NAME}/`, import.meta.url));

const USAGE = [
	'usage: npm run results:publish -- <results file>',
	'',
	`Copies a publishable run to ${RESULTS_DIR_NAME}/${RESULTS_LATEST_FILE_NAME}, which the site renders.`
].join('\n');

/** Where a run is published, or why it can't be. */
export type PublishResult = { ok: true; path: string } | { ok: false; message: string };

/**
 * Whether the repository a directory is in has a commit, asked of git without
 * its optional locks, so asking writes nothing.
 *
 * @param dir - a directory of the checkout
 * @param commit - a full commit hash
 * @returns false when git has no such commit, or `dir` is in no checkout
 */
export const results_commit_exists = (dir: string, commit: string): boolean => {
	try {
		execFileSync('git', ['--no-optional-locks', 'cat-file', '-e', `${commit}^{commit}`], {
			cwd: dir,
			stdio: 'ignore'
		});
		return true;
	} catch {
		return false;
	}
};

/**
 * Publishes a results file as `latest.json` in the results directory.
 *
 * @param source - the results file
 * @param results_dir - the results directory, for tests
 * @param has_commit - whether the repository has a commit, for tests
 * @returns where it was written, or why it was refused: unreadable,
 * `latest.json` itself, outside the results directory or in its scratch
 * directory, not a results file, not publishable, or of a commit the
 * repository doesn't have
 * @throws Error if the copy can't be written
 */
export const publish_results = (
	source: string,
	results_dir: string = RESULTS_DIR,
	has_commit: (commit: string) => boolean = (commit) => results_commit_exists(results_dir, commit)
): PublishResult => {
	let real: string;
	let bytes: Buffer;
	try {
		// through any link, so a link here can't stand in for a file elsewhere
		real = realpathSync(source);
		bytes = readFileSync(real);
	} catch (error) {
		return { ok: false, message: `can't read ${source}: ${(error as Error).message}` };
	}
	const dir = realpathSync(results_dir);
	if (
		basename(source) === RESULTS_LATEST_FILE_NAME ||
		basename(real) === RESULTS_LATEST_FILE_NAME
	) {
		return {
			ok: false,
			message: `${source} is ${RESULTS_LATEST_FILE_NAME} itself, the published run`
		};
	}
	if (dirname(real) === join(dir, RESULTS_SCRATCH_DIR_NAME)) {
		return {
			ok: false,
			message: `${source} is in ${RESULTS_SCRATCH_DIR_NAME}/, where the runs that are not publishable go, so it is not a run to publish`
		};
	}
	if (dirname(real) !== dir) {
		return {
			ok: false,
			message: `${source} is not in the results directory ${dir}: a published run is one of the runs written there`
		};
	}
	let results;
	try {
		results = parse_benchmark_results(JSON.parse(bytes.toString('utf8')));
	} catch (error) {
		return { ok: false, message: `${source} is not a results file: ${(error as Error).message}` };
	}
	if (!benchmark_results_is_publishable(results)) {
		return {
			ok: false,
			message: `${source} is not a publishable run: ${describe_benchmark_run(results)}`
		};
	}
	if (!has_commit(results.meta.commit)) {
		return {
			ok: false,
			message: `${source} records the commit ${results.meta.commit}, which this repository doesn't have: a published run is of a commit that can be read`
		};
	}
	const target = join(dir, RESULTS_LATEST_FILE_NAME);
	// whole or not at all: a reader never sees half a file
	const temp_path = `${target}.${process.pid}.tmp`;
	try {
		writeFileSync(temp_path, bytes);
		renameSync(temp_path, target);
	} finally {
		rmSync(temp_path, { force: true });
	}
	return { ok: true, path: target };
};

/**
 * The command.
 *
 * @param args - the arguments after the script
 * @param results_dir - the results directory, for tests
 * @param has_commit - whether the repository has a commit, for tests
 * @returns the exit code: 2 when the file is refused
 */
export const main = (
	args: ReadonlyArray<string>,
	results_dir: string = RESULTS_DIR,
	has_commit?: (commit: string) => boolean
): number => {
	if (args[0] === '--help') {
		console.log(USAGE);
		return 0;
	}
	if (args.length !== 1 || args[0]!.startsWith('--')) {
		console.error(USAGE);
		return 2;
	}
	const published = publish_results(args[0]!, results_dir, has_commit);
	if (!published.ok) {
		console.error(published.message);
		return 2;
	}
	const display_path = relative(process.cwd(), published.path);
	console.log(
		`wrote ${display_path.startsWith('..') ? published.path : display_path}: build the site, then commit it with the run`
	);
	return 0;
};

if (import.meta.main) {
	process.exitCode = main(process.argv.slice(2));
}
