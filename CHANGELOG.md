# @fuzdev/fuz_schema

## 0.5.0

### Minor Changes

- **breaking** fix: a failing parse reports at most a hundred issues, so deep input can't exhaust memory ([d276d50](https://github.com/fuzdev/fuz_schema/commit/d276d50))

  - `parse` and a Standard Schema's `validate` return the first hundred issues of an input that fails more often, with nothing to say more were found, and `parse_or_throw`'s `SchemaError` carries the same hundred
  - a deep input with many failing values at the bottom held memory in the product of its size and its depth: a 206 KB JSON text held over a gigabyte
  - a `SchemaError`'s message lists the first ten issues and then `and N more`, where it listed every one: `error.issues` has every issue the parse reported
  - a custom schema's `run` that reads `ctx.issues` from a count finds an issue only below the hundredth: past it `fail` counts the failure and builds none

- **breaking** feat: `message` labels every issue of the schema it wraps, its children's included ([b263ab4](https://github.com/fuzdev/fuz_schema/commit/b263ab4))

  - an outer `message` now sets its text on every issue beneath it, at any path, that has no message yet, and on an object's `unknown_key` and a `variant`'s discriminator issue, as Valibot's `v.message` does
  - a `missing_key` of an entry is labeled by a `message` around the object too
  - the innermost `message` still wins: to keep a different text on a child, wrap that child in its own `message`
  - a `message` function is called for a child's issue too, with the value the wrapped schema was given and the issue's `path` relative to it, so `get_issue_value(issue, value)` finds the child's

- **breaking** fix: a failing `parse` of deep input with many issues no longer takes cubic time ([fb11b0c](https://github.com/fuzdev/fuz_schema/commit/fb11b0c))

  - a deeply nested input with many failing values at the bottom took time in the cube of its size, which a small JSON text could use to stall a parse: it now takes time in proportion to the paths it returns
  - a custom schema's `run` that reads `ctx.issues` sees each path innermost first, and one that reports a child's issues under a key pushes the key onto their paths, where before it prefixed it
  - a `message` function is handed a copy of the issue: changing its argument no longer changes the issue

- **breaking** fix: a `pipe` refuses an action whose input is narrower than the step before it ([ba43c41](https://github.com/fuzdev/fuz_schema/commit/ba43c41))

  - `pipe(nullable(number), min_value(0))`, `pipe(optional(string), min_length(1))`, and `pipe(unknown, min_value(0))` no longer compile: put the pipe inside, `nullable(pipe(number, min_value(0)))`, or start it with a schema of the type the action takes
  - an annotated `check` or `transform` in a `pipe` is refused when its parameter is narrower than what it is given, as `check((n: number) => ...)` after `nullable(number)`
  - `SchemaAction` is an interface that extends `Schema`, takes the kind and the `def` as its third and fourth type parameters, and every action is typed as one: a schema that isn't an action is no longer assignable to it, as `const a: SchemaAction<string> = string`
  - `message`, `meta`, `brand`, and `flavor` given an action return a `SchemaAction`, so `pipe(nullable(string), brand(regex(/n/), 'R'))` no longer compiles either
  - an action under `lazy` or `union`, or at the start of a `pipe` used as a step, is still checked by its input alone, as a schema is

### Patch Changes

- fix: `variant` refuses a `with_default` or `object_with_rest` option that its types let through ([6f83d7a](https://github.com/fuzdev/fuz_schema/commit/6f83d7a))

  - a `with_default` whose value is a schema or of type `any`, a `with_default_fn` whose `make` returns `any`, and an `object_with_rest` whose entries are of type `any` no longer compile as an option
  - the `def` of `with_default` is typed `SchemaDefaultDef`, of `with_default_fn` `SchemaDefaultFnDef`, and of `object_with_rest` `SchemaObjectWithRestDef`, three new interfaces
  - the `def` types the wrappers, `object_with_rest`, and `variant` give are `readonly`, as `SchemaDefs` has them

- feat: add `memo_union`, a `union` linear in depth where recursive options walk the same children ([2e35c64](https://github.com/fuzdev/fuz_schema/commit/2e35c64))

  - `memo_union(options)` gives what `union(options)` gives, verdicts, outputs, and issues, and is of kind `union`, so `to_schema_json` and the readers take it as one
  - it keeps, for one parse, what it gave each object or array it was probed with: use it where two options could take the same object and reach a `lazy` before a `literal` tells them apart, and on each union of a chain of them
  - a `transform`, a `check`, or a `with_default_fn`'s `make` under it can run fewer times, and an object the input holds twice gets one output object in both places
  - the answer on an object is kept as the object's alone, which a getter, a `Proxy`, or a `check` with state can break

- feat: a `pipe` takes an action that accepts more than it is given, and a refinement keeps the type ([134fc09](https://github.com/fuzdev/fuz_schema/commit/134fc09))

  - `pipe(string, check((v: unknown) => ...))` compiles: an action as a step is checked by what it takes, as a parameter is, and any other step by its input, as before
  - `regex` and `check` are typed from the step before them, as `min_length` is: `pipe(literal('abc'), regex(/a/))` outputs `'abc'`, and a brand before them is kept
  - every action but `transform` is a `SchemaRefinement`, and a `pipe` outputs the type of the step before one: `pipe(one_of([1, 2]), integer)` outputs `1 | 2`; a `transform` is not assignable to a `SchemaRefinement`, and `message` and `meta` keep one: `pipe(one_of([1, 2]), message(integer, 'm'))` outputs `1 | 2` too
  - `check` takes a second type parameter, `check<V extends T, T = V>`, the first what it is given and the second what `fn` takes

- fix: a generic helper that pipes into an action emits a declaration that compiles ([52d9155](https://github.com/fuzdev/fuz_schema/commit/52d9155))

  - `<T extends Schema<string>>(x: T) => pipe(x, min_length(1))` emitted a `.d.ts` naming an undeclared `T_1`; it now names the exported `Uninferred`

## 0.4.0

### Minor Changes

- **breaking** fix: a failed `union` names its options as `received` names values ([95574f5](https://github.com/fuzdev/fuz_schema/commit/95574f5))

  - a `nullable` option reads as its schema and then `null`, so `union([nullable(string), number])` reads `expected string | null | number` where it read `expected nullable | number`
  - a `literal` or a `one_of` option reads as its values, written as they are standalone: `union([literal('a'), one_of([1, null])])` reads `expected "a" | 1 | null` where it read `expected literal | one_of`
  - `loose_object`, `strip_object`, `object_with_rest`, `record`, and `variant` options read as `object`, and an `optional`, `with_default`, or `with_default_fn` option as its schema
  - each part is named once by its text, so a `nullable`'s `null` and a `literal(null)` read as one `null`
  - code that matched a kind's name, such as `nullable` or `literal`, in a union's `expected` no longer finds it

## 0.3.0

### Minor Changes

- **breaking** fix: an action used as an entry or option is typed from `unknown`, not `any` ([202f445](https://github.com/fuzdev/fuz_schema/commit/202f445))

  - a `check` or `transform` with an unannotated parameter, as an object entry, a `union` option, an entry of a `variant` option, or a `message` there, is given `unknown`: `object({a: check((v) => v.foo)})` no longer compiles. Put it in a `pipe`, or annotate the parameter
  - `min_length` and `max_length` there take `{length: number}`, and `min_value` and `max_value` `number | bigint`, where all four were `any`
  - `SchemaEntries` and the schemas the factories and `parse`, `parse_or_throw`, and `is` take are typed `Schema`, of `unknown` output, where they were `AnySchema`. Every schema is still accepted, and a function generic over `T extends AnySchema` still passes its `T`

- **breaking** fix: a `pipe` that ends in an unannotated `check` infers its type as an entry or option ([a08e921](https://github.com/fuzdev/fuz_schema/commit/a08e921))

  - `object({name: pipe(string, check((v) => v.length > 0))})` infers `name: string`, and `v` is a `string`, where both were `any`, with any steps before the `check` too, in a `union` option, an entry of a `variant` option, and a `message` there
  - code that compiled through that `any` may now have type errors to fix, as a typo in the `check`'s function
  - a `pipe` no longer takes its output type from the type it is assigned or returned as: a `transform` that returns a single literal, as `() => 'a'` or `() => ({k: 'a'})`, now gives `string` or `{k: string}` there and needs `as const` or an annotated return. One that returns either of several strings, numbers, or booleans, as `(v) => (v ? 'a' : 'b')`, keeps them; either of several objects, as `(v) => (v ? {k: 'a'} : {k: 'b'})`, gives `{k: string}` and needs `as const` too

- **breaking** fix: a number that isn't finite is received as `NaN`, `Infinity`, or `-Infinity` ([9a70a76](https://github.com/fuzdev/fuz_schema/commit/9a70a76))

  - an issue's `received` is `'NaN'`, `'Infinity'`, or `'-Infinity'` for such a number, wherever it fails, where it was `'number'`: code that reads `received === 'number'` no longer sees them
  - so `number` refusing `NaN` reads `expected number, received NaN`, as in Zod, and `string` given `-Infinity` reads `expected string, received -Infinity`
  - `get_issue_value` names types the same way, and finds the value it did before

### Patch Changes

- fix: `record` leaves an own `__proto__` key that failed out of the copy it makes after it ([8ccf655](https://github.com/fuzdev/fuz_schema/commit/8ccf655))

  - an own `__proto__` key whose value fails, followed by a value the schema changes, no longer sets the copy's prototype: the parse fails at `__proto__` instead of throwing or calling a setter that prototype has

- fix: a failed `union` expects the options of a `union` or a `pipe` among its options ([9a70a76](https://github.com/fuzdev/fuz_schema/commit/9a70a76))

  - a `union` among the options adds its own, at any depth, so `union([string, union([string, loose_object({...})])])` reads `expected string | loose_object` where it read `expected string | union`
  - a `pipe` among them adds its first schema's, so `union([number, pipe(string, check(..))])` reads `expected number | string` where it read `expected number | pipe`
  - each kind is named once, where it first appears: `union([object({a}), object({b})])` reads `expected object`
  - any other option is its kind, as before: `nullable`, `literal`, and `lazy` among them

## 0.2.2

### Patch Changes

- feat: add `object_with_rest`, an object whose other keys are each validated by one schema ([72bc3dc](https://github.com/fuzdev/fuz_schema/commit/72bc3dc))

  - `s.object_with_rest({_: s.array(s.string)}, s.number)` matches `{_: [], a: 1}` and refuses `{_: [], a: 'x'}` at the key `a`, as Zod's `catchall` and Valibot's `objectWithRest` do
  - its other keys are its own enumerable string keys: an own `constructor` or `prototype` is validated as any other, as in Zod, and an inherited key is not, as in Valibot; an own `__proto__` key is left out unread, and an array is refused
  - the entries' issues come first, then the other keys' in the input's order; the output is the input when nothing changed, and a copy has the schema's keys first
  - `get_schema_entries` and `get_schema_fields` read its entries, and `format_schema_type` renders the rest as `[key: string]: ...`
  - `to_schema_json` refuses it, as the Rust crate doesn't carry it

## 0.2.1

### Patch Changes

- fix: metadata is shared by every copy of `meta.ts`, so no copy drops what another attached ([a6aec1a](https://github.com/fuzdev/fuz_schema/commit/a6aec1a))

  - `get_meta` reads metadata `meta` attached through any copy of the module: a second install, another version, a bundler's duplicate
  - the registry is a `WeakMap` on `globalThis` under `Symbol.for('@fuzdev/fuz_schema/meta')`: a copy of 0.2.0 or earlier keeps one of its own, and shares nothing with the rest: upgrade every copy to share
  - a bundle that never calls `meta` or `get_meta` still carries none of it

## 0.2.0

### Minor Changes

- **breaking** fix: `object`, `strip_object`, `loose_object`, `record`, and `variant` reject arrays ([07fcc96](https://github.com/fuzdev/fuz_schema/commit/07fcc96))
- **breaking** feat: for a custom schema, `ctx.issues` may be `undefined`, and `run` may get the key ([d2e9e22](https://github.com/fuzdev/fuz_schema/commit/d2e9e22))

  - `SchemaContext.issues` is `undefined` until the first failure: a `run` that reads it handles `undefined`, and reports a failure with `fail` as before
  - an object schema calls an entry's `run` with three more arguments, the object, the key, and `1`, which says the schema is the entry itself, typed in `Schema.run` as the optional `parent`, `key`, and `entry`
  - a `run` that reads them declares them as plain parameters, with no default and not as a rest: `nullable`, `union`, a `pipe` to its first schema, and `message` pass them on only to a `run` whose `length` says it takes them
  - a `run` of two parameters works anywhere, as before

- **breaking** feat: an issue no longer holds the value that failed, only its type name ([70d6c18](https://github.com/fuzdev/fuz_schema/commit/70d6c18))

  - `value` is replaced by `received`: `'null'`, `'array'`, or the value's `typeof`, so issues and `SchemaError` can be logged and kept without the input; `to_type_name` is removed, use `issue.received`
  - a `message` function is handed the value as a second argument: `message(schema, (issue, value) => text)`
  - add `get_issue_value(issue, input)`, which reads the value back out of the parsed input, returning `{ok: true, value}` or `{ok: false}`
  - `format_issue` and `SchemaError` quote a path key that isn't only word characters as JSON: `"a.b": ...` for a key named `a.b`
  - an issue's `path` is a new array at each level it is prefixed: a `message` function that keeps the `path` it is handed no longer sees the keys added after

- **breaking** feat: `picklist` is `one_of`, every kind is its export's name, and `def` is typed ([d2e9e22](https://github.com/fuzdev/fuz_schema/commit/d2e9e22))

  - rename `picklist` to `one_of`, with schema and issue kind `'one_of'`; `with_default` has kind `'with_default'`, was `'default'`
  - `optional` and `nullable` hold their schema as `def.schema`, as `with_default` does, where `def` was the schema
  - add the types of what each kind's `def` holds, `SchemaDefs`, `SchemaKind`, `SchemaDef`, `SchemaNode`, and `SchemaWrapperDef`, and the guard `is_schema`; a `pipe`'s `def` is typed `ReadonlyArray<SchemaNode>`
  - rename the types `Action` to `SchemaAction`, `Literal` to `SchemaLiteral`, `ObjectInput` and `ObjectOutput` to `SchemaObjectInput` and `SchemaObjectOutput`, and `Pipe` to `SchemaPipeFactory`; `Flatten` is no longer exported
  - `pipe()` with no schema throws, where it returned a schema that accepted anything

- **breaking** feat: a copy `loose_object` makes has the keys Zod's and Valibot's give, in their order ([38069e0](https://github.com/fuzdev/fuz_schema/commit/38069e0))

  - the schema's keys first, in the schema's order, then the input's own enumerable string keys the schema doesn't name, in the input's order; it was the input's order, with a key it lacked last
  - a schema key the input inherits or has as non-enumerable is an own key of the copy, where it was left out
  - a symbol key, and a `__proto__` key the schema doesn't name, are left out, where they were copied; an unknown key the input inherits is left out as before, as in Valibot and not Zod
  - a schema entry named `__proto__` is written as `object` and `strip_object` write it, which sets the copy's prototype, where it was an own key
  - the input still comes back as it is when no entry changed; a copy costs more than it did, most where the input has many keys the schema doesn't name

- **breaking** fix: `Flavored` and `Branded` keep the `null` and `undefined` of their type ([718d23e](https://github.com/fuzdev/fuz_schema/commit/718d23e))

  - `Flavored<string | null, 'N'>` is the flavored string or `null`, where it was the flavored string alone, and `Flavored<null, 'N'>` is `null`, where it was `never`
  - so `flavor` and `brand` around a schema whose output has either, as `nullable(string)` and `optional(string)` do, infer what the parse returns
  - a plain `null` or `undefined` is assignable to a branded type that has one
  - in generic code, of a type parameter neither is known to be absent: `Branded<T, 'N'>` with `T extends string` is not assignable to `Branded<string, 'N'>`, one with an unconstrained `T` is possibly `null` or `undefined`, and two flavors of one constrained `T` assign to each other
  - every other type is as before

- **breaking** feat: `number` refuses `Infinity` and `-Infinity`, and `finite` is removed ([8778d79](https://github.com/fuzdev/fuz_schema/commit/8778d79))

  - an infinity fails `number` wherever it is, as in Zod and not Valibot, with the `number` issue `NaN` gets, which reads `expected number, received number`
  - `finite` and its issue kind are removed, as `number` does what it did: write `number` for `pipe(number, finite)`
  - a `pipe` that starts with `number` stops there for an infinity, and a JSON text's `1e999`, which `JSON.parse` reads as `Infinity`, fails it
  - `integer` still takes an integer past the safe range, where `safe_integer` doesn't; a `literal` or a `one_of` of an infinity still matches it; and an infinity is still a bound of `min_value` and `max_value`

- **breaking** perf: `one_of` matches in constant time, whatever the length of its values ([21b21d3](https://github.com/fuzdev/fuz_schema/commit/21b21d3))

  - it holds a `Set` of its values, built when the schema is made: a few hundred bytes of heap for each `one_of`, more for a long list
  - `values` are read once, when the schema is made: changing the array afterwards changes `def` and not what the schema matches, where a value pushed onto it was matched

- **breaking** feat: a `pipe` that starts with an `optional` runs no step for a missing key ([ad44af1](https://github.com/fuzdev/fuz_schema/commit/ad44af1))

  - as an entry of `object`, `strip_object`, or `loose_object`, the key stays out: `object({a: pipe(optional(string), check(f))})` accepts `{}` whatever `f` says, as in Zod and Valibot, where it failed when `f` refused `undefined`
  - `object({a: pipe(optional(string), transform(f))})` gave `{a: f(undefined)}` for `{}` and now gives `{}`, as in Valibot and not Zod: write `with_default` to fill a missing key in
  - with the key there, as `undefined` or inherited, every step runs as before, and so they do at the top level, as an array's item, and as a record's value
  - it holds under `message`, `flavor`, `brand`, and `meta`, and for a pipe that starts with such a pipe; under a `nullable`, a `lazy`, or a `union` the steps run as before

- **breaking** feat: `unknown`, `literal(undefined)`, and a `one_of` with `undefined` need their key ([d2e9e22](https://github.com/fuzdev/fuz_schema/commit/d2e9e22))

  - as an entry of `object`, `strip_object`, or `loose_object`, as in Zod and Valibot: `object({a: unknown})` accepted `{}` and now fails it with a `missing_key` issue, `expected a required key`, at the key, and still accepts `{a: undefined}` and a key that is inherited or non-enumerable; write `optional(unknown)` for a key that may be missing
  - the key is needed under `nullable`, `lazy`, `message`, `flavor`, `brand`, and `meta` too, and at the start of a `pipe`, which then runs no step; a `union` with such an option and none that lets the key be missing fails with its own issue
  - a `variant` option whose discriminator is `literal(undefined)` is still selected by an input without the key, and fails it with `missing_key` at the discriminator
  - in a `union` before an option that fills a missing key in, as `with_default` does, an option that can need the key is tried again without it, and matches the `undefined` as it did: `union([pipe(unknown, transform(f)), with_default(string, 'D')])` still gives `f(undefined)`. An option tried again runs twice in one parse, so a `transform` or `check` with a side effect that it reached the first time runs twice
  - at the top level, as an array's item or a record's value, and after a pipe's first step each still accepts `undefined`, and a `check` or a `transform` that is the entry takes a missing key as `undefined`, as before

- **breaking** fix: length and value actions in a `pipe` keep the type of their value ([f4b6640](https://github.com/fuzdev/fuz_schema/commit/f4b6640))

  - `min_value` and `max_value` narrowed it to the literal type of their bound: `pipe(number, min_value(0))` is a `number` and not `0`
  - `min_length`, `max_length`, `min_value`, and `max_value` in a `pipe` that is an object entry or a `union` option keep it too, where it was `any`
  - the `def` of `min_value` and `max_value` is typed `number | bigint`, and one made outside a `pipe` is typed for either and no longer fits `pipe(number, ...)`: name the type, `min_value<number>(0)`

### Patch Changes

- fix: a transform between `0` and `-0` inside a container is kept in the output ([95de578](https://github.com/fuzdev/fuz_schema/commit/95de578))

  - inside `object`, `strip_object`, `loose_object`, `record`, or `array`, a child that turned `0` into `-0`, or back, was lost and the input came back; the output now has it, as in Zod and Valibot
  - a `NaN` that passes through unchanged no longer makes its container a copy: the input comes back as it is when nothing else in it changed

- feat: add the new module `introspect.ts`, reading a schema's wrappers, entries, metadata, and type ([2d2c3fb](https://github.com/fuzdev/fuz_schema/commit/2d2c3fb))

  - `unwrap_schema` walks `optional`, `nullable`, `with_default`, `with_default_fn`, `pipe`, and `lazy` to the schema under them
  - `get_schema_meta` finds a metadata key on the outermost layer that has it, where `get_meta` reads one object
  - `get_schema_entries` and `get_schema_fields` read an object schema's entries under its wrappers, with each one's default and description, typed `SchemaField`; a default of `with_default_fn` is `default_computed`, and its function is never called
  - `format_schema_type` renders the type a schema accepts as TypeScript-like text, for help output

- feat: add `meta` and `get_meta` in the new module `meta.ts`, metadata beside a schema ([0e53a8e](https://github.com/fuzdev/fuz_schema/commit/0e53a8e))

  - `meta(schema, {description})` returns a copy of the schema with the metadata attached, and `get_meta(schema)` reads it back
  - the metadata is held in a `WeakMap`, so a bundle that attaches none pays nothing for it
  - the `SchemaMeta` interface takes more keys by declaration merging

- fix: `literal(NaN)` matches `NaN`, as in Zod and Valibot, where it matched nothing ([3b7f8c5](https://github.com/fuzdev/fuz_schema/commit/3b7f8c5))

  - so a `variant` option whose discriminator is a `NaN` literal can match
  - every other literal compares by `===` as before, and a `one_of` with `NaN` already matched it

- perf: fewer allocations and less repeated work on the common paths of a parse ([d2e9e22](https://github.com/fuzdev/fuz_schema/commit/d2e9e22))

  - a parse with no failure allocates no array for issues
  - `array` makes its copy at full length when an item changes, where it copied a prefix and grew it
  - `union`, `min_length`, `max_length`, `min_value`, and `max_value` build an issue's `expected` text once and keep it
  - `object` and `strip_object` check input keys faster when they come in the schema's order
  - inside a `union` option or an `is`, `object` doesn't read the value of an unknown key, and `variant` doesn't read an unmatched discriminator twice

- feat: add `to_schema_json` in the new module `schema_json.ts`, a schema as JSON ([3111ebe](https://github.com/fuzdev/fuz_schema/commit/3111ebe))

  - it writes a schema as a JSON document of its kinds and their `def`s, each `lazy` by a name, typed `SchemaJson` and `SchemaJsonNode`, with its limits as the `SCHEMA_JSON_*` constants
  - it throws, naming the kind and the path, on a schema the form can't carry, as one that holds a `regex`, a `check`, a `transform`, or a `with_default_fn`

- feat: the Standard Schema types follow version 1.1 of the spec ([e41f368](https://github.com/fuzdev/fuz_schema/commit/e41f368))

  - `validate` takes an optional `options` argument, typed by the new `StandardSchemaV1Options`, which `to_standard_schema` ignores
  - `StandardSchemaV1Props` extends the new `StandardTypedV1Props`
  - add `StandardTypedV1` and `StandardTypedV1Types`

- feat: add `with_default_fn`, a default made by a function for each value it fills in ([86d36cc](https://github.com/fuzdev/fuz_schema/commit/86d36cc))

  - `s.with_default_fn(s.array(s.string), () => [])` gives a new array on every parse, where `with_default` gives the one value it was given every time
  - the function is called with no arguments, once for each `undefined` or missing key it fills, and what it returns is not validated, as with `with_default`
  - as an object entry it makes the key optional in the input and required in the output, as `with_default` does

## 0.1.0

### Minor Changes

- fuz_schema: a performance-focused Standard Schema library for JS ([2e66eb0](https://github.com/fuzdev/fuz_schema/commit/2e66eb0))
