import type { Task } from '@fuzdev/gro';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
	parse_benchmark_results,
	serialize_benchmark_results
} from '../../../benchmarks/results_schema.ts';
import { create_fixture_results } from './fixture_results.ts';

const FIXTURE_PATH = fileURLToPath(new URL('./fixture_run.json', import.meta.url));

export const task: Task = {
	summary: 'generate fixture_run.json, the results file of invented numbers',
	run: ({ log }) => {
		// through the schema, so a fixture the builder gets wrong is never written
		const text = serialize_benchmark_results(parse_benchmark_results(create_fixture_results()));
		let current: string | null = null;
		try {
			current = readFileSync(FIXTURE_PATH, 'utf8');
		} catch {
			// no file yet
		}
		if (current === text) {
			log.info('fixture_run.json is up to date');
			return;
		}
		writeFileSync(FIXTURE_PATH, text);
		log.info('wrote fixture_run.json');
	}
};
