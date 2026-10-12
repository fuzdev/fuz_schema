---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `with_default` has kind `'with_default'`, was `'default'`, so every kind is the name of its export, and `SchemaDefs` is keyed to match; rename the types `Action` to `SchemaAction`, `Literal` to `SchemaLiteral`, `ObjectInput` and `ObjectOutput` to `SchemaObjectInput` and `SchemaObjectOutput`, `WrapperDef` to `SchemaWrapperDef`, and `Pipe` to `SchemaPipeFactory`; `Flatten` is no longer exported
