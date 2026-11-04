---
'@fuzdev/fuz_schema': patch
---

feat: add `find_schema_meta`, every value of a metadata key anywhere in a schema

- reads every schema a value can reach: wrappers, every step of a `pipe`, every option of a `union`, `memo_union`, or `variant`, and a `lazy`'s schema
- `{structural: true}` also reads object entries, an `object_with_rest`'s `rest`, and what an `array` or `record` holds
- each schema is read once, so a recursion through one schema object ends; values come depth first, outermost first, one for each schema object carrying it
- metadata on the schema given to `message` is found, as `message` carries it over
