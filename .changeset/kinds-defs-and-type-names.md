---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `picklist` is `one_of`, every kind is its export's name, and `def` is typed

- rename `picklist` to `one_of`, with schema and issue kind `'one_of'`; `with_default` has kind `'with_default'`, was `'default'`
- `optional` and `nullable` hold their schema as `def.schema`, as `with_default` does, where `def` was the schema
- add the types of what each kind's `def` holds, `SchemaDefs`, `SchemaKind`, `SchemaDef`, `SchemaNode`, and `SchemaWrapperDef`, and the guard `is_schema`; a `pipe`'s `def` is typed `ReadonlyArray<SchemaNode>`
- rename the types `Action` to `SchemaAction`, `Literal` to `SchemaLiteral`, `ObjectInput` and `ObjectOutput` to `SchemaObjectInput` and `SchemaObjectOutput`, and `Pipe` to `SchemaPipeFactory`; `Flatten` is no longer exported
- `pipe()` with no schema throws, where it returned a schema that accepted anything
