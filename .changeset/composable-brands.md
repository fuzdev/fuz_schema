---
'@fuzdev/fuz_schema': patch
---

feat: brands and flavors compose, so a brand of a branded schema is a narrower brand

- `Branded<Branded<string, 'A'>, 'B'>` was `never`: it now holds both, and assigns to `Branded<string, 'A'>` but not the reverse, as zod's brands do; `brand(PathSchema, 'DirPath')` infers it
- a flavor of a flavored type, and a brand and a flavor together, keep composing as before; only a brand of a brand is new
- the name of `Flavored`, `Branded`, `Flavor`, and `Brand` is constrained to `PropertyKey`, and a union of names now marks with every one of them, not any one
- a generic `<N extends string>(x: Branded<S, N>, y: Branded<S, N>)` called with two different brands is now refused; it inferred a union before
- a brand with a wide name (`Branded<string, string>`) no longer stands in for a specific brand
- types only: a parse, the bundle, and `null` and `undefined` passing through unmarked are unchanged
