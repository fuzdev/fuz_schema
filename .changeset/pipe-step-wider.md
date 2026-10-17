---
'@fuzdev/fuz_schema': patch
---

feat: a `pipe` takes an action that accepts more than it is given, and a refinement keeps the type

- `pipe(string, check((v: unknown) => ...))` compiles: an action as a step is checked by what it takes, as a parameter is, and any other step by its input, as before
- `regex` and `check` are typed from the step before them, as `min_length` is: `pipe(literal('abc'), regex(/a/))` outputs `'abc'`, and a brand before them is kept
- every action but `transform` is a `SchemaRefinement`, and a `pipe` outputs the type of the step before one: `pipe(one_of([1, 2]), integer)` outputs `1 | 2`; a `transform` is not assignable to a `SchemaRefinement`, and `message` and `meta` keep one: `pipe(one_of([1, 2]), message(integer, 'm'))` outputs `1 | 2` too
- `check` takes a second type parameter, `check<V extends T, T = V>`, the first what it is given and the second what `fn` takes
