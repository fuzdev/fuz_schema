/**
 * The differential's generator: schemas and inputs as data, drawn from a
 * seed, made in zod, valibot and this library by the adapters of the
 * conformance matrix, written as text and as a matrix case, and run through
 * one library at a time.
 *
 * @module
 */

import {
	CONFORMANCE_FLAVORS,
	CONFORMANCE_LIBS,
	ConformanceList,
	ConformancePoint,
	render_parsed,
	render_value,
	type ConformanceFlavor,
	type ConformanceLib,
	type ConformanceLibName,
	type ConformanceParsed
} from './conformance_test_helpers.ts';

//
// Randomness
//

/** What the generator draws from. */
export interface DifferentialRng {
	/** An integer from `0` to below `n`. */
	int: (n: number) => number;
	chance: (p: number) => boolean;
	pick: <T>(items: ReadonlyArray<T>) => T;
}

/** A seeded generator, mulberry32, so a seed gives the same cases everywhere. */
export const create_differential_rng = (seed: number): DifferentialRng => {
	let a = seed >>> 0;
	const next = (): number => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		int: (n: number): number => Math.floor(next() * n),
		chance: (p: number): boolean => next() < p,
		pick: <T>(items: ReadonlyArray<T>): T => items[Math.floor(next() * items.length)]!
	};
};

//
// Schemas
//

type LeafKind =
	'string' | 'number' | 'integer' | 'safe_integer' | 'boolean' | 'bigint' | 'unknown' | 'undef';
type WrapKind = 'optional' | 'nullable' | 'lazy' | 'message' | 'array' | 'record';
type LengthKind = 'min_length' | 'max_length';
type ValueKind = 'min_value' | 'max_value';

export interface DifferentialObjectSpec {
	t: 'object';
	flavor: ConformanceFlavor;
	entries: Array<[string, DifferentialSpec]>;
}

/** A schema as data, which `build_spec` makes in any of the three libraries. */
export type DifferentialSpec =
	| { t: LeafKind }
	| { t: 'literal'; v: unknown }
	| { t: 'one_of'; vs: Array<unknown> }
	| { t: WrapKind; of: DifferentialSpec }
	| { t: 'default' | 'default_fn'; of: DifferentialSpec; v: unknown }
	| { t: 'union'; of: Array<DifferentialSpec> }
	| { t: 'variant'; key: string; of: Array<DifferentialObjectSpec> }
	| DifferentialObjectSpec
	| { t: 'rest'; entries: Array<[string, DifferentialSpec]>; rest: DifferentialSpec }
	| { t: 'refine'; of: DifferentialSpec; fn: string }
	| { t: 'map'; of: DifferentialSpec; fn: string }
	| { t: 'check'; fn: string }
	| { t: 'transform'; fn: string }
	| { t: LengthKind; of: DifferentialSpec; n: number }
	| { t: ValueKind; of: DifferentialSpec; n: number | bigint }
	| { t: 'regex'; of: DifferentialSpec; re: string };

/**
 * What `--focus` takes: a kind of `DifferentialSpec`, or an object flavor.
 * `object_with_rest` is `rest`, `pipe` with a check `refine`, with a
 * transform `map`, `with_default` `default`, and `with_default_fn`
 * `default_fn`.
 */
export const DIFFERENTIAL_KINDS = [
	'string',
	'number',
	'integer',
	'safe_integer',
	'boolean',
	'bigint',
	'unknown',
	'undef',
	'literal',
	'one_of',
	'optional',
	'nullable',
	'lazy',
	'message',
	'array',
	'record',
	'default',
	'default_fn',
	'union',
	'variant',
	'object',
	'strip',
	'strict',
	'loose',
	'rest',
	'refine',
	'map',
	'check',
	'transform',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
] as const;

export type DifferentialKind = (typeof DIFFERENTIAL_KINDS)[number];

interface NamedFn<T> {
	fn: (x: any) => T;
	/** Its source, for a case printed for the matrix. */
	src: string;
}

// pure functions, which never throw on any input
const CHECKS: Record<string, NamedFn<boolean>> = {
	true: { fn: () => true, src: '() => true' },
	false: { fn: () => false, src: '() => false' },
	defined: { fn: (x) => x !== undefined, src: '(x) => x !== undefined' },
	is_string: { fn: (x) => typeof x === 'string', src: "(x) => typeof x === 'string'" },
	truthy: { fn: (x) => !!x, src: '(x) => !!x' }
};
const MAPS: Record<string, NamedFn<unknown>> = {
	to_T: { fn: () => 'T', src: "() => 'T'" },
	identity: { fn: (x) => x, src: '(x) => x' },
	or_d: { fn: (x) => x ?? 'd', src: "(x) => x ?? 'd'" },
	to_undefined: { fn: () => undefined, src: '() => undefined' },
	to_null: { fn: () => null, src: '() => null' },
	neg: {
		fn: (x) => (typeof x === 'number' ? -x : x),
		src: "(x) => (typeof x === 'number' ? -x : x)"
	}
};
const CHECK_NAMES = Object.keys(CHECKS);
const MAP_NAMES = Object.keys(MAPS);

// none global or sticky, whose `test` keeps state
const PATTERNS: Record<string, RegExp> = {
	x: /x/,
	empty: /^$/,
	digit: /\d/,
	lower: /^[a-z]+$/,
	surrogate: /\uD800/
};
const PATTERN_NAMES = Object.keys(PATTERNS);

/**
 * Makes `spec` in the library `l` writes schemas for.
 *
 * @throws Error - when the library refuses the schema
 */
export const build_spec = (spec: DifferentialSpec, l: ConformanceLib): any => {
	switch (spec.t) {
		case 'string':
		case 'number':
		case 'integer':
		case 'safe_integer':
		case 'boolean':
		case 'bigint':
		case 'unknown':
		case 'undef':
			return l[spec.t];
		case 'literal':
			return l.literal(spec.v);
		case 'one_of':
			return l.one_of(spec.vs);
		case 'optional':
		case 'nullable':
		case 'message':
		case 'array':
		case 'record':
			return l[spec.t](build_spec(spec.of, l));
		case 'lazy': {
			const inner = build_spec(spec.of, l);
			return l.lazy(() => inner);
		}
		case 'default':
			return l.with_default(build_spec(spec.of, l), spec.v);
		case 'default_fn': {
			const value = spec.v;
			return l.with_default_fn(build_spec(spec.of, l), () => value);
		}
		case 'union':
			return l.union(spec.of.map((option) => build_spec(option, l)));
		case 'variant':
			return l.variant(
				spec.key,
				spec.of.map((option) => build_spec(option, l))
			);
		case 'object':
			return l[spec.flavor](build_entries(spec.entries, l));
		case 'rest':
			return l.rest(build_entries(spec.entries, l), build_spec(spec.rest, l));
		case 'refine':
			return l.refine(build_spec(spec.of, l), CHECKS[spec.fn]!.fn);
		case 'map':
			return l.map(build_spec(spec.of, l), MAPS[spec.fn]!.fn);
		case 'check':
			return l.check(CHECKS[spec.fn]!.fn);
		case 'transform':
			return l.transform(MAPS[spec.fn]!.fn);
		case 'min_length':
		case 'max_length':
			return l[spec.t](build_spec(spec.of, l), spec.n);
		case 'min_value':
		case 'max_value':
			return l[spec.t](build_spec(spec.of, l), spec.n);
		case 'regex':
			return l.regex(build_spec(spec.of, l), PATTERNS[spec.re]!);
	}
};

const build_entries = (
	entries: Array<[string, DifferentialSpec]>,
	l: ConformanceLib
): Record<string, any> => Object.fromEntries(entries.map(([key, e]) => [key, build_spec(e, l)]));

const LITERALS: Array<unknown> = ['x', 'y', '', 0, 1, true, false, null, undefined, 1n];
const DEFAULTS: Array<unknown> = ['D', 1, null, undefined];
const ENTRY_KEYS = ['a', 'b', 'd'];
const VARIANT_KEYS = ['x', 'y'];
const DISCRIMINATORS: Array<unknown> = ['a', 'b', 'c', 1];
const NUMBER_BOUNDS: Array<number> = [0, 1, -1, 1.5, 2 ** 53];
const BIGINT_BOUNDS: Array<bigint> = [0n, 1n, -1n];

const LEAF_KINDS: Array<DifferentialKind> = [
	'string',
	'string',
	'number',
	'number',
	'integer',
	'safe_integer',
	'bigint',
	'boolean',
	'unknown',
	'undef',
	'literal',
	'literal',
	'one_of',
	'check',
	'transform',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
];
const INNER_KINDS: Array<DifferentialKind> = [
	'optional',
	'optional',
	'optional',
	'nullable',
	'nullable',
	'lazy',
	'message',
	'default',
	'default',
	'default_fn',
	'union',
	'union',
	'variant',
	'array',
	'record',
	'object',
	'object',
	'object',
	'rest',
	'refine',
	'refine',
	'map',
	'map',
	'min_length',
	'min_value',
	'regex'
];

const gen_entries = (
	rng: DifferentialRng,
	keys: Array<string>,
	depth: number,
	focus: DifferentialKind | null
): Array<[string, DifferentialSpec]> => keys.map((key) => [key, gen_spec(rng, depth - 1, focus)]);

/** A node of `kind`, its children generated. */
const gen_node = (
	rng: DifferentialRng,
	kind: DifferentialKind,
	depth: number,
	focus: DifferentialKind | null
): DifferentialSpec => {
	switch (kind) {
		case 'string':
		case 'number':
		case 'integer':
		case 'safe_integer':
		case 'boolean':
		case 'bigint':
		case 'unknown':
		case 'undef':
			return { t: kind };
		case 'literal':
			return { t: 'literal', v: rng.pick(LITERALS) };
		case 'one_of':
			return {
				t: 'one_of',
				vs: [...new Set(Array.from({ length: 2 + rng.int(2) }, () => rng.pick(LITERALS)))]
			};
		case 'check':
			return { t: 'check', fn: rng.pick(CHECK_NAMES) };
		case 'transform':
			return { t: 'transform', fn: rng.pick(MAP_NAMES) };
		case 'optional':
		case 'nullable':
		case 'lazy':
		case 'message':
		case 'array':
		case 'record':
			return { t: kind, of: gen_spec(rng, depth - 1, focus) };
		case 'default':
		case 'default_fn':
			return { t: kind, of: gen_spec(rng, depth - 1, focus), v: rng.pick(DEFAULTS) };
		case 'union':
			return {
				t: 'union',
				of: Array.from({ length: 2 + rng.int(2) }, () => gen_spec(rng, depth - 1, focus))
			};
		case 'variant': {
			const count = 2 + rng.int(2);
			const picked: Array<unknown> = [];
			while (picked.length < count) {
				const value = rng.pick(DISCRIMINATORS);
				if (!picked.includes(value)) picked.push(value);
			}
			// rarely, the first option is told by a missing key
			if (rng.chance(0.05)) picked[0] = undefined;
			return {
				t: 'variant',
				key: 't',
				of: picked.map((value) => ({
					t: 'object',
					flavor: rng.pick(CONFORMANCE_FLAVORS),
					entries: [
						['t', { t: 'literal', v: value }],
						...gen_entries(rng, VARIANT_KEYS.slice(0, rng.int(3)), depth, focus)
					]
				}))
			};
		}
		case 'object':
		case 'strip':
		case 'strict':
		case 'loose':
			return {
				t: 'object',
				flavor: kind === 'object' ? rng.pick(CONFORMANCE_FLAVORS) : kind,
				entries: gen_entries(rng, ENTRY_KEYS.slice(0, rng.int(4)), depth, focus)
			};
		case 'rest':
			return {
				t: 'rest',
				entries: gen_entries(rng, ENTRY_KEYS.slice(0, rng.int(3)), depth, focus),
				rest: gen_spec(rng, depth - 1, focus)
			};
		case 'refine':
			return { t: 'refine', of: gen_spec(rng, depth - 1, focus), fn: rng.pick(CHECK_NAMES) };
		case 'map':
			return { t: 'map', of: gen_spec(rng, depth - 1, focus), fn: rng.pick(MAP_NAMES) };
		case 'min_length':
		case 'max_length':
			return {
				t: kind,
				of: rng.chance(0.6) ? { t: 'string' } : { t: 'array', of: gen_spec(rng, depth - 1, focus) },
				n: rng.int(4)
			};
		case 'min_value':
		case 'max_value': {
			const of: LeafKind = rng.pick(['number', 'integer', 'safe_integer', 'bigint'] as const);
			return {
				t: kind,
				of: { t: of },
				n: of === 'bigint' ? rng.pick(BIGINT_BOUNDS) : rng.pick(NUMBER_BOUNDS)
			};
		}
		case 'regex':
			return { t: 'regex', of: { t: 'string' }, re: rng.pick(PATTERN_NAMES) };
	}
};

/** A schema of at most `depth` levels, the `focus` kind made often. */
export const gen_spec = (
	rng: DifferentialRng,
	depth: number,
	focus: DifferentialKind | null = null
): DifferentialSpec => {
	if (focus && rng.chance(0.3)) return gen_node(rng, focus, Math.max(depth, 1), focus);
	if (depth <= 0 || rng.chance(0.25)) return gen_node(rng, rng.pick(LEAF_KINDS), 0, focus);
	return gen_node(rng, rng.pick(INNER_KINDS), depth, focus);
};

/** Whether `spec` has a node of `kind` anywhere. */
export const spec_has_kind = (spec: DifferentialSpec, kind: DifferentialKind): boolean => {
	if (spec.t === kind) return true;
	if (spec.t === 'object' && spec.flavor === kind) return true;
	return spec_children(spec).some((child) => spec_has_kind(child, kind));
};

const spec_children = (spec: DifferentialSpec): Array<DifferentialSpec> => {
	const children: Array<DifferentialSpec> = [];
	map_spec_children(spec, (child) => {
		children.push(child);
		return child;
	});
	return children;
};

/** `spec` with `fn` of each child, itself where none changed. */
export const map_spec_children = (
	spec: DifferentialSpec,
	fn: (child: DifferentialSpec) => DifferentialSpec
): DifferentialSpec => {
	const list = <T extends DifferentialSpec>(items: Array<T>): Array<T> | null => {
		const next = items.map((item) => fn(item) as T);
		return next.some((item, i) => item !== items[i]) ? next : null;
	};
	const entries = (
		items: Array<[string, DifferentialSpec]>
	): Array<[string, DifferentialSpec]> | null => {
		const next = items.map(([key, e]): [string, DifferentialSpec] => [key, fn(e)]);
		return next.some(([, e], i) => e !== items[i]![1]) ? next : null;
	};
	switch (spec.t) {
		case 'union': {
			const of = list(spec.of);
			return of ? { ...spec, of } : spec;
		}
		case 'variant': {
			const of = list(spec.of);
			return of ? { ...spec, of } : spec;
		}
		case 'object': {
			const next = entries(spec.entries);
			return next ? { ...spec, entries: next } : spec;
		}
		case 'rest': {
			const next = entries(spec.entries);
			const rest = fn(spec.rest);
			return next || rest !== spec.rest ? { ...spec, entries: next ?? spec.entries, rest } : spec;
		}
		default: {
			if (!('of' in spec)) return spec;
			const of = fn(spec.of);
			return of === spec.of ? spec : { ...spec, of };
		}
	}
};

/** The root schema of a case: most often an object, as most differences are in one. */
export const gen_root_spec = (
	rng: DifferentialRng,
	focus: DifferentialKind | null = null
): DifferentialSpec => {
	for (let tries = 0; ; tries++) {
		const spec = rng.chance(0.6)
			? gen_node(rng, rng.pick(['object', 'object', 'object', 'rest'] as const), 3, focus)
			: gen_spec(rng, 3, focus);
		if (!focus || tries >= 50 || spec_has_kind(spec, focus)) return spec;
	}
};

//
// Inputs, as recipes, so every library gets a fresh one
//

/** The entries of an object input, or the keys of an array input that are not items. */
export type DifferentialEntries = Array<[string, DifferentialInput]>;

/** An input as data, which `materialize_input` makes afresh for each run. */
export type DifferentialInput =
	| { t: 'v'; v: unknown }
	| {
			t: 'arr';
			/** `null` is a hole. */
			items: Array<DifferentialInput | null>;
			/** Own enumerable keys that are not items. */
			extra: DifferentialEntries;
			/** An instance of `ConformanceList`. */
			sub: boolean;
	  }
	| {
			t: 'obj';
			own: DifferentialEntries;
			/** The prototype: `Object.prototype`, `null`, or `ConformancePoint`'s. */
			base: 'plain' | 'null' | 'class';
			/** Entries of a plain prototype between the object and `Object.prototype`. */
			proto: DifferentialEntries;
			/** Own keys that are not enumerable. */
			hidden: DifferentialEntries;
			/** The value of the own key `Symbol.for('sym')`. */
			symbol: DifferentialInput | null;
			frozen: boolean;
	  };

const SYMBOL = Symbol.for('sym');

/** An input of the value `v`. */
export const value_in = (v: unknown): DifferentialInput => ({ t: 'v', v });
const arr_in = (items: Array<DifferentialInput | null>): DifferentialInput => ({
	t: 'arr',
	items,
	extra: [],
	sub: false
});
/** A plain object input of `own` keys, with a prototype of `proto` keys where given. */
export const obj_in = (
	own: DifferentialEntries,
	proto: DifferentialEntries = []
): DifferentialInput => ({
	t: 'obj',
	own,
	base: 'plain',
	proto,
	hidden: [],
	symbol: null,
	frozen: false
});

const EDGES: Array<unknown> = [
	undefined,
	null,
	NaN,
	Infinity,
	-Infinity,
	-0,
	0,
	1,
	1.5,
	'',
	'x',
	'T',
	'D',
	true,
	false,
	1n,
	2 ** 53,
	-(2 ** 53),
	2 ** 53 + 2,
	Number.MAX_VALUE,
	'\uD800',
	'é'
];
const STRINGS = ['x', '', 'T', 'D', 'ab', 'a1', 'abc', '\uD800', 'é', '\uD83D\uDE00'];
const NUMBERS = [1, 0, -0, 1.5, -5, NaN, Infinity, 2 ** 53];
const INTEGERS = [
	1,
	0,
	-0,
	1.5,
	2 ** 53 - 1,
	2 ** 53,
	2 ** 53 + 2,
	-(2 ** 53 - 1),
	-(2 ** 53),
	Number.MAX_VALUE,
	NaN,
	Infinity
];
const BIGINTS: Array<unknown> = [0n, 1n, -1n, 2n ** 64n, 1];
const EXTRA_KEYS = [
	'z',
	'constructor',
	'prototype',
	'toString',
	'__proto__',
	'hasOwnProperty',
	'valueOf'
];

const edge = (rng: DifferentialRng): DifferentialInput =>
	rng.chance(0.15) ? (rng.chance(0.5) ? arr_in([]) : obj_in([])) : value_in(rng.pick(EDGES));

const dedupe = (list: DifferentialEntries): DifferentialEntries => {
	const seen: Set<string> = new Set();
	return list.filter(([key]) => !seen.has(key) && !!seen.add(key));
};

const shuffle = (rng: DifferentialRng, list: Array<unknown>): void => {
	for (let i = list.length - 1; i > 0; i--) {
		const j = rng.int(i + 1);
		[list[i], list[j]] = [list[j], list[i]];
	}
};

// what an object input is past its own enumerable keys, now and then
const vary_object = (rng: DifferentialRng, input: DifferentialInput & { t: 'obj' }): void => {
	if (!input.proto.length) {
		const r = rng.int(100);
		if (r < 4) input.base = 'null';
		else if (r < 8) input.base = 'class';
	}
	if (rng.chance(0.03) && input.own.length) input.hidden.push(input.own.pop()!);
	if (rng.chance(0.03)) input.symbol = edge(rng);
	if (rng.chance(0.03)) input.frozen = true;
};

const gen_object_input = (
	rng: DifferentialRng,
	entries: Array<[string, DifferentialSpec]>,
	rest: DifferentialSpec | null,
	depth: number
): DifferentialInput => {
	const own: DifferentialEntries = [];
	const proto: DifferentialEntries = [];
	for (const [key, e] of entries) {
		const r = rng.int(100);
		if (r < 68) own.push([key, gen_input(rng, e, depth + 1)]);
		else if (r < 80) continue; // missing
		else if (r < 88) own.push([key, value_in(undefined)]);
		else if (r < 94) {
			proto.push([key, rng.chance(0.5) ? value_in(undefined) : gen_input(rng, e, depth + 1)]);
		} else own.push([key, edge(rng)]);
	}
	if (rest && rng.chance(0.5)) {
		for (const key of ['z', 'y'].slice(0, 1 + rng.int(2))) {
			own.push([key, gen_input(rng, rest, depth + 1)]);
		}
	}
	if (rng.chance(0.2))
		own.push([rng.pick(EXTRA_KEYS), rest ? gen_input(rng, rest, depth + 1) : edge(rng)]);
	if (rng.chance(0.08)) proto.push([rng.pick(EXTRA_KEYS), edge(rng)]);
	if (rng.chance(0.1)) shuffle(rng, own);
	const input = obj_in(dedupe(own), dedupe(proto)) as DifferentialInput & { t: 'obj' };
	vary_object(rng, input);
	return input;
};

/** An input shaped by `spec`, with an edge in place of a value now and then. */
export const gen_input = (
	rng: DifferentialRng,
	spec: DifferentialSpec,
	depth = 0
): DifferentialInput => {
	if (rng.chance(0.12) || depth > 6) return edge(rng);
	switch (spec.t) {
		case 'string':
		case 'regex':
			return value_in(rng.pick(STRINGS));
		case 'number':
			return value_in(rng.pick(NUMBERS));
		case 'integer':
		case 'safe_integer':
			return value_in(rng.pick(INTEGERS));
		case 'bigint':
			return value_in(rng.pick(BIGINTS));
		case 'boolean':
			return value_in(rng.pick([true, false]));
		case 'literal':
			return value_in(spec.v);
		case 'one_of':
			return value_in(rng.pick(spec.vs));
		case 'optional':
		case 'nullable':
		case 'default':
		case 'default_fn':
			if (rng.chance(0.3)) return value_in(rng.pick([undefined, null]));
			return gen_input(rng, spec.of, depth + 1);
		case 'lazy':
		case 'message':
		case 'refine':
		case 'map':
		case 'min_value':
		case 'max_value':
			return gen_input(rng, spec.of, depth + 1);
		case 'min_length':
		case 'max_length':
			if (spec.of.t === 'string' && rng.chance(0.3)) {
				return value_in('abcd'.slice(0, rng.int(5)));
			}
			return gen_input(rng, spec.of, depth + 1);
		case 'union':
			return gen_input(rng, rng.pick(spec.of), depth + 1);
		case 'variant': {
			if (rng.chance(0.05)) return arr_in([]);
			const option = rng.pick(spec.of);
			const input = gen_object_input(rng, option.entries, null, depth) as DifferentialInput & {
				t: 'obj';
			};
			if (rng.chance(0.08)) {
				input.own = [
					[spec.key, value_in(rng.pick(['z', undefined, 1]))],
					...input.own.filter(([k]) => k !== spec.key)
				];
			}
			return input;
		}
		case 'array': {
			const items: Array<DifferentialInput | null> = Array.from({ length: rng.int(4) }, () =>
				rng.chance(0.05) ? null : gen_input(rng, spec.of, depth + 1)
			);
			const input = arr_in(items) as DifferentialInput & { t: 'arr' };
			if (rng.chance(0.04)) input.extra.push(['z', edge(rng)]);
			if (rng.chance(0.04)) input.sub = true;
			return input;
		}
		case 'record': {
			const own: DifferentialEntries = Array.from({ length: rng.int(3) }, (_, i) => [
				rng.chance(0.15) ? rng.pick(EXTRA_KEYS) : 'k' + i,
				gen_input(rng, spec.of, depth + 1)
			]);
			const input = obj_in(
				dedupe(own),
				rng.chance(0.1) ? [['q', gen_input(rng, spec.of, depth + 1)]] : []
			) as DifferentialInput & { t: 'obj' };
			vary_object(rng, input);
			return input;
		}
		case 'object':
			if (rng.chance(0.05)) return arr_in([]);
			return gen_object_input(rng, spec.entries, null, depth);
		case 'rest':
			if (rng.chance(0.05)) return arr_in([]);
			return gen_object_input(rng, spec.entries, spec.rest, depth);
		default:
			return edge(rng);
	}
};

/** Makes the value `input` describes, a new one on every call. */
export const materialize_input = (input: DifferentialInput): unknown => {
	switch (input.t) {
		case 'v':
			return input.v;
		case 'arr': {
			const array: Array<unknown> = new Array(input.items.length);
			input.items.forEach((item, i) => {
				if (item) array[i] = materialize_input(item);
			});
			define_entries(array, input.extra, true);
			if (input.sub) Object.setPrototypeOf(array, ConformanceList.prototype);
			return array;
		}
		case 'obj': {
			const proto =
				input.base === 'null'
					? null
					: input.base === 'class'
						? ConformancePoint.prototype
						: input.proto.length
							? define_entries({}, input.proto, true)
							: Object.prototype;
			const object = define_entries(Object.create(proto), input.own, true);
			define_entries(object, input.hidden, false);
			if (input.symbol) object[SYMBOL] = materialize_input(input.symbol);
			return input.frozen ? Object.freeze(object) : object;
		}
	}
};

// own data properties, so a key named `__proto__` is an own key too
const define_entries = (object: any, entries: DifferentialEntries, enumerable: boolean): any => {
	for (const [key, value] of entries) {
		Object.defineProperty(object, key, {
			value: materialize_input(value),
			enumerable,
			writable: true,
			configurable: true
		});
	}
	return object;
};

//
// Text, to read and to paste
//

const fn_name = (table: Record<string, NamedFn<unknown>>, name: string): string =>
	table[name] ? name : '?';

/** A schema as a short text. */
export const show_spec = (spec: DifferentialSpec): string => {
	const entries = (list: Array<[string, DifferentialSpec]>): string =>
		list.map(([key, e]) => `${key}:${show_spec(e)}`).join(',');
	switch (spec.t) {
		case 'literal':
			return `literal(${render_value(spec.v)})`;
		case 'one_of':
			return `one_of(${spec.vs.map(render_value).join(',')})`;
		case 'optional':
		case 'nullable':
		case 'lazy':
		case 'message':
		case 'array':
		case 'record':
			return `${spec.t}(${show_spec(spec.of)})`;
		case 'default':
		case 'default_fn':
			return `${spec.t}(${show_spec(spec.of)},${render_value(spec.v)})`;
		case 'union':
			return `union[${spec.of.map(show_spec).join(',')}]`;
		case 'variant':
			return `variant(${spec.key},[${spec.of.map(show_spec).join(',')}])`;
		case 'object':
			return `${spec.flavor}{${entries(spec.entries)}}`;
		case 'rest':
			return `rest{${entries(spec.entries)}}(${show_spec(spec.rest)})`;
		case 'refine':
			return `refine(${show_spec(spec.of)},${fn_name(CHECKS, spec.fn)})`;
		case 'map':
			return `map(${show_spec(spec.of)},${fn_name(MAPS, spec.fn)})`;
		case 'check':
		case 'transform':
			return `${spec.t}(${spec.fn})`;
		case 'min_length':
		case 'max_length':
		case 'min_value':
		case 'max_value':
			return `${spec.t}(${show_spec(spec.of)},${render_value(spec.n)})`;
		case 'regex':
			return `regex(${show_spec(spec.of)},${String(PATTERNS[spec.re])})`;
		default:
			return spec.t;
	}
};

/** An input as a short text, with what `render_value` leaves out of it. */
export const show_input = (input: DifferentialInput): string => {
	const entries = (list: DifferentialEntries): string =>
		list.map(([key, value]) => `${key}: ${show_input(value)}`).join(', ');
	switch (input.t) {
		case 'v':
			return render_value(input.v);
		case 'arr':
			return (
				'[' +
				input.items.map((item) => (item ? show_input(item) : '<hole>')).join(', ') +
				']' +
				(input.extra.length ? ` with {${entries(input.extra)}}` : '') +
				(input.sub ? ' sub' : '')
			);
		case 'obj':
			return (
				`{${entries(input.own)}}` +
				(input.proto.length ? ` proto={${entries(input.proto)}}` : '') +
				(input.base === 'plain' ? '' : ` proto=${input.base}`) +
				(input.hidden.length ? ` hidden={${entries(input.hidden)}}` : '') +
				(input.symbol ? ` sym=${show_input(input.symbol)}` : '') +
				(input.frozen ? ' frozen' : '')
			);
	}
};

const source_value = (value: unknown): string => {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'bigint') return value + 'n';
	if (Object.is(value, -0)) return '-0';
	return String(value);
};

const source_key = (key: string): string =>
	key === '__proto__'
		? "['__proto__']"
		: /^[A-Za-z_$][\w$]*$/.test(key)
			? key
			: JSON.stringify(key);

const source_entries = (
	list: Array<[string, DifferentialSpec]>,
	of: (spec: DifferentialSpec) => string
): string => `{${list.map(([key, e]) => `${source_key(key)}: ${of(e)}`).join(', ')}}`;

/** A schema as the source of a matrix case's `schema`, against a library `l`. */
export const source_spec = (spec: DifferentialSpec): string => {
	switch (spec.t) {
		case 'literal':
			return `l.literal(${source_value(spec.v)})`;
		case 'one_of':
			return `l.one_of([${spec.vs.map(source_value).join(', ')}])`;
		case 'optional':
		case 'nullable':
		case 'message':
		case 'array':
		case 'record':
			return `l.${spec.t}(${source_spec(spec.of)})`;
		case 'lazy':
			return `l.lazy(() => ${source_spec(spec.of)})`;
		case 'default':
			return `l.with_default(${source_spec(spec.of)}, ${source_value(spec.v)})`;
		case 'default_fn':
			return `l.with_default_fn(${source_spec(spec.of)}, () => ${source_value(spec.v)})`;
		case 'union':
			return `l.union([${spec.of.map(source_spec).join(', ')}])`;
		case 'variant':
			return `l.variant('${spec.key}', [${spec.of.map(source_spec).join(', ')}])`;
		case 'object':
			return `l.${spec.flavor}(${source_entries(spec.entries, source_spec)})`;
		case 'rest':
			return `l.rest(${source_entries(spec.entries, source_spec)}, ${source_spec(spec.rest)})`;
		case 'refine':
			return `l.refine(${source_spec(spec.of)}, ${CHECKS[spec.fn]!.src})`;
		case 'map':
			return `l.map(${source_spec(spec.of)}, ${MAPS[spec.fn]!.src})`;
		case 'check':
			return `l.check(${CHECKS[spec.fn]!.src})`;
		case 'transform':
			return `l.transform(${MAPS[spec.fn]!.src})`;
		case 'min_length':
		case 'max_length':
		case 'min_value':
		case 'max_value':
			return `l.${spec.t}(${source_spec(spec.of)}, ${source_value(spec.n)})`;
		case 'regex':
			return `l.regex(${source_spec(spec.of)}, ${String(PATTERNS[spec.re])})`;
		default:
			return `l.${spec.t}`;
	}
};

/**
 * An input as the source of a matrix case's `input`, with the names that
 * `conformance_test_helpers.ts` has in scope: `with_hidden`, `SYMBOL`,
 * `ConformancePoint`, and `ConformanceList`.
 */
export const source_input = (input: DifferentialInput): string => {
	const literal = (list: DifferentialEntries, symbol: DifferentialInput | null = null): string =>
		'{' +
		[
			...list.map(([key, value]) => `${source_key(key)}: ${source_input(value)}`),
			...(symbol ? [`[SYMBOL]: ${source_input(symbol)}`] : [])
		].join(', ') +
		'}';
	switch (input.t) {
		case 'v':
			return source_value(input.v);
		case 'arr': {
			const items = input.items.map((item) => (item ? source_input(item) : ''));
			let out = `[${items.join(', ')}${input.items.at(-1) === null ? ',' : ''}]`;
			if (input.extra.length) out = `Object.assign(${out}, ${literal(input.extra)})`;
			if (input.sub) out = `Object.setPrototypeOf(${out}, ConformanceList.prototype)`;
			return out;
		}
		case 'obj': {
			let out = literal(input.own, input.symbol);
			const proto =
				input.base === 'null'
					? 'null'
					: input.base === 'class'
						? 'ConformancePoint.prototype'
						: input.proto.length
							? literal(input.proto)
							: null;
			if (proto) out = `Object.create(${proto}, Object.getOwnPropertyDescriptors(${out}))`;
			for (const [key, value] of input.hidden) {
				out = `with_hidden(${out}, ${JSON.stringify(key)}, ${source_input(value)})`;
			}
			return input.frozen ? `Object.freeze(${out})` : out;
		}
	}
};

/** A case to paste into `CONFORMANCE_CASES`, named for the matrix to rename. */
export const source_case = (spec: DifferentialSpec, input: DifferentialInput): string =>
	`{\n\tname: 'differential: ${show_spec(spec).replaceAll("'", "\\'")} on ${show_input(input).replaceAll("'", "\\'")}',\n\tschema: (l) => ${source_spec(spec)},\n\tinput: () => ${source_input(input)}\n},`;

//
// Running
//

/** What one library did with one case. */
export interface DifferentialResult {
	/** `render_parsed` of the result, `throws:` and the error, or `refused:` and the error of building. */
	text: string;
	ok: boolean;
	value: unknown;
	/** The input this run was given, which no other run was. */
	input: unknown;
	/** The recipe of `input`. */
	recipe: DifferentialInput;
	parsed: ConformanceParsed | null;
}

export type DifferentialResults = Record<ConformanceLibName, DifferentialResult>;

const LIB_NAMES: Array<ConformanceLibName> = ['zod', 'valibot', 'fuz_schema'];

/** The first line of the message of a thrown `error`. */
export const differential_error_line = (error: unknown): string =>
	String((error as Error | undefined)?.message).split('\n')[0]!;

/** Runs one library on a case, an input of its own made from `input`. */
export type DifferentialRun = (
	name: ConformanceLibName,
	spec: DifferentialSpec,
	input: DifferentialInput
) => DifferentialResult;

/** Runs one library on a case, every call on a fresh input. */
const run_differential_lib: DifferentialRun = (name, spec, input) => {
	const l = CONFORMANCE_LIBS[name];
	const value = materialize_input(input);
	const failed = (text: string): DifferentialResult => ({
		text,
		ok: false,
		value: undefined,
		input: value,
		recipe: input,
		parsed: null
	});
	let schema: unknown;
	try {
		schema = build_spec(spec, l);
	} catch (error) {
		return failed('refused: ' + differential_error_line(error));
	}
	try {
		const parsed = l.parse(schema, value);
		return {
			text: render_parsed(parsed),
			ok: parsed.ok,
			value: parsed.ok ? parsed.value : undefined,
			input: value,
			recipe: input,
			parsed
		};
	} catch (error) {
		return failed('throws: ' + differential_error_line(error));
	}
};

/**
 * A `DifferentialRun` that runs each library once on each spec and input,
 * told apart by their data, and gives every later call that result again.
 * A run is a function of the three: the inputs are made afresh, the checks
 * and transforms are pure, and the patterns keep no state. One is made for
 * each case classified, so nothing outlives it, and those who share a result
 * only read it.
 */
export const create_differential_run = (): DifferentialRun => {
	const done: Map<string, DifferentialResult> = new Map();
	return (name, spec, input) => {
		const key = case_key(name, spec, input);
		if (key === null) return run_differential_lib(name, spec, input);
		let result = done.get(key);
		if (!result) {
			result = run_differential_lib(name, spec, input);
			done.set(key, result);
		}
		return result;
	};
};

class Unkeyable extends Error {}

// each value its type and its text, so a string never reads as a number, and
// `-0`, `NaN`, `undefined`, and a bigint each as itself. Anything but a plain
// object or array of those, nothing hidden from `JSON.stringify`, is no key
const tag_value = (_key: string, value: unknown): unknown => {
	switch (typeof value) {
		case 'string':
			return 's' + value;
		case 'number':
			return 'n' + (Object.is(value, -0) ? '-0' : String(value));
		case 'bigint':
			return 'b' + String(value);
		case 'boolean':
			return value ? 't' : 'f';
		case 'undefined':
			return 'u';
		case 'object': {
			if (value === null) return 'z';
			// every own key enumerable and none a symbol, no holes or other keys
			// on an array, and no value with a `toJSON`, which runs before this
			// is handed what it gives
			const proto = Object.getPrototypeOf(value);
			const keys = Object.keys(value).length;
			const own = Reflect.ownKeys(value).length;
			if (
				!Object.values(value).some((v) => v !== null && typeof v === 'object' && 'toJSON' in v) &&
				(proto === Object.prototype
					? own === keys
					: proto === Array.prototype &&
						keys === (value as Array<unknown>).length &&
						own === keys + 1)
			) {
				return value;
			}
			throw new Unkeyable();
		}
		default:
			throw new Unkeyable();
	}
};

// what a run is told apart by, `null` where the data holds what can't be keyed
const case_key = (
	name: ConformanceLibName,
	spec: DifferentialSpec,
	input: DifferentialInput
): string | null => {
	try {
		return JSON.stringify([name, spec, input], tag_value);
	} catch (error) {
		if (error instanceof Unkeyable) return null;
		throw error;
	}
};

/** Runs a case through the three libraries, each on an input of its own. */
export const run_differential_case = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	run: DifferentialRun = run_differential_lib
): DifferentialResults =>
	Object.fromEntries(LIB_NAMES.map((name) => [name, run(name, spec, input)])) as any;
