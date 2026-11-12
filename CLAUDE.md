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
gro check     # typecheck, test, lint, format check (run before committing)
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
npm run benchmark:survey      # many small shapes against valibot, zod, and zod compiled, by what a parse does
npm run results               # every benchmark in turn into one results file, see results/README.md
npm run results:publish       # copy a publishable run to results/latest.json, which the site renders
npm run grade                 # grade the working tree against HEAD, see docs/grading.md
npm run grade:aa              # what saved grades of one file against itself say of each line's A/A
npm run differential          # generated schemas and inputs against zod and valibot, memory-capped where systemd-run can
npm run mutate                # break the library on purpose and check the tests fail, see docs/testing.md
npm run fixtures:deep         # generated JSON fixtures, many seeds, through the Rust fixture tests, see docs/rust.md
gro task src/test/fixtures/json/update.task.ts # regenerate the JSON fixtures' expected.json
gro task src/benchmarks/update_sizes.task.ts   # regenerate src/benchmarks/sizes.json
gro task src/test/fixtures/results/update.task.ts # regenerate the fixture results file
BENCH_RESULTS_FIXTURE=1 gro build # build the site over the fixture run (invented numbers, marked on every page)
```

`npm run benchmark` takes `--scenario`, `--lib`, `--no-invalid`, `--no-guard`,
`--duration`, `--passes`, and `--alone`, see `src/benchmarks/run.ts`.
`npm run benchmark:allocations` and `npm run benchmark:heap` take `--scenario`
and `--lib`, `npm run benchmark:coldstart` takes those and `--form`,
`--samples`, and `--discard`, `npm run benchmark:types` takes `--lib` and `--runs`,
`npm run benchmark:bundle` takes `--raw`, and `npm run benchmark:wasm` takes
`--rounds` and `--round-ms`, see `docs/benchmarks.md`. Every script takes
`--help`, and each of those above and of `benchmark:harvest` and
`benchmark:survey` takes `--data`, a path to also write what it measured to
as JSON. `npm run results` takes `--machine`, `--smoke`, `--only`
(repeatable), `--wasm`, and `--plan`, and `npm run results:publish` the path
of a run, see `results/README.md`.
`npm run grade` takes `--against`, `--against-file`, `--against-libs-file`,
`--new-file`, `--filter`, `--runs`, `--alone`, `--no-alone`, `--apart`,
`--no-apart`, `--slice`, `--bundle`, `--no-bundle`, `--process`,
`--no-process`, `--samples`, `--class`, and `--replay`, see `docs/grading.md`.
`npm run grade:aa` takes the directories of grades. `npm run benchmark:harvest` takes `--set`,
`--passes`, and `--duration`. `npm run benchmark:survey` takes `--filter`,
`--lib`, `--passes`, `--duration`, and `--alone`. `npm run differential` takes
`--seed` (repeatable), `--count`, `--focus`, `--limit`, `--neither`, and
`--json-schema`, and
`npm run mutate` takes `--filter`, `--workers`, `--timeout`, `--deep`, and
`--keep`, see `docs/testing.md`. `npm run fixtures:deep` takes `--seed`
(repeatable), `--count`, `--cases`, and `--dir`, see `docs/rust.md`.

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
- `src/lib/introspect.ts` - `unwrap_schema`, `get_schema_meta`,
  `find_schema_meta`, `get_schema_entries`, `get_schema_fields`,
  `format_schema_type`, reading a schema as data, separate so the core never
  carries it
- `src/test/schema.test.ts`, `standard_schema.test.ts`, `meta.test.ts` -
  behavior and type inference: `schema.test.ts` holds the primitives, the
  wrappers, the context, `def`, `is_schema`, flavor and brand, and the types
- `src/test/schema.formats.test.ts` - the format tests: `uuid` against its
  grammar in `docs/formats.md`, `uuid` and `iso_datetime` in a `pipe`, and
  `to_integer` against its grammar there under each option
- `src/test/schema.object.test.ts` - the object schemas: `object`, arrays
  are not objects, copy on write, object keys, `loose_object`'s copy,
  `object_with_rest`, and composing them by spreading `def`
- `src/test/schema.missing_keys.test.ts` - what a missing key does in every
  schema and flavor
- `src/test/schema.keyed_record.test.ts` - `keyed_record`: its keys, what a
  key gives, a key refused and its `invalid_key`, `__proto__`, probe mode, and
  the cap
- `src/test/schema.union.test.ts` - `array`, `union`, `variant`, and probe mode
- `src/test/schema.memo_union.test.ts` - `memo_union` against `union`: its
  verdicts, issues, memo, and the inputs it walks once
- `src/test/schema.pipe.test.ts` - `pipe` and actions, `check_at`, and `message`
- `src/test/schema.issues.test.ts` - a revoked `Proxy`, `parse_or_throw`, the
  issues, `format_issue`, `get_issue_value`, and `format_issue_with_value`
- `src/test/schema_test_helpers.ts` - `issues_of`, which the `schema.*`
  test files above share
- `src/test/schema.inference.test.ts` - what every schema and action infers
  in each position that has lost a type before, and what an object schema
  composed by spreading `def` infers
- `src/test/schema.emit.test.ts` - the declarations a consumer emits for its
  generic helpers over the library compile where they are read, those of its
  exported schemas write every factory's type by its name, and every export
  of `schema.ts` that is or makes a schema declares a named type
- `src/test/schema.invariants.test.ts` - every factory of `schema.ts` and
  `meta.ts` carries `// @__NO_SIDE_EFFECTS__`, every export of the library
  has a doc comment of its own, and the package has no dependencies, with `schema_exports_test_helpers.ts`, the exports that are or
  make a schema, which `schema.emit.test.ts` reads too
- `src/test/schema.docs.test.ts` - a property of a type inferred from an
  object schema has its entry's doc comment and the entry as its definition,
  asked of TypeScript's language service
- `src/test/schema.shape.test.ts` - every schema the library makes has one
  hidden class and no field written to, asked of the engine in a process of
  its own, `shape_test_child.ts`, over the samples in `shape_test_helpers.ts`
- `src/test/schema.fresh_input.test.ts` - an input changed in place after a
  parse gives the next parse's answer, through every kind of container, so a
  cache keyed by the input fails a test and not only a benchmark
- `src/test/engine_state.test.ts` - every protector of the engine intact
  after the grader's program, and a heap that doesn't grow with the count of
  distinct inputs, asked in processes of their own, `engine_state_test_child.ts`
- `src/test/benchmarks.test.ts` - every library must agree on which scenario
  inputs match, its guard with its factory, and its output with this
  library's, so the benchmarks compare like with like; the app's schemas one
  by one; every builder of `libs/schemas/` with its factory's text, and
  `zod_compiled`'s factories with Zod's; and which roots `z.compile` compiles
- `src/test/cases.test.ts` - every case of the matrix matches or not as it
  says and takes the path it names, and the grader builds the `create` cases
  with a library of their own
- `src/test/program.test.ts` - the program of the grader's `apart` regime has
  every kind of schema and runs
- `src/test/survey.test.ts` - every library gives the verdict each input of
  a survey shape names, and one output where it matches, and a row named for
  the depth of its issue has its first issue that deep
- `src/test/docinfo.test.ts`, `src/test/harvest.test.ts` - a harvested set's
  two forms, the consumer's and this library's, give the same answers on its
  data: the first for the valibot set, the second for the zod ones, with its
  helpers in `harvest_test_helpers.ts`
- `src/test/schema_json.test.ts` - what `to_schema_json` writes and refuses
- `src/test/json_schema.test.ts` - what `to_json_schema` writes and refuses,
  on both sides and in both modes
- `src/test/json_schema.conformance.test.ts` - `to_json_schema` against zod's
  `toJSONSchema` over every case of the conformance matrix and its own, each
  difference declared in its `DIFFERENCES` and in `docs/design.md`
- `src/test/json_schema.differential.test.ts` - the documents `to_json_schema`
  writes, read by a checker, against `is` on the input side and `parse`'s
  output on the output side, and those of `unrepresentable: 'any'` one way,
  over generated schemas and JSON inputs from fixed seeds, a family of
  `to_integer` pipes over texts of its grammar among them, each disagreement
  explained by an entry of
  `JSON_SCHEMA_DIFFERENCES`, with a pinned case for each. Its modules, each
  importing only those before it: `json_schema_check.ts`, a validator of
  exactly the keywords the emitter writes, which throws on any other;
  `json_schema_differential.ts`, the run, the declared differences and their
  recognizers, the minimizer, and the report
- `src/test/introspect.test.ts` - the readers, with a row for every kind
  that the types require
- `src/test/schema.conformance.test.ts` - where zod and valibot agree this
  library does the same, or the difference is in the tables of
  `conformance_tables.ts`: the declared differences, which of the two it goes
  with where they disagree, and what arktype and typebox do, pinned. Its
  modules, each importing only those before it: `conformance_adapters.ts`,
  the libraries and what a parse did reduced to a result; `conformance_cases.ts`,
  the matrix of cases and their inputs; `conformance_test_helpers.ts`, the
  running and the comparison
- `src/test/schema.differential.test.ts` - the same rule over schemas and
  inputs generated from fixed seeds, each difference explained by a rule of a
  declared one, with this library's invariants on every case, `memo_union`
  held to `union` on recursive schemas over inputs that reuse nodes, and a
  pinned case for each entry of `SPLIT_RECOGNIZERS`. Its modules, each
  importing only those before it: `differential_generate.ts`, the generated
  schemas and inputs and the run of a library on them;
  `differential_rules.ts`, the rules and the rewrites and comparison they are
  made of;
  `differential_recognizers.ts`, `SPLIT_RECOGNIZERS` and `split_side`, and
  `FORMAT_SPLIT_RECOGNIZERS` for the strings of the format tests;
  `differential_classify.ts`, the classifying, invariants, minimizer, and
  report. `differential.ts` is `npm run differential`, a deeper run of any
  seed
- `src/test/seeded_rng.ts` - the seeded generator the differential and the
  generated JSON fixtures draw from
- `src/test/mutants.ts`, `mutate.ts`, `mutants.test.ts` - the table of mutants, small breaks
  of the library or of a table the tests read, and `npm run mutate`, which
  runs the tests on a copy of the working tree with each applied and fails
  on an error or on one that survives unexplained, and the test that holds
  every mutant's anchors to its file
- `src/test/fixtures/json/` - the fixtures shared with the Rust crate
  - `<group>/fixture.ts` - authored: a schema and named JSON texts
  - `<group>/expected.json` - generated by the update task, never hand-edited
  - `contract.json` - generated too: the constants both sides hold, and the
    rows of `refusals.ts`
  - `refusals.ts` - authored: each refusal both sides make of a document, as
    a schema `to_schema_json` refuses with the message it gives, the document
    a writer without the refusal would write, and the crate's
    `SchemaBuildErrorKind`
  - `json_test_helpers.ts`, `update.task.ts` - the oracle, the loader, and the
    task that regenerates
  - `json_syntax_texts.ts` - texts several groups share
  - `json_generate.ts` - a random schema and texts aimed at it from a seed,
    what the `generated_*` groups export
  - `deep.ts` - `npm run fixtures:deep`, many more generated groups, written
    outside the repo and run through the Rust fixture tests
- `src/test/json.fixtures.test.ts` - fails when a generated file is stale
- `src/test/sizes.test.ts` - fails when `src/benchmarks/sizes.json` is stale
- `src/test/results_schema.test.ts` - the results schema: the fixture run,
  what it refuses and where, what is publishable, and a stale
  `fixtures/results/fixture_run.json`, which `fixture_results.ts` builds from
  invented numbers and `update.task.ts` beside it writes
- `src/test/results_plan.test.ts`, `results_run.test.ts`,
  `results_publish.test.ts`, `results_docs.test.ts` - a run's steps against
  `package.json` and the scripts' `--data`, a whole run with every script
  standing in and the tree read as it starts and as it ends, the reading of
  the commit against a repository made for the test, publishing, and
  `results/README.md` against the commands
- `src/test/benchmark_*.test.ts`, `site_benchmarks.test.ts` - the
  benchmarks page's derivations over the fixture run, and which file the
  site renders
- `src/test/results_test_helpers.ts` - what the tests of the results file and
  the site share: the fixture as a fresh copy, the same under the kind of a
  full run, a section's data, and a parse that must fail where it is told
- `src/test/site_imports.test.ts` - the library imports nothing of the
  benchmarks or the site, and only a server load loads the results schema,
  a results file, or the fixture
- `src/test/site_render.test.ts` - what the site's components render on the
  server, as the text a reader sees without a pointer: the banner of a build
  over the fixture or an unpublished run, what was measured of each library
  under a chart, the marks of what is not a difference, a harvested set
  folded, and the provenance, with `SiteHarness.svelte`, the context the root
  layout gives
- `src/test/readme_claims.ts`, `readme_claims.test.ts`,
  `readme_measurements.test.ts` - the README's claims, each its sentence, the
  libraries it names, and a predicate over a results file that reads a
  difference as the benchmarks page does; the checker over the fixture, with
  a change that fails each claim for every library it names; and the README
  itself against `results/latest.json`
- `src/test/readme_recipes.test.ts` - the README's recipes, each as it is
  printed and what the README says it gives, and the README's blocks marked
  `<!-- recipe: <name> -->` held to them
- `src/test/grade_bytes.test.ts`, `grade_heap.test.ts` - the grader's prices
  of bytes and of retained heap, over figures made up for them
- `src/test/grade_stats.test.ts` - the grader's statistics over made-up
  samples: floors, marks, and the A/A, and how often two copies fail rule 6
  under noise of the shape a grade reads
- `src/test/grade_read.test.ts`, `grade_plan.test.ts` - the grader's reading
  over grades made up for it, and the names it plans with held to the cases and
  scenarios they name
- `src/test/measure.test.ts` - a median of the byte measurement starts with
  the young generation free, by allocating until it is collected
- `src/test/coldstart.test.ts` - the order cold start runs a round's
  processes in moves on each round, in who leads and who follows whom
- `src/benchmarks/` - the benchmarks; never imported by the library, and by
  the site only for the results schema, at runtime in its server loads alone
  - `scenarios.ts`, `libs/`, `libs.ts`, `lib_names.ts` - the cross-library
    scenarios, one module per library, and the libraries' names, which import
    none of them
  - `libs/schemas/`, `scenario_schemas.ts` - each library's scenarios again
    as builders, with its guard and parse, which no bundle reaches: the guard
    regime, the type benchmark's reads, and the parity tests read them
  - `zod_compile.ts` - `compile_zod_root`, whether `z.compile` compiles a
    root, by which every timing leaves `zod_compiled` without a figure
  - `run.ts`, `bundle.ts`, `allocations.ts`, `types.ts` - parse time, bundle
    size, allocation, type-checking cost
  - `timing_passes.ts`, `timing_child.ts`, `timing_job.ts`, `timing.ts` -
    timing across libraries, for `run.ts`, `harvest.ts`, and `survey.ts`: the passes of
    processes and their pooling, one process, what those two share, and the
    loops a function is called and timed from, which the grader's processes
    load too
  - `run_rows.ts`, `harvest_sets.ts`, `survey_rows.ts` - what a timing
    process loads its rows through: one library's scenarios, one side of a
    harvested set, with the sets' declarations, and one library's survey rows
  - `survey.ts`, `survey_shapes.ts` - many small shapes in this library,
    Valibot, and Zod, timed row by row and summarized by what a parse does
  - `coldstart.ts`, `run_coldstart.ts`, `heap.ts`, `run_heap.ts`, `child.ts` -
    cold start and retained heap, each sample in a generated process.
    `child.ts` also starts the processes of the grader and of the timing.
  - `args.ts` - what the scripts parse their args through: the library
    imported under `?args`, an instance no measurement uses, the arg schemas
    the scripts share, and `--help`
  - `machine.ts` - what the machine is and was doing, the header every
    script prints first
  - `inputs.ts` - the copies of an input every timed function cycles
    through, a copy a call
  - `cases.ts`, `grade.ts` - the case matrix and the A/B grader
  - `grade_bytes.ts` - how the grader prices bytes: core and opt-in, the
    class of a change, and the backstop against Valibot
  - `grade_stats.ts` - how the grader reads its timings: a case's runs
    against its floor, and a set of cases as one figure against its A/A
  - `grade_heap.ts` - how the grader prices retained heap: the figure per
    further schema, of each scenario and each export alone, and its allowance
  - `grade_read.ts`, `grade_plan.ts`, `grade_aa.ts` - how the grader reads a
    grade, its rules and lists from a record and its jobs, for a grade and
    for `--replay`; what it plans before a process runs, the arms, the jobs
    apart, and the lock; and the A/A of every line rule 6 and the warning
    read, over saved grades of two copies of one file
  - `grade_child.ts`, `grade_arm.ts`, `grade_job.ts` - a process of the
    grader, what it loads once for each instance of a version, and what the
    grader and its processes share, the paths of a case among it
  - `program.ts` - one schema of every kind, built and run: what a process of
    the grader's `apart` regime runs before it times a case
  - `docinfo/`, `repos_status/`, `package_json/`, `bench_results/`,
    `fuz_app/` - the harvested sets: a consumer's schemas as it writes them
    (valibot or zod), the same in this library, and its data, for the cases.
    `fuz_app/` is written in this library already and has the one side, with
    frames and bodies its in-memory app wrote. Snapshots, not kept in step,
    see `docs/benchmarks.md`
  - `wasm.ts` - the wasm build against the library, which also runs the JSON
    fixtures through the wasm
  - `harvest.ts` - each harvested set's own library against this one on its
    schemas and data: bundle size, parse time, allocation, a side of a set to
    a process
  - `measure.ts`, `bundle_size.ts` - shared measurement helpers, the second
    with the bundling: a library's scenarios, and this library whole and
    export by export
  - `results_schema.ts` - the schema of a results file, one run of every
    benchmark, written in this library: each script's data, the sections, the
    roster, what is publishable, and `parse_benchmark_results`, which every
    reader goes through
  - `results_plan.ts`, `results_run.ts`, `results_publish.ts` -
    `npm run results`, which starts each script through its npm script with
    `--data` and composes one file, what it plans, and
    `npm run results:publish`
  - `sizes.ts`, `sizes.json`, `update_sizes.task.ts` - the committed snapshot
    of this library's gzipped sizes, generated and never hand-edited: what it
    holds, the file, and the task that regenerates it
- `src/routes/` - the static SvelteKit site, with API docs generated by the
  `svelte-docinfo` Vite plugin under `src/routes/docs/`, deployed to
  schema.fuz.dev (`static/CNAME`)
  - `+layout.server.ts`, `+page.server.ts` - the server loads of the root:
    where the rendered results came from, for the banner every page of a
    build over the fixture or an unpublished run carries, and the landing
    page's headline figures, worked out from the file at build time
  - `docs/benchmarks/` - the `benchmarks` tome and its modules, which the
    landing page's summary imports too: `site_benchmarks.server.ts` (which
    results file is rendered, read in the server loads), `benchmark_matrix.ts`
    (the rows every table and chart share, their baseline, ratios, and means,
    and when two numbers are level: a row's inside its spreads, two means
    where their bands overlap),
    `benchmark_sections.ts` (each section's rows from a results file, and the
    tolerance a figure with no spread of its own is compared by),
    `benchmark_headline.ts` (the landing page's figures),
    `benchmark_ratio.ts`, `benchmark_format.ts`, `benchmark_provenance.ts`,
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
  types of the schemas, metadata, JSON Schema
- `docs/benchmarks.md` - what every benchmark measures and how, how far to
  trust each number, and how to extend them
- `docs/grading.md` - `npm run grade` and the rules a change is accepted by
- `docs/testing.md` - what holds the library to more than its own examples:
  conformance, the differential, the JSON fixtures, and mutants
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
  keys, and `strip_object` never returns one.
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
  with, through every pipe that is its first schema, and it shares the steps
  with the closure of two. Without the `1`, under a `nullable`, a `lazy`, or a
  `union`, its steps run on the `undefined`, as they do after any of those
  that reaches an `optional`, which keeps a step that fails there reported
  where Zod and Valibot both refuse the input.
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
  in the matrix.
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
process apart holds one version. `docs/benchmarks.md` says what each of those
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
run without, and starts itself again for each library under them. `run.ts`,
`survey.ts`, `harvest.ts`, `grade.ts`, and `wasm.ts` time, so they run under
none and refuse them, and refuse any `NODE_OPTIONS`, which every process they
start would inherit; `harvest.ts` and `grade.ts` pass the flags to the
processes that measure their bytes.

## Rust workspace

The repo doubles as a Rust workspace: root `Cargo.toml` with the fuz
ecosystem's canonical lints (`unsafe_code = "forbid"`, clippy
pedantic/nursery at warn) and release profile, crates under `crates/`, and
the toolchain pinned in `rust-toolchain.toml`. Do not use Gro for the Rust
side — run cargo directly:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
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
- **`expected.json` and `contract.json` are generated.** Change a
  `fixture.ts` or a constant and run the update task.
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
