/**
 * The fixture run: a whole results file with invented numbers, for the tests
 * and for building the site without a published run. Every figure is made by
 * a formula here from a base and a factor per library, so none of them is a
 * measurement, and the file says so wherever it names itself: its kind is
 * `fixture`, which is never publishable.
 *
 * It has one of every kind of cell a page must draw: a row `zod_compiled`
 * has no figure of, a survey shape a library can't express and an input one
 * answers otherwise, a row at the call floor, a figure of one kept definition,
 * a spread wide enough that a gap is inside it, and two libraries whose means
 * are inside each other's bands.
 *
 * `fixture_run.json` beside this is what it builds, written by
 * `update.task.ts`, and `src/test/results_schema.test.ts` fails when the file
 * is stale.
 *
 * @module
 */

import { LIB_NAMES, type LibName } from '../../../benchmarks/lib_names.ts';
import { RESULTS_LIB_INFO, RESULTS_STEPS } from '../../../benchmarks/results_plan.ts';
import {
	BENCHMARK_FULL_ARGS,
	type BenchmarkData,
	type BenchmarkId,
	type BenchmarkMissing,
	type BenchmarkResults,
	type BenchmarkSection,
	type BenchmarkTiming
} from '../../../benchmarks/results_schema.ts';

/** The scenarios of the fixture, each with what one parse of it is taken to cost this library. */
const SCENARIOS: ReadonlyArray<{ name: string; ns: number; bytes: number; recursive: boolean }> = [
	{ name: 'string', ns: 20, bytes: 300, recursive: false },
	{ name: 'object_flat', ns: 100, bytes: 800, recursive: false },
	{ name: 'list', ns: 9000, bytes: 950, recursive: false },
	{ name: 'type_json', ns: 1500, bytes: 1700, recursive: true },
	{ name: 'app', ns: 1800, bytes: 2200, recursive: true }
];

type Factors = Readonly<Record<LibName, number>>;

// what each library is taken to cost, as a multiple of this library's figure
const VALID: Factors = {
	fuz_schema: 1,
	valibot: 2.4,
	zod: 1.9,
	zod_compiled: 0.4,
	zod_mini: 4.2,
	typebox: 0.2,
	arktype: 6
};
const INVALID: Factors = {
	fuz_schema: 1.5,
	valibot: 5,
	zod: 28,
	zod_compiled: 10,
	zod_mini: 16,
	typebox: 0.2,
	arktype: 90
};
// TypeBox and ArkType are level as guards: each row is inside its two spreads, and
// so are the two means inside each other's bands
const GUARD: Factors = {
	fuz_schema: 1,
	valibot: 6.5,
	zod: 1.6,
	zod_compiled: 0.25,
	zod_mini: 4.3,
	typebox: 0.18,
	arktype: 0.19
};
const SIZE: Factors = {
	fuz_schema: 1,
	valibot: 1.5,
	zod: 24,
	zod_compiled: 31,
	zod_mini: 5.5,
	typebox: 38,
	arktype: 46
};
const HELD: Factors = {
	fuz_schema: 1,
	valibot: 1.4,
	zod: 22,
	zod_compiled: 25,
	zod_mini: 5,
	typebox: 32,
	arktype: 470
};
const TYPES: Factors = {
	fuz_schema: 1,
	valibot: 1.9,
	zod: 7.7,
	zod_compiled: 7.8,
	zod_mini: 1.2,
	typebox: 0.5,
	arktype: 6.5
};

const UNCOMPILED: BenchmarkMissing = {
	none: 'uncompiled',
	why: '`z.compile` hands the root back uncompiled'
};

const round = (n: number, digits = 2): number => Number(n.toFixed(digits));

/** The spread every timing of the fixture has, but the one made wide on purpose. */
const SPREAD = 0.03;

const to_timing = (ns: number, spread: number = SPREAD): BenchmarkTiming => ({
	ns: round(ns),
	batch_ns: round(ns * 0.95),
	min_ns: round(ns * (1 - spread)),
	max_ns: round(ns * (1 + spread)),
	spread
});

const to_libs = <T>(to_entry: (lib: LibName) => T): Record<string, T> =>
	Object.fromEntries(LIB_NAMES.map((lib) => [lib, to_entry(lib)]));

const to_section = <TId extends BenchmarkId>(
	id: TId,
	data: BenchmarkData[TId]
): BenchmarkSection<TId> => {
	const step = RESULTS_STEPS.find((s) => s.id === id)!;
	return {
		status: 'measured',
		script: step.script,
		command: `node src/benchmarks/fixture.ts ${id}`,
		args: [...BENCHMARK_FULL_ARGS],
		duration_ms: 60_000,
		data
	} as BenchmarkSection<TId>;
};

const create_run = (): BenchmarkData['run'] => ({
	regime: 'shared',
	passes: 5,
	duration_ms: 500,
	warm_ms: 100,
	call: { min_ns: 4, max_ns: 4.4 },
	rows: SCENARIOS.flatMap((scenario) =>
		(
			[
				['valid', VALID],
				['invalid', INVALID],
				['guard', GUARD]
			] as const
		).map(([input, factors]) => ({
			scenario: scenario.name,
			input,
			libs: to_libs((lib) =>
				lib === 'zod_compiled' && scenario.name === 'type_json'
					? UNCOMPILED
					: // one spread made wide: ArkType's guard of a flat object, level with the row's best
						lib === 'arktype' && scenario.name === 'object_flat' && input === 'guard'
						? to_timing(scenario.ns * GUARD.typebox * 1.04, 0.08)
						: to_timing(scenario.ns * factors[lib])
			)
		}))
	)
});

const create_survey = (): BenchmarkData['survey'] => {
	const others = ['valibot', 'zod', 'zod_compiled'] as const;
	const to_row = (
		shape: string,
		input: string,
		does: string,
		valid: boolean,
		ns: number,
		factors: Readonly<Record<(typeof others)[number], number | BenchmarkMissing>>
	): BenchmarkData['survey']['rows'][number] => ({
		shape,
		input,
		does,
		valid,
		libs: {
			fuz_schema: { ns: round(ns), spread: SPREAD },
			...Object.fromEntries(
				others.map((lib) => {
					const factor = factors[lib];
					return [
						lib,
						typeof factor === 'number' ? { ns: round(ns * factor), spread: SPREAD } : factor
					];
				})
			)
		}
	});
	return {
		regime: 'shared',
		passes: 3,
		duration_ms: 150,
		warm_ms: 60,
		subject: 'fuz_schema',
		others: [...others],
		call: { min_ns: 4.2, max_ns: 4.4 },
		call_floor_ns: 8.8,
		// the order the summary takes, which is not the order the rows come in
		kinds: [
			'primitive',
			'guard',
			'array',
			'object identity',
			'object copy',
			'union',
			'lazy',
			'issue at the root',
			'issue at depth 1',
			'many issues'
		],
		rows: [
			to_row('string', 'valid', 'primitive', true, 18, {
				valibot: 1.3,
				zod: 2.4,
				zod_compiled: 1.7
			}),
			to_row('string', 'invalid', 'issue at the root', false, 32, {
				valibot: 2.5,
				zod: 20,
				zod_compiled: 24
			}),
			// at the call floor: this library's time is under twice the empty call
			to_row('is_string', 'valid', 'guard', true, 8, { valibot: 1.5, zod: 1.6, zod_compiled: 1.1 }),
			to_row('object', 'valid', 'object identity', true, 110, {
				valibot: 2.6,
				zod: 1.8,
				zod_compiled: 0.5
			}),
			to_row('object', 'one_bad', 'issue at depth 1', false, 150, {
				valibot: 3.4,
				zod: 9,
				zod_compiled: 8.5
			}),
			to_row('strip_object', 'valid', 'object copy', true, 210, {
				valibot: 1.6,
				zod: 0.8,
				zod_compiled: 0.36
			}),
			to_row('array_numbers', 'valid_100', 'array', true, 700, {
				valibot: 3,
				zod: 3.5,
				zod_compiled: 0.22
			}),
			to_row('union', 'second', 'union', true, 60, { valibot: 3.6, zod: 3.3, zod_compiled: 0.7 }),
			to_row('lazy_tree', 'valid', 'lazy', true, 940, {
				valibot: 3,
				zod: 5.2,
				zod_compiled: UNCOMPILED
			}),
			to_row('memo_union', 'valid', 'union', true, 85, {
				valibot: { none: 'no_equivalent', why: 'it has no union that keeps what it probed' },
				zod: { none: 'no_equivalent', why: 'it has no union that keeps what it probed' },
				zod_compiled: { none: 'no_equivalent', why: 'it has no union that keeps what it probed' }
			}),
			to_row('number', 'nan', 'issue at the root', false, 36, {
				valibot: 2.3,
				zod: { none: 'differs', why: 'it takes NaN as a number' },
				zod_compiled: { none: 'differs', why: 'it takes NaN as a number' }
			}),
			to_row('form', 'all_bad', 'many issues', false, 210, {
				valibot: 3.5,
				zod: 10,
				zod_compiled: 10.5
			})
		]
	};
};

const create_harvest = (): BenchmarkData['harvest'] => {
	type HarvestSet = BenchmarkData['harvest']['sets'][number];
	const to_cell = (ns: number, bytes: number): HarvestSet['rows'][number]['sides'][string] => ({
		time: { ns: round(ns), batch_ns: round(ns * 0.96), spread: SPREAD },
		bytes: { bytes: Math.round(bytes) }
	});
	return {
		passes: 5,
		duration_ms: 1000,
		warm_ms: 200,
		sets: [
			{
				name: 'status_report',
				title: "an invented consumer's status report, in zod and in this library",
				reference: 'zod',
				root: 'StatusReport',
				sides: [
					{ id: 'zod', label: 'zod' },
					{ id: 'zod_jitless', label: 'zod jitless' },
					{ id: 'zod_compiled', label: 'zod compiled' },
					{ id: 'fuz_schema', label: 'fuz_schema' }
				],
				bundles: {
					zod: { minified: 99_000, gzip: 27_000 },
					zod_compiled: { minified: 129_000, gzip: 34_000 },
					fuz_schema: { minified: 16_000, gzip: 4000 }
				},
				rows: [
					{
						name: 'a report',
						valid: true,
						sides: {
							zod: to_cell(130_000, 310_000),
							zod_jitless: to_cell(480_000, 780_000),
							zod_compiled: to_cell(48_000, 50_000),
							fuz_schema: to_cell(86_000, 88)
						}
					},
					{
						name: 'an error',
						valid: true,
						sides: {
							zod: to_cell(2400, 7000),
							zod_jitless: to_cell(7000, 15_500),
							zod_compiled: { time: UNCOMPILED, bytes: UNCOMPILED },
							fuz_schema: to_cell(1300, 88)
						}
					},
					{
						name: 'a report, last presence unknown',
						valid: false,
						sides: {
							zod: to_cell(140_000, 316_000),
							zod_jitless: to_cell(477_000, 788_000),
							zod_compiled: to_cell(240_000, 331_000),
							fuz_schema: to_cell(82_000, 240)
						}
					}
				],
				asides: [
					{ name: 'the URL checks of a report', ns: 470, batch_ns: 440, spread: SPREAD, bytes: 168 }
				]
			},
			{
				name: 'analysis',
				title: "an invented consumer's analysis output, in valibot and in this library",
				reference: 'valibot',
				root: 'ModuleAnalysis',
				sides: [
					{ id: 'valibot', label: 'valibot' },
					{ id: 'fuz_schema', label: 'fuz_schema' }
				],
				bundles: {
					valibot: { minified: 9000, gzip: 3100 },
					fuz_schema: { minified: 6800, gzip: 2400 }
				},
				rows: [
					{
						name: 'a module',
						valid: true,
						sides: { valibot: to_cell(21_000, 9000), fuz_schema: to_cell(8000, 1200) }
					},
					{
						name: 'a module with a wrong kind',
						valid: false,
						sides: { valibot: to_cell(24_000, 11_000), fuz_schema: to_cell(8500, 1500) }
					}
				],
				asides: []
			}
		]
	};
};

/** The libraries taken to hand back the schema they built before, on a scenario that isn't recursive. */
const is_interned = (lib: LibName, scenario: { recursive: boolean }): boolean =>
	lib === 'arktype' && !scenario.recursive;

const create_allocations = (): BenchmarkData['allocations'] => ({
	rows: SCENARIOS.map((scenario) => ({
		scenario: scenario.name,
		libs: to_libs((lib) => ({
			// a check builds nothing, and this library returns its input
			valid_bytes:
				lib === 'typebox'
					? 0
					: Math.round((scenario.ns / 10) * (lib === 'fuz_schema' ? 1 : VALID[lib] * 3)),
			invalid_bytes: lib === 'typebox' ? 0 : Math.round(scenario.ns * INVALID[lib]),
			create_bytes: Math.round(scenario.bytes * HELD[lib]),
			create_ns: round(scenario.bytes * HELD[lib] * 0.15),
			interned: is_interned(lib, scenario)
		}))
	}))
});

const create_bundle = (): BenchmarkData['bundle'] => {
	const to_sizes = (bytes: number, lib: LibName): BenchmarkData['bundle']['all'][string] => {
		// the library's code is paid once, so a larger scenario narrows the ratio
		const gzip = Math.round(bytes + 400 * (SIZE[lib] - 1));
		return { minified: Math.round(gzip * 2.6), gzip, brotli: Math.round(gzip * 0.9) };
	};
	return {
		rows: SCENARIOS.map((scenario) => ({
			scenario: scenario.name,
			libs: to_libs((lib) => to_sizes(scenario.bytes, lib))
		})),
		all: to_libs((lib) => to_sizes(3000, lib)),
		library: {
			measure: 'gzip',
			parse: 170,
			library: 4100,
			exports: [
				{ name: 'object', alone: 530, last_in: 90 },
				{ name: 'pipe', alone: 210, last_in: 130 },
				{ name: 'union', alone: 420, last_in: 80 }
			],
			modules: [
				{ name: 'meta.ts', added: 50 },
				{ name: 'json_schema.ts', added: 4100 }
			]
		}
	};
};

const create_types = (): BenchmarkData['types'] => {
	const to_cost = (instantiations: number): BenchmarkData['types']['empty'] => ({
		instantiations: Math.round(instantiations),
		types: Math.round(instantiations / 3) + 85,
		memory_kb: 120_000 + Math.round(instantiations / 2),
		check_s: round(instantiations / 100_000)
	});
	return {
		runs: 3,
		empty: to_cost(0),
		modules: to_libs((lib) => to_cost(14_000 * TYPES[lib])),
		reads: ['t.string.length', 't.object_flat.name'],
		with_reads: to_libs((lib) => ({
			...to_cost(12_000 * TYPES[lib]),
			reads_add: Math.round(700 / TYPES[lib])
		}))
	};
};

const create_coldstart = (): BenchmarkData['coldstart'] => ({
	samples: 15,
	discard: 2,
	bare: { ms: 16.5, band_ms: 2.3, rss_kb: 47_900 },
	rows: SCENARIOS.filter(
		(scenario) => scenario.name === 'object_flat' || scenario.name === 'app'
	).flatMap((scenario) =>
		(['bundled', 'unbundled'] as const).map((form) => ({
			scenario: scenario.name,
			form,
			libs: to_libs((lib) => {
				// loading the code is most of a cold start, so it follows the bytes
				const load = round((form === 'bundled' ? 0.4 : 1.5) * (1 + (SIZE[lib] - 1) / 4));
				const first = round(load + (scenario.ns * VALID[lib]) / 1000);
				const to_stage = (work_ms: number) => ({ work_ms: round(work_ms), band_ms: 0.05 });
				return {
					stages: {
						import: to_stage(load),
						create: to_stage(load + 0.07),
						first_parse: to_stage(first + 0.07),
						parse_10: to_stage(first + 0.12),
						parse_100: to_stage(first + 0.25)
					},
					later_ms: round(0.17 * VALID[lib]),
					later_band_ms: round(0.017 * VALID[lib], 3),
					// under the bare band for the lightest, which a page must not draw as an addition
					added_ms: round(first + 0.07),
					added_rss_kb: Math.round(1300 * SIZE[lib] ** 0.5),
					rss_band_kb: 120
				};
			})
		}))
	)
});

const create_heap = (): BenchmarkData['heap'] => ({
	counts: { few: 50, many: 250 },
	rows: SCENARIOS.filter(
		(scenario) => scenario.name === 'object_flat' || scenario.name === 'type_json'
	).map((scenario) => ({
		scenario: scenario.name,
		libs: to_libs((lib) => {
			const heap_bytes = Math.round(30 * scenario.bytes * HELD[lib]);
			const code_bytes = Math.round(heap_bytes / 3);
			const external_bytes = lib === 'arktype' ? 2_400_000 : 0;
			const interned = is_interned(lib, scenario);
			return {
				heap_bytes,
				code_bytes,
				external_bytes,
				total_bytes: heap_bytes + code_bytes + external_bytes,
				// one kept schema repeated holds next to nothing more a schema
				further_schema_bytes: interned ? 130 : Math.round(scenario.bytes * HELD[lib] * 0.9),
				interned
			};
		})
	}))
});

const create_wasm = (): BenchmarkData['wasm'] => {
	const to_rows = (
		js_ns: number,
		wasm_factor: number
	): BenchmarkData['wasm']['payloads'][number]['rows'] => [
		{
			holding: null,
			side: 'reference',
			label: 'JSON.parse(text)',
			ns: js_ns * 0.8,
			min_ns: js_ns * 0.78,
			vs_js: null
		},
		{
			holding: 'string',
			side: 'js',
			label: 'JSON.parse, is',
			ns: js_ns,
			min_ns: js_ns * 0.98,
			vs_js: null
		},
		{
			holding: 'string',
			side: 'wasm',
			label: 'wasm matches_json(text)',
			ns: js_ns * wasm_factor,
			min_ns: js_ns * wasm_factor * 0.98,
			vs_js: wasm_factor
		},
		{
			holding: 'bytes',
			side: 'js',
			label: 'TextDecoder, JSON.parse, is',
			ns: js_ns * 1.2,
			min_ns: js_ns * 1.18,
			vs_js: null
		},
		{
			holding: 'bytes',
			side: 'wasm',
			label: 'wasm matches_json_bytes(bytes)',
			ns: js_ns * 1.2 * wasm_factor * 0.9,
			min_ns: js_ns * 1.2 * wasm_factor * 0.88,
			vs_js: round(wasm_factor * 0.9)
		}
	];
	return {
		rounds: 15,
		round_ms: 20,
		wasm_bytes: 250_000,
		wasm_gzip_bytes: 99_000,
		payloads: [
			{
				size: '1 item',
				outcome: 'valid',
				items: 1,
				bytes: 134,
				code_units: 134,
				rows: to_rows(850, 0.6)
			},
			{
				size: '4 MB',
				outcome: 'valid',
				items: 28_000,
				bytes: 4_000_100,
				code_units: 4_000_100,
				rows: to_rows(24_000_000, 0.57)
			},
			{
				size: '4 MB',
				outcome: 'first_bad',
				items: 28_000,
				bytes: 4_000_090,
				code_units: 4_000_090,
				rows: to_rows(14_000_000, 0.03)
			}
		]
	};
};

const MACHINE_STATE: BenchmarkResults['meta']['machine_start'] = {
	node: 'v24.14.1',
	load: [0.1, 0.2, 0.3],
	cpu_mhz: [4000, 4100, 4200, 4300],
	governor: 'performance',
	scaling_driver: 'fixture-pstate',
	energy_performance_preference: 'performance',
	boost: true
};

/**
 * Builds the fixture: a complete results file whose every number is invented,
 * of the kind `fixture`, so it is never publishable.
 */
export const create_fixture_results = (): BenchmarkResults => ({
	meta: {
		generated_at: '2026-01-01T00:00:00.000Z',
		kind: 'fixture',
		only: null,
		machine: { name: 'fixture', cpu: 'Fixture CPU (invented numbers)' },
		machine_start: MACHINE_STATE,
		machine_end: { ...MACHINE_STATE, load: [1, 0.8, 0.5] },
		node: 'v24.14.1',
		v8: '13.6.0-fixture',
		commit: '0'.repeat(40),
		dirty: false,
		commit_end: '0'.repeat(40),
		dirty_end: false,
		duration_ms: 1_800_000,
		libs: LIB_NAMES.map((id, i) => ({ id, ...RESULTS_LIB_INFO[id], version: `0.0.${i}` })),
		tools: { rolldown: '0.0.0', typescript: '0.0.0' }
	},
	bundle: to_section('bundle', create_bundle()),
	types: to_section('types', create_types()),
	allocations: to_section('allocations', create_allocations()),
	heap: to_section('heap', create_heap()),
	coldstart: to_section('coldstart', create_coldstart()),
	run: to_section('run', create_run()),
	survey: to_section('survey', create_survey()),
	harvest: to_section('harvest', create_harvest()),
	wasm: to_section('wasm', create_wasm())
});
