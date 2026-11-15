---
'@fuzdev/fuz_schema': patch
---

feat: `compile.ts` compiles a schema to a guard and a parse of straight-line code

- `compile_guard(schema)` returns a function that gives what `is` gives, and `compile_parse(schema)` one that gives what `parse` gives: the same output, the input itself where nothing changed, and `parse`'s issues for an input that fails
- it is a module of its own, `@fuzdev/fuz_schema/compile.ts`, which makes its functions with `new Function`: where that is refused, or where compiled code runs out of stack, the interpreter answers
- it throws on a schema the library can walk in time exponential in the depth of an input, naming where and what to write instead: a recursive `union` two options of which could walk one array or object again, unless a `literal` entry first in each object schema tells them apart, and a recursive `pipe` two steps of which walk on. A `memo_union` is never refused, and what compiles is bounded on an input that is a tree by the size of the input times its depth and a factor of the schema, but for what a kind of one's own or a `check` walks
- a `check`, a `transform`, and a `with_default_fn` that ran before a failure, or that threw a `RangeError` in a schema that holds a `lazy`, a `memo_union`, or a kind of one's own, run again in the interpreter, and a getter or a `Proxy` can tell what is read of the input
- `is_memo_union(schema)`, a new export of `schema.ts`, says whether a schema was made by `memo_union`, which its `kind` doesn't: a `flavor`, a `brand`, a `meta`, and a `message` of one are told too, and so is a `union` given a `memo_union`'s own options array, which `compile.ts` then takes for one
