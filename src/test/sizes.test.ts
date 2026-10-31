import { describe, test, assert } from 'vitest';
import { readdir } from 'node:fs/promises';

import { LIBRARY_MODULES } from '../benchmarks/bundle_size.ts';
import { format_sizes, measure_sizes, read_sizes } from '../benchmarks/sizes.ts';

describe('sizes', () => {
	test('sizes.json is what the library measures', async () => {
		assert.strictEqual(
			await read_sizes(),
			format_sizes(await measure_sizes()),
			'src/benchmarks/sizes.json is stale, run `gro task src/benchmarks/update_sizes.task.ts`'
		);
	});

	test('every module of the library is measured', async () => {
		const modules = (await readdir(new URL('../lib/', import.meta.url))).filter((name) =>
			name.endsWith('.ts')
		);
		assert.sameMembers(
			modules,
			['schema.ts', ...LIBRARY_MODULES],
			'a module of src/lib that `LIBRARY_MODULES` in bundle_size.ts leaves out, or one it names that is gone'
		);
	});
});
