---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a number that isn't finite is received as `NaN`, `Infinity`, or `-Infinity`

- an issue's `received` is `'NaN'`, `'Infinity'`, or `'-Infinity'` for such a number, wherever it fails, where it was `'number'`: code that reads `received === 'number'` no longer sees them
- so `number` refusing `NaN` reads `expected number, received NaN`, as in Zod, and `string` given `-Infinity` reads `expected string, received -Infinity`
- `get_issue_value` names types the same way, and finds the value it did before
