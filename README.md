# fuz_schema

> a performance-focused schema library for JS - [schema.fuz.dev](https://schema.fuz.dev/)

fuz_schema is a schema validation library for TypeScript and JS.
It takes [Valibot](https://valibot.dev/)'s strategy —
one tree-shakeable function per schema, schemas as plain data, `pipe` for refinement —
and asks how far that can be pushed on bundle size, speed, and memory
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

const result = s.parse(User, input);
if (result.ok) result.value;
else result.issues; // [{kind, expected, received, path, message}]
```

Of the libraries it is measured against, it has the smallest bundle, the quickest bundled cold start, and the least memory held,
and it is not the fastest: Zod compiled ahead of time by `z.compile` and TypeBox's compiled `Check` check valid input faster.
Its output is not a fresh copy: a valid input that needs no change comes back as itself, see [What copy-on-write gives up](#what-copy-on-write-gives-up).
[Measurements](#measurements) has each claim, held by a test to the published benchmark run, and the rest.

fuz_schema is published as `@fuzdev/fuz_schema`, has no stable API, and is missing a lot.

```bash
npm i @fuzdev/fuz_schema
```

Every export and type is in the API docs at [schema.fuz.dev/docs](https://schema.fuz.dev/docs).
The package declares no `engines`. The newest built-ins the library calls are
`Array.prototype.toReversed`, only when `message` is given a function, and `String.prototype.isWellFormed`, only in `to_schema_json`,
both in Node 20. The repo's own tests and benchmarks need Node 24.14, for its type stripping, as `devEngines` says.

AI disclosure: this codebase is LLM-generated, by [Claude Code](https://claude.com/claude-code)
using Claude Opus 5.5, with a human steering the design.

## Measurements

The benchmarks in `src/benchmarks/` compare this library with Valibot, Zod (as it is imported,
with each root compiled ahead of time by `z.compile`, and as Zod Mini), TypeBox, and ArkType.
[The benchmarks page](https://schema.fuz.dev/docs/benchmarks) has every number, rendered from one published results file,
[`results/latest.json`](results/latest.json), which names the machine, the versions, and the commit it came from.
A mean in a claim is of two libraries over the scenarios both have a figure of, where the page's leave out `type_json`,
which `z.compile` hands back uncompiled. `src/test/readme_measurements.test.ts` holds each bullet of the list to that file:

<!-- claims: each bullet is held to results/latest.json by src/test/readme_measurements.test.ts -->

- **Size:** the smallest bundle of the libraries compared, minified and gzipped, for every scenario and for all of them together.
- **On valid input:** faster than Valibot, Zod as it is imported, Zod Mini, and ArkType as a geometric mean over the scenarios, though Zod as it is imported and ArkType are each faster on some of them;
  Zod with its roots compiled ahead of time by `z.compile` is faster over the scenarios it compiles, and so is TypeBox, whose check builds no output and no issues.
- **On invalid input:** faster than Valibot, ArkType, and Zod in each of its modes on every scenario each has a figure of;
  TypeBox, whose check stops at the first failure and builds no issues, is faster as a geometric mean.
- **As a guard,** where a library only answers whether a valid input matches: faster than Valibot, Zod as it is imported, and Zod Mini as a geometric mean over the scenarios,
  though Zod as it is imported is faster on some of them; TypeBox, ArkType, and compiled Zod are faster over the scenarios each has a figure of.
- **On the recursive scenario,** `type_json`, a real schema: faster on valid input and as a guard than Valibot, Zod as it is imported, Zod Mini, TypeBox, and ArkType.
- **Allocation:** a parse of valid input allocates fewer heap bytes than Valibot's, plain Zod's, or Zod Mini's on every scenario.
- **Cold start:** a bundled entry imports, builds its schema, and parses once, and a hundred times, in less time than any of the libraries compared, on every scenario measured.
- **Retained memory:** the least held of the libraries compared once a schema is built and has parsed once, on every scenario measured.
- **Type-checking cost:** fewer instantiations than Valibot, Zod as it is imported, compiled Zod, and ArkType, for a module of every scenario and with a consumer's reads of the types it infers.

<!-- /claims -->

A valid parse that returns its input allocates the same few bytes for a list of records as for one record, as the page's allocation table shows,
except where something makes a new value: a copy where an entry changed or a key is dropped,
`to_lower_case` the string it returns whatever its case, and a `memo_union` its memo when it is probed.
Against Zod Mini and TypeBox, which has fewer instantiations turns on whether a consumer reads the inferred types.
The exact bytes of this library's bundles, per scenario and per export, are in [`src/benchmarks/sizes.json`](src/benchmarks/sizes.json), which `src/test/sizes.test.ts` keeps current.

Caveats:

- The scenarios are few and small. `type_json` is a real schema taken from [svelte-docinfo](https://github.com/fuzdev/svelte-docinfo);
  the rest are synthetic.
- Timings come from one machine, which the page names with its state as the run started and ended, and nothing is pinned or isolated.
  Bundle sizes are exact. Allocation is exact for the code the engine is running when it is sampled,
  which a process settles and not always the same way, so a figure repeats within about a percent.
- It isn't like-for-like. Valibot does more, TypeBox's check builds no output and no issues,
  and where this library returns its input Valibot and Zod return a copy of it.
  A guard row sets the copy aside only where the guard builds no output: Valibot's `is`,
  and Zod's `z.validate` where a schema has no compiled path, run the parser, which still copies what it reads.
- `src/test/benchmarks.test.ts` holds every library to the same answer on every scenario's valid and invalid input,
  so the benchmarks at least compare the same question.

[`docs/benchmarks.md`](docs/benchmarks.md) has the method behind every number.

## When not to use it

- Where the fastest check of valid input matters most, and code generated at runtime is allowed: see [Measurements](#measurements).
- Off V8: the one shape is tuned to V8's hidden classes, and nothing is measured on another engine.
- For async validation or a registry of translated messages, neither designed yet: custom text is per schema, through [`message`](#issues).
- For `tuple` or `intersect`, which it doesn't have, or for a failed `union`'s nested issues.
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
  A caller who needs a snapshot parses a clone, `s.parse(schema, structuredClone(input))`.
- A class instance that matches comes back as that instance, not a plain object.

What it doesn't give up: `strip_object` still drops unknown keys, by copying when there are any,
and the input is never mutated.
The rest, a copy's second read, key order, prototypes, and what a clone and a revoked `Proxy` do, is in [`docs/design.md`](docs/design.md#copy-on-write-output).
Against a `strip_object` that always copies, an input with a key to drop parses slower and one with nothing to drop faster,
see [Always a copy](docs/declined.md#always-a-copy) and the [other ways tried](docs/declined.md#dropping-keys),
and a default applied late in a wide object reads the keys before it a second time,
which [a copy filled from the start](docs/declined.md#a-copy-filled-from-the-start-when-an-entry-has-a-default) avoided and was declined for.

### Other differences in behavior

- `pipe` stops at its first failing step.
- A failed `union` reports one issue, not its options' issues, and names each option once, as `received` names values:
  `union([nullable(string), one_of(['a', 'b']), pipe(number, check(..))])` reads `expected string | null | "a" | "b" | number`,
  by the rule in [`docs/design.md`](docs/design.md#issues).
- A missing object key is the `undefined` it reads as, except to the schemas [Missing keys](#missing-keys) names,
  which need their key as in Valibot and Zod.
- `number` refuses `NaN` and the infinities, as Zod's does, where Valibot's takes the infinities.
  An infinity reaches a parse from JSON too: `JSON.parse('1e999')` is `Infinity`.
  `integer` takes an integer past the safe range, as Valibot's does, and `safe_integer` doesn't.
- `pipe(string, uuid)` takes a UUID of RFC 9562 with a version from 1 to 8, as Zod's does,
  and the max UUID in any case, as Valibot's does.
  `pipe(string, iso_datetime)` takes `2024-02-29T23:59:59.123Z` in UTC with a real date, as Zod's does,
  and a fraction of at most 9 digits, as Valibot's `isoTimestamp` does,
  and refuses an offset and a space for the `T`, which `isoTimestamp` takes. See [`docs/formats.md`](docs/formats.md).
- `pipe(string, to_lower_case)` gives `toLowerCase()` of the string, as Zod's `toLowerCase` and Valibot's do,
  and the steps after it are given the lowercase: `s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid')`
  takes a UUID in either case and gives it lowercase, as RFC 9562 asks.
  A `brand` or `flavor` goes outside a step that changes the value, as there:
  one on a step before it is dropped, as the output is a new string.
- `with_default` fills in the value it was given, the same one on every parse,
  where Zod fills in a copy and Valibot what its schema makes of it,
  so an array or object default is shared by every output it fills.
  `s.with_default_fn(s.array(s.string), () => [])` calls its function for each value it fills in.
  Neither validates the default, as in Zod.
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  `strip_object` drops them and `loose_object` keeps them.
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
| `record(key, value)` | `record(key, value)` | `record(value)`, keys not checked |
| `finite` | | nothing: `number` refuses what isn't finite |
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
| containers | `object`, `loose_object`, `strip_object`, `object_with_rest`, `record`, `array`, `union`, `memo_union`, `variant` |
| refinement | `pipe`, `check`, `check_at`, `transform`, `to_lower_case`, `regex`, `min_length`, `max_length`, `min_value`, `max_value`, `integer`, `safe_integer` |
| formats | `uuid`, `iso_datetime` |
| entry points | `parse`, `parse_or_throw`, `is` |
| issues | `format_issue`, `format_issue_with_value`, `get_issue_value`, `SchemaError`, `fail` |
| introspection | `is_schema`, `SchemaNode`, `SchemaKind`, `SchemaDef`, `SchemaDefs`, `SchemaOfKind` |
| types | `Infer`, `InferInput`, `Schema`, `AnySchema`, `SchemaContext`, `SchemaAction`, `SchemaRefinement`, `SchemaIssue`, `SchemaResult`, `Flavored`, `Branded` |
| types of the schemas | `ObjectSchema`, `StripObjectSchema`, `LooseObjectSchema`, `ObjectWithRestSchema`, `ArraySchema`, `RecordSchema`, `UnionSchema`, `VariantSchema`, `OptionalSchema`, `NullableSchema`, `WithDefaultSchema`, `WithUndefinedDefaultSchema`, `WithDefaultFnSchema`, `WithUndefinedDefaultFnSchema`, `LazySchema`, `PipeSchema`, `SchemaPipeDef`, `BrandSchema`, `FlavorSchema`, `LiteralSchema`, `OneOfSchema`, `StringSchema`, `NumberSchema`, `BooleanSchema`, `BigintSchema`, `UnknownSchema`, `VoidSchema` |
| types to name a schema's | `SchemaEntries`, `SchemaStrictObjectOutput`, `SchemaStrictObjectInput`, `SchemaStripObjectInput`, `SchemaObjectOutput`, `SchemaObjectInput` |

The rest of the types, the `*Def` types of `def`, `Flavor` and `Brand`, and those of the other modules
(`SchemaMeta`, `SchemaField`, `SchemaJson`, `JsonSchema`, the `Standard*` types), are in the API docs.

`parse` returns `{ok: true, value}` or `{ok: false, issues}`.
`parse_or_throw` returns the value or throws a `SchemaError` listing the first ten of its issues and how many more failures there were.
`is` answers yes or no without building issues.

```ts
// refinement: a pipe runs its steps in order and stops at the first that fails
const Port = s.pipe(s.number, s.integer, s.min_value(1), s.max_value(65535));
const Tags = s.pipe(s.string, s.transform((text) => text.split(',')));

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

A `pipe` takes one to four actions; a pipe of more starts with a pipe, `s.pipe(s.pipe(schema, a, b, c, d), e)`.
A recursive schema needs its type written, and annotated as `s.Schema<Tree>` it has no `kind` or `def` in its type,
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
as Zod's `catchall` and Valibot's `objectWithRest` do.
None of them accepts an array, and neither do `record` and `variant`.
With no entries, `object` and `strip_object` output `Record<string, never>`, not `{}`,
which TypeScript reads as any value but `null` and `undefined`.

`s.void` is `s.literal(undefined)` typed `void`, in and out, so a parameter typed from it can be left out:
`(input: s.Infer<typeof s.void>) => ...` is called as `f()`. Every reader of a schema takes it as that literal.

### Missing keys

A key the input lacks reads as `undefined`, so it fails unless its entry accepts that.
`optional`, `with_default`, and `with_default_fn` do, which is how a key is made optional,
and a `union` with an option that lets the key be missing makes the key optional.

`unknown`, `literal(undefined)` (and so `s.void`), and a `one_of` with `undefined` among its values
accept `undefined` and still need their key, own or inherited, as in Valibot and Zod:
`{}` doesn't match `s.object({a: s.unknown})` and `{a: undefined}` does.
They need it under `nullable`, `lazy`, `message`, a `union`, and at the start of a `pipe` too,
so `{}` doesn't match `s.object({a: s.nullable(s.unknown)})` either: write `s.optional(s.unknown)` for a key that may be missing.
Their missing key is a `missing_key` issue, `a: expected a required key, received undefined`, except under a `union`, whose own issue it is,
and one whose schema refuses `undefined` has that schema's issue.
Valibot and Zod also need the key of a bare `check` entry (their `custom`), which here accepts a missing key.

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
with two such options the time doubles with each level, see [`docs/design.md`](docs/design.md#unions-and-recursion).
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

A `message`, `brand`, or `meta` on the base is not carried over.
A generic function that overrides a key types its entries as `Omit<T, keyof U> & U`,
since a spread of generic entries types as `T & U` and an overridden key's type collapses.

### Exporting schemas from a library

Every schema the library makes but a `pipe` has a type named for its factory,
whose type arguments are only what the factory was given: `s.object(entries)` is an `s.ObjectSchema<typeof entries>`,
`s.array(schema)` an `s.ArraySchema<typeof schema>`, and `s.string` an `s.StringSchema`.
So the declaration emitted for an exported schema writes each schema it holds by its name,
and doesn't write out its output or its input, with two exceptions.
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

A doc comment on an entry is its property's in the output and input types, the named ones included,
so the entries are where a field is documented.
`strip_object` has `SchemaStripObjectInput` for its input, and `loose_object` has
`SchemaObjectOutput` and `SchemaObjectInput`, each `& Record<string, unknown>`.

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

- `kind` is the kind of the schema or action that failed, or `unknown_key` or `missing_key`
- `expected` says what was expected
- `received` is the type of the value that failed: `'null'`, `'array'`, or its `typeof`,
  but a number that isn't finite is `'NaN'`, `'Infinity'`, or `'-Infinity'`
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

`format_issue` writes an issue as `path: expected X, received Y`, the keys joined with `.`,
with no `path: ` for an issue at the root, and with the issue's `message` in place of the
`expected X, received Y` where it has one.
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
- `optional` and `nullable` hold `{schema}`, `with_default` holds `{schema, value}`,
  and `with_default_fn` holds `{schema, make}`
- the object schemas hold their entries, and `object_with_rest` holds `{entries, rest}`,
  `array` and `record` the schema of their items,
  `union` and `pipe` their schemas in order, and `variant` holds `{key, options}`

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
every step of a `pipe`, every option of a `union`, and, with `{structural: true}`,
object entries and what an `array` or `record` holds, reading each schema once so a recursion through one schema object ends;
`get_schema_entries` and `get_schema_fields` read an object schema's entries under its wrappers,
with each one's default and description, and never call a `with_default_fn`'s function;
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
and `object_with_rest`, which the crate doesn't carry yet.
The text of `message` and the names of `flavor` and `brand` are not in a schema's data, and are not written.
[`docs/rust.md`](docs/rust.md#what-is-refused) has the form and everything refused.

### JSON Schema

`to_json_schema` writes a schema as JSON Schema draft 2020-12, in the shapes Zod's `toJSONSchema` writes,
a module of its own. `io` picks the side of a parse it describes, `'output'` by default or `'input'`,
which differ on defaults, `strip_object`, and `transform`.

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
`to_lower_case` writes nothing, as Zod writes nothing for its `toLowerCase`,
and `s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid')` is written as a `uuid`.
Metadata from `meta` is copied in. [`docs/design.md`](docs/design.md#json-schema) has the mapping and where it differs from Zod's.

## Status

> **status**: early — the API is unstable and incomplete

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
- [ ] nested issues for a failed `union`
- [ ] `tuple`, `intersect`
- [x] extend, merge, pick, omit, and partial, as a spread of `def`, see [Composing object schemas](#composing-object-schemas)
- [ ] abort-early as a caller option
- [x] a published package
- [ ] the Rust side: the schema model, whether a JSON text matches, its issues, and a wasm build to measure are built, output is not
- [ ] async validation, i18n: not designed yet

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
npm run benchmark:coldstart   # a fresh process: import, build, first parse, peak memory
npm run benchmark:heap        # memory still held after building and parsing
npm run benchmark:types       # what each library costs the TypeScript checker
npm run benchmark:survey      # many small shapes against Valibot and Zod, by what a parse does
npm run benchmark:harvest     # consumers' own schemas and data, in their library and in this one
npm run benchmark:wasm        # the Rust crate as wasm against this library, after npm run build:wasm
npm run results -- --smoke    # every one of them into one results file, briefly
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
time, each beside what copies of one version differed by, its A/A, heap bytes allocated, whether the output is the input itself,
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
- [`docs/formats.md`](docs/formats.md) — the grammars of `uuid` and `iso_datetime`,
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
