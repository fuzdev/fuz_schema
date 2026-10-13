# fuz_schema

> a performance-focused Standard Schema library for JS - [schema.fuz.dev](https://schema.fuz.dev/)

fuz_schema is a schema validation library for TypeScript and JS.
It takes [Valibot](https://valibot.dev/)'s strategy —
one tree-shakeable function per schema, schemas as plain data, `pipe` for refinement —
and asks how far that can be pushed on bundle size, speed, and memory
with simpler internals.

```ts
import * as s from '@fuzdev/fuz_schema/schema.ts';

const User = s.object({
	name: s.pipe(s.string, s.min_length(1)),
	age: s.optional(s.number),
	role: s.with_default(s.one_of(['user', 'admin']), 'user')
});
type User = s.Infer<typeof User>;

const result = s.parse(User, input);
if (result.ok) result.value;
else result.issues; // [{kind, expected, received, path, message}]
```

**It's an experiment, and "use Valibot" is a valid outcome.**
The question is whether the gap is worth owning a validation library for.
So far, on this repo's benchmarks, it is about 0.7x Valibot's size gzipped with every scenario bundled together
and less on each alone,
faster on every scenario measured, and allocates nothing for a valid value
beyond a fixed cost per parse.
Those numbers come from one shared workstation and a small set of scenarios,
and Valibot's bytes pay for features this doesn't have.
See [Measurements](#measurements) for what backs each claim and how to rerun it.

fuz_schema is published as `@fuzdev/fuz_schema`, has no stable API, and is missing a lot.

AI disclosure: this codebase is LLM-generated, by [Claude Code](https://claude.com/claude-code)
using Claude Opus 5.5, with a human steering the design.

## Priorities

In order:

1. correctness — a schema accepts what it says and nothing else
2. speed and size together — some bytes are worth paying for a significant speedup,
   judged by [written rules](#grading-a-change), not taste
3. memory — per parse, per schema held, and at startup
4. simplicity of the internals

Flexibility comes after all four.
Where a feature not everyone needs would cost every user, it's a separate export
that the core never reaches: custom messages, message formatting, metadata, serializing,
and the Standard Schema adapter are all like this, and all bundle to nothing unused.

## What's different from Valibot

- **One shape.** Every schema and action is the same `{kind, def, run}` object.
  There's no separate action type, `pipe` is a loop,
  and every schema shares one hidden class in V8.
- **Constants where there are no options.** `s.string`, not `s.string()`.
- **Output is copy-on-write.** A valid value that needs no defaults, transforms,
  or stripped keys comes back as the same object, with nothing allocated for it.
  A change copies only the path to it.
- **Failures are counted, issues are built late.** Valid input never builds a path,
  a `union` tries its options without allocating, and `s.is` stops at the first failure.
- **Issues are data, and hold no input.** `{kind, expected, received, path, message}`,
  where `received` is the type of the value that failed, not the value.
  Text is derived by `format_issue`, which is only bundled if used. No i18n registry.
- **`variant` dispatches by map**, not by scanning its options.

### What copy-on-write gives up

This is deliberate, for speed, and it's the main thing to know before using it.
**Output is not a fresh copy.**

- Output may alias the input, wholly or in part. Mutating one mutates the other.
- Validation is not a snapshot. A value that can change between reads
  (a getter, a proxy, an object someone else holds) can pass and then differ.
  Parsed JSON can't do this; objects from untrusted in-process code can.
- A class instance that matches comes back as that instance, not a plain object.

What it doesn't give up: `strip_object` still drops unknown keys, by copying when there are any,
and the input is never mutated.

### Other differences in behavior

- `pipe` stops at its first failing step.
- A failed `union` reports one issue, not its options' issues.
- A missing object key is the `undefined` it reads as, except to an `unknown`, a `literal(undefined)`,
  and a `one_of` with `undefined` among its values, which need their key
  wherever their entry reaches them, as in Valibot and Zod.
  They also need the key of the one other entry that accepts `undefined`,
  a `check` with no schema before it,
  and here that accepts a missing key. See [`docs/design.md`](docs/design.md#missing-keys).
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  `strip_object` drops them and `loose_object` keeps them.
- `parse` returns a result and does not throw; the throwing form is `parse_or_throw`.
  Code ported from Valibot or Zod that calls `parse` expecting a throw will get a result
  object instead, which TypeScript catches in typed code and nothing catches in untyped code.

## API

Everything here is a named export of `schema.ts`, used through a namespace import.
[Metadata](#metadata), the [Standard Schema](#standard-schema) adapter, and the [serializer](#serializing) are modules of their own.

| | |
|---|---|
| primitives | `string`, `number`, `boolean`, `bigint`, `unknown`, `literal`, `one_of` |
| wrappers | `optional`, `nullable`, `with_default`, `lazy`, `message` |
| nominal | `flavor`, `brand` |
| containers | `object`, `loose_object`, `strip_object`, `record`, `array`, `union`, `variant` |
| refinement | `pipe`, `check`, `transform`, `regex`, `min_length`, `max_length`, `min_value`, `max_value`, `integer`, `safe_integer`, `finite` |
| entry points | `parse`, `parse_or_throw`, `is` |
| issues | `format_issue`, `get_issue_value`, `SchemaError`, `fail` |
| introspection | `is_schema`, `SchemaNode`, `SchemaKind`, `SchemaDef`, `SchemaDefs` |
| types | `Infer`, `InferInput`, `Schema`, `SchemaIssue`, `Flavored`, `Branded` |

The three object schemas differ only on keys the schema doesn't name:
`object` rejects them, `loose_object` keeps them and is the cheapest when nothing changes,
`strip_object` drops them and pays for a copy when there are any.
None of them accepts an array, and neither do `record` and `variant`.

A key the input lacks reads as `undefined`, so it fails unless its entry accepts that.
`optional` and `with_default` do, which is how a key is made optional.
`unknown` accepts `undefined` and still needs its key, own or inherited:
`{}` doesn't match `s.object({a: s.unknown})` and `{a: undefined}` does.
It needs it under `nullable`, `lazy`, `message`, a `union`, and at the start of a `pipe` too,
so `{}` doesn't match `s.object({a: s.nullable(s.unknown)})` either.
Write `s.optional(s.unknown)` for a key that may be missing.
`s.literal(undefined)` and an `s.one_of` with `undefined` among its values need their key the same way.

`parse` returns `{ok: true, value}` or `{ok: false, issues}`.
`parse_or_throw` returns the value or throws a `SchemaError` listing every issue.
`is` answers yes or no without building issues.

```ts
// a discriminated union, recursive through `lazy`
interface Tree {
	kind: 'leaf' | 'branch';
	// ...
}
const Tree: s.Schema<Tree> = s.variant('kind', [
	s.object({kind: s.literal('leaf'), value: s.number}),
	s.object({kind: s.literal('branch'), children: s.array(s.lazy(() => Tree))})
]);

// custom text, on a schema or on one step of a pipe
const Name = s.pipe(s.string, s.message(s.min_length(1), 'name is required'));

// nominal types: a plain string assigns to an Email but not to a Uuid
const Email = s.flavor(s.pipe(s.string, s.min_length(3)), 'Email');
const Uuid = s.brand(s.string, 'Uuid');
const email: s.Infer<typeof Email> = 'a@b.c'; // ok
const uuid: s.Infer<typeof Uuid> = 'abc'; // error, parse it instead
```

`flavor` and `brand` change only the output type.
A plain value assigns to a flavored type but not to a branded one,
and a branded value comes from parsing or a cast.
`null` and `undefined` are left unmarked, so `flavor(nullable(string), 'Email')` is the flavored string or `null`.
Both return the schema itself, so they add nothing to a parse;
the name ships as a string at the call site and is otherwise unused.

### Issues

An issue is `{kind, expected, received, path, message}`:

- `kind` is the kind of the schema or action that failed, or `unknown_key` or `missing_key`
- `expected` says what was expected
- `received` is the type of the value that failed: `'null'`, `'array'`, or its `typeof`
- `path` is the keys from the root to that value, outermost first.
  For an unknown or a missing key the last one is the key.
- `message` is the text set by `message`, or `undefined`

**An issue never holds the value that failed.**
Issues, and the `SchemaError` that carries them, can be logged, serialized, and kept
without leaking the input or keeping it alive.
Two things in an issue do come from the input:

- `path` holds key names as the input gave them — an unknown key, a `record` key —
  so treat them as untrusted text
- a `message` function that writes the value into its text has put it there

`format_issue` writes an issue as `path: expected X, received Y`, the keys joined with `.`.
A key that isn't only word characters is quoted as JSON, so a key can't pass for two keys,
for the rest of the line, or, with a newline in it, for a line of its own:
`a.b` is two keys and `"a.b"` is one.

There are two ways to the value:

```ts
// a `message` function is handed it
const Port = s.message(s.number, (_issue, value) => `${String(value)} is not a port`);

// and it can be read back out of the input
const result = s.parse(User, input);
if (!result.ok) {
	for (const issue of result.issues) {
		const found = s.get_issue_value(issue, input);
		if (found.ok) found.value;
	}
}
```

A `message` function's `value` is what the schema it wraps was given.
Around an action that is the action's input, so the output of the pipe's steps before it.
Around a whole `pipe` it is the pipe's input, whichever step failed.

`get_issue_value(issue, input)` follows `issue.path` through `input`
and returns `{ok: true, value}` or `{ok: false}`. It refuses where it would have to guess:
when the path leads through something that isn't an object or array,
and when what it finds isn't of the type in `issue.received`.
It reads own keys only, so it never returns an inherited value,
and a missing key is found as `undefined`, which is what the schema saw.

A key an `unknown`, a `literal(undefined)`, or a `one_of` with `undefined` needs and the input lacks is a `missing_key`, which reads
`a: expected a required key, received undefined`.
A missing key whose schema refuses `undefined` has that schema's issue.

Its limit: it compares types, not values.
When an earlier step of a `pipe` replaced the value with another of the same type —
a `transform`, or a container that applied a default or dropped a key —
the issue is about the replacement, and `get_issue_value` returns the input's value at that path.

### Introspection

A schema is data: `kind` names what it is and `def` holds what it was built from.
Not everything given is in `def`: the `expected` text of `regex` and `check`, the text given to `message`, and the names given to `flavor` and `brand` are not.
`SchemaDefs` says what `def` is for every kind, and `SchemaNode` is the union over it,
so checking `kind` narrows `def`:

```ts
const unwrap = (schema: s.SchemaNode): s.SchemaNode => {
	switch (schema.kind) {
		case 'optional':
		case 'nullable':
		case 'with_default':
			return unwrap(schema.def.schema); // all three hold their schema as `def.schema`
		default:
			return schema;
	}
};

unwrap(User.def.age).kind; // 'number'
```

- no options: `def` is `undefined`
- one option: `def` is that value — a `literal`'s value, a `one_of`'s array, a `regex`'s pattern,
  the function given to `check`, `transform`, or `lazy`
- `optional` and `nullable` hold `{schema}`, and `with_default` holds `{schema, value}`
- the object schemas hold their entries, `array` and `record` the schema of their items,
  `union` and `pipe` their schemas in order, and `variant` holds `{key, options}`

`message`, `flavor`, and `brand` have no kind: the result has the `kind` and `def` of the schema given.

`is_schema(value)` checks for the shape — an object with a string `kind`, a `def`, and a `run` function —
and narrows to `SchemaNode`. It is structural: it doesn't check that the kind is known
or that `def` matches it. It is also the way in for a schema typed as a bare `Schema`,
as a recursive one is.
The narrowed type is for reading a schema as data: a schema typed with its kind keeps its own type,
while one typed as a bare `Schema` or `AnySchema` (as recursive schemas usually are) reads as `SchemaNode`,
whose output type is `unknown`.

### Metadata

`meta` attaches metadata to a schema and `get_meta` reads it back.
They are a module of their own, backed by a `WeakMap`, so a schema stays `{kind, def, run}`
and a bundle that attaches no metadata carries none of it.

```ts
import {meta, get_meta} from '@fuzdev/fuz_schema/meta.ts';

const Port = meta(s.number, {description: 'the port to listen on'});

get_meta(Port); // {description: 'the port to listen on'}
get_meta(s.number); // undefined
```

`meta` returns a copy of the schema with the same `kind`, `def`, and `run`, and leaves the one given alone:
`s.number` is a constant every use shares.
The copy has the schema's type and parses as it does, so it goes anywhere a schema goes,
and as an object entry `meta(s.optional(...), ...)` still makes the key optional.

- Calling `meta` on a schema that has metadata merges the two, the new keys winning.
- `get_meta` reads the object it is given and nothing inside it.
  For `s.optional(Port)` that is `undefined`, and `get_meta(schema.def.schema)` finds it:
  metadata on a nested schema is reached by [walking](#introspection).
- `flavor` and `brand` return the schema itself, so its metadata is still there.
  `message` builds a new schema, so attach metadata last: `meta(s.message(...), ...)`.

`description` is built in. Other keys are added to the `SchemaMeta` interface by declaration merging,
from a module, naming the module as it is imported:

```ts
declare module '@fuzdev/fuz_schema/meta.ts' {
	interface SchemaMeta {
		aliases?: Array<string>;
	}
}
```

The package exports every module under both a `.ts` and a `.js` path.
Either names the same declarations, so an augmentation through one is seen through both.

### Standard Schema

A schema is not itself a [Standard Schema](https://standardschema.dev/);
wrap it where a library asks for one:

```ts
import {to_standard_schema} from '@fuzdev/fuz_schema/standard_schema.ts';

const standard = to_standard_schema(User); // {'~standard': {version: 1, vendor, validate}}
```

The types follow version 1.1 of the spec and are copied from it, so there's no dependency on it.
`validate` is synchronous and ignores the spec's options argument,
and the input and output types are carried by the result's type, for the spec's own inference to read.

It's an adapter so that schemas don't each carry a `~standard` property.
Schemas that are Standard Schemas natively were measured and declined, as a flat cost
to every bundle: see [`docs/declined.md`](docs/declined.md#standard-schema).

### Serializing

`to_schema_json` writes a schema as plain JSON: every node as `{kind, def}`,
in an envelope whose `defs` hold what each `lazy` names.
It is the form the [Rust side](docs/rust.md) loads, and a module of its own.
The Rust crate isn't published; the form is plain JSON and stands without it.

```ts
import {to_schema_json} from '@fuzdev/fuz_schema/schema_json.ts';

to_schema_json(s.array(s.optional(s.number)));
// {schema: {kind: 'array', def: {kind: 'optional', def: {schema: {kind: 'number'}}}}}
```

It throws on a schema the form can't hold, saying where:
`regex`, `check`, and `transform`, which hold JavaScript values;
a `bigint` or `undefined` literal; a default that isn't a JSON value;
an entry named like a member of `Object.prototype`.
The text of `message` and the names of `flavor` and `brand` are not in a schema's data, and are not written.
[`docs/rust.md`](docs/rust.md) has the form and everything refused.

## Status

> **status**: early experiment — unstable, incomplete

- [x] the schemas and actions in the table above, with output and input type inference
- [x] custom messages, as an opt-in wrapper
- [x] Standard Schema v1, as an opt-in adapter
- [x] metadata, as an opt-in module
- [x] serializing a schema to JSON, as an opt-in module
- [x] copy-on-write output
- [x] `flavor` and `brand`, type-level only
- [ ] nested issues for a failed `union`
- [ ] `tuple`, `partial`, `pick`, `omit`, `intersect`
- [ ] abort-early as a caller option
- [x] a published package
- [ ] the Rust side: the schema model, whether a JSON text matches, its issues, and a wasm build to measure are built, output is not

Not designed yet: JSON Schema output, async validation, i18n.

Known regressions to fix: `strip_object` got slower when it has unknown keys to drop,
and when a default applies late in a wide object.
Both came with copy-on-write and share a cause: the copy is made after the fact,
so the keys it keeps are read a second time. Dropping keys also has to enumerate the input's keys first.

## Measurements

Every claim above comes from a benchmark in `src/benchmarks/`,
run against Valibot, Zod, Zod Mini, TypeBox, and ArkType.

```bash
npm run benchmark             # parse time, every library on every scenario
npm run benchmark:bundle      # bundle size per scenario and per export, minified and gzipped
npm run benchmark:allocations # heap bytes per parse and per schema built
npm run benchmark:coldstart   # a fresh process: import, build, first parse, peak memory
npm run benchmark:heap        # memory still held after building and parsing
npm run benchmark:types       # what each library costs the TypeScript checker
```

What they've shown so far, read with the caveats below:

- **Size:** about 0.7x Valibot gzipped with the scenarios bundled together, and far below the rest.
  Most of the gap is fixed cost, a bit over a kilobyte, which is small in absolute terms.
- **Warm speed:** faster than Valibot on every scenario,
  by about 2x on flat objects and more on recursive and union-heavy ones.
  Not the fastest: Zod's generated object parser wins on flat objects,
  and TypeBox and ArkType, which compile validators, win flat shapes by a wide margin.
- **Allocation:** a valid parse allocates a small fixed amount whatever the size of the value.
- **Cold start:** under a millisecond to import, build a schema, and parse once, bundled.
  The libraries that compile validators pay here, by one to two orders of magnitude.
- **Retained memory and type-checking cost:** the lowest or near it of the six.

Caveats:

- The scenarios are few and small.
  One is a real recursive schema taken from [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo);
  the rest are synthetic.
- Timings come from a shared workstation, not a quiet machine. Bundle sizes are exact, and allocation is exact for the code the engine is running when it is sampled.
- It's V8 only. The one-shape design is tuned to V8's hidden classes.
- It isn't like-for-like. Valibot does more, and TypeBox's check doesn't build an output.
- A test holds every library to the same answer on every scenario's valid and invalid input,
  so the benchmarks at least compare the same work.

### Grading a change

```bash
npm run grade                       # the working tree against HEAD
npm run grade -- --against HEAD~2 --filter real/
```

`grade` compares two versions of the library over a matrix of cases
(realistic shapes, one case per code path, and the same shapes at scale):
time, heap bytes allocated, and whether the output is the input itself.
Each version is loaded several times over, in fresh processes, several runs of them,
so every time is printed beside what copies of one version differed by, its A/A.
It then compares bundle size, retained heap, and cold start,
and checks the result against the rules a change is accepted by:

- speed is judged on the realistic cases, valid input first
- a time difference is read against its A/A, and inside it is noise
- bytes that tree-shake away unless imported only have to pay for themselves
- bytes every user pays need a return: roughly 10% on a realistic case per 50 gzipped bytes
- the whole stays under 0.75 of Valibot's gzipped size, on all the benchmark scenarios bundled together
- the valid path is never slowed to speed up the invalid one
- anything that generates code at runtime is opt-in, because of CSP

[`docs/grading.md`](docs/grading.md) has the rules in full,
and [`docs/benchmarks.md`](docs/benchmarks.md) the method behind every number.

## Develop

```bash
npm i
gro check  # typecheck, test, format check, lint
gro test
```

The repo is also a Rust workspace. `crates/fuz_schema` is the Rust side of the
library: the same schema model, loaded from a schema serialized in TypeScript,
whether a JSON text matches it, and the issues of one that doesn't, tested
against this library on shared fixtures. `crates/fuz_schema_wasm` compiles it
to wasm, to measure against this library. Neither is published. Run them with
cargo, and the measurement with npm:

```bash
cargo test --workspace
npm run build:wasm      # needs wasm-pack
npm run benchmark:wasm
```

## Docs

- [`docs/design.md`](docs/design.md) — the internals and why: the one shape,
  probe mode, copy-on-write and what it gives up, issues and messages, metadata
- [`docs/benchmarks.md`](docs/benchmarks.md) — what each benchmark measures and how,
  how far to trust each number, and what isn't measured
- [`docs/grading.md`](docs/grading.md) — `npm run grade` and the rules a change is accepted by
- [`docs/declined.md`](docs/declined.md) — trades that were measured and not taken, each with
  what it gave, what it cost, and what would reopen it
- [`docs/rust.md`](docs/rust.md) — the Rust side: the model, the interchange form,
  the two evaluators, the issues, where they differ from this library, what is
  refused, and the wasm build
- `CLAUDE.md` — layout, commands, and invariants (also the context file for AI agents)

## Credits

[Valibot](https://valibot.dev/) for the strategy this builds on.
The process-per-sample cold-start and retained-heap methods follow
[syntax-highlighter-bench](https://github.com/ryanatkn/syntax-highlighter-bench),
which generalizes [Twinkleplop](https://github.com/pngwn/twinkleplop)'s cold-start harness.

fuz_schema was written with [Claude Code](https://claude.com/claude-code) using Claude Opus 5.5:
the library, tests, benchmarks, and docs.
Valibot's source was not consulted while writing it; the comparison libraries are used only
through their public APIs, as benchmark baselines.

## Contributing

[fuz.dev/contributing](https://www.fuz.dev/contributing)

## License [🐦](https://wikipedia.org/wiki/Free_and_open-source_software)

[MIT](LICENSE)
