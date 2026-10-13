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
  was taken: an entry is handed the object and its key, and `unknown` looks.
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

- **Gave**: fewer bytes, 42 gzip on `union`.
- **Cost**: slower on valid input, as it hands two arguments to a `run` that
  doesn't take them.
- **Why**: time on the valid path, for bytes that only the bundles with the
  kind pay.
- **Reopens**: nothing known.

### `literal` with four parameters

So that `literal(undefined)` needs its key, as `unknown` does.

- **Cost**: slower on valid input for every literal.
- **Why**: every literal's valid path, for one literal. The difference is
  declared in
  [design.md](design.md#behavior-that-differs-from-valibot-and-zod).
- **Reopens**: a `literal(undefined)` that chooses its closure when it is
  made, as `nullable` does, which is bytes in the bundles with a literal and
  has not been timed.

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
