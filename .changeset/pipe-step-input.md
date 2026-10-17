---
'@fuzdev/fuz_schema': minor
---

**breaking** fix: a `pipe` refuses an action whose input is narrower than the step before it

- `pipe(nullable(number), min_value(0))`, `pipe(optional(string), min_length(1))`, and `pipe(unknown, min_value(0))` no longer compile: put the pipe inside, `nullable(pipe(number, min_value(0)))`, or start it with a schema of the type the action takes
- an annotated `check` or `transform` in a `pipe` is refused when its parameter is narrower than what it is given, as `check((n: number) => ...)` after `nullable(number)`
- `SchemaAction` is an interface that extends `Schema`, takes the kind and the `def` as its third and fourth type parameters, and every action is typed as one: a schema that isn't an action is no longer assignable to it, as `const a: SchemaAction<string> = string`
- `message`, `meta`, `brand`, and `flavor` given an action return a `SchemaAction`, so `pipe(nullable(string), brand(regex(/n/), 'R'))` no longer compiles either
- an action under `lazy` or `union`, or at the start of a `pipe` used as a step, is still checked by its input alone, as a schema is
