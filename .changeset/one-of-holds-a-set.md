---
'@fuzdev/fuz_schema': patch
---

perf: `one_of` matches in constant time, whatever the length of its values

- it holds a `Set` of its values, built when the schema is made: a few hundred bytes of heap for each `one_of`, more for a long list
- `values` are read once, when the schema is made: changing the array afterwards changes `def` and not what the schema matches
