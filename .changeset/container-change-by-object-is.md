---
'@fuzdev/fuz_schema': patch
---

fix: a transform between `0` and `-0` inside an `object`, `strip_object`, `loose_object`, `record`, or `array` is in the output, as in Zod and Valibot, where it was lost: the container compared a child's output with its input by `===`, read the two zeros as no change, and returned its input. A container now tells a change by `Object.is`, so a `NaN` that passes through unchanged no longer makes the container holding it a copy, and that input comes back as it is when nothing else in it changed
