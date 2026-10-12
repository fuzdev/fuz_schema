import type { Task } from '@fuzdev/gro';

import { load_json_fixture_names, update_json_fixtures } from './json_test_helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for the JSON fixtures',
	run: async ({ log }) => {
		const names = await load_json_fixture_names();
		const written = await update_json_fixtures();
		for (const path of written) log.info(`wrote ${path}`);
		log.info(`${names.length} groups, ${written.length} written`);
	}
};
