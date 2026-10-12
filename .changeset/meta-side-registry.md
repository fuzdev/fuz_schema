---
'@fuzdev/fuz_schema': patch
---

feat: add `meta` and `get_meta` in the new module `meta.ts`: `meta(schema, {description})` returns a copy of the schema with metadata attached, held in a `WeakMap` so schemas keep their three fields and a bundle that attaches none pays nothing; the `SchemaMeta` interface takes more keys by declaration merging
