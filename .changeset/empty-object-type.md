---
'@fuzdev/fuz_schema': patch
---

fix: type an empty `object` and `strip_object` as `Record<string, never>`, not `{}`

- `{}` is any value but `null` and `undefined`, so a value typed by `Infer<typeof object({})>` could be `5`, and `@typescript-eslint/no-generated-empty-object-type` refuses it in generated code; zod's `strictObject({})` infers a keyless record too
- `object({})` types as `Record<string, never>` in and out, as it refuses every key; `strip_object({})` outputs one and takes a `Record<string, unknown>`, as it drops every key of any object but an array
- this changes existing inferred types: an empty object's output no longer takes a primitive or an object with keys
- a schema with entries, a `loose_object`, and an `object_with_rest` keep their types, and a spread of an empty `def` beside other entries types as those entries alone
- the new `SchemaStrictObjectOutput`, `SchemaStrictObjectInput`, and `SchemaStripObjectInput` name the types for emitted declarations
