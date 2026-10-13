import { test, assert, describe } from 'vitest';

import * as s from '#lib/schema.ts';
import { CASE_GROUPS, CASE_PATHS, create_cases } from '../benchmarks/cases.ts';

describe('the case matrix', () => {
	const cases = create_cases(s);

	test('every group builds', () => {
		// called directly, since `create_cases` drops a group that throws unless it is strict
		for (const group of CASE_GROUPS) assert(group(s).length > 0);
	});

	test('names are unique and are group/shape/outcome', () => {
		assert.strictEqual(new Set(cases.map((c) => c.name)).size, cases.length);
		for (const c of cases) {
			assert.match(c.name, /^[a-z]+\/[a-z0-9_]+\/(valid|invalid)$/);
			assert.strictEqual(c.name.slice(0, c.name.indexOf('/')), c.group, c.name);
			assert.strictEqual(c.name.endsWith('/valid'), c.valid, c.name);
		}
	});

	test('every case matches or not as it says, and takes the path it names', () => {
		for (const c of cases) {
			assert(CASE_PATHS.includes(c.path), c.name);
			assert.strictEqual(c.ok(), c.valid, c.name);
			const output = c.run();
			if (c.path === 'probe') {
				assert.strictEqual(output, c.valid ? c.input : undefined, c.name);
			} else if (c.valid) {
				// `identity` is the input itself, `copy` anything else
				assert.strictEqual(output === c.input, c.path === 'identity', c.name);
			} else {
				assert.strictEqual(c.path, 'issues', c.name);
				assert.strictEqual(output, undefined, c.name);
			}
		}
	});

	test('the realistic cases are the `real` group, and take every path', () => {
		for (const c of cases) assert.strictEqual(c.realistic, c.group === 'real', c.name);
		for (const path of CASE_PATHS) {
			assert(
				cases.some((c) => c.realistic && c.path === path),
				path
			);
		}
	});
});
