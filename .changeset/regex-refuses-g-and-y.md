---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: `regex` throws a `TypeError` for a pattern with the `g` or `y` flag

- either flag has a test start where the last one ended, so a `y` pattern took strings it should refuse and a `g` pattern refused every other string it should take
- drop the flag from the pattern: a `regex` tests a whole string once
