# Testing

The tests are in `src/test/`, and `gro check` runs them. Beside the tests of
each module, these hold the library to more than its own examples:

- **Conformance**: `src/test/schema.conformance.test.ts` runs a matrix of
  cases through this library, Zod, and Valibot. Where those two agree this
  library gives the same, or the difference is declared in the tables of
  `src/test/conformance_tables.ts` and in
  [design.md](design.md#behavior-that-differs-from-valibot-and-zod).
  `src/test/json_schema.conformance.test.ts` does the same for
  `to_json_schema` against Zod's `toJSONSchema`.
- **The differential**, [below](#the-differential): the same rule over
  generated schemas and inputs.
- **The JSON fixtures**, shared with the Rust crate, see
  [rust.md](rust.md#fixtures).
- **Mutants**, [below](#mutants): the tests against small breaks of the
  library.
- **A fresh input**: `src/test/schema.fresh_input.test.ts` parses an input,
  changes it in place, and parses it again, through every kind of container,
  so a cache keyed by the input or a fast path for the last one fails a test
  where a timing would read it as a win: the benchmarks cycle through a few
  copies of an input, which defeats only a cache smaller than that.
- **The types, from a consumer's side**: `src/test/schema.inference.test.ts`
  holds what every schema and action infers in each position that has lost a
  type before, and `src/test/schema.emit.test.ts` emits the declarations of a
  consumer's exported schemas and generic helpers, which must compile where
  they are read and write each factory's type by its name.
- **What an editor shows**: `src/test/schema.docs.test.ts` asks TypeScript's
  language service for the doc comment and the definition of each property
  of a type inferred from an object schema, which must be its entry's. The
  types that lose them compile and parse the same, so nothing else tells.
- **The schemas' shape**: `src/test/schema.shape.test.ts` asks the engine, in
  a process of its own, that every schema the library makes has one hidden
  class and no field written to. A second class makes every `schema.run`
  load polymorphic, and a write slows the parses the engine had folded:
  neither fails another test.
- **The engine's state**: `src/test/engine_state.test.ts` asks the engine, in
  processes of its own, that every protector is intact after the program of
  `src/benchmarks/program.ts` has used every kind of schema, which the
  grader's versions would both pay and read as no difference, and that the
  heap does not grow with the count of distinct inputs parsed.
- **The benchmarks' parity**: `src/test/benchmarks.test.ts` and
  `src/test/survey.test.ts` hold every library to the same verdict on each
  input a benchmark times, so the timings compare like with like.

## The differential

A test of conformance over generated cases.
`src/test/differential_generate.ts` generates schemas from a seed, over every
kind with a counterpart in Zod and Valibot, and inputs shaped by each schema
with edges mixed in: inherited and hidden keys, null and class prototypes,
symbol keys, holes, array subclasses, frozen objects, numbers past `2 ** 53`,
surrogates, and for a format test, a string Zod and Valibot give one verdict
on alone. Each case runs through the adapters of the conformance matrix
and is classified by the tables of `src/test/conformance_tables.ts`:

- **agree**: this library's result is Zod's, and Zod's is Valibot's.
- **declared**: Zod and Valibot agree, this library doesn't, and the rules
  explain it. A rule, in `DIFFERENTIAL_RULES`, names a row of a declared
  difference and allows only what that row says this library does: a
  rewrite of the input that takes away what triggers it, applied only where
  this library does the same on the rewritten input apart from the keys it
  touched, or a relaxation of the comparison. A case is credited to the rules
  left once each is dropped in turn, the last first, where the case is still
  explained without it.
- **UNDECLARED**: nothing explains it. It is minimized and printed as a case
  to paste into `CONFORMANCE_CASES`, where the conformance test asks for a
  ruling. A difference that is a combination of recorded behaviors is one
  of these until it has a row of its own: two `SIDES` rows that cancel, a
  declared difference with a `SIDES` row, or a `SIDES` row with the copies'
  drop of a `__proto__` key. Its rule credits only those behaviors: where a
  rewrite brings out a disagreement of the two, exactly one entry of
  `SPLIT_RECOGNIZERS` must recognize it as that of its `SIDES` row, and this
  library's result is the result of the row's side, and where a rule
  recomputes a result, it is from what Zod or Valibot gives a part of the
  input. A disagreement no entry recognizes, or more than one, is
  undeclared, and its finding says which, with the rows of the entries
  that recognized it.
- **disagree**: Zod and Valibot disagree, tallied as this library being on
  Zod's side, Valibot's, both, or neither. Reported, never a failure:
  `SIDES` is the gate for those.
- **refused**: Zod or Valibot threw, building the schema or parsing.
  Reported, with the error.
- **THROWS**: this library threw. A failure.

The format tests are also run on strings alone, a tenth as many as the cases
for each: strings both grammars take, and near misses of them, by a
character, the version or variant of a UUID, the case of the max UUID, the
length of a fraction, an offset, or a day the month doesn't have. Where Zod
and Valibot agree on one, this library must too. Where they disagree, the
entries of `FORMAT_SPLIT_RECOGNIZERS` the string triggers must explain it:
taking their triggers away in turn leaves a string both take, their `SIDES`
rows are all of one side and record the verdicts Zod and Valibot gave, and
this library's result is that side's. Anything else is a finding, and the
report tallies the strings by row.

Every case also runs through this library's invariants: the input is not
mutated, every issue is the five fields, `is` agrees with `parse`, a second
parse gives the same, the context's count is kept, and a probe leaves
`ctx.issues` alone, is still a probe after, and gives `parse`'s verdict. A case with a `union`
is run again with every `union` a `memo_union`, which must give the same
result of `parse`, and of `is`, alone and under a `union` of one option.

It compares the verdict and the paths of the issues, and not their text, so the
name an issue gives `NaN` and a `union`'s `expected` are held by
`src/test/schema.issues.test.ts` and `src/test/schema.union.test.ts`, and this
library moving to the other side of a recorded disagreement is only a change in
the tallies, which the conformance test's `SIDES` fails on.

`gro check` runs `src/test/schema.differential.test.ts`, fixed seeds and a
fixed count, the same everywhere, and fails on an undeclared difference, a
throw, a broken invariant, or a finding of the format tests. The seeds may
reach none of the cases a split of zod and valibot is declared through, so it
also pins a case for each entry of `SPLIT_RECOGNIZERS` and each rule of a
split, of the prototype, or of a symbol key: its verdict and the rules it is
credited to, and that its verdict, or the rules it is credited to, changes
without its entry. For a review, run it deeper:

```bash
npm run differential -- --seed 1 --seed 2 --count 200000
npm run differential -- --focus variant --count 50000 --neither
```

`--seed` defaults to a random one, printed. `--focus <kind>` generates a kind
often, and puts it in every root schema it can: a kind of `DIFFERENTIAL_KINDS`,
where `rest` is `object_with_rest`, `refine` and `map` are a `pipe` to a check
and to a transform, and `default` and `default_fn` are `with_default` and
`with_default_fn`. `--limit` caps the findings minimized, and `--neither`
minimizes the cases where this library goes with neither. It exits nonzero
when `gro check` would fail. The script runs under a 2 GB V8 heap, and where
`systemd-run --user` can start a scope, inside one capped at 3 GB of memory
and no swap, so a runaway case ends the run and not the session: the npm
script checks for that and runs Node directly otherwise.

Not generated, as no counterpart in Zod and Valibot exists or as they have no
run-time effect: a length, value, or `regex` action alone as an entry, `flavor`,
`brand`, `meta`, `check_at`, a recursive `lazy`, and an entry named `__proto__`. Nor are
`to_lower_case` and `to_integer`, which change the value, as the rules read
only a `map` doing so: the matrix holds both, and the JSON Schema
differential's family of its own holds `to_integer`. A
`union` has two or three options, so a union of one option is held to Zod
and Valibot by the matrix alone. Each
declared difference with no rule is in `DIFFERENTIAL_UNRULED`, with why.
A generated schema holds no union twice and an input no object twice, so the
memo of a `memo_union` never answers there. The test holds it to `union` on
a family of its own, from fixed seeds: a recursive union whose options walk
their children before a `literal` tag, over inputs that reuse nodes.

The JSON Schema differential holds what `to_json_schema` writes to the library's
verdicts. `src/test/json_schema_check.ts` validates by draft 2020-12 for exactly
the keywords the emitter writes, and throws on any other keyword anywhere in a
document, so a new one fails the run until the checker learns it.
`src/test/json_schema_differential.ts` draws schemas from this generator, from
the JSON fixtures' (`json_generate.ts`, recursive `lazy` schemas and
defaults of any JSON among them), and from a family of its own of a
`to_integer` under each option, with steps of the string before it and bounds
after, over texts of its grammar's pieces, writes each on both sides in `'throw'` mode,
counts and skips the refused, and compares JSON inputs: on the input side the
document takes exactly what `is` takes, on the output side it takes what `parse`
returns, a one-way check, so a looser output document is caught by the unit and
conformance tests. A disagreement passes only where an entry of
`JSON_SCHEMA_DIFFERENCES` explains it, each a sentence of `docs/design.md` §
JSON Schema, by relaxing the checker, rewriting the schema past what triggers
it, or checking what the parse gives without it, alone or with the fewest
others. An entry with a rewrite applies only to a schema that holds what
triggers it, and its rewritten document may differ only by a `default` and keys
taken out of the `required` of a schema in it. A `transform` that gives
`undefined` is explained by the parse of the same input with each `transform`
giving a value instead: that output must differ and the original document take
it. Its `variant` schemas go past what the generator makes for Zod: a
discriminator shadowed, `0` beside `-0`, or no `literal`. Each schema is written
again with `unrepresentable: 'any'`, which `{}` loosens past exactness, and held
one way: the document takes every input `is` takes and every output of `parse`.
Anything else is minimized, the input and the schema, and printed. `gro check`
runs fixed seeds, fails on a finding, on a seed whose schemas the emitter
refuses too often on a side, and on a pinned case of an entry its recognizer no
longer explains. For a review:

```bash
npm run differential -- --json-schema --seed 1 --count 100000
```

`--count` is the differential generator's schemas, with a tenth as many
generated JSON groups and a tenth as many of the `to_integer` family, and
`--focus` and `--limit` apply.

## The compiler

`compile.ts` is held to the interpreter, which is its oracle:
`compile_guard(schema)(value)` to `is(schema, value)`, and
`compile_parse(schema)(value)` to `parse(schema, value)`: the same `ok`, the
same issues, an output that is deep-equal, the input itself exactly where the
interpreter's is, with its keys in the same order, the same prototype, the
same objects of the input in it, and one object in two places exactly where
the interpreter's has one (`find_compile_difference` in
`src/test/compile_test_helpers.ts`).

- **`src/test/compile.differential.test.ts`** runs the differential's
  generator from fixed seeds, each schema built a second time with every
  `union` a `memo_union`, which compiles to other code, and minimizes and
  prints a difference as a case to paste. A second family is recursive unions
  over inputs that reuse nodes, the family of the `memo_union` test of
  `schema.differential.test.ts`, alone, under a union that probes it, and
  twice in one input, as a `memo_union` and, where the compiler doesn't
  refuse it, as a `union`: the `literal` of an option comes first in some and
  last in others, so both happen. A third is wide objects of a consumer's
  kind: many entries, each with a `check`, a `transform`, or a `regex` of its
  own, defaults beside them, nested `strip_object`s, one schema under two
  keys, a union handed its key, and a `one_of` on either side of the size
  where its test changes form.
- **`src/test/compile.test.ts`** has what a generator doesn't draw. A hand
  table: the formats, `to_lower_case`, `to_integer`, every wrapper a missing
  key passes through, a union that fills a key in, `__proto__` keys and an
  entry named so, inherited and non-enumerable keys, class instances, holes,
  `-0` and `NaN`, and the key order of a copy. Every scenario of the
  benchmarks. Each thing declared to differ from the interpreter, pinned, and
  the order in which a parse that matches first reads the input's values,
  which is the library's.
- **`src/test/compile.source.test.ts`** has what a compile reads and emits. A
  schema frozen to its last `def`, which compiles. What is refused and its
  text, and the depth it follows a schema to. A hostile key, literal, `one_of`
  value, default, bound, and regex source, each shown to stay data. The
  source of a schema held in many places, which grows by a constant a level.
  A kind of the test's own run in place, handed the object and the key by
  the library's rule. The fallback, in a process under
  `--disallow-code-generation-from-strings`, and no fallback for another
  error.
- **`src/test/compile.union.test.ts`** has recursive unions and pipes by
  counted runs, never timed. What is refused, with its text, and that the
  interpreter walks it in exponential time. What is not: a `memo_union` of
  the same, with its bound in a guard, a parse, and a parse that fails,
  options a `literal` tells apart first, a union on no cycle, a union on a
  cycle only through a `memo_union`, a kind of the test's own, and a `union`
  that shares a `memo_union`'s options. A cyclic input, which throws the
  interpreter's `RangeError`. A compiled function called from a `check` it
  is running: its answer, the outer call's, and the outer call's kept
  verdicts.
- **`src/test/compile.refusal.test.ts`** has a shape for every condition of
  the refusal: a cycle through each kind that holds a schema, each kind that
  could take an array or an object and each that could take neither, each
  wrapper an option is looked through, and each thing that does and doesn't
  tell options apart. A shape that is refused is shown to need it wherever an
  input can nest through it, by the runs of a `check` under the interpreter,
  and one that compiles is held to a walk. Each fix an error names is shown
  to compile. `mutants.ts` has a mutant that drops each condition.
- **`src/test/compile.bounds.test.ts`** holds the bound of what compiles, by
  the traps sprung on a `Proxy` of every array and object of an input. It is
  a slice of the enumeration the rule was searched with: pairs of option
  templates, through one `lazy` and through two, each built with `union` and
  with `memo_union`, over chains, trees, and an input that holds each level
  twice, at two sizes. A `union` form is refused or it compiles, and what
  compiles grows no faster than the size of the input times its depth in a
  guard, a parse that matches, and a parse that fails. A `memo_union` form
  always compiles, is held to the same, and on the input that reuses nodes
  grows no faster than the interpreter's. And a call that runs out of stack:
  compiled code against the interpreter at growing depths, and a
  `RangeError` thrown by a `check`, which holds the catch. Each form of the
  slice is given to `to_guard_source` too, which refuses what the compiler
  refuses, in the same words.
- **`src/test/compile.emit.test.ts`** holds `to_guard_source`. A written text
  is imported as a `data:` module, which writes nothing to a disk, and run:
  held to `is` and to the guard `compile_guard` makes, over the hand table
  for every schema that can be written, a schema of every kind that can, and
  schemas generated from fixed seeds of those kinds alone. What a module is:
  its first line, its one export, what it imports and from where, and that
  it holds nothing of the interpreter. Names that are no identifier, and
  `then`, each refused, and names the module uses or the language reserves,
  each exported and working. Patterns with a `/`, a quote, a line separator,
  and each flag but `g` and `y`, each written and matching as the regex does,
  and with either of those two a `lastIndex` of the module's own. A `Proxy`
  of a regex written as it says, as strings whatever it says, and a regex
  that is no `regex`'s pattern refused. A value the text of a long `one_of`
  captures, written before the `Set` that holds it. Every refusal's text,
  with the kind and the path, and a `library` that is no string refused. A
  format action handed the value and a probing context, by a stand-in for
  the library. A TypeScript program that holds the text, where the cast to a
  type predicate compiles. A `memo_union` on an
  input that holds each level twice, by the traps sprung on a `Proxy`, and a
  call a getter of the input makes while one runs. And a `RangeError`, which
  a written guard throws.

## Mutants

A test of the tests. `src/test/mutants.ts` is a
table of small breaks, each a name, a file (`src/lib/schema.ts` when
omitted), and edits, each a `find` that occurs exactly once in the file and
its `replace`, applied in order. Most break the library; some break a table
the tests read, as a recognizer of the differential or a `SIDES` row.
`gro check` typechecks and lints the table and never runs a mutant, and
`src/test/mutants.test.ts` holds every anchor to its file, so an edit that
moves one fails there and not at the next run.

```bash
npm run mutate
npm run mutate -- --filter record --deep
```

It copies the working tree's `src`, `docs`, and `results`, `package.json`,
`tsconfig.json`, and `README.md`, which the tests of the README read, with
`node_modules` linked, to a directory of the run's own
under `~/.cache/fuz_schema_mutate/`, a copy to a worker, with a vitest config
of its own, without the site's plugins, and a test
timeout of 60 s, as the tests that take seconds alone are slower beside the
other copies. Each copy's vitest gets an even share of the cores. It runs the tests
of the unmutated copy first and stops if they fail, then for each mutant
applies its edits, runs `vitest run` without `sizes.test.ts`,
`site_render.test.ts`, which needs the site's plugins, and
`mutants.test.ts`, which the mutant's own edit would fail, and
restores the file. Each mutant is:

- **killed**: a test failed, and the test files reported failed before the
  kill are printed, usually the first. The tests' process group is killed by
  this script at the first test file it reports failed, as a break can leave
  another test looping: not by vitest's `--bail`, which can exit before it
  reports the failure.
- **hung**: the tests outlived the timeout with none failed, and their whole
  process group was killed. Counted as killed: a break that makes a test loop
  forever is found, if slowly.
- **survived**: the tests passed.
- **error**: vitest exited nonzero or by a signal with no test failed, so
  the mutant is neither killed nor survived, and the tail of its output is
  printed.

The run fails on a stale anchor, a `find` that doesn't occur exactly once, or
edits that leave the file unparsable to TypeScript, checked of every mutant in
the table before any runs, whichever are selected; on an error; on a survivor
whose entry has no `survives`, the reason the suite can't kill it; and on an
entry with a `survives` that is killed or hung. An edit TypeScript parses that
the engine still refuses to load, a bad regex literal or a duplicate `let`,
fails its test file and reads as killed. `--filter <substr>` runs the mutants
whose names have it, `--workers` sets the copies run at once, 2 by default,
`--timeout <s>` the timeout, by default 120 s or three times the unmutated run
where that is longer, and refused under one and a half times the unmutated run,
where a slow run would read as hung. The copies are removed at the end, or left
by `--keep` or an interrupt, and the next run removes those of runs no longer
running. `--deep` also runs `differential.ts` on each survivor, over a few
seeds, and a survivor it fails is killed. The npm script caps the run at 6 GB of
memory and no swap where `systemd-run --user` can start a scope, as for the
differential.

A review that finds a break the suite misses adds it as a mutant with the
test that kills it. One it decides not to test gets a `survives` saying why.
