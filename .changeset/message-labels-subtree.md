---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: `message` labels every issue of the schema it wraps, its children's included

- an outer `message` now sets its text on every issue beneath it, at any path, that has no message yet, and on an object's `unknown_key` and a `variant`'s discriminator issue, as Valibot's `v.message` does
- a `missing_key` of an entry is labeled by a `message` around the object too
- the innermost `message` still wins: to keep a different text on a child, wrap that child in its own `message`
- a `message` function is called for a child's issue too, with the value the wrapped schema was given and the issue's `path` relative to it, so `get_issue_value(issue, value)` finds the child's
