/**
 * The results file: one run of the benchmark suite, composed by
 * `results_run.ts` from what each script wrote with its `--data` arg, and read
 * by the site, which renders one published file. Every reader goes through
 * `parse_benchmark_results`, so a malformed file fails the run that would have
 * written it and the build that would have rendered it.
 *
 * A file has a section for each script. A section that was measured holds the
 * script's data; one that wasn't says why, as `failed` or `skipped`, and holds
 * none. Inside a section, a cell that is not a number is an entry that says
 * why, a `BenchmarkMissing`, and never a `null` or a zero: a library that
 * can't express a shape, or `zod_compiled` where `z.compile` hands a root back
 * uncompiled. A figure that measures one kept definition repeated is a number
 * with its `interned` flag set.
 *
 * The file describes itself: `meta.libs` is the roster, and every per-library
 * record of a section is checked against it. The names of scenarios, survey
 * shapes, and harvested sets are the scripts', and are not listed here.
 *
 * Two classes of number, kept apart by what the site says of them: bytes and
 * instantiations are the same on any machine, and times come from the one
 * machine `meta.machine` names.
 *
 * Imported by the scripts as types only. The modules that load it are
 * `results_run.ts` and `results_publish.ts`, which measure nothing, and the
 * site's server loads.
 *
 * @module
 */

import * as s from '#lib/schema.ts';

/** Reports an issue at `path` under the value a `refined` schema checks, with `message`. */
export type ResultsIssueReporter = (path: Array<string | number>, message: string) => void;

// the value at `path` under `value`, which an issue names the type of
const value_at = (value: unknown, path: Array<string | number>): unknown => {
	let v: any = value;
	for (const key of path) v = v === null || typeof v !== 'object' ? undefined : v[key];
	return v;
};

/**
 * `schema`, then `fn` on its output, which reports each problem it finds
 * through `issue` at a path of its own: a rule across fields, which a `check`
 * could only fail as a whole. It runs only when `schema` passed.
 *
 * @param schema - the schema whose output `fn` checks
 * @param fn - reports every problem with the value, each at the path it is about
 */
export const refined = <T extends s.Schema>(
	schema: T,
	fn: (value: s.Infer<T>, issue: ResultsIssueReporter) => void
): s.PipeSchema<s.Infer<T>, T> => {
	const action: s.SchemaRefinement<s.Infer<T>> = {
		kind: 'refine',
		def: fn,
		run: (value, ctx) => {
			fn(value, (path, message) => {
				const count = ctx.fails;
				s.fail(ctx, 'refine', value_at(value, path));
				// past the parse's issue cap `fail` builds none, so read only the one it added
				const added = ctx.probe ? undefined : ctx.issues?.[count];
				if (added) {
					// a path is built innermost first, each parent pushing its key as the issue
					// bubbles out, and `parse` reverses it on return
					added.path = [...path].reverse();
					added.message = message;
				}
			});
			return value;
		}
	};
	return s.pipe(schema, action);
};

const positive = s.check((v: number) => v > 0, '> 0');

/** A string with at least one character. */
export const NonEmptyString = s.pipe(s.string, s.min_length(1));

/** A finite number above zero. */
export const PositiveNumber = s.pipe(s.number, positive);

/** A finite number at least zero. */
export const NonnegativeNumber = s.pipe(s.number, s.min_value(0));

/** A safe integer above zero. */
export const PositiveInt = s.pipe(s.number, s.safe_integer, positive);

/** A safe integer at least zero. */
export const NonnegativeInt = s.pipe(s.number, s.safe_integer, s.min_value(0));

/** The shape of a library id: lowercase, safe as a key. */
const LIB_ID_MATCHER = /^[a-z][a-z0-9_]*$/;

/** The id of a library, or of a side of a harvested set. */
export const BenchmarkLibId = s.pipe(s.string, s.regex(LIB_ID_MATCHER, 'a lowercase id'));

/** The scripts a run is composed of, in the order it runs them. */
export const BENCHMARK_IDS = [
	'bundle',
	'types',
	'allocations',
	'heap',
	'coldstart',
	'run',
	'survey',
	'harvest',
	'wasm'
] as const;
export type BenchmarkId = (typeof BENCHMARK_IDS)[number];

/**
 * The sections a run may leave out and still be whole: the wasm build of the
 * Rust crate needs wasm-pack and a build of its own, and compares no library
 * with another.
 */
export const OPTIONAL_BENCHMARK_IDS: ReadonlyArray<BenchmarkId> = ['wasm'];

/** Why a cell holds no number, in the order a reader meets them. */
export const BENCHMARK_MISSING_REASONS = ['uncompiled', 'no_equivalent', 'differs'] as const;

/**
 * A cell with no number, and why:
 *
 * - `uncompiled` - `zod_compiled` where `z.compile` hands the root back as it
 *   was, so the row would be Zod's own parser in another library's process
 * - `no_equivalent` - the library can't express the shape
 * - `differs` - the library gives the other verdict on the input, so the row
 *   would compare different work
 */
export const BenchmarkMissing = s.object({
	none: s.one_of(BENCHMARK_MISSING_REASONS),
	/** What the script says of this cell, where it says more than the reason. */
	why: s.nullable(NonEmptyString)
});
export type BenchmarkMissing = s.Infer<typeof BenchmarkMissing>;

// an issue on one line, with its path when it has one, for a cell's message
const format_issue_inline = (issue: s.SchemaIssue): string => {
	const message = issue.message ?? `expected ${issue.expected}, received ${issue.received}`;
	return issue.path.length === 0 ? message : `${issue.path.map(String).join('.')}: ${message}`;
};

/**
 * A cell: `figure`, or a `BenchmarkMissing`. An entry with a `none` key is
 * read as the latter and anything else as the figure, so a malformed cell is
 * reported against the shape it was meant to be and never as a bare union.
 */
const to_cell = <T extends s.Schema>(figure: T): s.Schema<s.Infer<T> | BenchmarkMissing, unknown> =>
	s.message(s.union([figure, BenchmarkMissing]), (_issue, input) => {
		const missing = typeof input === 'object' && input !== null && 'none' in input;
		const parsed = s.parse(missing ? BenchmarkMissing : figure, input);
		const problems = parsed.ok ? [] : parsed.issues.map(format_issue_inline);
		return `a cell is a figure or {none, why}; read as ${missing ? 'missing' : 'a figure'}: ${problems.join('; ')}`;
	}) as s.AnySchema;

/** Whether a cell holds no number. */
export const is_benchmark_missing = (cell: object): cell is BenchmarkMissing => 'none' in cell;

/** The regime a timing script ran in: every row in its library's process, or a process a row. */
export const BenchmarkRegime = s.one_of(['shared', 'alone']);

/** How a timing script's rows were timed. */
const timing_plan_shape = {
	regime: BenchmarkRegime,
	/** How many times the whole was repeated, in fresh processes. */
	passes: PositiveInt,
	/** Milliseconds each row of each library was timed for in all, over the passes. */
	duration_ms: PositiveNumber,
	/** Milliseconds a row was warmed for before each timing. */
	warm_ms: PositiveNumber
};

/**
 * What a function that does nothing takes through the loop the rows are timed
 * in, in nanoseconds: the least and the most across the processes. It is in
 * every figure of the section.
 */
const CallFloor = s.object({ min_ns: PositiveNumber, max_ns: PositiveNumber });

/** One row timed for one library, pooled over the passes. Nanoseconds per call. */
export const BenchmarkTiming = refined(
	s.object({
		/** The median of the passes, each the whole of a timing over its calls. */
		ns: PositiveNumber,
		/** The median of the passes' median batches: a wide gap from `ns` is collection time. */
		batch_ns: PositiveNumber,
		/** The fastest pass. */
		min_ns: PositiveNumber,
		/** The slowest pass. */
		max_ns: PositiveNumber,
		/** Half of what the passes range over, as a share of `ns`, and `null` of one pass. */
		spread: s.nullable(NonnegativeNumber)
	}),
	(timing, issue) => {
		if (!(timing.min_ns <= timing.ns && timing.ns <= timing.max_ns)) {
			issue(['ns'], 'the median is between the fastest and the slowest pass');
		}
	}
);
export type BenchmarkTiming = s.Infer<typeof BenchmarkTiming>;

const TimingCell = to_cell(BenchmarkTiming);

/** `npm run benchmark`: parse time per scenario, on its valid input, its invalid one, and as a guard. */
export const RunData = s.object({
	...timing_plan_shape,
	call: CallFloor,
	rows: s.array(
		s.object({
			scenario: NonEmptyString,
			/** `guard` is each library's guard on the valid input, which returns no output. */
			input: s.one_of(['valid', 'invalid', 'guard']),
			libs: s.record(TimingCell)
		})
	)
});
export type RunData = s.Infer<typeof RunData>;

/** One survey row timed for one library. */
export const SurveyTiming = s.object({
	ns: PositiveNumber,
	spread: s.nullable(NonnegativeNumber)
});
export type SurveyTiming = s.Infer<typeof SurveyTiming>;

/** `npm run benchmark:survey`: many small shapes, a row for each input of each. */
export const SurveyData = s.object({
	...timing_plan_shape,
	/** The library every row is of, which the others are compared with. */
	subject: BenchmarkLibId,
	others: s.array(BenchmarkLibId),
	call: CallFloor,
	/** A time at or under this is mostly the call it was timed through. */
	call_floor_ns: PositiveNumber,
	/** What a row's parse does, every kind there is, in the order the script summarizes them. */
	kinds: s.array(NonEmptyString),
	rows: s.array(
		s.object({
			shape: NonEmptyString,
			input: NonEmptyString,
			/** What the parse of the input does, in the subject library. */
			does: NonEmptyString,
			valid: s.boolean,
			libs: s.record(to_cell(SurveyTiming))
		})
	)
});
export type SurveyData = s.Infer<typeof SurveyData>;

/** A bundle's bytes. */
const BundleBytes = s.object({ minified: PositiveInt, gzip: PositiveInt });

/** One row of a harvested set in one side. */
const HarvestCell = s.object({
	time: to_cell(
		s.object({
			ns: PositiveNumber,
			batch_ns: PositiveNumber,
			spread: s.nullable(NonnegativeNumber)
		})
	),
	/** Heap bytes a parse allocates. */
	bytes: to_cell(s.object({ bytes: NonnegativeNumber }))
});

/** `npm run benchmark:harvest`: each harvested set in its own library against this one. */
export const HarvestData = s.object({
	passes: PositiveInt,
	duration_ms: PositiveNumber,
	warm_ms: PositiveNumber,
	sets: s.array(
		s.object({
			name: NonEmptyString,
			title: NonEmptyString,
			/** The library the consumer wrote the set in. */
			reference: BenchmarkLibId,
			/** The schema a document of the set is parsed with. */
			root: NonEmptyString,
			/** The columns, the consumer's library in each of its modes and then this library. */
			sides: s.array(s.object({ id: BenchmarkLibId, label: NonEmptyString })),
			/** A module that parses one document, by side: a side with no bundle of its own has no entry. */
			bundles: s.record(BundleBytes),
			rows: s.array(
				s.object({ name: NonEmptyString, valid: s.boolean, sides: s.record(HarvestCell) })
			),
			/** Checks that are a rewrite's own code and no library's. */
			asides: s.array(
				s.object({
					name: NonEmptyString,
					ns: PositiveNumber,
					batch_ns: PositiveNumber,
					spread: s.nullable(NonnegativeNumber),
					bytes: NonnegativeNumber
				})
			)
		})
	)
});
export type HarvestData = s.Infer<typeof HarvestData>;

/** One library's allocation on one scenario. */
export const AllocationFigures = s.object({
	/** Heap bytes a parse of the valid input allocates. */
	valid_bytes: NonnegativeNumber,
	/** Heap bytes a parse of the invalid input allocates. */
	invalid_bytes: NonnegativeNumber,
	/** Heap bytes building the scenario's schema allocates. */
	create_bytes: NonnegativeNumber,
	/** Nanoseconds building the schema takes, warm. */
	create_ns: PositiveNumber,
	/**
	 * Whether the library hands back the schema it built before for the same
	 * definition, so the creation figures are of one schema kept and not of the
	 * distinct schemas an app defines.
	 */
	interned: s.boolean
});
export type AllocationFigures = s.Infer<typeof AllocationFigures>;

/** `npm run benchmark:allocations`: heap bytes per parse and per schema built. */
export const AllocationsData = s.object({
	rows: s.array(s.object({ scenario: NonEmptyString, libs: s.record(AllocationFigures) }))
});
export type AllocationsData = s.Infer<typeof AllocationsData>;

/** A bundle measured raw and compressed. */
export const BundleSizes = s.object({
	minified: PositiveInt,
	gzip: PositiveInt,
	/** Brotli at its highest quality. */
	brotli: PositiveInt
});
export type BundleSizes = s.Infer<typeof BundleSizes>;

/** `npm run benchmark:bundle`: bundle size per scenario, then this library export by export. */
export const BundleData = s.object({
	rows: s.array(s.object({ scenario: NonEmptyString, libs: s.record(BundleSizes) })),
	/** Every scenario in one bundle. */
	all: s.record(BundleSizes),
	/** This library alone, in bytes of `measure`. */
	library: s.object({
		measure: s.one_of(['gzip', 'minified']),
		/** A bundle of `parse`. */
		parse: PositiveInt,
		/** A bundle of every runtime export of `schema.ts`. */
		library: PositiveInt,
		exports: s.array(
			s.object({
				name: NonEmptyString,
				/** A bundle of `parse` and the export, less one of `parse`. */
				alone: s.pipe(s.number, s.safe_integer),
				/** A bundle of every export, less one of every export but it. */
				last_in: s.pipe(s.number, s.safe_integer)
			})
		),
		/** What every export of each module beside `schema.ts` adds to `library`. */
		modules: s.array(s.object({ name: NonEmptyString, added: s.pipe(s.number, s.safe_integer) }))
	})
});
export type BundleData = s.Infer<typeof BundleData>;

/** What `tsc` reports of one file. */
export const TypeCost = s.object({
	/** The same on every run. */
	instantiations: NonnegativeInt,
	types: NonnegativeInt,
	memory_kb: PositiveInt,
	/** The median of the runs, in seconds: it moves from run to run. */
	check_s: NonnegativeNumber
});
export type TypeCost = s.Infer<typeof TypeCost>;

/** `npm run benchmark:types`: what each library's types cost the TypeScript checker. */
export const TypesData = s.object({
	/** How many times each file was checked. */
	runs: PositiveInt,
	/** What the compiler costs before it sees any library. */
	empty: TypeCost,
	/** Each library's scenario module. */
	modules: s.record(TypeCost),
	/** The property reads of a consumer, as source text. */
	reads: s.array(NonEmptyString),
	/** Each library's schemas module with those reads of the types it infers. */
	with_reads: s.record(
		s.object({
			...TypeCost.def,
			/** The instantiations the reads add to the schemas module alone. */
			reads_add: s.pipe(s.number, s.safe_integer)
		})
	)
});
export type TypesData = s.Infer<typeof TypesData>;

/** The stages of a cold start, each including the ones before it. */
export const COLDSTART_STAGE_IDS = [
	'import',
	'create',
	'first_parse',
	'parse_10',
	'parse_100'
] as const;

/** One stage: the median milliseconds of work inside the process, and its p10 to p90 band. */
const ColdstartStageFigures = s.object({ work_ms: NonnegativeNumber, band_ms: NonnegativeNumber });

/** One library's cold start on one scenario in one form of entry. */
export const ColdstartFigures = s.object({
	stages: s.object({
		import: ColdstartStageFigures,
		create: ColdstartStageFigures,
		first_parse: ColdstartStageFigures,
		parse_10: ColdstartStageFigures,
		parse_100: ColdstartStageFigures
	}),
	/** Parses 2 to 100, timed inside the process of the hundredth, in milliseconds. */
	later_ms: NonnegativeNumber,
	/**
	 * The p10 to p90 band of the samples `later_ms` is the median of. A file
	 * written before the script emitted it has none, and its figure is then
	 * shown and not compared.
	 */
	later_band_ms: s.optional(NonnegativeNumber),
	/** What the first parse added to the whole process over bare: inside `bare.band_ms` it can't be told from zero. */
	added_ms: s.number,
	/** Kilobytes of peak resident memory the first parse added over bare. */
	added_rss_kb: s.number,
	/**
	 * The p10 to p90 band, in kilobytes, of the peak resident memory of the
	 * samples `added_rss_kb` is read from. As `later_band_ms`, a file may lack it.
	 */
	rss_band_kb: s.optional(NonnegativeNumber)
});
export type ColdstartFigures = s.Infer<typeof ColdstartFigures>;

/** `npm run benchmark:coldstart`: a fresh process, stage by stage. */
export const ColdstartData = s.object({
	/** The rounds kept. */
	samples: PositiveInt,
	/** The rounds thrown away first. */
	discard: NonnegativeInt,
	/** A process that imports nothing. */
	bare: s.object({
		ms: PositiveNumber,
		/** Its own p10 to p90 band. */
		band_ms: NonnegativeNumber,
		rss_kb: PositiveNumber
	}),
	rows: s.array(
		s.object({
			scenario: NonEmptyString,
			form: s.one_of(['bundled', 'unbundled']),
			libs: s.record(ColdstartFigures)
		})
	)
});
export type ColdstartData = s.Infer<typeof ColdstartData>;

/** What one library holds on one scenario, over a bare process, in bytes. */
export const HeapFigures = s.object({
	heap_bytes: NonnegativeInt,
	code_bytes: NonnegativeInt,
	external_bytes: NonnegativeInt,
	/** The three summed. */
	total_bytes: NonnegativeInt,
	/** What each further schema holds, read between the two of `counts`. */
	further_schema_bytes: NonnegativeInt,
	/** As `AllocationFigures.interned`: `further_schema_bytes` is then of one schema kept. */
	interned: s.boolean
});
export type HeapFigures = s.Infer<typeof HeapFigures>;

/** `npm run benchmark:heap`: memory still held after building and parsing. */
export const HeapData = s.object({
	/** The counts of schemas `further_schema_bytes` is read between. */
	counts: s.object({ few: PositiveInt, many: PositiveInt }),
	rows: s.array(s.object({ scenario: NonEmptyString, libs: s.record(HeapFigures) }))
});
export type HeapData = s.Infer<typeof HeapData>;

/** `npm run benchmark:wasm`: the Rust crate as wasm against this library, on JSON texts. */
export const WasmData = s.object({
	rounds: PositiveInt,
	round_ms: PositiveNumber,
	wasm_bytes: PositiveInt,
	wasm_gzip_bytes: PositiveInt,
	payloads: s.array(
		s.object({
			size: NonEmptyString,
			outcome: s.one_of(['valid', 'first_bad', 'last_bad']),
			items: PositiveInt,
			/** Bytes of UTF-8. */
			bytes: PositiveInt,
			/** UTF-16 code units. */
			code_units: PositiveInt,
			rows: s.array(
				s.object({
					/** How the caller holds the text, `null` for a row there to read the others by. */
					holding: s.nullable(s.one_of(['string', 'bytes'])),
					side: s.one_of(['js', 'wasm', 'reference']),
					label: NonEmptyString,
					/** The median of the rounds, nanoseconds per call. */
					ns: PositiveNumber,
					/** The fastest round. */
					min_ns: PositiveNumber,
					/** A wasm row's time over the fastest JS row of its holding, `null` for any other row. */
					vs_js: s.nullable(PositiveNumber)
				})
			)
		})
	)
});
export type WasmData = s.Infer<typeof WasmData>;

/** The schema of each script's data, by its id. */
export const BENCHMARK_DATA_SCHEMAS = {
	bundle: BundleData,
	types: TypesData,
	allocations: AllocationsData,
	heap: HeapData,
	coldstart: ColdstartData,
	run: RunData,
	survey: SurveyData,
	harvest: HarvestData,
	wasm: WasmData
} as const satisfies Record<BenchmarkId, s.AnySchema>;

/** What each script writes with its `--data` arg, by its id. */
export interface BenchmarkData {
	bundle: BundleData;
	types: TypesData;
	allocations: AllocationsData;
	heap: HeapData;
	coldstart: ColdstartData;
	run: RunData;
	survey: SurveyData;
	harvest: HarvestData;
	wasm: WasmData;
}

/**
 * The args a full run gives every script: none, so each measures with its own
 * defaults. A run whose section was started with any other is not one to
 * publish, whatever it says it is.
 */
export const BENCHMARK_FULL_ARGS: ReadonlyArray<string> = [];

/** How a section was run: the command its npm script is, and what the run added to it. */
const section_command_shape = {
	/** The npm script the run started. */
	script: NonEmptyString,
	/** The script's command, as `package.json` has it, with the node flags it runs under. */
	command: NonEmptyString,
	/** The args the run gave it, without the path of its data. */
	args: s.array(s.string),
	duration_ms: NonnegativeInt
};

/**
 * A section of a results file: what one script measured, or why the file has
 * nothing of it. `failed` is a script that exited with an error, and `skipped`
 * one the run didn't start.
 */
const to_section = <T extends s.Schema<any, any, string, s.SchemaEntries>>(data: T) =>
	s.variant('status', [
		s.object({ status: s.literal('measured'), ...section_command_shape, data }),
		s.object({
			status: s.literal('failed'),
			...section_command_shape,
			/** How the script ended: its exit code, a signal, or why its data could not be read. */
			error: NonEmptyString
		}),
		s.object({ status: s.literal('skipped'), reason: NonEmptyString })
	]);

/** What the machine was doing, as `machine.ts` reads it: a key the OS doesn't expose is left out. */
export const BenchmarkMachineState = s.object({
	node: NonEmptyString,
	/** The load average over 1, 5, and 15 minutes. */
	load: s.array(NonnegativeNumber),
	/** Each CPU's clock in MHz. */
	cpu_mhz: s.optional(s.array(NonnegativeNumber)),
	governor: s.optional(NonEmptyString),
	scaling_driver: s.optional(NonEmptyString),
	energy_performance_preference: s.optional(NonEmptyString),
	boost: s.optional(s.boolean)
});
export type BenchmarkMachineState = s.Infer<typeof BenchmarkMachineState>;

/**
 * What a figure is of, by which a note about a library says which figures it
 * qualifies: the bytes of a bundle, a parse of valid input, a parse of invalid
 * input, a guard, a cold start, what a parse allocates, building a schema,
 * what stays held, and what the types cost the compiler.
 */
export const BENCHMARK_FIGURE_KINDS = [
	'bundle',
	'valid',
	'invalid',
	'guard',
	'coldstart',
	'allocation',
	'creation',
	'heap',
	'types'
] as const;
export type BenchmarkFigureKind = (typeof BENCHMARK_FIGURE_KINDS)[number];

/**
 * Something a reader must know to read a library's figure of some kinds
 * beside another's: that it is of another kind of work, or of less of it.
 */
export const BenchmarkLibNote = s.object({
	/** The kinds of figure the note qualifies. A chart or table of any of them prints it. */
	about: s.pipe(s.array(s.one_of(BENCHMARK_FIGURE_KINDS)), s.min_length(1)),
	text: NonEmptyString
});
export type BenchmarkLibNote = s.Infer<typeof BenchmarkLibNote>;

/** One library under comparison. The roster of these is the columns of every table. */
export const BenchmarkLib = s.object({
	id: BenchmarkLibId,
	label: NonEmptyString,
	/** The npm package its version was read from. */
	package: NonEmptyString,
	version: s.pipe(
		s.string,
		s.min_length(1),
		s.message(
			s.check((v: string) => v !== 'missing'),
			'a run must know which version it measured'
		)
	),
	/** Whether the maintainer of these benchmarks also maintains the library. The site marks it. */
	by_maintainer: s.boolean,
	/** What of the package was measured, where that is not the package as it is imported. */
	note: s.nullable(NonEmptyString),
	/** What qualifies its figures of some kinds, each said where a figure of that kind is drawn. */
	notes: s.array(BenchmarkLibNote)
});
export type BenchmarkLib = s.Infer<typeof BenchmarkLib>;

/**
 * What a file is: `full` is a run that measures with each script's own
 * defaults, `smoke` one that runs every script as briefly as it goes, to prove
 * the suite works, and `fixture` no run at all, a file of invented numbers for
 * tests and for building the site without a run. Only a `full` run's numbers
 * are results.
 */
export const BenchmarkRunKind = s.one_of(['full', 'smoke', 'fixture']);
export type BenchmarkRunKind = s.Infer<typeof BenchmarkRunKind>;

const CommitHash = s.pipe(s.string, s.regex(/^[0-9a-f]{40}$/, 'a full commit hash'));

/** Where, when, and from what a run was produced. */
export const BenchmarkMeta = s.object({
	/** When the run started. */
	generated_at: s.pipe(s.string, s.iso_datetime),
	kind: BenchmarkRunKind,
	/** The sections the run was narrowed to, `null` for a run of them all. */
	only: s.nullable(s.pipe(s.array(s.one_of(BENCHMARK_IDS)), s.min_length(1))),
	machine: s.object({
		/** The name the machine is published under. */
		name: NonEmptyString,
		/** The CPU model. */
		cpu: NonEmptyString
	}),
	/** The machine's state as the run started. */
	machine_start: BenchmarkMachineState,
	/** The machine's state as the run ended. */
	machine_end: BenchmarkMachineState,
	/** Node's version, as `process.version` prints it. */
	node: NonEmptyString,
	v8: NonEmptyString,
	/** The commit the tree was at as the run started, as a full hash. */
	commit: CommitHash,
	/**
	 * Whether the working tree had changes the commit doesn't record as the run
	 * started. Results files don't count.
	 */
	dirty: s.boolean,
	/** The commit the tree was at as the run ended: another one is a run no commit records. */
	commit_end: CommitHash,
	/** Whether the working tree had changes the commit doesn't record as the run ended. */
	dirty_end: s.boolean,
	/** How long the whole run took. */
	duration_ms: NonnegativeInt,
	libs: s.array(BenchmarkLib),
	/** The installed version of each tool a script measures with, by package. */
	tools: s.record(NonEmptyString)
});
export type BenchmarkMeta = s.Infer<typeof BenchmarkMeta>;

// the per-library records of a section's data, each with the path it is at
const to_lib_records = (
	results: BenchmarkResultsShape
): Array<{ path: Array<string | number>; libs: Record<string, unknown> }> => {
	const records: Array<{ path: Array<string | number>; libs: Record<string, unknown> }> = [];
	const { bundle, types, allocations, heap, coldstart, run } = results;
	if (bundle.status === 'measured') {
		bundle.data.rows.forEach((row, i) =>
			records.push({ path: ['bundle', 'data', 'rows', i, 'libs'], libs: row.libs })
		);
		records.push({ path: ['bundle', 'data', 'all'], libs: bundle.data.all });
	}
	if (types.status === 'measured') {
		records.push({ path: ['types', 'data', 'modules'], libs: types.data.modules });
		records.push({ path: ['types', 'data', 'with_reads'], libs: types.data.with_reads });
	}
	for (const [name, section] of [
		['allocations', allocations],
		['heap', heap],
		['coldstart', coldstart],
		['run', run]
	] as const) {
		if (section.status !== 'measured') continue;
		section.data.rows.forEach((row, i) =>
			records.push({ path: [name, 'data', 'rows', i, 'libs'], libs: row.libs })
		);
	}
	return records;
};

const results_shape = s.object({
	meta: BenchmarkMeta,
	bundle: to_section(BundleData),
	types: to_section(TypesData),
	allocations: to_section(AllocationsData),
	heap: to_section(HeapData),
	coldstart: to_section(ColdstartData),
	run: to_section(RunData),
	survey: to_section(SurveyData),
	harvest: to_section(HarvestData),
	wasm: to_section(WasmData)
});
type BenchmarkResultsShape = s.Infer<typeof results_shape>;

/**
 * One run of the benchmark suite. Beyond each section's shape, parsing checks
 * that the sections agree with the roster and with themselves: library ids are
 * unique, every per-library record of a scenario table names exactly the
 * libraries of the roster, the survey's libraries and each harvested set's
 * sides are the ones it lists, no table has a row twice, a spread is `null`
 * exactly where there was one pass, and a section the run was narrowed away
 * from holds no data.
 */
export const BenchmarkResults = refined(results_shape, (results, issue) => {
	const { meta } = results;
	const ids = meta.libs.map((lib) => lib.id);
	for (const [i, id] of ids.entries()) {
		if (ids.indexOf(id) !== i) issue(['meta', 'libs', i, 'id'], `duplicate library id "${id}"`);
	}
	// a scenario table has a cell for every library of the roster, and for no other
	for (const { path, libs } of to_lib_records(results)) {
		for (const id of ids) {
			if (!Object.hasOwn(libs, id)) issue(path, `library "${id}" has no entry here`);
		}
		for (const id of Object.keys(libs)) {
			if (!ids.includes(id)) issue([...path, id], `unknown library "${id}"`);
		}
	}
	const unique = (names: Array<string>, path: Array<string | number>, what: string): void => {
		for (const [i, name] of names.entries()) {
			if (names.indexOf(name) !== i) issue([...path, i], `duplicate ${what} "${name}"`);
		}
	};
	const check_spread = (
		spread: number | null,
		passes: number,
		path: Array<string | number>
	): void => {
		if ((spread === null) !== (passes === 1)) {
			issue(path, 'a spread is null exactly where there was one pass');
		}
	};
	const { run, survey, harvest, bundle, allocations, heap, coldstart } = results;
	for (const [name, section] of [
		['bundle', bundle],
		['allocations', allocations],
		['heap', heap]
	] as const) {
		if (section.status !== 'measured') continue;
		unique(
			section.data.rows.map((row) => row.scenario),
			[name, 'data', 'rows'],
			'scenario'
		);
	}
	if (coldstart.status === 'measured') {
		unique(
			coldstart.data.rows.map((row) => `${row.scenario}, ${row.form}`),
			['coldstart', 'data', 'rows'],
			'row'
		);
	}
	if (run.status === 'measured') {
		const { rows, passes, call } = run.data;
		unique(
			rows.map((row) => `${row.scenario}/${row.input}`),
			['run', 'data', 'rows'],
			'row'
		);
		if (call.min_ns > call.max_ns) issue(['run', 'data', 'call'], 'the least is at most the most');
		for (const [i, row] of rows.entries()) {
			for (const [id, cell] of Object.entries(row.libs)) {
				if (is_benchmark_missing(cell)) continue;
				check_spread(cell.spread, passes, ['run', 'data', 'rows', i, 'libs', id, 'spread']);
			}
		}
	}
	if (survey.status === 'measured') {
		const { rows, passes, subject, others, call } = survey.data;
		const libs = [subject, ...others];
		for (const [i, id] of libs.entries()) {
			if (!ids.includes(id)) {
				issue(['survey', 'data', i === 0 ? 'subject' : 'others'], `unknown library "${id}"`);
			}
		}
		unique(
			rows.map((row) => `${row.shape}/${row.input}`),
			['survey', 'data', 'rows'],
			'row'
		);
		if (call.min_ns > call.max_ns) {
			issue(['survey', 'data', 'call'], 'the least is at most the most');
		}
		unique(survey.data.kinds, ['survey', 'data', 'kinds'], 'kind');
		for (const [i, row] of rows.entries()) {
			if (!survey.data.kinds.includes(row.does)) {
				issue(['survey', 'data', 'rows', i, 'does'], `"${row.does}" is not one of the kinds`);
			}
			const path = ['survey', 'data', 'rows', i, 'libs'];
			for (const id of libs) {
				if (!Object.hasOwn(row.libs, id)) issue(path, `library "${id}" has no entry here`);
			}
			for (const [id, cell] of Object.entries(row.libs)) {
				if (!libs.includes(id)) issue([...path, id], `"${id}" is not a library of the survey`);
				else if (!is_benchmark_missing(cell)) check_spread(cell.spread, passes, [...path, id]);
			}
			const subject_cell = row.libs[subject];
			if (subject_cell && is_benchmark_missing(subject_cell)) {
				issue([...path, subject], 'every row is of the subject library, so it has a figure');
			}
		}
	}
	if (harvest.status === 'measured') {
		unique(
			harvest.data.sets.map((set) => set.name),
			['harvest', 'data', 'sets'],
			'set'
		);
		for (const [i, set] of harvest.data.sets.entries()) {
			const path = ['harvest', 'data', 'sets', i];
			const sides = set.sides.map((side) => side.id);
			unique(sides, [...path, 'sides'], 'side');
			unique(
				set.rows.map((row) => row.name),
				[...path, 'rows'],
				'row'
			);
			for (const side of Object.keys(set.bundles)) {
				if (!sides.includes(side)) issue([...path, 'bundles', side], `unknown side "${side}"`);
			}
			for (const [j, row] of set.rows.entries()) {
				const at = [...path, 'rows', j, 'sides'];
				for (const side of sides) {
					if (!Object.hasOwn(row.sides, side)) issue(at, `side "${side}" has no entry here`);
				}
				for (const [side, cell] of Object.entries(row.sides)) {
					if (!sides.includes(side)) issue([...at, side], `unknown side "${side}"`);
					else if (!is_benchmark_missing(cell.time)) {
						check_spread(cell.time.spread, harvest.data.passes, [...at, side, 'time', 'spread']);
					}
				}
			}
		}
	}
	// a section the run was narrowed away from was not started
	for (const id of BENCHMARK_IDS) {
		if (meta.only && !meta.only.includes(id) && results[id].status !== 'skipped') {
			issue(
				[id, 'status'],
				`the run was narrowed to ${meta.only.join(', ')}, so ${id} was skipped`
			);
		}
	}
});
export type BenchmarkResults = s.Infer<typeof BenchmarkResults>;

/** A section of a results file, by its id. */
export type BenchmarkSection<TId extends BenchmarkId = BenchmarkId> = BenchmarkResults[TId];

/**
 * The sections of a file that hold no data and are not optional: what it
 * lacks to be a whole run.
 *
 * @returns each with why, none for a file that holds every section a run must
 */
export const benchmark_results_find_gaps = (
	results: BenchmarkResults
): Array<{ id: BenchmarkId; why: string }> =>
	BENCHMARK_IDS.flatMap((id) => {
		const section = results[id];
		if (section.status === 'measured') return [];
		if (section.status === 'skipped' && OPTIONAL_BENCHMARK_IDS.includes(id)) return [];
		return [{ id, why: section.status === 'failed' ? section.error : section.reason }];
	});

/**
 * Whether a file holds every section a page renders: each measured, apart
 * from the optional ones. A smoke run can be complete, and its numbers still
 * mean nothing.
 */
export const benchmark_results_is_complete = (results: BenchmarkResults): boolean =>
	benchmark_results_find_gaps(results).length === 0;

/**
 * Whether a commit records everything a run ran: the tree had no change the
 * commit doesn't hold as the run started or as it ended, and was at one commit
 * throughout.
 */
export const benchmark_run_is_recorded = (meta: BenchmarkMeta): boolean =>
	!meta.dirty && !meta.dirty_end && meta.commit === meta.commit_end;

/**
 * The sections of a file that were started with args a full run doesn't give:
 * a script told to measure less, or something else, than its defaults.
 *
 * @returns each with its args, none for a file whose every script ran as a full run starts it
 */
export const benchmark_results_find_args = (
	results: BenchmarkResults
): Array<{ id: BenchmarkId; args: Array<string> }> =>
	BENCHMARK_IDS.flatMap((id) => {
		const section = results[id];
		if (section.status === 'skipped') return [];
		const full =
			section.args.length === BENCHMARK_FULL_ARGS.length &&
			section.args.every((arg, i) => arg === BENCHMARK_FULL_ARGS[i]);
		return full ? [] : [{ id, args: section.args }];
	});

/**
 * The timed sections of a file that were taken in one pass: a time of one pass
 * has no spread, so nothing says what it ranges over, and every gap between
 * two of them would read as a difference.
 *
 * @returns their ids, none for a file whose every timed section repeated its timing
 */
export const benchmark_results_find_single_passes = (
	results: BenchmarkResults
): Array<BenchmarkId> =>
	(['run', 'survey', 'harvest'] as const).filter((id) => {
		const section = results[id];
		return section.status === 'measured' && section.data.passes < 2;
	});

/**
 * Whether a run's numbers can be published as results: a `full` run of every
 * section, none failed and none skipped but an optional one, each started with
 * the args of a full run and no other, every timed section in more than one
 * pass, from a commit that records everything that ran. A site shows anything
 * else as what it is, never as a result. A `fixture` is never publishable: its
 * numbers are invented.
 *
 * These are checks against accident, a smoke run or the fixture taken for a
 * run to publish, and not against forgery: a file edited by hand to say what
 * a publishable run says passes them.
 */
export const benchmark_results_is_publishable = (results: BenchmarkResults): boolean =>
	results.meta.kind === 'full' &&
	results.meta.only === null &&
	benchmark_run_is_recorded(results.meta) &&
	benchmark_results_is_complete(results) &&
	benchmark_results_find_args(results).length === 0 &&
	benchmark_results_find_single_passes(results).length === 0;

/** The facts of a run that decide whether it is publishable, as one line for a refusal. */
export const describe_benchmark_run = (results: BenchmarkResults): string => {
	const { kind, only, commit, dirty, commit_end, dirty_end } = results.meta;
	const gaps = benchmark_results_find_gaps(results);
	const args = benchmark_results_find_args(results);
	const to_tree = (is_dirty: boolean): string =>
		is_dirty ? ', with changes it does not record' : ', clean';
	return [
		`kind: ${kind}${kind === 'fixture' ? ', whose numbers are invented' : ''}`,
		`narrowed to: ${only ? only.join(', ') : 'nothing'}`,
		`commit as it started: ${commit}${to_tree(dirty)}`,
		`commit as it ended: ${commit_end === commit ? 'the same' : commit_end}${to_tree(dirty_end)}`,
		`sections without data: ${gaps.length ? gaps.map((gap) => `${gap.id} (${gap.why})`).join(', ') : 'none'}`,
		`sections started with args a full run does not give: ${args.length ? args.map((section) => `${section.id} (${section.args.join(' ')})`).join(', ') : 'none'}`,
		`timed sections of one pass: ${benchmark_results_find_single_passes(results).join(', ') || 'none'}`
	].join('; ');
};

/**
 * Formats issues one to a line pair, `✖ message` and then `  → at path` when
 * the issue has one.
 */
export const format_results_issues = (issues: Array<s.SchemaIssue>): string =>
	issues
		.map(
			(issue) =>
				`✖ ${issue.message ?? `expected ${issue.expected}, received ${issue.received}`}` +
				(issue.path.length ? `\n  → at ${issue.path.map(String).join('.')}` : '')
		)
		.join('\n');

/**
 * Parses a results file, with every problem in one readable message.
 *
 * @param data - the parsed JSON of a results file
 * @returns the validated results
 * @throws Error if the data doesn't match `BenchmarkResults`
 */
export const parse_benchmark_results = (data: unknown): BenchmarkResults => {
	const parsed = s.parse(BenchmarkResults, data);
	if (!parsed.ok) {
		throw new Error(`invalid benchmark results:\n${format_results_issues(parsed.issues)}`);
	}
	return parsed.value;
};

/**
 * Parses what a script wrote with its `--data` arg.
 *
 * @param id - the script the data must be of
 * @param file - the parsed JSON of the file
 * @returns the validated data
 * @throws Error if the file is of another script, or its data doesn't match the script's schema
 */
export const parse_benchmark_data = <TId extends BenchmarkId>(
	id: TId,
	file: unknown
): BenchmarkData[TId] => {
	const envelope = file as { benchmark?: unknown; data?: unknown } | null;
	if (envelope === null || typeof envelope !== 'object' || envelope.benchmark !== id) {
		throw new Error(`the data is not of ${id}: it names ${JSON.stringify(envelope?.benchmark)}`);
	}
	const parsed = s.parse(BENCHMARK_DATA_SCHEMAS[id] as s.AnySchema, envelope.data);
	if (!parsed.ok) {
		throw new Error(`invalid ${id} data:\n${format_results_issues(parsed.issues)}`);
	}
	return parsed.value;
};

/**
 * A copy of `value`, which `schema` accepts, with every object's keys in the
 * order `schema` names them, so a file serializes the same however its
 * objects were built. A record keeps its own order, and a union or variant
 * takes the order of the first option that accepts the value.
 */
export const order_keys_by_schema = (schema: s.AnySchema, value: unknown): unknown => {
	const node = schema as s.SchemaNode;
	if (value === null || value === undefined || typeof value !== 'object') return value;
	switch (node.kind) {
		case 'object':
		case 'loose_object':
		case 'strip_object': {
			const input = value as Record<string, unknown>;
			const output: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(node.def)) {
				if (Object.hasOwn(input, key)) output[key] = order_keys_by_schema(entry, input[key]);
			}
			for (const key of Object.keys(input)) {
				if (!Object.hasOwn(output, key)) output[key] = input[key];
			}
			return output;
		}
		case 'record':
			return Object.fromEntries(
				Object.entries(value).map(([key, v]) => [key, order_keys_by_schema(node.def, v)])
			);
		case 'array':
			return (value as Array<unknown>).map((v) => order_keys_by_schema(node.def, v));
		case 'optional':
		case 'nullable':
			return order_keys_by_schema(node.def.schema, value);
		case 'pipe':
			return node.def.reduce((v: unknown, step) => order_keys_by_schema(step, v), value);
		case 'union':
		case 'variant': {
			const options: ReadonlyArray<s.AnySchema> =
				node.kind === 'union' ? node.def : node.def.options;
			const option = options.find((o) => s.is(o, value));
			return option ? order_keys_by_schema(option, value) : value;
		}
		default:
			return value;
	}
};

/** The text of a results file: its keys in the schema's order, indented with tabs. */
export const serialize_benchmark_results = (results: BenchmarkResults): string =>
	JSON.stringify(order_keys_by_schema(BenchmarkResults, results), null, '\t') + '\n';
