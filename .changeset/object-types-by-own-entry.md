---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: an inferred object type decides each key by its own entry, and is never `readonly`

- a known key beside an index signature is optional exactly where its own entry is: `{a: StringSchema} & Record<string, OptionalSchema<NumberSchema>>` gives `a: string`, and `{a: OptionalSchema<NumberSchema>} & Record<string, StringSchema>` gives `a?: number | undefined`, where 0.5.7 gave the reverse of each
- entries typed `readonly`, by `as const` or a `const` type parameter, give properties that can be assigned, in the output and the input, as before 0.5.7
- `loose_object` and `object_with_rest` over a union of entries give one type for each member of the union, as `object` and `strip_object` do, where 0.5.7 gave every combination of the members' keys
- in a generic function, a known key of `SchemaObjectOutput<{error: StringSchema} & T>` or `SchemaObjectInput<…>`, or of a `loose_object`'s output over the same entries, is read with its entry's type, where 0.5.7 refused the read or gave `unknown`
- a correction to the notes of 0.5.7, which said its object types were as before: it typed a known key beside an index signature, which earlier versions left out of the type, and spread `loose_object` and `object_with_rest` over a union of entries, which earlier versions typed by the keys every member shares and the index signature
