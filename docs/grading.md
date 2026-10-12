# Grading a change

```bash
npm run grade                                   # the working tree against HEAD
npm run grade -- --against HEAD~2 --filter each/union
npm run grade -- --against-file path/to/old_schema.ts
npm run grade -- --no-process                   # skip retained heap and cold start
```

`grade` loads the working tree's `schema.ts` and a baseline version into one
process and reports, per [case](benchmarks.md#scenarios-and-cases):

- median time per parse, the two versions timed back to back, twice, the
  second pair in the reverse order of the first, after a timing that is thrown
  away: whatever is timed first in a case reads slow
- heap bytes allocated per parse
- whether the output is the input itself or a copy

summarized by group and by path (what the parse does: return the input,
return a copy, build issues, or probe), then bundle size, retained heap, and
cold start, and a verdict against the rules.

A starred time change is past the noise floor and statistically significant
in both pairs. When a change targets a path no case isolates, add the case
first.

Grade a change to the core twice over: the whole matrix, where every call
site has seen many schemas, and each case it touches alone
(`--filter <its full name>`), where the engine inlines the parse and can
remove the context. A change can win one and lose the other.

## Rules

1. **Judge speed on the realistic cases**, valid input first, and read it
   by path: one figure can hide a path that got slower.
2. **A time difference under about 10% is noise** until reproduced on a quiet
   machine. Bundle bytes are exact, and allocations nearly: see
   [benchmarks.md](benchmarks.md#reading-the-numbers).
3. **Opt-in bytes only have to pay for themselves.**
4. **Bytes every user pays need a return**: roughly a 10% speedup on the
   realistic cases per 50 gzipped bytes of core. Under 5% for any bytes is a no.
5. **The whole stays under about two thirds of Valibot's gzipped size.**
6. **The valid path is never slowed to speed up the invalid one.**
7. **Allocation breaks ties** when time is within noise.
8. **Generated code is opt-in**, because `new Function` breaks under a strict CSP.

`grade` checks 2, 4, 5, and 6, and lists what allocates more, retains more, or
starts slower. The rest is judgment. Rule 4's "core" is the `strict_nested`
scenario's bundle, the one built from `object`.

A pass doesn't mean nothing regressed. Read the lists.
