---
'@fuzdev/fuz_schema': patch
---

feat: add `memo_union`, a `union` linear in depth where recursive options walk the same children

- `memo_union(options)` gives what `union(options)` gives, verdicts, outputs, and issues, and is of kind `union`, so `to_schema_json` and the readers take it as one
- it keeps, for one parse, what it gave each object or array it was probed with: use it where two options could take the same object and reach a `lazy` before a `literal` tells them apart, and on each union of a chain of them
- a `transform`, a `check`, or a `with_default_fn`'s `make` under it can run fewer times, and an object the input holds twice gets one output object in both places
- the answer on an object is kept as the object's alone, which a getter, a `Proxy`, or a `check` with state can break
