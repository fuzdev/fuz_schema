/**
 * `npm run differential`: the differential of `differential_classify.ts` at a
 * depth for review, outside `gro check`. Each seed is run and reported in
 * turn: its tallies, the cases each rule of a declared difference was needed
 * for, and every finding minimized, printed as a case to paste into the
 * matrix. Exits nonzero on an undeclared difference, a throw of this library,
 * or a broken invariant.
 *
 * Runs under Node's type stripping, with the heap its npm script sets, and
 * its memory cap where `systemd-run --user` can start a scope.
 *
 * @module
 */

import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import * as s from '#lib/schema.ts';
import { format_differential_report, run_differential } from './differential_classify.ts';
import { DIFFERENTIAL_KINDS } from './differential_generate.ts';

const Seeds = s.pipe(
	s.union([s.number, s.array(s.number)]),
	s.transform((v: number | Array<number>) => (Array.isArray(v) ? v : [v]))
);

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	seed: s.optional(Seeds),
	count: s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(1)), 100_000),
	focus: s.optional(s.one_of(DIFFERENTIAL_KINDS)),
	limit: s.with_default(s.pipe(s.number, s.safe_integer, s.min_value(0)), 50),
	neither: s.with_default(s.boolean, false)
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.ok) {
	console.error(parsed.issues.map(s.format_issue).join('\n'));
	console.error(
		'\nusage: npm run differential -- [--seed n]... [--count n] [--focus kind] [--limit n] [--neither]' +
			`\nkinds: ${DIFFERENTIAL_KINDS.join(', ')}`
	);
	process.exit(1);
}
const args = parsed.value;

const seeds = args.seed ?? [Math.floor(Math.random() * 2 ** 31)];
let failed = false;
for (const seed of seeds) {
	const start = performance.now();
	const report = run_differential({
		seed,
		count: args.count,
		focus: args.focus ?? null,
		minimize_limit: args.limit,
		minimize_neither: args.neither
	});
	console.log(format_differential_report(report));
	console.log(`\n${Math.round(performance.now() - start)} ms\n`);
	if (report.tally.undeclared || report.tally.throws || report.invariants.length) failed = true;
}
if (failed) process.exitCode = 1;
