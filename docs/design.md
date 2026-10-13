# Design

The internals of `src/lib/schema.ts` and the modules beside it. The strategy is
[Valibot](https://valibot.dev/)'s: one tree-shakeable export per schema and
action, schemas as plain data, `pipe` for refinement. This is where it differs.

## One shape

Every schema and every action is `{kind, def, run}`, keys in that order.

- An action is a schema whose `run` assumes typed input. `pipe` is a loop.
- All schemas share one V8 hidden class, so a `schema.run` load is the same
  everywhere. Kind-specific data goes in `def`, never in extra fields.
- `def` makes schemas introspectable: an object's entries, a literal's value.
- Schemas with no options are constants: `s.string`, not `s.string()`.
- **Nothing writes to a schema after it is made**, so a frozen one parses. A
  `lazy` keeps the schema it got in a closure, not in itself: a write to one
  schema's `run` makes that field a mutable one for every schema, as they
  share a hidden class, and the engine then loads it on calls it had folded.

## What `def` holds

`kind` and `def` describe a schema as data. The `SchemaDefs` interface maps
every kind to the type of its `def`, and `SchemaNode` is the union of
`{kind, def}` pairs derived from it, so checking `kind` narrows `def`.
`SchemaKind` and `SchemaDef` are the keys and the lookup. The schemas inside a
`def` are typed as `SchemaNode` too, so a walk needs no cast.

| `def` | Kinds |
|---|---|
| `undefined` | `string`, `number`, `boolean`, `bigint`, `unknown`, `integer`, `safe_integer`, `finite` |
| the value given | `literal`, `one_of`, `min_length`, `max_length`, `min_value`, `max_value`, `regex` |
| the function given | `check`, `transform`, `lazy` |
| `{schema}` | `optional`, `nullable` |
| `{schema, value}` | `with_default` |
| the entries | `object`, `loose_object`, `strip_object` |
| the schema of every value or item | `record`, `array` |
| the schemas, in order | `union`, `pipe` |
| `{key, options}` | `variant` |

- **`optional`, `nullable`, and `with_default` hold their schema under `schema`.**
  Unwrapping any of the three is `kind` and that one key.
- **`lazy` holds the function it was given**, not a schema. Nothing is held
  until it's called, and it is where a recursive schema comes back to itself,
  so a walk treats it apart whatever its shape.
- **`array` and `record` hold the schema itself.** They are containers, like
  `union`, and an object around the schema would be bytes in every bundle
  with an array.
- **Some inputs are not in `def`**: the `expected` text given to `regex` and
  `check`, and the text given to `message`.
- **A `def` is as close to plain JSON as its kind allows.** What isn't is the
  kind's own: a function, a `RegExp`, a `bigint` or `undefined` literal.
- **`is_schema` is the structural guard**: an object with a string `kind`, a
  `def`, and a `run` function. It doesn't check that the kind is a known one
  or that `def` is what the kind holds, and it ignores other keys.
- A kind defined outside the library joins the contract by declaration
  merging on `SchemaDefs`.

## Running

`run(value, ctx)` returns the output. Failure is reported through `fail`.

- **Failures are counted** in `ctx.fails`. A container knows a child failed
  when the count grew across the call.
- **Paths are built on unwind.** A container prefixes its key onto the issues
  its child added. Valid input never touches a path.
- **A prefix is a new array**, the key and then the path so far, which
  replaces the issue's `path`. `unshift` on the one array is a call the
  engine doesn't inline, and its first on an empty array grows it to hold
  many keys. Given up: an issue allocates an array a level, and the engine
  gives each one past the first room to grow. So a path of one key takes
  fewer bytes than the grown array did, and a deeper one more, by about that
  array again a level. It measured faster at every depth tried.
- **Probe mode** (`ctx.probe`): `fail` only counts, and containers return at
  their first failed child. `union` probes its options; `is` runs entirely in it.
- **`ctx.issues` is `undefined` until the first failure** outside probe mode,
  so a parse that finds nothing allocates no array for them. The first issue
  is written as the array's one element, where a push onto an empty array
  would grow it to hold many. From then on
  `ctx.fails === ctx.issues.length` outside probe mode, and containers use
  the count as an index into `issues`.
- **An entry's `run` gets two more arguments**: the object schemas call
  `run(value, ctx, parent, key)`, with the object being read and the entry's
  key. Both are optional in `Schema.run`'s type, so a `run` of two parameters
  is an entry like any other. `unknown` reads them.
- **`nullable`, `union`, `pipe`, and `message` pass them on to a `run` that
  takes them**, which each tells once, when it is made, by the `length` of
  that `run` or by the kind `'lazy'`: `nullable` and `message` by the schema
  they hold, `union` by any of its options, and `pipe` by its first schema,
  the only step it hands them to. So a schema that reads the object and the key declares them as
  plain parameters, with no default and not as a rest. Around anything else
  each has a `run` of two parameters and calls with two, as `optional`,
  `with_default`, `array`, `record`, and `variant` always do.
- **Each of the four is two closures** that differ only in what they pass on.
  One `run` of four parameters is fewer bytes, and measured slower on valid
  input for `union`, for `pipe`, and for a `message` around every schema: it
  hands two arguments to a `run` that doesn't take them. So what passing them
  on costs is bytes, in the bundles that have the kind.
- **A `lazy` passes on what it is given**, two arguments or four, which it
  tells on each call by the length of its `arguments`. Its schema isn't known
  when it is made, so it can't choose a closure then, and a `run` of four
  parameters costs every caller that passes two. So its `run` declares two,
  and the four tell a lazy by its `kind` where its `length` can't say: around
  one they pass the object and the key on, whatever it defers to. Until the
  engine's last tier has the call, its `arguments` is an object a call, which
  a parse of settled code doesn't allocate.

## Copy-on-write output

A container returns its input when no child changed and nothing had to be
dropped. A change copies only the path to it; unchanged siblings stay shared
with the input.

A child changed when its output is not its input by `Object.is`. So a
transform between `0` and `-0` is a change, which `===` would lose, and a
`NaN` that passes is none, which `===` would copy for.

Given up:

- Output may alias input. Mutating one mutates the other.
- Validation is not a snapshot: a getter, a proxy, or an object someone else
  holds can pass and then differ. Parsed JSON can't.
- A class instance that matches comes back as that instance. An input that
  comes back keeps its prototype, whatever that is.
- Non-enumerable and symbol keys survive, and the keys are in the input's
  order, not the schema's.
- Entries are read through the prototype, which is what lets a class instance
  match. An entry named like a member of `Object.prototype`, such as
  `toString` or `constructor`, therefore sees that member when the input
  lacks the key: the input is rejected unless the entry accepts a function,
  and a copy carries the member as an own key. Inputs with no prototype are
  unaffected.
- A key read through the prototype stays inherited in an input that comes
  back, where a copy has it as an own key.
- An enumerable key the input inherits is still read through an input that
  comes back: one a `record` never validated, as it runs own keys only, and
  one a `loose_object` doesn't name. A copy has neither.
- An array that comes back is the input as it is, as an object is: a hole
  stays a hole, and its own keys that are not items stay. A copy of one is a
  `slice` with the changed items written to it: it has none of those keys, a
  hole before the first item that changed stays a hole in it, and it is an
  instance of the input's `Array` subclass.

Kept:

- `strip_object` drops unknown keys, copying when there are any.
- `object` never accepts them.
- `record` drops a `__proto__` key, after validating its value as any own
  key's, and so does a copy `loose_object` makes of one the schema doesn't
  name. A schema entry named `__proto__` is not
  guarded in any object schema: a copy writes it, which sets the copy's
  prototype from the input, and an input that comes back keeps its own
  `__proto__` key.
- The input is never mutated.

Zod and Valibot build every output. `src/test/schema.conformance.test.ts`
compares this library with both, and allows an object of the output that is
the input's own to differ from their copy in the ways above that are the
input's alone and that nothing reads by enumerating it: its prototype, its key
order, and its symbol keys and keys that aren't enumerable. The rest are rows
of its table, see [below](#behavior-that-differs-from-valibot-and-zod): a key
read through the prototype, an enumerable key it inherits, an own `__proto__`
key, and what an array keeps.

## Object schemas

Three, differing only in what they do with keys the schema doesn't name:

| | Unknown keys | Cost on valid input |
|---|---|---|
| `object` | an error | one pass over the input's keys |
| `loose_object` | kept | none; they are looked at only to copy them |
| `strip_object` | dropped | one pass, then a copy when there are any |

An array is not an object: all three reject one, as do `record` and
`variant`, with the one issue any non-object gets.

`object` is the default name because rejecting is the safe default.
`loose_object` is the cheapest on input that comes back as it is, and
`strip_object` is the one that works for its result.

`object` and `strip_object` share a loop over the entries:

- **Entries run first, then the input's keys are checked.** Whether the output
  can be the input itself is decided last, so nothing that runs in between can
  slip a key in.
- **A key in the schema's order is known by its position.** Any other key is
  looked up in the entries, so order never changes the result, only the cost.
  The position doesn't resync: after an absent optional key, every later key
  is looked up.
- **A copy has the schema's keys, in the schema's order.** They are read
  through the prototype and written as own keys. A key the input lacks stays
  out, and one that is `undefined` stays in.
- **A copy reads its unchanged keys a second time**, and finding a key to
  drop means enumerating the input's keys. That is what a key to drop, or a
  change late in a wide object, costs over building every output.

`loose_object` has a loop of its own, which copies the schema's keys by the
same rule and never looks at the input's keys unless it made a copy:

- **A copy then takes the unknown keys**: the input's own enumerable string
  keys the schema doesn't name, in the input's order, after the schema's.
  So the three copy the schema's keys alike, and a loose copy is a stripped
  one with the unknown keys after it.
- **Of the unknown keys, a symbol key, an inherited key, and a non-enumerable
  key are left out**, and so is a `__proto__` key, which would set the
  prototype if assigned. The input returned as it is keeps them all.
- **The loop is not the shared one**, though it repeats it. A bundle without
  `loose_object` carries none of this, and a parse of one loose schema, where
  the engine inlines the loop and removes the context, measured slower on
  valid input when the loop was a call to the shared one.
- **Every key of a copy is a keyed write.** A change in a wide loose object
  costs in proportion to its width, and more than a spread of it would.

### Missing keys

A key the input lacks reads as `undefined`, and its entry decides. The loops
don't look for the key: they hand the entry the object and the key, which is
all a missing key costs an object that has no schema asking.

- **A schema that refuses `undefined` refuses a missing key**, with its own
  issue, the one it reports for `undefined`.
- **`optional` and `with_default` accept one**, and so make a key optional.
- **`unknown` accepts `undefined` and needs its key.** When its value is
  `undefined` and it was handed an object, it looks for the key with `in`,
  so an inherited or non-enumerable key is there, and fails as a
  `missing_key` without it. `{}` doesn't match `object({a: unknown})` and
  `{a: undefined}` does.
- **It is handed the object wherever the entry reaches it**: as the entry
  itself, through `flavor`, `brand`, and `meta`, which keep its `run`, and
  through `message`, `nullable`, `lazy`, an option of a `union`, and the first
  schema of a `pipe`, which pass the object on. So `nullable(unknown)`,
  `lazy(() => unknown)`, and `pipe(unknown, ...)` fail a missing key as a
  `missing_key`, and the pipe runs no step after it.
- **An `optional` or a `with_default` on the way takes the `undefined`
  first**, so `nullable(optional(unknown))` lets its key be missing.
- **A `union` hands the object to every option**, and a missing key matches
  the first that lets its key be missing. With none it fails as it does on any
  value, with its own issue: `union([string, unknown])` without its key
  reports a `union` that received `undefined`, and no `missing_key`.
- **Anywhere else `unknown` is told nothing of a key**, and accepts
  `undefined`: at the top level, as an array's item, as a record's value, and
  as a step of a `pipe` after the first.
- **The other kinds that accept `undefined` don't look for the key**:
  `literal(undefined)`, a `one_of` with `undefined`, and a `check` or a
  `transform` that is the entry itself take a missing key as the `undefined`
  it reads as. Why is [below](#behavior-that-differs-from-valibot-and-zod).
- **The inferred types are narrower than this**: a key is optional in the
  input type only where its entry's `kind` is `optional` or `with_default`,
  and in the output type only where it is `optional`.

## Issues

An issue is `{kind, expected, received, path, message}`, built in one place,
`fail`, so every issue has one hidden class. `format_issue` derives text and
is only bundled when used. There is no message registry.

- **An issue holds no value.** `received` is the type of the value that
  failed: `'null'`, `'array'`, or its `typeof`. Nothing reachable from a
  result or a `SchemaError` is the input or part of it, so issues can be
  serialized and kept. `fail` is passed the value and names its type.
- **`path` is the input's.** An unknown key and a `record` key are whatever
  the input named them. An `unknown_key` issue's last path element is the key.
- **`path` is each issue's own array**, shared with no other issue. While the
  parse unwinds it is replaced, not changed, so a `message` function that
  keeps the `path` it was handed keeps an empty array.
- **A `missing_key` issue is the `unknown`'s**, where an `unknown_key` is
  the object's. It is `{kind: 'missing_key', expected: 'a required key',
  received: 'undefined'}` with the key as its last path element, at the
  entry's place in the order. So a `message` around the `unknown`, or around
  a `nullable`, a `lazy`, or a `pipe` that reaches it, labels it, and one
  around the object doesn't, as it labels only what has no path. A `union`
  reports its own issue in its place.
- **`format_issue` quotes a key that isn't only word characters**, as JSON.
  A key with a `.` can't read as two keys, and one with a newline can't add
  a line to a `SchemaError`'s message, which is one issue per line.
  Text set by `message` is not escaped.
- **`to_standard_schema` writes the same text without the path**, which is
  its own field there, and so doesn't reach the path formatting.

`message(schema, text)` wraps a schema and labels the issues that schema
itself reports. It copies `kind` and `def`, so it's invisible to introspection.
A function given as the text is called with the issue and the value the
wrapped schema's `run` was given: around an action, the output of the steps
before it, and around a whole `pipe`, the pipe's input.

`get_issue_value(issue, input)` recovers the value by following `issue.path`
through the input, and refuses instead of guessing:

- It stops at anything that isn't an object or array.
- It reads own keys only. The object schemas read through the prototype, so
  where one read an inherited value that isn't `undefined` the types differ
  and it refuses. A missing key reads as `undefined`, as it did to the schema.
- It checks that the type of what it found is `issue.received`.
- **It can't see a change that kept the type.** After a `transform`, or a
  container in a `pipe` that applied a default or dropped a key, the issue
  is about the new value and the walk returns the input's.

## Nominal types

`flavor` and `brand` change only the output type and return the schema object
itself. They add no wrapper and no second shape, so `kind` and `def` are the
wrapped schema's and nothing is stored at runtime.

## Metadata

`meta(schema, data)` is in `src/lib/meta.ts`, a module of its own that holds a
`WeakMap` from schema object to metadata. A fourth field would give schemas a
second hidden class and put bytes in every bundle. A registry costs a bundle
nothing until it imports the module.

- **`meta` copies the schema.** One with no options is a shared constant, so
  the copy, not the original, is what gets registered. The copy is
  `{kind, def, run}` in that order, with the original's values.
- **Metadata belongs to one object.** `flavor` and `brand` return that object.
  `message`, the wrappers, and the containers build a new one, which has none.
  A wrapper holds its schema as `def.schema`, so a walk reaches it.
- **Attaching again merges**, key by key, onto a new copy.
- **`SchemaMeta` is an interface**, with `description`, that consumers extend
  by declaration merging. The library names no application's keys.
- The registry holds its keys weakly: metadata lives as long as its schema.

## Costs are opt-in

A feature not every consumer needs is a separate export or module the core
never reaches: `message`, `format_issue`, `get_issue_value`, `meta`,
`to_standard_schema`. Factories are marked `// @__NO_SIDE_EFFECTS__` so an
unused definition is dropped.

`to_standard_schema` is an adapter for this reason: schemas don't each carry
a `~standard` property. Whether they should, natively, is undecided.

## Behavior that differs from Valibot and Zod

Where Zod 4 and Valibot 1 agree on what a schema does with an input, this
library does the same, unless the difference is one of these. The rule is
held by `src/test/schema.conformance.test.ts`: it runs a matrix of schemas
and inputs through the three and fails on a difference that its table doesn't
declare, and on a declared one that is no longer there. Where the two
disagree, the table records which this library goes with. This list is that
table in words.

Each entry that has a reason on record says it, as one of three:

- **by design**: what this library does is judged the better behavior, for
  what it buys
- **cost declined**: conforming would cost bytes or time, and where
- **not guarded**: the schema is a malformed one, which is not paid for

What the test compares is the verdict, the output, and the paths of the
issues. These it holds:

- Output is copy-on-write, where both always copy. By design: a value that
  matches and that nothing changes comes back as it is, so its parse
  allocates nothing. What an input that comes back keeps, and what a copy is,
  are under [Copy-on-write output](#copy-on-write-output). The rows of it:
  - a key read through the prototype, which stays inherited
  - an enumerable key a `record` input inherits, which is still read through it
  - an own `__proto__` key, of a `loose_object` input and of an entry named so
  - an array's holes, and its own keys that are not items
  - an array copy's hole before the first item that changed, and its subclass:
    the copy is one `slice` of the whole length, where building it an item at
    a time regrows it
- `record` validates the value of an own `__proto__` key, and fails where it
  is refused, where both drop the key unread and pass. By design: every own
  key's value is validated, which is the stricter answer, and is what the
  Rust crate does.
- Valibot and Zod need the key of every entry that isn't optional. Here a key
  is needed by an entry that refuses `undefined`, and by one that reaches an
  `unknown`, see [Missing keys](#missing-keys). For the other entries that
  accept `undefined` a missing key is the `undefined` it reads as:
  - `literal(undefined)`, and a `one_of` with `undefined` among its values,
    as the entry and where another schema holds one: under a `nullable`, a
    `lazy`, or a `message`, as an option of a `union`, at the start of a
    `pipe`, or as the discriminator of a `variant` option, which an input
    without the key then selects
  - a `check` that is the entry itself, or that another schema holds in one
    of those places

  Cost declined: looking for the key takes a `run` of four parameters, on
  kinds whose `run` is called with two nearly everywhere, which measured
  slower on valid input.

Where the two disagree, this library goes with:

- **Zod on an optional key under another schema.** An `optional` or a
  `with_default` under a `nullable`, a `lazy`, or a `union` lets the key be
  missing, as in Zod and not in Valibot. One at the start of a `pipe` does
  too, as in both, and the steps after it run on the `undefined`, as in Zod,
  where Valibot leaves the key out. A `transform` that is the entry itself
  lets the key be missing too, as Zod's does. By design: a missing key is the
  `undefined` it reads as to every schema but an `unknown`, so the object
  schemas look for no key to reach a verdict.
- **Valibot on a default under an `optional`.** `optional(with_default(...))`
  leaves `undefined` and a missing key as they are, where Zod fills the
  default in. And a `with_default` whose value is `undefined` leaves a
  missing key out, where Zod writes it.
- **Valibot on an unknown key the input inherits**, in a `loose_object` copy:
  Zod copies an enumerable one and Valibot doesn't, and here it is left out.
  The copy otherwise has the keys Valibot's and Zod's loose objects give, in
  their order.
- **Neither on that key in a `loose_object` input that comes back.** It is
  still read through the input, which Valibot's copy doesn't allow, and is
  not an own key, as it is in Zod's. By design: the input comes back with its
  unknown keys never looked at, which is what makes `loose_object` the
  cheapest of the three.
- **Zod on an unknown key named `constructor` or `prototype`**, in a
  `loose_object`: Valibot drops it and Zod keeps it, and here it is kept. By
  design: a loose object keeps its unknown keys, and leaves out only
  `__proto__`, the one whose assignment would set the prototype.
- **Valibot on an entry named `__proto__`.** Zod leaves it out of the output
  and reads nothing for it. Valibot and this library read and write it as any
  other key, so it sees `Object.prototype` when the input lacks the key, and
  writing it sets the output's prototype. Not guarded.
- **Zod on an array.** Valibot's object, record, and variant schemas take an
  array as an object. Zod's refuse it, as these do. By design: an array is
  not an object.
- **Valibot on what a `record` is given.** Zod refuses a class instance and
  a symbol key. Valibot takes both, as this library does, and leaves the
  symbol key out of its copy.
- **Valibot on numbers.** `number` takes the infinities and `integer` takes
  an integer past the safe ones, where Zod's refuse both.

These the test doesn't see, as they are in the count of the issues, in the
API, or in the names:

- `pipe` stops at its first failing step. By design: an action assumes the
  type the steps before it gave its value.
- A failed `union` reports one issue, not its options'. By design: options
  are only probed, so one that fails builds no issue and allocates nothing.
- An unknown key is one issue each, at the key. Zod reports every unknown
  key of an object in one issue at the object, and Valibot the first alone.
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  Dropping is `strip_object`, and keeping is `loose_object`. The test
  compares each with the other libraries' schema that does the same. By
  design: rejecting is the safe default, so it has the default name.
- `variant` dispatches by map; its options need a `literal` discriminator.
  What it does with an input is in the matrix, and is what both do but for
  an array, and for an option whose discriminator is `literal(undefined)`.
  By design: the option is found in constant time.
- `parse` returns a result and does not throw; the throwing form is `parse_or_throw`.
  Code ported from Valibot or Zod that calls `parse` expecting a throw will get a result
  object instead, which TypeScript catches in typed code and nothing catches in untyped code.
