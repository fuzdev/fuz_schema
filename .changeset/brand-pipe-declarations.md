---
'@fuzdev/fuz_schema': patch
---

fix: export `SchemaOfKind`, so a declaration emitted for a `brand` or `flavor` of a `pipe` compiles

- `export const Uuid = s.brand(s.pipe(s.string, s.uuid), 'Uuid')` in a consumer with `declaration` on failed with TS4023, naming the unexported member of `SchemaNode`
