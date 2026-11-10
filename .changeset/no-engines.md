---
'@fuzdev/fuz_schema': patch
---

fix: declare no `engines`, so an install on a Node older than 24.14 no longer warns `EBADENGINE`

- the library calls no built-in newer than Node 20 has: `Array.prototype.toReversed` when `message` is given a function, and `String.prototype.isWellFormed` in `to_schema_json`
- an install under `--engine-strict` on such a Node no longer fails
