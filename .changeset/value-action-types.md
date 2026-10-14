---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: length and value actions in a `pipe` keep the type of their value

- `min_value` and `max_value` narrowed it to the literal type of their bound: `pipe(number, min_value(0))` is a `number` and not `0`
- `min_length`, `max_length`, `min_value`, and `max_value` in a `pipe` that is an object entry or a `union` option keep it too, where it was `any`
- the `def` of `min_value` and `max_value` is typed `number | bigint`, and one made outside a `pipe` is typed for either and no longer fits `pipe(number, ...)`: name the type, `min_value<number>(0)`
