---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `unknown`, `literal(undefined)`, and a `one_of` with `undefined` need their key

- as an entry of `object`, `strip_object`, or `loose_object`, as in Zod and Valibot: `object({a: unknown})` accepted `{}` and now fails it with a `missing_key` issue, `expected a required key`, at the key, and still accepts `{a: undefined}` and a key that is inherited or non-enumerable; write `optional(unknown)` for a key that may be missing
- the key is needed under `nullable`, `lazy`, `message`, `flavor`, `brand`, and `meta` too, and at the start of a `pipe`, which then runs no step; a `union` with such an option and none that lets the key be missing fails with its own issue
- a `variant` option whose discriminator is `literal(undefined)` is still selected by an input without the key, and fails it with `missing_key` at the discriminator
- in a `union` before an option that fills a missing key in, as `with_default` does, an option that can need the key is tried again without it, and matches the `undefined` as it did: `union([pipe(unknown, transform(f)), with_default(string, 'D')])` still gives `f(undefined)`. An option tried again runs twice in one parse, so a `transform` or `check` with a side effect that it reached the first time runs twice
- at the top level, as an array's item or a record's value, and after a pipe's first step each still accepts `undefined`, and a `check` or a `transform` that is the entry takes a missing key as `undefined`, as before
