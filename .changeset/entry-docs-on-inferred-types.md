---
'@fuzdev/fuz_schema': patch
---

fix: a doc comment on an object schema's entry reaches the inferred output and input types

- an editor shows the comment written on an entry for the property of `Infer<typeof Schema>` and `InferInput<typeof Schema>`, and goes to the entry as its definition
- for `object`, `strip_object`, `loose_object`, and `object_with_rest`, and for an interface that extends `SchemaStrictObjectOutput` or another of the object output and input types
- the types themselves are as before, and so is a declaration emitted from them
