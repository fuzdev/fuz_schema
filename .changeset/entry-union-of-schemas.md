---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: an entry typed as a union of schemas has its key optional where one of them leaves it out

- `object({a: flag ? optional(string) : string})` outputs `{a?: string | undefined}`, as a parse of `{}` can give `{}`: the key was required
- so does a `nullable` of a schema typed as such a union, and a `pipe` that starts with one
- an entry typed `never` has its key required and typed `never`, where it was optional
