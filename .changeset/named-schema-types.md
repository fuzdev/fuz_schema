---
'@fuzdev/fuz_schema': patch
---

feat: every schema's type is named for its factory, so declarations and hovers print it by name

- `s.object(entries)` is an `ObjectSchema<typeof entries>`, `s.array(schema)` an `ArraySchema<typeof schema>`, `s.string` a `StringSchema`, and so on for every schema but `pipe`, with `BrandSchema`, `FlavorSchema`, and `SchemaPipeDef` for a `pipe`'s `def`: a declaration emitted for an exported schema no longer writes out the output and input of each schema it holds
- a `pipe` is still a `PipeSchema` of the output its steps compute, which a declaration writes out: name it as `interface StampedSchema extends s.PipeSchema<Stamped, UserSchema> {}`
- the inferred output and input types are as before, and code that names a schema's type as `Schema<…>` still compiles
- to name an exported object schema's type, `interface UserSchema extends s.ObjectSchema<typeof UserEntries> {}`, and a `variant` of named options needs no annotation, see the README's § Exporting schemas from a library
- a package that emits declarations against this version prints these names, so its consumers need this version or later: raise the floor of its range on fuz_schema when it rebuilds, as under `skipLibCheck` an older install reads the missing names as `any`, with no error
