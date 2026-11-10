---
'@fuzdev/fuz_schema': patch
---

fix: a `SchemaError` thrown by `parse_or_throw` counts every failure, not only the issues built

- an input that failed five hundred times reads `and 490 more`, where it read `and 90 more`; `error.issues` still holds the first hundred
- `new SchemaError(issues, fails)` takes the count as an optional second argument; without it the message counts the issues given, as before
- `parse`'s result is unchanged, and the error has no new field
