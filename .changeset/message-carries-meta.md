---
'@fuzdev/fuz_schema': patch
---

fix: `message` carries the metadata of the schema it is given to the one it returns

- `get_meta(s.message(meta(x, m), 'text'))` is `m`, the same object, where it was `undefined`; `get_schema_meta` and `get_schema_fields` find it there too
- `meta` on the result merges onto that metadata, as on any schema, so `meta` goes inside or outside `message` alike
- the schema given is left as it was
