---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `number` refuses `Infinity` and `-Infinity`, and `finite` is removed

- an infinity fails `number` wherever it is, as in Zod and not Valibot, with the `number` issue `NaN` gets, which reads `expected number, received number`
- `finite` and its issue kind are removed, as `number` does what it did: write `number` for `pipe(number, finite)`
- a `pipe` that starts with `number` stops there for an infinity, and a JSON text's `1e999`, which `JSON.parse` reads as `Infinity`, fails it
- `integer` still takes an integer past the safe range, where `safe_integer` doesn't; a `literal` or a `one_of` of an infinity still matches it; and an infinity is still a bound of `min_value` and `max_value`
