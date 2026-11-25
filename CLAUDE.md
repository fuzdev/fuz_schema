# fuz_schema

> a performance-focused schema library for JS

fuz_schema (`@fuzdev/fuz_schema`, [schema.fuz.dev](https://schema.fuz.dev/))
is a schema validation library. It takes Valibot's strategy and pushes it on
bundle size, speed, and memory with simpler internals. Its case is measured:
the README's claims are held by a test to the published benchmark run,
`results/latest.json`.

The library is `src/lib/`. The rest of the repo is its benchmarks, a docs
site, and a Rust workspace whose crates are the library's Rust side.

For coding conventions, see Skill(fuz-stack).

## Commands

```bash
gro check     # typecheck, test, format check (run before committing)
gro typecheck # typecheck only (faster iteration)
gro test      # run tests with vitest
gro build     # build for production (static adapter)
gro sync      # regenerate files and run svelte-kit sync
npm run benchmark             # parse time, every library on every scenario, a library to a process
npm run benchmark:bundle      # bundle size, gzip bytes, per scenario (and brotli) and per export (add -- --raw for minified)
npm run benchmark:allocations # heap bytes per parse and per schema creation
npm run benchmark:types       # tsc instantiations and check time per library
npm run benchmark:coldstart   # time and peak memory of a fresh process, per stage, to the 100th parse (gro build first)
npm run benchmark:heap        # memory still held after building and parsing
npm run build:wasm            # the Rust crate as wasm, into target/fuz_schema_wasm
npm run benchmark:wasm        # that wasm against the library, on JSON texts
npm run benchmark:harvest     # each harvested set, in valibot or zod, against this library
npm run benchmark:survey      # many small shapes against itself compiled, valibot, zod, and zod compiled, by what a parse does
npm run results               # every benchmark in turn into one results file: the one command of a full run, see results/README.md
npm run results:publish       # copy a publishable run to results/latest.json, which the site renders
npm run grade                 # grade the working tree against HEAD, see docs/grading.md
npm run grade:aa              # what saved grades of one file against itself say of each line's A/A
npm run differential          # generated schemas and inputs against zod and valibot, memory-capped where systemd-run can
npm run mutate                # break the library on purpose and check the tests fail, see docs/testing.md
npm run fixtures:deep         # generated JSON fixtures, many seeds, through the Rust fixture tests, see docs/rust.md
gro task src/test/fixtures/json/update.task.ts # regenerate the JSON fixtures' expected.json
gro task src/benchmarks/update_sizes.task.ts   # regenerate src/benchmarks/sizes.json
gro task src/test/update_differential_sides.task.ts # regenerate src/test/differential_sides.json
gro task src/test/fixtures/results/update.task.ts # regenerate the fixture results file
BENCH_RESULTS_FIXTURE=1 gro build # build the site over the fixture run (invented numbers, marked on every page)
```

Every benchmark script, `grade`, `results`, and `results:publish` takes
`--help`, which prints its flags and their defaults, and every benchmark
script takes `--data`, a path to also write what it measured to as JSON.
`npm run grade:aa` takes the directories of grades. The flags are described
in `docs/benchmarks.md` for the benchmarks, `docs/grading.md` for `grade` and
`grade:aa`, `results/README.md` for `results` and `results:publish`,
`docs/testing.md` for `differential` and `mutate`, and `docs/rust.md` for
`fixtures:deep`, which three take no `--help`.

IMPORTANT for AI agents: Do NOT run `gro dev` — the developer manages the
dev server.

## Layout

- `src/lib/schema.ts` - the core library, imported as a namespace
  (`import * as s from '#lib/schema.ts'`)
- `src/lib/standard_schema.ts` - `to_standard_schema`, the Standard Schema
  adapter, separate so core schemas never carry a `~standard` property
- `src/lib/meta.ts` - `meta` and `get_meta`, metadata in a `WeakMap` beside
  the schemas, separate so a schema keeps its three fields
- `src/lib/schema_json.ts` - `to_schema_json`, which serializes a schema to
  the interchange form the Rust crate loads, separate so the core never
  carries it
- `src/lib/json_schema.ts` - `to_json_schema`, which writes a schema as JSON
  Schema draft 2020-12 in the shapes zod writes, separate so the core never
  carries it
- `src/lib/compile.ts` - `compile_guard` and `compile_parse`, which compile a
  schema to a function of straight-line code that gives what `is` and
  `parse` give, and `to_guard_source`, which writes the guard as the text of
  a module, separate so the core never carries it
- `src/lib/introspect.ts` - `unwrap_schema`, `get_schema_meta`,
  `find_schema_meta`, `get_schema_entries`, `get_schema_fields`,
  `format_schema_type`, reading a schema as data, separate so the core never
  carries it
- `src/test/schema.test.ts`, `standard_schema.test.ts`, `meta.test.ts` -
  behavior and type inference: `schema.test.ts` holds the primitives, the
  wrappers, the context, `def`, `is_schema`, flavor and brand, and the types
- `src/test/schema.formats.test.ts`, `schema.object.test.ts`,
  `schema.missing_keys.test.ts`, `schema.record.test.ts`,
  `schema.union.test.ts`, `schema.memo_union.test.ts`, `schema.pipe.test.ts`,
  `schema.issues.test.ts` - the core by topic, as each is named: `record`
  and `keyed_record` together, whose loops read keys alike, and `pipe` with
  the actions, `check_at`, and `message`. The formats are held to their
  grammars in `docs/formats.md`. They share the helpers of
  `schema_test_helpers.ts`
- `src/test/schema.inference.test.ts`, `schema.emit.test.ts`,
  `schema.exact_optional.test.ts`, `schema.docs.test.ts`,
  `schema.shape.test.ts`, `schema.fresh_input.test.ts`,
  `engine_state.test.ts` - the types from a consumer's side, under
  `exactOptionalPropertyTypes`, and in an editor, the schemas' one hidden
  class, an input read afresh, and the engine's state, see
  `docs/testing.md`. The shape and the engine's state are asked in
  processes of their own, `shape_test_child.ts`, over the samples in
  `shape_test_helpers.ts`, and `engine_state_test_child.ts`
- `src/test/schema.invariants.test.ts` - `// @__NO_SIDE_EFFECTS__` on every
  factory of `schema.ts` and `meta.ts`, a doc comment on every export, no
  dependencies, and no built-in newer than the README names, with
  `schema_exports_test_helpers.ts`, the exports that are or make a schema,
  which `schema.emit.test.ts` reads too
- `src/test/benchmarks.test.ts`, `survey.test.ts`, `cases.test.ts`,
  `program.test.ts` - every library's verdict and output on what a benchmark
  times, the builders of `libs/schemas/` held to their factories' text, and
  the compiled modes' compiles, see `docs/benchmarks.md`; every case of the
  matrix on the path it names; and the program of the grader's `apart` regime
- `src/test/docinfo.test.ts`, `src/test/harvest.test.ts` - a harvested set's
  two forms agree on its data, with `harvest_test_helpers.ts`
- `src/test/schema_json.test.ts`, `json_schema.test.ts`,
  `json_schema.conformance.test.ts` - what `to_schema_json` and
  `to_json_schema` write and refuse, and the second against zod's
  `toJSONSchema`, each difference declared in its `DIFFERENCES` and in
  `docs/design.md`
- `src/test/json_schema.differential.test.ts` - its documents against `is`
  and `parse` over generated cases, each disagreement an entry of
  `JSON_SCHEMA_DIFFERENCES` with a pinned case, see `docs/testing.md` § The
  differential. Its modules, each importing only those before it:
  `json_schema_check.ts`, the checker, then `json_schema_differential.ts`
- `src/test/compile.test.ts`, `compile.source.test.ts`,
  `compile.union.test.ts`, `compile.refusal.test.ts`, `compile.emit.test.ts`,
  `compile.bounds.test.ts`, `compile.differential.test.ts` - `compile.ts`
  against the interpreter, see `docs/testing.md` § The compiler, with
  `compile_test_helpers.ts`, the comparison and the hand table, and
  `compile_fallback_test_child.ts`, the fallback's process
- `src/test/introspect.test.ts` - the readers, with a row for every kind
  that the types require
- `src/test/schema.conformance.test.ts` - zod and valibot over a matrix of
  cases, each difference in the tables of `conformance_tables.ts`, see
  `docs/testing.md`. Its modules, each importing only those before it:
  `conformance_adapters.ts`, `conformance_cases.ts`,
  `conformance_test_helpers.ts`
- `src/test/schema.differential.test.ts` - the same over generated cases, see
  `docs/testing.md` § The differential. Its modules, each importing only
  those before it: `differential_generate.ts`, `differential_rules.ts`,
  `differential_recognizers.ts` (`SPLIT_RECOGNIZERS` and
  `FORMAT_SPLIT_RECOGNIZERS`), `differential_classify.ts`,
  `differential_sides.ts`. `differential_sides.json` is generated, by
  `update_differential_sides.task.ts`: whose side this library is on in each
  case of the fixed seeds that zod and valibot disagree on, which the test
  fails on a stale one of. `differential.ts`
  is `npm run differential`, and `src/test/seeded_rng.ts` the generator it
  and the generated JSON fixtures draw from
- `src/test/mutants.ts`, `mutate.ts`, `mutants.test.ts` - the table of
  mutants, `npm run mutate`, and the test that holds every mutant's anchors to
  its file, see `docs/testing.md` § Mutants
- `src/test/fixtures/json/` - the fixtures shared with the Rust crate, see
  `docs/rust.md` § Fixtures
  - `<group>/fixture.ts` - authored: a schema and named JSON texts
  - `<group>/expected.json` - generated by the update task, never hand-edited
  - `contract.json` - generated too: the constants both sides hold, and the
    rows of `refusals.ts`
  - `union_bounds.ts`, `union_bounds.json` - authored shapes of unions, most
    of them recursive, and generated, each with whether `compile.ts` refuses
    it, which the crate's builder is held to
  - `refusals.ts` - authored: each refusal both sides make of a document
  - `json_test_helpers.ts`, `update.task.ts` - the oracle, the loader, and the
    task that regenerates
  - `json_syntax_texts.ts`, `json_generate.ts` - texts several groups share,
    and what the `generated_*` groups export, from a seed
  - `deep.ts` - `npm run fixtures:deep`, many more generated groups, written
    outside the repo
- `src/test/json.fixtures.test.ts` - fails when a generated file is stale
- `src/test/sizes.test.ts` - fails when `src/benchmarks/sizes.json` is stale
- `src/test/results_schema.test.ts`, `results_plan.test.ts`,
  `results_run.test.ts`, `results_publish.test.ts`, `results_docs.test.ts`,
  `results_roster.test.ts` - the results file, `npm run results` with its
  steps against `package.json`, publishing, `results/README.md` against the
  commands, and a file's roster, with `results_test_helpers.ts`
  (`remove_lib`, `load_fixture_without_compiled`).
  `fixtures/results/fixture_run.json` is generated, by `update.task.ts`
  beside it from the invented numbers of `fixture_results.ts`, and
  `results_schema.test.ts` fails on a stale one
- `src/test/benchmark_*.test.ts`, `site_benchmarks.test.ts`,
  `site_render.test.ts` - the benchmarks page's derivations over the fixture
  run, the file the site renders, and what its components render on the
  server, with `SiteHarness.svelte`, the context the root layout gives
- `src/test/site_imports.test.ts` - the library imports nothing of the
  benchmarks or the site, and only a server load loads the results schema,
  a results file, or the fixture
- `src/test/readme_claims.ts`, `readme_claims.test.ts`,
  `readme_measurements.test.ts`, `readme_recipes.test.ts` - the README's
  claims, each a predicate over a results file, held to `results/latest.json`
  (`results/README.md` § Publishing a run), and its recipes, which its blocks
  marked `<!-- recipe: <name> -->` are held to
- `src/test/grade_bytes.test.ts`, `grade_heap.test.ts`, `grade_stats.test.ts`,
  `grade_read.test.ts`, `grade_plan.test.ts`, `measure.test.ts`,
  `coldstart.test.ts` - the grader's prices, statistics, reading, and plan,
  the byte measurement, and the order of cold start's processes
- `src/benchmarks/` - the benchmarks, see `docs/benchmarks.md`; never
  imported by the library, and by the site only for the results schema, at
  runtime in its server loads alone
  - `scenarios.ts`, `libs/`, `libs.ts`, `lib_names.ts` - the scenarios, one
    module per library, and the libraries' names, which import none of them
  - `libs/schemas/`, `scenario_schemas.ts` - the scenarios again as builders,
    with each library's guard and parse, which no bundle reaches
  - `zod_compile.ts` - `compile_zod_root`, whether `z.compile` compiles a root
  - `run.ts`, `bundle.ts`, `allocations.ts`, `types.ts`, `wasm.ts`,
    `harvest.ts`, `survey.ts` with `survey_shapes.ts` - the scripts of the
    benchmarks
  - `coldstart.ts`, `run_coldstart.ts`, `heap.ts`, `run_heap.ts`, `child.ts` -
    cold start and retained heap, each sample in a generated process.
    `child.ts` also starts the processes of the grader and of the timing.
  - `timing_passes.ts`, `timing_child.ts`, `timing_job.ts`, `timing.ts`,
    `run_rows.ts`, `harvest_sets.ts`, `survey_rows.ts` - timing across
    libraries, whose loops the grader's processes load too, and the rows a
    timing process loads
  - `args.ts`, `machine.ts`, `inputs.ts`, `measure.ts`, `bundle_size.ts` -
    what the scripts share: their args and `--help`, through an instance of
    the library no measurement uses, the machine's header, the copies of an
    input a timed function cycles through, the measurement, and the bundling
  - `cases.ts`, `grade.ts`, `grade_bytes.ts`, `grade_stats.ts`,
    `grade_heap.ts`, `grade_read.ts`, `grade_plan.ts`, `grade_aa.ts`,
    `grade_child.ts`, `grade_arm.ts`, `grade_job.ts`, `program.ts` - the case
    matrix and the A/B grader, see `docs/grading.md`: its prices, its reading,
    its plan, its A/A, its processes, and the program of its `apart` regime
  - `docinfo/`, `repos_status/`, `package_json/`, `bench_results/`,
    `fuz_app/` - the harvested sets, snapshots not kept in step
  - `results_schema.ts`, `results_plan.ts`, `results_run.ts`,
    `results_publish.ts` - the schema of a results file, with
    `parse_benchmark_results`, which every reader goes through,
    `npm run results` and its plan, and `npm run results:publish`, see
    `results/README.md`
  - `sizes.ts`, `sizes.json`, `update_sizes.task.ts` - the committed snapshot
    of this library's gzipped sizes, generated and never hand-edited
- `src/routes/` - the static SvelteKit site, with API docs generated by the
  `svelte-docinfo` Vite plugin under `src/routes/docs/`, deployed to
  schema.fuz.dev (`static/CNAME`)
  - `+layout.server.ts`, `+page.server.ts` - the root's server loads: where
    the rendered results came from, for the banner, and the landing page's
    headline figures
  - `docs/benchmarks/` - the `benchmarks` tome and its modules, which the
    landing page's summary imports too: `site_benchmarks.server.ts`, which
    results file is rendered; `benchmark_matrix.ts`, the rows every table and
    chart share and when two numbers are level; `benchmark_sections.ts`, each
    section's rows; `benchmark_headline.ts`, the landing page's figures;
    `benchmark_ratio.ts`, `benchmark_format.ts`, `benchmark_provenance.ts`;
    and the `Benchmarks*.svelte` components
- `results/` - the published run, `latest.json`, which the site renders, the
  dated runs it was copied from, and `scratch/`, git-ignored, for every run
  that isn't publishable; `README.md` has the steps of a published run
- `docs/` - the written docs, below
- `crates/fuz_schema/`, `crates/fuz_schema_wasm/` - the Rust side and its wasm
  build, see [Rust workspace](#rust-workspace)

## Docs

- `README.md` - what the library is, its API, status, and what's been measured
- `docs/design.md` - the internals and why: the one shape, the context and
  probe mode, copy-on-write and what it gives up, issues and messages, the
  types of the schemas, metadata, JSON Schema, the compiler
- `docs/benchmarks.md` - what every benchmark measures and how, how far to
  trust each number, and how to extend them
- `docs/grading.md` - `npm run grade` and the rules a change is accepted by
- `docs/testing.md` - what holds the library to more than its own examples:
  conformance, the differential, the JSON fixtures, the compiler against the
  interpreter, and mutants
- `docs/declined.md` - trades that were built, measured, and not taken: what
  each gave and cost, why it was declined, and what would reopen it
- `docs/formats.md` - the grammars of the format tests and of `to_integer`,
  what decides one where zod and valibot disagree, and how a grammar is held
- `docs/rust.md` - the Rust side: the model, the interchange form, the two
  evaluators, the issues, the declared divergences, what is refused, the
  fixtures, and the wasm build

Keep them in step with the code. They describe what is, and stay short.

## Invariants

Things that are easy to break without a test noticing:

- **Every schema is exactly `{kind, def, run}`, in that key order.** A fourth
  field or another order gives it a second hidden class. Kind-specific data
  goes in `def`.
- **Nothing writes to a schema after it is made**, a `lazy` included: it
  keeps the schema it got in a closure. A write to one schema's `run` makes
  that field mutable for every schema, and slows parses the engine had
  folded, which `npm run grade` shows only in its `apart` regime.
  `src/test/schema.shape.test.ts` asks the engine for both: one map, and no
  field written to. A new export gets a sample in
  `shape_test_helpers.ts`, which the test fails without.
- **Every issue is exactly `{kind, expected, received, path, message}`, built
  by `fail`.** It never holds the value that failed, or anything else of the
  input but the keys in `path`. Past `fail` its `path` grows by the keys a
  container or a `check_at` adds and is reversed as `parse` returns it,
  `message` sets its `message`, and `keyed_record` sets the `kind` of the
  first issue its key schema reported to `invalid_key`.
- **Every kind has an entry in `SchemaDefs`** saying what its `def` holds.
  `optional`, `nullable`, `with_default`, and `with_default_fn` hold their
  schema as `def.schema`.
  The types don't force a new kind to be added there. Once it is, they force
  a row for it in the kind tables of `src/test/introspect.test.ts`.
- **Every factory carries `// @__NO_SIDE_EFFECTS__`**, so an unused schema
  definition is dropped by the bundler. `src/test/schema.invariants.test.ts`
  fails on a factory of `schema.ts` or `meta.ts` without it.
- **Every schema's factory or constant but `pipe` returns an interface named
  for it**, `ObjectSchema<T>` and the rest, whose type arguments are only what
  it was given, extending `Schema` with the output and input it computes. A
  plain `Schema<…>` would have every declaration a consumer emits that holds
  it write that output and input out, again at each level. `pipe` returns a
  `PipeSchema` of the output its steps compute, which a declaration writes
  out, and an action a `SchemaAction` or `SchemaRefinement`.
  `src/test/schema.emit.test.ts` reads the declared type of every export of
  `schema.ts` and `meta.ts` that is or returns a schema, and fails on one
  outside those.
- **Outside probe mode `ctx.issues.length` is `Math.min(ctx.fails, 100)`.**
  Past the hundredth failure `fail` counts and builds no issue, a cap that is
  fixed and silent in `parse`'s result, and `MAX_ISSUES` in the Rust crate.
  `parse_or_throw` passes `fails` to the `SchemaError`, whose message alone
  counts it. `issues` is
  `undefined` while `fails` is `0`. Containers use
  the count as an index into `issues`, so one taken past the cap reaches no
  issue. Report failure only through `fail`, and restore `fails` after
  probing.
- **In probe mode nothing touches `ctx.issues`**, and containers return at
  their first failed child.
- **The input is never mutated**, `object` never accepts an input with unknown
  keys, and `strip_object` never returns one. An unknown key to those two is
  an enumerable string key the schema doesn't name, own or inherited: a
  symbol key and a non-enumerable key are not looked at.
- **The object loops hand an entry the object, its key, and `1`**, as the
  third, fourth, and fifth argument of `run`, and leave whether a missing key
  fails to it. A schema that accepts `undefined` and should refuse a missing
  key checks the object itself, as `unknown` does. `nullable`, `union`, `pipe`
  to its first schema, and `message` pass the object and the key on only to a
  `run` whose `length` is past two or to a schema of kind `'lazy'`, tested
  once when each is made, so a `run` that reads them declares them
  as plain parameters. Each is two closures, one for either answer: a single
  `run` of four parameters measured slower. A `lazy` declares two parameters and passes
  on the object and the key when it is called with more, by the length of its
  `arguments`. A schema that calls what it holds with two arguments, as every
  other does, lets a missing key through to it as `undefined`.
- **The `1` says the schema is the entry itself.** Only `message` passes it
  on, with the object and the key, and only the closure of a `pipe` that
  starts with an `optional` reads it. `nullable`, `lazy`, `union`, and a `pipe`
  to its first schema don't pass it, so what they hold is a step of the entry
  and not the entry.
- **A `pipe` that starts with an `optional` runs no step for a key that is
  missing**, where it is handed the `1`, and the key stays out of a copy
  started before it: it gives `undefined`, never the value it was handed.
  Where it starts the copy, which only a `Proxy` that says the key is missing
  and gives a value for it makes it do, the copy holds the key as
  `undefined`. It is a third
  closure, chosen when the pipe is made by the kind of the schema it starts
  with, through every pipe that is its first schema, and it runs the steps
  in a loop of its own, as the closure of two does. Without the `1`, under a
  `nullable`, a `lazy`, or a `union`, its steps run on the `undefined`, as
  they do after any of those that reaches an `optional`, which keeps a step
  that fails there reported, as Valibot refuses the missing key there, where
  Zod reports a step only after a `transform` and otherwise drops it.
- **A `union` whose option fills a missing key in tries the options before it
  again**, without the object and the key, and the first that matches is the
  union's: the key is optional, and the `undefined` it reads as. That is when
  the first option that matches a missing key gives anything but `undefined`;
  one that gives `undefined`, as an `optional` does, is the union's, and none
  is tried again. Only an option before it that takes the object and the key,
  by that test, is run again, and never the one that matched. So an option
  that takes them and fails for a reason other than the key, before one that
  fills the key in, runs twice in one parse, and a `transform` in it that the
  first run reached with it, once more for each enclosing union that tries it
  again: only a `transform` or a `check` with a side effect can tell.
- **`memo_union` runs as `union` does, apart from its memo.** Its `run` has
  `union`'s `length`, two closures chosen when it is made, so whatever holds
  it passes the object and the key as it would to a `union`. It keeps a value
  only while probing and only for an object or array, in a `WeakMap` per
  context held in its closure, and a kept failure adds one to `ctx.fails` as
  `fail` does in probe mode. A memo read anywhere else, or kept outside probe
  mode, gives an answer `union` wouldn't.
- **A `memo_union` is told by its `def`.** `memo_union` adds its options
  array to a `WeakSet` on `globalThis` under
  `Symbol.for('@fuzdev/fuz_schema/memo_union')`, which `is_memo_union` reads,
  so the schema stays its three fields. The set's shape is a contract between
  versions, as the metadata registry's is. `flavor`, `brand`, `meta`, and
  `message` keep the `def`, so each of them around a `memo_union` is told. A
  wrapper that comes to copy a schema with another `def` array hides a
  `memo_union` from `compile.ts`, which then takes it for a `union` and may
  refuse it. A `union` that holds a `memo_union`'s own array is told as one
  and is not refused: its guard keeps verdicts, and its own `run`, which a
  parse runs where an option can change a value or the input fails, keeps
  nothing, so the bound is not held for it.
- **`~types`, `~accepts`, and `~refines` exist only in the types.** An action
  is a `SchemaAction`, whose `~types.action` has a `pipe` check it by its
  optional `~accepts` alone, which refuses it after a wider step; any other
  step is checked by its `~types.input`. `~refines` is a `boolean` on every
  `Schema` and `true` on a `SchemaRefinement`, which makes a `pipe` output the
  type of the step before it. No schema carries any of these keys at runtime.
  A wrapper typed as the schema it holds (`message`, `meta`, `brand`,
  `flavor`) needs an overload for an action first, or an action under it is
  not typed from the step before it, and one that keeps the output (`message`,
  `meta`) an overload for a refinement before that, or a refinement under it
  is not one. Only an action whose `run` returns the value it is given is a
  `SchemaRefinement`.
- **`loose_object` has its own loop, and so do `object_with_rest`, for the
  keys it doesn't name, and `keyed_record`.** Folding `loose_object`'s into the shared one put its
  bytes in every bundle that uses any object schema.
- **Costs are opt-in.** A feature not every consumer needs is a separate
  export or module the core path doesn't reach. It should take that shape
  before it adds a field to an issue, a schema, or the context, or a branch to
  a `run`.
- **A guarantee is kept whole or refused.** Code that can't keep a bound or a
  verdict the interpreter has throws, or hands the work to the interpreter
  where that is as safe: it does not do part of it faster. `compile.ts`
  refuses a `union` it can't bound for that reason. Hostile input is what a
  remote party can write, as JSON is, and is guarded against an ordinary
  schema ahead of speed and size; a schema whose author had to write what no
  schema needs is not, see `docs/declined.md` § Degenerate schemas.
- **A difference from zod and valibot where they agree is declared**, in the
  tables of `src/test/conformance_tables.ts` and in `docs/design.md`,
  which say the same. The conformance test finds one that isn't, and one that
  is declared and gone, and the differential one in generated cases. A rule of
  the differential, in `differential_rules.ts`, is of a declared row and
  allows only what that row says this library does. A difference that is a
  combination of recorded behaviors is a declared row too, with its case:
  two `SIDES` rows that cancel, a declared difference with a `SIDES` row, or
  a `SIDES` row with the copies' drop of a `__proto__` key. One not yet ruled
  on can be marked undecided in the table, which prints it on every run until
  it is ruled on: the table is kept free of them. A new behavior gets a case
  in the matrix. Where zod and valibot disagree on a generated case of the
  fixed seeds, `src/test/differential_sides.json` holds whose side this
  library was on: a change that moves a case fails the test, and the diff of
  the file regenerated is read as the diff of `sizes.json` is.
- **The interpreter is the oracle of `compile.ts`.** `compile_guard` gives
  `is`'s verdict and `compile_parse` gives `parse`'s result: the same output,
  the input itself exactly where the interpreter's is, and the interpreter's
  issues, which compiled code never builds. A change to what a `run` in
  `schema.ts` accepts, copies, or passes on is a change to `compile.ts`, as
  it is to `walk.rs`, and the two differential tests of the compiler are
  where it shows. What may differ is declared in `docs/design.md`, under
  Compiling, which has the one list of it.
- **`compile.ts` refuses what the library walks in exponential time**: a
  `union` or a `pipe` on a cycle, two or more options or steps of which reach
  a cycle, by the Rust crate's rule for the options, `union_memoized` and
  `told_apart` in `builder.rs`: one rule written twice for a plain `union`
  on a cycle, each side held to the other by the rows of
  `src/test/fixtures/json/union_bounds.json`, so a change to either is made
  to both. A failed parse and a subtree run in place are
  the library's walk, so nothing compiled bounds them: a change that lets
  such a schema compile breaks the bound the docs give. A cycle a
  `memo_union` is on counts as none. A plain `union` is compiled as its
  options in the schema's order, and keeps nothing.
  `compile.bounds.test.ts` holds what compiles to the bound by counted work,
  and a new kind that runs schemas on one value, as `union` and `pipe` do,
  gets the rule and a row in its grammar. `compile.refusal.test.ts` has a
  shape for every condition of the rule, and `mutants.ts` a mutant that
  drops each: a kind added to the walk that finds a cycle, to what could
  take an array or an object, or to what tells options apart gets both.
- **`compile.ts` reads a schema and never writes to one.** It reads `kind`
  and `def`, calls a `lazy`'s function once, and calls a `run` only for a
  subtree it runs in place. A `union`'s and a `pipe`'s `def` is the schema's
  own array: a walk that uses one as a work list empties the schema.
  `compile.source.test.ts` compiles schemas frozen to their last `def`.
- **Emitted source is built only from safe parts**: a name the emitter makes
  is `_` and a counter, from the one `fresh`, a captured value is `c` and its
  index, and the names written out in the emitter are of neither form, so no
  two names meet. A string of the schema's goes through `quote`, a number or
  a bigint is printed once `typeof` says it is one, and anything else is a
  captured value. A new place that writes schema data into source goes
  through one of those, and gets a row in the hostile cases of
  `compile.source.test.ts`. No table of the emitter is a plain object keyed by
  schema data, an entry's name among it: a `Map`.
- **In a written module a captured value is text or it is refused.**
  `to_guard_source` shares the emitter, and writes what the emitter captures:
  a `regex`'s pattern by its source and flags through `quote`, the
  emitter's own `Set` by its literals, and a `uuid`, an `iso_datetime`, and a
  `to_integer` as an import from the library, never as a copy of a grammar.
  A new thing the emitter captures gets a text there or the refusal, and a
  hostile case in `compile.emit.test.ts`. What only a module needs stays in
  `to_guard_source`, which a bundle with `compile_guard` alone drops, but the
  text of that `Set` and the call that hands a captured value over, which
  are the emitter's and run only for a module.
- **The state of a compiled call is saved at entry and put back at exit**, a
  throw included, where a schema has any: the verdicts a `memo_union` keeps
  and the context of a subtree run in place. A new variable a call writes to beside
  the functions goes through `state`, or an inner call from a `check` leaves
  the outer one's wrong.
- **A subtree run in place under a `memo_union` shares one context for a
  call**, probing where the library would be, as a `memo_union` keeps its memo
  by context: a context for each subtree gives an object the input holds
  twice two outputs where the library gives one.
- **The library has no dependencies.** The comparison libraries and the
  bundler are devDependencies of the benchmarks only.
  `src/test/schema.invariants.test.ts` fails on a `dependencies`,
  `peerDependencies`, or `optionalDependencies`.
- **A generated process module holds nothing of the harness** but what
  cancels between the readings a figure is taken from, as an export's
  `PROGRAM` does in `heap.ts`. The bare baseline is that module with no
  library, and is what gets subtracted.

## Working on the library

Grade a change before keeping it: `npm run grade`, then read the verdict
against `docs/grading.md`. Add a case to `src/benchmarks/cases.ts` first when
the change targets a path no case isolates. Every summary time `grade` prints
is beside its A/A, what instances of one version differed by in the same
processes: a time inside its A/A is not a difference. A case's time is beside
its floor, and only a case marked `*` is a finding: one outside its floor or
marked `?` is not. Give a small change `--runs 6` or more, an even count, so each
version is loaded first equally often, and a quiet machine, which
narrows the A/A. Bundle bytes are exact, and allocations are exact for the
code the engine is running, see `docs/benchmarks.md`.
`npm run grade -- --replay .gro/grade/<start>` reads a finished grade again,
by the rules as they are, measuring nothing.

A change's diff of `src/benchmarks/sizes.json` is its byte cost across the
library, every export, last in and alone, and not only the scenarios:
regenerate it with the change, and read the diff. `grade` prints the same
figures of both versions, core and opt-in, and prices them by the change's
class: `--class correctness` for a fix of correctness or conformance, whose
bytes need no speedup, `--class security` for a fix of over-acceptance, of
denial of service on data-shaped input, or of input leaking into issues,
which goes ahead of other work and leaves the backstop to the user,
`--class feature` for a new export, whose own figures are reported and not
priced while core stays at +0, and speed by default, see `docs/grading.md`.

- **Measure before stating.** What the engine allocates, inlines, or folds is
  measured before it is said, in a comment, a doc, or a proposal.
- **The grader's two versions share a process in `matrix` and `alone`**, so
  those can't see a cost one of them puts on both through the engine's state:
  a write to a schema, or a field added to one. The `apart` regime holds a
  version to a process and is where such a cost shows, on cases named with
  `--apart` when the default few don't take its path.
  `src/test/schema.shape.test.ts` holds the schemas to one map and no field
  written to, whatever the grade says.
  Module-level state is each instance's own, so what one schema's use does to
  it is read in `matrix` and not apart.
- **Read the grade's lists with its verdict lines**: what allocates more,
  what retains more in total, the figures per further schema rule 9 prices,
  and the cases marked. Read every regime.
- **A declined trade gets an entry in `docs/declined.md`**, with its numbers.
- **A change a consumer sees gets a changeset**, in the house style of
  `.changeset/README.md`.

Easy to break in the grader without a test noticing: an instance shares no
function with another, every instance gets the same checks and the same time,
in the same way, each cycling through copies of its input (`inputs.ts`) as
every other does, and a case allocates more only where both of the graded
version's instances say so. For `apart`: a process holds no module of the
other version, its program runs through an instance that is not timed, and a
process does the same whichever version it holds. Four more are checked by
every process of the grader as it starts, before it loads an instance, so a
break of one fails the grade and not only a reading of it: the arms of a job
load from one directory, a timing runs under no flags of its own and no
`NODE_OPTIONS`, a bytes process holds two instances of each version, and a
process apart holds one version. `docs/grading.md` says what each of those
guards against.

The flat namespace is enforced: `svelte_docinfo({onDuplicates: 'throw'})` in
`vite.config.ts` fails the build when two modules in `src/lib/` export the
same name.

## The benchmarks run on Node directly

`src/benchmarks/*.ts` runs through Node's type stripping, with no build step:
erasable syntax only, imports with explicit `.ts` extensions that Node
resolves on its own (relative paths, packages, `#lib/*`), and `import type`
for types. `allocations.ts` measures allocation, which needs the node flags
for a large young generation: its npm script passes them, and it refuses to
run without, and starts itself twice for each library under them, the second
also under `--no-compilation-cache`, which creation and retained heap per
further schema run under so a library that makes code pays each compile. `run.ts`,
`survey.ts`, `harvest.ts`, `grade.ts`, and `wasm.ts` time, so they run under
none and refuse them, and refuse any `NODE_OPTIONS`, which every process they
start would inherit; `harvest.ts` and `grade.ts` pass the flags to the
processes that measure their bytes.

## Rust workspace

The repo doubles as a Rust workspace: root `Cargo.toml` with the fuz
ecosystem's canonical lints (`unsafe_code = "forbid"`, clippy
pedantic/nursery at warn, rustdoc link and markup lints at deny) and release
profile, crates under `crates/`, and the toolchain pinned in
`rust-toolchain.toml`. Do not use Gro for the Rust side — run cargo directly:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --all-features --document-private-items
```

CI runs these in the `rust` job of `.github/workflows/check.yml`, and builds
`fuz_schema_wasm` in release for `wasm32-unknown-unknown`, the target
`rust-toolchain.toml` installs, holding the `.wasm`'s size to
`crates/fuz_schema_wasm/wasm_size_ceiling.txt`.

`crates/fuz_schema` is the Rust side of the library: its schema model,
whether a JSON text matches a schema, and the issues of one that doesn't.
`docs/rust.md` describes it.

- `lib.rs` - the crate root: `Schema::from_json`, `matches_json`,
  `matches_json_bytes`, `matches_json_exact`, `validate_json`, and
  `validate_json_bytes`, and what the crate exports
- `schema.rs`, `builder.rs` - the model, an arena of nodes, and
  `SchemaBuilder`, whose `build` refuses what isn't portable
- `interchange.rs` - `Schema::from_json`, the loader of the form
  `to_schema_json` writes
- `json.rs` - `Json`, the crate's tree, which holds an object as `JSON.parse`
  would
- `js.rs` - the JavaScript semantics both evaluators share
- `format.rs` - the format tests, `uuid` and `iso_datetime`, as byte scans
- `walk.rs` - the tree evaluator behind `matches_json_exact` and
  `validate_json`, the reference
- `issue.rs` - `SchemaIssue`, what it holds, and its `Display`, the text
  of `format_issue`
- `stream.rs` - the streaming evaluator behind `matches_json`
- `bits.rs` - `Bits`, the fixed-size set of which entries of an object have
  been seen and which must be
- `differential.rs` - the streaming evaluator against the tree one over a
  hand-written table and a large generated text (tests)
- `memo_check.rs` - every fixture with each union's memo off against it on,
  skipping and printing what is too slow without (tests)
- `error.rs` - `JsonError` and `SchemaBuildError`
- `walk/tests.rs`, `builder/tests.rs`, `interchange/tests.rs`,
  `stream/tests.rs` - the unit tests of the module each is named for
- `tests/fixtures.rs` - both evaluators and the issues against
  `src/test/fixtures/json/`, and the groups of `FUZ_SCHEMA_FIXTURES_DIR`
  when it is set

`crates/fuz_schema_wasm` is that crate behind wasm-bindgen: one class,
`CompiledSchema`, whose verdicts are booleans. It isn't published and the
library doesn't use it. `npm run build:wasm` needs wasm-pack and writes to
`target/fuz_schema_wasm`, which is git-ignored. The crate compiles natively,
so the cargo commands above cover it, and it has no Rust tests: the pre-checks
of `npm run benchmark:wasm` run the fixtures through it.

Things that are easy to break without a test noticing:

- **The TypeScript library is the oracle.** `matches_json_exact` gives its
  verdict on every text the crate's parser reads. `matches_json` may be
  stricter and is never looser.
- **Issues are the library's, in its order.** `validate_json` reports what
  `parse` does: each kind, `expected` text, received type, and path. A change
  to what a `run` passes `fail` in `schema.ts` is a change to `walk.rs`.
- **Which entries need their key is the library's.** `Value::Undefined` is a
  missing key and nothing else. `walk.rs` fails an `unknown` given one, as a
  `MissingKey`, wherever an entry reaches it, and the builder's `required` is
  the entries the walker refuses it for. A schema in `schema.ts` that starts
  to read the object its `run` is handed, or to pass it on or stop passing it
  on, is a change to `walk.rs`.
- **A verdict of `walk::run` is a function of the node and the value.** A
  union with two options that could take the same array or object and reach
  a cycle, not told apart first by a `literal`, keeps its verdicts on those
  by address, see `docs/rust.md`, and reads them back. A walker that comes to
  read anything else, an object and a key passed down, a count, or which
  report it has, makes a kept verdict wrong where it differs. A memo lives as
  long as one tree, and the stream's for one walk of what it read into a tree.
  `memo_check.rs` holds every fixture's verdicts and issues to those with the
  memo off, but for the texts too slow without it, which it prints.
- **A difference is declared, not skipped.** It is a flag on a fixture case,
  and `tests/fixtures.rs` asserts the declared behavior.
- **Refuse, don't guess.** What the crate can't carry across is a
  `SchemaBuildError` at build or load, and `to_schema_json` throws on the same.
  A refusal added to one side is added to the other. One a document can
  express gets a row in `src/test/fixtures/json/refusals.ts`: generating
  `contract.json` fails if `to_schema_json` writes its schema or refuses it
  for another reason, and `tests/fixtures.rs` if the crate loads its document
  or refuses it as another kind.
- **A schema that serializes loads.** `to_schema_json` also throws on what
  the crate's parser won't read of the document itself.
- **`expected.json`, `contract.json`, and `union_bounds.json` are
  generated.** Change a `fixture.ts`, a constant, or a shape and run the
  update task.
- **Errors are hand-written enums** with `Display` and `Error` impls, in the
  shape thiserror derives. The crate's dependencies are serde and serde_json.
- **serde_json's `arbitrary_precision` must be off** in any build the crate
  is part of. Under it a number arrives as a map, and `build` makes no schema.
- **`matches_json` buffers only what it must.** A `union` given an array or
  object streams into its one candidate option. A change to which options are
  candidates can make it looser than the oracle.
- **`wasm-bindgen` is pinned to an exact version**, the one the wasm-bindgen
  CLI that wasm-pack runs has. It is the wasm crate's only dependency beyond
  the Rust side.
- **The wasm carries the verdicts and not the issues.** Nothing
  `Schema::from_json`, `SchemaBuilder::build`, or a verdict reaches may reach
  an issue's text (`expected`, `js::number_to_string`, `js::quote`) or format
  an `f64`, which brings core's float formatting into the wasm. A union's
  `expected` text is written at its first failure, never at `build`. CI
  fails a release build over `crates/fuz_schema_wasm/wasm_size_ceiling.txt`;
  raise it only for growth that is meant, after a `twiggy diff`.
- **A new kind** needs a `SchemaNode` variant, a `SchemaKind`, both evaluators,
  its `SchemaIssueKind` and `expected` text when it can fail, the builder's
  reading of which kinds could match an array or an object, the loader,
  `to_schema_json`, and a fixture schema that has it.

## Project standards

- TypeScript strict mode
- Svelte 5 with runes API
- tsv (`gro format`) with tabs, 100 char width
- Node >= 24.14 for the repo's own scripts, in `devEngines`; the package
  declares no `engines`, as the library needs no Node that new
- Tests in `src/test/`, vitest with `assert`
