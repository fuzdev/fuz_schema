---
'@fuzdev/fuz_schema': patch
---

fix: a generic helper that pipes into an action emits a declaration that compiles

- `<T extends Schema<string>>(x: T) => pipe(x, min_length(1))` emitted a `.d.ts` naming an undeclared `T_1`; it now names the exported `Uninferred`
