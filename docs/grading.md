# Grading a change

```bash
npm run grade                                   # the working tree against HEAD
npm run grade -- --against HEAD~2 --filter union
npm run grade -- --against-file path/to/old_schema.ts
npm run grade -- --no-process                   # skip retained heap and cold start
```

`grade` loads the working tree's `schema.ts` and a baseline version into one
process and reports, per [case](benchmarks.md#scenarios-and-cases):

- median time per parse, the two versions timed back to back
- heap bytes allocated per parse
- whether the output is the input itself or a copy

then bundle size, retained heap, and cold start, and a verdict against the rules.

A starred time change is past the noise floor and statistically significant.
When a change targets a path no case isolates, add the case first.

## Rules

1. **Judge speed on the realistic cases**, valid input first.
2. **A time difference under about 10% is noise** until reproduced on a quiet
   machine. Bytes and allocations are exact.
3. **Opt-in bytes only have to pay for themselves.**
4. **Bytes every user pays need a return**: roughly a 10% speedup on the
   realistic cases per 50 gzipped bytes of core. Under 5% for any bytes is a no.
5. **The whole stays under about two thirds of Valibot's gzipped size.**
6. **The valid path is never slowed to speed up the invalid one.**
7. **Allocation breaks ties** when time is within noise.
8. **Generated code is opt-in**, because `new Function` breaks under a strict CSP.

`grade` checks 2, 4, 5, and 6, and lists what allocates more, retains more, or
starts slower. The rest is judgment. Rule 4's "core" is the `object_flat`
scenario's bundle.

A pass doesn't mean nothing regressed. Read the lists.
