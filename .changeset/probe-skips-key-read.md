---
'@fuzdev/fuz_schema': patch
---

perf: where no issue is built, inside a `union` option or an `is`, `object` no longer reads the value of an unknown key and `variant` no longer reads an unmatched discriminator a second time
