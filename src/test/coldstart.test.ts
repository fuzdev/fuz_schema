import { describe, test, assert } from 'vitest';

import { to_coldstart_order } from '../benchmarks/coldstart.ts';

// the rounds a default run of cold start takes, and some more
const ROUNDS = 30;

describe('to_coldstart_order', () => {
	for (const count of [1, 2, 3, 7, 14, 21, 32, 61]) {
		test(`${count} processes`, () => {
			const orders = Array.from({ length: ROUNDS }, (_, round) => to_coldstart_order(count, round));
			for (const order of orders) {
				assert.sameMembers(order, [...Array(count).keys()], 'every process once a round');
			}
			// each leads about equally: the counts of leads differ by one at most
			const leads = Array.from(
				{ length: count },
				(_, i) => orders.filter((o) => o[0] === i).length
			);
			assert.isAtMost(Math.max(...leads) - Math.min(...leads), 1, 'leads');
			if (count < 3) return;
			// no process is always run after the same neighbor
			for (let p = 0; p < count; p++) {
				const before = new Set(
					orders
						.map((order) => order.indexOf(p))
						.flatMap((at, round) => (at > 0 ? [orders[round]![at - 1]] : []))
				);
				assert.isAbove(before.size, 1, `process ${p} is always after one neighbor`);
			}
		});
	}

	test('a count that is a multiple of seven moves on each round', () => {
		const first = to_coldstart_order(14, 0);
		for (let round = 1; round < ROUNDS; round++) {
			assert.notDeepEqual(to_coldstart_order(14, round), first);
		}
	});
});
