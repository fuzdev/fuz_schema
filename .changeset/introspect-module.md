---
'@fuzdev/fuz_schema': patch
---

feat: add the new module `introspect.ts`, reading a schema's wrappers, entries, metadata, and type

- `unwrap_schema` walks `optional`, `nullable`, `with_default`, `with_default_fn`, `pipe`, and `lazy` to the schema under them
- `get_schema_meta` finds a metadata key on the outermost layer that has it, where `get_meta` reads one object
- `get_schema_entries` and `get_schema_fields` read an object schema's entries under its wrappers, with each one's default and description, typed `SchemaField`; a default of `with_default_fn` is `default_computed`, and its function is never called
- `format_schema_type` renders the type a schema accepts as TypeScript-like text, for help output
