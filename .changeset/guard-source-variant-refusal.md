---
'@fuzdev/fuz_schema': patch
---

fix: `to_guard_source` names the `variant` when it refuses one for its discriminator

- for a discriminator that is no `literal`, the refusal named an entry of the option written before it
- for a `literal` whose value can't be written, as a symbol, it names the `variant` too, where it named the `literal`
