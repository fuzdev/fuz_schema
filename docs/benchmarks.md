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

## Extending

- A scenario: a name in `ScenarioName`, an entry in `SCENARIOS`, and a
  `scenario_<name>` export in every module under `libs/`.
- A library: a module in `libs/`, an entry in `LIBS`, and its name in the
  lists the process and type benchmarks keep.
- A case: an entry in a group in `cases.ts`.
- Never add harness imports or work to a generated process module. The bare
  baseline is that module with no library.
