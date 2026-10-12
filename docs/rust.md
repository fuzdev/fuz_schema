# The Rust side

`crates/fuz_schema` holds the library's schema model in Rust and answers one
question of it: does this JSON text match? The TypeScript library is the
reference for the answer. It validates what `JSON.parse` returns, so the
semantics are JavaScript's.

Loading a schema made in TypeScript, issues, output, and a wasm build are not
built.

## The model

A `Schema` is an arena of `Node`s and the id of the one validation starts at.

- **One `Node` variant per kind** of the `SchemaDefs` contract that can be
  carried across, which is all but `regex`, `check`, and `transform`. A
  node holds what the kind's `def` holds, with schemas as `NodeId`s.
- **`lazy` is a node**, holding the id it defers to. It is where a schema
  comes back to itself, so the arena has no cycle of ownership, and a `Schema`
  is `Send + Sync`.
- **Entries are in JavaScript's key order**: array indices first, ascending,
  then the order given. That is the order the TypeScript library runs them in.
- **Numbers are `f64`**, lengths and bounds included.
- **`bigint` is a kind** that no JSON value matches.

A schema is made with `SchemaBuilder`, which adds a node per call and checks
nothing until `build`.

## Two evaluators

| | `is_json`, `is_json_bytes` | `is_json_exact` |
|---|---|---|
| Reads | as it parses, with no tree | the whole text into a `Json`, then walks it |
| Stops | at the first failure | at the end of the text |
| Against the TypeScript library | never looser, sometimes stricter | the same verdict |

- **`walk.rs` is the reference**, a port of the `run` functions over the
  crate's own tree. `Json` holds an object as `JSON.parse` would: a key
  written twice has its last value at its first position, and index keys come
  first.
- **`stream.rs` is a serde visitor per node.** A scalar is handed to the
  walker, so the two read every kind one way. Arrays and objects are matched
  as their items and keys arrive.
- **A `union` knows which options could match an array, and which an
  object**, from when it was built: an option could when its kind could,
  looking through wrappers, `lazy`, and the first schema of a `pipe`. With
  one such option the array or object is matched against it as it arrives.
  With none it fails unread.
- **Two shapes are read into a tree first** and walked: an array or object
  that more than one option of a `union` could match, and a `variant` whose
  discriminator is not the first key.
- **A value the schema accepts whatever it is, is skipped**: one under
  `unknown`, or at a key a `loose_object` or `strip_object` has no entry for.
- **`js.rs` holds the JavaScript semantics** both share: a string's length in
  UTF-16 code units, the integer tests on the value and not the token, `===`
  on doubles, and key order.
- **`is_json_bytes` validates UTF-8 first**, in full, then reads the text.
- The walker reports failures to a `Report`. `Probe` wants only the verdict.
  A report that collects is what issues will be built on.

## Where it differs from the library

Against `JSON.parse` followed by `is`:

| The text | `is_json` | `is_json_exact` |
|---|---|---|
| a key is written twice, and the last value makes it match | `false`: every occurrence is checked | as the library |
| stops matching, then stops being JSON | `false`: nothing after a failure is read | an error, as the library throws |
| a number past a double, which JavaScript reads as an infinity | an error | an error |
| a `\u` escape of half a surrogate pair, which JavaScript keeps | an error | an error |
| nested deeper than the parser goes | an error | an error |
| the last three, in a value that is skipped or follows the first failure | as the library | an error |

The three errors have their own `JsonErrorKind`. They come from serde_json,
which the crate parses with, and so does the depth: nesting is read to
`MAX_DEPTH`, one level short of serde_json's recursion limit. A `JsonError`
is of the first problem the parser meets and says nothing of what follows, so
`1e400x` is a `NumberOutOfRange` though `JSON.parse` throws on it.

The crate reads numbers as serde_json hands them over by default. Its
`arbitrary_precision` feature, which any crate of a build turns on for all of
them, hands them over as maps, so `SchemaBuilder::build` checks the parser
once and makes no schema under it.

## What is refused

A schema whose meaning comes from JavaScript itself is refused by `build`,
with a `SchemaError` holding the reason and a JSON Pointer to it from the
root. Nothing is guessed at.

| Refused | `SchemaErrorKind` |
|---|---|
| a literal or bound that isn't finite | `NonFiniteNumber` |
| an entry named like a member of `Object.prototype`, which the library reads through the prototype | `PrototypeKey` |
| a `pipe` that is empty, or starts with a schema that doesn't fix its value's type | `EmptyPipe`, `PipeHead` |
| a step after a pipe's first that isn't an action, or is for another type | `PipeStep`, `ActionMismatch` |
| a length or bound outside a `pipe`, where the library coerces or throws | `ActionOutsidePipe` |
| a `variant` option that isn't an object schema, or has no `literal` at the key | `VariantOption`, `VariantDiscriminator` |
| what only a builder can be given: an entry twice, a `lazy` never defined or defined twice, an id that isn't its own | `DuplicateKey`, `UndefinedLazy`, `RedefinedLazy`, `InvalidNode` |
| a schema that comes back to itself without reading into the value | `UnguardedRecursion` |
| more than `MAX_NESTING` wrappers, lazies, unions, and pipes around one value | `TooNested` |
| any schema, in a build with serde_json's `arbitrary_precision` on | `ArbitraryPrecision` |

The model has no `regex`, `check`, or `transform`, and no `undefined` or
bigint literal.

A pipe's first schema fixes the type when it is `string`, `number`, `array`,
one of the number tests, or a pipe of one of those. The number tests
(`integer`, `safe_integer`, `finite`) answer for any value, so they also
stand alone.

`MAX_NESTING` bounds how far the evaluators recurse per level of the input,
and with `MAX_DEPTH` how far they recurse in all. A test runs the deepest
input under the most nesting on a small stack. Neither bounds the work: a
`union` whose options each come back to it tries every option at every
level, which can take time exponential in the depth of the input, as it does
in the TypeScript library.
