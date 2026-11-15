---
'@fuzdev/fuz_schema': patch
---

feat: `to_guard_source` writes a schema's guard as the text of an ES module

- `to_guard_source(schema, name)`, in `@fuzdev/fuz_schema/compile.ts`, returns a module that exports a function giving what `is` gives, for a build to write to a file: no `new Function` where the guard runs
- the module imports `uuid`, `iso_datetime`, and `to_integer` from the library where the schema uses them, from a specifier a third argument can change, and imports nothing where it doesn't
- it throws on what has no text, naming the kind and the path: a `check`, a `transform`, a `with_default_fn`, a kind of one's own, what a compiled guard hands to the interpreter, and all that `compile_guard` throws on
- the text is JavaScript that a TypeScript file can hold and a linter passes over, and the guard returns a boolean: a type predicate is a cast to the input type `is` narrows to, where it is imported
- a written guard that runs out of stack throws the `RangeError`, where `compile_guard`'s asks the interpreter, and for a recursive schema whose object has many entries it can run out at a depth `is` answers
