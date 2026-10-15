---
'@fuzdev/fuz_schema': patch
---

feat: add `object_with_rest`, an object whose other keys are each validated by one schema

- `s.object_with_rest({_: s.array(s.string)}, s.number)` matches `{_: [], a: 1}` and refuses `{_: [], a: 'x'}` at the key `a`, as Zod's `catchall` and Valibot's `objectWithRest` do
- its other keys are its own enumerable string keys: an own `constructor` or `prototype` is validated as any other, as in Zod, and an inherited key is not, as in Valibot; an own `__proto__` key is left out unread, and an array is refused
- the entries' issues come first, then the other keys' in the input's order; the output is the input when nothing changed, and a copy has the schema's keys first
- `get_schema_entries` and `get_schema_fields` read its entries, and `format_schema_type` renders the rest as `[key: string]: ...`
- `to_schema_json` refuses it, as the Rust crate doesn't carry it
