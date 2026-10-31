# The Rust side

`crates/fuz_schema` holds the library's schema model in Rust and answers two
questions of it: does this JSON text match, and if not, what are its issues?
The TypeScript library is the reference for both answers. It validates what
`JSON.parse` returns, so the semantics are JavaScript's.

Output is not built. `crates/fuz_schema_wasm` is the crate compiled to wasm,
[below](#the-wasm-build), and answers only the first question.

## The model

A `Schema` is an arena of `SchemaNode`s and the id of the one validation starts
at.

- **One `SchemaNode` variant per kind** of the `SchemaDefs` contract that can be
  carried across, which is all but `regex`, `check`, `transform`,
  `with_default_fn`, and `object_with_rest`, the last not carried yet. A
  node holds what the kind's `def` holds, with schemas as `NodeId`s.
- **`lazy` is a node**, holding the id it defers to. It is where a schema
  comes back to itself, so the arena has no cycle of ownership, and a `Schema`
  is `Send + Sync`.
- **Entries are in JavaScript's key order**: array indices first, ascending,
  then the order given. That is the order the TypeScript library runs them in.
- **An `unknown` needs the key of the entry that reaches it**, as in the
  library: as the entry itself, and under a `nullable`, a `lazy`, or a
  `union`, which hand it the object there. JSON has no `undefined`, so a key
  is there or it isn't, and the `undefined` the evaluators hold is a missing
  key and nothing else: an `unknown` given one refuses it. Every other schema
  is given a missing key as `undefined`, which an `optional` and a
  `with_default` accept before it reaches what they hold. A `pipe` starts
  with a schema that fixes the type, which refuses `undefined` itself.
- **Numbers are `f64`**, lengths and bounds included. A `number` is a finite
  one, as in the library, and no text hands an evaluator another: JSON has
  no `NaN`, and a number past a double is an error of the parser,
  [below](#declared-divergences).
- **`bigint` is a kind** that no JSON value matches.

A schema is made with `SchemaBuilder`, which adds a node per call and checks
nothing until `build`, or loaded from the interchange form.

## The interchange form

A node is `{"kind": …, "def": …}` with `def` as `SchemaDefs` has it, and left
out where that is `undefined`:

```json
{"kind":"string"}  {"kind":"number"}  {"kind":"boolean"}  {"kind":"bigint"}  {"kind":"unknown"}
{"kind":"integer"}  {"kind":"safe_integer"}
{"kind":"literal","def":"a"}  {"kind":"literal","def":null}
{"kind":"one_of","def":["a",1,null]}
{"kind":"optional","def":{"schema":{"kind":"string"}}}
{"kind":"nullable","def":{"schema":{"kind":"string"}}}
{"kind":"with_default","def":{"schema":{"kind":"number"},"value":0}}
{"kind":"lazy","def":"$0"}
{"kind":"object","def":{"id":{"kind":"number"},"name":{"kind":"string"}}}
{"kind":"loose_object","def":{}}  {"kind":"strip_object","def":{}}
{"kind":"record","def":{"kind":"number"}}
{"kind":"array","def":{"kind":"string"}}
{"kind":"union","def":[{"kind":"string"},{"kind":"number"}]}
{"kind":"variant","def":{"key":"kind","options":[{"kind":"object","def":{"kind":{"kind":"literal","def":"a"}}}]}}
{"kind":"pipe","def":[{"kind":"string"},{"kind":"min_length","def":1},{"kind":"max_length","def":50}]}
{"kind":"pipe","def":[{"kind":"number"},{"kind":"min_value","def":0},{"kind":"max_value","def":150}]}
```

A `lazy` holds a function in TypeScript, so here its `def` is a name, and the
document is an envelope that says what the names stand for:

```json
{
	"schema": { "kind": "lazy", "def": "$0" },
	"defs": {
		"$0": {
			"kind": "object",
			"def": { "children": { "kind": "array", "def": { "kind": "lazy", "def": "$0" } } }
		}
	}
}
```

- `defs` is left out when there is no `lazy`.
- A `literal` with no `def` is an error, not `null`: no `def` is what
  `undefined` would be.
- A `with_default`'s `value` is any JSON value. It is kept and never validated.
- A key the form doesn't have is an error, and so is a key written twice in
  one object.

`Schema::from_json` loads a document, and `to_schema_json` in
`src/lib/schema_json.ts` writes one from a TypeScript schema. The writer is a
module of its own, which the core never reaches. It throws on everything the
loader refuses, and on what the crate's parser does not read of a document: a string that is not well-formed Unicode, and nesting
past `MAX_DEPTH`. So a schema that serializes loads. It also refuses a schema
more than `MAX_DEPTH` schemas deep counting through every `lazy`, which the
crate would load. It reads a schema by its `kind` and `def` and never its
`run`, so a hand-written schema with one of the library's kinds and a `run` of
its own is written as that kind and behaves as the library's in the crate.

## Two evaluators

| | `matches_json`, `matches_json_bytes` | `matches_json_exact` |
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
- **`matches_json_bytes` validates UTF-8 first**, in full, then reads the text.
- The walker reports failures to a `Report`. `Probe` wants only the verdict,
  and `Collect` keeps each failure as an issue, up to `MAX_ISSUES`.
- **Some unions keep their verdicts.** A `union` keeps its verdicts on arrays
  when two or more of its options could take an array and reach a cycle, which
  only a `lazy` closes, and likewise on objects, unless a `literal` entry at
  one key, with a value of its own in each of those options, runs before any
  entry that reaches a cycle: then at most one gets past it. This is settled
  when the schema is built. The walker keeps a verdict on each array or object
  of the tree, by address, for as long as it walks that tree, and reads it
  back when the union is asked of the value again. `matches_json` gets it
  through the walks of what it reads into a tree, each with a memo of its own,
  as a tree is dropped after its walk and the next can have its addresses. A
  verdict is a function of the node and the value alone, so keeping it changes
  no verdict and no issue: a union never reports what its options found.
  A `memo_union` is written by `to_schema_json` as the `union` it is, and
  loads as one, so which unions keep their verdicts is this rule's, whichever
  of the two the library was given.

## Issues

`validate_json` and `validate_json_bytes` return the issues of a text, and none
when it matches. They parse the whole text and walk the tree, as
`matches_json_exact` does, with the same errors, and the issues are empty
exactly when it is `true`.

The issues are the ones `parse` reports of `JSON.parse` of the same text, in
the same order. A `SchemaIssue` owns what it holds:

| | |
|---|---|
| `kind()` | a `SchemaIssueKind`: the kind of the schema or action that failed, or `UnknownKey` or `MissingKey` |
| `expected()` | the library's text, character for character |
| `received()` | a `Received`: the type of the value, `Undefined` for a missing key. The parser reads no number that isn't finite, so none is the library's `NaN`, `Infinity`, or `-Infinity` |
| `path()` | `PathSegment`s from the root, a `Key` for an object and an `Index` for an array |

- **At most `MAX_ISSUES` of them, a hundred**, the library's cap: past it a
  failure is still a failure and builds no issue, so a text that fails more
  often has its first hundred. `Collect::fail` returns at the cap, and a
  container's prefix from a count taken there reaches no issue.
- **The order is the library's**: an object's entries in its order, then for
  an `object` its unknown keys in the input's, and each container's issues
  before what follows it. A `pipe` stops at its first failed step.
- **A missing key is one issue**, at the key, having received `undefined`:
  the `MissingKey` of an `unknown` the entry reaches, expecting
  `a required key`, the issue of a `union` none of whose options takes it,
  and otherwise the issue of the entry's schema. It is at the entry's place
  in the order.
- **A failed `union` is one issue**, at the union's value, naming its options
  as the library does, each part once by its text: a `union` among them by
  its own options, at any depth, a `pipe` by its first schema, a `nullable`
  by its schema's and then `null`, an `optional` or a `with_default` by its
  schema's, a `literal` or a `one_of` by its values, and any object schema as
  `object`.
- **A `variant` reports at its discriminator** when no option has the value
  there, expecting the options' values, and otherwise leaves the report to
  the option selected.
- **A number in `expected` is written as JavaScript's `String` writes it**,
  and a string as `JSON.stringify` quotes it. Both are in `js.rs`.
- **There is no `message`.** The interchange form holds none, so a schema
  loaded from it reports as one without any.
- **An issue displays as `format_issue` writes it**, without a `message`:
  `path: expected X, received Y`, or `expected X, received Y` at the root,
  a key that isn't only ASCII word characters quoted as `JSON.stringify`
  quotes it.
- **There is no streaming form.** Issues need every failure up to the cap,
  so nothing is skipped, and the walk goes on past it, which costs time
  linear in the input.
- `unknown`, the wrappers, `lazy`, and `pipe` never fail a value, and have no
  `SchemaIssueKind` of their name.

## Declared divergences

Where the crate differs from `JSON.parse` followed by `is`. Each is a flag a
fixture case declares, and the Rust tests assert the declared behavior.

| Flag | The text | `matches_json` | `matches_json_exact` |
|---|---|---|---|
| `duplicate_keys` | a key is written twice, and the last value makes it match | `false`: every occurrence is checked | as the library |
| `malformed_tail` | stops matching, then stops being JSON | `false`: nothing after a failure is read | an error, as the library throws |
| `number_overflow` | a number past a double, which JavaScript reads as an infinity | an error | an error |
| `lone_surrogate` | a `\u` escape of half a surrogate pair, which JavaScript keeps | an error | an error |
| `depth_limit` | nested deeper than the parser goes | an error | an error |
| `number_overflow_unread`, `lone_surrogate_unread`, `depth_limit_unread` | the same three, in a value that is skipped or follows the first failure | as the library | an error |

The three errors have their own `JsonErrorKind`. They come from serde_json,
which the crate parses with, and so does the depth: nesting is read to
`MAX_DEPTH`, one level short of serde_json's recursion limit. A `JsonError`
is of the first problem the parser meets and says nothing of what follows, so
`1e400x` is a `NumberOutOfRange` though `JSON.parse` throws on it.

A number past a double matches no `number` on either side: the library reads
an infinity and refuses it, and the crate answers with the error. The library
takes one where the schema takes any value, as under `unknown`, which is where
the streaming evaluator skips it unread.

The crate reads numbers as serde_json hands them over by default. Its
`arbitrary_precision` feature, which any crate of a build turns on for all of
them, hands them over as maps, so `SchemaBuilder::build` checks the parser
once and makes no schema under it.

## What is refused

A schema whose meaning comes from JavaScript itself is refused when it is built
or loaded, with a `SchemaBuildError` holding the reason and a JSON Pointer to
it in the interchange form. Nothing is guessed at.

| Refused | `SchemaBuildErrorKind` |
|---|---|
| `regex`, `check`, `transform` | `UnsupportedKind` |
| `with_default_fn`, `object_with_rest` until the crate carries it, and a kind that isn't the library's | `UnknownKind` |
| an `undefined` or bigint literal, or one that isn't a scalar | `UnsupportedLiteral` |
| a literal or bound that isn't finite | `NonFiniteNumber` |
| an entry, or the key of a `variant`, named like a member of `Object.prototype`, which the library reads through the prototype | `PrototypeKey` |
| a `pipe` that is empty, or starts with a schema that doesn't fix its value's type | `EmptyPipe`, `PipeHead` |
| a step after a pipe's first that isn't an action, or is for another type | `PipeStep`, `ActionMismatch` |
| a length or bound outside a `pipe`, where the library coerces or throws | `ActionOutsidePipe` |
| a `variant` option that isn't an object schema, or has no `literal` at the key | `VariantOption`, `VariantDiscriminator` |
| a `lazy` naming nothing | `UnresolvedLazy` |
| what only a builder can be given: an entry twice, a `lazy` never defined or defined twice, an id that isn't its own | `DuplicateKey`, `UndefinedLazy`, `RedefinedLazy`, `InvalidNode` |
| a schema that comes back to itself without reading into the value | `UnguardedRecursion` |
| more than `MAX_NESTING` wrappers, lazies, unions, and pipes around one value | `TooNested` |
| a document that isn't JSON, isn't shaped as the form says, or writes a key twice in one object | `Json`, `Malformed`, `UnexpectedKey`, `RepeatedKey` |
| any schema, in a build with serde_json's `arbitrary_precision` on | `ArbitraryPrecision` |

A pipe's first schema fixes the type when it is `string`, `number`, `array`,
one of the number tests, or a pipe of one of those. The number tests
(`integer`, `safe_integer`) answer for any value, so they also stand alone.

`MAX_NESTING` bounds how far the evaluators recurse per level of the input,
and with `MAX_DEPTH` how far they recurse in all. A test runs the deepest
input under the most nesting on a small stack. Neither bounds the work. The
unions that keep their verdicts, [above](#two-evaluators), bound it by the
size of the input times its depth, and a factor of the schema: without them a `union` with two options
that reach a cycle tries each at every level, which takes time exponential
in the depth of the input, as it does in the TypeScript library under a
`union` and not a `memo_union`, see [design.md](design.md#running). The depth is from an option that reads into
another cycle, which walks what is below the value again wherever the union
is asked of it, as in
`L = lazy(() => union([object({x: array(L), t: literal('a')}), M]))` with
`M` another recursive schema. The factor of the schema grows with the
unions that reach no cycle and whose options read the same value: those
keep nothing, and k levels of them can try 2^k ways, with or without a
`lazy`.

## Fixtures

`src/test/fixtures/json/` holds the cases both sides are tested against.

- A group is a directory with an authored `fixture.ts`: a TypeScript schema
  and named JSON texts. They are texts and not values, because how a value
  is written is part of what's tested.
- `gro task src/test/fixtures/json/update.task.ts` generates each group's `expected.json`:
  the schema in the interchange form, and for each text whether `JSON.parse`
  reads it, whether `is` accepts it, the issues `parse` reports with the
  text `format_issue` writes of each, and any declared divergence. It
  asserts `is` and `parse` agree, and that a case declares an overflow, a
  lone surrogate, or the depth limit exactly when the value read has one.
  The file is never edited by hand.
- It also generates `contract.json`, the constants both sides hold: the
  nesting limit, the parser's depth, the cap on issues, the refused key
  names and kinds, and the flags.
- `src/test/json.fixtures.test.ts` fails when a generated file is stale.
- `crates/fuz_schema/tests/fixtures.rs` loads every group and asserts both
  evaluators against the oracle or the declared divergence, and the issues
  of `validate_json` against the oracle's, each with its `Display`, wherever
  the tree evaluator gives the oracle's verdict. It also fails on an unknown
  flag, a flag no case declares, a kind no fixture schema has, a kind of
  issue or received type no case reports, a path with no key it quotes, too
  few groups or cases, and a constant that differs from `contract.json`. It reads the generated files with serde_json's tree and
  not the crate's.
- The `generated_*` groups are written by `json_generate.ts` from fixed
  seeds: each a random schema the crate carries, drawn from every kind
  `to_schema_json` writes, and texts aimed at it, near and wrong, with edge
  numbers, escaped Unicode, missing, extra, and repeated keys, deep nesting,
  and texts cut short or with something after them. A text is kept only
  where what the crate does is known from the library's answer: one deeper
  than the parser reads is dropped, and so is one that matches with a key
  written twice to a different value first. A text cut short is one that
  matches, cut after a `[`, `{`, `,`, or `:`. One with something after a
  whole value declares `malformed_tail` when the value doesn't match. No
  text has a number past a double, a lone surrogate, or nesting past the
  parser, so of the flags only `malformed_tail` is declared. A union has
  the recursion in one option at most: two that reach the same `lazy` make
  the library's time exponential in a text's depth.
- `npm run fixtures:deep` runs more of them, outside `gro check` and the repo:
  it writes each group's `expected.json` under `--dir`
  (`~/.cache/fuz_schema/fixtures_deep` by default) and runs
  `tests/fixtures.rs`, which loads the groups of `FUZ_SCHEMA_FIXTURES_DIR`
  beside the committed ones when it is set. It marks the directory with a
  `.fuz_schema_fixtures_deep` file, refuses one that is not empty without
  it, and clears only the groups of an earlier run. It takes `--seed`
  (repeatable, random when left out), `--count` groups a seed, and `--cases`
  a group. It prints each seed before its groups, and a group slow to
  generate. A failure names the group and the case, and the group's
  `expected.json` holds the schema and the text.
- An issue's path is written as the library has it: a key as a string and an
  index as a number.
- A text must be well-formed Unicode, because it is written into a JSON
  file. So must every key in an issue's path.

## The wasm build

`crates/fuz_schema_wasm` compiles the crate to wasm with wasm-bindgen, to
measure it against the library. It isn't published, and the library doesn't
use it.

```bash
npm run build:wasm     # wasm-pack, into target/fuz_schema_wasm
npm run benchmark:wasm # against the library, see benchmarks.md
```

It exports one class. `new CompiledSchema(schema_json)` loads a schema from its
interchange form, and throws an `Error` with the `SchemaBuildError`'s message.
The handle answers with a boolean, and everything `matches_json` reports as an
error is `false`.

| Entry point | How the text gets into the module's memory |
|---|---|
| `matches_json(text)` | The glue allocates, writes the string a code unit at a time while it is ASCII, and from the first unit that isn't, grows the allocation and calls `encodeInto`. The whole string is transcoded on every call. |
| `matches_json_bytes(bytes)` | The glue allocates and copies the bytes in with one `set`. |
| `input_ptr(len)`, then `matches_json_input(len)` | The handle keeps a buffer and `input_ptr` returns its address. The caller makes a `Uint8Array` over the module's memory there and writes into it. Nothing is allocated per call, and a source that writes into the view is never copied. |

- **The two byte entry points validate UTF-8 first**, in full. `matches_json`
  doesn't: what the glue wrote is UTF-8.
- **The view is made after `input_ptr` returns.** A view over the memory
  holds only until the memory grows, which any call into the module can
  cause. The address holds until the next `input_ptr`.
- **`input_ptr` returns `0` when the memory can't hold a buffer of `len`
  bytes**, and leaves the buffer as it was. The buffer never shrinks, and is
  freed with the handle.
- **A handle is released with `free()`.**
- **A lone surrogate in a string becomes U+FFFD.** A JavaScript string can
  hold half a surrogate pair and UTF-8 can't, so `encodeInto` writes U+FFFD
  for it. `matches_json` then reads the text as though U+FFFD were written, and
  can accept what the library rejects. This is the one place a verdict of the
  wasm build is looser than the library. `new CompiledSchema` reads a
  schema text with a raw lone surrogate the same way, and `to_schema_json`
  never writes such a text. It is of a raw surrogate, not a `\u` escape
  of one, which is `lone_surrogate` above.
- **`wasm-bindgen` is pinned to an exact version**, because the CLI that
  wasm-pack runs must be the version in `Cargo.lock`.
- **There is no `unsafe`**, and no dependency but wasm-bindgen. The crate
  compiles natively, so the three cargo commands cover it.
- **Its behavior is asserted from JavaScript**, by the pre-checks of
  `npm run benchmark:wasm`: every fixture through every entry point against
  the streaming column of the table above, the lone surrogate, and an
  `input_ptr` the memory can't hold. The crate has no Rust tests.
- The output is under `target/`, so it is git-ignored and nothing of
  `gro check` reads it.
