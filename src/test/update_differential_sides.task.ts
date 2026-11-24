import type { Task } from '@fuzdev/gro';

import { update_differential_sides } from './differential_sides.ts';

export const task: Task = {
	summary:
		'generate differential_sides.json, whose side this library is on where zod and valibot disagree',
	run: async ({ log }) => {
		log.info(
			(await update_differential_sides())
				? 'wrote differential_sides.json'
				: 'differential_sides.json is up to date'
		);
	}
};
