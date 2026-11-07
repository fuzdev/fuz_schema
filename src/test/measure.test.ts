import { describe, test, assert } from 'vitest';

import { ensure_young_generation_free, get_young_generation } from '../benchmarks/measure.ts';

// what the fillers are written to, so that no compiler drops them
const kept: Array<unknown> = [null];

// allocates until less than `bytes` of the young generation is free, or a collection
// frees it again before that, and says which
const fill_young_generation = (bytes: number): boolean => {
	let free = get_young_generation().free;
	while (free >= bytes) {
		for (let i = 0; i < 16; i++) kept[0] = new Array(256);
		const next = get_young_generation().free;
		if (next > free) return false;
		free = next;
	}
	return true;
};

describe('ensure_young_generation_free', () => {
	test('a young generation short of what is asked is collected until it has it free', () => {
		const { size } = get_young_generation();
		const bytes = Math.floor(size / 2);
		// a collection can land as it fills, so it is filled again from what that left
		let filled = false;
		for (let tries = 0; tries < 4 && !filled; tries++) filled = fill_young_generation(bytes);
		assert.ok(filled, 'the young generation never had less than half of it free');
		assert.ok(get_young_generation().free < bytes);
		ensure_young_generation_free(bytes);
		assert.ok(get_young_generation().free >= bytes);
		kept[0] = null;
	});

	test('more than the young generation holds throws', () => {
		const { size } = get_young_generation();
		assert.throws(() => ensure_young_generation_free(size * 2), /the young generation has/);
	});
});
