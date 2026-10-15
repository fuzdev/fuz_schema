# Grading a change

```bash
npm run grade                                   # the working tree against HEAD
npm run grade -- --against HEAD~2 --filter each/union
npm run grade -- --against-file path/to/old_schema.ts
npm run grade -- --new-file path/to/variant.ts  # a file as the graded version
npm run grade -- --runs 5                       # more runs, for a smaller change
npm run grade -- --alone object/                # which cases also run alone
npm run grade -- --apart each/                  # which cases also run a version to a process
npm run grade -- --slice 2                      # longer timing slices
npm run grade -- --no-process                   # skip retained heap and cold start
npm run grade -- --class correctness            # price the bytes as a fix of correctness
```

`grade` compares a version of `schema.ts`, the working tree's unless
`--new-file` names one, with a baseline, from git or from a file. It prints
what it expects to take before it starts. Per
[case](benchmarks.md#scenarios-and-cases) it reports:

- time per parse, the graded version over the baseline, beside its floor
- heap bytes allocated per parse
- whether the output is the input itself or a copy

each summarized by group and by path (what the parse does: return the input,
return a copy, build issues, or probe), then bundle size, retained heap per
scenario and per export, and cold start, and a verdict against the rules.

Bytes are the figures of [`sizes.json`](benchmarks.md#the-whole-library), of
both versions: a table of the scenarios, each beside Valibot's bundle of the
same scenario and `all` for the scenarios together, and a table of the
exports, `parse` alone and each other export's `last in` and `alone`, with
`library`, every runtime export in one bundle. Each figure is core or opt-in,
[below](#bytes). The export table lists `parse` and each figure of an export
that moved past the jitter, or that one version lacks, and counts the exports
it leaves out. `all` and `library` are reported only: no rule reads them, and
the opt-in verdict prints `library`'s delta beside it. A scenario the
baseline's scenario module has no factory for, as one added since, is measured
for the graded version alone, in the bundle table and in retained heap, and
compared on nothing: `all` is then of the scenarios both have, so its delta is
the change's, and the backstop is still read on every scenario.

When a change targets a path no case isolates, add the case first.

## Flags

| flag                         | default                        | meaning                                                                                                                        |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `--filter <part>`            | every case                     | measure and report only the cases whose name includes this                                                                     |
| `--against <ref>`            | `HEAD`                         | the git ref the baseline is taken from: its `schema.ts`, and its scenario module for bundle size, retained heap, and cold start |
| `--against-file <path>`      | none                           | a file as the baseline, instead of a git ref                                                                                   |
| `--against-libs-file <path>` | the working tree's             | the scenario module of a baseline given with `--against-file`, for one with another API. An error without `--against-file`      |
| `--new-file <path>`          | the working tree's `schema.ts` | a file as the graded version                                                                                                   |
| `--runs <n>`                 | 3                              | how many times the whole of the timing is repeated                                                                             |
| `--alone [part]`             | `real/`                        | which cases also get processes of their own: those whose name includes this, and every case when given with no value           |
| `--no-alone`                 | off                            | no case runs alone                                                                                                             |
| `--apart [part]`             | a few cases, below             | which cases are also timed a version to a process: those whose name includes this, and every case when given with no value      |
| `--no-apart`                 | off                            | no case runs apart                                                                                                             |
| `--slice <ms>`               | 1                              | milliseconds one timing slice of one instance lasts                                                                            |
| `--samples <n>`              | 15                             | the cold-start rounds kept                                                                                                     |
| `--class <class>`            | `speed`                        | what the change is for, which prices its bytes: `speed`, or `correctness` for a fix of correctness or conformance              |
| `--no-bundle`                | off                            | skip bundle size, and with it the verdicts of rules 4 and 5                                                                    |
| `--no-process`               | off                            | skip retained heap and cold start, and with them the verdict of rule 9                                                         |

The exit code is 0 whatever the verdicts, and nonzero only when the grade
could not run.

The grader parses its own args with the working tree's `schema.ts` and
`meta.ts`, `--new-file` included: one that doesn't load stops it at start,
and one that parses wrong misreads its args.

## How it measures

**Instances.** A timing process of `matrix` or `alone` loads each version
three times over, as module instances with their own functions. Two instances
of one file don't read the same. On a case here and there one settles several percent from
another, sometimes more than a tenth, and stays there for the life of the
process, and the next process draws again. So one instance of each version is
one draw of each, and their difference can be all draw. What the instances of
one version differ by is the noise, measured in the same process at the same
moment as the difference between the versions. A case's time is beside a floor
read from it, and a summary's beside an A/A.

**Regimes.** A case is timed in up to three programs, and all are real:

- **matrix**: one process runs every case before it times any, so every call
  site in the library has seen many schemas, as in an app. It answers what a
  change costs code that is shared.
- **alone**: one process per case, which builds the groups of cases up to the
  case's own and runs only the case, so the engine specializes the library to that schema and can
  remove the context and the result object altogether. It answers what a
  change costs a program with one schema. The realistic cases run alone by
  default. `--alone <part of a name>` picks others, `--alone` with no value
  is every case, and `--no-alone` is none.
- **apart**: a process holds one version, uses every kind of schema, and
  times one case built as `alone` builds it. It answers what a change costs
  through the state a process shares, [below](#apart). A few cases run apart
  by default. `--apart <part of a name>` picks others, `--apart` with no
  value is every case, and `--no-apart` is none.

A change can win one and lose the other. The bytes differ too, and both are
right: a case reads less alone than in the matrix by the objects the engine
removed.

`--filter` picks the cases that are measured and reported. The matrix process
still runs every case first, so a filtered case is timed in the same code as
in a whole run.

**Runs.** The whole of the timing is repeated, three times by default, each
run in fresh processes with the instances loaded in another order. Nothing is
concluded from one run.

**Time and bytes** come from different processes. Time is taken under Node's
own flags, a consumer's. Bytes need a young generation sized by flag, which
moves what a parse takes. A bytes process holds two instances of the baseline:
where they differ by what a case is listed for, the case is marked `~` and
left out of the lists.

**Within a process** the instances of a case are warmed in turns, for a set
time and a floor of calls, then timed a round at a time, every instance once a
round, in orders that put each in every position equally often. A round is
timed first and thrown away. No collection is forced.

### Apart

In `matrix` and `alone` a process holds both versions. Each instance has its
own functions, so what a version does inside the library is its own. What it
does to the state the whole process shares is not: every schema of both
versions is one kind of object to the engine, and a version that writes to a
field of one schema changes how that field is read on all of them. Both
versions then pay, and the grade reads no difference. A `lazy` that replaces
its own `run` on first use does this.
`src/test/schema.shape.test.ts` fails on that cause, and this regime is for
any other.

- **A process holds one version**, and each version has three processes a
  run for each case, started in turns. A process is a draw, as an instance
  is, so the processes of one version are read as the instances are
  elsewhere: [below](#how-a-difference-is-decided).
- **The process uses the library before it times.** A change like that
  `lazy`'s costs nothing until a `lazy` has run, so a process that only ran
  its case would show it on a case with a `lazy` and on no other. So it first
  runs a small program, `src/benchmarks/program.ts`: one schema of every
  kind, each on an input that matches and one that doesn't, the same for
  either version, and as much of it as a version exports: a baseline with an
  older API runs fewer entries, and the grade says how many.
- **The program runs in an instance of its own**, a second copy of the same
  version beside the one that is timed. Run through the timed instance it
  would teach every call site in it several schemas, and the case would no
  longer be folded: an array of ten numbers took ten times as long after it,
  in both versions alike, with nothing left of what the `lazy` cost. In its
  own instance it changes what the process shares and leaves the timed
  functions having run one case.
- **The default cases** are mostly ones the engine folds whole, each of
  another construction: an array of a hundred strings and one of ten numbers,
  the same through `optional`, and a flat object. A folded case is where
  shared state shows, as little else is left of the parse. The `lazy` above
  nearly doubled the array of strings and left the flat object where it was. The last is a
  recursive schema, which is not folded: it is the case that runs a `lazy`
  itself, so a change to `lazy` is read on what it is for.
- **Both versions load from one directory.** `grade` copies each version's
  file into `.gro/grade/` and loads it from there, in every regime. The same
  bytes read apart by where their file sat: from a file outside any directory
  whose `package.json` gives a `type`, an array of a `pipe` with a `regex`
  took about a tenth longer, in most processes, than from a copy inside one.
  That is measured, and what in the engine or in Node makes it so is not
  established. A version is one file: a `schema.ts` that imported a sibling
  would not load from its copy.
- **It reads time only.** Bytes are read in the processes that hold both.

What it does not see is what using a feature does inside the library's own
functions, to the case's call sites, or to the library's module-level state:
the program runs in another instance, which has its own of both. `matrix`
times that, each instance in functions of its own that have run every case.

It adds about ten seconds a case to a default run, of three runs, and the
estimate printed before the start says what of the timing is apart.

## How a difference is decided

**A case.** In one run, a case shows slower when every instance of the graded
version took longer than every instance of the baseline, and their medians
differ by more than the case's floor. The floor is twice what an instance is
from the median of its own version, at its median over both versions and every
run, and never under 1%. It is printed as the `floor` column. It is not an A/A
band: it is read from how far instances sit from their own version's median,
and an instance that settled apart from the others of its version barely moves
it. So a case reading outside its floor is not by itself a finding. The mark
is.

A case timed apart is read the same way, with a process where an instance
is: slower in a run when every process of the graded version took longer than
every process of the baseline, by more than a floor read from how far the
processes of one version sit from their own median.

A case is confirmed slower when it shows slower in enough of the runs: every
run when there are fewer than five, and three quarters of them, rounded up,
from five. Faster is the same the other way. Fewer than three runs confirm
nothing.

- `*` marks a case that is confirmed.
- `?` marks one that showed it in exactly one run fewer than confirms it. With
  fewer than three runs, where nothing is confirmed, it marks one that showed
  it in every run there was. Two copies of one file have one now and then.

The rule is strict on purpose: over this many cases a looser one finds two
copies of one file apart somewhere in most runs. So it misses small changes
to one case: the further a case moved past its floor the likelier it is
confirmed, and one that moved by about its floor mostly is not. A case whose
instances scatter widely has a wide floor, and a small change to it is not
found by any number of runs worth waiting for.

**A summary line**, a mean over cases, is where a small change shows. Its
figure is the geometric mean of the cases' ratios, taken a run at a time and
then at the median of the runs. Its A/A is from the same cases in the same
processes: each instance's mean over them, the standard deviation of those
among the instances of one version, pooled over the versions and the runs,
times 3.3 over the root of the runs. Apart it is of the processes of one
version in the same runs. That is near three standard errors of
the figure, and two copies of one file read past it on about one line in a
hundred. A figure inside its A/A is not a difference, and a shift inside it
cannot be told from none. The grade prints the A/A it measured, and more runs
narrow it. At the default run count a shift of a couple of percent on the
realistic cases can pass unseen, so a series of small accepted changes should
now and then be graded against an older ref (`--against <ref>`).

## Rules

1. **Judge speed on the realistic cases**, valid input first, and read it
   by path: one figure can hide a path that got slower.
2. **A time difference is read against its A/A**, the one measured beside it,
   and inside it is noise. A quiet machine still matters: load widens the A/A,
   and a wide one hides a real change. Give a small change more runs.
   Bundle bytes are exact. Allocations are exact for the code the engine is
   running, and need no quiet machine: see
   [benchmarks.md](benchmarks.md#reading-the-numbers).
3. **Opt-in bytes for speed only have to pay for themselves.**
4. **Bytes every user pays need a return**: roughly a 10% speedup on the
   realistic cases per 50 gzipped bytes of core. Under 5% for any bytes is a no.
   The return is on the valid path, or on the invalid one when the valid path
   is not slower. A fix of correctness or conformance may add up to 4 bytes
   of core with no return, and past that the user rules.
5. **Bytes have a price per class.** Core is rule 4's. A fix of correctness
   or conformance may add up to about 50 gzipped bytes to any one opt-in
   figure, and past that the user rules. A change for speed pays for opt-in
   bytes by rule 3. Whatever the change, every scenario stays at or under 0.75
   of Valibot's gzipped size for the same scenario: the backstop.
6. **The valid path is never slowed to speed up the invalid one.**
7. **Allocation breaks ties** when time is within noise.
8. **Generated code is opt-in**, because `new Function` breaks under a strict CSP.
9. **What each further schema holds has an allowance.** Any change may grow
   the retained heap per further schema by up to 16 bytes on any one figure,
   and past that the user rules, [below](#retained-heap).

`grade` checks 2, 4, 5, 6, and 9, and lists what allocates more, retains
more in total, or starts slower. The rest is judgment.

- **Rule 4**, for speed, reads the realistic cases in the matrix, all the
  runs together, the valid ones and the invalid ones each as one figure beside
  its own A/A. No bytes added is a pass. Added bytes pass when the valid speed is
  past its A/A and is the return the rule asks, which is never under its 5%.
  When it is not, and the valid path does not read slower past its A/A, they
  pass when the invalid speed is that return, at the same price and past its
  own A/A. A speedup inside its A/A has not been shown.
- **Rules 4 and 5**, for correctness, read the bytes alone, [below](#bytes).
  A figure over its price reads `ASK`: the user rules on it, and it is not
  a failure.
- **Rule 6** fails when the valid path of the realistic cases reads slower
  past its A/A, whole or as the identity or the copy path, in `matrix` or
  `alone`, or when a valid case, realistic or not, is confirmed slower in any
  regime, `apart` among them. The summary of the cases timed apart is printed
  and no rule reads it: they are a few chosen cases, read one at a time.
- **Rule 9** reads every figure of retained heap per further schema, under
  either class, and one over the allowance reads `ASK`.
- **Below three runs** rule 6, and rule 4 for speed when bytes were added,
  are not judged: their lines say so in place of a pass or a fail, and the figures
  are still printed. What is of bytes or retained heap alone is judged at any run count.
- A case is listed as allocating more when it does by eight bytes or more to
  the nearest byte, a word, and by at least a fifth of a percent, which is
  what two readings of one parse can differ by on a large case: a smaller rise
  on a large case is in the table and not in the list.

A pass doesn't mean nothing regressed. Read the lists.

### Bytes

A change is of one class, given with `--class`: `speed`, the default, or
`correctness`, a fix of correctness or conformance and not of speed. The class
sets only what its bytes cost: a `FAIL` of any other rule stays a failure
under either, and a correctness change is not failed for bringing no speed.

Each figure is of one class too:

- **Core** is what every consumer pays: the `strict_nested` scenario's
  bundle, the one built from `object`, the default object schema, which is
  the figure rule 4 reads, and `parse` alone.
- **Opt-in** is what a consumer pays who uses it: every other scenario's
  bundle, and each other export's `last in` and its `alone`.

Both figures of an export are priced, because each misses what the other
sees. `last in` is what the export costs a consumer who has the rest, so it
can't see bytes added to a helper two exports share: remove either and the
helper stays for the other. `alone` is what the export costs over `parse` a
consumer who has only it, and pays for every helper it reaches. A change that
saves bytes in a shared helper's callers and grows the helper can read smaller
on the scenarios together while every bundle of one kind grows, and `alone`
is where that shows. Growth split across many exports, none past the jitter,
shows in neither and only in `library`, which the opt-in verdict prints and
no price reads.

Where an export's two figures move in opposite directions, `alone` wins: it is
what a consumer of that one kind ships, where `last in` prices adding the
export to a bundle that has every other. The grader prices each figure on its
own; where they disagree, this is how its verdict is read.

| change        | core                                   | opt-in                                        |
| ------------- | -------------------------------------- | --------------------------------------------- |
| `speed`       | the return of rule 4                   | listed where it grew, to be weighed by rule 3 |
| `correctness` | up to +4 with no return, past it `ASK` | up to +50 on any one figure, past it `ASK`    |

Core is read exactly, to the byte. An opt-in figure moves by a byte or a few
with no change to what it measures, as a byte changed elsewhere in a bundle
moves how the rest compresses, so a rise of 3 or less is not read as growth,
and the price is read 3 past its figure. An export one version lacks is read as
0 there.

The backstop is read on every scenario under either class, against
Valibot's bundle of the same scenario, and is a `FAIL` past 0.75 of it. The
scenarios together, `all`, are no bundle a consumer ships, and are reported
beside Valibot's without a verdict.

### Retained heap

`--no-process` skips it, with cold start. A change's retained heap is read
in processes of its own, by `heap.ts` (see
[benchmarks.md](benchmarks.md#retained-heap)), for each version:

- **per scenario**: the library's total with one schema, and what each
  further schema of the scenario holds
- **per export**: what each further schema of one export alone holds, a
  schema of the export's entry in `src/benchmarks/program.ts`, an action
  inside a `pipe`. The scenarios are built of a few kinds, and a change to
  any other is read here and nowhere else: a `one_of` holds a set of its
  values, and no scenario has one.

The figure per further schema is priced, and a total is reported. A total is
paid once, whatever an app does. What each schema holds is paid as often as
an app defines one, for as long as it keeps them, and is the figure a change
to a schema's construction moves.

| figure                   | any change, of either class                  |
| ------------------------ | -------------------------------------------- |
| retained heap per schema | up to +16 B on any one figure, past it `ASK` |
| total with one schema    | reported, listed where it grew past 1 KB     |

The allowance is two words of the 64-bit heap: room for a field, or a slot of
a closure's context, and not for an object or a closure of a schema's own.
Speed is not a class that buys memory: a change for speed that holds more
per schema says so, and the user rules. A figure repeats to within a byte, so
a rise of 2 or less is not read as growth, and the allowance is read 2 past
its figure. A figure one version lacks, as a scenario the baseline's module
has no factory for, or an export the baseline can't build its entry with, is
compared on nothing.

The figures depend on Node's version and the machine's architecture, so they
are read fresh in every grade, of both versions on one machine, and kept in
no snapshot as `sizes.json` keeps the bytes.
