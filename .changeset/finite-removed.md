---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `finite` is removed, as `number` refuses `NaN` and the infinities and does what `finite` did; use `number`, and `pipe(number, finite)` is `number`. The issue kind `finite` is gone too, in the library and in the Rust crate, and a schema document with `{"kind":"finite"}` no longer loads
