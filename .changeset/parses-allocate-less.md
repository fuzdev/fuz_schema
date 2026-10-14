---
'@fuzdev/fuz_schema': patch
---

perf: fewer allocations and less repeated work on the common paths of a parse

- a parse with no failure allocates no array for issues
- `array` makes its copy at full length when an item changes, where it copied a prefix and grew it
- `union`, `min_length`, `max_length`, `min_value`, and `max_value` build an issue's `expected` text once and keep it
- `object` and `strip_object` check input keys faster when they come in the schema's order
- inside a `union` option or an `is`, `object` doesn't read the value of an unknown key, and `variant` doesn't read an unmatched discriminator twice
