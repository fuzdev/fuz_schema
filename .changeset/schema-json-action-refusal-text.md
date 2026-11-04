---
'@fuzdev/fuz_schema': patch
---

fix: `to_schema_json`'s refusal of an action after a step of another type reads as English

- an action after a step of another type is refused with "the action is not for strings", "numbers", or "arrays", where it said "not for a string", "not for a number", or "not for a array"
