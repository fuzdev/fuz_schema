/**
 * Cold start across libraries. See `coldstart.ts` for the method.
 *
 * Usage:
 *   gro run src/benchmarks/run_coldstart.ts
 *   gro run src/benchmarks/run_coldstart.ts --lib fuz_schema --lib valibot --samples 30
 *   gro run src/benchmarks/run_coldstart.ts --scenario type_json --form bundled
 *
 * @module
 */

import { stats_median, stats_percentile } from '@fuzdev/fuz_util/stats.ts';

import {
	DataArg,
	LibNamesArg,
	ScenarioNamesArg,
	meta,
	parse_args,
	s,
	to_count_arg,
	write_benchmark_data
} from './args.ts';
import { ENTRY_FORMS, type EntryForm } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart,
	to_bare_band_ms,
	type ColdstartProcess,
	type ColdstartStage
} from './coldstart.ts';
import { LIB_NAMES } from './lib_names.ts';
import { COMPARED_LIB_PACKAGES, format_benchmark_header } from './machine.ts';
import { format_table } from './measure.ts';
import type { ColdstartFigures } from './results_schema.ts';
import type { ScenarioName } from './scenarios.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	lib: meta(
		s.with_default_fn(LibNamesArg, () => [...LIB_NAMES]),
		{ description: 'library names to run' }
	),
	scenario: meta(
		s.with_default_fn(ScenarioNamesArg, (): Array<ScenarioName> => [
			'object_flat',
			'type_json',
			'app'
		]),
		{ description: 'scenario names to run' }
	),
	form: meta(
		s.with_default_fn(
			s.pipe(
				s.union([s.one_of(ENTRY_FORMS), s.array(s.one_of(ENTRY_FORMS))]),
				s.transform((v: EntryForm | Array<EntryForm>): Array<EntryForm> =>
					Array.isArray(v) ? v : [v]
				)
			),
			() => [...ENTRY_FORMS]
		),
		{ description: 'bundled, unbundled, or both' }
	),
	samples: meta(to_count_arg(15), { description: 'kept rounds' }),
	discard: meta(to_count_arg(2, 0), { description: 'rounds thrown away first' }),
	data: DataArg
});

const args = parse_args(Args);

console.log(format_benchmark_header([...COMPARED_LIB_PACKAGES, 'rolldown']));

const plan = await plan_coldstart(
	args.lib.map((lib) => ({ id: lib, lib })),
	args.scenario,
	args.form
);
console.log(
	`\ncold start: ${plan.processes.length} processes a round, ${args.discard} rounds discarded then ${args.samples} kept...`
);
sample_coldstart(plan, args.samples, args.discard);

const { bare } = plan;
const bare_band_ms = to_bare_band_ms(bare);

const format_ms = (ms: number): string => (ms >= 10 ? ms.toFixed(1) : ms.toFixed(2));

console.log(
	`\nbare process: ${stats_median(bare.ms).toFixed(2)}ms (p10 to p90 band ${bare_band_ms.toFixed(2)}ms), ` +
		`peak ${(stats_median(bare.rss_kb) / 1024).toFixed(1)}MB`
);
console.log(
	'import, create, first parse, parse 10, and parse 100 are median ms of work inside the process,\n' +
		'each stage including the ones before it, the last two the tenth parse and the hundredth, each\n' +
		'of a copy of the input; 2 to 100 is parse 100 from its clock after the first parse, in the\n' +
		'same process; process is what first parse added to the whole process over bare, where an\n' +
		`addition inside the bare band reads <${bare_band_ms.toFixed(1)}; peak is MB of resident ` +
		'memory first parse added over\nbare. Each stage is processes of its own, so a stage can read ' +
		'under the one before it where the\nwork between them is less than the spread of ' +
		"a stage's samples"
);

for (const scenario of args.scenario) {
	for (const form of args.form) {
		const group = plan.processes.filter((p) => p.scenario === scenario && p.form === form);
		if (!group.length) continue;
		console.log(`\n${scenario}, ${form}\n`);
		console.log(
			format_table([
				[
					'lib',
					...COLDSTART_STAGES.map((s) => s.replace('_', ' ')),
					'2 to 100',
					'process',
					'peak MB'
				],
				...args.lib.map((lib) => {
					const stages = COLDSTART_STAGES.map((stage) =>
						summarize_coldstart(group.find((p) => p.target === lib && p.stage === stage)!, bare)
					);
					const last = stages[COLDSTART_STAGES.indexOf('first_parse')]!;
					return [
						lib,
						...stages.map((s) => format_ms(s.work_ms)),
						format_ms(stages[COLDSTART_STAGES.indexOf('parse_100')]!.later_ms),
						last.added_ms < bare_band_ms
							? `<${bare_band_ms.toFixed(1)}`
							: `+${last.added_ms.toFixed(1)}`,
						last.added_rss_kb <= 0 ? '≈ bare' : `+${(last.added_rss_kb / 1024).toFixed(1)}`
					];
				})
			])
		);
	}
}

if (args.data !== undefined) {
	// the p10 to p90 band of a figure's samples, as `summarize_coldstart` takes a stage's
	const to_band = (samples: Array<number>): number =>
		stats_percentile(samples, 0.9) - stats_percentile(samples, 0.1);
	// what the tables above were printed from, unformatted
	write_benchmark_data(args.data, 'coldstart', {
		samples: args.samples,
		discard: args.discard,
		bare: {
			ms: stats_median(bare.ms),
			band_ms: bare_band_ms,
			rss_kb: stats_median(bare.rss_kb)
		},
		rows: args.scenario.flatMap((scenario) =>
			args.form.flatMap((form) => {
				const group = plan.processes.filter((p) => p.scenario === scenario && p.form === form);
				if (!group.length) return [];
				const to_figures = (lib: string): ColdstartFigures => {
					const stages = COLDSTART_STAGES.map((stage) =>
						summarize_coldstart(group.find((p) => p.target === lib && p.stage === stage)!, bare)
					);
					const first = stages[COLDSTART_STAGES.indexOf('first_parse')]!;
					// the samples the two figures below are medians of, for the band of each
					const to_process = (stage: ColdstartStage): ColdstartProcess =>
						group.find((p) => p.target === lib && p.stage === stage)!;
					const later = to_process('parse_100').later_ms;
					const rss = to_process('first_parse').rss_kb;
					return {
						stages: Object.fromEntries(
							COLDSTART_STAGES.map((stage, i) => [
								stage,
								{ work_ms: stages[i]!.work_ms, band_ms: stages[i]!.work_band_ms }
							])
						) as ColdstartFigures['stages'],
						later_ms: stages[COLDSTART_STAGES.indexOf('parse_100')]!.later_ms,
						later_band_ms: to_band(later),
						added_ms: first.added_ms,
						added_rss_kb: first.added_rss_kb,
						rss_band_kb: to_band(rss)
					};
				};
				return [
					{
						scenario,
						form,
						libs: Object.fromEntries(args.lib.map((lib) => [lib, to_figures(lib)]))
					}
				];
			})
		)
	});
}
