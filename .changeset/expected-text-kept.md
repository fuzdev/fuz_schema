---
'@fuzdev/fuz_schema': patch
---

perf: `union`, `min_length`, `max_length`, `min_value`, and `max_value` build their issue's `expected` text on the first failure and keep it, where each failure built it again, including a failure inside a `union` or `is` that reports no issue
