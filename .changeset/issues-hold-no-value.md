---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: an issue no longer holds the value that failed: `value` is replaced by `received`, the value's type name (`'null'`, `'array'`, or its `typeof`), so issues and `SchemaError` can be logged, serialized, and kept without the input; to get the value, a `message` function now takes it as a second argument, `message(schema, (issue, value) => text)`, and the new `get_issue_value(issue, input)` reads it back out of the parsed input, returning `{ok: true, value}` or `{ok: false}`; `to_type_name` is removed, use `issue.received` in place of `to_type_name(issue.value)`; `format_issue` and `SchemaError` quote a path key that isn't only word characters as JSON, so `a.b: ...` becomes `"a.b": ...` for a key named `a.b`
