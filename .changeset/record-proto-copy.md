---
'@fuzdev/fuz_schema': patch
---

fix: `record` leaves an own `__proto__` key that failed out of the copy it makes after it

- an own `__proto__` key whose value fails, followed by a value the schema changes, no longer sets the copy's prototype: the parse fails at `__proto__` instead of throwing or calling a setter that prototype has
