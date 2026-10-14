---
'@fuzdev/fuz_schema': minor
---

**breaking** feat: a copy `loose_object` makes has the keys Zod's and Valibot's give, in their order

- the schema's keys first, in the schema's order, then the input's own enumerable string keys the schema doesn't name, in the input's order; it was the input's order, with a key it lacked last
- a schema key the input inherits or has as non-enumerable is an own key of the copy, where it was left out
- a symbol key, and a `__proto__` key the schema doesn't name, are left out, where they were copied; an unknown key the input inherits is left out as before, as in Valibot and not Zod
- a schema entry named `__proto__` is written as `object` and `strip_object` write it, which sets the copy's prototype, where it was an own key
- the input still comes back as it is when no entry changed; a copy costs more than it did, most where the input has many keys the schema doesn't name
