---
'@fuzdev/fuz_schema': patch
---

fix: `literal(NaN)` matches `NaN`, as in Zod and Valibot and as a `one_of` with `NaN` among its values already did, where it matched nothing; so a `variant` option whose discriminator is a `NaN` literal can now match. Every other literal compares by `===` as before
