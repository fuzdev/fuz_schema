---
'@fuzdev/fuz_schema': patch
---

feat: add `format_issue_with_value(issue, input)`, which writes the value that failed in place of its type

- `kind: expected "function" | "variable", received "funtion"`, for a string, a number, or a boolean that `get_issue_value` finds in `input`
- a string is quoted as JSON, so a `\n` or `\r` can't add a line, and cut at 32 code units with `…` after the quote
- an `unknown_key` or a `missing_key` issue, any other value, an issue `get_issue_value` can't find the value of, and an issue with a `message` read as `format_issue` writes them
- a `SchemaError` never holds the input, so the text is built where the input is held: `error.issues.map((issue) => s.format_issue_with_value(issue, input))`
