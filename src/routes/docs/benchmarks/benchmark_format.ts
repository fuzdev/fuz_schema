/**
 * Formatters for the numbers the benchmarks page shows. Each is pinned to one
 * locale, so a prerendered page and its hydrated copy print the same text.
 *
 * @module
 */

/** A count with thousands separators. */
export const format_count = (n: number): string => n.toLocaleString('en-US');

/**
 * A number to about three significant digits: two decimals under 10, one under
 * 100, and a whole count from there.
 */
export const format_significant = (n: number): string => {
	const abs = Math.abs(n);
	if (abs >= 99.95) return format_count(Math.round(n));
	return n.toFixed(abs >= 9.995 ? 1 : 2);
};

/**
 * A byte count in decimal units, where 1 kB is 1,000 bytes. A count under a
 * kilobyte is printed whole, or with a decimal where it has a fraction, as a
 * median of bytes over calls can.
 */
export const format_bytes = (bytes: number): string => {
	const abs = Math.abs(bytes);
	if (abs < 1000) return `${Number.isInteger(bytes) ? format_count(bytes) : bytes.toFixed(1)} B`;
	if (abs < 999_500) return `${format_significant(bytes / 1000)} kB`;
	return `${format_significant(bytes / 1_000_000)} MB`;
};

/** A duration given in nanoseconds, in the unit that keeps it readable. */
export const format_ns = (ns: number): string => {
	if (ns < 99.95) return `${format_significant(ns)} ns`;
	if (ns < 999.5) return `${Math.round(ns)} ns`;
	if (ns < 999_500) return `${format_significant(ns / 1000)} µs`;
	if (ns < 999_500_000) return `${format_significant(ns / 1_000_000)} ms`;
	return `${format_significant(ns / 1_000_000_000)} s`;
};

/** A duration given in milliseconds. */
export const format_ms = (ms: number): string => `${format_significant(ms)} ms`;

/** A duration given in seconds. */
export const format_seconds = (seconds: number): string => `${seconds.toFixed(2)} s`;

/** A duration given in milliseconds, for a sentence: seconds under a minute and a half, minutes from there. */
export const format_duration = (ms: number): string =>
	ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`;

/** A ratio as a factor: `1.00×`, `12.3×`, `140×`. */
export const format_ratio = (ratio: number): string => `${format_significant(ratio)}×`;

/** A fraction as a percentage: 0.033 is `3.3%`, and a whole percentage from 10. */
export const format_percent = (fraction: number): string =>
	`${(fraction * 100).toFixed(fraction < 0.0995 ? 1 : 0)}%`;

/** The UTC date of an ISO timestamp, as `YYYY-MM-DD`. */
export const format_date = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

/** A run of text, as prose or as code. */
export interface TextSegment {
	text: string;
	code: boolean;
}

/**
 * Splits a text on its backticks, so what is between a pair prints as code
 * and no backtick prints at all: the scripts and the roster write their names
 * of code that way. An unpaired backtick leaves the rest as code.
 */
export const to_text_segments = (text: string): Array<TextSegment> =>
	text
		.split('`')
		.map((part, i) => ({ text: part, code: i % 2 === 1 }))
		.filter((segment) => segment.text !== '');

/** How many characters of a commit hash the page prints. */
export const COMMIT_LABEL_LENGTH = 10;

/** A commit hash shortened for display. */
export const format_commit = (hash: string): string => hash.slice(0, COMMIT_LABEL_LENGTH);
