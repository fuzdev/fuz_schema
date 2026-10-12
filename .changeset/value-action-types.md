---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: `min_value` and `max_value` keep the type of the value they are given in a `pipe`, where they narrowed it to the literal type of their bound, so `pipe(number, min_value(0))` is a `number` and not `0`; `min_length`, `max_length`, `min_value`, and `max_value` in a `pipe` that is an object entry or a `union` option keep that type too, where it was `any`; the `def` of `min_value` and `max_value` is typed `number | bigint`, and one made outside a `pipe` is typed for either, so name the type to reuse it: `min_value<number>(0)`
