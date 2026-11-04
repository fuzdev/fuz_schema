---
'@fuzdev/fuz_schema': patch
---

feat: add `to_lower_case`, a pipe step that lowercases a string

- `s.pipe(s.string, s.to_lower_case)` gives `toLowerCase()` of the string, as Zod's `toLowerCase` and Valibot's do, and never fails
- the steps after it are given the lowercase, and it outputs a `string`: a brand or flavor goes around the pipe, as in `s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid')`, and one of a step before it is dropped
- `to_json_schema` writes no keyword for it, as Zod writes none, and refuses a step but a `uuid` after it on the input side and before it on the output side, which read another string than the document's, where Zod writes them; `to_schema_json` writes it after a `string`
- alone, outside a `pipe`, it throws on a value with no `toLowerCase`, a missing key included
