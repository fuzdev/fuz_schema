---
'@fuzdev/fuz_schema': minor
---

**breaking** perf: `SchemaContext.issues` is `undefined` until the first failure, so a parse with no failure allocates no array for them, and a custom schema that reads it must handle `undefined`; `array` copies its input once when an item changes, where it copied a prefix and regrew it, and reads the input's length once
