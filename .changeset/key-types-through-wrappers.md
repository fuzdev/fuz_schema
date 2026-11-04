---
'@fuzdev/fuz_schema': patch
---

fix: type a key optional where a missing one matches, through the wrappers

- this changes existing inferred types: a key typed required before can now be optional, so an inferred type assigned to one declaring that key required (`a: string | undefined`) no longer compiles; give the key `?:` there
- a key is optional in the input type under a `nullable`, a `lazy`, a `pipe`, a `union`, a `flavor`, or a `brand` whose `optional`, `with_default`, or `with_default_fn` takes it missing, as the runtime has it: `object({a: nullable(optional(string))})` takes `{}`
- it is optional in the output type where it can stay out: an `optional` reached the same way, a `pipe` that starts with one as the entry, a `pipe` or `union` that can give `undefined`
- `with_default(optional(string), 'd')` outputs a `string`, as the default replaces the `optional`'s `undefined`, and `with_default(nullable(optional(string)), 'd')` a `string` or `null`; `with_default_fn` likewise for a `make` that never returns one. A `brand` or `flavor` of the `optional` is kept, as `s.with_default(s.brand(s.optional(s.string), 'B'), 'x')` outputs the branded string. Over any other schema the output keeps its type
- `PipeSchema` carries its first schema in its type-only `~types`, as does a `flavor` or `brand` of one, and the new `EntryTakesMissing`, `EntryLeavesMissingOut`, and `PipeStartsOptional` name the reading for emitted declarations; `SchemaDefaultOutput` names a default's output
