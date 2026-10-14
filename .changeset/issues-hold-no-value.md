---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: an issue no longer holds the value that failed, only its type name

- `value` is replaced by `received`: `'null'`, `'array'`, or the value's `typeof`, so issues and `SchemaError` can be logged and kept without the input; `to_type_name` is removed, use `issue.received`
- a `message` function is handed the value as a second argument: `message(schema, (issue, value) => text)`
- add `get_issue_value(issue, input)`, which reads the value back out of the parsed input, returning `{ok: true, value}` or `{ok: false}`
- `format_issue` and `SchemaError` quote a path key that isn't only word characters as JSON: `"a.b": ...` for a key named `a.b`
- an issue's `path` is a new array at each level it is prefixed: a `message` function that keeps the `path` it is handed no longer sees the keys added after
