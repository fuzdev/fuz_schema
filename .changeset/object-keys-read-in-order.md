---
'@fuzdev/fuz_schema': minor
---

**breaking** perf: `object` and `strip_object` read the input's keys as they enumerate them while they come in the schema's order, and skip the check for unknown keys when that takes in every key; a key the input gains while it is parsed, from its own getter or a `transform` holding it, can now go unseen where it was an unknown key before
