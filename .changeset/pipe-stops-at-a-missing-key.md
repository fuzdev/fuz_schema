---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: a `pipe` that starts with an `optional` runs no step for a missing key

- as an entry of `object`, `strip_object`, or `loose_object`, the key stays out: `object({a: pipe(optional(string), check(f))})` accepts `{}` whatever `f` says, as in Zod and Valibot, where it failed when `f` refused `undefined`
- `object({a: pipe(optional(string), transform(f))})` gave `{a: f(undefined)}` for `{}` and now gives `{}`, as in Valibot and not Zod: write `with_default` to fill a missing key in
- with the key there, as `undefined` or inherited, every step runs as before, and so they do at the top level, as an array's item, and as a record's value
- it holds under `message`, `flavor`, `brand`, and `meta`, and for a pipe that starts with such a pipe; under a `nullable`, a `lazy`, or a `union` the steps run as before
