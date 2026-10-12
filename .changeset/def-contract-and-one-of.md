---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `picklist` is renamed `one_of`, with kind `'one_of'`; `optional` and `nullable` hold their schema as `def.schema`; add the `def` contract types `SchemaDefs`, `SchemaKind`, `SchemaDef`, and `SchemaNode`, and the `is_schema` guard; a `pipe`'s `def` is typed as `ReadonlyArray<SchemaNode>`
