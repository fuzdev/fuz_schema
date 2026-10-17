---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a failing parse reports at most a hundred issues, so deep input can't exhaust memory

- `parse` and a Standard Schema's `validate` return the first hundred issues of an input that fails more often, with nothing to say more were found, and `parse_or_throw`'s `SchemaError` carries the same hundred
- a deep input with many failing values at the bottom held memory in the product of its size and its depth: a 206 KB JSON text held over a gigabyte
- a `SchemaError`'s message lists the first ten issues and then `and N more`, where it listed every one: `error.issues` has every issue the parse reported
- a custom schema's `run` that reads `ctx.issues` from a count finds an issue only below the hundredth: past it `fail` counts the failure and builds none
