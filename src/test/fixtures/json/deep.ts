/**
 * `npm run fixtures:deep`: the generated JSON fixtures of `json_generate.ts`
 * at a depth for review, outside `gro check` and the repo. Writes each
 * generated group's `expected.json` under `--dir` and runs the Rust crate's
 * fixture tests over them and the committed groups, through
 * `FUZ_SCHEMA_FIXTURES_DIR`. Exits nonzero when the oracle throws on a group
 * or the tests fail, which print each failing case by its group and name: the
 * group's `expected.json` holds the schema and the text.
 *
 * The directory is the script's only when it holds `DEEP_MARKER`, which it
 * writes there: it refuses one that is not empty without it, and clears only
 * the groups of an earlier run, never the directory itself.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import * as s from '#lib/schema.ts';
import { GENERATED_JSON_CASES, generate_random_json_fixture } from './json_generate.ts';
import { format_json_fixture, generate_json_fixture } from './json_test_helpers.ts';

// each seed checked after the one is made a list, so the issue names it and not the union
const Seeds = s.pipe(
	s.union([s.number, s.array(s.number)]),
	s.transform((v: number | Array<number>) => (Array.isArray(v) ? v : [v])),
	s.array(s.pipe(s.number, s.safe_integer))
);

const Count = s.pipe(s.number, s.safe_integer, s.min_value(1));

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	seed: s.optional(Seeds),
	count: s.with_default(Count, 50),
	cases: s.with_default(Count, GENERATED_JSON_CASES),
	dir: s.with_default(
		s.pipe(s.string, s.min_length(1)),
		join(homedir(), '.cache/fuz_schema/fixtures_deep')
	)
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.ok) {
	console.error(parsed.issues.map(s.format_issue).join('\n'));
	console.error(
		'\nusage: npm run fixtures:deep -- [--seed n]... [--count n] [--cases n] [--dir path]\n' +
			'(a negative seed is --seed=-n)'
	);
	process.exit(1);
}
const args = parsed.value;

/** The file that marks a directory as this script's, so it is cleared only then. */
const DEEP_MARKER = '.fuz_schema_fixtures_deep';

/** A group's name, `s<seed>_<index>`: what is cleared of a marked directory. */
const GROUP_NAME = /^s-?\d+_\d+$/;

/** Refuses `dir` with why, without a stack, and exits. */
const fail_dir = (dir: string, reason: string): never => {
	console.error(`--dir ${dir}: ${reason}`);
	process.exit(1);
};

/** Makes `dir` this script's and empty of groups, or refuses it. */
const prepare_dir = async (dir: string): Promise<void> => {
	let names: Array<string>;
	try {
		names = await readdir(dir);
	} catch (error) {
		if (error.code === 'ENOTDIR') fail_dir(dir, 'is not a directory');
		if (error.code !== 'ENOENT') fail_dir(dir, error.message);
		names = [];
	}
	if (names.length && !names.includes(DEEP_MARKER)) {
		console.error(
			`${dir} is not empty and has no ${DEEP_MARKER}, so it is not this script's: ` +
				'give an empty or new --dir'
		);
		process.exit(1);
	}
	try {
		await mkdir(dir, { recursive: true });
		for (const name of names) {
			if (GROUP_NAME.test(name)) await rm(join(dir, name), { recursive: true });
		}
		await writeFile(join(dir, DEEP_MARKER), '');
	} catch (error) {
		fail_dir(dir, error.message);
	}
};

const seeds = args.seed ?? [Math.floor(Math.random() * 2 ** 31)];
await prepare_dir(args.dir);

/** A group that takes longer than this to generate is named, so a slow one is found. */
const SLOW_MS = 2000;

let groups = 0;
let cases = 0;
let failed = false;
for (const seed of seeds) {
	// before its groups, so a hang is the last seed printed
	console.log(`seed ${seed}: ${args.count} groups`);
	for (let index = 0; index < args.count; index++) {
		const name = `s${seed}_${index}`;
		// the group being generated, on a terminal, so a hang names it
		if (process.stderr.isTTY) process.stderr.write(`\r  ${name} `);
		const start = performance.now();
		let text: string;
		try {
			const expected = generate_json_fixture(generate_random_json_fixture(seed, index, args.cases));
			cases += expected.cases.length;
			text = format_json_fixture(expected);
		} catch (error) {
			console.error(`${name}: the oracle throws: ${error.message}`);
			failed = true;
			continue;
		}
		const elapsed = performance.now() - start;
		if (elapsed > SLOW_MS)
			console.log(`${process.stderr.isTTY ? '\r' : ''}  ${name} took ${Math.round(elapsed)}ms`);
		await mkdir(join(args.dir, name));
		await writeFile(join(args.dir, name, 'expected.json'), text);
		groups++;
	}
	if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
}
console.log(`seeds ${seeds.join(', ')}: ${groups} groups, ${cases} cases in ${args.dir}`);

const cargo = spawnSync('cargo', ['test', '-p', 'fuz_schema', '--test', 'fixtures'], {
	stdio: 'inherit',
	env: { ...process.env, FUZ_SCHEMA_FIXTURES_DIR: args.dir }
});
if (cargo.error) console.error(`cannot run cargo: ${cargo.error.message}`);
if (cargo.status !== 0) failed = true;
if (failed) process.exitCode = 1;
