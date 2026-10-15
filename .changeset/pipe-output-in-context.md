---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a `pipe` that ends in an unannotated `check` infers its type as an entry or option

- `object({name: pipe(string, check((v) => v.length > 0))})` infers `name: string`, and `v` is a `string`, where both were `any`, with any steps before the `check` too, in a `union` option, an entry of a `variant` option, and a `message` there
- code that compiled through that `any` may now have type errors to fix, as a typo in the `check`'s function
- an action used as an entry or option itself, outside a `pipe`, is still `any`: put it in a `pipe`, or annotate the parameter of a `check` or `transform`
- a `pipe` no longer takes its output type from the type it is assigned or returned as: a `transform` that returns a single literal, as `() => 'a'` or `() => ({k: 'a'})`, now gives `string` or `{k: string}` there and needs `as const` or an annotated return. One that returns either of several strings, numbers, or booleans, as `(v) => (v ? 'a' : 'b')`, keeps them; either of several objects, as `(v) => (v ? {k: 'a'} : {k: 'b'})`, gives `{k: string}` and needs `as const` too
