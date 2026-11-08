---
'@fuzdev/fuz_schema': patch
---

perf: `uuid` checks a string in less time, with the same grammar

- it accepts and refuses the same strings, and `to_json_schema` writes the same `pattern`
- a bundle that uses `uuid` is larger by about 60 to 80 gzipped bytes
