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
- **The engine is asked.** `src/test/schema.shape.test.ts` builds one of
  every schema the library makes, runs each, and then reads from V8, in a
  process under `--allow-natives-syntax`, that they share one map and that
  none of its fields was written to. Neither shows in what a parse returns,
  or in a grade, whose two versions share a process.

## What `def` holds

`kind` and `def` describe a schema as data. The `SchemaDefs` interface maps
every kind to the type of its `def`, and `SchemaNode` is the union of
`{kind, def}` pairs derived from it, so checking `kind` narrows `def`.
`SchemaKind` and `SchemaDef` are the keys and the lookup. The schemas inside a
`def` are typed as `SchemaNode` too, so a walk needs no cast.

| `def` | Kinds |
|---|---|
| `undefined` | `string`, `number`, `boolean`, `bigint`, `unknown`, `integer`, `safe_integer` |
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
  array again a level. It measured faster at every depth tried. The other
  ways to build a path are in [declined.md](declined.md#issue-paths).
- **Probe mode** (`ctx.probe`): `fail` only counts, and containers return at
  their first failed child. `union` probes its options; `is` runs entirely in it.
- **`ctx.issues` is `undefined` until the first failure** outside probe mode,
  so a parse that finds nothing allocates no array for them. The first issue
  is written as the array's one element, where a push onto an empty array
  would grow it to hold many. From then on
  `ctx.fails === ctx.issues.length` outside probe mode, and containers use
  the count as an index into `issues`.
- **An entry's `run` gets three more arguments**: the object schemas call
  `run(value, ctx, parent, key, 1)`, with the object being read, the entry's
  key, and `1`, which says the schema is the entry itself. All three are
  optional in `Schema.run`'s type, so a `run` of two parameters is an entry
  like any other. `unknown` reads the object and the key, and so do
  `literal(undefined)` and a `one_of` with `undefined` among its values. The
  `1` is read by a `pipe` that starts with an `optional` alone, and passed on
  by `message` alone, see [Missing keys](#missing-keys).
- **`nullable`, `union`, `pipe`, and `message` pass them on to a `run` that
  takes them**, which each tells once, when it is made, by the `length` of
  that `run` or by the kind `'lazy'`, one function asking it for all: `nullable` and `message` by the schema
  they hold, `union` by any of its options, and `pipe` by its first schema,
  the only step it hands them to. So a schema that reads the object and the key declares them as
  plain parameters, with no default and not as a rest. Around anything else
  each has a `run` of two parameters and calls with two, as `optional`,
  `with_default`, `array`, `record`, and `variant` always do. `message` passes
  the `1` on with them, as what it holds is the entry wherever it is, and the
  other three don't. A `pipe` that starts with an `optional` is the exception,
  below.
- **`literal` and `one_of` are two closures too**, chosen when the schema is
  made by whether `undefined` is what it matches. The one that is reads the
  object and the key, and has four parameters. Every other literal and
  `one_of` has the `run` of two it would have without it, so what looking for
  the key costs them is bytes, in the bundles that have the kind.
- **Each of the four is two closures** that differ only in what they pass on.
  One `run` of four parameters is fewer bytes, and measured slower on valid
  input for `union`, for `pipe`, and for a `message` around every schema: it
  hands two arguments to a `run` that doesn't take them. So what passing them
  on costs is bytes, in the bundles that have the kind. See
  [declined.md](declined.md#passing-the-object-and-the-key-on).
- **A `pipe` has a third closure**, for one that starts with an `optional`,
  through every pipe it starts with: it reads the kind of that schema when it
  is made. This closure looks for the key when it is handed the `1`, see
  [Missing keys](#missing-keys), so it has five parameters though an
  `optional` takes two. Past that it runs the steps as the closure of two
  does, which it shares, so a pipe it starts with is handed neither the object
  nor the key. The call costs the path with the key there, and a loop of its
  own was over the size ceiling rule 5 had then, see
  [declined.md](declined.md#a-pipe-that-starts-with-an-optional-with-a-loop-of-its-own). The closure that passes them on to an `unknown` or a `lazy`
  looks for no key: the forms that had one closure for both are in
  [declined.md](declined.md#a-pipe-that-looks-for-the-key-wherever-it-has-the-object).
- **A `lazy` passes on the object and the key it is given**, which it tells
  on each call by the length of its `arguments`, and not the `1`: what it
  defers to is not the entry itself. Its schema isn't known
  when it is made, so it can't choose a closure then, and a `run` of four
  parameters costs every caller that passes two. So its `run` declares two,
  and the four tell a lazy by its `kind` where its `length` can't say: around
  one they pass the object and the key on, whatever it defers to. Until the
  engine's last tier has the call, its `arguments` is an object a call, which
  a parse of settled code doesn't allocate. The other forms of a lazy are
  in [declined.md](declined.md#lazy).

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
- **`literal(undefined)` and a `one_of` with `undefined` need their key the
  same way**, and fail as the same `missing_key` without it: `{}` doesn't
  match `object({a: literal(undefined)})` and `{a: undefined}` does. The three
  are the schemas that need a key, and what follows of `unknown` holds for
  each. A `one_of` reads whether `undefined` is among its values once, when it
  is made.
- **It is handed the object wherever the entry reaches it**: as the entry
  itself, through `flavor`, `brand`, and `meta`, which keep its `run`, and
  through `message`, `nullable`, `lazy`, an option of a `union`, and the first
  schema of a `pipe`, which pass the object on. So `nullable(unknown)`,
  `lazy(() => unknown)`, and `pipe(unknown, ...)` fail a missing key as a
  `missing_key`, and the pipe runs no step after it.
- **A `variant` finds its option by the value at the discriminator**, which a
  missing key reads as `undefined`, so an input without the key selects an
  option whose discriminator is `literal(undefined)`. That option's entry
  then fails it as a `missing_key`, at the discriminator.
- **An `optional` or a `with_default` on the way takes the `undefined`
  first**, so `nullable(optional(unknown))` lets its key be missing.
- **A `pipe` that starts with an `optional` runs no step for a missing
  key**, as the entry itself, and the key stays out of the output. `{}`
  matches `object({a: pipe(optional(string), check(...))})` whatever the
  check says, and a `transform` there writes no key. With the key there every
  step runs, on `undefined` too.
- **It starts with an `optional` by that schema's kind**, which `message`,
  `flavor`, `brand`, and `meta` keep, and through every pipe it starts with:
  `pipe(pipe(optional(string), a), b)` runs neither `a` nor `b`. It looks for
  the key where it is handed the `1`: as the entry itself, and under a
  `message`, which passes the `1` on. A key that isn't in the object is
  missing, and its value is then `undefined`.
- **Under a `nullable`, a `lazy`, or a `union` its steps run**, on the
  `undefined` a missing key reads as. Those hand it the object and the key,
  and not the `1`: it is then a step of the schema that is the entry, and
  does what it does there.
- **After any other first schema the steps run**, on the `undefined` a
  missing key reads as: after a `nullable`, a `lazy`, or a `union` that
  reaches an `optional`, after a `with_default` whose value is `undefined`,
  and after a `check` or a `transform`. After any other `with_default` they
  run on its value.
- **A missing key whose entry gives `undefined` stays out of the output**,
  whatever gave it: a `pipe` that starts with a `with_default` and whose
  steps make `undefined` of the default writes no key, where Zod and Valibot
  write it, see [below](#behavior-that-differs-from-valibot-and-zod).
- **A `union` hands the object to every option**, and a missing key matches
  only where an option lets its key be missing. With none it fails as it does
  on any value, with its own issue: `union([string, unknown])` without its key
  reports a `union` that received `undefined`, and no `missing_key`.
- **The first option that matches is the union's**, and a missing key it
  leaves `undefined`, as an `optional` does, stays out:
  `union([unknown, optional(string)])` accepts a missing key with the
  `optional`, and no option is tried again.
- **An option that fills a missing key in makes it optional**, when the
  first that matches gives anything but `undefined`, as a `with_default`
  does, and the key is then the `undefined` it reads as to every option
  before it. So those before it that take the object and the key, which are
  the only ones that can have failed for the key, are run again without
  them, and the first of them that matches is the union's.
  `union([unknown, with_default(string, 'D')])` matches a missing key with
  the `unknown` and fills no default in, and leaves the key out, where Zod
  writes it: a missing key whose entry gives `undefined` stays out.
- **An option is run a second time only there**: one that takes the object
  and the key runs twice in one parse, and a `transform` in it that the
  first run reached with it, once more for each enclosing union that tries
  it again, which only a `transform` or a `check` with a side effect can
  tell. One that doesn't take the object, and the option that matched, are
  run once.
- **Anywhere else `unknown` is told nothing of a key**, and accepts
  `undefined`: at the top level, as an array's item, as a record's value, and
  as a step of a `pipe` after the first.
- **The other kinds that accept `undefined` don't look for the key**: a
  `check` or a `transform` that is the entry itself takes a missing key as
  the `undefined` it reads as. Why is
  [below](#behavior-that-differs-from-valibot-and-zod).
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
- **A number `number` refuses reads as any other value it refuses**: `NaN`
  and the infinities are `{kind: 'number', expected: 'number', received:
  'number'}`, as `received` is the value's `typeof`, and `format_issue`
  writes `expected number, received number`.
- **`path` is the input's.** An unknown key and a `record` key are whatever
  the input named them. An `unknown_key` issue's last path element is the key.
- **`path` is each issue's own array**, shared with no other issue. While the
  parse unwinds it is replaced, not changed, so a `message` function that
  keeps the `path` it was handed keeps an empty array.
- **A `missing_key` issue is the entry's**, where an `unknown_key` is the
  object's: it is reported by the `unknown`, the `literal(undefined)`, or the
  `one_of` that needs the key. It is `{kind: 'missing_key', expected: 'a
  required key', received: 'undefined'}` with the key as its last path
  element, at the entry's place in the order. So a `message` around that
  schema, or around a `nullable`, a `lazy`, or a `pipe` that reaches it,
  labels it, and one around the object doesn't, as it labels only what has no
  path. A `union` reports its own issue in its place.
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

- **`Flavored` and `Branded` leave `null` and `undefined` unmarked.** The
  marker is an intersection with an object type, which `null` and `undefined`
  don't survive, so each is a member of the result as it was:
  `flavor(nullable(string), 'N')` is the flavored string or `null`, the type
  `nullable(flavor(string, 'N'))` has. A plain `null` is therefore assignable
  to a branded type that has one.
- **Every other type is marked as an intersection**, `TValue & Flavor<TName>`,
  and prints by the name `Flavored` or `Branded`.
- **Of a type parameter neither is known to lack `null` and `undefined`**, as
  `Extract` waits for the parameter. `Branded<T, 'N'>` with `T extends string`
  doesn't assign to `Branded<string, 'N'>`, one with an unconstrained `T` is
  possibly `null`, and two flavors of one constrained `T` assign to each
  other, where two brands don't.

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
a `~standard` property.

What was built and measured against this, and against the rest of this page,
and not taken is in [declined.md](declined.md): each trade with what it gave,
what it cost, and what would reopen it.

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
  `unknown`, a `literal(undefined)`, or a `one_of` with `undefined` among its
  values, see [Missing keys](#missing-keys). For the one other entry that
  accepts `undefined` a missing key is the `undefined` it reads as: a `check`
  that is the entry itself, or that another schema holds in one of those
  places, under a `nullable`, a `lazy`, or a `message`, as an option of a
  `union`, or at the start of a `pipe`.

  Cost declined: looking for the key takes a `run` of four parameters, on a
  kind whose `run` is called with two nearly everywhere, which measured
  slower on valid input for `literal` and for `lazy`, see
  [declined.md](declined.md#passing-the-object-and-the-key-on). A `check`
  can't choose its closure when it is made, as a `literal` does: what its
  function accepts isn't known until it is called.
- a `pipe` that starts with a `with_default` and whose steps give `undefined`
  leaves a missing key out, where both write the key as `undefined`: as the
  entry itself, under a `message`, and as the first schema of another pipe.

  Cost declined: the object loops leave out a missing key whose entry gives
  `undefined`, and telling them that this one is written took bytes in the
  loop every object schema's bundle carries, or a loop swapped in when such
  a pipe is made, which slowed every object parse of the program, see
  [declined.md](declined.md#a-default-whose-steps-give-undefined-written-for-a-missing-key).

Where the two disagree, this library goes with:

- **Zod on an optional key under another schema.** An `optional` or a
  `with_default` under a `nullable`, a `lazy`, or a `union` lets the key be
  missing, as in Zod and not in Valibot. A `transform` that is the entry
  itself lets the key be missing too, as Zod's does. By design: a missing key
  is the `undefined` it reads as to every schema but the three that need
  their key, so the object schemas look for no key to reach a verdict.
  Where a `pipe` that starts with a `with_default` under one of them gives
  `undefined`, the key stays out, where Zod writes it.
- **Zod or neither on the options of a `union` before one that fills the key
  in.** Where the option that matches a missing key gives a value, as a
  `with_default` does, an option before it that needs its key is tried on the
  `undefined`, as in Zod, where Valibot needs the key: what it gives is kept,
  as in Zod. Where that is `undefined` the key is left out, where Zod writes
  it. Where the option that matches leaves the key `undefined`, as an
  `optional` does, none is tried again and the key stays out, as in Zod
  where no option fills the key in and nothing follows the union: Zod tries
  the options before on the `undefined` when any option is a `with_default`,
  or when a `transform` follows the union, and keeps what they give, where
  this library leaves the key out. A union that fills the key in, inside
  another, gives that one `undefined` when an option before its default
  matches, and the outer tries none again, unlike the same options in one
  union. By design: the key is optional, and a key the input lacks is left
  out unless what the entry gives fills it in.
- **Valibot on the steps after an `optional`.** A `pipe` that starts with an
  `optional` lets the key be missing, as in both, and a step that fails then
  is not reported, as in both where no step is a `transform`. As the entry
  itself and under a `message` it runs no step and leaves the key out, as
  Valibot does, where Zod runs them on the `undefined`, keeps what a
  `transform` gives, and reports a step that fails beside one. By design: a
  key the input lacks is left out, and `with_default` is what fills one in.
- **Zod or Valibot on the steps after another schema that let the key
  through.** After a `nullable`, a `lazy`, or a `union` that reaches an
  `optional`, the steps run on the `undefined`: what a `transform` gives is
  kept, as in Zod, and a step that fails is reported, where Zod drops it and
  Valibot refuses the missing key. After a `with_default` whose value is
  `undefined` they run too, as in Zod, where Valibot leaves the key out.
- **Zod or Valibot on a `pipe` that starts with an `optional` under a
  `nullable`, a `lazy`, or a `union`.** Its steps run on the `undefined`, as
  they do after one of those: what a `transform` gives is kept, as in Zod,
  and a step that fails is reported, as Valibot refuses the key under each of
  those, where Zod drops it. As an option of a `union` beside an `optional`,
  what a `transform` gives is kept where Zod leaves the key out, which goes
  with neither. By design: those three hand it the object and the key and not
  the `1`, so it is a step of the schema that is the entry.
- **Zod on the entries of a `variant` option whose discriminator is missing.**
  An option whose discriminator is `literal(undefined)` is selected by an
  input without the key, and refused for it by both. Its other entries run
  too, as in Zod, where Valibot stops at the discriminator.
- **Valibot on a default under an `optional`.** `optional(with_default(...))`
  leaves `undefined` and a missing key as they are, where Zod fills the
  default in. And a `with_default` whose value is `undefined` leaves a
  missing key out, where Zod writes it. By design: wrappers compose in the
  order written, the outer `optional` answering `undefined` before the
  default inside it is asked.
- **Valibot on an unknown key the input inherits**, in a `loose_object` copy:
  Zod copies an enumerable one and Valibot doesn't, and here it is left out.
  The copy otherwise has the keys Valibot's and Zod's loose objects give, in
  their order. By design: of the keys the schema doesn't name a copy takes
  the input's own, so no unknown key on a prototype becomes an own key of the
  output.
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
  symbol key out of its copy. By design, for consistency with the object
  schemas, which take any object that isn't an array, as Zod's own `object`
  does. Refusing would also read the prototype on every parse.
- **Zod on the infinities.** `number` refuses `Infinity` and `-Infinity`, as
  Zod's does, where Valibot's takes them. By design: a JSON text carries one
  through a plain `number` as a number too large for a double, which
  `JSON.parse` reads `1e999` as, and `JSON.stringify` writes it back as
  `null`. A `literal` or a `one_of` of an infinity still matches it, as in
  both, and a bound may be one.
- **Valibot on an integer past the safe ones.** `integer` takes one, where
  Zod's refuses it. By design: it is an integer, and `safe_integer` is the
  opt-in for the stricter claim.

These the test doesn't see, as they are in the count of the issues, in the
API, or in the names:

- `pipe` stops at its first failing step. By design: an action assumes the
  type the steps before it gave its value.
- A failed `union` reports one issue, not its options'. By design: options
  are only probed, so one that fails builds no issue and allocates nothing.
- An unknown key is one issue each, at the key. Zod reports every unknown
  key of an object in one issue at the object, and Valibot the first alone.
  By design: every issue is the same five fields with a path to what is
  wrong, where one issue for all of them needs a list of keys on the issue,
  and reporting the first hides the rest.
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  Dropping is `strip_object`, and keeping is `loose_object`. The test
  compares each with the other libraries' schema that does the same. By
  design: rejecting is the safe default, so it has the default name.
- `variant` dispatches by map; its options need a `literal` discriminator.
  What it does with an input is in the matrix, and is what both do but for
  an array.
  By design: the option is found in constant time.
- `parse` returns a result and does not throw; the throwing form is `parse_or_throw`.
  Code ported from Valibot or Zod that calls `parse` expecting a throw will get a result
  object instead, which TypeScript catches in typed code and nothing catches in untyped code.
