---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: an action used as an entry or option is typed from `unknown`, not `any`

- a `check` or `transform` with an unannotated parameter, as an object entry, a `union` option, an entry of a `variant` option, or a `message` there, is given `unknown`: `object({a: check((v) => v.foo)})` no longer compiles. Put it in a `pipe`, or annotate the parameter
- `min_length` and `max_length` there take `{length: number}`, and `min_value` and `max_value` `number | bigint`, where all four were `any`
- `SchemaEntries` and the schemas the factories and `parse`, `parse_or_throw`, and `is` take are typed `Schema`, of `unknown` output, where they were `AnySchema`. Every schema is still accepted, and a function generic over `T extends AnySchema` still passes its `T`
