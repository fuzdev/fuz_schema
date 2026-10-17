---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a failing `parse` of deep input with many issues no longer takes cubic time

- a deeply nested input with many failing values at the bottom took time in the cube of its size, which a small JSON text could use to stall a parse: it now takes time in proportion to the paths it returns
- a custom schema's `run` that reads `ctx.issues` sees each path innermost first, and one that reports a child's issues under a key pushes the key onto their paths, where before it prefixed it
- a `message` function is handed a copy of the issue: changing its argument no longer changes the issue
