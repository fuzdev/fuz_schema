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

import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';
import { stats_median } from '@fuzdev/fuz_util/stats.ts';

import { ENTRY_FORMS, type EntryForm } from './child.ts';
import {
	COLDSTART_STAGES,
	plan_coldstart,
	sample_coldstart,
	summarize_coldstart,
	to_bare_band_ms
} from './coldstart.ts';
import { format_table, hold_benchmark_lock } from './measure.ts';

const LIB_NAMES = ['fuz_schema', 'valibot', 'zod', 'zod_mini', 'typebox', 'arktype'];

const Names = z
	.union([z.string(), z.array(z.string())])
	.transform((v) => (Array.isArray(v) ? v : [v]));

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	lib: Names.default(LIB_NAMES).meta({ description: 'library names to run' }),
	scenario: Names.default(['object_flat', 'type_json']).meta({
		description: 'scenario names to run'
	}),
	form: z
		.union([z.enum(ENTRY_FORMS), z.array(z.enum(ENTRY_FORMS))])
		.transform((v): Array<EntryForm> => (Array.isArray(v) ? v : [v]))
		.default([...ENTRY_FORMS])
		.meta({ description: 'bundled, unbundled, or both' }),
	samples: z.number().int().positive().default(15).meta({ description: 'kept rounds' }),
	discard: z
		.number()
		.int()
		.nonnegative()
		.default(2)
		.meta({ description: 'rounds thrown away first' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

hold_benchmark_lock('fuz_schema coldstart');

const plan = await plan_coldstart(
	args.lib.map((lib) => ({ id: lib, lib })),
	args.scenario,
	args.form
);
console.log(
	`cold start: ${plan.processes.length} processes a round, ${args.discard} rounds discarded then ${args.samples} kept...`
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
	'import, create, and first parse are median ms of work inside the process, each stage\n' +
		'including the ones before it; process is what first parse added to the whole process\n' +
		`over bare, where an addition inside the bare band reads <${bare_band_ms.toFixed(1)}; ` +
		'peak is MB of resident\nmemory first parse added over bare'
);

for (const scenario of args.scenario) {
	for (const form of args.form) {
		const group = plan.processes.filter((p) => p.scenario === scenario && p.form === form);
		if (!group.length) continue;
		console.log(`\n${scenario}, ${form}\n`);
		console.log(
			format_table([
				['lib', ...COLDSTART_STAGES.map((s) => s.replace('_', ' ')), 'process', 'peak MB'],
				...args.lib.map((lib) => {
					const stages = COLDSTART_STAGES.map((stage) =>
						summarize_coldstart(group.find((p) => p.target === lib && p.stage === stage)!, bare)
					);
					const last = stages.at(-1)!;
					return [
						lib,
						...stages.map((s) => format_ms(s.work_ms)),
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
