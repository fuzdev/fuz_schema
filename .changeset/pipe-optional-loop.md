---
'@fuzdev/fuz_schema': patch
---

perf: an object entry that is a `pipe` starting with an `optional` parses faster when its key is there

- an entry such as `s.pipe(s.optional(s.string), s.check(fn))` costs less to parse where a program holds many schemas
- every `pipe` holds less memory once made
- `pipe` is a few bytes larger in a bundle
