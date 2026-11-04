---
'@fuzdev/fuz_schema': patch
---

feat: `to_json_schema` writes a schema as JSON Schema draft 2020-12, in zod's shapes

- import it from `@fuzdev/fuz_schema/json_schema.ts`; `io: 'input'` describes what a parse accepts, `'output'` (the default) what it returns
- what JSON Schema can't say throws, naming where, or with `unrepresentable: 'any'` is `{}` or left out of a `pipe`'s node: a `bigint`, a `check`, a `transform` on the output side, a step after a `transform` on the input side, a `regex` with flags other than `d` and `u` or whose source is no pattern under `u` or means something else there, as one holding a surrogate or an astral character does, which under `u` a quantifier or a range takes whole
- metadata from `meta` is copied into the node of its schema, the outer layer winning; a key that is a keyword of JSON Schema, other than an annotation such as `title`, `description`, `examples`, or `default`, is refused
- an `id` of metadata is copied as any other key, where zod moves the node into `$defs`
- a `lazy` that comes back to itself without reading into the value is refused
- `uuid` and `iso_datetime` write this library's grammars as their `pattern`, and a `with_default_fn` writes no `default`, nor that of what it holds
- a `variant` is `oneOf` of the options it can pick, or `anyOf` where a discriminator is written as other than a `const`, as with `unrepresentable: 'any'`
