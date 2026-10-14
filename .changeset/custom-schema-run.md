---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: for a custom schema, `ctx.issues` may be `undefined`, and `run` may get the key

- `SchemaContext.issues` is `undefined` until the first failure: a `run` that reads it handles `undefined`, and reports a failure with `fail` as before
- an object schema calls an entry's `run` with three more arguments, the object, the key, and `1`, which says the schema is the entry itself, typed in `Schema.run` as the optional `parent`, `key`, and `entry`
- a `run` that reads them declares them as plain parameters, with no default and not as a rest: `nullable`, `union`, a `pipe` to its first schema, and `message` pass them on only to a `run` whose `length` says it takes them
- a `run` of two parameters works anywhere, as before
