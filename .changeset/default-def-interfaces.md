---
'@fuzdev/fuz_schema': patch
---

fix: `variant` refuses a `with_default` or `object_with_rest` option that its types let through

- a `with_default` whose value is a schema or of type `any`, a `with_default_fn` whose `make` returns `any`, and an `object_with_rest` whose entries are of type `any` no longer compile as an option
- the `def` of `with_default` is typed `SchemaDefaultDef`, of `with_default_fn` `SchemaDefaultFnDef`, and of `object_with_rest` `SchemaObjectWithRestDef`, three new interfaces
- the `def` types the wrappers, `object_with_rest`, and `variant` give are `readonly`, as `SchemaDefs` has them
