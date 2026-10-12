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
| `npm run grade` | this library against another version of itself ([grading.md](grading.md)) |

## Scenarios and cases

- **Scenarios** (`scenarios.ts`, `libs/`) are written for every library: a
  schema, a valid input, an invalid input. `type_json` is a real recursive
  schema from [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo); the
  rest are synthetic. A test holds every library to the same answer on each.
- **Cases** (`cases.ts`) are for this library only: small schema-and-input
  pairs that each isolate one behavior, named `group/shape/outcome`. `grade`
  runs them. A few are marked realistic, and speed is judged on those.

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
- A case: an entry in a group in `cases.ts`.
- Never add harness imports or work to a generated process module. The bare
  baseline is that module with no library.
