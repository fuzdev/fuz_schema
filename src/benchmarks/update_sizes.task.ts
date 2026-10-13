import type { Task } from '@fuzdev/gro';

import { update_sizes } from './sizes.ts';

export const task: Task = {
	summary: "generate sizes.json, the snapshot of this library's bundle sizes",
	run: async ({ log }) => {
		log.info((await update_sizes()) ? 'wrote sizes.json' : 'sizes.json is up to date');
	}
};
