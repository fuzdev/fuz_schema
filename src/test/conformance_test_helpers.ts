/**
 * Running the conformance matrix and comparing the results: the cases of
 * `conformance_cases.ts` run through the libraries of
 * `conformance_adapters.ts`, with what each did reduced to a text that can be
 * compared. `schema.conformance.test.ts` holds the rule they are judged by,
 * and `conformance_tables.ts` the tables of what is declared.
 *
 * @module
 */

import {
	CONFORMANCE_LIBS,
	CONFORMANCE_FLAVORS,
	INFORMATIONAL_LIBS,
	type ConformanceFlavor,
	type ConformanceLib,
	type ConformanceLibName,
	type ConformanceParsed,
	type InformationalLibName
} from './conformance_adapters.ts';
import { CONFORMANCE_CASES, type ConformanceCase } from './conformance_cases.ts';

//
// Results as text
//

const render_key = (key: PropertyKey): string => String(key);

// a key of a path, an index told from the string of its digits
const render_path_key = (key: PropertyKey): string =>
	typeof key === 'number' ? `[${key}]` : String(key);

/**
 * Writes `value` as text that two values share only when they'd be told apart
 * by nothing a consumer reads: an object's own keys in the order
 * `Reflect.ownKeys` gives, each value, the keys that aren't enumerable, and
 * whether the prototype is `Object.prototype` (unmarked), `null`, or another.
 */
export const render_value = (value: unknown): string => {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
	if (typeof value === 'bigint') return value + 'n';
	if (typeof value === 'function') return 'fn';
	if (value === null || typeof value !== 'object') return String(value);
	const keys = Reflect.ownKeys(value);
	const entries = (list: Array<PropertyKey>): string =>
		list.map((key) => `${render_key(key)}: ${render_value((value as any)[key])}`).join(', ');
	if (!Array.isArray(value)) return `{${entries(keys)}}` + render_shape(value);
	const items = Array.from({ length: value.length }, (_, i) =>
		i in value ? render_value(value[i]) : '<hole>'
	);
	// an array's own keys past its items
	const rest = keys.filter((key) => key !== 'length' && !is_index(key));
	return (
		`[${items.join(', ')}]` + (rest.length ? ` with {${entries(rest)}}` : '') + render_shape(value)
	);
};

const is_index = (key: PropertyKey): boolean => typeof key === 'string' && /^\d+$/.test(key);

/**
 * Writes what an object is past its keys and values: its prototype, when that
 * isn't the plain one, and which keys aren't enumerable.
 */
export const render_shape = (value: object): string => {
	const proto = Object.getPrototypeOf(value);
	const hidden = Reflect.ownKeys(value).filter(
		(key) =>
			!Object.prototype.propertyIsEnumerable.call(value, key) &&
			// every array has it
			!(key === 'length' && Array.isArray(value))
	);
	return (
		(proto === Object.prototype || proto === Array.prototype
			? ''
			: proto === null
				? ' proto=null'
				: ' proto=other') + (hidden.length ? ` hidden=${hidden.map(render_key).join(',')}` : '')
	);
};

/**
 * Writes what a library did as `ok` and the output, or `fail` and where.
 *
 * Of a refusal only this much compares honestly across the three: the paths
 * of the issues that aren't about an unknown key, and the paths of the objects
 * that had one, each once and sorted. An index of an array is written `[1]`,
 * so that it isn't the key `1`. Not compared, because the libraries count
 * differently: how many issues there are (zod reports every unknown key of an
 * object in one issue at the object's path, valibot the first alone at the
 * key's, this library each at its own), which keys were unknown, the kinds of
 * the issues, and their text.
 */
export const render_parsed = (parsed: ConformanceParsed): string => {
	if (parsed.ok) return 'ok ' + render_value(parsed.value);
	const render_paths = (list: Array<ReadonlyArray<PropertyKey>>): string =>
		[...new Set(list.map((path) => path.map(render_path_key).join('.') || '<root>'))]
			.sort()
			.join(', ');
	return (
		'fail' +
		(parsed.paths.length ? ' at ' + render_paths(parsed.paths) : '') +
		(parsed.unknown_keys.length ? ' +unknown keys in ' + render_paths(parsed.unknown_keys) : '')
	);
};

//
// Running
//

/** What one library did with one case in one flavor. */
export interface ConformanceResult {
	/** `render_parsed` of the result, or `throws` and the error's first line. */
	text: string;
	ok: boolean;
	/** The output, when `ok`. */
	value: unknown;
	/** The input this run was given, which no other run was. */
	input: unknown;
	/** Whether the output is the input object itself. */
	is_input: boolean;
}

export interface ConformanceRow {
	/** The case's name, with the flavor after a slash when the case has flavors. */
	name: string;
	case: ConformanceCase;
	flavor: ConformanceFlavor | null;
	results: Record<ConformanceLibName, ConformanceResult>;
	/** `render_value` of the case's input. */
	input_text: string;
	/** `render_parsed` of what each library named in the case's `also` did. */
	informational: Partial<Record<InformationalLibName, string>>;
}

const is_object = (value: unknown): value is object => typeof value === 'object' && value !== null;

const run_one = (
	lib: Partial<ConformanceLib>,
	c: ConformanceCase,
	flavor: ConformanceFlavor | null
): ConformanceResult => {
	const input = c.input();
	try {
		const l = lib as ConformanceLib;
		const parsed = l.parse(flavor ? l[flavor](c.entries!(l)) : c.schema!(l), input);
		return {
			text: render_parsed(parsed),
			ok: parsed.ok,
			value: parsed.ok ? parsed.value : undefined,
			input,
			is_input: parsed.ok && parsed.value === input && is_object(input)
		};
	} catch (error) {
		return {
			text: 'throws: ' + (error as Error).message.split('\n')[0],
			ok: false,
			value: undefined,
			input,
			is_input: false
		};
	}
};

/** Runs every case, through every flavor where it has them, in every library. */
export const run_conformance = (
	cases: ReadonlyArray<ConformanceCase> = CONFORMANCE_CASES
): Array<ConformanceRow> => {
	const rows: Array<ConformanceRow> = [];
	for (const c of cases) {
		for (const flavor of c.entries ? CONFORMANCE_FLAVORS : [null]) {
			const informational: ConformanceRow['informational'] = {};
			for (const name of c.also ?? []) {
				const lib = INFORMATIONAL_LIBS[name];
				if (!flavor || lib[flavor]) informational[name] = run_one(lib, c, flavor).text;
			}
			rows.push({
				name: flavor ? `${c.name} / ${flavor}` : c.name,
				case: c,
				flavor,
				results: {
					zod: run_one(CONFORMANCE_LIBS.zod, c, flavor),
					valibot: run_one(CONFORMANCE_LIBS.valibot, c, flavor),
					fuz_schema: run_one(CONFORMANCE_LIBS.fuz_schema, c, flavor)
				},
				input_text: render_value(c.input()),
				informational
			});
		}
	}
	return rows;
};

//
// Comparing
//

// every object reachable from `value` through its own keys
const collect_objects = (value: unknown, found: Set<object> = new Set()): Set<object> => {
	if (is_object(value) && !found.has(value)) {
		found.add(value);
		for (const key of Reflect.ownKeys(value)) collect_objects((value as any)[key], found);
	}
	return found;
};

/**
 * Writes everything of `value` that can be read: every own key, whether it is
 * enumerable, and its value, the same of its prototype where that isn't the
 * plain one, and of every object it reaches.
 */
export const render_whole = (value: unknown): string => {
	if (!is_object(value)) return render_value(value);
	const keys = Reflect.ownKeys(value).map(
		(key) =>
			render_key(key) +
			(Object.prototype.propertyIsEnumerable.call(value, key) ? '' : ' hidden') +
			': ' +
			render_whole((value as any)[key])
	);
	const proto = Object.getPrototypeOf(value);
	return (
		(Array.isArray(value) ? `[${keys.join(', ')}]` : `{${keys.join(', ')}}`) +
		(proto === null
			? ' ^null'
			: proto === Object.prototype || proto === Array.prototype
				? ''
				: ' ^' + render_whole(proto))
	);
};

const same_output = (
	ours: unknown,
	theirs: unknown,
	of_input: Set<object>,
	of_their_input: Set<object>
): boolean => {
	if (!is_object(ours) || !is_object(theirs)) return render_value(ours) === render_value(theirs);
	// an object of each input that both kept as it is: the same when the two
	// are the same whole, as each library parsed its own copy of the input
	if (
		of_input.has(ours) &&
		of_their_input.has(theirs) &&
		render_whole(ours) === render_whole(theirs)
	) {
		return true;
	}
	if (Array.isArray(ours) !== Array.isArray(theirs)) return false;
	const keys = Reflect.ownKeys(theirs);
	if (of_input.has(ours)) {
		// the input's own object: it has every key of theirs as its own, and no
		// enumerable string key past them, its own or one it inherits
		if (!keys.every((key) => Object.hasOwn(ours, key))) return false;
		for (const key in ours) {
			if (!Object.hasOwn(theirs, key)) return false;
		}
	} else {
		// one this library built: everything `render_value` writes
		const our_keys = Reflect.ownKeys(ours);
		if (
			render_shape(ours) !== render_shape(theirs) ||
			keys.length !== our_keys.length ||
			keys.some((key, i) => key !== our_keys[i])
		) {
			return false;
		}
	}
	return keys.every((key) =>
		same_output((ours as any)[key], (theirs as any)[key], of_input, of_their_input)
	);
};

/**
 * Whether this library's result is another's, with the one difference that
 * isn't a row of any table allowed for: this library returns its input, or a
 * part of it, where nothing in it changed, and the others always copy.
 *
 * So an object of the output that is the input's own is held to less than a
 * copy is: it must have every key of the other library's copy as an own key,
 * with the same value, and no enumerable string key past those, whether its
 * own or one it inherits, as either is read through it. What else it has is
 * the input's and not this library's doing: its key order, its prototype and
 * what of it isn't enumerable, its symbol keys, and which of its keys are
 * enumerable. An object this library built is compared in full, as the texts
 * are. An object of the input that the other library kept as it is too is the
 * same where the two are the same whole, prototypes and all, as each library
 * is given its own copy of the input.
 */
export const is_same_result = (ours: ConformanceResult, theirs: ConformanceResult): boolean =>
	ours.text === theirs.text ||
	(ours.ok &&
		theirs.ok &&
		same_output(
			ours.value,
			theirs.value,
			collect_objects(ours.input),
			collect_objects(theirs.input)
		));
