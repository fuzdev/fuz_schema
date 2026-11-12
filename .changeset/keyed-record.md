---
'@fuzdev/fuz_schema': patch
---

feat: add `keyed_record(key, value)`, a record whose keys are checked by a schema

- every own key is run through `key`, a schema of strings, and what it gives is the output's key: `s.keyed_record(Uuid, Cover)` outputs `Record<Uuid, Cover>`, each key lowercase where `Uuid` lowercases
- no key is needed: a `one_of` or a `literal` key types each key as optional, as Valibot's `record` of a `picklist` and Zod's `partialRecord`
- a key `key` refuses is an issue of kind `invalid_key` at the key, with the key schema's `expected` and `received`, `'string'` unless a step of `key` changed the type, and `value` is not run on its value; `get_issue_value` gives the last key of its path, the key unless `key` added to the path with a `check_at`, so `format_issue_with_value` writes the key
- a failed `union` names an option of a kind defined outside the library whose name holds `object`, `record`, or `variant`, as `invariant`, as `object` in its `expected`, where it named it by its kind
- `to_json_schema` writes it as Zod's `partialRecord`, with the key schema as `propertyNames`, and `to_schema_json` refuses it, as it refuses `object_with_rest`
