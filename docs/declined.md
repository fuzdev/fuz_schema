# Measured and declined

Trades that were built, measured, and not taken. Each is here so it isn't
built again without a new reason, and so the reason can be checked when one
turns up. What was taken instead is in [design.md](design.md).

An entry says what it was, what it **gave**, what it **cost**, **why** it was
declined, what **reopens** it, and the release it was **measured** before: the
library as it was then, which later changes can have moved. The figures were
measured on this repo's benchmarks, on Node 24.14.1 unless the entry names
another: time by [`npm run grade`](grading.md) or in processes of their own,
bytes as gzipped bundles where they say "gzip" and as heap allocated where
they don't. "Core" is the
`strict_nested` scenario's bundle, the bytes every consumer of an object schema
pays, which with `parse` alone is core in [grading.md](grading.md#bytes), where
every class but `speed` prices both, and the rules are
[grading.md](grading.md#rules)'s. A ratio is the trade's time over the library's
without it, as the library was when it was measured, so under 1 is faster. A
part with nothing to say is left out.

Some entries were declined under a former rule 5: a ceiling on the bundle of
every scenario together, as a share of Valibot's, where the rules have a
price per class and a backstop per scenario. Such an entry names the ceiling
it was over.

The parts, by what they change:

- Issues: [Issue paths](#issue-paths), [The issue cap](#the-issue-cap), [The unknown-key text](#the-unknown-key-text)
- Object schemas: [Object loops](#object-loops), [Dropping keys](#dropping-keys), [The copy's second read](#the-copys-second-read), [`record`](#record), [Object operations](#object-operations), [`variant`](#variant)
- Missing keys: [Passing the object and the key on](#passing-the-object-and-the-key-on), [Writing a missing key](#writing-a-missing-key)
- Recursion: [`lazy`](#lazy), [A recursive `union`](#a-recursive-union)
- Primitives and formats: [`number`](#number), [The format tests](#the-format-tests)
- The engine: [The parse context](#the-parse-context)
- Types and opt-in modules: [Types](#types), [Metadata](#metadata), [Standard Schema](#standard-schema)
- Not guarded: [Degenerate schemas](#degenerate-schemas), [Values that throw when read](#values-that-throw-when-read)

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
- **Measured**: before v0.5.0.

### A path as an array of exact size

`new Array` of the new length, filled by a loop.

- **Gave**: fewer bytes at depth.
- **Cost**: about 5% slower at one key, and +32 gzip on the core.
- **Why**: slower at one key, and core bytes.
- **Reopens**: nothing: it copies the path at every level, as the spread above does.
- **Measured**: before v0.2.0.

### `toSpliced` and `concat`

- **Gave**: nothing. Each is a call to a builtin, as slow as the `unshift`
  the spread replaced, or slower.
- **Reopens**: nothing: each copies the path at every level, as the spread above does.
- **Measured**: before v0.2.0.

### Every path reversed, whatever its length

`parse` and `parse_or_throw` reverse each issue's path without asking its
length first, since a path of one key or none is its own reverse.

- **Gave**: 5 gzip on the core and on every scenario, 13 on `parse` alone.
- **Cost**: a call to `reverse` for every issue: in a quiet grade nine
  invalid cases slower in the matrix, up to 1.13x on `each/string/invalid`,
  and the `fixed` group's invalid cases 1.14x alone.
- **Why**: slower on the invalid path for a few bytes.
- **Reopens**: nothing: the length check is cheaper than the call it skips.
- **Measured**: before v0.5.1.

## The issue cap

What was taken: a parse builds a hundred issues and counts every failure,
`parse`'s result carries the issues alone, and `parse_or_throw` gives the
count to the `SchemaError` it throws, for its `and N more`.

### A count of failures on `parse`'s result

`{ok: false, issues, fails}`, the true count beside the hundred issues.

- **Gave**: a caller of `parse` knows how many failures there were.
- **Cost**: +4 gzip on the core and +3 on `parse` alone. A change to the
  `SchemaResult` type, which code that builds a failed result by hand has
  to follow, to the Rust side's return type, and to every fixture.
- **Why**: the one place a wrong count was printed is `SchemaError`'s
  message, which takes the count through `parse_or_throw` for no core byte.
  No consumer has asked for it on `parse`.
- **Reopens**: a consumer that needs the count from `parse`, in a release
  that breaks anyway.
- **Measured**: before v0.5.7, on Node 26.13.

### A flag on `parse`'s result that the cap was reached

`{ok: false, issues, truncated}`.

- **Gave**: a caller of `parse` knows the issues are not all of them.
- **Cost**: +12 gzip on the core and +11 on `parse` alone, and the same
  changes to the type, the Rust side, and the fixtures as the count.
- **Why**: costs more than the count, and says less.
- **Reopens**: what reopens the count.
- **Measured**: before v0.5.7, on Node 26.13.

### The walk stopped at the cap

The containers returning at the hundredth failure, as in probe mode, with the
flag above.

- **Gave**: an input that fails more than a hundred times stops being read
  there.
- **Cost**: +43 gzip on the core and +11 on `parse` alone, and a count of
  failures is then impossible: the walk no longer sees them. The tests that
  hold the count fail.
- **Why**: the work it saves is linear in the input, not a denial of
  service, and it costs the most core bytes of any form, for nothing a
  consumer asked.
- **Reopens**: a shape of data-shaped input whose failures past the cap cost
  more than linear time.
- **Measured**: before v0.5.7, on Node 26.13.

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
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

### A copy cloned from the schema's entries

- **Gave**: a faster copy when the input has every key.
- **Cost**: the realistic copy path 1.45x, and +66 gzip on the core.
- **Why**: real data rarely has every key, and the rest of the time it loses.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### A required-key check for every entry

The loops looking for each entry's key, so that every schema that accepts
`undefined` refuses a missing one, as Zod's and Valibot's do.

- **Gave**: conformance on a missing key for every kind.
- **Cost**: +75 gzip on the core, which put all the scenarios together at
  0.68 of Valibot's, over the ceiling of two thirds rule 5 had then, and a
  list of flat objects 1.10x.
- **Why**: every object pays for a check few entries need. The opt-in form
  was taken: an entry is handed the object and its key, and the schemas that
  need a key look.
  See [design.md](design.md#missing-keys).
- **Reopens**: a check that costs an object with no such entry nothing.
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

### The unknown-key check by counting the keys

`object` counting the input's enumerable keys and comparing the count with
the entries present, in place of asking `Object.hasOwn` of the keys.

- **Gave**: no `Object.hasOwn` in the unknown-key check, which was about 30%
  of a flat strict object's time.
- **Cost**: an input with a non-enumerable own key that an entry names lets
  one unknown key through.
- **Why**: a hole in strictness is worse than the time.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### The unknown-key check skipped when the counts agree

The entries loop counting the entries present, as those whose value reads as
anything but `undefined`, as it reads each value anyway, and the check
skipped when the input's key count is the same.

- **Gave**: nothing measured: it was refused on soundness before it was
  built. The input's keys still have to be enumerated to be counted, which is
  most of what the check costs input in the schema's order.
- **Cost**: unknown keys let through. A value read through the prototype
  counts as present: `object({constructor: optional(unknown)})` given the
  JSON `{"z": 1}` reads `Object` at `constructor`, counts one entry and one
  key, and would accept `z`. A non-enumerable own key that an entry names
  does the same, as in the entry above. A missing optional key is not itself
  a hole: it reads as `undefined` and is not counted. A sound count tests
  each entry for an own enumerable key, which costs more than the check.
- **Why**: a hole in strictness is worse than the time.
- **Reopens**: nothing known.
- **Measured**: before v0.5.7, on Node 26.13.

### A one-key lookahead for the position check

A key in the schema's order is known by its position, and after an absent
optional key every later key is looked up. The lookahead tries the next
position too.

- **Gave**: the cases it is for back to the cost of input in the schema's
  order: an absent optional key first and in the middle of 21 keys, and three
  absent among 23, 0.70 to 0.82x in the matrix and 0.68 to 0.81x alone and
  apart. The realistic valid path 0.3% faster in the matrix, inside its A/A
  of ±1.5%.
- **Cost**: +10 gzip on the core. Input out of the schema's order slower:
  `object/6_keys_reversed` 1.142x and `scale/object_100_keys_reversed`
  1.060x in the matrix, both confirmed, and `object/21_keys_reversed` 1.013x
  and an unknown key after each of 20 known ones 1.053x alone, both
  confirmed.
- **Why**: core bytes, for shapes the realistic cases barely have, paid for
  by input out of order.
- **Reopens**: a form that costs input out of the schema's order nothing, or
  realistic input where a key absent ahead of present ones is common. The
  `object/*_optional_absent`, `object/*_reversed`, `object/6_keys_rotated`,
  and `object/20_keys_*` cases watch both sides.
- **Measured**: before v0.5.7, on Node 26.13.

### The position found by `indexOf`

The lookup of a key out of the schema's order done by `keys.indexOf`, which
also puts the position after the key found, so after an absent optional key
the keys that follow are in place again. An unknown key is one it doesn't
find.

- **Gave**: the absent-key cases 0.71 to 0.85x in the matrix, 0.68 to 0.83x
  alone, and 0.68 and 0.83x apart, `object/6_keys_rotated` 0.90x in the
  matrix, and `real/docinfo_module_full` 0.958x in the matrix and 0.949x alone,
  all confirmed. The realistic valid path 0.4% faster in the matrix, inside its
  A/A of ±1.8%, and 0.6% faster alone, inside its A/A of ±1.0%.
- **Cost**: +3 gzip on the core, +1 in the shortest spelling found. A
  search that grows with the schema's width, which the input's order
  chooses: a wide object reversed searches about half its keys for each key,
  `scale/object_100_keys_reversed` 1.755x in the matrix, and
  `object/21_keys_reversed` 1.063x in the matrix, 1.113x alone, and 1.115x apart.
  Pairs of keys swapped 1.053x in the matrix and 1.123x alone, and an
  unknown key after each of 20 known ones 1.277x in the matrix and 1.385x
  alone: each unknown key searched to the end, and the known key after it
  searched for again. All confirmed.
- **Why**: core bytes the realistic cases return nothing for, and input out
  of order slowed by a factor the input chooses.
- **Reopens**: a search whose cost doesn't grow with the schema's width.
- **Measured**: before v0.5.7, on Node 26.13.

### The search only after a key in place

The same search, only for a key out of order that follows one in place, and
`Object.hasOwn` for the rest, so a run of keys out of order searches once.

- **Gave**, in a process of one schema timing the check alone: an absent
  first key of 21 0.21x and a rotated 7 0.70x.
- **Cost**: +25 gzip on the core, and still slower out of order there: 6 keys
  reversed 1.34x, one swapped pair 1.52x, and 100 keys in an order that puts
  a key out of place after each in place 2.81x, as the search still grows
  with the width.
- **Why**: more core bytes than the plain search, and the same cost the
  input can choose.
- **Reopens**: as the plain search.
- **Measured**: before v0.5.7, on Node 26.13.

### A `Map` from each key to its position

The lookup and the position from one `Map` made with the schema.

- **Gave**, in a process of one schema timing the check alone: an absent
  first key of 21 0.23x, 21 keys reversed 0.77x, and 100 reversed 0.51x.
- **Cost**: the `Map` each object schema holds: 296 bytes at 7 keys and 968
  at 21, past rule 9's allowance of 16 per schema many times over. And one
  swapped pair 1.26x. Its core bytes were not measured.
- **Why**: rule 9, for a return the realistic cases don't have.
- **Reopens**: realistic input mostly out of the schema's order, with a
  ruling on what each schema may hold.
- **Measured**: before v0.5.7, on Node 26.13.

### A copy that leaves out a key whose value is `undefined`

The shared loop's copy leaving out a key whose output is `undefined`, in
place of asking `key in value` for each such entry, the check that keeps an
`undefined` key in and a missing one out. A wide copy asks it once for each
absent optional key, each a lookup that walks to `Object.prototype`.

- **Gave**: the realistic valid path 3% faster in the matrix, and its copy
  path 10%, a docinfo module 0.84x, nothing slower, allocation the same, core
  -8 gzip and all the scenarios together -5.
- **Cost**: a key the input has as `undefined`, own or inherited, and a
  `transform` to `undefined` no longer stay in a copy, where Zod and Valibot
  keep them by the same check. An input that comes back still has such a key,
  so whether one survives would depend on whether a copy was made.
- **Why**: a difference from both where they agree.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### The same, with the key kept by a rebuild

The copy leaving out a key that is `undefined` while it is built, then, when
it left one out, enumerating the input and rebuilding in the schema's order
if the input has such a key.

- **Gave**: the behavior kept, and a docinfo module 0.89x.
- **Cost**: +53 gzip on the core for the same 3% on the realistic valid path.
  It misses a non-enumerable key that is `undefined`, and adds a `for...in`
  that reads values.
- **Why**: rule 4 asks about 10% for those bytes.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### `Object.hasOwn` in place of `in` in a copy

- **Gave**: a docinfo module 0.94x, not confirmed.
- **Cost**: an inherited key that is `undefined` is dropped from a copy,
  which a test holds.
- **Why**: a change of behavior, for a speedup not shown.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### `loose_object` through the shared loop

`loose_object` as a call to the loop `object` and `strip_object` share, in
place of a loop of its own that repeats it.

- **Cost**: +18 gzip in every bundle with an object schema, and a loose
  schema's input that comes back as it is slower alone, see
  [design.md](design.md#object-schemas).
- **Why**: slower on the path `loose_object` is the cheapest on, and bytes
  for the bundles without one.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### `object` copying by a spread of the input

`object` copying by spreading the input, in place of copying the schema's
keys.

- **Gave**: the realistic copy path 9% faster, core -52 gzip, and an object
  of 21 keys, all present, 0.50 to 0.65x with a fifth of the bytes.
- **Cost**: small copies 1.13 to 1.38x, a docinfo module allocating 4 to 6%
  more, and all the scenarios together +63, over the ceiling of two thirds
  rule 5 had then, as `object` and `strip_object` stop sharing a loop. And
  it changes the output: the key order, the keys inherited, and an own symbol
  key copied into the output of an `object`.
- **Why**: slower on small copies, and a change of behavior.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### A copy filled from the start when an entry has a default

`object` and `strip_object` noting when made whether an entry is a
`with_default` or a `with_default_fn`, and for such a schema writing every
entry's output to a copy as the entries run, so a default that applies late
reads no key twice. Filling the copy from the first such entry, in place of
the start, saves nothing for one late default: the keys before it are read
again either way.

- **Gave**: a default that applies at the end of seven or twenty-one keys
  0.79x to 0.88x in the matrix and 0.76x to 0.83x alone. A chain of eight
  objects whose last has the default, `nested/depth_8_leaf_defaulted/valid`,
  read 0.369x alone and 1.017x in the matrix, not explained.
- **Cost**: +116 gzip on the core, which puts `strict_nested` at 0.758 of
  Valibot's, `pipe` at 0.781, and `type_json` at 0.760, over the backstop. The
  realistic valid path, here `real/config_defaults` alone, 5.5% slower in the
  matrix and 10.7% alone. Retained heap per further schema +127 bytes on `app`
  and +88 on `type_json`, over rule 9's allowance, which the grader reads as
  `ASK`. An input that has the defaulted key fills a copy it throws away:
  twenty-one keys 1.69x to 1.79x, and 8.5x the allocation in the matrix and
  14.7x alone. Alone, a default that applies first 1.10x, and six
  defaults that all apply 1.15x to 1.17x. A default inside a `pipe` is not
  seen, nor one in a nested object, which leaves the object around it copying
  as before.
- **Why**: core bytes, rule 4, and the backstop, the valid path slower, rule
  6, and retained heap over rule 9's allowance, an `ASK`.
- **Reopens**: nothing known.
- **Measured**: before v0.5.7, on Node 26.13.

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
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

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
  the ceiling of 0.75 rule 5 had then, and is slower on some valid shapes.
- **Reopens**: a form whose win on input in the schema's order survives a
  dictionary-mode input in the same program.
- **Measured**: before v0.2.0.

Re-made later, before v0.2.0, in two variants, the entries run eagerly and a
flag passed to the loop. Unpoisoned, the eager form is +44 gzip on all the
scenarios together, over the ceiling of 0.75 rule 5 had then, and slower than
the current loop on `6_of_7_keys_first_optional_absent` (1.10x) and on a nested
`strip_object` (1.17x alone); the flag form is +100. Poisoned by one input in
dictionary mode, a parse of a `strip_object` of 200 keys, through the shared
`for...in`, both were slower than the current loop poisoned the same way on
every strip case but one whose first optional key is absent: a geometric mean of
2.2x on the valid cases in the matrix and 2.8x to 3.1x alone and apart, and up
to 12x on a probe that fails. The eager form's realistic valid path was 26%
slower in the matrix and 36% alone. The current loop itself, on an input with
nothing to drop, moved from 111 to 121 ns.

### A copy filled as the entries run after a parse that dropped a key

A flag in `strip_object`'s closure, set when a parse dropped a key and cleared
when one fails or has nothing to drop, under which the next parse runs a loop
of its own that writes each entry's output to a copy as it goes, so no key is
read twice and the copy is ready when the enumeration finds a key to drop. The
flag is closure state, not a field of the schema, and the shape test passes
against it.
Output is the same as without it; only time and allocation depend on what the
schema parsed before.

- **Gave**: an input with a key to drop, at six keys and at twenty to forty,
  0.79x to 0.85x and 0.76x to 0.80x in the matrix, 0.74x to 0.80x and 0.70x to
  0.79x alone, and at twenty 0.74x to 0.78x apart, near what a version that
  always copies takes. The realistic valid path 0.4% faster in the matrix,
  inside its A/A of ±1.8%.
- **Cost**: `strip_object` +71 gzip last in and +91 alone, the scenarios
  built with it +88 to +94, which puts `pipe` at 0.762 of Valibot's, over the
  backstop. Alone, inputs with nothing to drop 1.03x to 1.04x, confirmed, and
  `strip/7_of_8_keys_last_defaulted/valid` 1.10x, which fails rule 6. A probe
  1.04x for the branch. Allocation depends on history: the first parse after
  the input changes kind fills a copy it throws away. And a late default is
  not helped, nor a key dropped in a nested `strip_object`, which makes the
  outer copy one of a change: `strip/accounts_100_extra_fields/valid` 1.01x.
- **Why**: the backstop and rule 6, for one of the two costs of copy-on-write,
  and allocation that depends on what a schema parsed before.
- **Reopens**: an eager loop that costs a bundle no more than the backstop
  allows and the path with nothing to drop nothing alone.
- **Measured**: before v0.5.7, on Node 26.13.

Three forms of it were built beside it:

- The flag set by any copy, a change's too, filled by a helper of its own:
  a flat object with a key to drop or a late default 0.72x to 0.83x, and
  0.84x to 0.91x through a `union`, in a nested object, or with an optional
  key absent, in the matrix. But the scenarios built with
  `strip_object` +102 to +105, over the backstop, an env file whose second
  entry always changes 1.16x alone, which fails rule 6, and, before the flag
  was cleared by a failure, failures 1.55x to 1.57x in the matrix.
- `strip_object` with a loop of its own for both ways, in place of
  `run_entries`: 8 gzip fewer alone, under the backstop, and +104 in a bundle
  that has `object` too. Inputs with nothing to drop 1.06x to 1.11x in the matrix, and the
  realistic valid path 0.7% slower alone, past its A/A of ±0.6%, which fails
  rule 6.
- The entries run again on the first parse that finds a key to drop, the copy
  filled as they go, in place of the copy loop: the scenarios 5 to 7 gzip
  fewer than the flag above and `strip_object` alone 8 fewer, though last in
  it is +90 against +71, `pipe` still over the backstop at 0.758, and an entry runs twice on
  that parse, which a test refuses.

Two more were weighed and not built:

- **A key to drop known from a count**: an input with more own enumerable
  keys than the schema has entries must have one to drop, which is sound in
  that one direction, unlike the count of
  [the unknown-key check](#the-unknown-key-check-by-counting-the-keys). But a
  count of an object's keys costs an enumeration or an array, the cost it is
  meant to save. Reopens: a count the engine gives for less than enumerating.
- **The outputs kept in an array of the schema's**, reused from parse to parse,
  so a copy reads them in place of the input's keys: a write for every entry
  on the path with nothing to drop, the input's values held between parses,
  and a guard against a `lazy` reaching the same schema inside its own parse.
  The reads are less than half of what a copy costs, 43 ns of 93 at six keys
  and 169 of 389 at twenty in a microbenchmark; most is its writes.
  Reopens: a copy whose writes cost less than its reads.

## The copy's second read

What was taken: a copy is made after the entries have run, and reads the
keys it keeps a second time, see [design.md](design.md#copy-on-write-output).
A getter or a `Proxy` that gives another value then puts one in the output
that no schema was given. Parsed JSON can't, and the library never writes to
its input. A caller that needs a snapshot makes one,
`s.parse(schema, structuredClone(input))`, see the README.

### The entries run again when a copy starts

At the first entry whose output differs, the entries run again from the
first, each written to the copy from the read it ran on, in `run_entries`,
`loose_object`, `array`, `record`, and `object_with_rest`.

- **Gave**: −13 gzip on the core, and a copy holds only values a schema was
  given.
- **Cost**: exponential on plain JSON. Each level that copies runs its
  children again, and each of them again: nested objects with a late default
  at every level, 327 bytes of JSON 21 levels deep, ran a leaf check
  4,194,302 times, where it runs 21, and nested arrays the same. A
  `transform` runs twice, which the tests refuse.
- **Why**: denial of service on data-shaped input, and not a snapshot, see
  below.
- **Reopens**: nothing that runs an entry more than once.
- **Measured**: before v0.5.7, on Node 26.13.

### The first reads kept

Each entry's input kept as it is read, so a copy is filled from the reads
the entries ran on and reads the input no second time.

- **Gave**: a copy holds only values a schema was given.
- **Cost**: +11 gzip on the core, and the path that returns the input as it
  came allocates: the realistic cases that come back as they came, together,
  went from 27,833 to 857,475 bytes a parse, a figure of the run that built
  it, not measured again.
- **Why**: it puts a cost on every input that comes back, the path
  copy-on-write is for, and is not a snapshot.
- **Reopens**: a way to keep the reads that allocates nothing for an input
  that comes back.
- **Measured**: before v0.5.7, on Node 26.13.

Neither gives a snapshot. A nested object that needed no copy comes back as
the input's own object inside the fresh outer copy, so what reads it later
reads the input, and a `transform` after a container is handed the input
itself where nothing changed, and reads it again. The whole guarantee is a
clone, which is opt-in by the library's own rule: as an export,
`parse_snapshot`, it measured 27 gzip last in, and is left to the caller as
the `structuredClone` above until a consumer asks for it.

## The unknown-key text

What was taken: an `unknown_key` issue is `{kind: 'unknown_key', expected: 'no
unknown keys', received}`, with `received` the type of the key's value, which
`format_issue` writes as `props: expected no unknown keys, received array`. It
reads as though the object were an array.

### `expected: 'never'`

- **Gave**: `props: expected never, received array`, and −4 gzip on the
  core.
- **Cost**: a change to the issue's data, which the Rust side, every
  fixture's issues, and a consumer that pins `expected` on the wire move
  with.
- **Why**: a break in documented data for a papercut, and the text still
  names the value's type.
- **Reopens**: a release that breaks issue data anyway.
- **Measured**: before v0.5.7, on Node 26.13.

### `received: 'key'`

- **Gave**: `props: expected no unknown keys, received key`, and −5 gzip on
  the core.
- **Cost**: +25 gzip on the `type_json` scenario and +28 on `app`, the
  scenarios with a `variant`. `get_issue_value` can no longer find the value
  of such an issue, and `received` would stop being the type of the value.
- **Why**: it breaks what `received` means.
- **Reopens**: nothing that keeps `received` the value's type.
- **Measured**: before v0.5.7, on Node 26.13.

### A format of its own in `format_issue`

The issue as it is, written by `format_issue` as `props: unknown key`.

- **Gave**: the text reads right, the issue's data is untouched, and the
  core +0.
- **Cost**: +22 gzip on `format_issue` alone, +23 on `SchemaError` and
  `parse_or_throw` alone. A change to documented text, which the Rust side's
  `Display`, the fixtures' formatted text, and a consumer's message lines
  move with.
- **Why**: a breaking change to documented text for a papercut. Kept as it
  is.
- **Reopens**: a release that changes issue text anyway, or a consumer
  misled by it.
- **Measured**: before v0.5.7, on Node 26.13.

## `record`

### Enumerating by `Object.keys`

`record` reading `Object.keys` of the input, in place of `for...in` and
`Object.hasOwn`.

- **Gave**: on an input in dictionary mode, which `JSON.parse` gives from 128
  keys, 23 µs against 35 at 1000 keys. The engine collects such an input's
  keys either way, 16 KB at 1000 keys.
- **Cost**: on an object in fast mode `for...in` allocates nothing, and
  `Object.keys` allocates its list, 848 bytes at 100 keys, for about the
  same time.
- **Why**: which wins is the input's size and kind.
- **Reopens**: real data of records past 128 keys.
- **Measured**: before v0.2.0.

## Object operations

### Helpers for extend, pick, omit, and partial

Three sets of helpers, in place of spreading `def` into a factory, see
[design.md](design.md#composing). Plain ones, `extend`, `pick`, `omit`, and
`partial` over an object schema, returning an `object`. Kind-preserving
ones, the same returning a schema of the source's kind. And entries-level
ones, `pick_entries`, `omit_entries`, and `partial_entries`, returning
entries for the caller's factory, with extend and merge left a spread. Over
a base of three entries, 741 gzip:

| gzip over the base | spread | plain | kind-preserving | entries-level |
|---|---|---|---|---|
| extend | +14 | +27 | +560 | +14 |
| omit | +17 | +44 | +573 | +46 |
| pick | +10 | +39 | +569 | +40 |
| partial | +53 | +75 | +602 | +76 |
| the library whole | +0 | +129 | +169 | +105 |

- **Gave**: one call in place of a spread or a destructuring. The plain and
  kind-preserving `extend` type an overridden key right in a generic
  function, where a spread needs its entries typed as `Omit<T, keyof U> & U`.
- **Cost**: bytes on every use, in the table, and in the library. The plain
  helpers silently tighten a loose object to strict, and took more type
  instantiations per extend than the spread, a sixth to a third more, by how it was counted. The
  kind-preserving ones pull in all four object factories wherever one is
  used. As built, `omit` used `delete` and `partial` wrapped a default in
  `optional`, which drops it; forms without either weren't measured. The
  spread's `partial` keeps the defaults. A helper a bundle doesn't use costs
  it nothing, and each result is an ordinary object schema, as the spread's
  is.
- **Why**: the spread does each operation for nothing in the library and
  fewer bytes per use and keeps the strictness explicit, and the consumers
  known extend bare objects with concrete overrides.
- **Reopens**: a consumer that needs one, as `partial` over many wide
  schemas, or generic extenders throughout. Each is added on demand.
- **Measured**: before v0.5.1.

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
- **Measured**: before v0.2.0.

## `lazy`

### A `lazy` that replaces its own `run`

On first use it writes its schema's `run` over its own, so later calls skip
it.

- **Gave**: arrays of a lazy 0.65x, and a real manifest schema 0.91x.
- **Cost**: one write to a schema's `run` makes that field mutable for every
  schema, as they share a hidden class. A root array of strings went from
  6.28 ns to 9.46 ns once any lazy had been used. A grade sees it only
  apart: in `matrix` and `alone` its two versions share a process, so both
  pay.
- **Why**: every schema in a program pays for one lazy in it.
- **Reopens**: nothing known. `src/test/schema.shape.test.ts` fails on it.
- **Measured**: before v0.2.0.

### That `lazy` with a null prototype

The same, on an object with no prototype, so the write is to another hidden
class and the shared field stays constant.

- **Cost**: a second hidden class at every `schema.run` load: the realistic
  valid path 15% slower in the matrix.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### A `lazy` of four parameters, or of a rest parameter

In place of reading the length of `arguments` on each call.

- **Cost**: a `run` of four parameters is about 45% slower for a caller that
  passes two arguments, and one with a rest parameter about 6%, both through
  call sites shared with other schemas.
- **Why**: a lazy is called with two arguments everywhere but as an object's
  entry.
- **Reopens**: an engine that adapts the arguments for less.
- **Measured**: before v0.2.0.

## A recursive `union`

A `union` whose options walk a node's children before an entry rules them
out takes time exponential in the input's depth, see
[design.md](design.md#unions-and-recursion). These were built to make it linear in the
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
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.5.0.

### The `literal` entries first when probing

An object that, probed, checks its `literal` entries before the rest, so a
union's option is ruled out before it walks.

- **Cost**: core +71 gzip, and `object` alone +67.
- **Why**: core bytes for a shape that a consumer can write in order.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### `variant`'s dispatch inside `union`

A `union` that finds, when it is made, a `literal` entry its object options
share, and dispatches on it as `variant` does.

- **Cost**: `union` alone +177 gzip and last in +146, the `union` scenario
  +183, just under the backstop.
- **Why**: bytes on every union, for what `variant` already does as an
  export of its own.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

## Passing the object and the key on

### One closure of four parameters

For `union`, `pipe`, `nullable`, and `message`: one `run` that always passes
the object and the key on, in place of two closures chosen when the schema is
made.

- **Gave**: fewer bytes, 42 gzip on `union`, and 30 on the `pipe` scenario.
- **Cost**: slower on valid input, as it hands two arguments to a `run` that
  doesn't take them. For `pipe`, a hundred numbers each through three
  actions 1.11x in the matrix, and each through a `check` 1.15x. For
  `nullable`, `each/nullable_null/valid` 1.52x in the matrix.
- **Why**: time on the valid path, for bytes that only the bundles with the
  kind pay.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### One body for `union`'s two closures

To bring the `union` scenario back under the backstop: the `run` that
doesn't take the object and the key calls the one that does, which calls
each option with them only when it has them, so a `run` of two parameters is
still handed two. With it a local function for whether an option takes the
key, and the retry over `options.slice(0, i)`.

- **Gave**: the `union` scenario 973 → 949 gzip, 0.766 → 0.747 of
  Valibot's, under the backstop of 952. `type_json` −27, the library −29,
  core +0.
- **Cost**: a call into the shared body on every parse of a union that
  doesn't take the key, and a test of `parent` per option in the one that
  does. Graded `--runs 5`, the matrix figures from a full grade on a quiet
  machine and the alone and apart ones from a grade of the union cases: five
  union valid cases slower
  in the matrix, `each/union_3_primitives_first/valid` 1.086x and
  `each/union_nested_inner_miss/valid` 1.072x, the others about 1.03x; the
  union cases' valid time 1.080x alone and 1.107x apart, the `each` group's
  1.190x apart. Retained heap +64 B per further `union`, past
  [rule 9](grading.md#rules)'s allowance of 16.
- **Why**: time on every union parse, and heap on every union, for bytes
  only a bundle with `union` pays. Without the shared body the least found
  was 953, still over, and only with two changes in behavior: naming an option `object` by
  `kind.includes('object')`, which changes the `expected` text of a `record`
  or `variant` option, and trying every earlier option again, not only those
  that take the key. Nor can the two closures be written to minify to the
  same names: locals are named by slot after the parameters, and default
  parameters break the forwarding of `lazy` and `message`. The scenario is
  under the backstop, by a union naming its object options by one test of the
  kind, which keeps a `record` and a `variant` as `object`, and this trade
  stays declined.
- **Reopens**: a form that keeps the two closures and finds the bytes
  elsewhere.
- **Measured**: before v0.5.1.

### `message` choosing on each call

One `run` for `message` that reads on every call whether what it holds
takes the object and the key, in place of two closures chosen when it is
made.

- **Cost**: slower on valid input. The figure was not kept.
- **Why**: time on every parse through a `message`.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### One body for `message`'s two closures

`message`'s two closures sharing the body that counts and labels the issues,
as one call from each, in place of each writing it out.

- **Cost**: slower on valid input, a call more on every parse through a
  `message`. The figure was not kept.
- **Why**: time on every parse through a `message`.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

### A `pipe` that looks for the key after any first schema

A walk of the first schema when the pipe is made, for whether it could give
`undefined` for a key that is missing: through `nullable`, the options of a
`union`, and a `with_default` of `undefined`, and at a `check` or a
`transform`. So that no step runs after any schema that let a missing key
through, and not only after the ones the pipe has the object for.

- **Gave**: one rule for every first schema.
- **Cost**: +97 gzip on the `pipe` scenario and +85 on all the scenarios
  together, which at 0.7502 of Valibot's was over the ceiling of 0.75 rule 5
  had then.
- **Why**: bytes in every bundle with a `pipe`, for first schemas on which
  Zod and Valibot disagree with each other.
- **Reopens**: a way to tell that costs a pipe that starts with a `string`
  nothing.
- **Measured**: before v0.2.0.

### A `pipe` that starts with an `optional` with a loop of its own

The closure of a pipe that starts with an `optional` running its steps in a
loop of its own once it has looked for the key, in place of calling the
closure of two parameters, which it shares them with.

- **Gave**: with the key there, a pipe of an `optional` and a `check` 0.88x
  in the matrix, and the same under a `message` 0.89x, and alone the same as
  the shared closure. That is the path that calling the shared closure costs
  in the matrix, 1.14x and 1.16x against a pipe that hands its `optional` the
  object and the key and loops itself.
- **Cost**: +8 gzip on all the scenarios together, which at 2126 was over
  the ceiling of 0.75 rule 5 had then, and +11 on the `pipe` scenario.
  Without the key, alone, 1.16x, allocating 48 bytes a parse where the shared
  closure allocates none.
- **Why**: over the ceiling of 0.75 rule 5 had then. The present-key path
  keeps the cost of the call.
- **Reopens**: a grade under the rules as they are, which price its +11 on
  the `pipe` scenario by class, against its speed with the key and its 1.16x
  without. The ceiling it was declined under is gone, so what is left of the
  ruling is those figures, taken again on the library as it is.
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

### `literal` with four parameters

One `run` of four parameters for every `literal`, so that `literal(undefined)`
needs its key, as `unknown` does.

- **Cost**: slower on valid input for every literal.
- **Why**: every literal's valid path, for one literal. Two closures chosen
  when the literal is made were taken: only `literal(undefined)` has the
  four parameters, and so for `one_of`. That is +45 gzip on all the scenarios
  together and none on the core. See [design.md](design.md#missing-keys).
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

### A shared wrapper for the schemas that need a key

One function that takes a `run` of two parameters and returns one of four
that looks for the key first, for `literal` and `one_of`, in place of a
second closure in each.

- **Cost**: +65 gzip on all the scenarios together where the two closures are
  +45, which at 0.725 of Valibot's was over the ceiling of 0.72 rule 5 had then,
  and 6 gzip more over the whole library. A call more a parse for a schema that
  needs its key.
- **Why**: more bytes, where it was built for fewer.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

### A missing key as the `literal`'s own issue

A `literal(undefined)` without its key failing as a `literal` that expected
`undefined`, in place of the `missing_key` an `unknown` reports.

- **Gave**: 22 gzip fewer on all the scenarios together: a bundle with a
  `literal` and no `unknown` has the text of a `missing_key` for it alone.
- **Cost**: an issue that reads `expected undefined, received undefined`, and
  a second kind for a missing key.
- **Why**: the issue has to say what is wrong.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

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
- **Measured**: before v0.2.0.

## The format tests

What was taken: `uuid` reads its 36 chars by char codes in one loop, a `-`
at the positions a mask of the dashes names and a hex digit elsewhere, then
its version and its variant each by a bit of a mask, and the nil and the max
UUID by a small `RegExp` only when those fail. Against the `RegExp` it
replaced, over 6 runs: the realistic valid path 1.6% faster alone, past its
A/A of 0.6%, and 0.8% in the matrix, inside its A/A of 1.7%,
`real/fuz_app_cell_list_output_50/valid` 0.951x in the matrix, confirmed, and
0.934x alone, `each/pipe_uuid_distinct/valid` 0.972x, for `uuid` +79
gzip last in and +63 alone, and `json_schema.ts` +52, whose copy of the
grammar no longer compresses against the `RegExp`. `iso_datetime`'s code
is as it was, +9 gzip last in, and `to_lower_case` as it was.

The microbenchmarks below are of the test alone over 223 distinct strings
from `JSON.parse`, under Node 26 with no flags, in a process each, beside
`UUID.test(value)` at 63 ns valid and 114 ns invalid, and the scan taken at
56 and 54. Bytes are `uuid`'s gzip last in and alone, against 89 and 261 for
the `RegExp`.

### The five groups by a call each

A function that reads a group of hex digits and the `-` after it, called
once for each of the five groups.

- **Gave**: 49 ns valid and 46 invalid. In the grader, 6 runs, faster on the
  UUID cases than the scan taken: `each/pipe_uuid_distinct/valid` 0.850x in the
  matrix and 0.867x apart, `each/pipe_uuid/valid` 0.865x and 0.886x.
- **Cost**: 192 and 349, +103 and +88. And on the realistic cases no gain
  past the A/A: the valid path +0.2% in the matrix and +0.1% alone,
  `real/fuz_app_cell_list_output_50/valid` 0.965x and 0.962x, not confirmed.
- **Why**: 24 and 25 bytes more than the scan taken, for a win on cases of
  nothing but UUIDs and none on the realistic ones, where the scan taken reads
  faster.
- **Reopens**: a consumer whose parses are mostly UUIDs.
- **Measured**: before v0.5.7, on Node 26.13.

### Other forms of the `uuid` test

- **Gave**: no other `RegExp` was faster: a length test first 64 ns, the `i`
  flag 65, the common shape alone with the nil and the max in a second
  `RegExp` 63 to 65, and no `$` with the length tested 63. Of scans, a table
  of 64K bytes 46 ns, of 128 bytes 49, the five groups by a loop over their
  ends 59 (186 and 345), the five groups with the shorter fallback of the
  scan taken 192 and 343, the dashes by a branch on their positions 87 (171
  and 334), the hex test allowing a `-` and the dashes summed after 54 (176
  and 335, and wrong: it takes a `-` in place of a hex digit), the version
  and variant by string comparison 60 (166 and 327) or by char-code
  comparison 54 (175 and 332), the version, the variant, the nil, and the max
  in one `RegExp` after the loop 99 (148 and 308), the hex tests branchless
  57, and the 36 tests unrolled 67.
- **Why**: each was slower than the scan taken, or larger, or both, but the
  one `RegExp` after the loop, which is 20 bytes smaller and nearly twice as
  slow, and the table of 64K bytes, which is that much heap.
- **Reopens**: a way to read a string's chars that costs less than
  `charCodeAt`, which is most of the scan: 36 of them summed took 39 ns.
- **Measured**: before v0.5.7, on Node 26.13.

### `iso_datetime` by its char codes

The date and time read by char codes: each digit's value, the fields as
numbers, the day against its month's length and the year's leap, and a loop
over the fraction.

- **Gave**: 31 ns a test against the `RegExp`'s 36 in the microbenchmark. In
  the grader, 4 runs: `each/pipe_iso_datetime_distinct/valid` 0.978x in the
  matrix, 0.863x alone, and 0.802x apart, and on the invalid cases 0.50x to
  0.84x.
- **Cost**: `iso_datetime` +94 gzip last in, +103 alone. And
  `each/pipe_iso_datetime/valid`, a hundred copies of one string, 1.220x in
  the matrix, 1.244x alone, confirmed slower, and 1.096x apart, which fails
  rule 6.
- **Why**: the `RegExp` spends about 18 ns of its 36 being called and reads
  the 24 chars in about as many again, which a scan by `charCodeAt` doesn't
  beat by much, and the bytes and the slower case are not paid for by it.
- **Reopens**: a cheaper way to read chars, as above.
- **Measured**: before v0.5.7, on Node 26.13.

### `to_lower_case` returning an input already lowercase

`typeof value === 'string' && is_lower_ascii(value) ? value : value.toLowerCase()`,
where `is_lower_ascii` is a loop over the char codes that stops at an
uppercase ASCII letter or a code past 127, and the same with
`/^[^A-Z\u0080-\uffff]*$/` for the loop. Either gives the same string as
`toLowerCase`, and it saves allocating a copy.

- **Gave**: no allocation for a string already lowercase:
  `each/pipe_to_lower_case/valid`, a hundred lowercase UUIDs, from 5689 to 88
  bytes a parse.
- **Cost**: time. `toLowerCase` reads a string many chars at a time: 15 ns on
  a lowercase string of 36 chars and 37 ns on one of 400, with the copy, where
  the loop took 46 and 506, and the `RegExp` 32 and 188. In the grader, 4
  runs, the loop 1.945x on `each/pipe_to_lower_case/valid` in the matrix,
  2.427x alone, 2.330x apart, and 1.046x to 1.104x on an uppercase input,
  `each/pipe_to_lower_case_upper/valid`; the `RegExp` 1.291x to 1.491x on the
  first and 1.353x to 1.552x on the second, all confirmed. `to_lower_case`
  +33 gzip last in and +75 alone for the loop, +32 and +49 for the `RegExp`.
- **Why**: rule 6, and allocation breaks ties only when time is within noise.
  The loop is faster only under about 8 chars.
- **Reopens**: a test of a string's case as fast as `toLowerCase`'s own, or
  a consumer whose strings are mostly a few chars.
- **Measured**: before v0.5.7, on Node 26.13.

## The parse context

### One context kept between parses

A module-level context reset by each parse, in place of a new object.

- **Gave**: 48 bytes fewer a parse, in code shared by many schemas.
- **Cost**: a parse the engine had inlined whole got up to 2x slower. A new
  context never leaves the parse, so the engine removes it. A kept one
  escapes.
- **Why**: the valid path got slower, where a program has one schema.
- **Reopens**: nothing known.
- **Measured**: before v0.2.0.

## Types

### A tighter fold of a `pipe`'s types

Each step's input folded as its output is, so
`pipe(one_of([1, 2]), integer, transform((v) => v))` outputs `1 | 2`.

- **Cost**: +108 type instantiations, and
  `pipe(brand(string, 'B'), min_length(1), string)` refused.
- **Why**: checker cost on every pipe, and a pipe refused that runs.
- **Reopens**: nothing known.
- **Measured**: before v0.5.0.

### A brand marker of one name

`Branded` marking its type with the name as the value of one key, in place of
an object whose keys are the names.

- **Cost**: a brand of a branded type intersects two values of the one key,
  so it was `never`.
- **Why**: marks must compose.
- **Reopens**: nothing known.
- **Measured**: before v0.5.6.

### Entries constrained by a mapped type

The object schemas constraining their entries as `{[K in keyof T]: Schema}`
in place of `SchemaEntries`, so an interface of entries is taken, which has
no index signature.

- **Gave**: an interface of entries typechecks.
- **Cost**: the plain form breaks the declarations a consumer emits for its
  generic helpers over the library, which then don't compile where they are
  read, and takes `object([string])`, an array of schemas. With a guard
  against an array and a constraint of `variant`'s options in kind the tests
  pass, at about 0.4% more type instantiations, a figure of the run that
  built it, not measured again, and the restriction still
  holds at `SchemaNode` and at every consumer helper constrained by
  `SchemaEntries`.
- **Why**: writing `type` for `interface` costs a consumer less than all of
  it, and the `SchemaEntries` TSDoc says so.
- **Reopens**: TypeScript giving an interface an implicit index signature.
- **Measured**: before v0.5.7, on Node 26.13.

## Metadata

### `message` carrying metadata through an export of `meta.ts`

`message` calls a function `meta.ts` exports, which reads and writes the
registry, in place of reading the registry by its key in `schema.ts`.

- **Gave**: the registry's key written once, and 12 gzip off `message` last in.
- **Cost**: 28 gzip on `message` alone, as the registry is then made in
  every bundle that uses `message`, and an export that is no API.
- **Why**: larger where `message` is used without `meta`, and the key is a
  contract between versions already, which a test holds `schema.ts` to.
- **Reopens**: a module both can import that adds no export.
- **Measured**: before v0.5.1.

## Standard Schema

### `~standard` on every schema

Every schema a Standard Schema natively, in place of the
`to_standard_schema` adapter.

- **Gave**: no speed.
- **Cost**: +137 to +185 gzip in every bundle, by form.
- **Why**: bytes every consumer pays, for those who want the interface. The
  adapter is opt-in.
- **Reopens**: a form that costs a bundle not using it nothing.
- **Measured**: before v0.2.0.

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
  throw from the parse, and Valibot throws on every schema but `unknown`,
  `any`, and an `object` with no entries. And it would fix the primitives,
  and the containers not at all for a revoked object or array.
- **Reopens**: a form that costs the core nothing, or a value of that kind
  that data-shaped input can produce.
- **Measured**: before v0.5.0.
