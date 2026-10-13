# Measured and declined

Trades that were built, measured, and not taken. Each is here so it isn't
built again without a new reason, and so the reason can be checked when one
turns up. What was taken instead is in [design.md](design.md).

An entry says what it was, what it **gave**, what it **cost**, **why** it was
declined, and what **reopens** it. The figures were measured on this repo's
benchmarks: time by [`npm run grade`](grading.md) or in processes of their
own, bytes as gzipped bundles where they say "gzip" and as heap allocated
where they don't. "Core" is the `strict_nested` scenario's
bundle, the bytes every consumer of an object schema pays, and the rules are
[grading.md](grading.md#rules)'s. A ratio is the trade's time over the
library's without it, as the library was when it was measured, so under 1 is
faster. A part with nothing to say is left out.

Add an entry when a trade is declined, under the part of the library it
changes, with its numbers. Entries are kept current, not in order of when
they were tried: when one is reopened and taken, it goes.

## Issue paths

### A path built in place by a loop

A prefix that changes the path in place, by a loop of its own, with `[key]`
for the first key.

- **Gave**: equal or fastest at every depth, and flat bytes: 104 for a
  path of one key and about 224 for any deeper one.
- **Cost**: +31 gzip on the core.
- **Why**: core bytes, for a return on the failing path alone. The spread
  `[key, ...path]` was taken at +0, and allocates about a grown array more a
  level.
- **Reopens**: failing parses of deep paths that matter to a consumer, at a
  return rule 4 accepts.

### A path as an array of exact size

`new Array` of the new length, filled by a loop.

- **Gave**: fewer bytes at depth.
- **Cost**: about 5% slower at one key, and +32 gzip on the core.
- **Why**: slower at one key, and core bytes.
- **Reopens**: the same as the loop above, which it would have to beat.

### `toSpliced` and `concat`

- **Gave**: nothing. Each is a call to a builtin, as slow as the `unshift`
  the spread replaced, or slower.
- **Reopens**: an engine that inlines them.

## Object loops

### A shared helper for the key copy

One function for the copy of the schema's keys, which the object loops each
make.

- **Gave**: 23 gzip fewer over the whole library.
- **Cost**: 13 gzip more on the core.
- **Why**: the core is what a consumer ships, and the whole library is what
  none does.
- **Reopens**: bundles of real schema sets that carry both loops and come out
  smaller with it.

### The loop driven by `for...in`

The object loop run from a `for...in` over the input.

- **Gave**: the realistic valid path 14% faster on input in the schema's
  order.
- **Cost**: +68 gzip on the core. And one input in dictionary mode, through
  any object schema, made the shared loop generic for every schema from then
  on.
- **Why**: one slow input in a process costs every later parse, which no
  consumer can see or prevent.
- **Reopens**: an enumeration whose speed doesn't depend on what the loop has
  seen.

### A copy cloned from the schema's entries

- **Gave**: a faster copy when the input has every key.
- **Cost**: the realistic copy path 1.45x, and +66 gzip on the core.
- **Why**: real data rarely has every key, and the rest of the time it loses.
- **Reopens**: nothing known.

### A required-key check for every entry

The loops looking for each entry's key, so that every schema that accepts
`undefined` refuses a missing one, as Zod's and Valibot's do.

- **Gave**: conformance on a missing key for every kind.
- **Cost**: +75 gzip on the core, which put all the scenarios together at
  0.68 of Valibot's, over the ceiling rule 5 had then, and a list of flat
  objects 1.10x.
- **Why**: every object pays for a check few entries need. The opt-in form
  was taken: an entry is handed the object and its key, and the schemas that
  need a key look.
  See [design.md](design.md#missing-keys).
- **Reopens**: a check that costs an object with no such entry nothing.

## `lazy`

### A `lazy` that replaces its own `run`

On first use it writes its schema's `run` over its own, so later calls skip
it.

- **Gave**: arrays of a lazy 0.65x, and a real manifest schema 0.91x.
- **Cost**: one write to a schema's `run` makes that field mutable for every
  schema, as they share a hidden class. A root array of strings went from
  6.28 ns to 9.46 ns once any lazy had been used. A grade doesn't see it:
  its two versions share a process, so both pay.
- **Why**: every schema in a program pays for one lazy in it.
- **Reopens**: nothing known. `src/test/schema.shape.test.ts` fails on it.

### That `lazy` with a null prototype

The same, on an object with no prototype, so the write is to another hidden
class and the shared field stays constant.

- **Cost**: a second hidden class at every `schema.run` load: the realistic
  valid path 15% slower in the matrix.
- **Reopens**: nothing known.

### A `lazy` of four parameters, or of a rest parameter

In place of reading the length of `arguments` on each call.

- **Cost**: a `run` of four parameters is about 45% slower for a caller that
  passes two arguments, and one with a rest parameter about 6%, both through
  call sites shared with other schemas.
- **Why**: a lazy is called with two arguments everywhere but as an object's
  entry.
- **Reopens**: an engine that adapts the arguments for less.

## Passing the object and the key on

### One closure of four parameters

For `union`, `pipe`, `nullable`, and `message`: one `run` that always passes
the object and the key on, in place of two closures chosen when the schema is
made.

- **Gave**: fewer bytes, 42 gzip on `union`, and 30 on the `pipe` scenario.
- **Cost**: slower on valid input, as it hands two arguments to a `run` that
  doesn't take them. For `pipe`, a hundred numbers each through three
  actions 1.11x in the matrix, and each through a `check` 1.15x.
- **Why**: time on the valid path, for bytes that only the bundles with the
  kind pay.
- **Reopens**: nothing known.

### A `pipe` that looks for the key wherever it has the object

The closure that passes the object and the key on looking for the key too,
when its first schema gave `undefined`, in place of reading whether the pipe
starts with an `optional` when it is made. So after a `lazy` that defers to
an `optional` as after the `optional`.

- **Gave**: 29 gzip fewer on the `pipe` scenario with a pipe that starts
  with an `optional` on that closure, and 21 fewer with it on one of its own.
- **Cost**: an input both Zod and Valibot refuse is accepted: a missing key
  after a `lazy` that defers to an `optional`, where a step fails and another
  is a `transform`. And on the one closure a `pipe` that starts with an
  `unknown`, as an entry, 1.09x in the matrix, where one that starts with an
  `optional` had run too: the closure's call to its first schema is then a
  call site of both. On a closure of its own it read 1.00x.
- **Why**: a difference from both where they agree, for bytes that only the
  bundles with a `pipe` pay.
- **Reopens**: nothing known.

### A `pipe` that looks for the key after any first schema

A walk of the first schema when the pipe is made, for whether it could give
`undefined` for a key that is missing: through `nullable`, the options of a
`union`, and a `with_default` of `undefined`, and at a `check` or a
`transform`. So that no step runs after any schema that let a missing key
through, and not only after the ones the pipe has the object for.

- **Gave**: one rule for every first schema.
- **Cost**: +97 gzip on the `pipe` scenario and +85 on all the scenarios
  together, which at 0.7502 of Valibot's is over the ceiling of rule 5.
- **Why**: bytes in every bundle with a `pipe`, for first schemas on which
  Zod and Valibot disagree with each other.
- **Reopens**: a way to tell that costs a pipe that starts with a `string`
  nothing.

### `literal` with four parameters

One `run` of four parameters for every `literal`, so that `literal(undefined)`
needs its key, as `unknown` does.

- **Cost**: slower on valid input for every literal.
- **Why**: every literal's valid path, for one literal. Two closures chosen
  when the literal is made were taken: only `literal(undefined)` has the
  four parameters, and so for `one_of`. That is +45 gzip on all the scenarios
  together and none on the core. See [design.md](design.md#missing-keys).
- **Reopens**: nothing known.

### A shared wrapper for the schemas that need a key

One function that takes a `run` of two parameters and returns one of four
that looks for the key first, for `literal` and `one_of`, in place of a
second closure in each.

- **Cost**: +65 gzip on all the scenarios together where the two closures are
  +45, which at 0.725 of Valibot's was over the ceiling rule 5 had then, and
  6 gzip more over the whole library. A call more a parse for a schema that needs its key.
- **Why**: more bytes, where it was built for fewer.
- **Reopens**: nothing known.

### A missing key as the `literal`'s own issue

A `literal(undefined)` without its key failing as a `literal` that expected
`undefined`, in place of the `missing_key` an `unknown` reports.

- **Gave**: 22 gzip fewer on all the scenarios together: a bundle with a
  `literal` and no `unknown` has the text of a `missing_key` for it alone.
- **Cost**: an issue that reads `expected undefined, received undefined`, and
  a second kind for a missing key.
- **Why**: the issue has to say what is wrong.
- **Reopens**: nothing known.

## The parse context

### One context kept between parses

A module-level context reset by each parse, in place of a new object.

- **Gave**: 48 bytes fewer a parse, in code shared by many schemas.
- **Cost**: a parse the engine had inlined whole got up to 2x slower. A new
  context never leaves the parse, so the engine removes it. A kept one
  escapes.
- **Why**: the valid path got slower, where a program has one schema.
- **Reopens**: nothing known.

## Standard Schema

### `~standard` on every schema

Every schema a Standard Schema natively, in place of the
`to_standard_schema` adapter.

- **Gave**: no speed.
- **Cost**: +137 to +185 gzip in every bundle, by form.
- **Why**: bytes every consumer pays, for those who want the interface. The
  adapter is opt-in.
- **Reopens**: a form that costs a bundle not using it nothing.

## Degenerate schemas

### A guard for an entry named `__proto__`

- **Why**: a schema with such an entry is malformed, and no bytes or time
  are spent guarding one. An input with a `__proto__` key against an ordinary
  schema is guarded. See
  [design.md](design.md#behavior-that-differs-from-valibot-and-zod).
- **Reopens**: nothing known.
