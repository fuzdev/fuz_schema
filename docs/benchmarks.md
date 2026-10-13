# Benchmarks

Everything is in `src/benchmarks/`. The comparison libraries are Valibot, Zod,
Zod Mini, TypeBox, and ArkType.

| Command | Measures |
|---|---|
| `npm run benchmark` | parse time per scenario, valid and invalid, a library to a process |
| `npm run benchmark:bundle` | bundle size per scenario, minified and gzipped |
| `npm run benchmark:allocations` | heap bytes per parse and per schema built |
| `npm run benchmark:coldstart` | a fresh process: import, build, first parse, peak memory |
| `npm run benchmark:heap` | memory still held after building and parsing |
| `npm run benchmark:types` | cost to the TypeScript checker |
| `npm run benchmark:wasm` | the Rust crate as wasm against this library, on whether a JSON text matches |
| `npm run benchmark:harvest` | each harvested set in its own library, Valibot or Zod, against this one: bundle, parse time, allocation |
| `npm run grade` | this library against another version of itself ([grading.md](grading.md)) |

## Scenarios and cases

- **Scenarios** (`scenarios.ts`, `libs/`) are written for every library: a
  schema, a valid input, an invalid input. `type_json` is a real recursive
  schema from [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo); the
  rest are synthetic. A test holds every library to the same answer on each.
- **Cases** (`cases.ts`) are for this library only: schema-and-input pairs
  named `group/shape/outcome`, which `grade` runs. They come in tiers:
  - `real` is what a consumer has. Some are written for the purpose: an
    object, a list, a config, a form, an event stream, a union of shapes.
    The rest are harvested from consumers, below. Speed is judged on these,
    so they are chosen as a set, each differing from the rest in the schema
    kinds it leans on or the path it takes.
  - The other groups hold one case per code path, at one medium size. `each`
    runs a schema over a hundred items, so its cost shows over the fixed cost
    of a parse, which `fixed` measures alone.
  - `scale` repeats a shape at the sizes where a different cost takes over.

  Every case names its path: `identity` returns the input itself, `copy`
  returns another value, `issues` fails through `parse`, and `probe` goes
  through `is`. Schemas are written as literals and inputs come from
  `JSON.parse`, as a consumer's do: an object built key by key can be a
  different kind of object to the engine, and cost differently.

### Harvested sets

A harvested set is a consumer's own schemas and its own data, copied in as a
snapshot. Each has a directory under `src/benchmarks/` holding the schemas as
the consumer writes them, the same schemas in this library, and the data, each
file naming the commit it came from. The consumer is not changed and the
snapshot is not kept in step with it.

| Set | From | What it is |
|---|---|---|
| `docinfo/` | [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo), in Valibot | analysis output: strict objects with many defaults, variants, a recursive type; its fixtures and its output for a whole library |
| `repos_status/` | [fuz_repos](https://github.com/fuzdev/fuz_repos), in Zod | a status report: strict objects and discriminated unions nested several deep, under a plain union; its test goldens |
| `package_json/` | [fuz_util](https://github.com/fuzdev/fuz_util), in Zod | a `package.json`: a loose object, records, unions with no discriminator; manifests of this ecosystem's repos and of published packages |
| `bench_results/` | [syntax-highlighter-bench](https://github.com/ryanatkn/syntax-highlighter-bench), in Zod | a results document, its structure without its refinements: records keyed by id, numbers each with its checks; a test fixture and a published run |

`src/test/docinfo.test.ts` and `src/test/harvest.test.ts` hold each pair to the
same verdict and output on the data, and on that data changed in one place at
a time. Where a rewrite had to stand something in for what the consumer's
library has built in, the header of the rewritten file says what.

### Head to head

`npm run benchmark:harvest` compares each set's own library with this one, on
that set's schemas and data: the bundle of a module that parses one document,
then parse time and allocation over rows that are documents of the set. They
are the comparisons of a consumer's whole schema set; the scenarios are one
small schema each. `--set` names the sets to run, and may be given more than
once. `--passes` and `--duration` are as for `npm run benchmark`,
[below](#timing-across-libraries), which this is timed like.

- **A side of a set is a process.** A side is a column: the consumer's
  library, this library, and each of Zod's two modes. Each is measured in a
  process of its own, so what one side's parses teach the engine is not there
  when another is timed. A process holds one set, so a set reads the same run
  alone. It loads the set whole: both schema modules are built in it, and this
  library prepares some inputs: the `full` rows are its own output, and the
  published manifests of `package_json` are the ones it matches. From
  then on it runs its side and no other.
- **Agreement comes first.** Every row is run by each side, and must give the
  verdict the row names and outputs that are deeply and strictly equal, before
  anything is measured, in the process that starts the others and times
  nothing. A row that fails stops the run. The ways the rewrites differ are
  all on input this data doesn't have, or in the issues of a document that
  doesn't match, which are not compared. A measuring process checks its own
  side's verdicts again.
- **The rows** are a typical document, the collection where the consumer reads
  one, a document that doesn't match, and one through a guard. A document
  `cases.ts` takes from a set unchanged is a row here too.
- **Timing** is in passes, a fresh process for each side in each, under the
  flags a consumer has. A process runs every row of its side before it times
  any, so a row is timed in code that has seen the set's other documents. A
  time is the median of the passes, printed beside their spread and its
  median batch.
- **Bytes** are measured as [below](#method), in other processes, a side to
  each, under the flags bytes need. They are not timed, so they run several
  at once, after every set has been timed, and the tables are printed when
  they are done. The same parse in two rows reads within about a percent. A
  figure is of the code the engine has made for a set's rows together: a
  document parsed alone in a process can allocate less.
- **Zod is two columns.** It compiles a parser for each object schema with
  `new Function` on that schema's first parse, where the environment lets it,
  and otherwise interprets: under `z.config({jitless: true})`, or a content
  security policy that refuses eval. `zod jitless` is the interpreter, asked
  for a parse at a time on the same schemas. The two are processes of their
  own, so neither runs in code the other shaped, and each checks itself: that
  the interpreter's parses compiled nothing, and that the others compiled
  some.
- **Zod's bundle** is the consumer's module as it is written, on classic `zod`
  and not `zod/mini`, which the consumer would have to be rewritten for.
- **Zod has no guard**, so its side of a guard row is `safeParse` read for
  `success`.

It isn't like-for-like, in ways that differ by set and are printed under each:

- Valibot and Zod return a fresh copy of what they read. This library returns
  its input wherever nothing changed, which is every matching row of the Zod
  sets and the `full` rows of `docinfo`: those compare a copy with a check.
  Zod's strict objects strip nothing, and its loose ones copy the keys the
  schema doesn't name.
- `package_json` is partly the consumer's own code. Nearly every manifest of
  this ecosystem has a `glyph`, checked with a new `Intl.Segmenter` in both
  schema modules, and a row has one such manifest with its `glyph` taken out,
  to show what the check is of a parse. The rows named `published` have no
  `glyph` and compare the libraries more nearly. A URL is Zod's `z.url()` on one side and
  the rewrite's own code around `URL.canParse` on the other, which is timed
  alone under the tables.
- `bench_results` is structure only: its refinements are in neither side, and
  the cross-references they make are a share of the consumer's real parse. Its
  records with checked keys are Zod's own on one side and a `record` between
  two checks on the other.

## Method

- **Parse time**: a process for each library, in passes. See
  [below](#timing-across-libraries). `grade` times its own way, after that.
- **Bundle size**: an entry that imports one scenario's factory and calls it,
  bundled and minified by Rolldown, then gzipped.
- **Allocation**: growth of V8's used heap across a sample of calls, per call,
  with no collection forced. A forced collection makes the engine throw away
  optimized code, and the calls sampled after it allocate more than the code
  a consumer runs. A sample is a small share of a large young generation, or
  one call where a call is more than that, so a collection falls in few and
  the median is of the rest. The function is run between medians until two in
  a row agree within half a percent. The measurement throws when a collection
  fell in too many samples or the bytes never settle. The sampling loop is
  the engine's code as well: given one function it inlines it, and an object
  the function only returns is then never allocated. So a process measures
  two functions and throws them away before the first it keeps. The scripts
  need the young generation's node flags, which their npm scripts pass, and
  refuse to run without them. `grade` and `benchmark:harvest` are the other
  way round: they refuse them, and give them to the processes that measure
  their bytes, and such a process that fails is started once more, announced
  on stderr, which a timing never is.
- **Cold start**: one fresh Node process per sample, in three stages that
  build on each other, against a bare process. Bundled and unbundled entries.
  Compile cache off, rounds interleaved, medians.
- **Retained heap**: a fresh process builds the schema, parses once, and
  collects until the heap settles. Read for one schema and for many.
- **Type-checking**: `tsc` over one library's scenario module.
- **wasm**: rows timed a round at a time, each round starting a row later,
  medians. See [below](#wasm).

### Timing across libraries

`npm run benchmark` (`run.ts`) and `npm run benchmark:harvest` (`harvest.ts`)
time the same way. `timing_passes.ts` plans the processes and pools them,
`timing_child.ts` is one process, `timing_job.ts` is what those two share,
and `timing.ts` is the loops a function is called and timed from. `run_rows.ts`
and `harvest_sets.ts` are what a process loads its rows through.

- **A process holds one library.** What a library takes depends on what its
  process ran before. Call sites that two libraries reach have seen both, the
  engine sizes the young generation from what was allocated lately, an input
  one library left as a slower kind of object is slower for the next, and
  whatever is timed first reads slow. Timed together, a library's figure
  moves with the list of libraries and their order. So each has a process,
  which imports its module and no other library's.
- **A process is a draw.** The same code settles at another speed from one
  process to the next and stays there, so more samples inside one process
  only read that draw more finely. The whole is repeated instead: `--passes`
  times, five by default, every library in a fresh process each pass. A figure
  is the median of its passes.
- **The spread is printed beside every figure**: half of what its passes
  range over, as a share of the median, with the fastest and slowest pass. It
  is how far that figure moved on that run, from one process to the next and
  with which row a process ran first: a library can settle differently on
  that alone, the same way every time. Two libraries whose gap is inside
  their spreads have not been told apart.
- **Order favors nothing.** Which library's process starts a pass moves on by
  a pass, forward and backward by turns, and which row a process measures
  first moves on with it. Timed processes run one at a time. The order is
  rotated and not balanced: at the default count of passes a library does
  not start a pass in every place. A run of some libraries or scenarios
  agrees with a full one within spread.
- **Warm by time with a floor of calls**, through the loop that then times,
  and force no collection. The loops have been run over several functions
  first, so the engine doesn't inline a row into them.
- **A figure is the whole of a timing over its calls.** The collections a
  library's parses bring are in it, and they are not always small: what
  Zod's failing parse makes outlives a collection of the young generation,
  and collecting it is around half of such a row. A median of short batches
  would leave that out, and flatter the library that causes it. That median
  is printed beside the figure, pooled over the passes the same way, and no
  ratio is taken from it: a wide gap between the two is collection time.
- **A call is in every figure.** Because the loop inlines nothing, each
  parse is a real call, and what that costs is in every row alike. A process
  times a function that does nothing through the same loop, and the figure is
  printed under the tables: a row near it is mostly the call, and the ratio of
  two such rows says little.
- **Time is taken under no flags**, and a timing process refuses any of the
  ones bytes need.
- **`--duration`** is the milliseconds each row of each library is timed for
  in all, shared out over the passes. More passes at one duration cost the
  warming and the processes again, not the timing.

`npm run benchmark` has two regimes, the two [`grade`](grading.md) has:

- **shared**, the default: a library's process holds every scenario, and runs
  each of them on both of its inputs before it times any. A scenario's valid
  and invalid rows share one schema. Every call site in the library has then
  seen several schemas, as in an app, and a row reads the same whichever
  scenarios are asked for and in whatever order: `--scenario` and
  `--no-invalid` pick what is timed and printed, not what the process runs
  first.
- **alone**, with `--alone`: a process for each scenario on each input, which
  builds and runs only that. The engine specializes the library to the one
  schema, and to the row's one input: the smallest rows then read as the call
  itself, with nothing left of the parse to compare. On the rest a library
  reads faster than shared, and by the most where it compiles a validator. It
  is what a program with one schema pays at best, and takes a process for
  every row of every library in every pass.

What a process per library tells: what a library takes on these rows with
the engine's attention to itself, which is what an app that validates with
one library has. What it doesn't: what two libraries in one program cost each
other, which no figure here includes. And it does not make a figure exact. A
library is still a few draws, read at their median, on one machine and one
version of Node.

### Grading

`grade.ts` plans processes and reads them together, `grade_child.ts` is one
process, `grade_arm.ts` and `timing.ts` are what a process loads once for
each instance, the case matrix and the loops, and `grade_job.ts` is what the
first two share. [grading.md](grading.md) says what
is measured and how a difference is decided. What the code has to hold to:

- **An instance is a module instance of everything it is called through**:
  the library, the case matrix, and the loops that call and time a case. The
  process loads each under a URL with the instance's own query, and a resolve
  hook passes the query on to what those modules import. Two instances of one
  file then share no function, which a process checks before it measures.
- **Nothing one instance has run is known to another.** A function shared by
  two versions, a case's or a loop's, is specialized by the engine to the
  first version's `parse`, and the same library then reads apart from itself
  in time and in bytes. So each instance has its own.
- **Every instance is treated alike**, down to the calls that check a case
  before it is measured. An instance that runs a case once more than the rest
  can settle in other code on it, the same way in every run.
- **The loops that call a case have seen many functions** before they see
  one, so the engine never inlines a case into its loop. When it inlines one
  is a matter of timing, which sets instances of one file far apart.
- **Order favors nothing.** Which instance is loaded first, which runs a case
  first, and which order of a round leads each move on by a case and by a run.
- **Time is taken under no flags**, and a timing process refuses any of the
  ones bytes need, on its command line or in `NODE_OPTIONS`. Bytes are taken
  in processes of their own, which are not timed and so run several at once.
- **The graded version builds every group of cases**, and a group of its that
  throws fails the grade, by name. A baseline with an older API loses the
  groups it can't build, and is compared on the rest.
- **Warm by time with a floor of calls**, never by a count alone, and force no
  collection.

With all of that held, two instances of one file can still settle apart on a
case for the life of a process, whatever the warmup or the order. So that is
measured and not removed: several instances of each version, and whole runs
repeated.

The process benchmarks follow
[syntax-highlighter-bench](https://github.com/ryanatkn/syntax-highlighter-bench).
Their generated modules are under `node_modules/.cache/fuz_schema/`.

## Reading the numbers

- Bundle size is exact. Allocation is exact for the code the engine is running
  when it is sampled: two readings of one parse in a process agree to the byte
  on a small case and within a few bytes on most large ones, and the largest
  copy has read over a tenth of a percent apart. Which code the engine runs is
  settled per process, and not always the same way. `grade` holds two
  instances of the baseline in a bytes process and marks a case they differ
  on. A row of
  `benchmark:allocations` repeats within about a percent, with one kind of
  exception: a row can settle at one of a few figures, tens of bytes apart or
  a few hundred, each process at one of them and every reading in it the
  same. That is over a tenth of the smallest such row. Retained heap repeats
  to about a kilobyte.
- Allocation depends on what else the process has run. A parse whose call
  sites have seen one schema can be inlined and its context removed, and
  reads less than the same parse among many schemas: see
  [grading.md](grading.md).
- Time is not exact. Trust group means and realistic cases over one fast case,
  and quiet the machine before recording a result. One process's reading of
  one function is a draw: the same code loaded twice can settle several
  percent apart on a case and stay there. `grade` measures that beside every
  figure, as a case's floor and a summary's A/A. `benchmark` and
  `benchmark:harvest` repeat the whole in fresh processes and print each
  figure's spread, which is of a few passes: a gap inside it is not a finding,
  and one just outside it is not much of one. `benchmark:allocations` and
  `benchmark:wasm` time in one process, once, so a small gap on a single row
  there is not a finding.
- It isn't like-for-like: TypeBox's check builds no output, ArkType keeps
  unknown keys, and Valibot's bytes pay for more features.
- Cold start reports work inside the process, which resolves sub-millisecond
  gaps. The whole process over bare is also reported, but can't be told from
  zero inside the bare process's own spread.
- Peak memory is `VmHWM`, not `maxRSS`, which a child inherits from its parent.
- Heap figures are for one Node version and architecture. V8 only throughout.

## wasm

`npm run benchmark:wasm` needs `npm run build:wasm` first. When the wasm is
missing or older than a Rust source, a manifest, `Cargo.lock`,
`rust-toolchain.toml`, or `package.json`, it prints NOT RUN and exits with 1,
and never a table.

- **The schema** is an array of the `strict_nested` scenario's object, given
  to the wasm through `to_schema_json`.
- **The payloads** are generated: one item, about 10 KB, and about 4 MB, each
  valid, with a bad first element, and with a bad last element, though the
  one item has no last. The large size is run again with strings that are
  mostly not ASCII, because the glue transcodes ASCII and everything after
  the first unit that isn't by different routes.
- **A pair is of one holding**, and a ratio never crosses them:

  | Holding | JS | wasm |
  |---|---|---|
  | a string | `JSON.parse`, `is` | `matches_json(text)`, or `encodeInto` the handle's buffer then `matches_json_input` |
  | bytes | the faster of `TextDecoder` and `Buffer.toString`, then `JSON.parse`, `is` | `matches_json_bytes(bytes)`, or `set` into the handle's buffer then `matches_json_input`, or `matches_json_input` alone with the bytes already in place |

- **The reference rows** are `JSON.parse` alone, `is` alone on the parsed
  value, and for a valid payload the wasm verdict followed by `JSON.parse`,
  which is the cost when the value is wanted after all.
- **`matches_json_input` alone** is what a source that writes into the module's
  memory would pay. The gap between it and the row with `set` is what the
  copy costs.
- **The `encodeInto` row validates as UTF-8 what the encoder just wrote**,
  because `matches_json_input` is a byte entry point. `matches_json(text)` does not.
- **Before any timing**, every row's verdict is asserted, and every fixture
  is run through every wasm entry point. See [rust.md](rust.md#the-wasm-build).
- **The last lines are the summary**, each figure a wasm row's time over the
  JS of its holding, all of the large payloads:
  - **The stop signal** is the payload with a bad first element, ASCII and
    then not. These rows measure early exit: the wasm stops validating at
    the bad element, though a string is transcoded whole before that, and the
    JS parses the whole text before it looks.
  - **The equal-work figures** are the rows that hold bytes, on the valid
    payloads and those with a bad last element, ASCII and not. Both sides
    read the whole text there.
  - Then the size of the `.wasm`, raw and gzipped.

  A difference under 10% is not a win: nothing here measures its own noise.

## Extending

- A scenario: a name in `ScenarioName`, an entry in `SCENARIOS`, and a
  `scenario_<name>` export in every module under `libs/`.
- A library: a module in `libs/`, an entry in `LIBS`, and its name in the
  lists the process and type benchmarks keep.
- A case: an entry in a group in `cases.ts`, with the path it takes, which
  `grade` and `src/test/cases.test.ts` check. Add to `real` only what is a
  shape of its own: every case there moves what speed is judged on. A path
  case goes in at the size its group already uses, and a schema whose cost
  is near a parse's fixed cost goes in `each`.
- Never add harness imports or work to a generated process module. The bare
  baseline is that module with no library.
