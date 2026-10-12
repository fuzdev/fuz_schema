/**
 * Grades the working tree's `schema.ts` against another version of it, across
 * every factor the acceptance rules weigh: time and allocation per case,
 * whether the output is the input itself, bundle size per scenario, retained
 * heap, and cold start.
 *
 * Both versions are loaded into one process and timed back to back per case,
 * so load on the machine hits them alike. Retained heap and cold start are
 * measured in processes of their own (`heap.ts`, `coldstart.ts`), the two
 * versions' cold-start processes interleaved round by round. The baseline
 * comes from git (`--against`, default `HEAD`) or from a file (`--against-file`).
 *
 * The baseline may have another API. The cases reach renamed exports through
 * helpers in `cases.ts`; the bundle, heap, and cold-start comparisons use the
 * baseline's own scenario module, taken from the same git ref or given with
 * `--against-libs-file`. Without one they use the working tree's, which is
 * only right when the two versions share an API.
 *
 * Both versions' cases share call sites inside the library they belong to, so
 * timings reflect code that has seen many schema shapes, as in an app, not a
 * freshly specialized micro-benchmark.
 *
 * Usage (`npm run grade` passes the node flags it needs):
 *   npm run grade
 *   npm run grade -- --against HEAD~3 --filter each/union
 *   npm run grade -- --against-file .gro/grade/snapshot.ts --duration 500
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';
import { Benchmark } from '@fuzdev/fuz_util/benchmark.ts';
import { benchmark_stats_compare } from '@fuzdev/fuz_util/benchmark_stats.ts';

import * as current_lib from '#lib/schema.ts';
import { CASE_PATHS, create_cases, type Case, type SchemaLib } from './cases.ts';
import { SCENARIOS } from './scenarios.ts';
import { measure_bundle_size } from './bundle_size.ts';
import { ENTRY_FORMS, type EntryVariant } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart
} from './coldstart.ts';
import { HEAP_SETTLED_BELOW_BYTES, measure_retained_heap } from './heap.ts';
import {
	format_table,
	geometric_mean,
	hold_benchmark_lock,
	measure_bytes,
	measure_ms
} from './measure.ts';

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	against: z.string().default('HEAD').meta({ description: 'git ref to take the baseline from' }),
	'against-file': z
		.string()
		.optional()
		.meta({ description: 'file to use as the baseline instead of a git ref' }),
	'against-libs-file': z
		.string()
		.optional()
		.meta({ description: "the baseline's scenario module, with --against-file" }),
	filter: z.string().optional().meta({ description: 'only run cases whose name includes this' }),
	duration: z
		.number()
		.default(200)
		.meta({ description: 'measurement ms per timing, of which a case has five' }),
	bundle: z.boolean().default(true).meta({ description: 'also measure bundle sizes' }),
	'no-bundle': z.boolean().default(false).meta({ description: 'opt out of bundle' }),
	process: z
		.boolean()
		.default(true)
		.meta({ description: 'also measure retained heap and cold start, in processes of their own' }),
	'no-process': z.boolean().default(false).meta({ description: 'opt out of process' }),
	samples: z.number().int().positive().default(15).meta({ description: 'kept cold-start rounds' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

hold_benchmark_lock('fuz_schema grade');

// thresholds from the acceptance rules
const NOISE_FLOOR = 0.1;
const SPEEDUP_PER_CORE_BYTES = { speedup: 0.1, bytes: 50 };
const CEILING_VS_VALIBOT = 2 / 3;
// the scenario standing in for "what `parse` plus an object schema reaches":
// the one built from `object`, the default object schema
const CORE_SCENARIO = 'strict_nested';
// the scenarios cold start samples: one small schema, one large
const COLDSTART_SCENARIOS = ['object_flat', 'type_json'];
const COLDSTART_DISCARD = 2;

//
// Load the baseline
//

const LIB_MODULE = 'src/benchmarks/libs/fuz_schema.ts';

let baseline_path: string;
let baseline_lib_path: string | undefined;
let baseline_label: string;
if (args['against-file']) {
	baseline_path = resolve(args['against-file']);
	baseline_lib_path = args['against-libs-file'] && resolve(args['against-libs-file']);
	baseline_label = args['against-file'];
} else {
	mkdirSync('.gro/grade', { recursive: true });
	baseline_path = resolve('.gro/grade/against_schema.ts');
	writeFileSync(baseline_path, execFileSync('git', ['show', `${args.against}:src/lib/schema.ts`]));
	baseline_lib_path = resolve('.gro/grade/against_libs_fuz_schema.ts');
	writeFileSync(baseline_lib_path, execFileSync('git', ['show', `${args.against}:${LIB_MODULE}`]));
	baseline_label = args.against;
}
const baseline_lib: SchemaLib = await import(pathToFileURL(baseline_path).href);

const baseline_cases: Map<string, Case> = new Map(
	create_cases(baseline_lib).map((c) => [c.name, c])
);
const cases = create_cases(current_lib).filter((c) => !args.filter || c.name.includes(args.filter));
if (!cases.length) {
	console.error('no cases matched');
	process.exit(1);
}

//
// Measure
//

interface Measured {
	c: Case;
	base: Case | undefined;
	batch: number;
	ns: number;
	base_ns: number;
	significant: boolean;
	bytes: number;
	base_bytes: number;
	same: boolean;
	base_same: boolean | undefined;
}

const bench = new Benchmark({
	duration_ms: args.duration,
	warmup_iterations: 20,
	min_iterations: 30,
	cooldown_ms: 10
});

let sink = 0;
const to_task = (run: () => unknown, batch: number) => (): void => {
	for (let i = 0; i < batch; i++) {
		if (run() !== undefined) sink++;
	}
};

const measured: Array<Measured> = [];

for (const [i, c] of cases.entries()) {
	if (c.ok() !== c.valid) throw new Error(`${c.name} expected valid=${c.valid}`);
	// and that a case through `parse` that matches takes the path it names
	if (c.valid && c.path !== 'probe' && (c.run() === c.input) !== (c.path === 'identity')) {
		throw new Error(`${c.name} expected path=${c.path}`);
	}
	let base = baseline_cases.get(c.name);
	if (base && base.ok() !== base.valid) {
		console.warn(`baseline disagrees on ${c.name}, skipping its comparison`);
		base = undefined;
	}
	for (let w = 0; w < 2000; w++) {
		c.run();
		base?.run();
	}
	// size batches so one timing is tens of microseconds, well above timer resolution
	const batch = Math.max(1, Math.min(10_000, Math.round(0.05 / measure_ms(c.run, 200, 3))));
	// Each version is timed twice, the second pair in the reverse order of the
	// first, so each goes both first and last and a cost of position is shared
	// between them: an unchanged library timed once each way round reads up to
	// 1.3x apart. Which version leads alternates case by case.
	const fns = { new: to_task(c.run, batch), base: base && to_task(base.run, batch) };
	const first = i % 2 ? 'base' : 'new';
	const second = first === 'new' ? 'base' : 'new';
	// whatever is timed first in a case is slow whichever version it is, so the
	// first is timed once more ahead of the rest and that timing thrown away,
	// which also has each version follow itself once and the other once
	if (base) bench.add({ name: `${c.name} [lead]`, fn: fns[first]! });
	for (const [version, round] of [
		[first, 1],
		[second, 1],
		[second, 2],
		[first, 2]
	] as const) {
		const fn = fns[version];
		if (fn && (base || round === 1)) bench.add({ name: `${c.name} [${version} ${round}]`, fn });
	}
	measured.push({
		c,
		base,
		batch,
		ns: NaN,
		base_ns: NaN,
		significant: false,
		bytes: NaN,
		base_bytes: NaN,
		same: c.run() === c.input,
		base_same: base ? base.run() === base.input : undefined
	});
}

console.log(`grading the working tree against ${baseline_label}, ${cases.length} cases...`);
const results = new Map((await bench.run()).map((r) => [r.name, r]));

for (const m of measured) {
	const result = results.get(`${m.c.name} [new 1]`)!;
	m.ns = result.stats.p50_ns / m.batch;
	m.bytes = measure_bytes(m.c.run, undefined, 5);
	if (m.base) {
		const result_2 = results.get(`${m.c.name} [new 2]`)!;
		const base_result = results.get(`${m.c.name} [base 1]`)!;
		const base_result_2 = results.get(`${m.c.name} [base 2]`)!;
		m.ns = (result.stats.p50_ns + result_2.stats.p50_ns) / 2 / m.batch;
		m.base_ns = (base_result.stats.p50_ns + base_result_2.stats.p50_ns) / 2 / m.batch;
		// significant when it is in both pairs, the same way
		const compared_1 = benchmark_stats_compare(base_result.stats, result.stats, {
			min_percent_difference: NOISE_FLOOR
		});
		const compared_2 = benchmark_stats_compare(base_result_2.stats, result_2.stats, {
			min_percent_difference: NOISE_FLOOR
		});
		m.significant =
			compared_1.significant && compared_2.significant && compared_1.faster === compared_2.faster;
		m.base_bytes = measure_bytes(m.base.run, undefined, 5);
	}
}

//
// Report
//

const format_number = (n: number): string =>
	Number.isNaN(n) ? '-' : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

const format_ratio = (ratio: number, mark = false): string =>
	Number.isNaN(ratio) ? '-' : `${ratio.toFixed(2)}x${mark ? '*' : ' '}`;

const format_same = (same: boolean | undefined): string =>
	same === undefined ? '-' : same ? 'input' : 'copy';

console.log(
	'\ncases: time is median ns per parse over two timings, alloc is heap bytes per parse, ' +
		`out is whether the output is the input itself\n* marks a time change past the ${NOISE_FLOOR * 100}% noise floor that is statistically significant in both\n`
);
console.log(
	format_table([
		['case', 'path', 'base ns', 'new ns', 'time', 'base B', 'new B', 'alloc', 'out'],
		...measured.map((m) => [
			m.c.name + (m.c.realistic ? ' †' : ''),
			m.c.path,
			format_number(m.base_ns),
			format_number(m.ns),
			format_ratio(m.ns / m.base_ns, m.significant),
			format_number(m.base_bytes),
			format_number(m.bytes),
			format_ratio(m.bytes / m.base_bytes),
			m.base_same === undefined || m.base_same === m.same
				? format_same(m.same)
				: `${format_same(m.base_same)}→${format_same(m.same)}`
		])
	])
);
console.log('† realistic case, the ones the acceptance rules judge speed on');

const compared = measured.filter((m) => m.base);
const time_ratio = (ms: Array<Measured>): number => geometric_mean(ms.map((m) => m.ns / m.base_ns));
const sum = (ms: Array<Measured>, key: 'bytes' | 'base_bytes'): number =>
	ms.reduce((total, m) => total + m[key], 0);

const groups = [...new Set(compared.map((m) => m.c.group))];
// a path's cases are of one validity, but for `probe`, so its row has one time
const to_path_rows = (label: string, ms: Array<Measured>): Array<Array<string>> =>
	CASE_PATHS.map((path) => ms.filter((m) => m.c.path === path))
		.filter((of_path) => of_path.length)
		.map((of_path) => [
			label + of_path[0]!.c.path,
			String(of_path.length),
			format_ratio(time_ratio(of_path)),
			format_ratio(sum(of_path, 'bytes') / sum(of_path, 'base_bytes'))
		]);
const to_summary_row = (label: string, ms: Array<Measured>): Array<string> => [
	label,
	String(ms.length),
	format_ratio(time_ratio(ms.filter((m) => m.c.valid))),
	format_ratio(time_ratio(ms.filter((m) => !m.c.valid))),
	format_ratio(sum(ms, 'bytes') / sum(ms, 'base_bytes'))
];

console.log('\nsummary: geometric mean of time ratios, ratio of summed allocation\n');
console.log(
	format_table([
		['group', 'cases', 'valid time', 'invalid time', 'alloc'],
		...groups.map((g) =>
			to_summary_row(
				g,
				compared.filter((m) => m.c.group === g)
			)
		),
		to_summary_row(
			'realistic †',
			compared.filter((m) => m.c.realistic)
		),
		to_summary_row('all', compared)
	])
);

console.log('\nby path: what the parse does, over the realistic cases and over all of them\n');
console.log(
	format_table([
		['path', 'cases', 'time', 'alloc'],
		...to_path_rows(
			'realistic † ',
			compared.filter((m) => m.c.realistic)
		),
		...to_path_rows('all ', compared)
	])
);

//
// Bundle size and the rules
//

let core_delta = 0;
let all_vs_valibot = NaN;

if (args.bundle) {
	const columns = [...SCENARIOS.map((s) => [s.name]), SCENARIOS.map((s) => s.name)];
	const headers = [...SCENARIOS.map((s) => s.name), 'all'];
	const base_sizes: Array<number> = [];
	const sizes: Array<number> = [];
	for (const column of columns) {
		base_sizes.push(
			(
				await measure_bundle_size('fuz_schema', column, {
					schema_path: baseline_path,
					lib_path: baseline_lib_path
				})
			).gzip
		);
		sizes.push((await measure_bundle_size('fuz_schema', column)).gzip);
	}
	const valibot_all = (await measure_bundle_size('valibot', columns.at(-1)!)).gzip;
	const core_index = headers.indexOf(CORE_SCENARIO);
	core_delta = sizes[core_index]! - base_sizes[core_index]!;
	all_vs_valibot = sizes.at(-1)! / valibot_all;

	console.log('\nbundle size: minified + gzip bytes per scenario\n');
	console.log(
		format_table([
			['', ...headers],
			['base', ...base_sizes.map(String)],
			['new', ...sizes.map(String)],
			[
				'delta',
				...sizes.map((s, i) => `${s - base_sizes[i]! >= 0 ? '+' : ''}${s - base_sizes[i]!}`)
			]
		])
	);
}

//
// Retained heap and cold start, in processes of their own
//

const heap_grew: Array<string> = [];
const coldstart_slower: Array<string> = [];
let coldstart_ratio = NaN;

if (args.process) {
	const variant: EntryVariant = {
		id: 'base',
		schema_path: baseline_path,
		lib_path: baseline_lib_path
	};

	const heap_rows: Array<Array<string>> = [];
	for (const scenario of SCENARIOS) {
		const base = await measure_retained_heap('fuz_schema', scenario.name, variant);
		const current = await measure_retained_heap('fuz_schema', scenario.name);
		const format_delta = (delta: number): string => `${delta >= 0 ? '+' : ''}${delta}`;
		heap_rows.push([
			scenario.name,
			(base.total_bytes / 1024).toFixed(1),
			(current.total_bytes / 1024).toFixed(1),
			format_delta(current.total_bytes - base.total_bytes),
			String(base.further_schema_bytes),
			String(current.further_schema_bytes),
			format_delta(current.further_schema_bytes - base.further_schema_bytes)
		]);
		// a reading repeats to about the size of a collection's jitter
		if (
			current.total_bytes - base.total_bytes > HEAP_SETTLED_BELOW_BYTES ||
			current.further_schema_bytes > base.further_schema_bytes * (1 + NOISE_FLOOR)
		) {
			heap_grew.push(scenario.name);
		}
	}
	console.log(
		'\nretained heap: after building one schema and parsing once, over a bare process,\n' +
			'and what each schema past the first adds\n'
	);
	console.log(
		format_table([
			['scenario', 'base KB', 'new KB', 'delta B', 'base B/schema', 'new B/schema', 'delta B'],
			...heap_rows
		])
	);

	const plan = await plan_coldstart(
		[
			{ id: 'fuz_schema.new', lib: 'fuz_schema' },
			{ id: 'fuz_schema.base', lib: 'fuz_schema', variant }
		],
		COLDSTART_SCENARIOS,
		ENTRY_FORMS
	);
	sample_coldstart(plan, args.samples, COLDSTART_DISCARD);
	const coldstart_rows: Array<Array<string>> = [];
	const ratios: Array<number> = [];
	for (const scenario of COLDSTART_SCENARIOS) {
		for (const form of ENTRY_FORMS) {
			for (const stage of COLDSTART_STAGES) {
				const find = (target: string): (typeof plan.processes)[number] =>
					plan.processes.find(
						(p) =>
							p.target === target && p.scenario === scenario && p.form === form && p.stage === stage
					)!;
				const base = summarize_coldstart(find('fuz_schema.base'), plan.bare);
				const current = summarize_coldstart(find('fuz_schema.new'), plan.bare);
				const ratio = current.work_ms / base.work_ms;
				// slower only when the medians differ by more than either's own spread
				const slower =
					ratio > 1 + NOISE_FLOOR &&
					current.work_ms - base.work_ms > Math.max(base.work_band_ms, current.work_band_ms);
				const name = `${scenario}/${form}/${stage}`;
				if (stage === 'first_parse') ratios.push(ratio);
				if (slower) coldstart_slower.push(name);
				coldstart_rows.push([
					name,
					base.work_ms.toFixed(2),
					current.work_ms.toFixed(2),
					format_ratio(ratio, slower),
					`±${Math.max(base.work_band_ms, current.work_band_ms).toFixed(2)}`,
					`${current.added_rss_kb - base.added_rss_kb >= 0 ? '+' : ''}${Math.round(current.added_rss_kb - base.added_rss_kb)}`
				]);
			}
		}
	}
	coldstart_ratio = geometric_mean(ratios);
	console.log(
		`\ncold start: median ms of work inside a fresh process, ${args.samples} samples, each stage including\n` +
			'the ones before it; band is the wider p10 to p90 spread of the two; peak is KB of resident memory\n'
	);
	console.log(
		format_table([
			['scenario/form/stage', 'base ms', 'new ms', 'time', 'band', 'peak KB'],
			...coldstart_rows
		])
	);
}

const realistic_valid = compared.filter((m) => m.c.realistic && m.c.valid);
const realistic_speedup = 1 - time_ratio(realistic_valid);
const slower_valid = compared.filter(
	(m) => m.c.valid && m.significant && m.ns / m.base_ns > 1 + NOISE_FLOOR
);
const more_alloc = compared.filter((m) => m.bytes > m.base_bytes + 8);
const changed_out = compared.filter((m) => m.base_same !== m.same);

const format_names = (ms: Array<Measured>): string =>
	ms.length ? ms.map((m) => m.c.name).join(', ') : 'none';
const format_percent = (n: number): string => {
	// rounded first, so a small loss reads `+0%` and not `-0%`
	const percent = Math.round(n * 100) || 0;
	return `${percent >= 0 ? '+' : ''}${percent}%`;
};

console.log('\nagainst the acceptance rules\n');
if (realistic_valid.length) {
	const by_path = CASE_PATHS.map((path) => realistic_valid.filter((m) => m.c.path === path))
		.filter((of_path) => of_path.length)
		.map((of_path) => `${of_path[0]!.c.path} ${format_percent(1 - time_ratio(of_path))}`);
	console.log(
		`realistic valid-path speed: ${format_percent(realistic_speedup)} (${by_path.join(', ')})`
	);
} else {
	console.log('realistic valid-path speed: no realistic valid cases in this run');
}
if (args.bundle) {
	const required =
		(Math.max(0, core_delta) / SPEEDUP_PER_CORE_BYTES.bytes) * SPEEDUP_PER_CORE_BYTES.speedup;
	const verdict = !realistic_valid.length
		? 'not judged, no realistic valid cases in this run'
		: core_delta <= 0
			? realistic_speedup > -NOISE_FLOOR
				? 'pass, no bytes added'
				: 'FAIL, slower with no bytes saved to show for it'
			: realistic_speedup >= required
				? 'pass'
				: 'FAIL';
	console.log(
		`core bytes (${CORE_SCENARIO}): ${core_delta >= 0 ? '+' : ''}${core_delta} gzip, ` +
			`which needs ${format_percent(required)} realistic speed: ${verdict}`
	);
	console.log(
		`size ceiling: all scenarios are ${all_vs_valibot.toFixed(2)}x valibot, ` +
			`limit ${CEILING_VS_VALIBOT.toFixed(2)}x: ${all_vs_valibot <= CEILING_VS_VALIBOT ? 'pass' : 'FAIL'}`
	);
}
console.log(`valid-path cases slower past the noise floor: ${format_names(slower_valid)}`);
console.log(`cases allocating more: ${format_names(more_alloc)}`);
console.log(`cases whose output identity changed: ${format_names(changed_out)}`);
if (args.process) {
	console.log(
		`cold start, first parse: ${format_ratio(coldstart_ratio).trim()} the baseline's; ` +
			`stages slower past their own spread: ${coldstart_slower.length ? coldstart_slower.join(', ') : 'none'}`
	);
	console.log(`scenarios retaining more: ${heap_grew.length ? heap_grew.join(', ') : 'none'}`);
}
console.log(`\nsink: ${sink}`);
