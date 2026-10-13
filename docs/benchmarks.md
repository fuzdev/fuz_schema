# Benchmarks

Everything is in `src/benchmarks/`. The comparison libraries are Valibot, Zod,
Zod Mini, TypeBox, and ArkType.

| Command | Measures |
|---|---|
| `npm run benchmark` | parse time per scenario, valid and invalid |
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
once.

- **A set is a process.** Each is measured in a process of its own, so what
  one set's schemas teach the engine about a library's shared code is not
  there when the next is timed, and a set reads the same run alone.
- **Agreement comes first.** Every row is run by each side, and must give the
  verdict the row names and outputs that are deeply and strictly equal, before
  anything is timed. A row that fails stops the run. The ways the rewrites
  differ are all on input this data doesn't have, or in the issues of a
  document that doesn't match, which are not compared.
- **The rows** are a typical document, the collection where the consumer reads
  one, a document that doesn't match, and one through a guard. A document
  `cases.ts` takes from a set unchanged is a row here too.
- **Timing** runs a row on every side for at least a set time and count, then
  times the sides in turns, each round starting one later, and takes medians.
  A timing is long enough that a collection of the young generation is a small
  part of it. It is taken in the process the bytes are, under the flags the
  bytes need. Those are not the flags a consumer runs under, and a side's time
  moves with them, by set and not always the same way.
- **Bytes** are measured as [below](#method), each row after its timing. The
  same parse in two rows reads within about a percent. A figure is of the code
  the engine has made for a set's rows together: a document parsed alone in a
  process can allocate less.
- **Zod is two columns.** It compiles a parser for each object schema with
  `new Function` on that schema's first parse, where the environment lets it,
  and otherwise interprets: under `z.config({jitless: true})`, or a content
  security policy that refuses eval. `zod jitless` is the interpreter, asked
  for a parse at a time on the same schemas, and the run checks that those
  parses compiled nothing, and that the others compiled some.
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

- **Parse time**: fuz_util's `Benchmark`, a batch of parses per timing.
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
  refuse to run without them.
- **Cold start**: one fresh Node process per sample, in three stages that
  build on each other, against a bare process. Bundled and unbundled entries.
  Compile cache off, rounds interleaved, medians.
- **Retained heap**: a fresh process builds the schema, parses once, and
  collects until the heap settles. Read for one schema and for many.
- **Type-checking**: `tsc` over one library's scenario module.
- **wasm**: rows timed a round at a time, each round starting a row later,
  medians. See [below](#wasm).

The process benchmarks follow
[syntax-highlighter-bench](https://github.com/ryanatkn/syntax-highlighter-bench).
Their generated modules are under `node_modules/.cache/fuz_schema/`.

## Reading the numbers

- Bundle size is exact. Allocation is exact for the code the engine is running
  when it is sampled: two readings of one parse in a process agree to the byte
  on a small case and within a few bytes on most large ones, and the largest
  copy has read over a tenth of a percent apart. Which code the engine runs is
  settled per process, and not always the same way. From one run to the next
  a case of `grade` reads the same in the whole matrix and alone, but for the
  largest copy, which moves by a percent or two. Under a filter that takes in
  a few cases the two versions can be left in different code, and an unchanged
  library then reads less on one side, by the context, and faster. A row of
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
  and quiet the machine before recording a result.
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

  By [grading.md](grading.md), a difference under 10% is not a win.

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
