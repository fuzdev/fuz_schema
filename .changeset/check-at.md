---
'@fuzdev/fuz_schema': patch
---

feat: add `check_at`, a `check` that reports its issue at a path below the value

- `s.check_at('confirm', (v) => v.password === v.confirm)` fails as `check` does, with its issue at `confirm`, as Zod's `refine` with a `path`
- `path` is a key or the keys from the value in, outermost first, typed by the value checked, so a typo fails to compile; the issue's path is from the root, and its `received` is the type of the value there
- it is a `check` to every reader, `to_schema_json` and `to_json_schema` refusing it as they refuse `check`
- a `pipe` stops at its first failing step, so of several `check_at`s one reports at a time, where Zod's `superRefine` reports each
