---
'@fuzdev/fuz_schema': patch
---

feat: add `uuid` and `iso_datetime`, format refinements of a string

- `s.pipe(s.string, s.uuid)` takes an RFC 9562 UUID with a version from 1 to 8 and the RFC's variant, the nil UUID, and the max UUID, in either case
- `s.pipe(s.string, s.iso_datetime)` takes an RFC 3339 date and time in UTC, as `2024-02-29T23:59:59.123Z`: a real date, seconds, a fraction of at most 9 digits, and `Z`, with no offset
- each fails with an issue of its own kind, `uuid` or `iso_datetime`, and returns the string as given
- alone, outside a `pipe`, each refuses any value that isn't a string; `to_schema_json` writes them only in a `pipe` of a `string`
- `docs/formats.md` has the grammars and why each is the one it is
