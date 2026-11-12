---
'@fuzdev/fuz_schema': patch
---

perf: an object schema's inferred types cost the type checker fewer instantiations

- every inferred type is as it was, and so is every declaration a consumer emits from them
