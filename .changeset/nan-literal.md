---
'@fuzdev/fuz_schema': patch
---

fix: `literal(NaN)` matches `NaN`, as in Zod and Valibot, where it matched nothing

- so a `variant` option whose discriminator is a `NaN` literal can match
- every other literal compares by `===` as before, and a `one_of` with `NaN` already matched it
