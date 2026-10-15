---
'@fuzdev/fuz_schema': patch
---

fix: a failed `union` expects the options of a `union` or a `pipe` among its options

- a `union` among the options adds its own, at any depth, so `union([string, union([string, loose_object({...})])])` reads `expected string | loose_object` where it read `expected string | union`
- a `pipe` among them adds its first schema's, so `union([number, pipe(string, check(..))])` reads `expected number | string` where it read `expected number | pipe`
- each kind is named once, where it first appears: `union([object({a}), object({b})])` reads `expected object`
- any other option is its kind, as before: `nullable`, `literal`, and `lazy` among them
