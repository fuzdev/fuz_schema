import type { Tome } from '@fuzdev/fuz_ui/tome.ts';
import ApiPage from './api/+page.svelte';
import BenchmarksPage from './benchmarks/+page.svelte';

export const tomes: Array<Tome> = [
	{
		slug: 'benchmarks',
		category: 'guide',
		Component: BenchmarksPage,
		related_tomes: ['api'],
		related_modules: [],
		related_declarations: []
	},
	{
		slug: 'api',
		category: 'reference',
		Component: ApiPage,
		related_tomes: ['benchmarks'],
		related_modules: [],
		related_declarations: []
	}
];
