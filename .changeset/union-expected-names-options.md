---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a failed `union` names its options as `received` names values

- a `nullable` option reads as its schema and then `null`, so `union([nullable(string), number])` reads `expected string | null | number` where it read `expected nullable | number`
- a `literal` or a `one_of` option reads as its values, written as they are standalone: `union([literal('a'), one_of([1, null])])` reads `expected "a" | 1 | null` where it read `expected literal | one_of`
- `loose_object`, `strip_object`, `object_with_rest`, `record`, and `variant` options read as `object`, and an `optional`, `with_default`, or `with_default_fn` option as its schema
- each part is named once by its text, so a `nullable`'s `null` and a `literal(null)` read as one `null`
- code that matched a kind's name, such as `nullable` or `literal`, in a union's `expected` no longer finds it
