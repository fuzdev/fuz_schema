---
'@fuzdev/fuz_schema': patch
---

feat: add `to_schema_json` in the new module `schema_json.ts`, a schema as JSON

- it writes a schema as a JSON document of its kinds and their `def`s, each `lazy` by a name, typed `SchemaJson` and `SchemaJsonNode`, with its limits as the `SCHEMA_JSON_*` constants
- it throws, naming the kind and the path, on a schema the form can't carry, as one that holds a `regex`, a `check`, a `transform`, or a `with_default_fn`
