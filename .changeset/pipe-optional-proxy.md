---
'@fuzdev/fuz_schema': patch
---

fix: a `pipe` that starts with an `optional` gives `undefined` for a missing key, never the value it read

- as an object entry, a `Proxy` that says the key is missing and gives a value for it no longer puts that value, which no schema ran on, in the output: the key reads `undefined`
- every other input parses as before
