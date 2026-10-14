# Changesets

A changeset is what a consumer reads when they upgrade: what they see change,
and what they do about it.

- **One changeset per story a consumer recognizes.** Changes a consumer would
  read together go in one.
- **A lead of about fifteen words at most**, on the first line, prefixed
  `feat:`, `fix:`, or `perf:`, and `**breaking** ` before the prefix when it
  breaks.
- **Then up to five bullets**, each a thing a consumer sees or does: what an
  input now gives, a rename to make, a type that changed. The lead becomes
  the changelog line and the bullets nest under it.
- **No internals**, unless a consumer must act on them, as an author of a
  custom schema must on what its `run` is handed.
- **No speed figures.** A `perf:` changeset says what got cheaper.
- **No notes on the Rust crates**, which are not published.
- **True against the last release.** A changeset says what changed since the
  published version, not since a commit that never shipped: one that a later
  change makes untrue is rewritten.
- **Bump `minor` for a break** while the version is below 1.0, and `patch`
  otherwise.

```md
---
'@fuzdev/fuz_schema': patch
---

perf: `one_of` matches in constant time, whatever the length of its values

- it holds a `Set` of its values, built when the schema is made: a few hundred bytes of heap for each `one_of`, more for a long list
- `values` are read once, when the schema is made: changing the array afterwards changes `def` and not what the schema matches
```
