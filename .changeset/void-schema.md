---
'@fuzdev/fuz_schema': patch
---

feat: add `void`, the literal of `undefined` typed `void`, read as `s.void`

- `(input: s.Infer<typeof s.void>) => ...` can be called with no argument, where a parameter typed `undefined` can't
- it is `literal(undefined)` to every reader: `kind` `'literal'`, `def` `undefined`, refused by `to_schema_json` and `to_json_schema`
- as an object entry it needs its key, as that literal does: `s.optional(s.void)` lets it be missing
