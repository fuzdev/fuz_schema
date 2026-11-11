---
'@fuzdev/fuz_schema': patch
---

fix: `to_schema_json` names where a schema that nests too far or comes back to itself is

- a schema with more wrappers, lazies, unions, and pipes around one value than `SCHEMA_JSON_MAX_NESTING` is named at its own path, such as `/schema/def/deep/def`, and not at `/schema`
- a schema that comes back to itself without reading into the value is named at the definition it comes back through, such as `/defs/$0`, and not at `/schema`
