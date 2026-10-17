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

### A prefix that copies the path

`[key, ...path]` at every level, which keeps the path outermost first while
the parse runs.

- **Gave**: no reversal, and 31 gzip fewer on the core than a push.
- **Cost**: every level copies every path below it, so a deep input with
  many issues at the bottom takes time in the cube of its size: a spine 800
  objects deep with 8000 failing items, 27 KB of JSON, took 26 s, against
  0.2 s with a push. `unshift` moves the keys in place and is cubic too, at
  3 to 4 s there.
- **Why**: denial of service on data-shaped input.
- **Reopens**: nothing that keeps the copy per level.

### A path as an array of exact size

`new Array` of the new length, filled by a loop.

- **Gave**: fewer bytes at depth.
- **Cost**: about 5% slower at one key, and +32 gzip on the core.
- **Why**: slower at one key, and core bytes.
- **Reopens**: nothing: it copies the path at every level, as the spread above does.

### `toSpliced` and `concat`

- **Gave**: nothing. Each is a call to a builtin, as slow as the `unshift`
  the spread replaced, or slower.
- **Reopens**: nothing: each copies the path at every level, as the spread above does.

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

### The unknown-key check by a `Set` of the keys

`object` asking a `Set` of its keys, made when the schema is, whether a key
out of the schema's order is one of them, in place of `Object.hasOwn` on its
entries.

- **Gave**: two realistic cases 0.93x in the matrix, `real/posts_100_mixed_order`
  and `real/docinfo_module_full`. The realistic valid path 1.0% faster in the
  matrix, inside its A/A of ±1.3%, and 1.6% faster alone, past its A/A of
  ±1.4%.
- **Cost**: +5 gzip on the core and +11 on `object` last in, and `real/form`
  1.059x alone, marked `?`.
- **Why**: rule 4 asks +5% on the realistic valid path for the core bytes,
  and the matrix showed no speedup past its A/A.
- **Reopens**: real data whose keys are mostly out of the schema's order.

## Dropping keys

What was taken, in `strip_object`: the entries run as `object`'s do, and only
an output that is still the input looks for a key to drop, copying the
schema's keys when it finds one.

### Always a copy

`strip_object` returning a copy of the schema's keys on every input, filled
as the entries run, with no key looked for.

- **Gave**: an input with a key to drop 0.59x to 0.77x, and the realistic
  copy path 7.2% faster in the matrix. 63 gzip fewer on all the scenarios
  together.
- **Cost**: an input with nothing to drop comes back as a copy: a hundred
  accounts with nothing to drop 1.31x and allocating 22538 bytes in place of
  88, a form 1.13x, six keys 1.26x. A failure 1.40x.
- **Why**: the copy every input pays, where most have nothing to drop and
  came back as themselves.
- **Reopens**: nothing known.

### A key to drop looked for first

The input's keys enumerated before the entries run, so that one to drop is
known and the copy is filled as the entries run, in place of being made
after them.

- **Gave**: an input with a key to drop 0.71x to 0.94x, a hundred accounts
  with fields to drop 0.83x and one 0.83x, and the realistic valid path
  2.4% faster in the matrix and 1.2% alone. 43 gzip fewer on all the
  scenarios together, and 1 fewer on the core.
- **Cost**: the enumeration runs ahead of an entry that fails. Through `is`,
  which returned at that entry, 1.74x with no key to drop and 1.49x with one,
  and a failure through `parse` 1.80x with a key to drop and 1.22x without.
  A `union` of three whose last option matches 1.19x, as each option that
  misses enumerates first. An entry that changes with no key to drop 1.12x,
  and an env file with transforms and keys to drop 1.21x alone, past its A/A.
- **Why**: valid input slower, and probes and failures much slower, for
  inputs with keys to drop.
- **Reopens**: a way to look for a key to drop that costs a probe and a
  failure nothing.

Three forms of it were built beside it, and kept its costs on valid input: a
`union` whose last option matches 1.07x to 1.24x and an entry that changes
with no key to drop 1.10x to 1.16x in each.

- A flag passed to the loop in place of the copy, begun at the first entry:
  17 gzip fewer on all the scenarios together and +17 on the core, and a
  failure with a key to drop 2.06x.
- A copy not written to after a failure: a failure with a key to drop 1.28x,
  28 gzip fewer on all the scenarios together and +12 on the core.
- A probe that runs the entries first: `is` 1.12x, an input with a key to
  drop that the first of a `union`'s options matches no longer faster, and
  +14 gzip on all the scenarios together.

### The entries driven by the enumeration

`strip_object` running its entries from a `for...in` over the input, each as
its key comes in the schema's order, with the copy begun at the first key to
drop. From the first entry whose key doesn't come in that order, the rest run
after the enumeration, as `run_entries` runs them.

- **Gave**: an input with nothing to drop 0.72x, a hundred accounts with
  nothing to drop 0.73x, a `union` of three whose first option matches
  0.75x, and the realistic valid path 4.8% faster in the matrix and 4.1%
  alone.
- **Cost**: +63 to +71 gzip on the scenarios built with `strip_object` and
  +44 on all the scenarios together, and 2 fewer on the core. An env file with
  transforms and keys to drop 1.22x, past its A/A in the matrix and alone. A
  failure with a key to drop 2.10x, and through `is` with one ahead of the
  entry that fails 1.42x.
- **Why**: it is the loop driven by `for...in` above, in `strip_object`
  alone, and shares its flaw: one input in dictionary mode, through the
  enumeration the schemas share, slows every later parse, and the win of
  running in the input's order does not survive it. Unpoisoned, it was over
  the ceiling rule 5 had then, and is slower on some valid shapes.
- **Reopens**: a form whose win on input in the schema's order survives a
  dictionary-mode input in the same program.

Re-made on the current schema, in two variants, the entries run eagerly and a
flag passed to the loop. Unpoisoned, the eager form is +44 gzip on all the
scenarios together, over the ceiling rule 5 had then, and slower than the
current loop on `6_of_7_keys_first_optional_absent` (1.10x) and on a nested
`strip_object` (1.17x alone); the flag form is +100. Poisoned by one input in
dictionary mode, a parse of a `strip_object` of 200 keys, through the shared
`for...in`, both were slower than the current loop poisoned the same way on
every strip case but one whose first optional key is absent: a geometric mean
of 2.2x on the valid cases in the matrix and 2.8x to 3.1x alone and apart, and
up to 12x on a probe that fails. The eager form's realistic valid path was 26%
slower in the matrix and 36% alone. The current loop itself, on an input with
nothing to drop, moved from 111 to 121 ns.

## `variant`

### The discriminator run once

`variant` telling the option it calls that its discriminator has matched, so
the option's loop skips that entry, by a module variable the object schemas
read and clear.

- **Gave**: one entry fewer run on each input a `variant` takes.
- **Cost**: module state that every object schema reads, in every parse:
  +38 gzip on the core and +58 over all the scenarios together, and the
  realistic valid path 3.8% slower in the matrix and 5.7% alone. And a
  discriminator of `literal(undefined)` no longer needed its key: skipped,
  it took an input without it, which both Zod and Valibot refuse.
- **Why**: slower on the valid path, and every object schema pays for a
  `variant`.
- **Reopens**: a way to skip the entry that the object schemas don't read
  outside a `variant`, and that keeps a skipped discriminator's missing key
  refused.

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

## A recursive `union`

A `union` whose options walk a node's children before an entry rules them
out takes time exponential in the input's depth, see
[design.md](design.md#running). These were built to make it linear in the
core, and declined. `memo_union`, an export of its own, is the opt-in form.

### A memo of probes inside `lazy`

A `lazy` that, while probing, keeps what its schema gave for an input object
it is handed again at the same depth, as the next option of a union hands it,
and clears it when the parse ends. It keeps a failure and an output that is
its input, and starts only when an object comes back.

- **Gave**: linear in depth. `is` on a binary tree of 127 nodes under a
  union of three options, each walking the children before its `literal`,
  went from about 6 ms to 23 µs, and `parse` to 69 µs. Core the same.
- **Cost**: `lazy` alone +172 gzip and last in +133, and the `type_json`
  scenario +131. Recursion that walks nothing again slower: a tree of objects
  with no union about 8% in `parse` and 26% in `is`, and a JSON-like union of
  primitives and containers about 7%. The realistic `package_json` case
  allocated 8.6 times the bytes and read 23% slower in one run. A `transform`
  under a recursive union runs fewer times than it does without the memo,
  which is a difference in behavior to declare.
- **Why**: the bytes land on every `lazy`, and the time on recursion that
  doesn't need it, where `variant` or the cheap entries first in each option
  are the way out of the curve.
- **Reopens**: a form whose bytes land only on schemas that recurse through
  a union. That is `memo_union`, whose bytes land only where it is used, and
  whose memo is kept by the union and not by the `lazy`. In the core, as
  here, it stays declined.

### That memo in place of `memo_union`

The same memo, kept for one parse by each probed object or array, made the
plain recursive `union` linear on hostile input so `memo_union` could go.
Four forms were built and graded with `--class security --runs 5` on a quiet
machine:

- **Ungated**, a memo on every probe: linear on every union shape, but
  `real/package_json/valid` 1.35x in the matrix with 5.6 times the bytes
  allocated, and 1.40x alone with 6.0, `is` on docinfo's recursive types 1.56x and from
  48 B to 87 KB per parse, +147 B retained per further `lazy`, and the
  `type_json` scenario +82 gzip.
- **Past a depth**, a memo past 8 nested `lazy` runs: bounded only to m^K for
  a union of m options, so 12 options over ten nodes ran 469M options in 30 s,
  and a `check` calling `is` mid-parse wiped the memo, 4.2M runs at depth 20.
- **Past a budget**, a memo once a parse has probed 16384 `lazy` runs, counted
  per context in a `WeakMap` kept past 64 runs, the memo saved and restored
  around a context switch: linear on every shape found (12 options at depth
  40, 197k runs), allocation and retained heap as without it, but
  `real/docinfo_types/valid` 1.11x, `real/package_json/valid` 1.10x in the
  matrix and 1.14x alone, `each/lazy/valid` 2.18x, and the `type_json`
  scenario at 0.79 of Valibot's gzip (+181).
- **That budget with no bookkeeping outside probe mode**, and the `try` only
  on the frame that switches context: the realistic summaries inside their
  A/A (−0.4% in the matrix, −0.5% alone), but `real/package_json/valid` 1.07x
  in every regime, `is` on docinfo's types 1.08x, `each/lazy/valid` 1.08x,
  +30 B retained per further `lazy`, the `type_json` scenario at 0.82 of
  Valibot's gzip (+238), and `lazy` alone +265. What is left is about 15 to
  20 ns on each outermost probed `lazy`, the frame that must switch context,
  which changes what the engine inlines beneath it: neither the `try` nor the
  `WeakMap`.
- **Why**: every form slowed a realistic valid case past its floor, against
  [rule 6](grading.md#rules), so the ways out stay opt-in: `memo_union`, and
  `variant`.
- **Reopens**: an engine or a design that removes the cost on each outermost
  entry, or a consumer with recursive hostile input.

### The `literal` entries first when probing

An object that, probed, checks its `literal` entries before the rest, so a
union's option is ruled out before it walks.

- **Cost**: core +71 gzip, and `object` alone +67.
- **Why**: core bytes for a shape that a consumer can write in order.
- **Reopens**: nothing known.

### `variant`'s dispatch inside `union`

A `union` that finds, when it is made, a `literal` entry its object options
share, and dispatches on it as `variant` does.

- **Cost**: `union` alone +177 gzip and last in +146, the `union` scenario
  +183, just under the backstop.
- **Why**: bytes on every union, for what `variant` already does as an
  export of its own.
- **Reopens**: nothing known.

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
  together, which at 0.7502 of Valibot's was over the ceiling rule 5 had then.
- **Why**: bytes in every bundle with a `pipe`, for first schemas on which
  Zod and Valibot disagree with each other.
- **Reopens**: a way to tell that costs a pipe that starts with a `string`
  nothing.

### A `pipe` that starts with an `optional` with a loop of its own

The closure of a pipe that starts with an `optional` running its steps in a
loop of its own once it has looked for the key, in place of calling the
closure of two parameters, which it shares them with.

- **Gave**: with the key there, a pipe of an `optional` and a `check` 0.88x
  in the matrix, and the same under a `message` 0.89x, and alone the same as
  the shared closure. That is the path that calling the shared closure costs
  in the matrix, 1.14x and 1.16x against a pipe that hands its `optional` the
  object and the key and loops itself.
- **Cost**: +8 gzip on all the scenarios together, which at 2126 was over the
  ceiling rule 5 had then, and +11 on the `pipe` scenario. Without the key,
  alone, 1.16x, allocating 48 bytes a parse where the shared closure allocates
  none.
- **Why**: over the ceiling rule 5 had then. The present-key path keeps the
  cost of the call.
- **Reopens**: open under rule 5's price per class: its +11 on the `pipe`
  scenario, weighed by rule 3 against its speed, and its 1.16x without the key.

### The steps of a `pipe` in one loop from its first schema

The closure of two parameters running every schema of the pipe in one loop,
the output starting as the value, in place of calling the first schema apart
from the rest. It is the closure a pipe that starts with an `optional` calls
once it has looked for the key.

- **Gave**: 1 gzip fewer on all the scenarios together.
- **Cost**: with the key there, a pipe of an `optional` and a `check` 1.545x
  alone, and the same under a `message` 1.548x, against a pipe that hands its
  `optional` the object and the key and loops itself. Calling the first
  schema apart reads 0.985x and 0.970x there.
- **Why**: a program of one such pipe pays half again on valid input.
- **Reopens**: nothing known.

### `literal` with four parameters

One `run` of four parameters for every `literal`, so that `literal(undefined)`
needs its key, as `unknown` does.

- **Cost**: slower on valid input for every literal.
- **Why**: every literal's valid path, for one literal. Two closures chosen
  when the literal is made were taken: only `literal(undefined)` has the
  four parameters, and so for `one_of`. That is +45 gzip on all the scenarios
  together and none on the core. See [design.md](design.md#missing-keys).
- **Reopens**: nothing known.

### One function for whether a schema takes the key

One function asked by `union`, `pipe`, `nullable`, and `message` whether
what they hold takes the object and the key, in place of the test written out
at each.

- **Gave**: smaller where the four are together: `last in` 9 gzip on `union`
  and 8 on `pipe`, and 4 on all the scenarios together.
- **Cost**: larger where one is alone: `alone` +14 gzip on `union`, +7 on
  `pipe`, +6 on `message` and on `nullable`, and the `union` and `pipe`
  scenarios +10 and +7. Core and time the same.
- **Why**: `alone` is what a consumer of the kind ships, see
  [grading.md](grading.md#bytes).
- **Reopens**: more places that ask, enough that the function is smaller
  alone too.

### A shared wrapper for the schemas that need a key

One function that takes a `run` of two parameters and returns one of four
that looks for the key first, for `literal` and `one_of`, in place of a
second closure in each.

- **Cost**: +65 gzip on all the scenarios together where the two closures are
  +45, which at 0.725 of Valibot's was over the ceiling rule 5 had then, and 6
  gzip more over the whole library. A call more a parse for a schema that
  needs its key.
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

## Writing a missing key

Zod and Valibot write a missing key as `undefined` where a `pipe` that
starts with a `with_default` makes `undefined` of the default. Here the key
stays out, as for any missing key whose entry gives `undefined`, see
[design.md](design.md#behavior-that-differs-from-valibot-and-zod).

### A default whose steps give `undefined`, written for a missing key

A `pipe` that starts with a `with_default` gets a closure of its own for when
it is the entry and the key is missing; when its steps give `undefined` it
sets the failure count one short, which the object loops read as a key to
write.

- **Gave**: conformance, as the entry itself, under a `message`, and as the
  first schema of another pipe.
- **Cost**: +21 gzip on the core, +62 on the `pipe` scenario, and +75 on the
  library. Alone, `pipe` +48, and `object`, `strip_object` and
  `loose_object` +20 to +22 each. The closure takes the object and the key,
  so a `union` that fills a missing key in runs such a pipe before it again
  without them. The other forms that decide in the object loops measured
  +16 to +24 on the core: the cheapest, +16, reads the count with one compare
  more on every entry that comes back unchanged.
- **Why**: core bytes, which every consumer of an object schema pays, for a
  shape few write.
- **Reopens**: a form at most +4 on the core, with nothing on the path of an
  ordinary entry.

### The same by a loop that `pipe` swaps in

The object loop held in a module variable, which making a pipe that starts
with a `with_default` replaces with one that writes the key.

- **Gave**: conformance at about no cost on the core: -4 gzip, with the
  loop moved to the top of the module, where the move alone is -7.
- **Cost**: +94 gzip on the `pipe` scenario, and `pipe` +68 last in and +44
  alone. In a program that has made such a pipe every object parse runs the
  other loop: in the matrix, the `object` cases 1.05x together (A/A
  ±0.034), and two ordinary ones marked slower, which fails rule 6. A
  schema made anywhere changes how every object in the program parses.
- **Why**: time on every object parse of a program that writes the shape
  once, and bytes over the opt-in price, for a shape few write.
- **Reopens**: as above.

## `number`

What was taken: `Number.isFinite(value)`, true of a finite number and of
nothing else, so the type is not asked first.

### The `typeof` form

`typeof value === 'number' && value === value`, the form `number` had before
it refused the infinities.

- **Gave**: a fractional double 0.92x alone and apart,
  `each/number_fractional`.
- **Cost**: it takes `Infinity` and `-Infinity`, which `number` refuses. And
  whole numbers slower in the matrix: `each/number` 1.065x, and an array of
  10 numbers 1.056x and of 10,000 1.067x.
- **Why**: it is a form that takes the infinities, and slows whole numbers. Of
  the forms that refuse them, none was faster on fractional doubles in a
  microbenchmark of a scalar and of an array of 100: `typeof` beside
  `Number.isFinite` measured equal, but for one faster reading on a scalar
  that a second run didn't repeat, `!==` each infinity was faster on a whole
  number as a scalar and over twice as slow on an array of fractional doubles,
  and `Math.abs(value) < Infinity`, a comparison with each infinity,
  `value * 0 === 0`, and `value - value === 0` were slower.
- **Reopens**: a form that refuses the infinities and is faster on fractional
  doubles without slowing whole numbers.

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

## Values that throw when read

### A guard for a revoked `Proxy` in `fail`

`fail` names the type it received with `Array.isArray`, which throws a
`TypeError` on a revoked `Proxy`. The guard takes `typeof` first and keeps
it when `Array.isArray` throws, so a primitive's `parse` returns its issue.

- **Gave**: `parse` returns issues for a revoked `Proxy` on the primitives,
  and on the object schemas for a revoked function. `is` already gives
  `false` on the primitives, and only a schema that takes anything, as
  `unknown` does, accepts one.
- **Cost**: core +14 gzip, the library +25, and `fail` alone +12. The `union`
  scenario went from 940 to 955, past its backstop of 952. Guarding the
  containers too, whose own `Array.isArray` throws in `is` and in `parse`,
  costs +29 to +45 more, and a trap or a getter that throws still throws.
- **Why**: it fails closed and loud: a throw is never an input accepted. A
  revoked `Proxy` can't come from parsed data, only from code in the
  process. Zod's primitives throw the same `TypeError` from their issues on
  a revoked object or array, except `literal` and `enum`, its containers
  throw from the parse, and Valibot throws on every schema but `unknown` and
  `any`. And it would fix the primitives, and the containers not at all for
  a revoked object or array.
- **Reopens**: a form that costs the core nothing, or a value of that kind
  that data-shaped input can produce.
