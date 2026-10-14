---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: `Flavored` and `Branded` keep the `null` and `undefined` of their type

- `Flavored<string | null, 'N'>` is the flavored string or `null`, where it was the flavored string alone, and `Flavored<null, 'N'>` is `null`, where it was `never`
- so `flavor` and `brand` around a schema whose output has either, as `nullable(string)` and `optional(string)` do, infer what the parse returns
- a plain `null` or `undefined` is assignable to a branded type that has one
- in generic code, of a type parameter neither is known to be absent: `Branded<T, 'N'>` with `T extends string` is not assignable to `Branded<string, 'N'>`, one with an unconstrained `T` is possibly `null` or `undefined`, and two flavors of one constrained `T` assign to each other
- every other type is as before
