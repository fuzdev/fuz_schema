---
'@fuzdev/fuz_schema': minor
---

feat: a `union` whose option fills a missing key in tries the options before it on the `undefined` the key reads as, as Zod does:

- as an object entry whose key is missing, when the first option that matches gives a value, as a `with_default` does, each option before it that takes the object and the key, as one that needs its key does, is run again without them, and the first that matches is the union's
- so an `unknown` there, as the option or at the start of one, takes the missing key as `undefined`: `object({a: union([pipe(unknown, transform(f)), with_default(string, 'D')])})` gives `{a: f(undefined)}` for `{}`, as before an `unknown` needed its key, where without this the default would be filled in, and a check around it that refuses `undefined` fails, as in Zod and Valibot
- an `undefined` it gives leaves the key out: `object({a: union([unknown, with_default(string, 'D')])})` gives `{}`, where Zod writes the key as `undefined`
- when the option that matches leaves the key `undefined`, as an `optional` does, it is the union's and no option is run again: `object({a: union([unknown, optional(string)])})` gives `{}`
- every option run again runs twice in the parse, and a `transform` in it that the first run reached with it, once more for each enclosing union that tries it again; an option that doesn't take the object and the key, and the option that matched, run once
- the Rust crate is unchanged, as it reports verdicts and not outputs
