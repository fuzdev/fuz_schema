/**
 * `npm run mutate`: the mutants of `mutants.ts`, each applied to a copy of the
 * working tree and the tests run on it, outside `gro check`. A mutant is
 * killed when a test fails, hung when it outlives the timeout with none
 * failed, which counts as killed, survived when the tests pass, and an error
 * when vitest exits otherwise. Exits nonzero on a stale anchor, edits that
 * leave the file unparsable to TypeScript, an error, a survivor that doesn't
 * say why in `survives`, and a mutant that says it survives and doesn't.
 *
 * The copy is the working tree's `src` and `docs`, its `package.json` and
 * `tsconfig.json`, and its `node_modules` linked, under a directory of this
 * run's own in `~/.cache/fuz_schema_mutate/`, one copy to a worker. It has a
 * vitest config of its own, as `vite.config.ts` reads the git HEAD, which a
 * copy has none of. The unmutated copy runs first, and the run stops if it
 * fails. Each run of the tests is a process group of its own, killed whole at
 * the first test file it reports failed or the timeout, and when this process
 * exits.
 *
 * Runs under Node's type stripping, with its memory cap where
 * `systemd-run --user` can start a scope.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import {
	cpSync,
	copyFileSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { join } from 'node:path';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';
import ts from 'typescript';

import * as s from '#lib/schema.ts';
import { MUTANTS, type Mutant } from './mutants.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	filter: s.optional(s.string),
	workers: s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(1)), 2),
	timeout: s.optional(s.pipe(s.number, s.min_value(1))),
	deep: s.with_default(s.boolean, false),
	keep: s.with_default(s.boolean, false)
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.ok) {
	console.error(parsed.issues.map(s.format_issue).join('\n'));
	console.error(
		'\nusage: npm run mutate -- [--filter substr] [--workers n] [--timeout s] [--deep] [--keep]'
	);
	process.exit(1);
}
const args = parsed.value;

const ROOT = join(import.meta.dirname, '../..');
const CACHE = join(homedir(), '.cache/fuz_schema_mutate');
/**
 * The id of this process's PID namespace, so a run in a container never reads
 * another namespace's PIDs as its own, or `'0'` where it can't be read.
 */
const read_pid_namespace = (): string => {
	try {
		return /^pid:\[(\d+)\]$/.exec(readlinkSync('/proc/self/ns/pid'))?.[1] ?? '0';
	} catch {
		return '0';
	}
};
const PID_NAMESPACE = read_pid_namespace();
// this run's copies, apart from any other run's
const RUN_DIR = join(CACHE, `run_${PID_NAMESPACE}_${process.pid}`);
// a copy of another PID namespace's run, whose PID can't be asked after, is
// removed once it is this old
const FOREIGN_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FILE = 'src/lib/schema.ts';
const TIMEOUT_FLOOR = 120;
// the timeout by default is the floor, or this many times the unmutated run
// where that is longer
const TIMEOUT_BASELINE_FACTOR = 3;
// a `--timeout` under this many times the unmutated run is refused, as a slow
// run would read as hung
const TIMEOUT_MIN_FACTOR = 1.5;
const TAIL_LINES = 40;
const DEEP_SEEDS = [1, 2, 3];
const DEEP_COUNT = 20_000;
// a test's timeout far past vitest's 5 s, which tests that take seconds
// unloaded can outlive when copies share the cores, and read as a kill
const VITEST_CONFIG =
	"export default { test: { include: ['src/test/**/*.test.ts'], testTimeout: 60_000 } };\n";

type Status = 'killed' | 'hung' | 'survived' | 'error';

interface Prepared {
	mutant: Mutant;
	file: string;
	original: string;
	mutated: string;
}

interface Outcome {
	name: string;
	status: Status;
	seconds: number;
	detail: string;
	survives: string | undefined;
	output: string;
}

interface RunResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	hung: boolean;
	// the test files seen failed, in order; the group is killed at the first
	// reported, so the others may be missing
	failed: Array<string>;
	output: string;
	seconds: number;
}

// the process groups running now, killed when this process stops
const running: Set<number> = new Set();

const kill_group = (pid: number): void => {
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		// already gone
	}
};

const kill_running = (): void => {
	for (const pid of running) kill_group(pid);
};

// the shell's convention, 128 and the signal's number
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
	process.on(signal, () => {
		kill_running();
		process.exit(SIGNAL_EXIT_CODES[signal]);
	});
}
// covers an uncaught error and any other exit, as this handler runs synchronously
process.on('exit', kill_running);

// a test file failed: `FAIL` in vitest's summary, and as the file finishes,
// `❯` with its count failed, or `×` before a test of it in the verbose reporter
const FAILED_FILE =
	/(?:FAIL|×)\s+src\/test\/(\S+?\.test\.ts)|❯\s+src\/test\/(\S+?\.test\.ts)\s+\([^)\n]*\bfailed\)/g;

const failed_files = (output: string): Array<string> => [
	...new Set(Array.from(output.matchAll(FAILED_FILE), (m) => (m[1] ?? m[2])!))
];

const tail = (output: string): string => output.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');

/**
 * Runs `node` with `argv` in `cwd` as a process group of its own, and kills
 * the group when it outlives `timeout_s`, or, with `stop_on_fail`, when its
 * output first shows a failed test.
 */
const run_group = (
	cwd: string,
	argv: Array<string>,
	timeout_s: number,
	stop_on_fail: boolean
): Promise<RunResult> =>
	new Promise((resolve) => {
		const start = performance.now();
		const child = spawn(process.execPath, argv, {
			cwd,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
		});
		const pid = child.pid!;
		running.add(pid);
		let output = '';
		let stopped = false;
		const failed_set: Set<string> = new Set();
		// each stream's line in progress, so a line split across chunks is
		// read whole once its rest arrives, and the other stream's chunks
		// between never land in it
		const on_data = (): ((chunk: string) => void) => {
			let partial = '';
			return (text) => {
				output += text;
				partial += text;
				const failed = failed_files(partial);
				for (const f of failed) failed_set.add(f);
				if (stop_on_fail && !stopped && failed.length) {
					stopped = true;
					kill_group(pid);
				}
				partial = partial.slice(partial.lastIndexOf('\n') + 1);
			};
		};
		// decoded as text, so a character of several bytes split across chunks
		// arrives whole
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', on_data());
		child.stderr.on('data', on_data());
		let hung = false;
		const timer = setTimeout(() => {
			hung = true;
			kill_group(pid);
		}, timeout_s * 1000);
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			// whatever of the group is left, as a test file's own child
			kill_group(pid);
			running.delete(pid);
			const failed = [...failed_set];
			resolve({
				code,
				signal,
				hung: hung && !failed.length,
				failed,
				output,
				seconds: (performance.now() - start) / 1000
			});
		});
	});

const describe_exit = (result: RunResult): string =>
	result.signal ? `killed by ${result.signal}` : `exit ${result.code}`;

const make_copy = (dir: string): void => {
	mkdirSync(dir, { recursive: true });
	for (const d of ['src', 'docs']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
	for (const f of ['package.json', 'tsconfig.json']) copyFileSync(join(ROOT, f), join(dir, f));
	symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
	writeFileSync(join(dir, 'vitest.config.ts'), VITEST_CONFIG);
};

const pid_is_alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/**
 * Removes the copies of earlier runs that are no longer running: those an
 * interrupt or `--keep` left. A run still going keeps its own. A run of
 * another PID namespace keeps its own until it is a day old by its mtime.
 */
const clear_stale_runs = (): void => {
	let entries: Array<string>;
	try {
		entries = readdirSync(CACHE);
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(CACHE, entry);
		const match = /^run_(\d+)_(\d+)$/.exec(entry);
		if (match?.[1] === PID_NAMESPACE) {
			if (pid_is_alive(Number(match[2]))) continue;
		} else {
			try {
				if (Date.now() - statSync(path).mtimeMs < FOREIGN_RUN_MAX_AGE_MS) continue;
			} catch {
				continue;
			}
		}
		rmSync(path, { recursive: true, force: true });
	}
};

/**
 * Applies a mutant's edits to the working tree's file, in memory, and checks
 * the result still parses, as a file that doesn't fails every test file that
 * imports it and would read as killed.
 *
 * @returns the mutated text, or the reason an anchor is stale or the edits leave it unparsable
 */
const prepare = (mutant: Mutant): Prepared | string => {
	const file = mutant.file ?? DEFAULT_FILE;
	let original: string;
	try {
		original = readFileSync(join(ROOT, file), 'utf8');
	} catch {
		return `${mutant.name}: no file ${file}`;
	}
	let mutated = original;
	for (let i = 0; i < mutant.edits.length; i++) {
		const { find, replace } = mutant.edits[i]!;
		const count = mutated.split(find).length - 1;
		if (count !== 1) {
			return `${mutant.name}: edit ${i + 1} finds ${count} occurrences in ${file}, not 1`;
		}
		mutated = mutated.replace(find, () => replace);
	}
	if (mutated === original) return `${mutant.name}: its edits change nothing`;
	const { diagnostics } = ts.transpileModule(mutated, { fileName: file, reportDiagnostics: true });
	if (diagnostics?.length) return `${mutant.name}: its edits leave ${file} unparsable`;
	return { mutant, file, original, mutated };
};

// every mutant's anchors and syntax are checked, whichever the filter selects
const names: Set<string> = new Set();
const problems: Array<string> = [];
const prepared: Array<Prepared> = [];
for (const mutant of MUTANTS) {
	if (names.has(mutant.name)) problems.push(`${mutant.name}: named twice`);
	names.add(mutant.name);
	const p = prepare(mutant);
	if (typeof p === 'string') problems.push(p);
	else if (!args.filter || mutant.name.includes(args.filter)) prepared.push(p);
}
if (problems.length) {
	console.error(`mutants that can't run:\n  ${problems.join('\n  ')}`);
	process.exit(1);
}
if (!prepared.length) {
	console.error(`no mutant named with "${args.filter}"`);
	process.exit(1);
}

const run_start = performance.now();
const worker_count = Math.min(args.workers, prepared.length);
// the cores shared out among the copies, so their tests don't contend
const vitest_workers = Math.max(1, Math.floor(availableParallelism() / worker_count));
const VITEST_ARGS = [
	join(ROOT, 'node_modules/vitest/vitest.mjs'),
	'run',
	`--maxWorkers=${vitest_workers}`,
	'--exclude',
	'src/test/sizes.test.ts'
];
clear_stale_runs();
const dirs = Array.from({ length: worker_count }, (_, i) => join(RUN_DIR, `worker_${i}`));
for (const dir of dirs) make_copy(dir);

const remove_copies = (): void => {
	if (!args.keep) rmSync(RUN_DIR, { recursive: true, force: true });
};

const baseline = await run_group(dirs[0]!, VITEST_ARGS, Math.max(args.timeout ?? 0, 600), true);
if (baseline.hung || baseline.code !== 0 || baseline.failed.length) {
	console.error(tail(baseline.output));
	const why = baseline.hung
		? 'hung'
		: baseline.failed.length
			? baseline.failed.join(', ')
			: describe_exit(baseline);
	console.error(`the unmutated copy fails (${why}): fix the tree first`);
	remove_copies();
	process.exit(1);
}
const timeout_min = Math.ceil(baseline.seconds * TIMEOUT_MIN_FACTOR);
if (args.timeout !== undefined && args.timeout < timeout_min) {
	console.error(
		`--timeout ${args.timeout} is under ${TIMEOUT_MIN_FACTOR} times the unmutated run ` +
			`(${baseline.seconds.toFixed(1)} s), so a slow run would read as hung: give ${timeout_min} or more`
	);
	remove_copies();
	process.exit(1);
}
const timeout =
	args.timeout ?? Math.max(TIMEOUT_FLOOR, Math.ceil(baseline.seconds * TIMEOUT_BASELINE_FACTOR));
console.log(
	`unmutated: passes in ${baseline.seconds.toFixed(1)} s; ${prepared.length} mutants, ` +
		`${worker_count} workers of ${vitest_workers} vitest workers each, ${timeout} s timeout` +
		`${args.deep ? ', deep' : ''}\n`
);

const run_mutant = async (dir: string, p: Prepared): Promise<Outcome> => {
	const path = join(dir, p.file);
	writeFileSync(path, p.mutated);
	try {
		const result = await run_group(dir, VITEST_ARGS, timeout, true);
		let status: Status;
		let detail: string;
		if (result.failed.length) {
			status = 'killed';
			detail = result.failed.join(', ');
		} else if (result.hung) {
			status = 'hung';
			detail = `outlived ${timeout} s`;
		} else if (result.code === 0) {
			status = 'survived';
			detail = '';
		} else {
			status = 'error';
			detail = `${describe_exit(result)}, no failed test named`;
		}
		let seconds = result.seconds;
		let output = result.output;
		if (status === 'survived' && args.deep) {
			const deep = await run_group(
				dir,
				[
					'--max-old-space-size=2048',
					'src/test/differential.ts',
					...DEEP_SEEDS.flatMap((seed) => ['--seed', String(seed)]),
					'--count',
					String(DEEP_COUNT),
					'--limit',
					'1'
				],
				timeout * 5,
				false
			);
			seconds += deep.seconds;
			output = deep.output;
			if (deep.hung) {
				status = 'hung';
				detail = 'the differential outlived its timeout';
			} else if (deep.code !== 0) {
				status = 'killed';
				detail = `the differential, seeds ${DEEP_SEEDS.join(', ')}`;
			} else {
				detail = `the differential too, seeds ${DEEP_SEEDS.join(', ')}`;
			}
		}
		return { name: p.mutant.name, status, seconds, detail, survives: p.mutant.survives, output };
	} finally {
		writeFileSync(path, p.original);
	}
};

const outcomes: Array<Outcome> = [];
let next = 0;
await Promise.all(
	dirs.map(async (dir) => {
		while (next < prepared.length) {
			const p = prepared[next++]!;
			const outcome = await run_mutant(dir, p);
			outcomes.push(outcome);
			console.log(
				`${outcome.status.padEnd(8)} ${outcome.name.padEnd(44)} ${outcome.seconds.toFixed(1).padStart(6)} s  ${outcome.detail}`
			);
		}
	})
);

remove_copies();

const failures: Array<string> = [];
for (const o of outcomes) {
	if (o.status === 'error') {
		failures.push(
			`${o.name}: vitest exited abnormally, the tail of its output:\n${tail(o.output)}`
		);
	} else if (o.status === 'survived' && !o.survives) {
		failures.push(`${o.name} survived, and its entry gives no reason in \`survives\``);
	} else if (o.status !== 'survived' && o.survives) {
		failures.push(`${o.name} is ${o.status}, and its entry says it survives: remove \`survives\``);
	}
}
const count = (status: Status): number => outcomes.filter((o) => o.status === status).length;
console.log(
	`\n${outcomes.length} mutants: ${count('killed')} killed, ${count('hung')} hung, ` +
		`${count('survived')} survived, ${count('error')} errors, ` +
		`in ${((performance.now() - run_start) / 1000).toFixed(0)} s`
);
for (const o of outcomes) {
	if (o.status === 'survived' && o.survives) console.log(`  ${o.name} survives: ${o.survives}`);
}
if (args.keep) console.log(`the copies are kept in ${RUN_DIR}, until the next run`);
if (failures.length) {
	console.error(`\n${failures.join('\n\n')}`);
	process.exitCode = 1;
}
