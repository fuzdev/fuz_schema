/**
 * The copies of an input a timed function cycles through, a copy a call,
 * shared by every timing: the grader's cases, the cross-library scenarios, the
 * harvested sets, and the survey.
 *
 * A function given one object for the whole of its timing reads a cache keyed
 * by that object, or a fast path for the last input seen, as a win it is not:
 * a consumer parses a fresh object each time. So each copy is made apart from
 * the others, from the same JSON text where the value has one, and a call takes
 * the next. That defeats a cache of fewer entries than the copies, and no
 * other: a cache that keeps every input it was given hits again a lap later,
 * and is caught by `src/test/schema.fresh_input.test.ts`, not by a timing.
 *
 * Every library and both versions of a grade cycle the same way, so each pays
 * the same for the index. A large input has fewer copies, down to two, so a
 * case's copies stay near what one of them took in the caches of the processor:
 * all sixteen of the largest would read the memory as much as the library.
 *
 * This module imports nothing, so an instance of it holds nothing another does.
 *
 * @module
 */

/** The most copies of an input, a power of two so the index wraps with a mask. */
export const INPUT_COPIES_MAX = 16;

/**
 * The JSON text a value's copies hold together, at most, once there are two:
 * past it they are halved until they fit.
 */
export const INPUT_COPIES_TEXT = 64 * 1024;

// a value that `JSON.parse` gives back as it is, and its text, or `undefined`
const to_json_text = (value: unknown): string | undefined => {
	let text: string | undefined;
	try {
		text = JSON.stringify(value);
	} catch {
		return undefined;
	}
	return text !== undefined && is_same_value(JSON.parse(text), value) ? text : undefined;
};

// a deep comparison of what JSON can hold, which a value written as a literal
// with `undefined` or `NaN` in it fails
const is_same_value = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
	const a_keys = Object.keys(a);
	const b_keys = Object.keys(b);
	if (a_keys.length !== b_keys.length) return false;
	if (Array.isArray(a) && a.length !== (b as Array<unknown>).length) return false;
	for (let i = 0; i < a_keys.length; i++) {
		if (a_keys[i] !== b_keys[i]) return false;
		const key = a_keys[i]!;
		if (!is_same_value((a as any)[key], (b as any)[key])) return false;
	}
	return true;
};

/**
 * Makes the copies of `value` a timed function cycles through, a power of two
 * of them, so a call takes `copies[(at = (at + 1) & (copies.length - 1))]`.
 *
 * Each copy is made the same way, so they are one kind of object to the
 * engine: from the value's JSON text where `JSON.parse` gives the value back,
 * as a consumer's input is made, and by `structuredClone` where it doesn't, as
 * a value written with `undefined` or `NaN` in it. A primitive is its own copy.
 *
 * @returns `INPUT_COPIES_MAX` copies, or fewer for a large value, never under two
 */
export const to_input_copies = <T>(value: T): Array<T> => {
	if (typeof value !== 'object' || value === null) {
		return Array.from({ length: INPUT_COPIES_MAX }, () => value);
	}
	const text = to_json_text(value);
	let count = INPUT_COPIES_MAX;
	if (text !== undefined) {
		while (count > 2 && count * text.length > INPUT_COPIES_TEXT) count >>= 1;
		return Array.from({ length: count }, () => JSON.parse(text));
	}
	return Array.from({ length: count }, () => structuredClone(value));
};
