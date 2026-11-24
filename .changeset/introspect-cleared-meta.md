---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: metadata cleared with `undefined` reads as cleared in `introspect.ts`

- `get_schema_meta` and the `description` of `get_schema_fields` give `undefined` where an outer layer has the key as `undefined`, whatever a layer under it holds, as `to_json_schema` already wrote it
- `find_schema_meta` leaves out the values of the layers under such a layer, and still reads the options, later `pipe` steps, and parts they hold
