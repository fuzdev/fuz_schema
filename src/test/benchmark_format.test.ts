import { assert, describe, test } from 'vitest';

import {
	format_bytes,
	format_commit,
	format_count,
	format_date,
	format_duration,
	format_ms,
	format_ns,
	format_percent,
	format_ratio,
	format_seconds,
	format_significant,
	to_text_segments
} from '#routes/docs/benchmarks/benchmark_format.ts';

describe('format_significant', () => {
	test('keeps about three digits, and steps a tier where its rounding would print a digit more', () => {
		assert.strictEqual(format_significant(1), '1.00');
		assert.strictEqual(format_significant(9.994), '9.99');
		assert.strictEqual(format_significant(9.995), '10.0');
		assert.strictEqual(format_significant(99.94), '99.9');
		assert.strictEqual(format_significant(99.95), '100');
		assert.strictEqual(format_significant(12345.6), '12,346');
	});
});

describe('format_ns', () => {
	test('picks the unit that keeps the number readable, and never prints 1000 of one', () => {
		assert.strictEqual(format_ns(4.24), '4.24 ns');
		assert.strictEqual(format_ns(18.4), '18.4 ns');
		assert.strictEqual(format_ns(146), '146 ns');
		assert.strictEqual(format_ns(999.4), '999 ns');
		assert.strictEqual(format_ns(999.5), '1.00 µs');
		assert.strictEqual(format_ns(11_289), '11.3 µs');
		assert.strictEqual(format_ns(999_500), '1.00 ms');
		assert.strictEqual(format_ns(1_500_000_000), '1.50 s');
	});
});

describe('format_bytes', () => {
	test('uses decimal units, whole under a kilobyte unless the count has a fraction', () => {
		assert.strictEqual(format_bytes(0), '0 B');
		assert.strictEqual(format_bytes(354), '354 B');
		assert.strictEqual(format_bytes(88.008), '88.0 B');
		assert.strictEqual(format_bytes(2956), '2.96 kB');
		assert.strictEqual(format_bytes(999_500), '1.00 MB');
		assert.strictEqual(format_bytes(15_568_619), '15.6 MB');
	});
});

describe('the other formatters', () => {
	test('a ratio is a factor', () => {
		assert.strictEqual(format_ratio(1), '1.00×');
		assert.strictEqual(format_ratio(23.24), '23.2×');
		assert.strictEqual(format_ratio(450), '450×');
	});

	test('a spread is a percentage, with a decimal while it is small', () => {
		assert.strictEqual(format_percent(0.03), '3.0%');
		assert.strictEqual(format_percent(0.0994), '9.9%');
		assert.strictEqual(format_percent(0.25), '25%');
	});

	test('durations, counts, dates, and commits', () => {
		assert.strictEqual(format_ms(0.63), '0.63 ms');
		assert.strictEqual(format_seconds(0.15), '0.15 s');
		assert.strictEqual(format_duration(37_000), '37 s');
		assert.strictEqual(format_duration(432_000), '7.2 min');
		assert.strictEqual(format_count(109_824), '109,824');
		// in UTC, whatever the zone of the machine that prerenders
		assert.strictEqual(format_date('2026-11-12T23:30:00.000Z'), '2026-11-12');
		assert.strictEqual(format_commit('9e1802eec0a7597acef26a38c1e17f093cb0d49f'), '9e1802eec0');
	});
});

describe('to_text_segments', () => {
	test('what is between a pair of backticks is code, and no backtick is text', () => {
		assert.deepStrictEqual(to_text_segments('the schemas of `repos status`, in zod'), [
			{ text: 'the schemas of ', code: false },
			{ text: 'repos status', code: true },
			{ text: ', in zod', code: false }
		]);
		assert.deepStrictEqual(to_text_segments('`a` and `b`'), [
			{ text: 'a', code: true },
			{ text: ' and ', code: false },
			{ text: 'b', code: true }
		]);
		assert.deepStrictEqual(to_text_segments('plain'), [{ text: 'plain', code: false }]);
		assert.deepStrictEqual(to_text_segments(''), []);
	});
});
