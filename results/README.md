# Results

What the files in this directory are, and how a run of the benchmark suite is
published. The method behind every number is in ../docs/benchmarks.md, and the
site's benchmarks page renders the published file:
<https://schema.fuz.dev/docs/benchmarks>.

## What is in this directory

| file | what it is | committed |
| --- | --- | --- |
| `latest.json` | the published run, which the site renders. Without it the site shows no measured number, and says so | yes |
| `<UTC date>_<machine>.json` | a publishable run, as `npm run results` writes it: named by the UTC date it started and the name given to `--machine`. `latest.json` is a copy of one of these, made by `npm run results:publish` | yes, for each run that was published |
| `scratch/` | every run that is not publishable: a smoke run, a narrowed one, one from a tree with uncommitted changes, one a script failed in. Beside each, a `.steps` directory with what every script of the run wrote and printed | no: git ignores it |

A run never writes `latest.json`: `npm run results:publish` copies a run's
dated file to that name once the file is shown to be publishable. Every results
file goes through one schema, ../src/benchmarks/results_schema.ts, and the
build of the site fails on one that doesn't parse.

## A run

`npm run results` starts every benchmark script in turn, each through its own
npm script, so under the node flags that script gives it, and each in a process
of its own that has exited before the next starts. Each of those scripts takes
`--data`, a path to also write what it measured to, as JSON: the figures
themselves, each with its spread where it has one, and never the text of a
table. The run reads each, validates it, and composes one file, with the
machine's name and its state as the run started and ended, Node's and V8's
versions, the installed version of every library and tool, the commit and
whether the tree was clean, each read as the run started and again as it ended,
and what each script was started with and how long it took.

| section | npm script |
| --- | --- |
| `bundle` | `npm run benchmark:bundle` |
| `types` | `npm run benchmark:types` |
| `allocations` | `npm run benchmark:allocations` |
| `heap` | `npm run benchmark:heap` |
| `coldstart` | `npm run benchmark:coldstart` |
| `run` | `npm run benchmark` |
| `survey` | `npm run benchmark:survey` |
| `harvest` | `npm run benchmark:harvest` |
| `wasm` | `npm run benchmark:wasm` |

- **A full run** gives each script no args of its own, so each measures with
  its defaults.
- **`--smoke`** runs each as briefly as it goes, to prove the suite works. Its
  numbers mean nothing, and it is never publishable.
- **`--only`**, which may be given more than once, runs only the sections it
  names, which is not a run to publish either.
- **`--wasm`** adds the `wasm` section, the Rust crate as wasm against this
  library. It is left out by default: it needs wasm-pack and a build of its
  own, `npm run build:wasm`, and compares no library with another, so a run
  without it is whole.
- **`--plan`** prints what the run would start, where it would write, and
  roughly how long it would take, and measures nothing.
- **A script that fails** doesn't stop the run: its section says so, the
  others are still measured, and the run is written to `scratch/`.
- **An edit or a commit made while the run measures** is in what it measured,
  so the tree is read again as the run ends: a run whose tree had changes
  either time, or was at another commit by the end, is written to `scratch/`.

A file is publishable when its kind is `full`, it was not narrowed,
every section but an optional one was measured, each script was started with
the args of a full run and no other, every timed section took more than one
pass, and the tree was clean at one commit as the run started and as it ended.
The fixture's kind is `fixture`, which is never publishable, whatever else the
file says of itself. `npm run results:publish` also refuses a run whose commit
the repository doesn't have. These checks guard against accident, a smoke run
or the fixture taken for a run to publish, and not against forgery: a file
edited by hand to say what a publishable run says passes them.

## Publishing a run

Everything below runs on the publishing machine, from the root of the checkout.

1. **A clean tree at the commit to publish.** `git status --short` prints
   nothing outside `results/`. A run records the commit it ran at, and a run
   from a tree with changes the commit doesn't hold, untracked files included,
   is written to `scratch/` and can't be published. Changes under `results/`
   don't count.
2. **Install exactly the locked versions.**
   ```bash
   npm ci
   ```
3. **Build.** The type and cold-start benchmarks read this library's build,
   as a consumer does, and refuse one that is missing or older than its source.
   ```bash
   gro build
   ```
4. **Smoke.**
   ```bash
   npm run results -- --smoke
   ```
   It runs every script once, briefly, and composes a file under `scratch/`,
   so a script that fails shows in this short run and not in the long one.
5. **Quiet the machine.** Timed numbers are one machine's, and comparable
   between runs only when it is prepared the same way each time: on AC power
   with the `performance` governor, nothing else running, no suspend, and a few
   minutes idle first. The run records the load average, each CPU's clock, and
   the frequency settings as it starts and as it ends, and the benchmarks page
   prints both, so a run taken under load says so itself.
6. **Plan the run**, and read the plan.
   ```bash
   npm run results -- --machine <name> --plan
   ```
   `publishable` must say yes, `commit` must be clean, and `output` is the
   file the run will write.
7. **The run.**
   ```bash
   npm run results -- --machine <name>
   ```
   It writes `<UTC date>_<name>.json`, prints what each section came to, and
   won't write over a run of the same date and machine: move that file, or
   delete it if it is not one to keep. A published run kept beside a later one
   of its day has its commit added to its name, as
   `<UTC date>_<name>_<commit>.json`.
8. **Check the run**, with the list below. A run that fails a check is measured
   again, not published with a note.
9. **Make it the published run.**
   ```bash
   npm run results:publish -- results/<UTC date>_<name>.json
   ```
   It refuses, with the reasons, a file that is not in `results/` itself, is
   `latest.json`, is not a results file, is not publishable, or records a
   commit the repository doesn't have, and otherwise writes `latest.json` as a
   byte-for-byte copy.
10. **Build the site over it**, with `BENCH_RESULTS_FIXTURE` and
    `BENCH_RESULTS_FILE` unset:
    ```bash
    gro build --no-install
    ```
    The build parses `latest.json` and fails, saying why, if the run is not
    publishable.
11. **Hold the README to it.** The README's Measurements section makes its
    comparative claims as bullets between two marker comments, and
    `src/test/readme_measurements.test.ts` holds each to `latest.json` by a
    row of `README_CLAIMS` in `src/test/readme_claims.ts`.
    - **The first time a run is published**, in this order: publish the run
      (step 9), paste the claims block into the README's Measurements section,
      each bullet the sentence of a row word for word, set
      `README_CLAIMS_HELD` to `true` in `src/test/readme_claims.ts`, and run
      `gro check`. Until that constant is `true` the test holds the README to
      having no claims block, so the block and the constant change together,
      and from then a missing `latest.json` fails the test.
    - **Every time after**, run `gro check`: it says which claim a new run no
      longer bears out, and what the run shows instead. Reword or remove the
      claim, in the README and in its row, and never loosen the row to keep
      the sentence.
12. **Commit** `latest.json`, the dated file, and the README with them.

## The checks a run must pass

- [ ] **Every section was measured.** The summary says `measured` for each,
      and `skipped` for none but `wasm`.
- [ ] **The machine held still.** In the file's `meta`, `machine_start` and
      `machine_end` name the same governor and driver, and neither load average
      is far above zero.
- [ ] **The spreads are narrow enough to read the tables by.** Each timed
      figure has the spread of its passes beside it, and a gap inside two
      spreads is not a difference: wide spreads throughout mean the machine was
      busy.
- [ ] **The commit is clean**, is the one meant to be published, and is the
      same as the run ended: `meta.commit_end` is `meta.commit`, and neither
      `meta.dirty` nor `meta.dirty_end` is set.
- [ ] **The versions are the ones intended**: each library's in `meta.libs`,
      the tools' in `meta.tools`, and `meta.node`.
- [ ] **`gro build` passes** with the file in place as `latest.json`.

## Rendering another file

Two environment variables make a build or a dev server render something other
than the published run, and each puts a banner on every page that says so:

- `BENCH_RESULTS_FIXTURE=1` renders the fixture,
  ../src/test/fixtures/results/fixture_run.json, whose numbers are invented.
- `BENCH_RESULTS_FILE=<path>` renders the run at a path under the repository,
  which need not be publishable and must hold every section, as a smoke run
  does: `BENCH_RESULTS_FILE=results/scratch/smoke_<name>.json gro build --no-install`.

Neither excuses the published run: with a `latest.json` that doesn't parse or
isn't publishable, a build fails whatever it was asked to render, so no build
passes over a bad published file.

## What a published file does not show

- **Another machine, engine, or version of Node.** The times are one machine's,
  on V8. Compare the ratios between libraries before the absolute times.
- **A noise floor.** No run calibrates one. A timed figure carries the spread
  of its own passes, which is of a few fresh processes.
- **Like for like.** The libraries build different things on the way to an
  answer, and ../docs/benchmarks.md says where under "Comparing like with like".
