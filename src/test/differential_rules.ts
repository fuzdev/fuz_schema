/**
 * The differential's rules, each of a row of a declared difference in
 * `DIFFERENCES`: the rewrites of an input that take away what triggers one,
 * with the guards that hold this library to doing the same on the rewritten
 * input, and the relaxations of the comparison that allow for what one does.
 *
 * @module
 */

import {
	render_parsed,
	render_shape,
	render_value,
	render_whole,
	type ConformanceParsed
} from './conformance_test_helpers.ts';
import type { ConformanceDifferencesRow } from './conformance_tables.ts';
import {
	DIFFERENTIAL_SYMBOL,
	map_spec_children,
	materialize_input,
	value_in,
	type DifferentialEntries,
	type DifferentialInput,
	type DifferentialObjectSpec,
	type DifferentialResult,
	type DifferentialSpec
} from './differential_generate.ts';

/** Whether `value` is an object or an array, and not `null`. */
export const is_object = (value: unknown): value is object =>
	typeof value === 'object' && value !== null;

/**
 * Every object reachable from `value` through its own keys and its prototypes,
 * so an object read through a prototype is the input's too.
 */
export const collect_input_objects = (
	value: unknown,
	found: Set<object> = new Set()
): Set<object> => {
	if (is_object(value) && !found.has(value)) {
		found.add(value);
		for (const key of Reflect.ownKeys(value)) collect_input_objects((value as any)[key], found);
		const proto = Object.getPrototypeOf(value);
		if (proto && proto !== Object.prototype && proto !== Array.prototype) {
			collect_input_objects(proto, found);
		}
	}
	return found;
};

/** Whether `key` is the key of an item of an array. */
export const is_index = (key: PropertyKey): boolean => typeof key === 'string' && /^\d+$/.test(key);

//
// Rules
//

export type DifferentialRuleName =
	| 'check_missing_key'
	| 'check_after_keyed_option'
	| 'transform_missing_key'
	| 'record_own_proto'
	| 'prototype_ignored'
	| 'symbol_ignored'
	| 'pipe_default_left_out'
	| 'default_fn_left_out'
	| 'read_through'
	| 'loose_own_proto'
	| 'inherited_proto_kept'
	| 'record_inherited'
	| 'hole_kept'
	| 'hole_in_copy'
	| 'array_extra_keys'
	| 'array_subclass'
	| 'union_own_path'
	| 'pipe_stops'
	| 'split_on_a_side'
	| 'union_options_split'
	| 'too_long_zod_items'
	| 'constructor_valibot_verdict';

export interface DifferentialRule {
	name: DifferentialRuleName;
	/** A row of a declared difference in `DIFFERENCES`, as the table writes it. */
	row: ConformanceDifferencesRow;
	/** A `rewrite` of the input before the libraries run, or a `relaxation` of the comparison. */
	kind: 'rewrite' | 'relaxation';
	summary: string;
}

/**
 * Each rule of a declared difference. A case is credited to the rules it
 * needs, each dropped in turn from the last, so a rule gives way to the ones
 * before it.
 */
export const DIFFERENTIAL_RULES: ReadonlyArray<DifferentialRule> = [
	{
		name: 'check_missing_key',
		row: 'bare check entry, key missing / *',
		kind: 'rewrite',
		summary:
			'a missing key of an entry that reaches a `check` as the entry itself is given an own `undefined`, where no strict option of a union beside it that does not name the key takes the object, and ours does the same apart from the key: what it left out of its output, the rewritten input leaves `undefined`, and what it wrote, the same. Every such key, else those of one structure, else each key only where ours does that with it, so a key whose check does not take it stays missing'
	},
	{
		name: 'check_after_keyed_option',
		row: 'union[unknown then a transform to null, check] entry, key missing / *',
		kind: 'rewrite',
		summary:
			'where an option of a `union` before one that reaches a `check` takes the key `check_missing_key` gives, the options before the last that reaches one are dropped, of every union or else of those at the keys given, where ours does the same on the input without them, and the guard of `check_missing_key` holds there'
	},
	{
		name: 'transform_missing_key',
		row: 'union[string, object of a bare check and a bare transform], keys missing',
		kind: 'rewrite',
		summary:
			'a missing key of an entry that is a bare `transform` is given an own `undefined`, and ours does the same apart from the key'
	},
	{
		name: 'record_own_proto',
		row: 'record, own __proto__ key whose value is wrong',
		kind: 'rewrite',
		summary:
			'an own `__proto__` key of a `record` input is taken out, where that changes nothing zod and valibot do, and ours does the same apart from the key and keeps no own `__proto__` key where it held one: it failed at the key as it does at the key renamed, or at a `union` the key is in, with `union_own_path`, and a step after the record that the failure stopped fails without the key, with `pipe_stops`. Or, where ours does on the input what it does with the key renamed, so a `union` it fails in goes on to a later option, the key is renamed for all three, where zod and valibot leave the renamed key out, keep it in their input returned as it is, named back, or keep it where ours keeps the key, with `loose_own_proto`, or where one keeps it and the two then disagree, with `split_on_a_side`'
	},
	{
		name: 'pipe_default_left_out',
		row: 'default then a transform to undefined entry, key missing / *',
		kind: 'relaxation',
		summary:
			'a key theirs writes as `undefined` is missing from ours, where the entry is a `pipe` that starts with a default'
	},
	{
		name: 'default_fn_left_out',
		row: 'default_fn of undefined entry, key missing / *',
		kind: 'relaxation',
		summary:
			'a key theirs writes as `undefined` is missing from ours, where the entry is a `with_default_fn`'
	},
	{
		name: 'read_through',
		row: 'required inherited / *',
		kind: 'relaxation',
		summary: 'a key of theirs is read through the prototype of an input object that came back'
	},
	{
		name: 'loose_own_proto',
		row: 'unknown own __proto__ key / loose',
		kind: 'relaxation',
		summary: 'a `loose_object` input that came back keeps an own `__proto__` key'
	},
	{
		name: 'inherited_proto_kept',
		row: 'unknown inherited __proto__ key / loose',
		kind: 'relaxation',
		summary:
			'a `loose_object` or `object_with_rest` input that came back still inherits an enumerable `__proto__` key'
	},
	{
		name: 'record_inherited',
		row: 'record, inherited key',
		kind: 'relaxation',
		summary: 'a `record` input that came back has enumerable keys it inherits'
	},
	{
		name: 'hole_kept',
		row: 'array of optionals, a hole',
		kind: 'relaxation',
		summary: 'an array input that came back has a hole where theirs has `undefined`'
	},
	{
		name: 'hole_in_copy',
		row: 'array of optionals, a hole before an item that changes',
		kind: 'relaxation',
		summary: 'an array copy has a hole where theirs has `undefined`'
	},
	{
		name: 'array_extra_keys',
		row: 'array with another key',
		kind: 'relaxation',
		summary: 'an array input that came back keeps its own keys that are not items'
	},
	{
		name: 'array_subclass',
		row: 'array of a subclass, an item changes',
		kind: 'relaxation',
		summary: "an array copy is an instance of the input's `Array` subclass"
	},
	{
		name: 'union_own_path',
		row: 'union, an object option fails a check inside',
		kind: 'relaxation',
		summary: "theirs' issues inside a failed `union` count as one at the union's path"
	},
	{
		name: 'pipe_stops',
		row: 'a check after an object whose entry fails a check',
		kind: 'relaxation',
		summary:
			"theirs' issue of a pipe step after a container is dropped where theirs has one inside it"
	},
	{
		name: 'split_on_a_side',
		row: 'loose, a bare check entry, key missing, an unknown key named constructor',
		kind: 'relaxation',
		summary:
			'where zod and valibot disagree once `check_missing_key` gives the key, `prototype_ignored` takes the prototype away, `symbol_ignored` the symbol key, or `record_own_proto` renames an own `__proto__` key, exactly one entry of `SPLIT_RECOGNIZERS` recognizes the disagreement as that of its `SIDES` row, and ours is the result of the side the row names, with the other relaxations'
	},
	{
		name: 'union_options_split',
		row: 'union[array(max_length(string, 1)), record(string)] entry, an array of a surrogate pair, beside a key missing',
		kind: 'relaxation',
		summary:
			'theirs have an issue at a `union` they both take, by different options, where ours refuses each option as the side of a disagreement of theirs on it that exactly one entry of `SPLIT_RECOGNIZERS` recognizes'
	},
	{
		name: 'too_long_zod_items',
		row: 'a max_length after an array too long, an Infinity item',
		kind: 'relaxation',
		summary:
			"theirs' issue of a `max_length` after an array too long is, in ours, zod's issues of the array alone, where zod refuses an item of it and valibot takes them all, and an issue of zod's at a part of the array that valibot disagrees on is that of the side an entry of `SPLIT_RECOGNIZERS` names"
	},
	{
		name: 'constructor_valibot_verdict',
		row: 'rest, own key named constructor, a surrogate pair too long',
		kind: 'relaxation',
		summary:
			'ours has, at an own key named `constructor` or `prototype` of an `object_with_rest` or a `record` input that names no such entry, the issues valibot gives its value by the schema of the key, where zod takes the value, and ours, given the value alone, refuses it as valibot does'
	},
	{
		name: 'prototype_ignored',
		row: 'union[string, record(default of a wrong value)], class instance, a value undefined',
		kind: 'rewrite',
		summary:
			'an object input given to a `record`, an `object_with_rest` or a `loose_object` that is of a class, or that inherits enumerable keys, is given the plain prototype and none of the keys it inherits but those it names as entries, which ours reads through, where ours does the same on it, but for the keys taken away that an input that comes back still inherits, and zod and valibot either do the same too or now disagree, with `split_on_a_side`: ours takes a class instance by a `record`, as valibot does, and reads no key an `object_with_rest` or a `loose_object` input inherits that it does not name. Applied first and listed last, so a case another rule explains is not credited to it'
	},
	{
		name: 'symbol_ignored',
		row: 'union[string, record(default of a wrong value)], a value undefined, a symbol key',
		kind: 'rewrite',
		summary:
			'a symbol key of an object input given to a `record` is taken away, where ours does the same on it apart from the key and left the key unread, with no issue at it and the key in its output only in the input returned as it is, and zod and valibot either do the same too or now disagree, with `split_on_a_side`: ours leaves a symbol key of a `record` unread, as valibot does. Applied after `prototype_ignored` and listed last, so a case another rule explains is not credited to it'
	}
];

/** Rows of declared differences that no rule is for, each with why. */
export const DIFFERENTIAL_UNRULED: Partial<Record<ConformanceDifferencesRow, string>> = {
	'default of an array, the one given':
		'which value a default is, the one given or a copy, is the same text: the comparison sees no difference, and the generated defaults are primitives',
	'entry named __proto__, own / *': 'the generator names no entry `__proto__`'
};

/** Every rule. */
export const ALL_RULES: ReadonlySet<DifferentialRuleName> = new Set(
	DIFFERENTIAL_RULES.map((rule) => rule.name)
);

/** No rule: the three compared as they are. */
export const NO_RULES: ReadonlySet<DifferentialRuleName> = new Set();

/** The rules that relax the comparison, and rewrite nothing. */
export const RELAXATIONS: ReadonlySet<DifferentialRuleName> = new Set(
	DIFFERENTIAL_RULES.filter((rule) => rule.kind === 'relaxation').map((rule) => rule.name)
);

/** The kinds of spec that are a `pipe` from the spec they hold. */
export const PIPE_STEPS: ReadonlySet<string> = new Set([
	'refine',
	'map',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
]);
/** The steps of a `pipe` that check, and change nothing. */
export const LENGTH_AND_VALUE_STEPS: ReadonlySet<string> = new Set([
	'refine',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
]);
/** The kinds of spec that hold one spec and shape no value of their own. */
export const WRAPPERS: ReadonlySet<string> = new Set([
	'optional',
	'nullable',
	'lazy',
	'message',
	'default',
	'default_fn',
	...PIPE_STEPS
]);

/** `spec` past every `message` around it. */
export const unwrap_messages = (spec: DifferentialSpec): DifferentialSpec =>
	spec.t === 'message' ? unwrap_messages(spec.of) : spec;

/**
 * Whether `spec` is a `check` that is the entry itself, or that another schema
 * holds as one: under a `nullable`, a `lazy`, or a `message`, as an option of
 * a `union`, or at the start of a `pipe`.
 */
export const reaches_check = (spec: DifferentialSpec): boolean => {
	if (spec.t === 'check') return true;
	if (spec.t === 'nullable' || spec.t === 'lazy' || spec.t === 'message') {
		return reaches_check(spec.of);
	}
	if (spec.t === 'union') return spec.of.some(reaches_check);
	if (PIPE_STEPS.has(spec.t)) return reaches_check((spec as { of: DifferentialSpec }).of);
	return false;
};

// a `pipe` that starts with a `with_default` or a `with_default_fn`, as the
// entry itself, under a `message`, or as the first schema of another pipe,
// the default under a `message` or not
const is_pipe_from_default = (spec: DifferentialSpec): boolean => {
	let head = unwrap_messages(spec);
	if (!PIPE_STEPS.has(head.t)) return false;
	while (PIPE_STEPS.has(head.t)) head = unwrap_messages((head as { of: DifferentialSpec }).of);
	return head.t === 'default' || head.t === 'default_fn';
};

const is_default_fn = (spec: DifferentialSpec): boolean => unwrap_messages(spec).t === 'default_fn';

/** Whether `spec` is a `transform` that is the entry itself, or under a `message`. */
export const is_bare_transform = (spec: DifferentialSpec): boolean =>
	unwrap_messages(spec).t === 'transform';

/**
 * The schemas a value is shaped by, past every wrapper: the objects, records
 * and arrays, every option of a union and of a variant.
 */
export const structures = (
	spec: DifferentialSpec,
	out: Array<DifferentialSpec> = []
): Array<DifferentialSpec> => {
	switch (spec.t) {
		case 'object':
		case 'rest':
		case 'record':
		case 'array':
			out.push(spec);
			break;
		case 'variant':
			out.push(...spec.of);
			break;
		case 'union':
			for (const option of spec.of) structures(option, out);
			break;
		default:
			if (WRAPPERS.has(spec.t)) structures((spec as { of: DifferentialSpec }).of, out);
	}
	return out;
};

/** The schemas of the entry or item `key` of each structure. */
export const entry_specs = (
	positions: Array<DifferentialSpec>,
	key: PropertyKey
): Array<DifferentialSpec> => {
	const out: Array<DifferentialSpec> = [];
	for (const p of positions) {
		if (p.t === 'object' || p.t === 'rest') {
			const entry = p.entries.find(([k]) => k === key);
			if (entry) out.push(entry[1]);
			else if (p.t === 'rest') out.push(p.rest);
		} else if (p.t === 'record' || p.t === 'array') out.push(p.of);
	}
	return out;
};

const entry_positions = (
	positions: Array<DifferentialSpec>,
	key: PropertyKey
): Array<DifferentialSpec> => {
	const out: Array<DifferentialSpec> = [];
	for (const e of entry_specs(positions, key)) structures(e, out);
	return out;
};

//
// Rewrites
//

type ObjectInput = DifferentialInput & { t: 'obj' };

// the option of a variant that the input names
const variant_option = (
	spec: DifferentialSpec & { t: 'variant' },
	value: unknown
): DifferentialObjectSpec | undefined =>
	is_object(value)
		? spec.of.find((o) =>
				Object.is((o.entries[0]![1] as { v: unknown }).v, (value as any)[spec.key])
			)
		: undefined;

/** The path of a part of a value, as an issue writes it. */
export type DifferentialPath = ReadonlyArray<PropertyKey>;

/** A path as a short text, `<root>` where it is empty. */
export const path_text = (path: ReadonlyArray<PropertyKey>): string =>
	path.map((key) => (typeof key === 'number' ? `[${key}]` : String(key))).join('.') || '<root>';

type RewriteAt = (
	spec: DifferentialSpec,
	input: ObjectInput,
	path: DifferentialPath
) => ObjectInput;

/** What a rewrite makes of an array input given to an object or a `record`, before its keys are visited. */
type RewriteArray = (
	spec: DifferentialSpec,
	input: DifferentialInput & { t: 'arr' },
	path: DifferentialPath
) => DifferentialInput;

/**
 * `at` applied to each object input, the structure it is at, and its path,
 * children first: through the option of a variant the input names, and through
 * every option of a union. The input is returned as it is where nothing
 * changed.
 */
export const rewrite_input = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	at: RewriteAt,
	path: DifferentialPath = [],
	array_at: RewriteArray | null = null
): DifferentialInput => {
	let inner = spec;
	while (WRAPPERS.has(inner.t)) inner = (inner as { of: DifferentialSpec }).of;
	return rewrite_structure(inner, input, at, path, array_at);
};

const rewrite_structure = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	at: RewriteAt,
	path: DifferentialPath,
	array_at: RewriteArray | null
): DifferentialInput => {
	if (spec.t === 'variant') {
		const option = variant_option(spec, materialize_input(input));
		return option ? rewrite_input(option, input, at, path, array_at) : input;
	}
	if (spec.t === 'union') {
		return spec.of.reduce(
			(current, option) => rewrite_input(option, current, at, path, array_at),
			input
		);
	}
	const p = spec;
	if (p.t !== 'array' && p.t !== 'object' && p.t !== 'rest' && p.t !== 'record') return input;
	if (p.t === 'array') {
		if (input.t !== 'arr') return input;
		let changed = false;
		const items = input.items.map((item, i) => {
			const next = item && rewrite_input(p.of, item, at, [...path, i], array_at);
			if (next !== item) changed = true;
			return next;
		});
		return changed ? { ...input, items } : input;
	}
	if (input.t === 'arr' && array_at) {
		const next = array_at(p, input, path);
		return next === input ? input : rewrite_structure(p, next, at, path, array_at);
	}
	if (input.t !== 'obj') return input;
	let changed = false;
	const map = (list: DifferentialEntries): DifferentialEntries =>
		list.map(([key, value]) => {
			const [e] = entry_specs([p], key);
			const next = e ? rewrite_input(e, value, at, [...path, key], array_at) : value;
			if (next !== value) changed = true;
			return [key, next];
		});
	const own = map(input.own);
	const proto = map(input.proto);
	const hidden = map(input.hidden);
	return at(p, changed ? { ...input, own, proto, hidden } : input, path);
};

const has_key = (input: ObjectInput, key: string): boolean =>
	[...input.own, ...input.proto, ...input.hidden].some(([k]) => k === key);

/** A rewritten input, and the paths of the keys the rewrite added or took out. */
export interface DifferentialRewritten {
	input: DifferentialInput;
	touched: Array<DifferentialPath>;
}

/** Which missing keys `rewrite_missing_keys` gives. */
export interface DifferentialMissingKeysOptions {
	/** Only the keys of the structure visited at this count, from `0`, where given. */
	only?: number | null;
	/** Only the keys at these paths, as `path_text` writes them, where given. */
	keys?: ReadonlySet<string> | null;
	/**
	 * Whether a `strict_object` beside the key that doesn't name it takes the
	 * object as it is, so the key would make it fail: by default it does.
	 */
	strict_takes?: (strict: DifferentialObjectSpec, object: ObjectInput) => boolean;
}

/**
 * Each missing key of an entry that `needs` names given an own `undefined`, but
 * where a `strict_object` the same input is given to, as an option of a
 * `union`, doesn't name the key and takes the object, which the key would make
 * fail there.
 */
export const rewrite_missing_keys = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	needs: (entry: DifferentialSpec) => boolean,
	{ only = null, keys = null, strict_takes = () => true }: DifferentialMissingKeysOptions = {}
): DifferentialRewritten & { visits: number } => {
	const strict: Map<string, Array<DifferentialObjectSpec>> = new Map();
	rewrite_input(spec, input, (p, object, path) => {
		if (p.t === 'object' && p.flavor === 'strict') {
			const text = path_text(path);
			strict.set(text, [...(strict.get(text) ?? []), p]);
		}
		return object;
	});
	const touched: Array<DifferentialPath> = [];
	let visits = 0;
	const next = rewrite_input(spec, input, (p, object, path) => {
		if (p.t !== 'object' && p.t !== 'rest') return object;
		const visit = visits++;
		if (only !== null && visit !== only) return object;
		const beside = strict.get(path_text(path)) ?? [];
		const missing = p.entries.filter(
			([key, e]) =>
				needs(e) &&
				!has_key(object, key) &&
				(!keys || keys.has(path_text([...path, key]))) &&
				beside.every((o) => o.entries.some(([k]) => k === key) || !strict_takes(o, object))
		);
		if (!missing.length) return object;
		for (const [key] of missing) touched.push([...path, key]);
		return {
			...object,
			own: [
				...object.own,
				...missing.map(([key]): [string, DifferentialInput] => [key, value_in(undefined)])
			]
		};
	});
	return { input: next, touched, visits };
};

/**
 * What an own `__proto__` key of a `record` input is renamed to, a key the
 * generator never makes.
 */
export const RENAMED_PROTO = 'renamed__proto__';

/** Each own `__proto__` key of a `record` input taken out, or renamed to `to`. */
export const rewrite_record_proto = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	to: string | null = null
): DifferentialRewritten => {
	const touched: Array<DifferentialPath> = [];
	const next = rewrite_input(spec, input, (p, object, path) => {
		if (
			p.t !== 'record' ||
			![...object.own, ...object.hidden].some(([key]) => key === '__proto__')
		) {
			return object;
		}
		touched.push([...path, '__proto__']);
		const change = (list: DifferentialEntries): DifferentialEntries =>
			to === null
				? list.filter(([key]) => key !== '__proto__')
				: list.map(([key, value]) => [key === '__proto__' ? to : key, value]);
		return { ...object, own: change(object.own), hidden: change(object.hidden) };
	});
	return { input: next, touched };
};

// whether `prefix` starts `path`, an index the same as the string of its digits
const starts_path = (path: DifferentialPath, prefix: DifferentialPath): boolean =>
	prefix.length <= path.length && prefix.every((key, i) => String(key) === String(path[i]));

/**
 * Whether ours' output, where it is one, holds no own `__proto__` key beside
 * each key at `touched`.
 */
export const holds_no_proto = (
	ours: DifferentialResult,
	touched: Array<DifferentialPath>
): boolean =>
	!ours.parsed?.ok ||
	touched.every((t) => {
		const holder = value_at(ours.value, t.slice(0, -1));
		return !is_object(holder) || !Object.hasOwn(holder, '__proto__');
	});

/**
 * A copy of `value` without the keys at `touched`, every key's enumerability
 * and the prototypes kept, so `render_value` writes it as it does the value.
 */
export const without_touched = (
	value: unknown,
	touched: Array<DifferentialPath>,
	path: DifferentialPath = []
): unknown => {
	if (!is_object(value) || !touched.some((t) => starts_path(t, path))) return value;
	const copy: any = Array.isArray(value) ? new Array(value.length) : {};
	Object.setPrototypeOf(copy, Object.getPrototypeOf(value));
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length' && Array.isArray(value)) continue;
		const at = [...path, key];
		if (touched.some((t) => t.length === at.length && starts_path(at, t))) continue;
		Object.defineProperty(copy, key, {
			value: without_touched((value as any)[key], touched, at),
			enumerable: Object.prototype.propertyIsEnumerable.call(value, key),
			writable: true,
			configurable: true
		});
	}
	return copy;
};

/** Which paths above a key a rewrite took out an issue is excused at, on either input. */
export interface DifferentialAboveTaken {
	/** On the input, where the key failed what holds it. */
	ours: (path: DifferentialPath) => boolean;
	/** On the rewritten input, where the key's failure had stopped it. */
	rewritten: (path: DifferentialPath) => boolean;
}

/**
 * Whether ours on a rewritten input did what it did on the input, apart from
 * the keys the rewrite `touched`: the same verdict, the same paths outside
 * them, and the same output without them. Where the rewrite took keys out,
 * `above` is given: an issue at one of them can have failed what holds it, or
 * stopped a step after it, so each side is held to the paths not at them, and
 * not above them where `above` excuses the path on that side, and ours on the
 * input to the rewritten input's verdict where it failed nowhere else.
 */
export const same_apart = (
	ours: DifferentialResult,
	rewritten: DifferentialResult,
	touched: Array<DifferentialPath>,
	above: DifferentialAboveTaken | null = null
): boolean => {
	if (!ours.parsed || !rewritten.parsed) return false;
	if (ours.parsed.ok && rewritten.parsed.ok) {
		return (
			render_value(without_touched(ours.value, touched)) ===
			render_value(without_touched(rewritten.value, touched))
		);
	}
	const rest = (
		parsed: ConformanceParsed,
		excused: (path: DifferentialPath) => boolean
	): string => {
		if (parsed.ok) return 'ok';
		const apart = (path: DifferentialPath): boolean =>
			!touched.some((t) => starts_path(path, t) || (starts_path(t, path) && excused(path)));
		return render_parsed({
			ok: false,
			paths: parsed.paths.filter(apart),
			unknown_keys: parsed.unknown_keys.filter(apart)
		});
	};
	if (ours.parsed.ok || (!above && rewritten.parsed.ok)) return false;
	const none = (): boolean => false;
	return (
		rest(ours.parsed, above?.ours ?? none) ===
		(rewritten.parsed.ok ? 'fail' : rest(rewritten.parsed, above?.rewritten ?? none))
	);
};

/**
 * Whether ours on an input given the keys at `touched` gave each what it gave
 * it missing: the same value where its output has the key, and `undefined`
 * where it left the key out.
 */
export const same_given_keys = (
	ours: DifferentialResult,
	given: DifferentialResult,
	touched: Array<DifferentialPath>
): boolean => {
	if (!ours.parsed?.ok || !given.parsed?.ok) return true;
	return touched.every((t) => {
		const holder = value_at(ours.value, t.slice(0, -1));
		const key = t.at(-1)!;
		return is_object(holder) && Object.hasOwn(holder, key)
			? render_value((holder as any)[key]) === render_value(value_at(given.value, t))
			: value_at(given.value, t) === undefined;
	});
};

/**
 * Whether the issues of ours at, under, or above the keys at `touched` are
 * those it has with each key renamed, the renamed key read as the key.
 */
export const same_issues_renamed = (
	ours: DifferentialResult,
	renamed: DifferentialResult,
	touched: Array<DifferentialPath>,
	from: string,
	to: string
): boolean => {
	if (!ours.parsed || !renamed.parsed) return false;
	const at_keys = (parsed: ConformanceParsed, map: (key: PropertyKey) => PropertyKey): string =>
		parsed.ok
			? ''
			: [...parsed.paths, ...parsed.unknown_keys]
					.map((path) => path.map(map))
					.filter((path) => touched.some((t) => starts_path(path, t) || starts_path(t, path)))
					.map(path_text)
					.join(' ');
	return (
		at_keys(ours.parsed, (key) => key) ===
		at_keys(renamed.parsed, (key) => (key === to ? from : key))
	);
};

/**
 * Whether the object that holds the key at `path` in a result's value is the
 * object of its input that held it, returned as it is.
 */
export const holder_returned = (result: DifferentialResult, path: DifferentialPath): boolean => {
	const holder = value_at(result.value, path.slice(0, -1));
	return is_object(holder) && holder === value_at(result.input, path.slice(0, -1));
};

/**
 * Whether ours left each key at `touched` unread: no issue at or under it, and
 * an output that holds it only in an object of the input returned as it is.
 */
export const left_unread = (ours: DifferentialResult, touched: Array<DifferentialPath>): boolean =>
	touched.every((t) => {
		if (
			ours.parsed &&
			!ours.parsed.ok &&
			[...ours.parsed.paths, ...ours.parsed.unknown_keys].some((path) => starts_path(path, t))
		) {
			return false;
		}
		const holder = value_at(ours.value, t.slice(0, -1));
		return !is_object(holder) || !Object.hasOwn(holder, t.at(-1)!) || holder_returned(ours, t);
	});

// a value of theirs on an input with a key renamed, as on the input: the
// renamed key at each of `to` taken out of a copy, and named back
// `__proto__`, an own key, in an object of the input returned as it is
const unrename_value = (
	value: unknown,
	input: unknown,
	to: Array<DifferentialPath>,
	path: DifferentialPath = []
): unknown => {
	if (!is_object(value) || !to.some((t) => starts_path(t, path))) return value;
	const returned = value === value_at(input, path);
	const copy: any = Array.isArray(value) ? new Array(value.length) : {};
	Object.setPrototypeOf(copy, Object.getPrototypeOf(value));
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length' && Array.isArray(value)) continue;
		const at = [...path, key];
		const renamed = to.some((t) => t.length === at.length && starts_path(at, t));
		if (renamed && !returned) continue;
		Object.defineProperty(copy, renamed ? '__proto__' : key, {
			value: renamed ? (value as any)[key] : unrename_value((value as any)[key], input, to, at),
			enumerable: Object.prototype.propertyIsEnumerable.call(value, key),
			writable: true,
			configurable: true
		});
	}
	return copy;
};

/**
 * Theirs on an input with a key renamed, as on the input but for reading the
 * key as they read any key: the renamed key at each of `to` taken out of a
 * copy, or named back where the object that holds it is the input's returned
 * as it is, and a path through it given the key's name.
 */
export const unrename = (
	result: DifferentialResult,
	to: Array<DifferentialPath>
): DifferentialResult => {
	if (!result.parsed) return result;
	const parsed: ConformanceParsed = result.parsed.ok
		? { ok: true, value: unrename_value(result.parsed.value, result.input, to) }
		: {
				ok: false,
				paths: result.parsed.paths.map((path) =>
					path.map((key) => (key === RENAMED_PROTO ? '__proto__' : key))
				),
				unknown_keys: result.parsed.unknown_keys
			};
	return {
		...result,
		text: render_parsed(parsed),
		value: parsed.ok ? parsed.value : undefined,
		parsed
	};
};

// a union with the options before the last that reaches a `check`, or is an
// object with an entry that does, dropped, the same where none is
const drop_options_before_check = (union: DifferentialSpec & { t: 'union' }): DifferentialSpec => {
	const last = union.of.findLastIndex(
		(o) =>
			reaches_check(o) ||
			((o.t === 'object' || o.t === 'rest') && o.entries.some(([, e]) => reaches_check(e)))
	);
	return last > 0 ? { t: 'union', of: union.of.slice(last) } : union;
};

/**
 * Each `union` with the options before the last that reaches a `check`, or is
 * an object with an entry that does, dropped, the same spec where none is.
 */
export const drop_before_check = (spec: DifferentialSpec): DifferentialSpec => {
	const mapped = map_spec_children(spec, drop_before_check);
	return mapped.t === 'union' ? drop_options_before_check(mapped) : mapped;
};

/**
 * `drop_before_check` of only the unions that are the entries at `paths`, or
 * hold them as an option's: those of the keys a rewrite gives, and not a
 * union beside them. The same spec where none is dropped.
 */
export const drop_before_check_at = (
	spec: DifferentialSpec,
	paths: ReadonlyArray<DifferentialPath>
): DifferentialSpec => {
	if (!paths.length) return spec;
	const under = (key: PropertyKey | null): Array<DifferentialPath> =>
		paths.filter((p) => p.length && (key === null || String(p[0]) === key)).map((p) => p.slice(1));
	let mapped: DifferentialSpec;
	if (spec.t === 'object' || spec.t === 'rest') {
		const named = new Set(spec.entries.map(([key]) => key));
		const entries = spec.entries.map(([key, e]): [string, DifferentialSpec] => [
			key,
			drop_before_check_at(e, under(key))
		]);
		const changed = entries.some(([, e], i) => e !== spec.entries[i]![1]);
		if (spec.t === 'rest') {
			const rest = drop_before_check_at(
				spec.rest,
				paths.filter((p) => p.length && !named.has(String(p[0]))).map((p) => p.slice(1))
			);
			mapped = changed || rest !== spec.rest ? { ...spec, entries, rest } : spec;
		} else {
			mapped = changed ? { ...spec, entries } : spec;
		}
	} else if (spec.t === 'record' || spec.t === 'array') {
		const of = drop_before_check_at(spec.of, under(null));
		mapped = of === spec.of ? spec : { ...spec, of };
	} else {
		mapped = map_spec_children(spec, (child) => drop_before_check_at(child, paths));
	}
	return mapped.t === 'union' && paths.some((p) => p.length <= 1)
		? drop_options_before_check(mapped)
		: mapped;
};

/**
 * Each object input given to a `record`, an `object_with_rest`, or a
 * `loose_object` that is of a class, or that inherits keys it doesn't name as
 * entries, given the plain prototype and none of the keys it inherits but
 * those, which ours reads through.
 */
export const rewrite_prototypes = (
	spec: DifferentialSpec,
	input: DifferentialInput
): DifferentialInput =>
	rewrite_input(spec, input, (p, object) => {
		if (p.t !== 'record' && p.t !== 'rest' && !(p.t === 'object' && p.flavor === 'loose')) {
			return object;
		}
		const proto = object.proto.filter(([key]) => names_entry(p, key));
		return object.base === 'class' || proto.length < object.proto.length
			? { ...object, base: 'plain', proto }
			: object;
	});

/**
 * Each symbol key of an object input given to a `record` taken away, with the
 * paths of the keys taken.
 */
export const rewrite_record_symbols = (
	spec: DifferentialSpec,
	input: DifferentialInput
): DifferentialRewritten => {
	const touched: Array<DifferentialPath> = [];
	const next = rewrite_input(spec, input, (p, object, path) => {
		if (p.t !== 'record' || !object.symbol) return object;
		touched.push([...path, DIFFERENTIAL_SYMBOL]);
		return { ...object, symbol: null };
	});
	return { input: next, touched };
};

/** Whether an object spec has an entry named `key`. */
export const names_entry = (p: DifferentialSpec, key: PropertyKey): boolean =>
	(p.t === 'object' || p.t === 'rest') && p.entries.some(([k]) => k === key);

//
// Comparing
//

/**
 * Whether a `loose_object` or `object_with_rest` input that came back may
 * still inherit a key the other lacks, and why, see `DifferentialCompareEnv`.
 */
export type DifferentialInherited = 'prototype_taken' | 'neither_inherited' | null;

/** What `same_value` compares by: the objects of each input, and the rules. */
export interface DifferentialCompareEnv {
	of_input: Set<object>;
	of_their_input: Set<object>;
	rules: ReadonlySet<DifferentialRuleName>;
	/**
	 * Whether a `loose_object` or `object_with_rest` input that came back may
	 * still inherit a key the other lacks: `prototype_taken`, where
	 * `same_ours` holds ours to ours on the input `prototype_ignored` took the
	 * keys from, and `neither_inherited`, where an entry of
	 * `SPLIT_RECOGNIZERS` holds ours to its `neither` row of `SIDES`.
	 */
	inherited: DifferentialInherited;
}

// a key theirs writes as `undefined` that ours leaves out, as a rule allows
const is_left_out = (
	positions: Array<DifferentialSpec>,
	key: PropertyKey,
	ours: object,
	theirs: object,
	env: DifferentialCompareEnv
): boolean =>
	Object.hasOwn(theirs, key) &&
	(theirs as any)[key] === undefined &&
	!(key in ours) &&
	entry_specs(positions, key).some(
		(e) =>
			(env.rules.has('pipe_default_left_out') && is_pipe_from_default(e)) ||
			(env.rules.has('default_fn_left_out') && is_default_fn(e))
	);

/** Whether ours is theirs, a value at the structures `positions`, as the rules allow. */
export const same_value = (
	positions: Array<DifferentialSpec>,
	ours: unknown,
	theirs: unknown,
	env: DifferentialCompareEnv
): boolean => {
	if (!is_object(ours) || !is_object(theirs)) return render_value(ours) === render_value(theirs);
	if (
		env.of_input.has(ours) &&
		env.of_their_input.has(theirs) &&
		render_whole(ours) === render_whole(theirs)
	) {
		return true;
	}
	if (Array.isArray(ours) !== Array.isArray(theirs)) return false;
	if (Array.isArray(ours)) return same_array(positions, ours, theirs as Array<unknown>, env);
	const from_input = env.of_input.has(ours);
	const theirs_keys = Reflect.ownKeys(theirs);
	let compared: Array<PropertyKey> = [];
	if (from_input) {
		// the input's own object: every key of theirs, and no enumerable string
		// key past them, its own or one it inherits
		for (const key of theirs_keys) {
			if (
				Object.hasOwn(ours, key) ||
				(env.rules.has('read_through') && typeof key === 'string' && key in ours)
			) {
				compared.push(key);
			} else if (!is_left_out(positions, key, ours, theirs, env)) return false;
		}
		for (const key in ours) {
			if (Object.hasOwn(theirs, key)) continue;
			const own = Object.hasOwn(ours, key);
			if (!own && env.rules.has('record_inherited') && positions.some((p) => p.t === 'record')) {
				continue;
			}
			if (
				own &&
				key === '__proto__' &&
				env.rules.has('loose_own_proto') &&
				positions.some((p) => p.t === 'object' && p.flavor === 'loose')
			) {
				continue;
			}
			if (
				!own &&
				key === '__proto__' &&
				env.rules.has('inherited_proto_kept') &&
				positions.some((p) => (p.t === 'object' && p.flavor === 'loose') || p.t === 'rest')
			) {
				continue;
			}
			if (
				!own &&
				env.inherited &&
				positions.some((p) => (p.t === 'object' && p.flavor === 'loose') || p.t === 'rest')
			) {
				continue;
			}
			return false;
		}
	} else {
		// one this library built: everything `render_value` writes
		if (render_shape(ours) !== render_shape(theirs)) return false;
		const ours_keys = Reflect.ownKeys(ours);
		compared = theirs_keys.filter((key) => !is_left_out(positions, key, ours, theirs, env));
		if (compared.length !== ours_keys.length || compared.some((key, i) => key !== ours_keys[i])) {
			return false;
		}
	}
	return compared.every((key) =>
		same_value(entry_positions(positions, key), (ours as any)[key], (theirs as any)[key], env)
	);
};

const same_array = (
	positions: Array<DifferentialSpec>,
	ours: Array<unknown>,
	theirs: Array<unknown>,
	env: DifferentialCompareEnv
): boolean => {
	const from_input = env.of_input.has(ours);
	if (!from_input && render_shape(ours) !== render_shape(theirs)) {
		const proto = Object.getPrototypeOf(ours);
		const subclass =
			env.rules.has('array_subclass') &&
			proto !== Array.prototype &&
			ours instanceof Array &&
			render_shape(ours).replace(' proto=other', '') === render_shape(theirs);
		if (!subclass) return false;
	}
	if (ours.length !== theirs.length) return false;
	const items = entry_positions(positions, 0);
	for (let i = 0; i < ours.length; i++) {
		const has = Object.hasOwn(ours, i);
		const theirs_has = Object.hasOwn(theirs, i);
		if (!has && theirs_has) {
			if (theirs[i] === undefined && env.rules.has(from_input ? 'hole_kept' : 'hole_in_copy')) {
				continue;
			}
			return false;
		}
		if (has !== theirs_has) return false;
		if (!same_value(items, ours[i], theirs[i], env)) return false;
	}
	const extra = (array: Array<unknown>): Array<PropertyKey> =>
		Reflect.ownKeys(array).filter((key) => key !== 'length' && !is_index(key));
	if (from_input) {
		for (const key in ours as object) {
			if (is_index(key) || Object.hasOwn(theirs, key)) continue;
			if (env.rules.has('array_extra_keys') && Object.hasOwn(ours, key)) continue;
			return false;
		}
		return true;
	}
	const ours_extra = extra(ours);
	const theirs_extra = extra(theirs);
	return (
		ours_extra.length === theirs_extra.length &&
		ours_extra.every(
			(key, i) =>
				key === theirs_extra[i] && same_value([], (ours as any)[key], (theirs as any)[key], env)
		)
	);
};

/**
 * Where a path goes in a schema, the input's value along it picking a variant's
 * option: the depth of the first union it reaches, if any, and the schemas at
 * that depth, or at its end.
 */
export const walk_path = (
	spec: DifferentialSpec,
	path: ReadonlyArray<PropertyKey>,
	input: unknown
): { union_at: number | null; chain: Array<DifferentialSpec> } => {
	let current: Array<DifferentialSpec> = [spec];
	let value = input;
	for (let i = 0; ; i++) {
		const chain: Array<DifferentialSpec> = [];
		const add = (s2: DifferentialSpec): boolean => {
			chain.push(s2);
			if (s2.t === 'union') return true;
			if (s2.t === 'variant') {
				const option = variant_option(s2, value);
				return option ? add(option) : s2.of.some(add);
			}
			if (WRAPPERS.has(s2.t)) return add((s2 as { of: DifferentialSpec }).of);
			return false;
		};
		if (current.map(add).some(Boolean)) return { union_at: i, chain };
		if (i === path.length) return { union_at: null, chain };
		current = entry_specs(chain, path[i]!);
		value = is_object(value) ? (value as any)[path[i]!] : undefined;
	}
};

/** The value at `path` in `value`, `undefined` past anything but an object. */
export const value_at = (value: unknown, path: DifferentialPath): unknown =>
	path.reduce((v: unknown, key) => (is_object(v) ? (v as any)[key] : undefined), value);

/**
 * `fn` of each object in `value` and the structures it is at, through its own
 * enumerable keys.
 */
export const visit_objects = (
	positions: Array<DifferentialSpec>,
	value: unknown,
	path: DifferentialPath,
	fn: (positions: Array<DifferentialSpec>, object: object, path: DifferentialPath) => void
): void => {
	if (!is_object(value)) return;
	fn(positions, value, path);
	for (const key of Object.keys(value)) {
		visit_objects(
			entry_positions(positions, key),
			(value as any)[key],
			[...path, Array.isArray(value) ? Number(key) : key],
			fn
		);
	}
};
