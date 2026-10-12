# Design

The internals of `src/lib/schema.ts`. The strategy is
[Valibot](https://valibot.dev/)'s: one tree-shakeable export per schema and
action, schemas as plain data, `pipe` for refinement. This is where it differs.

## One shape

Every schema and every action is `{kind, def, run}`, keys in that order.

- An action is a schema whose `run` assumes typed input. `pipe` is a loop.
- All schemas share one V8 hidden class, so a `schema.run` load is the same
  everywhere. Kind-specific data goes in `def`, never in extra fields.
- `def` makes schemas introspectable: an object's entries, a literal's value.
- Schemas with no options are constants: `s.string`, not `s.string()`.

## Running

`run(value, ctx)` returns the output. Failure is reported through `fail`.

- **Failures are counted** in `ctx.fails`. A container knows a child failed
  when the count grew across the call.
- **Paths are built on unwind.** A container prefixes its key onto the issues
  its child added. Valid input never touches a path.
- **Probe mode** (`ctx.probe`): `fail` only counts, and containers return at
  their first failed child. `union` probes its options; `is` runs entirely in it.
- Outside probe mode `ctx.fails === ctx.issues.length`. Containers use the
  count as an index into `issues`.

## Copy-on-write output

A container returns its input when no child changed and nothing had to be
dropped. A change copies only the path to it; unchanged siblings stay shared
with the input.

Given up:

- Output may alias input. Mutating one mutates the other.
- Validation is not a snapshot: a getter, a proxy, or an object someone else
  holds can pass and then differ. Parsed JSON can't.
- A class instance that matches comes back as that instance.
- Non-enumerable and symbol keys survive.

Kept:

- `strip_object` drops unknown keys, copying when there are any.
- `object` never accepts them.
- `record` drops a `__proto__` key.
- The input is never mutated.

## Object schemas

Three, differing only in what they do with keys the schema doesn't name:

| | Unknown keys | Cost on valid input |
|---|---|---|
| `object` | an error | one pass over the input's keys |
| `loose_object` | kept | none; they are never looked at |
| `strip_object` | dropped | one pass, then a copy when there are any |

`object` is the default name because rejecting is the safe default.
`loose_object` is the cheapest, and `strip_object` is the one that works for
its result.

## Issues

An issue is `{kind, expected, value, path, message}`. `format_issue` derives
text and is only bundled when used. There is no message registry.

`message(schema, text)` wraps a schema and labels the issues that schema
itself reports. It copies `kind` and `def`, so it's invisible to introspection.

## Nominal types

`flavor` and `brand` change only the output type and return the schema object
itself. They add no wrapper and no second shape, so `kind` and `def` are the
wrapped schema's and nothing is stored at runtime.

## Costs are opt-in

A feature not every consumer needs is a separate export or module the core
never reaches: `message`, `format_issue`, `to_standard_schema`. Factories are
marked `// @__NO_SIDE_EFFECTS__` so an unused definition is dropped.

`to_standard_schema` is an adapter for this reason: schemas don't each carry
a `~standard` property. Whether they should, natively, is undecided.

## Behavior that differs from Valibot

- `pipe` stops at its first failing step.
- A failed `union` reports one issue, not its options'.
- A missing key and an `undefined` value are the same.
- `object` rejects unknown keys, where Valibot's and Zod's `object` drop them.
  Dropping is `strip_object`, and keeping is `loose_object`.
- `variant` dispatches by map; its options need a `literal` discriminator.
- Output is copy-on-write.
- `parse` returns a result and does not throw; the throwing form is `parse_or_throw`.
  Code ported from Valibot or Zod that calls `parse` expecting a throw will get a result
  object instead, which TypeScript catches in typed code and nothing catches in untyped code.
