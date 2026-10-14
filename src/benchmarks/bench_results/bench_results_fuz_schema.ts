/**
 * syntax-highlighter-bench's results schemas in this library:
 * `bench_results_zod.ts` rewritten call for call, in the same order. It takes
 * the library as a parameter so `grade` can build it against two versions.
 *
 * What stands in for what zod has built in:
 *
 * - `z.number()` is `number`, as both take no infinity.
 * - `.int()` is `safe_integer`, `.nonnegative()` is `min_value(0)`, and
 *   `.positive()`, which has no bound to state, is a `check`.
 * - `.min(1)` on a string or an array is `min_length(1)`.
 * - `z.iso.datetime()` is a `regex` with the pattern zod uses when given no
 *   options.
 * - `strict_record(key, value)`, a record with checked keys that refuses a
 *   `__proto__` key, is `record(value)` between two checks, since `record`
 *   takes any key. `extra_packages`, whose keys are only non-empty, is a
 *   `record` with a check that it has no empty key.
 *
 * And what differs: zod's `record` leaves out a `__proto__` key unvalidated,
 * where `record` here validates its value first, and where zod reports the
 * issues of a union's one option that got past its first check, this library
 * reports the union.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

type SchemaLib = typeof schema_lib;

/** The schemas `create_bench_results` returns, typed loosely: they are run, not inferred from. */
export type BenchResultsSchemas = Record<
	| 'BenchMachine'
	| 'BenchAnchor'
	| 'BenchOutputKind'
	| 'BenchColorScheme'
	| 'BenchEngineKind'
	| 'BenchLibrary'
	| 'BenchExcluded'
	| 'BenchNoiseFloor'
	| 'BenchProcessNoise'
	| 'BenchSize'
	| 'BenchMode'
	| 'BenchSource'
	| 'BenchRunKind'
	| 'BenchRunMetric'
	| 'BenchRunFilters'
	| 'BenchRun'
	| 'BenchBundlerRolldown'
	| 'BenchBundlerRollup'
	| 'BenchBundler'
	| 'BenchStartupScenario'
	| 'BenchStartup'
	| 'BenchStartupExcluded'
	| 'BenchMeta'
	| 'BenchLang'
	| 'BenchSet'
	| 'BenchMetric'
	| 'BenchProvenance'
	| 'BenchInput'
	| 'BenchCellValue'
	| 'BenchCellOutput'
	| 'BenchCellCompressed'
	| 'BenchCell'
	| 'BenchByteSizes'
	| 'BenchBundleSizes'
	| 'BenchInstall'
	| 'BenchHeap'
	| 'BenchBundleUnsupported'
	| 'BenchBundleEntry'
	| 'BenchCoverageEntry'
	| 'BenchResults',
	schema_lib.AnySchema
>;

export const create_bench_results = (s: SchemaLib): BenchResultsSchemas => {
	const Id = s.pipe(s.string, s.min_length(1));

	const Sha256 = s.pipe(s.string, s.regex(/^[0-9a-f]{64}$/));

	const NAME_MATCHER = /^[a-z][a-z0-9_]*$/;

	const LibraryId = s.pipe(s.string, s.regex(NAME_MATCHER));

	const LangId = s.pipe(s.string, s.regex(NAME_MATCHER));

	// the pattern of `z.iso.datetime()` with no options: a date that exists and a
	// time in UTC with its seconds, their fraction optional
	const DATETIME =
		/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

	// what an `Id` is, as a pattern
	const NOT_EMPTY = /[^]/;

	// a `record` whose keys match `key`, and that refuses a `__proto__` key where
	// `record` alone would leave it out
	const strict_record = (key: RegExp, value: schema_lib.AnySchema): schema_lib.AnySchema =>
		s.pipe(
			s.unknown,
			s.check(
				(v: unknown) => typeof v !== 'object' || v === null || !Object.hasOwn(v, '__proto__'),
				'no "__proto__" key'
			),
			s.record(value),
			s.check((v: Record<string, unknown>) => {
				// a loop and not `Object.keys`, which would allocate on every record
				for (const k in v) if (Object.hasOwn(v, k) && !key.test(k)) return false;
				return true;
			}, 'keys that are ids')
		);

	const BenchMachine = s.object({
		name: Id,
		cpu: s.pipe(s.string, s.min_length(1)),
		threads: s.nullable(
			s.pipe(
				s.number,
				s.safe_integer,
				s.check((v: number) => v > 0, '> 0')
			)
		),
		governor: s.nullable(s.pipe(s.string, s.min_length(1))),
		cpufreq_driver: s.nullable(s.pipe(s.string, s.min_length(1))),
		epp: s.nullable(s.pipe(s.string, s.min_length(1))),
		boost: s.nullable(s.boolean),
		memory_gb: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		os_release: s.pipe(s.string, s.min_length(1))
	});

	const BenchAnchor = s.object({
		drift: s.number,
		stable: s.boolean
	});

	const BenchOutputKind = s.one_of(['classes', 'inline_styles']);

	const BenchColorScheme = s.one_of(['light', 'dark']);

	const BenchEngineKind = s.one_of(['scanner', 'grammar_vm', 'regex', 'textmate']);

	const BenchLibrary = s.object({
		id: LibraryId,
		label: s.pipe(s.string, s.min_length(1)),
		package: s.pipe(s.string, s.min_length(1)),
		version: s.pipe(s.string, s.min_length(1)),
		output: BenchOutputKind,
		engine: BenchEngineKind,
		by_maintainer: s.boolean,
		note: s.nullable(s.pipe(s.string, s.min_length(1))),
		extra_packages: s.optional(
			s.pipe(
				s.record(s.pipe(s.string, s.min_length(1))),
				// the one key `z.string().min(1)` refuses
				s.check((v: Record<string, string>) => !Object.hasOwn(v, ''), 'no empty key')
			)
		),
		theme_schemes: s.pipe(s.array(BenchColorScheme), s.min_length(1))
	});

	const BenchExcluded = s.object({
		cell: Id,
		library: LibraryId,
		reason: s.pipe(s.string, s.min_length(1))
	});

	const BenchNoiseFloor = s.object({
		per_cell: s.pipe(s.number, s.min_value(0)),
		geomean: s.pipe(s.number, s.min_value(0)),
		per_process: s.nullable(s.pipe(s.number, s.min_value(0)))
	});

	const BenchProcessNoise = s.object({
		pairs: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		median: s.pipe(s.number, s.min_value(0)),
		p95: s.pipe(s.number, s.min_value(0)),
		max: s.pipe(s.number, s.min_value(0))
	});

	const BenchSize = s.one_of(['micro', 'small', 'medium', 'large']);

	const BenchMode = s.one_of(['tokenize', 'html']);

	const BenchSource = s.one_of(['neutral', 'shiki', 'home', 'harness', 'stress']);

	const BenchRunKind = s.one_of(['full', 'smoke', 'calibrate']);

	const BenchRunMetric = s.one_of(['throughput', 'startup']);

	const BenchRunFilters = s.object({
		libraries: s.nullable(s.pipe(s.array(LibraryId), s.min_length(1))),
		langs: s.nullable(s.pipe(s.array(LangId), s.min_length(1))),
		sizes: s.nullable(s.pipe(s.array(BenchSize), s.min_length(1))),
		modes: s.nullable(s.pipe(s.array(BenchMode), s.min_length(1))),
		sources: s.nullable(s.pipe(s.array(BenchSource), s.min_length(1))),
		metrics: s.nullable(s.pipe(s.array(BenchRunMetric), s.min_length(1)))
	});

	const BenchRun = s.object({
		kind: BenchRunKind,
		passes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		rounds: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		target_ms: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		warmup_ms: s.pipe(s.number, s.min_value(0)),
		rewarm_ms: s.pipe(s.number, s.min_value(0)),
		retries: s.pipe(s.number, s.safe_integer, s.min_value(0)),
		loaded_langs: s.literal('cell'),
		collection: s.literal('minor'),
		startup_samples: s.nullable(
			s.pipe(
				s.number,
				s.safe_integer,
				s.check((v: number) => v > 0, '> 0')
			)
		),
		startup_discard: s.nullable(s.pipe(s.number, s.safe_integer, s.min_value(0))),
		startup_compile_cache: s.nullable(s.literal('disabled')),
		filters: BenchRunFilters,
		segments: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		duration_ms: s.pipe(s.number, s.safe_integer, s.min_value(0)),
		load_at_start: s.pipe(s.number, s.min_value(0))
	});

	const bundler_vite = s.pipe(s.string, s.min_length(1));

	const bundler_shape = {
		esbuild: s.pipe(s.string, s.min_length(1)),
		gzip_level: s.pipe(s.number, s.safe_integer, s.min_value(1), s.max_value(9)),
		brotli_quality: s.pipe(s.number, s.safe_integer, s.min_value(0), s.max_value(11))
	};

	const BenchBundlerRolldown = s.object({
		vite: bundler_vite,
		rolldown: s.pipe(s.string, s.min_length(1)),
		...bundler_shape
	});

	const BenchBundlerRollup = s.object({
		vite: bundler_vite,
		rollup: s.pipe(s.string, s.min_length(1)),
		...bundler_shape
	});

	const BenchBundler = s.union([BenchBundlerRolldown, BenchBundlerRollup]);

	const BenchStartupScenario = s.one_of(['bare', 'core', 'lang', 'set', 'first_highlight']);

	const startup_key_shape = {
		scenario: BenchStartupScenario,
		library: s.nullable(LibraryId),
		lang: s.nullable(LangId),
		set: s.nullable(Id),
		bundled: s.boolean
	};

	const BenchStartup = s.object({
		...startup_key_shape,
		samples: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		median_ms: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		p10_ms: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		p90_ms: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		spread: s.pipe(s.number, s.min_value(1)),
		rss_peak_bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		)
	});

	const BenchStartupExcluded = s.object({
		...startup_key_shape,
		library: LibraryId,
		reason: s.pipe(s.string, s.min_length(1))
	});

	const BenchMeta = s.object({
		generated_at: s.nullable(s.pipe(s.string, s.regex(DATETIME, 'an ISO datetime'))),
		machine: s.nullable(BenchMachine),
		node: s.nullable(s.pipe(s.string, s.min_length(1))),
		commit: s.nullable(s.pipe(s.string, s.regex(/^[0-9a-f]{40}(-dirty)?$/))),
		corpus_hash: Sha256,
		run: s.nullable(BenchRun),
		anchor: s.nullable(BenchAnchor),
		libraries: s.array(BenchLibrary),
		excluded: s.array(BenchExcluded),
		startup_excluded: s.array(BenchStartupExcluded),
		noise_floor: s.nullable(BenchNoiseFloor),
		process_noise: s.nullable(BenchProcessNoise),
		bundler: s.nullable(BenchBundler)
	});

	const BenchLang = s.object({
		id: LangId,
		label: s.pipe(s.string, s.min_length(1)),
		timed: s.boolean
	});

	const BenchSet = s.object({
		id: Id,
		label: s.pipe(s.string, s.min_length(1)),
		langs: s.array(LangId),
		footnote: s.nullable(s.pipe(s.string, s.min_length(1)))
	});

	const BenchMetric = s.one_of(['throughput']);

	const BenchProvenance = s.object({
		repo: s.pipe(s.string, s.regex(/^https:\/\/[^\s/?#@]+(\/[^\s/?#@]+)+$/)),
		commit: s.pipe(s.string, s.regex(/^[0-9a-f]{40}$/)),
		path: s.pipe(s.string, s.min_length(1)),
		sha256: Sha256,
		license: s.pipe(s.string, s.min_length(1)),
		note: s.nullable(s.pipe(s.string, s.min_length(1)))
	});

	const BenchInput = s.object({
		file: s.pipe(s.string, s.min_length(1)),
		source: BenchSource,
		home: s.nullable(LibraryId),
		lang: LangId,
		size: BenchSize,
		bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		lines: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		sha256: Sha256,
		synthetic: s.boolean,
		provenance: s.array(BenchProvenance),
		derivation: s.nullable(s.pipe(s.string, s.min_length(1)))
	});

	const BenchCellValue = s.object({
		ns_per_op: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		ops_per_sec: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		mb_per_sec: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		p10_ns: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		p90_ns: s.pipe(
			s.number,
			s.check((v: number) => v > 0, '> 0')
		),
		spread: s.pipe(s.number, s.min_value(1)),
		pass_medians_ns: s.pipe(
			s.array(
				s.pipe(
					s.number,
					s.check((v: number) => v > 0, '> 0')
				)
			),
			s.min_length(1)
		),
		iterations: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		rss_peak_bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		attempts: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		)
	});

	const BenchCellOutput = s.object({
		html_bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		spans: s.pipe(s.number, s.safe_integer, s.min_value(0))
	});

	const BenchCellCompressed = s.object({
		gzip: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		brotli: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		)
	});

	const BenchCell = s.object({
		id: Id,
		metric: BenchMetric,
		lang: LangId,
		size: BenchSize,
		mode: BenchMode,
		source: BenchSource,
		home: s.nullable(LibraryId),
		file: s.pipe(s.string, s.min_length(1)),
		bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		lines: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		synthetic: s.boolean,
		values: strict_record(NAME_MATCHER, BenchCellValue),
		tokens: strict_record(
			NAME_MATCHER,
			s.pipe(
				s.number,
				s.safe_integer,
				s.check((v: number) => v > 0, '> 0')
			)
		),
		output: strict_record(NAME_MATCHER, BenchCellOutput),
		compressed: strict_record(NAME_MATCHER, BenchCellCompressed)
	});

	const byte_sizes_shape = {
		raw: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		gzip: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		brotli: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		)
	};

	const BenchByteSizes = s.object(byte_sizes_shape);

	const BenchBundleSizes = s.object({
		...byte_sizes_shape,
		wasm: s.nullable(BenchByteSizes),
		css: s.nullable(BenchByteSizes)
	});

	const BenchInstall = s.object({
		packages: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		files: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		bytes: s.pipe(
			s.number,
			s.safe_integer,
			s.check((v: number) => v > 0, '> 0')
		),
		closure: Sha256
	});

	const BenchHeap = s.object({
		retained_kb: s.pipe(s.number, s.safe_integer, s.min_value(0)),
		code_kb: s.pipe(s.number, s.safe_integer, s.min_value(0)),
		external_kb: s.pipe(s.number, s.safe_integer, s.min_value(0))
	});

	const BenchBundleUnsupported = s.object({
		unsupported: s.pipe(s.array(LangId), s.min_length(1))
	});

	const BenchBundleEntry = s.union([BenchBundleSizes, BenchBundleUnsupported]);

	const BenchCoverageEntry = s.union([
		s.literal(true),
		s.object({ via: s.pipe(s.string, s.min_length(1)) })
	]);

	const BenchResults = s.object({
		meta: BenchMeta,
		langs: s.array(BenchLang),
		sets: s.array(BenchSet),
		inputs: s.array(BenchInput),
		cells: s.array(BenchCell),
		startup: s.array(BenchStartup),
		bundle: strict_record(NAME_MATCHER, strict_record(NOT_EMPTY, BenchBundleEntry)),
		install: strict_record(NAME_MATCHER, BenchInstall),
		heap: strict_record(NAME_MATCHER, strict_record(NAME_MATCHER, BenchHeap)),
		coverage: strict_record(NAME_MATCHER, strict_record(NAME_MATCHER, BenchCoverageEntry))
	});

	return {
		BenchMachine,
		BenchAnchor,
		BenchOutputKind,
		BenchColorScheme,
		BenchEngineKind,
		BenchLibrary,
		BenchExcluded,
		BenchNoiseFloor,
		BenchProcessNoise,
		BenchSize,
		BenchMode,
		BenchSource,
		BenchRunKind,
		BenchRunMetric,
		BenchRunFilters,
		BenchRun,
		BenchBundlerRolldown,
		BenchBundlerRollup,
		BenchBundler,
		BenchStartupScenario,
		BenchStartup,
		BenchStartupExcluded,
		BenchMeta,
		BenchLang,
		BenchSet,
		BenchMetric,
		BenchProvenance,
		BenchInput,
		BenchCellValue,
		BenchCellOutput,
		BenchCellCompressed,
		BenchCell,
		BenchByteSizes,
		BenchBundleSizes,
		BenchInstall,
		BenchHeap,
		BenchBundleUnsupported,
		BenchBundleEntry,
		BenchCoverageEntry,
		BenchResults
	};
};
