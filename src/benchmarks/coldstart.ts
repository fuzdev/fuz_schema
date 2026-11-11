/**
 * Cold start: what a library costs a process before it has validated
 * anything, in time and in peak memory. This module plans the processes,
 * samples them, and reduces the samples; `run_coldstart.ts` reports across
 * libraries and `grade.ts` compares two versions of this repo's library.
 *
 * **A sample is one fresh Node process** that does a stage's work once and
 * reports its own clocks. The stages, for each target, scenario, and form of
 * entry (see `child.ts`):
 *
 * - `import` imports the entry
 * - `create` imports it and builds the scenario's schema
 * - `first_parse` imports it, builds the schema, and parses the valid input once
 * - `parse_10` and `parse_100` do the same and go on to the tenth parse and the
 *   hundredth, each of a copy of the input made from its JSON before the
 *   clock starts: the first parses of a fresh process, in code the engine has
 *   yet to optimize, which a timing warmed for a second never sees. Each also
 *   reads its clock after the first parse, so `later_ms` is the parses after
 *   it, in the same process, and no difference of two processes' medians
 *
 * and `bare` is a process that imports nothing, the baseline every other
 * whole-process time includes.
 *
 * **Two clocks, both the process's own.** `work_ms` runs from the module's
 * first line to the work being done, so it holds the import, the build, and
 * the parse and none of Node starting up: it resolves fractions of a
 * millisecond, which the libraries nearest each other need. `ms` is
 * `performance.now()` when the work is done, which counts from the process's
 * start; a stage's `ms` less `bare`'s is the whole cost to a process, but it
 * can't be told from zero inside the baseline's own p10 to p90 band. The
 * import is dynamic so the first clock can be read before it; it loads and
 * runs the same modules a static import would.
 *
 * **Peak memory** is the process's resident high-water mark, read after the
 * clocks and before anything is written. On Linux it comes from `VmHWM` in
 * `/proc/self/status`, not `process.resourceUsage().maxRSS`: a child's
 * `maxRSS` starts at its parent's resident size at the moment it was spawned,
 * so under a large parent every child reads the parent's size.
 *
 * **The process is a consumer's**: no flags, and V8's compile cache off, which
 * every sample reports.
 *
 * **Rounds.** Every planned process runs once a round, in an order that moves
 * on each round (`to_coldstart_order`): another process leads, and each is
 * run after another neighbor, so none always follows the same one. The first
 * rounds are thrown away. Everything reported is a median or a percentile: a
 * process start has a floor and a long slow tail, which a mean would follow.
 * There are no retries; a disturbance lands on one sample and the median sets
 * it aside.
 *
 * The method follows syntax-highlighter-bench's cold-start harness.
 *
 * @module
 */

import { join } from 'node:path';
import { z } from 'zod';
import { stats_median, stats_percentile } from '@fuzdev/fuz_util/stats.ts';

import { SCENARIOS } from './scenarios.ts';
import {
	CHILD_DIR,
	prepare_entry,
	run_child,
	to_child_report_source,
	write_if_changed,
	type EntryForm,
	type EntryVariant
} from './child.ts';

export const COLDSTART_STAGES = [
	'import',
	'create',
	'first_parse',
	'parse_10',
	'parse_100'
] as const;
export type ColdstartStage = (typeof COLDSTART_STAGES)[number];

/** The stages that parse more than once, by how many parses. */
const STAGE_PARSES: Partial<Record<ColdstartStage, number>> = { parse_10: 10, parse_100: 100 };

/** What gets a set of cold-start processes: a library module, at one version. */
export interface ColdstartTarget {
	/** Names the target in reports and file paths. */
	id: string;
	/** Basename of a module in `libs/`. */
	lib: string;
	/** Another version of this repo's library to build against. */
	variant?: EntryVariant;
}

export interface ColdstartProcess {
	/** Null for the bare baseline. */
	target: string | null;
	scenario: string;
	form: EntryForm;
	stage: ColdstartStage;
	path: string;
	/** Whole-process clock of each kept sample. */
	ms: Array<number>;
	/** In-process clock of each kept sample. */
	work_ms: Array<number>;
	/** In a stage of many parses, the in-process time of the parses after the first, of each kept sample. */
	later_ms: Array<number>;
	/** Peak resident size of each kept sample, in kilobytes. */
	rss_kb: Array<number>;
}

export interface ColdstartPlan {
	bare: ColdstartProcess;
	/** Every process of a round, `bare` first. */
	processes: Array<ColdstartProcess>;
}

const ColdstartOutput = z.strictObject({
	ms: z.number().positive(),
	work_ms: z.number().nonnegative(),
	later_ms: z.number().nonnegative().nullable(),
	max_rss_kb: z.number().int().positive(),
	exports: z.number().int().nonnegative(),
	compile_cache_dir: z.string().nullable()
});

/**
 * Writes the module a cold-start process runs: the whole process, apart from
 * what it imports. The input is a literal in the module, so no file is read
 * inside the clocks, and the copies a stage of many parses goes on to are made
 * before them.
 *
 * @param entry - the entry module's path, or null for the bare baseline
 */
const to_child_source = (
	entry: string | null,
	scenario: string,
	stage: ColdstartStage,
	input: unknown
): string =>
	[
		'// generated by src/benchmarks/coldstart.ts: one cold-start sample, and nothing of the harness',
		...(entry !== null && STAGE_PARSES[stage]
			? [
					`const text = ${JSON.stringify(JSON.stringify(input))};`,
					`const copies = Array.from({ length: ${STAGE_PARSES[stage] - 1} }, () => JSON.parse(text));`
				]
			: []),
		'const start = performance.now();',
		...(entry === null ? [] : [`const exports = await import(${JSON.stringify(entry)});`]),
		...(entry === null || stage === 'import'
			? []
			: [`const run = exports.scenario_${scenario}();`]),
		...(entry === null || stage === 'import' || stage === 'create'
			? []
			: [
					`const input = ${JSON.stringify(input)};`,
					"if (run(input) !== true) throw new Error('the valid input did not match');",
					...(STAGE_PARSES[stage]
						? [
								'const first_ms = performance.now();',
								'for (const copy of copies) {',
								"\tif (run(copy) !== true) throw new Error('a copy of the valid input did not match');",
								'}'
							]
						: [])
				]),
		'const ms = performance.now();',
		'const work_ms = ms - start;',
		`const later_ms = ${entry !== null && STAGE_PARSES[stage] ? 'ms - first_ms' : 'null'};`,
		"const fs = process.getBuiltinModule('node:fs');",
		"const hwm = process.platform === 'linux' ? /^VmHWM:\\s+(\\d+) kB$/m.exec(fs.readFileSync('/proc/self/status', 'utf8')) : null;",
		'const max_rss_kb = hwm ? Number(hwm[1]) : process.resourceUsage().maxRSS;',
		...to_child_report_source([
			'ms',
			'work_ms',
			'later_ms',
			'max_rss_kb',
			`exports: ${entry === null ? '0' : 'Object.keys(exports).length'}`,
			"compile_cache_dir: process.getBuiltinModule('node:module').getCompileCacheDir() ?? null"
		])
	].join('\n');

const to_process = (
	target: string | null,
	scenario: string,
	form: EntryForm,
	stage: ColdstartStage,
	path: string
): ColdstartProcess => ({
	target,
	scenario,
	form,
	stage,
	path,
	ms: [],
	work_ms: [],
	later_ms: [],
	rss_kb: []
});

/**
 * Writes every entry and generated module, and returns the processes of a round.
 */
export const plan_coldstart = async (
	targets: ReadonlyArray<ColdstartTarget>,
	scenario_names: ReadonlyArray<string>,
	forms: ReadonlyArray<EntryForm>
): Promise<ColdstartPlan> => {
	const bare_path = join(CHILD_DIR, 'coldstart', 'bare.mjs');
	write_if_changed(bare_path, to_child_source(null, '', 'import', null));
	const bare = to_process(null, '', 'bundled', 'import', bare_path);
	const processes = [bare];
	for (const scenario of SCENARIOS) {
		if (!scenario_names.includes(scenario.name)) continue;
		for (const form of forms) {
			for (const target of targets) {
				const entry = await prepare_entry(target.lib, scenario.name, form, target.variant);
				for (const stage of COLDSTART_STAGES) {
					const path = join(
						CHILD_DIR,
						'coldstart',
						target.id,
						`${scenario.name}.${stage}.${form}.mjs`
					);
					write_if_changed(path, to_child_source(entry, scenario.name, stage, scenario.valid));
					processes.push(to_process(target.id, scenario.name, form, stage, path));
				}
			}
		}
	}
	return { bare, processes };
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The order a round of cold start runs its processes in: from the process the
 * round's index names, stepping through the rest by a stride that shares no
 * factor with the count, the next such stride each round. So the leads move
 * on by one a round, and a process is run after another neighbor from one
 * round to the next, until the strides come round again.
 *
 * @returns every index under `count` once
 */
export const to_coldstart_order = (count: number, round: number): Array<number> => {
	const strides: Array<number> = [];
	for (let stride = 1; stride < count; stride++) if (gcd(stride, count) === 1) strides.push(stride);
	const stride = strides.length ? strides[round % strides.length]! : 0;
	const lead = round % count;
	return Array.from({ length: count }, (_, i) => (lead + i * stride) % count);
};

/**
 * Runs the plan's rounds, filling each process's samples.
 *
 * @param samples - rounds kept
 * @param discard - rounds thrown away first
 * @mutates plan - pushes to each process's `ms`, `work_ms`, `later_ms`, and `rss_kb`
 * @throws Error when a process fails, used a compile cache, or loaded nothing
 */
export const sample_coldstart = (plan: ColdstartPlan, samples: number, discard: number): void => {
	const { processes } = plan;
	for (let round = 0; round < discard + samples; round++) {
		for (const index of to_coldstart_order(processes.length, round)) {
			const p = processes[index]!;
			const output = ColdstartOutput.parse(run_child(p.path));
			if (output.compile_cache_dir !== null) {
				throw new Error(`${p.path}: a compile cache is in use, so the process was not cold`);
			}
			if (p.target !== null && output.exports === 0) {
				throw new Error(`${p.path}: the entry exports nothing, so the process loaded no library`);
			}
			if (round >= discard) {
				p.ms.push(output.ms);
				p.work_ms.push(output.work_ms);
				if (output.later_ms !== null) p.later_ms.push(output.later_ms);
				p.rss_kb.push(output.max_rss_kb);
			}
		}
	}
};

export interface ColdstartSummary {
	/** Median in-process time. */
	work_ms: number;
	/** The in-process time's p10 to p90 band. */
	work_band_ms: number;
	/** Median in-process time of the parses after the first, NaN in a stage of one parse or none. */
	later_ms: number;
	/** Median whole-process time over the bare process's. */
	added_ms: number;
	/** Median peak resident size over the bare process's, in kilobytes. */
	added_rss_kb: number;
}

/**
 * Reduces a process's samples against the bare baseline's.
 */
export const summarize_coldstart = (
	p: ColdstartProcess,
	bare: ColdstartProcess
): ColdstartSummary => ({
	work_ms: stats_median(p.work_ms),
	work_band_ms: stats_percentile(p.work_ms, 0.9) - stats_percentile(p.work_ms, 0.1),
	later_ms: p.later_ms.length ? stats_median(p.later_ms) : NaN,
	added_ms: stats_median(p.ms) - stats_median(bare.ms),
	added_rss_kb: stats_median(p.rss_kb) - stats_median(bare.rss_kb)
});

/**
 * The bare process's own p10 to p90 band: a whole-process addition smaller
 * than this can't be told from zero.
 */
export const to_bare_band_ms = (bare: ColdstartProcess): number =>
	stats_percentile(bare.ms, 0.9) - stats_percentile(bare.ms, 0.1);
