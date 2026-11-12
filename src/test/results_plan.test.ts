import { assert, describe, test } from 'vitest';
import { readFileSync } from 'node:fs';

import { LIB_NAMES } from '../benchmarks/lib_names.ts';
import {
	RESULTS_DATA_FLAG,
	RESULTS_LIB_INFO,
	RESULTS_STEPS,
	estimate_results_seconds,
	find_unpublishable_reasons,
	plan_results_steps,
	to_results_libs,
	to_results_machine_name,
	to_results_path,
	to_results_steps_dir,
	type ResultsRunOptions
} from '../benchmarks/results_plan.ts';
import { BENCHMARK_FULL_ARGS, BENCHMARK_IDS } from '../benchmarks/results_schema.ts';

const read = (path: string): string =>
	readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const package_json = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

const FULL: ResultsRunOptions = { kind: 'full', only: null, wasm: false, machine: 'laptop1' };

describe('the steps of a run', () => {
	test('fill every section of the file, in its order, each once', () => {
		assert.deepStrictEqual(
			RESULTS_STEPS.map((step) => step.id),
			[...BENCHMARK_IDS]
		);
	});

	test('each starts an npm script that exists, so it runs under the flags that script gives it', () => {
		for (const step of RESULTS_STEPS) {
			assert.ok(Object.hasOwn(package_json.scripts, step.script), `no script "${step.script}"`);
		}
		// the bytes need a young generation sized by flag, which only its npm script passes
		assert.include(package_json.scripts['benchmark:allocations'], '--max-semi-space-size');
	});

	test('each starts a script that takes the data arg, by the name a run passes', () => {
		assert.strictEqual(RESULTS_DATA_FLAG, '--data');
		for (const step of RESULTS_STEPS) {
			const path = /src\/benchmarks\/\w+\.ts/.exec(package_json.scripts[step.script]!);
			assert.ok(path, `${step.script} names no script under src/benchmarks`);
			const source = read(path[0]);
			assert.match(source, /\bdata: DataArg\b/, `${path[0]} declares no data arg`);
			assert.match(
				source,
				new RegExp(`write_benchmark_data\\([^,]+, '${step.id}',`),
				`${path[0]} writes no ${step.id} data`
			);
		}
	});

	test('the cold-start script writes the band of each figure the page compares by one', () => {
		const source = read('src/benchmarks/run_coldstart.ts');
		// from the samples it holds, as a stage's band is taken: p10 to p90
		assert.match(source, /stats_percentile\(samples, 0\.9\) - stats_percentile\(samples, 0\.1\)/);
		assert.match(source, /later_band_ms: to_band\(later\)/);
		assert.match(source, /rss_band_kb: to_band\(rss\)/);
		assert.match(source, /const later = to_process\('parse_100'\)\.later_ms;/);
		assert.match(source, /const rss = to_process\('first_parse'\)\.rss_kb;/);
	});

	test('a full run gives a script no args, so it measures with its own defaults', () => {
		assert.deepStrictEqual([...BENCHMARK_FULL_ARGS], []);
		for (const planned of plan_results_steps({ ...FULL, wasm: true })) {
			assert.ok(planned.run, planned.step.id);
			assert.strictEqual(planned.args, BENCHMARK_FULL_ARGS, planned.step.id);
		}
	});
});

describe('plan_results_steps', () => {
	test('a run of everything leaves out only the optional section it did not ask for', () => {
		const left_out = plan_results_steps(FULL).filter((planned) => !planned.run);
		assert.deepStrictEqual(
			left_out.map((planned) => planned.step.id),
			['wasm']
		);
		assert.ok(plan_results_steps({ ...FULL, wasm: true }).every((planned) => planned.run));
	});

	test('a narrowed run starts only what it names, the optional section included', () => {
		const steps = plan_results_steps({ ...FULL, only: ['bundle', 'wasm'] });
		assert.deepStrictEqual(
			steps.filter((planned) => planned.run).map((planned) => planned.step.id),
			['bundle', 'wasm']
		);
		const skipped = steps.find((planned) => planned.step.id === 'run')!;
		assert.ok(!skipped.run);
		assert.include(skipped.reason, 'narrowed to bundle, wasm');
	});

	test('a smoke run gives each script its brief args, and takes less time by the estimate', () => {
		const smoke = plan_results_steps({ ...FULL, kind: 'smoke' });
		const run = smoke.find((planned) => planned.step.id === 'run')!;
		assert.ok(run.run);
		assert.deepStrictEqual(run.args, ['--passes', '1', '--duration', '50']);
		assert.isBelow(
			estimate_results_seconds(smoke, 'smoke'),
			estimate_results_seconds(plan_results_steps(FULL), 'full')
		);
	});
});

describe('where a run is written', () => {
	test('a publishable run by its date and machine, and any other to scratch', () => {
		const run = {
			kind: 'full',
			machine: 'laptop1',
			generated_at: '2026-11-12T23:59:59.000Z'
		} as const;
		assert.strictEqual(
			to_results_path({ ...run, publishable: true }, '/r'),
			'/r/2026-11-12_laptop1.json'
		);
		assert.strictEqual(
			to_results_path({ ...run, publishable: false }, '/r'),
			'/r/scratch/full_laptop1.json'
		);
		assert.strictEqual(
			to_results_path({ ...run, kind: 'smoke', publishable: false }, '/r'),
			'/r/scratch/smoke_laptop1.json'
		);
		assert.strictEqual(to_results_steps_dir(run, '/r'), '/r/scratch/full_laptop1.steps');
	});

	test('what is known before measuring that keeps a run from being published', () => {
		assert.deepStrictEqual(find_unpublishable_reasons(FULL, false), []);
		assert.lengthOf(find_unpublishable_reasons({ kind: 'smoke', only: null }, false), 1);
		assert.lengthOf(find_unpublishable_reasons({ kind: 'full', only: ['run'] }, false), 1);
		assert.lengthOf(find_unpublishable_reasons(FULL, true), 1);
		assert.lengthOf(find_unpublishable_reasons({ kind: 'smoke', only: ['run'] }, true), 3);
	});

	test('a hostname becomes a name a file can have', () => {
		assert.strictEqual(to_results_machine_name('my host.local'), 'my_host.local');
		assert.strictEqual(to_results_machine_name('--'), 'machine');
	});
});

describe('the roster', () => {
	test('names every library under comparison, in order, each with its version', () => {
		assert.sameMembers(Object.keys(RESULTS_LIB_INFO), [...LIB_NAMES]);
		const libs = to_results_libs({ valibot: '1.2.3' });
		assert.deepStrictEqual(
			libs.map((lib) => lib.id),
			[...LIB_NAMES]
		);
		assert.strictEqual(libs.find((lib) => lib.id === 'valibot')!.version, '1.2.3');
		// a version that can't be read is one the schema refuses
		assert.strictEqual(libs.find((lib) => lib.id === 'arktype')!.version, 'missing');
	});

	test("marks this library as the maintainer's, and no other", () => {
		assert.deepStrictEqual(
			to_results_libs({})
				.filter((lib) => lib.by_maintainer)
				.map((lib) => lib.id),
			['fuz_schema']
		);
	});
});
