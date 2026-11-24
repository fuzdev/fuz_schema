---
'@fuzdev/fuz_schema': patch
---

fix: a `union`, `memo_union` or `variant` of no options is written as `{not: {}}` and reads as `never`

- `to_json_schema` wrote `{type: []}` and `{oneOf: []}`, which are not valid JSON Schema
- `format_schema_type` gave an empty text for one, and for a `one_of` of no values
