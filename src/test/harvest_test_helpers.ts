/**
 * Helpers for the tests that hold a harvested schema set's two ports, the
 * consumer's own and this library's, to the same answers on its data.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

/** Reads a JSON file beside the benchmarks, by its path from `src/benchmarks/`. */
export const read_benchmark_json = (path: string): any =>
	JSON.parse(readFileSync(new URL(`../benchmarks/${path}`, import.meta.url), 'utf8'));

export interface WalkedValue {
	at: any;
	path: Array<PropertyKey>;
}

/** Every object and array in `value`, each with the keys that lead to it. */
export const walk = (
	value: unknown,
	path: Array<PropertyKey> = [],
	found: Array<WalkedValue> = []
): Array<WalkedValue> => {
	if (value !== null && typeof value === 'object') {
		found.push({ at: value, path });
		for (const [key, child] of Object.entries(value)) {
			walk(child, [...path, Array.isArray(value) ? Number(key) : key], found);
		}
	}
	return found;
};

export interface ChangedValue {
	label: string;
	value: unknown;
}

// a value of each JSON type
const WRONG: ReadonlyArray<unknown> = [1, 'x', true, null, {}, []];

// numbers at the edge of the checks on one
const NUMBERS: ReadonlyArray<number> = [0, -1, 1.5, 2 ** 53, Infinity];

// strings at the edge of the checks on one: empty, and one no format takes
const STRINGS: ReadonlyArray<string> = ['', 'x'];

/**
 * Copies of `value`, each changed in one place: an unknown key on an object,
 * a key renamed, a key gone, a value replaced by one of every other type, a
 * number or a string by the ones at the edge of a check, an array emptied or
 * cut short by one. Not every change is wrong: a key may be optional, or its
 * object loose.
 *
 * The places are one of each shape: the objects and arrays of `value` that
 * have the same keys are changed once between them, so a document of many like
 * items costs what one of them does, and every schema its data reaches is
 * tried.
 *
 * @param by_path - whether two places with the same keys at different paths, whatever the index of an item along them, are two shapes: needed where schemas differ only in the values of their keys, and several times the work
 */
export const to_changed = (value: unknown, by_path = true): Array<ChangedValue> => {
	const changed: Array<ChangedValue> = [];
	const shapes: Set<string> = new Set();
	for (const site of walk(value)) {
		const shape =
			(by_path
				? site.path.map((key) => (typeof key === 'number' ? '*' : String(key))).join('.')
				: // an array's shape is what holds it
					Array.isArray(site.at)
					? String(site.path.findLast((key) => typeof key === 'string'))
					: '') +
			'|' +
			(Array.isArray(site.at) ? '[]' : Object.keys(site.at).sort().join(','));
		if (shapes.has(shape)) continue;
		shapes.add(shape);
		const where = site.path.join('.') || 'the root';
		const change = (label: string, fn: (at: any) => void): void => {
			const copy = structuredClone(value);
			let at: any = copy;
			for (const key of site.path) at = at[key];
			fn(at);
			changed.push({ label: `${label} at ${where}`, value: copy });
		};
		const is_array = Array.isArray(site.at);
		if (!is_array) {
			change('an unknown key', (at) => (at.unknown_key = 1));
			// its value still fits, so only a check on the key refuses it
			const first = Object.keys(site.at)[0];
			if (first !== undefined) {
				change(`${first} renamed`, (at) => {
					at['Renamed Key'] = at[first];
					delete at[first];
				});
			}
		} else if (site.at.length) {
			change('no items', (at) => (at.length = 0));
			if (site.at.length > 1) change('an item fewer', (at) => at.pop());
		}
		for (const key of Object.keys(site.at)) {
			const original: unknown = site.at[key];
			if (!is_array) change(`no ${key}`, (at) => delete at[key]);
			for (const wrong of WRONG) {
				if (
					typeof wrong === typeof original &&
					(wrong === null) === (original === null) &&
					Array.isArray(wrong) === Array.isArray(original)
				) {
					continue;
				}
				change(`${JSON.stringify(wrong)} for ${key}`, (at) => (at[key] = wrong));
			}
			if (typeof original === 'number') {
				for (const n of NUMBERS) change(`${n} for ${key}`, (at) => (at[key] = n));
			}
			if (typeof original === 'string') {
				for (const text of STRINGS) {
					if (text !== original) change(`"${text}" for ${key}`, (at) => (at[key] = text));
				}
			}
		}
	}
	return changed;
};

/**
 * The paths of `issues`, each joined with dots, sorted, and each once: one
 * library may report two issues where another reports the first.
 */
export const to_paths = (
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>
): Array<string> => [...new Set(issues.map((issue) => issue.path.join('.')))].sort();

/** Whether every path of `inner` is one of `outer` or lies under one. */
export const paths_are_within = (inner: Array<string>, outer: Array<string>): boolean =>
	inner.every((path) =>
		outer.some((parent) => parent === '' || path === parent || path.startsWith(parent + '.'))
	);
