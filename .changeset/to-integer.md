---
'@fuzdev/fuz_schema': patch
---

feat: add `to_integer(options?)`, an action that reads an integer from a string

- `s.pipe(s.string, s.to_integer(), s.min_value(1), s.max_value(1000))` takes `'42'` and gives `42`: an optional sign and ASCII digits, Rust's `str::parse::<i64>`, where Zod's `z.coerce.number()` and Valibot's `toNumber` read `Number`'s, so `''`, white space, `1e3`, `0x10`, and `1.0` fail
- the digits must spell a safe integer, so no string rounds to another, and a `-0` gives `0`
- `unsigned: true` refuses a `-`, and `trim: true` takes Unicode white space around the digits, as Rust's `str::trim` drops it
- its issue is of kind `to_integer`, expected `a safe integer in decimal digits` or `an unsigned safe integer in decimal digits`
- `to_json_schema` writes it as an `integer` within the bounds after it, and on the input side as a `pattern` of exactly the strings it reads within them; `to_schema_json` refuses it
