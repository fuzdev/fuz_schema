---
'@fuzdev/fuz_schema': patch
---

feat: add `with_default_fn`, a default made by a function for each value it fills in

- `s.with_default_fn(s.array(s.string), () => [])` gives a new array on every parse, where `with_default` gives the one value it was given every time
- the function is called with no arguments, once for each `undefined` or missing key it fills, and what it returns is not validated, as with `with_default`
- as an object entry it makes the key optional in the input and required in the output, as `with_default` does
