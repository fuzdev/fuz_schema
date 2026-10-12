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

- `object` drops unknown keys, copying when there are any.
- `record` drops a `__proto__` key.
- The input is never mutated.

## Issues

An issue is `{kind, expected, value, path, message}`. `format_issue` derives
text and is only bundled when used. There is no message registry.

`message(schema, text)` wraps a schema and labels the issues that schema
itself reports. It copies `kind` and `def`, so it's invisible to introspection.

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
- `variant` dispatches by map; its options need a `literal` discriminator.
- Output is copy-on-write.
