---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: an `unknown` entry of `object`, `strip_object`, or `loose_object` needs its key, as in Zod and Valibot: `object({a: unknown})` accepted `{}` and now fails on it with a new issue, `{kind: 'missing_key', expected: 'a required key', received: 'undefined'}` at the key, and still accepts `{a: undefined}` and a key that is inherited or non-enumerable, so write `optional(unknown)` for a key that may be missing; the object schemas call an entry's `run` with the object and the key as a third and fourth argument, both optional in `Schema.run`'s type, which `unknown` reads and `message` passes on to a `run` that declares them; an `unknown` held by any other schema, and every other schema that accepts `undefined`, takes a missing key as before; the Rust crate follows, with `SchemaIssueKind::MissingKey`
