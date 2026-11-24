---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: `Branded` and `Flavored` of `unknown` keep `null` and `undefined`

- `Branded<unknown, N>` is `Brand<N> | null | undefined`, as `brand(unknown, N)` passes `null` and `undefined` through, and `Flavored<unknown, N>` is `unknown`: each was an object type that ruled both out
- `Branded<T, N>` of a type parameter is read by the parameter's constraint: with `T extends string` it assigns to `Branded<string, N>`, which was refused
