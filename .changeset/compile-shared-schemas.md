---
'@fuzdev/fuz_schema': patch
---

perf: compiling a schema held in many places asks each schema once

- `compile_guard`, `compile_parse` and `to_guard_source` took time that doubled with each level of a schema that holds the level below twice, and wrote an unused `Set` for a long `one_of` at each level of unions or wrappers around it
