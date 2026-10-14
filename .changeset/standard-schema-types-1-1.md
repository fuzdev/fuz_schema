---
'@fuzdev/fuz_schema': patch
---

feat: the Standard Schema types follow version 1.1 of the spec

- `validate` takes an optional `options` argument, typed by the new `StandardSchemaV1Options`, which `to_standard_schema` ignores
- `StandardSchemaV1Props` extends the new `StandardTypedV1Props`
- add `StandardTypedV1` and `StandardTypedV1Types`
