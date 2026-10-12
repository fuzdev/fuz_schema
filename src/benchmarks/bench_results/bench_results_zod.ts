/**
 * syntax-highlighter-bench's schema of a results document, as it writes it for
 * zod: what its site and its publish step read a run's results through. A
 * snapshot, taken from https://github.com/ryanatkn/syntax-highlighter-bench at
 * 507cadb74dbf (`src/lib/results_schema.ts`), MIT licensed, copyright Ryan
 * Atkinson.
 *
 * This is the document's structure and not all of its checking. Left out is
 * what doesn't validate (comments, type exports, `.meta()` descriptions, the
 * helper functions beside the schemas, the error text of its two unions) and
 * every `.refine` and `.superRefine`: the cross-references of the document as a
 * whole, the checks of one field against another, and three on a single string
 * (a version that is not `unknown`, and two paths with no `.` or `..` segment).
 * The id lists it imports are written in. What it accepts is what the zod
 * installed here accepts, which need not be the consumer's.
 *
 * `bench_results_fuz_schema.ts` is the same schemas in this library, and
 * `src/test/harvest.test.ts` holds the two to the same answers.
 *
 * @module
 */

import { z } from 'zod';

const Id = z.string().min(1);

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const NAME_MATCHER = /^[a-z][a-z0-9_]*$/;

const LibraryId = z.string().regex(NAME_MATCHER);

const LangId = z.string().regex(NAME_MATCHER);

const strict_record = <TKey extends z.ZodType<string, string>, TValue extends z.ZodType>(
	key: TKey,
	value: TValue
) =>
	z
		.custom<unknown>(
			(v) => typeof v !== 'object' || v === null || !Object.hasOwn(v, '__proto__'),
			'a "__proto__" key is not allowed'
		)
		.pipe(z.record(key, value));

export const BenchMachine = z.strictObject({
	name: Id,
	cpu: z.string().min(1),
	threads: z.number().int().positive().nullable(),
	governor: z.string().min(1).nullable(),
	cpufreq_driver: z.string().min(1).nullable(),
	epp: z.string().min(1).nullable(),
	boost: z.boolean().nullable(),
	memory_gb: z.number().positive(),
	os_release: z.string().min(1)
});

export const BenchAnchor = z.strictObject({
	drift: z.number(),
	stable: z.boolean()
});

export const BenchOutputKind = z.enum(['classes', 'inline_styles']);

export const BenchColorScheme = z.enum(['light', 'dark']);

export const BenchEngineKind = z.enum(['scanner', 'grammar_vm', 'regex', 'textmate']);

export const BenchLibrary = z.strictObject({
	id: LibraryId,
	label: z.string().min(1),
	package: z.string().min(1),
	version: z.string().min(1),
	output: BenchOutputKind,
	engine: BenchEngineKind,
	by_maintainer: z.boolean(),
	note: z.string().min(1).nullable(),
	extra_packages: z.record(z.string().min(1), z.string().min(1)).optional(),
	theme_schemes: z.array(BenchColorScheme).min(1)
});

export const BenchExcluded = z.strictObject({
	cell: Id,
	library: LibraryId,
	reason: z.string().min(1)
});

export const BenchNoiseFloor = z.strictObject({
	per_cell: z.number().nonnegative(),
	geomean: z.number().nonnegative(),
	per_process: z.number().nonnegative().nullable()
});

export const BenchProcessNoise = z.strictObject({
	pairs: z.number().int().positive(),
	median: z.number().nonnegative(),
	p95: z.number().nonnegative(),
	max: z.number().nonnegative()
});

export const BenchSize = z.enum(['micro', 'small', 'medium', 'large']);

export const BenchMode = z.enum(['tokenize', 'html']);

export const BenchSource = z.enum(['neutral', 'shiki', 'home', 'harness', 'stress']);

export const BenchRunKind = z.enum(['full', 'smoke', 'calibrate']);

export const BenchRunMetric = z.enum(['throughput', 'startup']);

export const BenchRunFilters = z.strictObject({
	libraries: z.array(LibraryId).min(1).nullable(),
	langs: z.array(LangId).min(1).nullable(),
	sizes: z.array(BenchSize).min(1).nullable(),
	modes: z.array(BenchMode).min(1).nullable(),
	sources: z.array(BenchSource).min(1).nullable(),
	metrics: z.array(BenchRunMetric).min(1).nullable()
});

export const BenchRun = z.strictObject({
	kind: BenchRunKind,
	passes: z.number().int().positive(),
	rounds: z.number().int().positive(),
	target_ms: z.number().positive(),
	warmup_ms: z.number().nonnegative(),
	rewarm_ms: z.number().nonnegative(),
	retries: z.number().int().nonnegative(),
	loaded_langs: z.literal('cell'),
	collection: z.literal('minor'),
	startup_samples: z.number().int().positive().nullable(),
	startup_discard: z.number().int().nonnegative().nullable(),
	startup_compile_cache: z.literal('disabled').nullable(),
	filters: BenchRunFilters,
	segments: z.number().int().positive(),
	duration_ms: z.number().int().nonnegative(),
	load_at_start: z.number().nonnegative()
});

const bundler_vite = z.string().min(1);

const bundler_shape = {
	esbuild: z.string().min(1),
	gzip_level: z.number().int().min(1).max(9),
	brotli_quality: z.number().int().min(0).max(11)
};

export const BenchBundlerRolldown = z.strictObject({
	vite: bundler_vite,
	rolldown: z.string().min(1),
	...bundler_shape
});

export const BenchBundlerRollup = z.strictObject({
	vite: bundler_vite,
	rollup: z.string().min(1),
	...bundler_shape
});

export const BenchBundler = z.union([BenchBundlerRolldown, BenchBundlerRollup]);

export const BenchStartupScenario = z.enum(['bare', 'core', 'lang', 'set', 'first_highlight']);

const startup_key_shape = {
	scenario: BenchStartupScenario,
	library: LibraryId.nullable(),
	lang: LangId.nullable(),
	set: Id.nullable(),
	bundled: z.boolean()
};

export const BenchStartup = z.strictObject({
	...startup_key_shape,
	samples: z.number().int().positive(),
	median_ms: z.number().positive(),
	p10_ms: z.number().positive(),
	p90_ms: z.number().positive(),
	spread: z.number().min(1),
	rss_peak_bytes: z.number().int().positive()
});

export const BenchStartupExcluded = z.strictObject({
	...startup_key_shape,
	library: LibraryId,
	reason: z.string().min(1)
});

export const BenchMeta = z.strictObject({
	generated_at: z.iso.datetime().nullable(),
	machine: BenchMachine.nullable(),
	node: z.string().min(1).nullable(),
	commit: z
		.string()
		.regex(/^[0-9a-f]{40}(-dirty)?$/)
		.nullable(),
	corpus_hash: Sha256,
	run: BenchRun.nullable(),
	anchor: BenchAnchor.nullable(),
	libraries: z.array(BenchLibrary),
	excluded: z.array(BenchExcluded),
	startup_excluded: z.array(BenchStartupExcluded),
	noise_floor: BenchNoiseFloor.nullable(),
	process_noise: BenchProcessNoise.nullable(),
	bundler: BenchBundler.nullable()
});

export const BenchLang = z.strictObject({
	id: LangId,
	label: z.string().min(1),
	timed: z.boolean()
});

export const BenchSet = z.strictObject({
	id: Id,
	label: z.string().min(1),
	langs: z.array(LangId),
	footnote: z.string().min(1).nullable()
});

export const BenchMetric = z.enum(['throughput']);

export const BenchProvenance = z.strictObject({
	repo: z.string().regex(/^https:\/\/[^\s/?#@]+(\/[^\s/?#@]+)+$/),
	commit: z.string().regex(/^[0-9a-f]{40}$/),
	path: z.string().min(1),
	sha256: Sha256,
	license: z.string().min(1),
	note: z.string().min(1).nullable()
});

export const BenchInput = z.strictObject({
	file: z.string().min(1),
	source: BenchSource,
	home: LibraryId.nullable(),
	lang: LangId,
	size: BenchSize,
	bytes: z.number().int().positive(),
	lines: z.number().int().positive(),
	sha256: Sha256,
	synthetic: z.boolean(),
	provenance: z.array(BenchProvenance),
	derivation: z.string().min(1).nullable()
});

export const BenchCellValue = z.strictObject({
	ns_per_op: z.number().positive(),
	ops_per_sec: z.number().positive(),
	mb_per_sec: z.number().positive(),
	p10_ns: z.number().positive(),
	p90_ns: z.number().positive(),
	spread: z.number().min(1),
	pass_medians_ns: z.array(z.number().positive()).min(1),
	iterations: z.number().int().positive(),
	rss_peak_bytes: z.number().int().positive(),
	attempts: z.number().int().positive()
});

export const BenchCellOutput = z.strictObject({
	html_bytes: z.number().int().positive(),
	spans: z.number().int().nonnegative()
});

export const BenchCellCompressed = z.strictObject({
	gzip: z.number().int().positive(),
	brotli: z.number().int().positive()
});

export const BenchCell = z.strictObject({
	id: Id,
	metric: BenchMetric,
	lang: LangId,
	size: BenchSize,
	mode: BenchMode,
	source: BenchSource,
	home: LibraryId.nullable(),
	file: z.string().min(1),
	bytes: z.number().int().positive(),
	lines: z.number().int().positive(),
	synthetic: z.boolean(),
	values: strict_record(LibraryId, BenchCellValue),
	tokens: strict_record(LibraryId, z.number().int().positive()),
	output: strict_record(LibraryId, BenchCellOutput),
	compressed: strict_record(LibraryId, BenchCellCompressed)
});

const byte_sizes_shape = {
	raw: z.number().int().positive(),
	gzip: z.number().int().positive(),
	brotli: z.number().int().positive()
};

export const BenchByteSizes = z.strictObject(byte_sizes_shape);

export const BenchBundleSizes = z.strictObject({
	...byte_sizes_shape,
	wasm: BenchByteSizes.nullable(),
	css: BenchByteSizes.nullable()
});

export const BenchInstall = z.strictObject({
	packages: z.number().int().positive(),
	files: z.number().int().positive(),
	bytes: z.number().int().positive(),
	closure: Sha256
});

export const BenchHeap = z.strictObject({
	retained_kb: z.number().int().nonnegative(),
	code_kb: z.number().int().nonnegative(),
	external_kb: z.number().int().nonnegative()
});

export const BenchBundleUnsupported = z.strictObject({
	unsupported: z.array(LangId).min(1)
});

export const BenchBundleEntry = z.union([BenchBundleSizes, BenchBundleUnsupported]);

export const BenchCoverageEntry = z.union([
	z.literal(true),
	z.strictObject({ via: z.string().min(1) })
]);

export const BenchResults = z.strictObject({
	meta: BenchMeta,
	langs: z.array(BenchLang),
	sets: z.array(BenchSet),
	inputs: z.array(BenchInput),
	cells: z.array(BenchCell),
	startup: z.array(BenchStartup),
	bundle: strict_record(LibraryId, strict_record(Id, BenchBundleEntry)),
	install: strict_record(LibraryId, BenchInstall),
	heap: strict_record(LibraryId, strict_record(LangId, BenchHeap)),
	coverage: strict_record(LibraryId, strict_record(LangId, BenchCoverageEntry))
});
