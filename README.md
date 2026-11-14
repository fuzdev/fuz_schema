# fuz_schema

> a performance-focused schema library for JS - [schema.fuz.dev](https://schema.fuz.dev/)

fuz_schema is a schema validation library for TypeScript and JS.
It takes [Valibot](https://valibot.dev/)'s strategy —
one tree-shakeable function per schema, schemas as plain data, `pipe` for refinement —
and pushes it on bundle size, speed, and memory
with simpler internals.
[Standard Schema](#standard-schema) comes through an opt-in adapter.

```ts
import * as s from '@fuzdev/fuz_schema/schema.ts';

const User = s.object({
	name: s.pipe(s.string, s.min_length(1)),
	age: s.optional(s.number),
	role: s.with_default(s.one_of(['user', 'admin']), 'user')
});
type User = s.Infer<typeof User>;
type UserInput = s.InferInput<typeof User>; // what a parse takes: `role` may be left out

const result = s.parse(User, input);
if (result.ok) result.value;
else result.issues; // [{kind, expected, received, path, message}]
```

Of the libraries it is measured against, it has the smallest bundle, the quickest cold start, and the least memory held,
and it is not the fastest: Zod compiled ahead of time by `z.compile` and TypeBox's compiled `Check` check valid input faster,
and ArkType's `allows` answers a guard faster.
Its output is not a fresh copy: a valid input that needs no change comes back as itself, see [What copy-on-write gives up](#what-copy-on-write-gives-up).
[Measurements](#measurements) has each claim, held by a test to the published benchmark run, and the rest.

fuz_schema is published as `@fuzdev/fuz_schema` and is pre-1.0: its API still changes, in minor releases, and [Status](#status) lists what it lacks.

```bash
npm i @fuzdev/fuz_schema
```

Every export and type is in the API docs at [schema.fuz.dev/docs](https://schema.fuz.dev/docs).
The package declares no `engines`. The newest built-ins the library calls are
`Array.prototype.toReversed`, only when `message` is given a function, and `String.prototype.isWellFormed`, only in `to_schema_json`,
both in Node 20. The repo's own tests and benchmarks need Node 24.14, for its type stripping, as `devEngines` says.

AI disclosure: this codebase is LLM-generated, by [Claude Code](https://claude.com/claude-code),
with a human steering the design.

## Measurements

The benchmarks in `src/benchmarks/` compare this library with Valibot, Zod (as it is imported,
with each root compiled ahead of time by `z.compile`, and as Zod Mini), TypeBox, and ArkType.
[The benchmarks page](https://schema.fuz.dev/docs/benchmarks) has the numbers of every comparison, rendered from one published results file,
[`results/latest.json`](results/latest.json), which names the machine, the versions, and the commit it came from.
A mean in a claim is of two libraries over the scenarios both have a figure of, where the page's leave out `type_json`,
which `z.compile` hands back uncompiled. `src/test/readme_measurements.test.ts` holds each bullet of the list to that file:

<!-- claims: each bullet is held to results/latest.json by src/test/readme_measurements.test.ts -->

- **Size:** the smallest bundle of the libraries compared, minified and gzipped, for every scenario and for all of them together.
- **On valid input:** faster than Valibot, Zod as it is imported, Zod Mini, and ArkType as a geometric mean over the scenarios, though Zod as it is imported and ArkType are each faster on at least one of them;
  Zod with its roots compiled ahead of time by `z.compile` is faster as a mean over the scenarios it compiles, and so is TypeBox, whose check builds no output and no issues, over all of them.
- **On invalid input:** faster than Valibot, ArkType, and Zod in each of its modes on every scenario each has a figure of;
  TypeBox, whose check stops at the first failure and builds no issues, is faster as a geometric mean.
- **As a guard,** where a library only answers whether a valid input matches: faster than Valibot, Zod as it is imported, and Zod Mini as a geometric mean over the scenarios,
  though Zod as it is imported is faster on at least one of them; TypeBox, ArkType, and compiled Zod are faster as a mean over the scenarios each has a figure of.
- **On the recursive scenario,** `type_json`, a real schema: faster on valid input and as a guard than Valibot, Zod as it is imported, Zod Mini, TypeBox, and ArkType.
- **Allocation:** a parse of valid input allocates fewer heap bytes than Valibot's, plain Zod's, or Zod Mini's on every scenario;
  TypeBox's check, which builds no output, allocates fewer on at least one, and so do compiled Zod and ArkType.
- **Allocation on invalid input:** a parse allocates fewer heap bytes than one of Valibot, ArkType, or Zod in each of its modes on every scenario;
  TypeBox's check, which builds no issues, allocates fewer on at least one.
- **Cold start:** an entry, bundled or importing the package, imports, builds its schema, and parses once, and a hundred times, in less time than any of the libraries compared, on every scenario measured.
- **Retained memory:** the least held of the libraries compared once a schema is built and has parsed once, on every scenario measured.
- **Type-checking cost:** fewer instantiations than Valibot, Zod as it is imported, Zod Mini, compiled Zod, and ArkType, for a module of every scenario, and for a file of a consumer's reads of the types its schemas infer.

<!-- /claims -->

A valid parse that returns its input allocates the same few bytes for a list of records as for one record, as the page's allocation table shows,
except where something makes a new value: a copy where an entry changed or a key is dropped,
`to_lower_case` the string it returns whatever its case,
`to_integer` the number it gives where the engine boxes one, as past `2 ** 31 - 1` either way, the `-0` it reads before giving `0`, and with `trim` a copy of a string that holds U+0085,
and a `memo_union` its memo when it is probed.
Against TypeBox, which has fewer instantiations turns on whether the schemas' types are inferred:
TypeBox has fewer for a module that only builds its schemas, and this library fewer once their types are inferred, read or not.
The exact bytes of this library's bundles, per scenario and per export, are in [`src/benchmarks/sizes.json`](src/benchmarks/sizes.json), which `src/test/sizes.test.ts` keeps current.

Caveats:

- The scenarios are few and small. `type_json` is a real schema taken from [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo);
  the rest are synthetic. The page has two wider readings no claim here is of: a survey of many small shapes, row by row,
  and harvested sets, consumers' own schemas and data in the library each was written in and in this one.
- Timings come from one machine, which the page names with its state as the run started and ended, and nothing is pinned or isolated.
  Bundle sizes are exact. Allocation is exact for the code the engine is running when it is sampled,
  which a process settles and not always the same way, so a figure repeats within about a percent,
  but for a row that settles at one of a few figures further apart.
- It isn't like-for-like. Valibot does more, TypeBox's check builds no output and no issues,
  and where this library returns its input Valibot and Zod return a copy of it.
  A guard row sets the copy aside only where the guard builds no output: Valibot's `is`,
  and Zod's `z.validate` where a schema has no compiled path, run the parser, which still copies what it reads.
- `src/test/benchmarks.test.ts` holds every library to the same answer on every scenario's valid and invalid input,
  so the benchmarks at least compare the same question.

[`docs/benchmarks.md`](docs/benchmarks.md) has the method behind every number.

## When not to use it

- Where the fastest check of valid input matters most, and code generated at runtime is allowed: see [Measurements](#measurements).
- Where the output must be a fresh copy, or the input comes from code that isn't trusted, whose getter or `Proxy` can change a value between reads:
  see [What copy-on-write gives up](#what-copy-on-write-gives-up).
- Off V8: the one shape is tuned to V8's hidden classes, and nothing is measured on another engine.
- Where a check must await inside the schema, as Valibot's `pipeAsync` and Zod's async `refine` do:
  `parse` is synchronous, and an async check runs after it, on its output, see [Async checks](#async-checks).
- Where translated messages should come from a registry or a shipped locale:
  here a consumer's catalogue writes them from an issue's data, see [Translating issues](#translating-issues).
- For `tuple` or `intersect`, which it doesn't have,
  or where a failed `union` must report each option's issues, which a caller [gets by parsing again](#a-failed-unions-options).
- Where the API must be stable: it [isn't yet](#status).

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
JSON Schema output, the readers of a schema, and the Standard Schema adapter are all like this,
and all bundle to nothing unused.

## What's different from Valibot

- **One shape.** Every schema and action is the same `{kind, def, run}` object.
  There's no separate action object, `pipe` is a loop,
  and every schema shares one hidden class in V8.
- **Constants where there are no options.** `s.string`, not `s.string()`.
- **Output is copy-on-write.** A valid value that needs no defaults, transforms,
  or stripped keys comes back as the same object, with nothing allocated for it.
  A change copies only the path to it.
- **Failures are counted, issues are built late.** Valid input never builds a path,
  a `union` tries its options without building an issue, and `s.is` stops at the first failure.
- **Issues are data, and hold no value of the input.** `{kind, expected, received, path, message}`,
  where `received` is the type of the value that failed, not the value, and `path` the keys to it.
  Text is derived by `format_issue`, which is only bundled if used. No i18n registry.
- **`variant` dispatches by map**, not by scanning its options, so each option's discriminator is a `literal`.

### What copy-on-write gives up

This is deliberate, for speed, and it's the main thing to know before using it.
**Output is not a fresh copy.**

- Output may alias the input, wholly or in part. Mutating one mutates the other.
- Validation is not a snapshot. A value that can change between reads
  (a getter, a proxy, an object someone else holds) can pass and then differ.
  Parsed JSON can't do this; objects from untrusted in-process code can.
  A caller who needs a snapshot parses a clone, `s.parse(schema, structuredClone(input))`.
- A class instance that matches and needs no change comes back as that instance, not a plain object.
  A copy of one is a plain object.

What it doesn't give up: `strip_object` still drops unknown keys, by copying when there are any,
and the input is never mutated.
The rest, a copy's second read, key order, prototypes, and what a clone and a revoked `Proxy` do, is in [`docs/design.md`](docs/design.md#copy-on-write-output).
Against a `strip_object` that always copies, an input with a key to drop parses slower and one with nothing to drop faster,
see [Always a copy](docs/declined.md#always-a-copy) and the [other ways tried](docs/declined.md#dropping-keys),
and a default applied late in a wide object reads the keys before it a second time,
which [a copy filled from the start](docs/declined.md#a-copy-filled-from-the-start-when-an-entry-has-a-default) avoided, at costs it was declined for.

### Other differences in behavior

- `pipe` stops at its first failing step.
- A failed `union` reports one issue, not its options' issues, even with one option, and names each option once, as `received` names values:
  `union([nullable(string), one_of(['a', 'b']), pipe(number, check(..))])` reads `expected string | null | "a" | "b" | number`,
  by the rule in [`docs/design.md`](docs/design.md#issues).
- A missing object key is the `undefined` it reads as, except to the schemas [Missing keys](#missing-keys) names,
  which need their key as in Valibot and Zod.
- `number` refuses `NaN` and the infinities, as Zod's does, where Valibot's takes the infinities.
  An infinity reaches a parse from JSON too: `JSON.parse('1e999')` is `Infinity`.
  `integer` takes an integer past the safe range, as Valibot's does, and `safe_integer` doesn't, as Zod's `int` doesn't.
- `pipe(string, uuid)` takes a UUID of RFC 9562 with a version from 1 to 8, as Zod's does,
  and the max UUID in any case, as Valibot's does.
  `pipe(string, iso_datetime)` takes `2024-02-29T23:59:59.123Z` in UTC with a real date, as Zod's does,
  and a fraction of at most 9 digits, as Valibot's `isoTimestamp` does,
  and refuses an offset and a space for the `T`, which `isoTimestamp` takes. See [`docs/formats.md`](docs/formats.md).
- `pipe(string, to_lower_case)` gives `toLowerCase()` of the string, as Zod's `toLowerCase` and Valibot's do,
  and the steps after it are given the lowercase: `s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid')`
  takes a UUID in either case and gives it lowercase.
  A `brand` or `flavor` goes outside a step that changes the value, as there:
  one on a step before it is dropped, as the output is a new string.
- `pipe(string, to_integer())` reads Rust's integer grammar, `str::parse::<i64>`, where Zod's `z.coerce.number()` and Valibot's `toNumber` read `Number`'s,
  so it refuses `''`, white space, an exponent, hex, a fraction, and an integer past the safe range, and a `-0` gives `0`, where both give `-0`.
  See [`docs/formats.md`](docs/formats.md#integers).
- `min_length` and `max_length` read a string's `length`, its UTF-16 code units, as Valibot's do,
  where Zod's count a surrogate pair as one.
- `with_default` fills in the value it was given, the same one on every parse,
  where Zod fills in a copy and Valibot what its schema makes of it,
  so an array or object default is shared by every output it fills.
  `s.with_default_fn(s.array(s.string), () => [])` calls its function for each value it fills in.
  Neither validates the default, as in Zod.
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  `strip_object` drops them and `loose_object` keeps them.
- No object schema, `record`, `keyed_record`, or `variant` takes an array, as in Zod, where Valibot's take one as an object.
- `variant` reads each option's discriminator as a `literal`. One that is a `one_of` or an `optional`,
  which Valibot's `variant` and Zod's `discriminatedUnion` take, is never picked, and the types don't refuse it.
  Of two options with one value the later is picked, where Zod throws and Valibot tries both.
- A recursive `union` walks a node's children once for each option that reads them, as Valibot's does,
  where Zod's walks them once: see [Recursion and deep input](#recursion-and-deep-input) before moving one over from Zod.
- A failing parse reports its first hundred issues, where both report every one, see [Issues](#issues).
- `parse` returns a result and does not throw; the throwing form is `parse_or_throw`.
  Code ported from Valibot or Zod that calls `parse` expecting a throw will get a result
  object instead, which TypeScript catches in typed code and nothing catches in untyped code.

### Names, coming from Valibot or Zod

| Valibot | Zod | here |
|---|---|---|
| `strictObject` | `strictObject` | `object` |
| `object` | `object` | `strip_object` |
| `looseObject` | `looseObject` | `loose_object` |
| `objectWithRest` | `.catchall()` | `object_with_rest` |
| `picklist` | `enum` | `one_of` |
| `variant` | `discriminatedUnion` | `variant` |
| `optional(schema, value)` | `.default(value)` | `with_default`, and `with_default_fn` for an array or object |
| `record(key, value)` | `record(key, value)`, `partialRecord(key, value)` | `keyed_record(key, value)`, and `record(value)` where any string is a key |
| `finite` | | nothing: `number` refuses what isn't finite |
| `nullish` | `.nullish()` | `optional(nullable(schema))` |
| `email`, `url` | `z.email()`, `z.url()` | nothing: a `regex` or a `check` of the consumer's, see [`docs/formats.md`](docs/formats.md#not-formats) |
| `toNumber` | `z.coerce.number()` | `to_integer`, of Rust's integer grammar and not `Number`'s |
| `isoTimestamp` | `z.iso.datetime()` | `iso_datetime`, in UTC only, see [`docs/formats.md`](docs/formats.md) |
| `check`, `custom` | `.refine()` | `check`, and `check_at` to report at a key |
| `description`, `metadata` | `.describe()`, `.meta()` | `meta`, in `meta.ts` |
| `parse` | `.parse()` | `parse_or_throw` |
| `safeParse` | `.safeParse()` | `parse` |
| `ValiError` | `ZodError` | `SchemaError` |
| `InferOutput`, `InferInput` | `z.infer`, `z.input` | `Infer`, `InferInput` |
| `GenericSchema` | `ZodType` | `Schema` |
| `schema.entries` | `schema.shape` | `schema.def` |
| `schema['~standard']` | `schema['~standard']` | `to_standard_schema(schema)`, in `standard_schema.ts` |

## API

The package has no root entry: a module is imported by its path,
`@fuzdev/fuz_schema/schema.js`, or `schema.ts`, which names the same file.
Everything here is a named export of `schema.ts`, used through a namespace import.
[Metadata](#metadata), the [Standard Schema](#standard-schema) adapter, the [serializer](#serializing),
[JSON Schema](#json-schema) output, and the [readers of a schema](#introspection) are modules of their own.

| | |
|---|---|
| primitives | `string`, `number`, `boolean`, `bigint`, `unknown`, `literal`, `one_of`, `void` |
| wrappers | `optional`, `nullable`, `with_default`, `with_default_fn`, `lazy`, `message` |
| nominal | `flavor`, `brand` |
| containers | `object`, `loose_object`, `strip_object`, `object_with_rest`, `record`, `keyed_record`, `array`, `union`, `memo_union`, `variant` |
| pipe and actions | `pipe`, `check`, `check_at`, `transform`, `to_lower_case`, `to_integer`, `regex`, `min_length`, `max_length`, `min_value`, `max_value`, `integer`, `safe_integer` |
| formats | `uuid`, `iso_datetime` |
| entry points | `parse`, `parse_or_throw`, `is` |
| issues | `format_issue`, `format_issue_with_value`, `get_issue_value`, `SchemaError`, `fail` |
| introspection | `is_schema`, `SchemaNode`, `SchemaKind`, `SchemaDef`, `SchemaDefs`, `SchemaOfKind` |
| types | `Infer`, `InferInput`, `Schema`, `AnySchema`, `SchemaContext`, `SchemaAction`, `SchemaRefinement`, `SchemaIssue`, `SchemaResult`, `Flavored`, `Branded` |
| types of the schemas | `ObjectSchema`, `StripObjectSchema`, `LooseObjectSchema`, `ObjectWithRestSchema`, `ArraySchema`, `RecordSchema`, `KeyedRecordSchema`, `UnionSchema`, `VariantSchema`, `OptionalSchema`, `NullableSchema`, `WithDefaultSchema`, `WithUndefinedDefaultSchema`, `WithDefaultFnSchema`, `WithUndefinedDefaultFnSchema`, `LazySchema`, `PipeSchema`, `BrandSchema`, `FlavorSchema`, `LiteralSchema`, `OneOfSchema`, `StringSchema`, `NumberSchema`, `BooleanSchema`, `BigintSchema`, `UnknownSchema`, `VoidSchema` |
| types to name a schema's | `SchemaEntries`, `SchemaStrictObjectOutput`, `SchemaStrictObjectInput`, `SchemaStripObjectInput`, `SchemaObjectOutput`, `SchemaObjectInput`, `SchemaKeyedRecord` |

The types the table leaves out are in the API docs: the `*Def` types of `def`, `Flavor` and `Brand`, `SchemaLiteral`, `ToIntegerOptions`,
the types a declaration emitted for a generic helper names, and those of the other modules
(`SchemaMeta`, `SchemaField`, `SchemaJson`, `JsonSchema`, the `Standard*` types among them).

`parse` returns `{ok: true, value}` or `{ok: false, issues}`.
`parse_or_throw` returns the value or throws a `SchemaError` listing the first ten of its issues and how many more failures there were.
`is` answers yes or no without building issues or an output, and narrows the value to the schema's input type.

```ts
// refinement: a pipe runs its steps in order and stops at the first that fails
const Port = s.pipe(s.number, s.integer, s.min_value(1), s.max_value(65535));
const Tags = s.pipe(s.string, s.transform((text) => text.split(',')));
// a check of the consumer's, with the text an issue says was expected
const Odd = s.pipe(s.number, s.check((n) => n % 2 === 1, 'an odd number'));
// an integer read from a string, as a query parameter or an environment variable is
const Limit = s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000));

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
const Uuid = s.brand(s.pipe(s.string, s.uuid), 'Uuid');
const email: s.Infer<typeof Email> = 'a@b.c'; // ok
const uuid: s.Infer<typeof Uuid> = 'abc'; // error: a Uuid comes from a parse
```

A `pipe` is typed for one to four actions; a pipe of more starts with a pipe, `s.pipe(s.pipe(schema, a, b, c, d), e)`.
An action is a step of a `pipe`: as a schema of its own it is handed the value unchecked,
so `s.object({a: s.min_length(1)})` throws a `TypeError` on `{}`, see [`docs/design.md`](docs/design.md#actions-outside-a-pipe).
A recursive schema needs its type written, and annotated as `s.Schema<Tree>` its `kind` is typed `string` and its `def` `unknown`,
and its input type is its output's: where it holds a default, give the input too, `s.Schema<Tree, TreeInput>`.

`flavor` and `brand` change only the output type.
A plain value assigns to a flavored type but not to a branded one,
and a branded value comes from parsing or a cast.
`null` and `undefined` are left unmarked, so `flavor(nullable(string), 'Email')` is the flavored string or `null`.
Marks compose: a brand of a branded schema, `s.brand(Path, 'DirPath')`, is assignable to `Path` and not the reverse, and so is a flavor of a flavored one.
Both return the schema itself, so they add nothing to a parse;
the name ships as a string at the call site and is otherwise unused.

The object schemas differ only on keys the schema doesn't name:
`object` rejects them, `loose_object` keeps them and is the cheapest when nothing changes,
`strip_object` drops them and pays for a copy when there are any,
and `object_with_rest(entries, rest)` validates the value of each own one with `rest`,
as Valibot's `objectWithRest` does; Zod's `catchall` validates an inherited one too.
None of them accepts an array, and neither do `record`, `keyed_record`, and `variant`.
With no entries, `object` and `strip_object` output `Record<string, never>`, not `{}`,
which TypeScript reads as any value but `null` and `undefined`.

`record(value)` validates the value of every own enumerable string key, and `keyed_record(key, value)` the key too,
with `key`, a schema of strings, whose output is the output's key:

```ts
const Scores = s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.number); // Record<string, number>
const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
const Counts = s.keyed_record(Uuid, s.number); // Record<Uuid, number>, each key lowercase
const Limits = s.keyed_record(s.one_of(['cpu', 'memory']), s.number); // {cpu?: number; memory?: number}
```

No key is needed, so a `one_of` or a `literal` key types each key as optional, as Valibot's `record` of a `picklist` and Zod's `partialRecord` do,
where Zod's `record` of an enum needs every key: that is an `object` whose entries hold one schema.
A key `key` refuses is an issue of kind `invalid_key`, at the key, and `value` is not run on its value.
Its `received` is what `key` reported, `'string'` unless a step of `key` changed the type,
and its path ends at the key unless `key` added to it with a `check_at`.
Two keys that give one, as `A` and `a` under `to_lower_case`, are the last one's value in the first one's place,
and a key that gives `__proto__` is left out.

`s.void` is `s.literal(undefined)` typed `void`, in and out, so a parameter typed from it can be left out:
`(input: s.Infer<typeof s.void>) => ...` is called as `f()`. Every reader of a schema takes it as that literal.

### Missing keys

A key the input lacks reads as `undefined`, so it fails unless its entry accepts that.
`optional`, `with_default`, and `with_default_fn` do, which is how a key is made optional,
and so does a `nullable`, a `lazy`, or a `union` that reaches one of them, as in Zod, where Valibot needs the key under each.

`unknown`, `literal(undefined)` (and so `s.void`), and a `one_of` with `undefined` among its values
accept `undefined` and still need their key, own or inherited, as in Valibot and Zod:
`{}` doesn't match `s.object({a: s.unknown})` and `{a: undefined}` does.
They need it under `nullable`, `lazy`, `message`, a `union`, and at the start of a `pipe` too,
so `{}` doesn't match `s.object({a: s.nullable(s.unknown)})` either: write `s.optional(s.unknown)` for a key that may be missing.
Their missing key is a `missing_key` issue, `a: expected a required key, received undefined`, except under a `union`, whose own issue it is,
and one whose schema refuses `undefined` has that schema's issue.
Valibot and Zod also need the key of a bare `check` entry (their `custom`), which here is given the `undefined` a missing key reads as.

A `pipe` that starts with an `optional` runs none of its steps for a key that is missing, and leaves the key out, as in Valibot:
`{}` matches `s.object({a: s.pipe(s.optional(s.string), s.check(...))})` whatever the check says,
and a `transform` there writes no key. `s.with_default` is what fills a missing key in.
With the key there, as `undefined` too, every step runs,
and so do they under a `nullable`, a `lazy`, or a `union`, as steps of the schema that is the entry.

Where the first option of a `union` that matches a missing key fills it in, as `s.with_default` does,
the options before it are tried again on `undefined`, without the object and the key,
so an `unknown` among them matches, and the first that matches is the union's.
[`docs/design.md`](docs/design.md#missing-keys) has how the object schemas tell a missing key.

### Recursion and deep input

A recursive `union` whose options walk a node's children before an entry tells them apart
takes time exponential in the input's depth, as each option walks them again:
with two such options the time doubles with each level, as in Valibot, where Zod's `union` walks them once, see [`docs/design.md`](docs/design.md#unions-and-recursion).
On untrusted input of that shape, use `variant`, or put first in each option the `literal` entries that tell the options apart, where there are some.
Where there isn't, `memo_union` is a `union` that keeps, for one parse, what it gave each object or array it was probed with,
and is linear: a `transform`, a `check`, or a `with_default_fn`'s `make` under it can run fewer times,
and an object the input holds twice gets one output object in both places.

A schema runs its children by calling them, so input nested past the engine's stack makes
`parse`, `parse_or_throw`, `is`, and a Standard Schema's `validate` throw a `RangeError`,
at a depth far short of what `JSON.parse` reads, see [`docs/design.md`](docs/design.md#running).
On untrusted JSON that can nest without bound, catch it or bound the depth first.

### Composing object schemas

An object schema's `def` is its entries, so a new one is a spread of it into a factory.
There are no `extend`, `pick`, `omit`, or `partial` helpers, and the spread costs nothing in the library.
A schema made from another's `def` stays in a bundle that doesn't use it, as a bundler can't tell that reading `def` has no side effect.

```ts
const User = s.object({id: s.string, name: s.string, password: s.string});

// extend, and override: a later key wins, in the earlier key's position
const Admin = s.object({...User.def, role: s.literal('admin')});
const Named = s.object({...User.def, name: s.optional(s.string)});

// omit and pick
const {password: _, ...public_entries} = User.def;
const PublicUser = s.object(public_entries);
const UserId = s.object({id: User.def.id});

// another strictness, and a merge
const LooseUser = s.loose_object(User.def);
const Merged = s.object({...User.def, ...Other.def});

// partial: wrap each entry in `optional`, but leave one with a default as it is,
// as `optional` around a default leaves the key out and the default never runs
const Patch = s.object({name: s.optional(Settings.def.name), theme: Settings.def.theme});

// `object_with_rest`'s def is `{entries, rest}`
const More = s.object_with_rest({...Counts.def.entries, label: s.string}, Counts.def.rest);

// a refined base is a `pipe`, whose def isn't entries (a type error):
// extend the bare object, then pipe
const Range = s.pipe(s.object({...Bounds.def, step: s.number}), s.check(in_order));
```

A `message`, `brand`, `flavor`, or `meta` on the base is not carried over; one on an entry is, as the entry is the same schema.
A generic function that overrides a key types its entries as `Omit<T, keyof U> & U`,
since a spread of generic entries types as `T & U` and an overridden key's type collapses.

### Exporting schemas from a library

Every schema the library makes but a `pipe` and an action has a type named for its factory,
whose type arguments are only what the factory was given: `s.object(entries)` is an `s.ObjectSchema<typeof entries>`,
`s.array(schema)` an `s.ArraySchema<typeof schema>`, and `s.string` an `s.StringSchema`.
`memo_union` has `union`'s, and `message` and `meta` keep the type of the schema given.
So the declaration emitted for an exported schema writes each schema it holds by its name,
and doesn't write out its output or its input, but for those two.
A `pipe` is an `s.PipeSchema<TOutput, typeof first>`, whose output its steps compute,
so a declaration writes that output out wherever the pipe is held.
An action is a `SchemaRefinement` or a `SchemaAction`, typed by what it takes and gives.
A declaration also writes out an object schema's entries, wherever the schema is held.
Naming each exported object schema's type, and each exported `pipe` whose output is an object,
keeps a declaration to references:

```ts
const UserEntries = {kind: s.literal('user'), name: s.string, age: s.optional(s.number)};
export interface UserSchema extends s.ObjectSchema<typeof UserEntries> {}
export const User: UserSchema = s.object(UserEntries);

// a variant of named options needs no annotation: its declaration is
// `s.VariantSchema<"kind", readonly [UserSchema, BotSchema]>`
export const Actor = s.variant('kind', [User, Bot]);

// a pipe's output is written out wherever it is held, even one its steps leave as it was:
// name the output, then the pipe
export interface Stamped extends s.Infer<typeof User> {at: number}
export interface StampedSchema extends s.PipeSchema<Stamped, UserSchema> {}
export const Stamped: StampedSchema = s.pipe(User, s.transform((user) => ({...user, at: Date.now()})));
```

`strip_object`, `loose_object`, and `object_with_rest` have `s.StripObjectSchema`,
`s.LooseObjectSchema`, and `s.ObjectWithRestSchema`, extended the same way.
A type of entries shared between schemas is a type alias:
an interface has no index signature, so it is not a `SchemaEntries`.

The output's name is the consumer's to write.
`Infer` is a conditional type, so a tool that prints types names an output by what it resolves to,
and writes out one that has no name:

```ts
export interface User extends s.Infer<typeof User> {}
// or from the entries, and the input too
export interface UserInput extends s.SchemaStrictObjectInput<typeof UserEntries> {}
```

The name is for the consumer's own annotations: a parse of `User` is still typed by the output written out, which assigns to the interface.
A `pipe` named with its output, as `StampedSchema` is, parses to the name.

A doc comment on an entry is its property's in the output and input types, the named ones included,
so the entries are where a field is documented.
`strip_object` has `SchemaStripObjectInput` for its input, and `loose_object` has
`SchemaObjectOutput` and `SchemaObjectInput`, each `& Record<string, unknown>`,
and `object_with_rest` the same two, each `& Record<string, ...>` of what its `rest` gives and takes.

`Infer<Schema>` is `unknown` and `Infer<AnySchema>` is `any`.
A helper generic over this library's schemas and another's reads the output behind a test,
`T extends s.Schema ? s.Infer<T> : ...`: `s.Infer<T & s.Schema>` is `unknown` whatever `T` is,
as the intersection's `run` is an overload whose last signature, `Schema`'s, returns `unknown`.

### Issues

A failing parse reports its first hundred issues, and builds no issue for the rest.
Nothing on the result says the hundred was reached, so a result of a hundred issues may be of an input that failed more often.
The `and N more` of a `SchemaError`'s message counts every failure past the ten it lists when `parse_or_throw` throws it,
so an input that failed five hundred times reads `and 490 more`, with the hundred issues on `error.issues`.
One made by hand, `new s.SchemaError(result.issues)`, counts the issues it is given, unless it is given the count too.
`instanceof s.SchemaError` is true only of an error from the same copy of the library:
across two installed copies, `error.name === 'SchemaError'` and `error.issues` are what hold.
An issue is `{kind, expected, received, path, message}`:

- `kind` is the kind of the schema or action that failed, or `unknown_key`, `missing_key`, or `invalid_key`, a key a `keyed_record` refused
- `expected` says what was expected
- `received` is the type of the value that failed: `'null'`, `'array'`, or its `typeof`,
  but a number that isn't finite is `'NaN'`, `'Infinity'`, or `'-Infinity'`
- `path` is the keys from the root to that value, outermost first.
  For an unknown, a missing, or an invalid key the last one is the key, except where a `keyed_record`'s key schema added to the path with a `check_at`.
- `message` is the text set by `message`, or `undefined`

**An issue never holds the value that failed.**
Issues, and the `SchemaError` that carries them, can be logged, serialized, and kept
without leaking the input or keeping it alive.
Two things in an issue do come from the input:

- `path` holds key names as the input gave them — an unknown key, a record's key —
  so treat them as untrusted text
- a `message` function that writes the value into its text has put it there

`format_issue` writes an issue as `path: expected X, received Y`, the keys joined with `.`,
with no `path: ` for an issue at the root, and with the issue's `message` in place of the
`expected X, received Y` where it has one.
A key that isn't only word characters is quoted as JSON, so a key can't pass for two keys,
for the rest of the line, or, with a `\n` or a `\r` in it, for a line of its own:
`a.b` is two keys and `"a.b"` is one.
U+0085, U+2028, and U+2029 are written as they are, as JSON leaves them, and are line breaks to a reader that splits on them.

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

A `message` labels every issue of the schema it wraps that has no message yet, its children's included,
and the innermost `message` wins: `s.message(s.object({a: s.message(s.string, 'a')}), 'o')`
labels an issue at `a` with `'a'` and any other with `'o'`.
A `message` function's `value` is what the schema it wraps was given.
Around an action that is the action's input, so the output of the pipe's steps before it.
Around a whole `pipe` it is the pipe's input, whichever step failed,
and for a child's issue it is still that input, with the issue's `path` relative to it,
so `s.get_issue_value(issue, value)` finds the child's.

`get_issue_value(issue, input)` follows `issue.path` through `input`
and returns `{ok: true, value}` or `{ok: false}`, refusing where it would have to guess.
It compares types, not values: when an earlier step of a `pipe` replaced the value with another of the same type,
the issue is about the replacement, and `get_issue_value` returns the input's value at that path.
`format_issue_with_value(issue, input)` writes an issue as `format_issue` does,
with the value it finds in place of its type when it is a string, a number, or a boolean:
`kind: expected "function" | "variable", received "funtion"`.
For an `invalid_key` issue the value is the last key of its path, which `get_issue_value` gives,
and an `unknown_key` or a `missing_key` issue is written as `format_issue` writes it.
[`docs/design.md`](docs/design.md#issues) has the rest of both.
A `SchemaError` never holds the input, so the caller that does builds this text:

```ts
try {
	s.parse_or_throw(Config, input);
} catch (error) {
	if (error instanceof s.SchemaError) {
		console.error(error.issues.map((issue) => s.format_issue_with_value(issue, input)).join('\n'));
	}
	throw error;
}
```

A check of an object that is about one of its fields reports at that field with `check_at`,
which takes a key or the keys from the value in, as Zod's `refine` takes a `path`:

```ts
const Signup = s.pipe(
	s.object({password: s.string, confirm: s.string}),
	s.message(s.check_at('confirm', (v) => v.password === v.confirm), 'passwords must match'),
);
// an issue at ['confirm'], below the keys above the object, received the type of `confirm`
```

The path is typed by the value: a key or each of the keys must be one of what it leads into,
so `s.check_at('confrim', ...)` fails to compile.
It is a `check` to every reader, and a `pipe` stops at the first step that fails,
so of several `check_at`s, one per field, one reports its issue at a time.

#### A failed `union`'s options

A failed `union` reports one issue, at its own path, as its options are only probed.
Each option's issues come from parsing the value at that path with each option in the union's `def`:

<!-- recipe: union_options -->

```ts
const Contact = s.union([
	s.object({email: s.pipe(s.string, s.min_length(3))}),
	s.object({phone: s.pipe(s.string, s.min_length(7))})
]);
const Form = s.object({name: s.string, contact: Contact});

// each option's issues for the issue of a union the caller names, with paths from the root
const explain_union = (
	union: s.UnionSchema<ReadonlyArray<s.Schema>>,
	issue: s.SchemaIssue,
	input: unknown
): Array<Array<s.SchemaIssue>> | undefined => {
	const found = s.get_issue_value(issue, input);
	if (!found.ok) return undefined;
	return union.def.map((option) => {
		const result = s.parse(option, found.value);
		if (result.ok) return [];
		return result.issues.map((i) => ({...i, path: [...issue.path, ...i.path]}));
	});
};

const input = {name: 'x', contact: {phone: '12'}};
const result = s.parse(Form, input);
// result.issues: one issue, `contact: expected object, received object`
const per_option = !result.ok && explain_union(Contact, result.issues[0]!, input);
// per_option, as format_issue writes them:
// [['contact.email: expected string, received undefined',
//   'contact.phone: expected no unknown keys, received string'],
//  ['contact.phone: expected length >= 7, received string']]
```

The caller names the union, and picks its issue by the path where a schema has several.
Each option runs again, its checks and transforms too, on the input's value at the path,
so the answer is the union's only where that value is what the union was given:
not after a step of a `pipe` before it that changed the value and kept its type, which `get_issue_value` can't see,
and not for a missing key, parsed as `undefined`, which an option that needs its key matches.
An option with no issues is the sign of the second, and of the first only where the input's value matches an option:
where it matches none, the issues are of the input's value, and nothing says so.
It gives `undefined` where `get_issue_value` finds no value, as after a step that changed the value's type.

### Translating issues

There is no registry of messages and no locale.
An issue's `kind`, `expected`, `received`, and `path` are data, and a catalogue the consumer writes
gives them its own words, with `message` given keys in place of text:

<!-- recipe: translating_issues -->

```ts
const Account = s.pipe(
	s.object({username: s.pipe(s.string, s.min_length(3)), password: s.string, confirm: s.string}),
	s.message(s.check_at('confirm', (v) => v.password === v.confirm), 'account.passwords_match')
);

// a consumer's catalogue: its words for the types `expected` and `received` name,
// its labels for its fields, and the text of each key given to `message`.
// Maps, as a path's keys are the input's: a key named `constructor` finds nothing
const TYPES_ES = new Map([['string', 'texto'], ['number', 'un número'], ['undefined', 'nada']]);
const FIELDS_ES = new Map([['username', 'el nombre'], ['password', 'la contraseña']]);
const MESSAGES_ES = new Map([['account.passwords_match', 'las contraseñas deben coincidir']]);

const translate_es = (issue: s.SchemaIssue): string => {
	if (issue.message !== undefined) return MESSAGES_ES.get(issue.message) ?? issue.message;
	const field = FIELDS_ES.get(String(issue.path.at(-1))) ?? 'el valor';
	const word = (type: string): string => TYPES_ES.get(type) ?? type;
	switch (issue.kind) {
		case 'min_length':
			return `${field} necesita al menos ${issue.expected.replace('length >= ', '')} caracteres`;
		case 'unknown_key':
			return `${field} no es un campo permitido`;
		default:
			return `${field}: se esperaba ${word(issue.expected)}, se recibió ${word(issue.received)}`;
	}
};

const short_name = s.parse(Account, {username: 'al', password: 'a', confirm: 'a'});
const short_name_es = short_name.ok ? [] : short_name.issues.map(translate_es);
// ['el nombre necesita al menos 3 caracteres']
const mismatched = s.parse(Account, {username: 'alice', password: 'a', confirm: 'b'});
const mismatched_es = mismatched.ok ? [] : mismatched.issues.map(translate_es);
// ['las contraseñas deben coincidir']
```

The catalogue reads `expected` as the library writes it, which doesn't tell everything apart:

- a bound is a number inside the text, `length >= 3` or `<= 10`, and a bigint's is written without its `n`
- a bigint and a number literal are written the same, so `one_of([1n, 1])` expects `1 | 1`
- `-0` is written `0`, in a literal and in a bound
- a `regex` expects the text it was given or its pattern, and a `check` the text it was given or `check`:
  the author's words, which a catalogue has nothing to translate from but a key

### Async checks

`parse` is synchronous, and async validation is not planned.
A check that awaits, as a lookup of whether a name is taken, runs on the output after `parse`,
and reports issues in the shape `fail` builds, so whatever reads issues reads its own:

<!-- recipe: async_checks -->

```ts
// an issue in the shape `fail` builds, so `format_issue` and a catalogue read it as any other
const issue_at = (path: Array<PropertyKey>, expected: string, received: string): s.SchemaIssue => ({
	kind: 'check',
	expected,
	received,
	path,
	message: undefined
});

// `parse`, then each check of the typed output in turn, awaited, stopping at the first that fails
const parse_then = async <T extends s.Schema>(
	schema: T,
	value: unknown,
	checks: ReadonlyArray<(output: s.Infer<T>) => Promise<Array<s.SchemaIssue>>>
): Promise<s.SchemaResult<s.Infer<T>>> => {
	const result = s.parse(schema, value);
	if (!result.ok) return result;
	for (const check of checks) {
		const issues = await check(result.value);
		if (issues.length) return {ok: false, issues};
	}
	return result;
};

const Signup = s.object({username: s.pipe(s.string, s.min_length(3)), email: s.string});
const is_taken = async (username: string): Promise<boolean> => username === 'alice'; // a lookup
const username_free = async (output: s.Infer<typeof Signup>): Promise<Array<s.SchemaIssue>> =>
	(await is_taken(output.username)) ? [issue_at(['username'], 'an unused username', 'string')] : [];

const signup = parse_then(Signup, {username: 'alice', email: 'a@b.c'}, [username_free]);
// resolves to {ok: false, issues: [{kind: 'check', expected: 'an unused username',
//   received: 'string', path: ['username'], message: undefined}]}
```

A failed `parse` runs no check.
A `check` given an async function is a type error, as its function returns a boolean,
and in untyped code it always passes: its promise is truthy.
A `transform` given one puts the promise in the output.

### Writing a schema

Most validation the library lacks is a `check` in a `pipe`.
A schema of its own is the one shape, `{kind, def, run}` in that order,
whose `run` returns the output or reports a failure with `fail`:

```ts
const Even: s.Schema<number> = {
	kind: 'even',
	def: undefined,
	run: (value, ctx) =>
		typeof value === 'number' && value % 2 === 0 ? value : s.fail(ctx, 'even', value, 'an even number')
};
```

As an entry, `run` is also handed the object, the key, and `1`, so a schema that accepts `undefined`
can tell a missing key: `Schema`'s doc comment says who passes them on,
and a `run` that reads them declares them as plain parameters.
`to_schema_json` and `to_json_schema` refuse a kind the library doesn't define.
The kind joins `SchemaDefs`, and so `SchemaNode`, by declaration merging, as a key joins [`SchemaMeta`](#metadata).
[`docs/design.md`](docs/design.md#running) has what a `run` may read of its `SchemaContext`.

### Introspection

A schema is data: `kind` names what it is and `def` holds what it was built from.
Not everything given is in `def`: the `expected` text of `regex` and `check`, the path of `check_at`, the text given to `message`, and the names given to `flavor` and `brand` are not.
`SchemaDefs` says what `def` is for every kind, and `SchemaNode` is the union over it,
so checking `kind` narrows `def`:

```ts
const unwrap = (schema: s.SchemaNode): s.SchemaNode => {
	switch (schema.kind) {
		case 'optional':
		case 'nullable':
		case 'with_default':
		case 'with_default_fn':
			return unwrap(schema.def.schema); // all four hold their schema as `def.schema`
		default:
			return schema;
	}
};

unwrap(User.def.age).kind; // 'number'
```

`def` is `undefined` for a kind with no options, the one value for a kind with one, as a `literal`'s value or a `one_of`'s array,
and an object or an array of what the others were given, as `optional`'s `{schema}`, an object schema's entries, and a `union`'s options in order:
[`docs/design.md`](docs/design.md#what-def-holds) has it for every kind.

`message`, `flavor`, and `brand` have no kind: the result has the `kind` and `def` of the schema given.
`void` has none either: it is a `literal` whose `def` is `undefined`.

`is_schema(value)` checks for the shape — an object with a string `kind`, a `def`, and a `run` function —
and narrows to `SchemaNode`. It is structural: it doesn't check that the kind is known
or that `def` matches it.
The narrowed type is for reading a schema as data: a schema typed with its kind keeps its own type,
while one typed as a bare `Schema` or `AnySchema` (as recursive schemas usually are) reads as `SchemaNode`,
whose output type is `unknown`.

`introspect.ts` has the walks a consumer would otherwise write:
`unwrap_schema` goes through `optional`, `nullable`, `with_default`, `with_default_fn`, `pipe`, and `lazy`;
`get_schema_meta` finds a key on the outermost layer that has it;
`find_schema_meta` finds every value of a key on any schema a value can reach:
every step of a `pipe`, every option of a `union` or a `variant`, and, with `{structural: true}`,
object entries and an `object_with_rest`'s `rest`, what an `array` or `record` holds, and a `keyed_record`'s key and value schemas,
reading each schema once so a recursion through one schema object ends;
`get_schema_entries` reads an object schema's entries under its wrappers, and `get_schema_fields` each one
with its default and description, never calling a `with_default_fn`'s function;
`format_schema_type` renders the type a schema accepts, for help output.

```ts
import {meta} from '@fuzdev/fuz_schema/meta.ts';
import {get_schema_fields, format_schema_type} from '@fuzdev/fuz_schema/introspect.ts';

const Args = s.object({port: meta(s.with_default(s.number, 3000), {description: 'the port'})});

get_schema_fields(Args);
// [{name: 'port', schema, has_default: true, default_computed: false, default: 3000, description: 'the port'}]
format_schema_type(Args); // '{port?: number}'
```

### Metadata

`meta` attaches metadata to a schema and `get_meta` reads it back.
They are a module of their own, backed by a `WeakMap`, so a schema stays `{kind, def, run}`
and a bundle that attaches no metadata carries none of the module: only `message`, which carries metadata over, reads the registry.

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
  metadata on a nested schema is reached by [walking](#introspection). `get_schema_meta` walks the layers,
  and `find_schema_meta` every schema a value can reach.
- `flavor` and `brand` return the schema itself, so its metadata is still there.
  `message` builds a new schema and carries the metadata over, the same object,
  so `meta` goes inside or outside it alike, and one outside merges as on any schema.
- Every copy of the module shares one `WeakMap`, on `globalThis`, so metadata attached through one
  is read through any other: a second install, a bundler's duplicate, or another version that
  keeps it there.

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
An issue there is `{message, path}`: the issue's `message`, or `expected X, received Y` where it has none, and its `path`.

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
among them `regex`, `check`, `transform`, and `with_default_fn`, which hold JS values
(`uuid` and `iso_datetime` are written, in place of a `regex` for a UUID or a date and time in UTC, and so is `to_lower_case`),
and `object_with_rest`, `keyed_record`, and `to_integer`, which the crate doesn't carry yet.
The text of `message` and the names of `flavor` and `brand` are not in a schema's data, and are not written,
and neither is metadata.
[`docs/rust.md`](docs/rust.md#what-is-refused) has the form and everything refused.

### JSON Schema

`to_json_schema` writes a schema as JSON Schema draft 2020-12, in the shapes Zod's `toJSONSchema` writes,
a module of its own. `io` picks the side of a parse it describes, `'output'` by default or `'input'`,
which differ on defaults, `strip_object`, `transform`, `to_lower_case`, and `to_integer`.

```ts
import {to_json_schema} from '@fuzdev/fuz_schema/json_schema.ts';

to_json_schema(s.object({name: s.string, port: s.optional(s.number)}));
// {$schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
//  properties: {name: {type: 'string'}, port: {type: 'number'}},
//  required: ['name'], additionalProperties: false}
```

It throws on what JSON Schema can't say, saying where, among them: a `bigint`, a `check`, a `transform` on the output side,
a `regex` with flags other than `d` and `u` or whose source isn't a pattern under `u`, a literal of `undefined`.
With `unrepresentable: 'any'` it writes `{}` there instead, or leaves out the keyword of a `pipe`'s step.
A mistake of the schema's author, as a metadata key that is a JSON Schema keyword, throws in both.
`to_lower_case` writes nothing, as Zod writes nothing for its `toLowerCase`,
and a step that reads another string than the document's is refused, one before it on the output side and one after it on the input side:
`s.pipe(s.string, s.min_length(1), s.to_lower_case)` is written on the input side only, where Zod writes the length on both.
A `uuid` holds of both strings, so `s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid')` is written as a `uuid`.
`to_integer` is an `integer` within the bounds after it on the output side, with nothing of the string, its metadata included,
and on the input side a `pattern` of exactly the strings it reads within them, where Zod writes the bare string:
`s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000))` takes `^(?:\+?0*(?:[1-9]\d{0,2}|1000))$`.
Metadata from `meta` is copied in. [`docs/design.md`](docs/design.md#json-schema) has the mapping and where it differs from Zod's.

## Status

> **status**: pre-1.0 — the schema library of the Fuz stack's packages, with an API that still changes and the gaps listed below

Before 1.0 a breaking change is a minor release.
A change to an inferred type that can stop a consumer's code compiling,
or that makes a type it exports accept or give other values, is a break.
A type that only prints under a new name is not, though declarations emitted against it then need that version,
which its changeset says. An added export is not.

- [x] the schemas and actions in the table above, with output and input type inference
- [x] custom messages, as an opt-in wrapper
- [x] Standard Schema v1, as an opt-in adapter
- [x] metadata, as an opt-in module
- [x] serializing a schema to JSON, as an opt-in module
- [x] JSON Schema output, as an opt-in module
- [x] copy-on-write output
- [x] `flavor` and `brand`, type-level only
- [ ] each option's issues for a failed `union`, which reports one issue at its own path: a `variant` reports the option its key picks, and [parsing again](#a-failed-unions-options) gets each option's
- [ ] `tuple`, `intersect`
- [x] extend, merge, pick, omit, and partial, as a spread of `def`, see [Composing object schemas](#composing-object-schemas)
- [ ] abort-early as a caller option
- [x] a published package
- [ ] the Rust side: the schema model, whether a JSON text matches, its issues, and a wasm build to measure are built, output is not
- [ ] async validation: not planned, see [Async checks](#async-checks)
- [ ] translated messages: no registry is planned, see [Translating issues](#translating-issues)

## Develop

```bash
npm i
gro check  # typecheck, test, gen check, format check, lint
gro test
```

The benchmarks, which [Measurements](#measurements) reads, and the deeper tests:

```bash
npm run benchmark             # parse time, every library on every scenario, and each as a guard
npm run benchmark:bundle      # bundle size per scenario and per export, minified and gzipped
npm run benchmark:allocations # heap bytes per parse and per schema built
npm run benchmark:coldstart   # a fresh process: import, build, first parse, peak memory, after gro build
npm run benchmark:heap        # memory still held after building and parsing
npm run benchmark:types       # what each library costs the TypeScript checker, after gro build
npm run benchmark:survey      # many small shapes against Valibot, Zod, and compiled Zod, by what a parse does
npm run benchmark:harvest     # consumers' own schemas and data, in their library and in this one
npm run benchmark:wasm        # the Rust crate as wasm against this library, after npm run build:wasm
npm run results -- --smoke    # each of them but the wasm, which --wasm adds, into one results file, briefly
npm run results:publish -- results/<file>.json # make a full run the published one
npm run differential          # generated schemas and inputs against Zod and Valibot, see docs/testing.md
npm run mutate                # break the library on purpose and check the tests fail
npm run fixtures:deep         # many generated JSON fixtures through the Rust fixture tests, see docs/rust.md
```

[`results/README.md`](results/README.md) has how a run is taken and published.

### Grading a change

```bash
npm run grade                       # the working tree against HEAD
npm run grade -- --against HEAD~2 --filter real/
npm run grade:aa -- .gro/grade/      # what saved grades of one version against itself say of each A/A
```

`grade` compares two versions of the library over a matrix of cases (realistic shapes, one case per code path, and the same shapes at scale):
time, a case's beside its floor and a summary's beside its A/A, what copies of one version differed by, heap bytes allocated, whether the output is the input itself,
and then bundle size, retained heap, and cold start. It checks the result against the rules a change is accepted by:
among them, bytes every user pays need a speedup in return, every scenario of one schema stays at or under 0.75 of Valibot's gzipped size,
or at the size a ruling pinned it at, and the valid path is never slowed to speed up the invalid one.
[`docs/grading.md`](docs/grading.md) has the rules in full.

The repo is also a Rust workspace, whose crates are the library's [Rust side](docs/rust.md)
and its wasm build. Neither is published; the npm package is the TypeScript library.

```bash
cargo test --workspace
npm run build:wasm      # needs wasm-pack
```

## Docs

- [`docs/design.md`](docs/design.md) — the internals and why: the one shape,
  probe mode, copy-on-write and what it gives up, issues and messages, the
  types of the schemas, metadata, JSON Schema
- [`docs/benchmarks.md`](docs/benchmarks.md) — what each benchmark measures and how,
  how far to trust each number, and how to extend them
- [`docs/testing.md`](docs/testing.md) — what holds the library to more than its own examples:
  conformance, the differential, the JSON fixtures, and mutants
- [`docs/grading.md`](docs/grading.md) — `npm run grade` and the rules a change is accepted by
- [`docs/declined.md`](docs/declined.md) — trades that were measured and not taken, each with
  what it gave, what it cost, and what would reopen it
- [`docs/formats.md`](docs/formats.md) — the grammars of `uuid`, `iso_datetime`, and `to_integer`,
  and what decides a grammar where Zod and Valibot disagree
- [`docs/rust.md`](docs/rust.md) — the Rust side: the model, the interchange form,
  the two evaluators, the issues, where they differ from this library, what is
  refused, the fixtures, and the wasm build
- `CLAUDE.md` — layout, commands, and invariants (also the context file for AI agents)
- [fuz-stack skill](https://docs.fuz.dev/skills/fuz-stack) — coding conventions shared across the Fuz stack

## Credits

[Valibot](https://valibot.dev/) for the strategy this builds on and
[Zod](https://zod.dev/) before it.
The process-per-sample cold-start and retained-heap methods follow
[syntax-highlighter-bench](https://github.com/ryanatkn/syntax-highlighter-bench),
which generalizes [Twinkleplop](https://github.com/pngwn/twinkleplop)'s cold-start harness.

Valibot's source was not consulted while writing fuz_schema; the comparison libraries are used only
through their public APIs, as benchmark baselines.

## Contributing

[fuz.dev/contributing](https://www.fuz.dev/contributing)

## License [🐦](https://wikipedia.org/wiki/Free_and_open-source_software)

[0BSD](LICENSE)
