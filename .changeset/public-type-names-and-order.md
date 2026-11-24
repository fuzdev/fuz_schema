---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: `SchemaAction` and `SchemaRefinement` take the output first, and three helper types are renamed

- `SchemaAction<Output, Input>` and `SchemaRefinement<Output, Input>`, as `Schema` is: swap the first two type arguments wherever both are written
- `EntryTakesMissing`, `EntryLeavesMissingOut` and `PipeStartsOptional` are `SchemaEntryTakesMissing`, `SchemaEntryLeavesMissingOut` and `SchemaPipeStartsOptional`
- `Flavor`, `Brand`, `Flavored` and `Branded` take a `string` name, as `flavor` and `brand` do, and no symbol or number
