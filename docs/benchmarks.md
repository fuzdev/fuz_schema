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
| `npm run benchmark:docinfo` | svelte-docinfo's schemas in Valibot against this library: bundle, parse time, allocation |
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

`npm run benchmark:docinfo` compares Valibot and this library on the first
set: the bundle of a module that parses one of its documents, and parse time
and allocation over its output for a library, both as stored and with every
default in place. It is the one comparison of a consumer's whole schema set;
the scenarios are one small schema each.

## Method

- **Parse time**: fuz_util's `Benchmark`, a batch of parses per timing.
- **Bundle size**: an entry that imports one scenario's factory and calls it,
  bundled and minified by Rolldown, then gzipped.
- **Allocation**: growth of V8's used heap across a batch, per call. Needs
  `--expose-gc` and a large young generation, which the npm scripts pass.
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

- Bundle size and allocation are exact. Retained heap repeats to about a kilobyte.
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
