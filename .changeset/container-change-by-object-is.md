---
'@fuzdev/fuz_schema': patch
---

fix: a transform between `0` and `-0` inside a container is kept in the output

- inside `object`, `strip_object`, `loose_object`, `record`, or `array`, a child that turned `0` into `-0`, or back, was lost and the input came back; the output now has it, as in Zod and Valibot
- a `NaN` that passes through unchanged no longer makes its container a copy: the input comes back as it is when nothing else in it changed
