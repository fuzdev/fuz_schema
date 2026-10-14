---
'@fuzdev/fuz_schema': patch
---

feat: add `meta` and `get_meta` in the new module `meta.ts`, metadata beside a schema

- `meta(schema, {description})` returns a copy of the schema with the metadata attached, and `get_meta(schema)` reads it back
- the metadata is held in a `WeakMap`, so a bundle that attaches none pays nothing for it
- the `SchemaMeta` interface takes more keys by declaration merging
