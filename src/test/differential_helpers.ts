/**
 * The differential: schemas and inputs generated from a seed, run through
 * zod, valibot and this library by the adapters of the conformance matrix,
 * and each result classified by the tables of `conformance_tables.ts`.
 *
 * A case is one of:
 * - `agree`: this library's result is zod's, and zod's is valibot's
 * - `declared`: zod and valibot agree, this library doesn't, and the rules
 *   below explain it, each a rule of one declared difference
 * - `undeclared`: zod and valibot agree, and the rules don't explain this
 *   library's result. It is minimized and printed as a case for the matrix
 * - `sides`: zod and valibot disagree, tallied by whose result this
 *   library's is. Reported, never a failure
 * - `refused`: zod or valibot threw, building the schema or parsing
 * - `throws`: this library threw
 *
 * Every case is also run through this library's invariants: the input is not
 * mutated, every issue is the five fields, `is` agrees with `parse`, a second
 * parse gives the same result, and the context's count is kept.
 *
 * A rule is a rewrite of the input that takes away what triggers a declared
 * difference, or a relaxation of the comparison that allows for what it
 * does, and each allows only what its row says this library does. A rewrite
 * is applied only where this library does the same on the rewritten input,
 * apart from the keys it touched. A mismatch is declared when applying every
 * rule makes the three agree, and is credited to the rules left after each is
 * dropped in turn, the last first, where the three still agree without it.
 * Each rule names a row of a declared difference, and
 * `schema.differential.test.ts` holds it there, so a rule can't outlive its
 * declaration. A difference that is a combination of recorded behaviors is a
 * declared difference too, with its own row and a case in the matrix: two
 * `SIDES` rows that cancel, a declared difference with a `SIDES` row, or a
 * `SIDES` row with the copies' drop of a `__proto__` key. Where a rule brings
 * out a disagreement of zod and valibot, exactly one entry of
 * `SPLIT_RECOGNIZERS`, each of a `SIDES` row, must recognize it, and this
 * library's result is held to that of the row's side.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import {
	CONFORMANCE_FLAVORS,
	CONFORMANCE_LIBS,
	ConformanceList,
	ConformancePoint,
	render_parsed,
	render_shape,
	render_value,
	render_whole,
	type ConformanceFlavor,
	type ConformanceLib,
	type ConformanceLibName,
	type ConformanceParsed
} from './conformance_test_helpers.ts';
import { SIDES } from './conformance_tables.ts';

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

type Entries = Array<[string, DifferentialInput]>;

/** An input as data, which `materialize_input` makes afresh for each run. */
export type DifferentialInput =
	| { t: 'v'; v: unknown }
	| {
			t: 'arr';
			/** `null` is a hole. */
			items: Array<DifferentialInput | null>;
			/** Own enumerable keys that are not items. */
			extra: Entries;
			/** An instance of `ConformanceList`. */
			sub: boolean;
	  }
	| {
			t: 'obj';
			own: Entries;
			/** The prototype: `Object.prototype`, `null`, or `ConformancePoint`'s. */
			base: 'plain' | 'null' | 'class';
			/** Entries of a plain prototype between the object and `Object.prototype`. */
			proto: Entries;
			/** Own keys that are not enumerable. */
			hidden: Entries;
			/** The value of the own key `Symbol.for('sym')`. */
			symbol: DifferentialInput | null;
			frozen: boolean;
	  };

const SYMBOL = Symbol.for('sym');

const value_in = (v: unknown): DifferentialInput => ({ t: 'v', v });
const arr_in = (items: Array<DifferentialInput | null>): DifferentialInput => ({
	t: 'arr',
	items,
	extra: [],
	sub: false
});
const obj_in = (own: Entries, proto: Entries = []): DifferentialInput => ({
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

const dedupe = (list: Entries): Entries => {
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
	const own: Entries = [];
	const proto: Entries = [];
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
			const own: Entries = Array.from({ length: rng.int(3) }, (_, i) => [
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
const define_entries = (object: any, entries: Entries, enumerable: boolean): any => {
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
	const entries = (list: Entries): string =>
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
	const literal = (list: Entries, symbol: DifferentialInput | null = null): string =>
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

const error_line = (error: unknown): string =>
	String((error as Error | undefined)?.message).split('\n')[0]!;

const run_lib = (
	name: ConformanceLibName,
	spec: DifferentialSpec,
	input: DifferentialInput
): DifferentialResult => {
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
		return failed('refused: ' + error_line(error));
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
		return failed('throws: ' + error_line(error));
	}
};

/** Runs a case through the three libraries, each on an input of its own. */
export const run_differential_case = (
	spec: DifferentialSpec,
	input: DifferentialInput
): DifferentialResults =>
	Object.fromEntries(LIB_NAMES.map((name) => [name, run_lib(name, spec, input)])) as any;

const is_object = (value: unknown): value is object => typeof value === 'object' && value !== null;

// every object reachable from `value` through its own keys and its
// prototypes, so an object read through a prototype is the input's too
const collect_input_objects = (value: unknown, found: Set<object> = new Set()): Set<object> => {
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

const is_index = (key: PropertyKey): boolean => typeof key === 'string' && /^\d+$/.test(key);

//
// Rules
//

export type DifferentialRuleName =
	| 'check_missing_key'
	| 'check_after_keyed_option'
	| 'transform_missing_key'
	| 'record_own_proto'
	| 'prototype_ignored'
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
	row: string;
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
			'a missing key of an entry that reaches a `check` as the entry itself is given an own `undefined`, where no strict option of a union beside it takes the key as unknown, and ours does the same apart from the key: what it left out of its output, the rewritten input leaves `undefined`, and what it wrote, the same'
	},
	{
		name: 'check_after_keyed_option',
		row: 'union[unknown then a transform to null, check] entry, key missing / *',
		kind: 'rewrite',
		summary:
			'where an option of a `union` before one that reaches a `check` takes the key `check_missing_key` gives, the options before it are dropped, where ours does the same on the input without them, and the guard of `check_missing_key` holds there'
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
			'an own `__proto__` key of a `record` input is taken out, where that changes nothing zod and valibot do, and ours does the same apart from the key and keeps no own `__proto__` key where it held one: it failed at the key as it does at the key renamed, or at a `union` the key is in, with `union_own_path`, and a step after the record that the failure stopped fails without the key, with `pipe_stops`. Or, where ours does on the input what it does with the key renamed, so a `union` it fails in goes on to a later option, the key is renamed for all three, where zod and valibot leave the renamed key out, or keep it where ours keeps the key, with `loose_own_proto`'
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
			'where zod and valibot disagree once `check_missing_key` gives the key, or `prototype_ignored` takes the prototype away, exactly one entry of `SPLIT_RECOGNIZERS` recognizes the disagreement as that of its `SIDES` row, and ours is the result of the side the row names, with the other relaxations'
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
	}
];

/** Rows of declared differences that no rule is for, each with why. */
export const DIFFERENTIAL_UNRULED: Record<string, string> = {
	'default of an array, the one given':
		'which value a default is, the one given or a copy, is the same text: the comparison sees no difference, and the generated defaults are primitives',
	'entry named __proto__, own / *': 'the generator names no entry `__proto__`'
};

const ALL_RULES: ReadonlySet<DifferentialRuleName> = new Set(
	DIFFERENTIAL_RULES.map((rule) => rule.name)
);

const PIPE_STEPS: ReadonlySet<string> = new Set([
	'refine',
	'map',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
]);
const LENGTH_AND_VALUE_STEPS: ReadonlySet<string> = new Set([
	'refine',
	'min_length',
	'max_length',
	'min_value',
	'max_value',
	'regex'
]);
const WRAPPERS: ReadonlySet<string> = new Set([
	'optional',
	'nullable',
	'lazy',
	'message',
	'default',
	'default_fn',
	...PIPE_STEPS
]);

const unwrap_messages = (spec: DifferentialSpec): DifferentialSpec =>
	spec.t === 'message' ? unwrap_messages(spec.of) : spec;

// a `check` that is the entry itself, or that another schema holds as one:
// under a `nullable`, a `lazy`, or a `message`, as an option of a `union`, or
// at the start of a `pipe`
const reaches_check = (spec: DifferentialSpec): boolean => {
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

// a `transform` that is the entry itself, or under a `message`
const is_bare_transform = (spec: DifferentialSpec): boolean =>
	unwrap_messages(spec).t === 'transform';

// the schemas a value is shaped by, past every wrapper: the objects, records
// and arrays, every option of a union and of a variant
const structures = (
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

// the schemas of the entry or item `key` of each structure
const entry_specs = (
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

type Path = ReadonlyArray<PropertyKey>;

type RewriteAt = (spec: DifferentialSpec, input: ObjectInput, path: Path) => ObjectInput;

/** What a rewrite makes of an array input given to an object or a `record`, before its keys are visited. */
type RewriteArray = (
	spec: DifferentialSpec,
	input: DifferentialInput & { t: 'arr' },
	path: Path
) => DifferentialInput;

// `at` applied to each object input, the structure it is at, and its path,
// children first: through the option of a variant the input names, and
// through every option of a union. The input is returned as it is where
// nothing changed
const rewrite_input = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	at: RewriteAt,
	path: Path = [],
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
	path: Path,
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
	const map = (list: Entries): Entries =>
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
interface Rewritten {
	input: DifferentialInput;
	touched: Array<Path>;
}

// each missing key of an entry that `needs` names given an own `undefined`,
// but where a `strict_object` the same input is given to, as an option of a
// `union`, doesn't name the key, which would make it fail there
const rewrite_missing_keys = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	needs: (entry: DifferentialSpec) => boolean,
	/** Only the keys of the structure visited at this count, from `0`, where given. */
	only: number | null = null
): Rewritten & { visits: number } => {
	const strict: Map<string, Array<DifferentialObjectSpec>> = new Map();
	rewrite_input(spec, input, (p, object, path) => {
		if (p.t === 'object' && p.flavor === 'strict') {
			const text = path_text(path);
			strict.set(text, [...(strict.get(text) ?? []), p]);
		}
		return object;
	});
	const touched: Array<Path> = [];
	let visits = 0;
	const next = rewrite_input(spec, input, (p, object, path) => {
		if (p.t !== 'object' && p.t !== 'rest') return object;
		const visit = visits++;
		if (only !== null && visit !== only) return object;
		const beside = strict.get(path_text(path)) ?? [];
		const missing = p.entries.filter(
			([key, e]) =>
				needs(e) && !has_key(object, key) && beside.every((o) => o.entries.some(([k]) => k === key))
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

// what an own `__proto__` key of a `record` input is renamed to, a key the
// generator never makes
const RENAMED_PROTO = 'renamed__proto__';

// each own `__proto__` key of a `record` input taken out, or renamed to `to`
const rewrite_record_proto = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	to: string | null = null
): Rewritten => {
	const touched: Array<Path> = [];
	const next = rewrite_input(spec, input, (p, object, path) => {
		if (
			p.t !== 'record' ||
			![...object.own, ...object.hidden].some(([key]) => key === '__proto__')
		) {
			return object;
		}
		touched.push([...path, '__proto__']);
		const change = (list: Entries): Entries =>
			to === null
				? list.filter(([key]) => key !== '__proto__')
				: list.map(([key, value]) => [key === '__proto__' ? to : key, value]);
		return { ...object, own: change(object.own), hidden: change(object.hidden) };
	});
	return { input: next, touched };
};

// whether `prefix` starts `path`, an index the same as the string of its digits
const starts_path = (path: Path, prefix: Path): boolean =>
	prefix.length <= path.length && prefix.every((key, i) => String(key) === String(path[i]));

// whether ours' output, where it is one, holds no own `__proto__` key beside
// each key at `touched`
const holds_no_proto = (ours: DifferentialResult, touched: Array<Path>): boolean =>
	!ours.parsed?.ok ||
	touched.every((t) => {
		const holder = value_at(ours.value, t.slice(0, -1));
		return !is_object(holder) || !Object.hasOwn(holder, '__proto__');
	});

// a copy of `value` without the keys at `touched`, every key's enumerability
// and the prototypes kept, so `render_value` writes it as it does the value
const without_touched = (value: unknown, touched: Array<Path>, path: Path = []): unknown => {
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
interface AboveTaken {
	/** On the input, where the key failed what holds it. */
	ours: (path: Path) => boolean;
	/** On the rewritten input, where the key's failure had stopped it. */
	rewritten: (path: Path) => boolean;
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
const same_apart = (
	ours: DifferentialResult,
	rewritten: DifferentialResult,
	touched: Array<Path>,
	above: AboveTaken | null = null
): boolean => {
	if (!ours.parsed || !rewritten.parsed) return false;
	if (ours.parsed.ok && rewritten.parsed.ok) {
		return (
			render_value(without_touched(ours.value, touched)) ===
			render_value(without_touched(rewritten.value, touched))
		);
	}
	const rest = (parsed: ConformanceParsed, excused: (path: Path) => boolean): string => {
		if (parsed.ok) return 'ok';
		const apart = (path: Path): boolean =>
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

// whether ours on an input given the keys at `touched` gave each what it gave
// it missing: the same value where its output has the key, and `undefined`
// where it left the key out
const same_given_keys = (
	ours: DifferentialResult,
	given: DifferentialResult,
	touched: Array<Path>
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

// whether the issues of ours at, under, or above the keys at `touched` are
// those it has with each key renamed, the renamed key read as the key
const same_issues_renamed = (
	ours: DifferentialResult,
	renamed: DifferentialResult,
	touched: Array<Path>,
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

// theirs on an input with a key renamed, as on the input but for reading the
// key as they read any key: the renamed key at each of `to` taken out of a
// value, and a path through it given the key's name
const unrename = (result: DifferentialResult, to: Array<Path>): DifferentialResult => {
	if (!result.parsed) return result;
	const parsed: ConformanceParsed = result.parsed.ok
		? { ok: true, value: without_touched(result.parsed.value, to) }
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

// each `union` with the options before the first that reaches a `check`, or
// is an object with an entry that does, dropped, the same spec where none is
const drop_before_check = (spec: DifferentialSpec): DifferentialSpec => {
	const mapped = map_spec_children(spec, drop_before_check);
	if (mapped.t !== 'union') return mapped;
	const i = mapped.of.findIndex(
		(o) =>
			reaches_check(o) ||
			((o.t === 'object' || o.t === 'rest') && o.entries.some(([, e]) => reaches_check(e)))
	);
	return i > 0 ? { t: 'union', of: mapped.of.slice(i) } : mapped;
};

// `spec` with `fn` of each child, itself where none changed
const map_spec_children = (
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

//
// Comparing
//

interface CompareEnv {
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
	inherited: 'prototype_taken' | 'neither_inherited' | null;
}

// a key theirs writes as `undefined` that ours leaves out, as a rule allows
const is_left_out = (
	positions: Array<DifferentialSpec>,
	key: PropertyKey,
	ours: object,
	theirs: object,
	env: CompareEnv
): boolean =>
	Object.hasOwn(theirs, key) &&
	(theirs as any)[key] === undefined &&
	!(key in ours) &&
	entry_specs(positions, key).some(
		(e) =>
			(env.rules.has('pipe_default_left_out') && is_pipe_from_default(e)) ||
			(env.rules.has('default_fn_left_out') && is_default_fn(e))
	);

const same_value = (
	positions: Array<DifferentialSpec>,
	ours: unknown,
	theirs: unknown,
	env: CompareEnv
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
	env: CompareEnv
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

// where a path goes in a schema, the input's value along it picking a
// variant's option: the depth of the first union it reaches, if any, and the
// schemas at that depth, or at its end
const walk_path = (
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

const value_at = (value: unknown, path: Path): unknown =>
	path.reduce((v: unknown, key) => (is_object(v) ? (v as any)[key] : undefined), value);

// `fn` of each object in `value` and the structures it is at, through its own
// enumerable keys
const visit_objects = (
	positions: Array<DifferentialSpec>,
	value: unknown,
	path: Path,
	fn: (positions: Array<DifferentialSpec>, object: object, path: Path) => void
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

// what `lib` gives for `value` by `spec` alone, `null` where it throws
const parse_alone = (
	lib: ConformanceLibName,
	spec: DifferentialSpec,
	value: unknown
): ConformanceParsed | null => {
	const l = CONFORMANCE_LIBS[lib];
	try {
		return l.parse(build_spec(spec, l), value);
	} catch {
		return null;
	}
};

const path_text = (path: ReadonlyArray<PropertyKey>): string =>
	path.map((key) => (typeof key === 'number' ? `[${key}]` : String(key))).join('.') || '<root>';

const UNION_OWN_PATH: ReadonlySet<DifferentialRuleName> = new Set(['union_own_path']);

/** A failure, its paths under those of a part. */
interface PartFailure {
	ok: false;
	paths: Array<Path>;
	unknown_keys: Array<Path>;
}

// what `lib` gives a part of the input alone, by the schema at it, a failure's
// paths put under `at`, the part's path, and a union's issue at its own path,
// as ours reports it. `null` where it throws
const part_verdict = (
	lib: ConformanceLibName,
	part: DifferentialSpec,
	value: unknown,
	at: Path
): { ok: true } | PartFailure | null => {
	const parsed = parse_alone(lib, part, value);
	if (!parsed || parsed.ok) return parsed && { ok: true };
	const relaxed = relax_paths(part, parsed, value, null, UNION_OWN_PATH) as typeof parsed;
	return {
		ok: false,
		paths: relaxed.paths.map((p) => [...at, ...p]),
		unknown_keys: relaxed.unknown_keys.map((p) => [...at, ...p])
	};
};

// theirs' paths of a failure, as the rules count them, of an input whose
// recipe is given where a rule reads a part of it
const relax_paths = (
	spec: DifferentialSpec,
	parsed: ConformanceParsed & { ok: false },
	input: unknown,
	recipe: DifferentialInput | null,
	rules: ReadonlySet<DifferentialRuleName>
): ConformanceParsed => {
	let paths = parsed.paths;
	let unknown_keys = parsed.unknown_keys;
	if (rules.has('union_own_path')) {
		const at_union = (path: ReadonlyArray<PropertyKey>): ReadonlyArray<PropertyKey> | null => {
			const { union_at } = walk_path(spec, path, input);
			return union_at === null ? null : path.slice(0, union_at);
		};
		const moved = unknown_keys.map(at_union);
		paths = [
			...paths.map((path) => at_union(path) ?? path),
			...moved.filter((path): path is ReadonlyArray<PropertyKey> => path !== null)
		];
		unknown_keys = unknown_keys.filter((_, i) => moved[i] === null);
	}
	if (rules.has('too_long_zod_items')) {
		const moved: Array<Path> = [];
		paths = paths.flatMap((path) => {
			const { union_at, chain } = walk_path(spec, path, input);
			const value = value_at(input, path);
			const step =
				union_at === null && Array.isArray(value)
					? chain.find((c) => c.t === 'max_length' && c.of.t === 'array' && value.length > c.n)
					: undefined;
			if (!step) return [path];
			// the array alone, without the length check: zod's issues of its items,
			// where valibot takes them all
			const array = (step as { of: DifferentialSpec }).of;
			const zod_items = part_verdict('zod', array, value, path);
			if (!zod_items || zod_items.ok || !parse_alone('valibot', array, value)?.ok) return [path];
			moved.push(...zod_items.unknown_keys);
			// but at a symbol key, which ours takes, as valibot does, and at a part
			// valibot disagrees on, the issues of the side the table names
			return zod_items.paths
				.filter((at) => typeof at.at(-1) !== 'symbol')
				.flatMap((at) => split_part_paths(spec, input, recipe, at) ?? [at]);
		});
		unknown_keys = [...unknown_keys, ...moved];
	}
	if (rules.has('constructor_valibot_verdict')) {
		const read: Array<Path> = [];
		const read_unknown: Array<Path> = [];
		visit_objects(structures(spec), input, [], (positions, object, path) => {
			if (!positions.some((p) => p.t === 'rest' || p.t === 'record')) return;
			for (const key of ['constructor', 'prototype']) {
				if (!Object.hasOwn(object, key)) continue;
				const named = positions.some(
					(p) => (p.t === 'object' || p.t === 'rest') && p.entries.some(([k]) => k === key)
				);
				if (named) continue;
				const at = [...path, key];
				const { union_at } = walk_path(spec, at, input);
				if (union_at !== null && union_at < at.length) continue;
				// zod reads the key and takes its value, and valibot, given the value,
				// refuses it, as ours does: ours has valibot's issues there
				const value = (object as any)[key];
				for (const e of entry_specs(positions, key)) {
					if (!parse_alone('zod', e, value)?.ok) continue;
					const by_valibot = part_verdict('valibot', e, value, at);
					const by_ours = part_verdict('fuz_schema', e, value, at);
					if (!by_valibot || by_valibot.ok || !by_ours || by_ours.ok) continue;
					if (render_parsed(by_ours) !== render_parsed(by_valibot)) continue;
					read.push(...by_valibot.paths);
					read_unknown.push(...by_valibot.unknown_keys);
					break;
				}
			}
		});
		paths = [...paths, ...read];
		unknown_keys = [...unknown_keys, ...read_unknown];
	}
	if (rules.has('union_options_split') && recipe) {
		const texts = new Set(paths.map(path_text));
		for (const path of split_union_paths(spec, input, recipe)) {
			if (!texts.has(path_text(path))) paths = [...paths, path];
		}
	}
	if (rules.has('pipe_stops')) {
		const all = [...paths, ...unknown_keys].map(path_text);
		paths = paths.filter((path) => {
			const text = path_text(path);
			const { union_at, chain } = walk_path(spec, path, input);
			const deeper = all.some(
				(other) =>
					other !== text &&
					(text === '<root>' || other.startsWith(text + '.') || other.startsWith(text + '.['))
			);
			return !(union_at === null && deeper && chain.some((c) => LENGTH_AND_VALUE_STEPS.has(c.t)));
		});
	}
	return { ok: false, paths, unknown_keys };
};

/** Whether ours is theirs, with the relaxations of `rules`. */
export const same_differential_result = (
	spec: DifferentialSpec,
	ours: DifferentialResult,
	theirs: DifferentialResult,
	rules: ReadonlySet<DifferentialRuleName>,
	inherited: CompareEnv['inherited'] = null
): boolean => {
	if (ours.text === theirs.text) return true;
	if (!ours.parsed || !theirs.parsed || ours.ok !== theirs.ok) return false;
	if (!theirs.parsed.ok) {
		return (
			render_parsed(ours.parsed) ===
			render_parsed(relax_paths(spec, theirs.parsed, theirs.input, theirs.recipe, rules))
		);
	}
	return same_value(structures(spec), ours.value, theirs.value, {
		of_input: collect_input_objects(ours.input),
		of_their_input: collect_input_objects(theirs.input),
		rules,
		inherited
	});
};

//
// Splits
//

/**
 * A disagreement of zod and valibot that a row of `SIDES` records, told apart
 * where a rule brings one out: ours is held to the result of the row's side.
 */
export interface SplitRecognizer {
	/** The row of `SIDES`, whose side is read when a case is classified. */
	row: string;
	/** The row of `DIFFERENCES` that combines it with a declared one, a case of the matrix. */
	combination: string;
	/** Whether zod and valibot differ on a case only where the row's disagreement shows. */
	at: (
		spec: DifferentialSpec,
		input: DifferentialInput,
		zod: DifferentialResult,
		valibot: DifferentialResult
	) => boolean;
	/** Of a `neither` row, the result ours is held to, as the row says. */
	neither?: (spec: DifferentialSpec, input: DifferentialInput) => DifferentialResult;
	/** Of a `neither` row, whether an input that came back still inherits the keys, as the row says. */
	inherited?: boolean;
}

const is_loose_or_rest = (p: DifferentialSpec): boolean =>
	(p.t === 'object' && p.flavor === 'loose') || p.t === 'rest';

const is_default = (spec: DifferentialSpec): boolean =>
	spec.t === 'default' || spec.t === 'default_fn';

// whether zod and valibot both give `to` on a case with the trigger of a row
// taken away: the result of the one that doesn't see the trigger, so the
// disagreement was the trigger's alone
const both_give = (
	to: DifferentialResult,
	spec: DifferentialSpec,
	input: DifferentialInput
): boolean =>
	run_lib('zod', spec, input).text === to.text && run_lib('valibot', spec, input).text === to.text;

// `spec` with `fn` of each node, children first, where it gives one
const map_spec = (
	spec: DifferentialSpec,
	fn: (spec: DifferentialSpec) => DifferentialSpec | null
): DifferentialSpec => {
	const mapped = map_spec_children(spec, (child) => map_spec(child, fn));
	return fn(mapped) ?? mapped;
};

// each own key named `constructor` or `prototype` of an input given to a
// `loose_object` or an `object_with_rest` that doesn't name it, or to a
// `record`, taken out
const without_own_named = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	records: boolean
): DifferentialInput =>
	rewrite_input(spec, input, (p, object) => {
		if (records ? p.t !== 'record' : !is_loose_or_rest(p)) return object;
		const own = object.own.filter(
			([key]) => !((key === 'constructor' || key === 'prototype') && !names_entry(p, key))
		);
		return own.length < object.own.length ? { ...object, own } : object;
	});

// each key an input given to a `loose_object` or an `object_with_rest`
// inherits and the schema doesn't name taken out
const without_inherited = (spec: DifferentialSpec, input: DifferentialInput): DifferentialInput =>
	rewrite_input(spec, input, (p, object) => {
		if (!is_loose_or_rest(p) || object.base !== 'plain') return object;
		const proto = object.proto.filter(
			([key]) => names_entry(p, key) || object.own.some(([k]) => k === key)
		);
		return proto.length < object.proto.length ? { ...object, proto } : object;
	});

// the default of a schema, under its messages, taken out
const without_default = (spec: DifferentialSpec): DifferentialSpec =>
	spec.t === 'message'
		? { ...spec, of: without_default(spec.of) }
		: is_default(spec)
			? (spec as { of: DifferentialSpec }).of
			: spec;

// each default of a value but `undefined` made to take its value as it is,
// as zod does, by a `one_of` of it before its schema
const without_default_as_is = (spec: DifferentialSpec): DifferentialSpec =>
	map_spec(spec, (s) =>
		(s.t === 'default' || s.t === 'default_fn') && s.v !== undefined
			? { ...s, of: { t: 'union', of: [{ t: 'one_of', vs: [s.v] }, s.of] } }
			: null
	);

// each `with_default` of `undefined` an `optional`, as valibot reads it
const without_default_of_undefined = (spec: DifferentialSpec): DifferentialSpec =>
	map_spec(spec, (s) =>
		s.t === 'default' && s.v === undefined ? { t: 'optional', of: s.of } : null
	);

// the length of a string in code points, as zod's `max_length` counts it
const code_points = (value: string): number =>
	value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;

// whether a value has a key at `path`, own or inherited
const has_path = (value: unknown, path: Path): boolean => {
	const holder = value_at(value, path.slice(0, -1));
	const key = path.at(-1);
	return is_object(holder) && key !== undefined && key in holder;
};

// the paths at which two values differ, as `render_value` writes them: a key
// one has and the other not, or a value not the same
const differing_paths = (
	a: unknown,
	b: unknown,
	path: Path = [],
	out: Array<Path> = []
): Array<Path> => {
	if (
		!is_object(a) ||
		!is_object(b) ||
		Array.isArray(a) !== Array.isArray(b) ||
		render_shape(a) !== render_shape(b)
	) {
		if (render_value(a) !== render_value(b)) out.push(path);
		return out;
	}
	for (const key of new Set([...Reflect.ownKeys(a), ...Reflect.ownKeys(b)])) {
		if (key === 'length' && Array.isArray(a)) continue;
		const at = [...path, Array.isArray(a) && is_index(key) ? Number(key) : key];
		if (Object.hasOwn(a, key) !== Object.hasOwn(b, key)) out.push(at);
		else differing_paths((a as any)[key], (b as any)[key], at, out);
	}
	return out;
};

// whether zod and valibot both took the case and differ at some path, and at
// each the input, both outputs, and the schemas at it are as `holds` says
const differs_only_at = (
	spec: DifferentialSpec,
	zod: DifferentialResult,
	valibot: DifferentialResult,
	holds: (at: {
		path: Path;
		input: unknown;
		zod: unknown;
		valibot: unknown;
		/** Whether the input, zod's output, and valibot's have the key, own or inherited. */
		has: { input: boolean; zod: boolean; valibot: boolean };
		chain: Array<DifferentialSpec>;
	}) => boolean
): boolean => {
	if (!zod.ok || !valibot.ok) return false;
	const paths = differing_paths(zod.value, valibot.value);
	return (
		paths.length > 0 &&
		paths.every((path) => {
			if (!path.length) return false;
			const { union_at, chain } = walk_path(spec, path, zod.input);
			if (union_at !== null) return false;
			return holds({
				path,
				input: value_at(zod.input, path),
				zod: value_at(zod.value, path),
				valibot: value_at(valibot.value, path),
				has: {
					input: has_path(zod.input, path),
					zod: has_path(zod.value, path),
					valibot: has_path(valibot.value, path)
				},
				chain
			});
		})
	);
};

// the value of the default a pipe starts with, where it does
const pipe_default = (spec: DifferentialSpec): DifferentialSpec | null => {
	let head = unwrap_messages(spec);
	if (!PIPE_STEPS.has(head.t)) return null;
	while (PIPE_STEPS.has(head.t)) head = unwrap_messages((head as { of: DifferentialSpec }).of);
	return is_default(head) ? head : null;
};

const RECOGNIZERS: Array<SplitRecognizer> = [
	// an own key named `constructor` or `prototype` an object doesn't name:
	// zod validates it and keeps it, valibot leaves it out unread
	{
		row: 'unknown key named constructor / loose',
		combination: 'loose, a bare check entry, key missing, an unknown key named constructor',
		at: (spec, input, _zod, valibot) => {
			const without = without_own_named(spec, input, false);
			return without !== input && both_give(valibot, spec, without);
		}
	},
	{
		row: 'record, own key named prototype, wrong',
		combination: 'a check after a record, class instance, own key named prototype, wrong',
		at: (spec, input, _zod, valibot) => {
			const without = without_own_named(spec, input, true);
			return without !== input && both_give(valibot, spec, without);
		}
	},
	// an enumerable key the input inherits that an object doesn't name: zod
	// copies it, valibot drops it, and an input that comes back still inherits
	// it
	{
		row: 'unknown inherited key / loose',
		combination: 'loose, a bare check entry, key missing, an unknown inherited key',
		at: (spec, input, _zod, valibot) => {
			const without = without_inherited(spec, input);
			return without !== input && both_give(valibot, spec, without);
		},
		neither: (spec, input) => run_lib('zod', spec, without_inherited(spec, input)),
		inherited: true
	},
	// a default under an optional: zod fills it in
	{
		row: 'optional(default) entry, key undefined / *',
		combination: 'a bare check entry and an optional(default) entry, keys missing',
		at: (spec, input, _zod, valibot) => {
			const without = map_spec(spec, (s) =>
				s.t === 'optional' && is_default(unwrap_messages(s.of))
					? { ...s, of: without_default(s.of) }
					: null
			);
			return without !== spec && both_give(valibot, without, input);
		}
	},
	// a default of `undefined`: zod writes the missing key
	{
		row: 'default of undefined entry, key missing / *',
		combination: 'a bare check entry and a default of undefined entry, keys missing',
		at: (spec, input, _zod, valibot) => {
			const without = without_default_of_undefined(spec);
			return without !== spec && both_give(valibot, without, input);
		}
	},
	// a value given to a default whose schema gives `undefined`: zod fills the
	// default in
	{
		row: 'a default of a transform to undefined then a check, a value given',
		combination:
			'a bare check entry, key missing, and a default of a transform to undefined entry, a value given',
		at: (spec, _input, zod, valibot) =>
			differs_only_at(
				spec,
				zod,
				valibot,
				(at) =>
					at.has.input &&
					at.input !== undefined &&
					at.has.valibot &&
					at.valibot === undefined &&
					at.chain.some(
						(c) => is_default(c) && render_value((c as { v: unknown }).v) === render_value(at.zod)
					)
			)
	},
	// a default zod fills in as it is, and valibot runs through its schema
	{
		row: 'default of a wrong value entry, key missing / *',
		combination: 'a bare check entry and a default of a transform to undefined entry, keys missing',
		at: (spec, input, zod) => {
			const without = without_default_as_is(spec);
			return without !== spec && both_give(zod, without, input);
		}
	},
	// a pipe from a default of `undefined`, its key missing: zod runs its steps
	// and writes the key, valibot leaves it out
	{
		row: 'default of undefined then a transform to "T" entry, key missing / *',
		combination:
			'a bare check entry and a default of undefined then a transform to "T" entry, keys missing',
		at: (spec, _input, zod, valibot) =>
			differs_only_at(spec, zod, valibot, (at) => {
				const head = at.chain[0] ? pipe_default(at.chain[0]) : null;
				return (
					!at.has.input &&
					at.has.zod &&
					!at.has.valibot &&
					head !== null &&
					(head as { v: unknown }).v === undefined
				);
			})
	},
	// a bare transform, its key missing: zod runs it, valibot needs the key
	{
		row: 'bare transform to "T" entry, key missing / *',
		combination: 'union[string, object of a bare check and a bare transform], keys missing',
		at: (spec, input, zod) => {
			// valibot given the keys writes those zod leaves out as `undefined`
			const { input: given, touched } = rewrite_missing_keys(spec, input, is_bare_transform);
			if (given === input) return false;
			const valibot = run_lib('valibot', spec, given);
			if (valibot.text === zod.text) return true;
			const left_out = touched.filter(
				(t) => value_at(valibot.value, t) === undefined && !has_path(zod.value, t)
			);
			return (
				zod.ok &&
				valibot.ok &&
				render_value(without_touched(valibot.value, left_out)) === render_value(zod.value)
			);
		}
	},
	// a check after an object with an unknown key: zod runs it, valibot stops
	{
		row: 'a check after an object with an unknown key',
		combination: 'a check after a strict object of a bare check entry, key missing, an unknown key',
		at: (spec, input, _zod, valibot) => {
			if (valibot.parsed?.ok !== false || !valibot.parsed.unknown_keys.length) return false;
			const without = map_spec(spec, (s) =>
				LENGTH_AND_VALUE_STEPS.has(s.t) && structures((s as { of: DifferentialSpec }).of).length
					? (s as { of: DifferentialSpec }).of
					: null
			);
			return without !== spec && both_give(valibot, without, input);
		}
	},
	// a default zod fills in as it is and valibot runs through its schema, and
	// an own key named `constructor` or `prototype` zod keeps and valibot drops
	{
		row: 'loose, a default of a transform, an unknown key named constructor',
		combination:
			'loose, a bare check entry, key missing, a default of a transform, an unknown key named constructor',
		at: (spec, input, zod, valibot) => {
			const spec_without = without_default_as_is(spec);
			const input_without = without_own_named(spec, input, false);
			if (spec_without === spec || input_without === input) return false;
			// each library sees its trigger and not the other's, and they agree
			// without both
			return (
				run_lib('zod', spec_without, input).text === zod.text &&
				run_lib('zod', spec, input_without).text !== zod.text &&
				run_lib('valibot', spec, input_without).text === valibot.text &&
				run_lib('valibot', spec_without, input).text !== valibot.text &&
				run_lib('zod', spec_without, input_without).text ===
					run_lib('valibot', spec_without, input_without).text
			);
		}
	},
	// a default of `undefined` zod writes the missing key of, and an own key
	// named `constructor` or `prototype` zod keeps, which valibot leaves out
	// both: ours goes with zod on the key, and with valibot on the default
	{
		row: 'loose, a default of undefined, an unknown key named constructor',
		combination:
			'loose, a bare check entry, key missing, a default of undefined, an unknown key named constructor',
		at: (spec, input, _zod, valibot) => {
			const spec_without = without_default_of_undefined(spec);
			const input_without = without_own_named(spec, input, false);
			return (
				spec_without !== spec &&
				input_without !== input &&
				!both_give(valibot, spec_without, input) &&
				!both_give(valibot, spec, input_without) &&
				both_give(valibot, spec_without, input_without)
			);
		},
		neither: (spec, input) => run_lib('zod', without_default_of_undefined(spec), input)
	},
	// a length check after an array too long whose item fails: zod reports the
	// length, valibot the item
	{
		row: 'a max_length after an array too long, an item wrong',
		combination:
			'a max_length after an array too long, an item with an own key named prototype, a max_length after an array too long, an item wrong',
		at: (spec, input, _zod, valibot) => {
			const without = map_spec(spec, (s) =>
				s.t === 'max_length' && s.of.t === 'array' ? s.of : null
			);
			return without !== spec && both_give(valibot, without, input);
		}
	},
	// the length of a string with a surrogate pair: valibot counts code units
	{
		row: 'max_length, a string of a surrogate pair',
		combination:
			'union[array(max_length(string, 1)), record(string)] entry, an array of a surrogate pair, beside a key missing',
		at: (spec, _input, zod, valibot) =>
			zod.ok &&
			!valibot.ok &&
			!!valibot.parsed &&
			!valibot.parsed.ok &&
			!valibot.parsed.unknown_keys.length &&
			valibot.parsed.paths.every((path) => {
				const value = value_at(valibot.input, path);
				const { union_at, chain } = walk_path(spec, path, valibot.input);
				return (
					union_at === null &&
					typeof value === 'string' &&
					chain.some((c) => c.t === 'max_length' && code_points(value) <= c.n && value.length > c.n)
				);
			})
	},
	// an array given to a record: valibot takes it as an object
	{
		row: 'record, array',
		combination:
			'union[array(max_length(string, 1)), record(string)] entry, an array of a surrogate pair, beside a key missing',
		at: (spec, input, _zod, valibot) => {
			const without = rewrite_input(
				spec,
				input,
				(_, object) => object,
				[],
				(p, array) =>
					p.t === 'record'
						? {
								t: 'obj',
								own: [
									...array.items.flatMap((item, i): Entries => (item ? [[String(i), item]] : [])),
									...array.extra
								],
								base: 'plain',
								proto: [],
								hidden: [],
								symbol: null,
								frozen: false
							}
						: array
			);
			return without !== input && both_give(valibot, spec, without);
		}
	}
];

/**
 * The disagreements of zod and valibot the differential tells apart, each
 * by its row of `SIDES`. Where a rule brings one out, exactly one must
 * recognize it, and ours is held to the result of its row's side.
 */
export const SPLIT_RECOGNIZERS: ReadonlyArray<SplitRecognizer> = Object.freeze(RECOGNIZERS);

// the result ours is held to where zod and valibot disagree on a case: that
// of the side of the one entry of `SPLIT_RECOGNIZERS` that recognizes it,
// `null` where none does, or more than one
const split_side = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	zod: DifferentialResult,
	valibot: DifferentialResult
): { result: DifferentialResult; inherited: CompareEnv['inherited'] } | null => {
	const found = SPLIT_RECOGNIZERS.filter((entry) => entry.at(spec, input, zod, valibot));
	if (found.length !== 1) return null;
	const entry = found[0]!;
	switch (SIDES[entry.row]?.side) {
		case 'zod':
			return { result: zod, inherited: null };
		case 'valibot':
			return { result: valibot, inherited: null };
		case 'neither':
			return entry.neither
				? {
						result: entry.neither(spec, input),
						inherited: entry.inherited ? 'neither_inherited' : null
					}
				: null;
		default:
			return null;
	}
};

// the recipe of the part of an input at `path`, read as the input is: an own
// key, a hidden one, then one it inherits
const input_at = (input: DifferentialInput, path: Path): DifferentialInput | null => {
	let at: DifferentialInput | null = input;
	for (const key of path) {
		if (!at) return null;
		if (at.t === 'v') {
			at = is_object(at.v) ? value_in((at.v as any)[key]) : null;
		} else if (at.t === 'arr') {
			at = is_index(String(key))
				? (at.items[Number(key)] ?? null)
				: (at.extra.find(([k]) => k === key)?.[1] ?? null);
		} else {
			const found: [string, DifferentialInput] | undefined = [
				...at.own,
				...at.hidden,
				...(at.base === 'plain' ? at.proto : [])
			].find(([k]) => k === key);
			at = typeof key === 'symbol' ? at.symbol : (found?.[1] ?? null);
		}
	}
	return at;
};

// where zod's issue at `path` is at a part valibot disagrees on, the issues
// of the side the table names, under the path, `null` where it isn't
const split_part_paths = (
	spec: DifferentialSpec,
	input: unknown,
	recipe: DifferentialInput | null,
	path: Path
): Array<Path> | null => {
	const part_recipe = recipe && input_at(recipe, path);
	const { union_at, chain } = walk_path(spec, path, input);
	const part = chain[0];
	if (!part_recipe || !part || union_at !== null) return null;
	const zod = run_lib('zod', part, part_recipe);
	const valibot = run_lib('valibot', part, part_recipe);
	if (zod.text === valibot.text || !zod.parsed || !valibot.parsed) return null;
	const side = split_side(part, part_recipe, zod, valibot);
	const parsed = side?.result.parsed;
	if (!parsed || parsed.ok) return null;
	const relaxed = relax_paths(part, parsed, side.result.input, null, UNION_OWN_PATH);
	if (relaxed.ok || relaxed.unknown_keys.length) return null;
	return relaxed.paths.map((p) => [...path, ...p]);
};

// the paths of the unions zod and valibot both take by different options,
// where ours refuses each option as the side of their disagreement on it
// that the table names
const split_union_paths = (
	spec: DifferentialSpec,
	input: unknown,
	recipe: DifferentialInput
): Array<Path> => {
	const found: Array<Path> = [];
	const consider = (path: Path): void => {
		const { union_at, chain } = walk_path(spec, path, input);
		const union = chain.at(-1);
		const part_recipe = input_at(recipe, path);
		if (union_at !== path.length || union?.t !== 'union' || !part_recipe) return;
		const value = value_at(input, path);
		if (
			!parse_alone('zod', union, value)?.ok ||
			!parse_alone('valibot', union, value)?.ok ||
			parse_alone('fuz_schema', union, value)?.ok !== false
		) {
			return;
		}
		const refused = union.of.every((option) => {
			const zod = run_lib('zod', option, part_recipe);
			const valibot = run_lib('valibot', option, part_recipe);
			if (zod.ok === valibot.ok) return false;
			const side = split_side(option, part_recipe, zod, valibot);
			return side !== null && !side.result.ok && !run_lib('fuz_schema', option, part_recipe).ok;
		});
		if (refused) found.push(path);
	};
	consider([]);
	visit_objects(structures(spec), input, [], (_, object, path) => {
		for (const key of Object.keys(object)) {
			consider([...path, Array.isArray(object) ? Number(key) : key]);
		}
	});
	return found;
};

const NO_RULES: ReadonlySet<DifferentialRuleName> = new Set();

const RELAXATIONS: ReadonlySet<DifferentialRuleName> = new Set(
	DIFFERENTIAL_RULES.filter((rule) => rule.kind === 'relaxation').map((rule) => rule.name)
);

// each object input given to a `record`, an `object_with_rest`, or a
// `loose_object` that is of a class, or that inherits keys it doesn't name as
// entries, given the plain prototype and none of the keys it inherits but
// those, which ours reads through
const rewrite_prototypes = (spec: DifferentialSpec, input: DifferentialInput): DifferentialInput =>
	rewrite_input(spec, input, (p, object) => {
		if (p.t !== 'record' && p.t !== 'rest' && !(p.t === 'object' && p.flavor === 'loose')) {
			return object;
		}
		const proto = object.proto.filter(([key]) => names_entry(p, key));
		return object.base === 'class' || proto.length < object.proto.length
			? { ...object, base: 'plain', proto }
			: object;
	});

const names_entry = (p: DifferentialSpec, key: PropertyKey): boolean =>
	(p.t === 'object' || p.t === 'rest') && p.entries.some(([k]) => k === key);

// whether ours on a rewritten input did what it did on the input: the same
// failure, or values the same but for the keys taken away that an input
// that came back still inherits, and its prototype
const same_ours = (
	spec: DifferentialSpec,
	ours: DifferentialResult,
	rewritten: DifferentialResult,
	rules: ReadonlySet<DifferentialRuleName>
): boolean => {
	if (!ours.parsed || !rewritten.parsed || ours.ok !== rewritten.ok) return false;
	if (!ours.parsed.ok) return ours.text === rewritten.text;
	return same_value(structures(spec), ours.value, rewritten.value, {
		of_input: collect_input_objects(ours.input),
		of_their_input: collect_input_objects(rewritten.input),
		rules,
		inherited: 'prototype_taken'
	});
};

// whether the rules make the three agree. A rewrite is applied only where
// ours did on the rewritten input what it did on the input, apart from the
// keys the rewrite touched, so a rule credits nothing but what its row says
// ours does
const explain = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	results: DifferentialResults,
	rules: ReadonlySet<DifferentialRuleName>
): boolean => {
	let r = results;
	let current = input;
	let checked = false;
	let unprototyped = false;
	if (rules.has('prototype_ignored')) {
		const plain = rewrite_prototypes(spec, current);
		if (plain !== current) {
			const r2 = run_differential_case(spec, plain);
			// where ours did the same, and zod and valibot either did too, or now
			// disagree, which `split_on_a_side` is for
			const theirs_kept = r2.zod.text === r.zod.text && r2.valibot.text === r.valibot.text;
			if (
				(theirs_kept || r2.zod.text !== r2.valibot.text) &&
				same_ours(spec, r.fuz_schema, r2.fuz_schema, rules)
			) {
				current = plain;
				r = r2;
				unprototyped = true;
			}
		}
	}
	const keeps = (
		ours: DifferentialResult,
		given: DifferentialResult,
		touched: Array<Path>
	): boolean => same_apart(ours, given, touched) && same_given_keys(ours, given, touched);
	const give_keys = (
		needs: (entry: DifferentialSpec) => boolean,
		past_options = false
	): boolean => {
		const all = rewrite_missing_keys(spec, current, needs);
		if (all.input === current) return false;
		const kept = (next: Rewritten): boolean => {
			if (keeps(r.fuz_schema, run_lib('fuz_schema', spec, next.input), next.touched)) return true;
			// the options before the check, which ours did without on the input
			const dropped = past_options ? drop_before_check(spec) : spec;
			if (dropped === spec) return false;
			const ours = run_lib('fuz_schema', dropped, current);
			return (
				ours.text === r.fuz_schema.text &&
				keeps(ours, run_lib('fuz_schema', dropped, next.input), next.touched)
			);
		};
		let next: Rewritten | null = kept(all) ? all : null;
		// else the keys of one structure at a time, as where options of a union
		// the input is given to name different keys
		for (let i = 0; !next && i < all.visits; i++) {
			const one = rewrite_missing_keys(spec, current, needs, i);
			if (one.input !== current && kept(one)) next = one;
		}
		if (!next) return false;
		current = next.input;
		r = run_differential_case(spec, next.input);
		return true;
	};
	if (rules.has('check_missing_key')) {
		checked = give_keys(reaches_check, rules.has('check_after_keyed_option'));
	}
	// only where the check's key brought out their disagreement on a bare
	// transform's missing key
	if (checked && rules.has('transform_missing_key') && r.zod.text !== r.valibot.text) {
		give_keys(is_bare_transform);
	}
	if (rules.has('record_own_proto')) {
		const next = rewrite_record_proto(spec, current);
		if (next.input !== current) {
			const r2 = run_differential_case(spec, next.input);
			// a failure above the key only at a union, which reports one at its
			// path, with `union_own_path`, and one the rewritten input has above it only at a step the
			// key's failure stopped, where a pipe stops at its first failing step
			const above: AboveTaken = {
				ours: (path) =>
					rules.has('union_own_path') &&
					walk_path(spec, path, r.fuz_schema.input).union_at === path.length,
				rewritten: (path) => {
					if (!rules.has('pipe_stops')) return false;
					const { union_at, chain } = walk_path(spec, path, r2.fuz_schema.input);
					return union_at === null && chain.some((c) => LENGTH_AND_VALUE_STEPS.has(c.t));
				}
			};
			// only where zod and valibot dropped the key unread, and where ours
			// failed at the key as it does at the key renamed, so the value fails
			const renamed = rewrite_record_proto(spec, current, RENAMED_PROTO).input;
			const ours_renamed = run_lib('fuz_schema', spec, renamed);
			const unread = r2.zod.text === r.zod.text && r2.valibot.text === r.valibot.text;
			if (
				unread &&
				holds_no_proto(r.fuz_schema, next.touched) &&
				same_apart(r.fuz_schema, r2.fuz_schema, next.touched, above) &&
				same_issues_renamed(r.fuz_schema, ours_renamed, next.touched, '__proto__', RENAMED_PROTO)
			) {
				current = next.input;
				r = r2;
			} else if (
				unread &&
				ours_renamed.ok === r.fuz_schema.ok &&
				(ours_renamed.ok ||
					ours_renamed.text.replaceAll(RENAMED_PROTO, '__proto__') === r.fuz_schema.text)
			) {
				// ours did what it does with the key renamed, so a union it fails in
				// went on to a later option: theirs are of the key renamed, which
				// they read as they read any key, and without it
				const to = next.touched.map((t) => [...t.slice(0, -1), RENAMED_PROTO]);
				const r3 = run_differential_case(spec, renamed);
				// where theirs leave the renamed key out, as they do the key, or keep
				// it where ours keeps the key, which `loose_own_proto` is for
				const left_out = (result: DifferentialResult): boolean =>
					!result.ok ||
					to.every(
						(t) =>
							value_at(result.value, t) === undefined ||
							(rules.has('loose_own_proto') && !holds_no_proto(r.fuz_schema, [t]))
					);
				if (left_out(r3.zod) && left_out(r3.valibot)) {
					r = {
						zod: unrename(r3.zod, to),
						valibot: unrename(r3.valibot, to),
						fuz_schema: r.fuz_schema
					};
				}
			}
		}
	}
	if (!r.fuz_schema.parsed || !r.zod.parsed || !r.valibot.parsed) return false;
	if (r.zod.text !== r.valibot.text) {
		// a split the check's key brought out, or the prototype taken away, that
		// one entry of the table recognizes, on the side of whose row ours is
		if (!(checked || unprototyped) || !rules.has('split_on_a_side')) return false;
		const side = split_side(spec, current, r.zod, r.valibot);
		return (
			side !== null &&
			same_differential_result(spec, r.fuz_schema, side.result, rules, side.inherited)
		);
	}
	return same_differential_result(spec, r.fuz_schema, r.zod, rules);
};

//
// Classifying
//

export type DifferentialSide = 'zod' | 'valibot' | 'both' | 'neither';

export type DifferentialVerdict =
	| { kind: 'agree' }
	| { kind: 'declared'; rules: Array<DifferentialRuleName> }
	| { kind: 'undeclared' }
	| { kind: 'sides'; side: DifferentialSide }
	| { kind: 'refused' }
	| { kind: 'throws' };

/** What the three libraries did with a case, by the rule and the tables. */
export const classify_differential_case = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	results: DifferentialResults = run_differential_case(spec, input)
): DifferentialVerdict => {
	const { zod, valibot, fuz_schema: ours } = results;
	if (!ours.parsed) return { kind: 'throws' };
	if (!zod.parsed || !valibot.parsed) return { kind: 'refused' };
	if (zod.text !== valibot.text) {
		const is_zod = same_differential_result(spec, ours, zod, RELAXATIONS);
		const is_valibot = same_differential_result(spec, ours, valibot, RELAXATIONS);
		return {
			kind: 'sides',
			side: is_zod ? (is_valibot ? 'both' : 'zod') : is_valibot ? 'valibot' : 'neither'
		};
	}
	if (same_differential_result(spec, ours, zod, NO_RULES)) return { kind: 'agree' };
	// every rule, or the relaxations alone, where a rewrite changed what zod
	// or valibot did with something else
	const start = [ALL_RULES, RELAXATIONS].find((rules) => explain(spec, input, results, rules));
	if (!start) return { kind: 'undeclared' };
	// each rule dropped in turn, the last first, and kept where the case needs it
	const used = new Set(start);
	for (const rule of [...start].reverse()) {
		used.delete(rule);
		if (!explain(spec, input, results, used)) used.add(rule);
	}
	return { kind: 'declared', rules: [...used] };
};

//
// Invariants
//

const ISSUE_KEYS = 'kind,expected,received,path,message';
const RECEIVED: ReadonlySet<string> = new Set([
	'null',
	'array',
	'NaN',
	'Infinity',
	'-Infinity',
	'undefined',
	'string',
	'number',
	'boolean',
	'bigint',
	'object',
	'symbol',
	'function'
]);

const result_text = (result: s.SchemaResult<unknown>): string =>
	result.ok
		? 'ok ' + render_value(result.value)
		: 'fail ' +
			JSON.stringify(result.issues, (_, v) =>
				typeof v === 'symbol' || typeof v === 'bigint' ? String(v) : v
			);

/**
 * This library's invariants on one case, as the problems found: each a name,
 * a colon, and what was seen.
 */
export const check_differential_invariants = (
	spec: DifferentialSpec,
	input: DifferentialInput
): Array<string> => {
	const problems: Array<string> = [];
	let schema: s.Schema;
	try {
		schema = build_spec(spec, CONFORMANCE_LIBS.fuz_schema);
	} catch (error) {
		return ['build threw: ' + error_line(error)];
	}
	const value = materialize_input(input);
	const before = render_whole(value);
	let first: s.SchemaResult<unknown>;
	try {
		first = s.parse(schema, value);
	} catch (error) {
		return ['parse threw: ' + error_line(error)];
	}
	if (render_whole(value) !== before) problems.push('input mutated: ' + before);
	if (result_text(s.parse(schema, value)) !== result_text(first)) {
		problems.push('second parse differs: ' + result_text(first));
	}
	if (s.is(schema, value) !== first.ok)
		problems.push(`is differs from parse: parse ok ${first.ok}`);
	if (!first.ok) {
		if (!first.issues.length) problems.push('failed with no issue: ');
		for (const issue of first.issues) {
			const keys = Object.keys(issue).join(',');
			if (keys !== ISSUE_KEYS) problems.push('issue keys: ' + keys);
			if (!Array.isArray(issue.path)) problems.push('issue path not an array: ');
			if (!RECEIVED.has(issue.received)) problems.push('issue received: ' + issue.received);
			if (typeof issue.kind !== 'string' || typeof issue.expected !== 'string') {
				problems.push('issue kind or expected not a string: ');
			}
		}
	}
	const ctx: s.SchemaContext = { issues: undefined, fails: 0, probe: false };
	schema.run(value, ctx);
	if (ctx.fails !== (ctx.issues?.length ?? 0)) {
		problems.push(`ctx.fails is not the count of issues: ${ctx.fails}, ${ctx.issues?.length ?? 0}`);
	}
	const probe: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
	schema.run(value, probe);
	if (probe.issues !== undefined) problems.push('probe touched ctx.issues: ');
	if (!probe.probe) problems.push('probe not restored: ');
	if (!probe.fails !== first.ok)
		problems.push(`probe verdict differs from parse: parse ok ${first.ok}`);
	if (render_whole(value) !== before) problems.push('input mutated by run: ' + before);
	return problems;
};

//
// Minimizing
//

// weights the minimizer lowers: a candidate is taken only when it weighs
// less, so it ends, and on one form whichever case it started from
const LEAF_WEIGHTS: Record<string, number> = {
	string: 1,
	unknown: 2,
	number: 3,
	boolean: 4,
	undef: 4,
	integer: 5,
	safe_integer: 5,
	bigint: 5,
	check: 6,
	transform: 6
};
const KEY_WEIGHT = (key: string): number => ({ a: 0, b: 1, z: 1, d: 2 })[key] ?? 3;
const VALUE_LADDER: Array<unknown> = ['x', undefined, 1, null, ''];
const value_weight = (value: unknown): number => {
	const i = VALUE_LADDER.findIndex((x) => Object.is(x, value));
	return i < 0 ? VALUE_LADDER.length : i;
};

const spec_weight = (spec: DifferentialSpec): number => {
	const entries = (list: Array<[string, DifferentialSpec]>): number =>
		list.reduce((n, [key, e]) => n + 10 + KEY_WEIGHT(key) + spec_weight(e), 0);
	switch (spec.t) {
		case 'optional':
		case 'nullable':
		case 'lazy':
		case 'message':
		case 'array':
		case 'record':
			return 10 + spec_weight(spec.of);
		case 'default':
		case 'default_fn':
			return (spec.t === 'default' ? 12 : 13) + spec_weight(spec.of) + value_weight(spec.v);
		case 'refine':
		case 'map':
			return 12 + spec_weight(spec.of);
		case 'min_length':
		case 'max_length':
		case 'min_value':
		case 'max_value':
		case 'regex':
			return 14 + spec_weight(spec.of);
		case 'union':
			return 10 + spec.of.reduce((n, o) => n + spec_weight(o), 0);
		case 'variant':
			return 14 + spec.of.reduce((n, o) => n + spec_weight(o), 0);
		case 'object':
			return 10 + { strip: 0, strict: 1, loose: 2 }[spec.flavor] + entries(spec.entries);
		case 'rest':
			return 14 + entries(spec.entries) + spec_weight(spec.rest);
		case 'literal':
			return 5 + value_weight(spec.v);
		case 'one_of':
			return 6 + spec.vs.length * 6;
		default:
			return LEAF_WEIGHTS[spec.t]!;
	}
};

const input_weight = (input: DifferentialInput | null): number => {
	if (!input) return 1;
	const entries = (list: Entries): number =>
		list.reduce((n, [key, x]) => n + 10 + KEY_WEIGHT(key) + input_weight(x), 0);
	switch (input.t) {
		case 'v':
			return value_weight(input.v);
		case 'arr':
			return (
				10 +
				input.items.reduce((n, x) => n + 10 + input_weight(x), 0) +
				entries(input.extra) +
				(input.sub ? 20 : 0)
			);
		case 'obj':
			return (
				10 +
				entries(input.own) +
				(input.proto.length ? 10 + entries(input.proto) : 0) +
				(input.base === 'plain' ? 0 : 20) +
				entries(input.hidden) +
				(input.symbol ? 20 + input_weight(input.symbol) : 0) +
				(input.frozen ? 20 : 0)
			);
	}
};

const LEAVES: Array<DifferentialSpec> = [{ t: 'string' }, { t: 'unknown' }, { t: 'number' }];

const replace_at = <T>(list: Array<T>, i: number, item: T): Array<T> =>
	list.map((x, j) => (j === i ? item : x));
const remove_at = <T>(list: Array<T>, i: number): Array<T> => list.filter((_, j) => j !== i);

function* shrink_entries(
	entries: Array<[string, DifferentialSpec]>,
	keep_first = false
): Generator<Array<[string, DifferentialSpec]>> {
	for (let i = keep_first ? 1 : 0; i < entries.length; i++) yield remove_at(entries, i);
	for (let i = keep_first ? 1 : 0; i < entries.length; i++) {
		for (const e of shrink_spec(entries[i]![1])) yield replace_at(entries, i, [entries[i]![0], e]);
	}
}

function* shrink_spec(spec: DifferentialSpec): Generator<DifferentialSpec> {
	switch (spec.t) {
		case 'optional':
		case 'nullable':
		case 'lazy':
		case 'message':
		case 'array':
		case 'record':
		case 'default':
		case 'default_fn':
		case 'refine':
		case 'map':
		case 'min_length':
		case 'max_length':
		case 'min_value':
		case 'max_value':
		case 'regex':
			yield spec.of;
			for (const of of shrink_spec(spec.of)) yield { ...spec, of };
			if (spec.t === 'default' || spec.t === 'default_fn') {
				for (const v of VALUE_LADDER) yield { ...spec, v };
				if (spec.t === 'default_fn') yield { t: 'default', of: spec.of, v: spec.v };
			}
			break;
		case 'union':
			yield* spec.of;
			if (spec.of.length > 2) {
				for (let i = 0; i < spec.of.length; i++) yield { t: 'union', of: remove_at(spec.of, i) };
			}
			for (let i = 0; i < spec.of.length; i++) {
				for (const o of shrink_spec(spec.of[i]!))
					yield { t: 'union', of: replace_at(spec.of, i, o) };
			}
			break;
		case 'variant':
			yield* spec.of;
			if (spec.of.length > 1) {
				for (let i = 0; i < spec.of.length; i++) yield { ...spec, of: remove_at(spec.of, i) };
			}
			for (let i = 0; i < spec.of.length; i++) {
				const option = spec.of[i]!;
				for (const entries of shrink_entries(option.entries, true)) {
					yield { ...spec, of: replace_at(spec.of, i, { ...option, entries }) };
				}
				if (option.flavor !== 'strip') {
					yield { ...spec, of: replace_at(spec.of, i, { ...option, flavor: 'strip' }) };
				}
			}
			break;
		case 'object':
			for (const entries of shrink_entries(spec.entries)) yield { ...spec, entries };
			if (spec.flavor !== 'strip') yield { ...spec, flavor: 'strip' };
			if (spec.flavor === 'loose') yield { ...spec, flavor: 'strict' };
			break;
		case 'rest':
			yield spec.rest;
			for (const entries of shrink_entries(spec.entries)) yield { ...spec, entries };
			for (const rest of shrink_spec(spec.rest)) yield { ...spec, rest };
			yield { t: 'object', flavor: 'loose', entries: spec.entries };
			break;
		case 'literal':
			for (const v of VALUE_LADDER) yield { t: 'literal', v };
			break;
		default:
			break;
	}
	yield* LEAVES;
}

function* shrink_entries_input(list: Entries): Generator<Entries> {
	for (let i = 0; i < list.length; i++) yield remove_at(list, i);
	for (let i = 0; i < list.length; i++) {
		for (const x of shrink_input(list[i]![1])) yield replace_at(list, i, [list[i]![0], x]);
	}
}

function* shrink_input(input: DifferentialInput): Generator<DifferentialInput> {
	if (input.t === 'arr') {
		if (input.sub) yield { ...input, sub: false };
		for (const extra of shrink_entries_input(input.extra)) yield { ...input, extra };
		for (let i = 0; i < input.items.length; i++)
			yield { ...input, items: remove_at(input.items, i) };
		for (let i = 0; i < input.items.length; i++) {
			const item = input.items[i];
			if (!item) continue;
			for (const x of shrink_input(item)) yield { ...input, items: replace_at(input.items, i, x) };
		}
	}
	if (input.t === 'obj') {
		if (input.frozen) yield { ...input, frozen: false };
		if (input.base !== 'plain') yield { ...input, base: 'plain' };
		if (input.symbol) yield { ...input, symbol: null };
		for (const hidden of shrink_entries_input(input.hidden)) yield { ...input, hidden };
		if (input.proto.length) yield { ...input, proto: [] };
		for (const proto of shrink_entries_input(input.proto)) yield { ...input, proto };
		for (const own of shrink_entries_input(input.own)) yield { ...input, own };
	}
	for (const v of VALUE_LADDER) yield value_in(v);
	yield obj_in([]);
}

const rename_input = (input: DifferentialInput, from: string, to: string): DifferentialInput => {
	if (input.t !== 'obj') return input;
	const rename = (list: Entries): Entries => list.map(([key, x]) => [key === from ? to : key, x]);
	return {
		...input,
		own: rename(input.own),
		proto: rename(input.proto),
		hidden: rename(input.hidden)
	};
};

const input_keys = (input: DifferentialInput): Array<string> =>
	input.t === 'obj' ? [...input.own, ...input.proto, ...input.hidden].map(([key]) => key) : [];

// a container's part with the input's part it is run on, and keys renamed in both
function* shrink_both(
	spec: DifferentialSpec,
	input: DifferentialInput
): Generator<[DifferentialSpec, DifferentialInput]> {
	if ((spec.t === 'object' || spec.t === 'rest') && input.t === 'obj') {
		for (const [key, e] of spec.entries) {
			const own = input.own.find(([k]) => k === key);
			if (own) yield [e, own[1]];
		}
		const used = new Set([...spec.entries.map(([key]) => key), ...input_keys(input)]);
		for (const key of used) {
			for (const to of ['a', 'b', 'z']) {
				if (used.has(to) || KEY_WEIGHT(to) >= KEY_WEIGHT(key)) continue;
				yield [
					{ ...spec, entries: spec.entries.map(([k, e]) => [k === key ? to : k, e]) },
					rename_input(input, key, to)
				];
			}
		}
	}
	if (spec.t === 'array' && input.t === 'arr') {
		for (const item of input.items) if (item) yield [spec.of, item];
	}
	if (spec.t === 'record' && input.t === 'obj') {
		for (const [, x] of input.own) yield [spec.of, x];
		const used = new Set(input_keys(input));
		for (const key of used) {
			for (const to of ['a', 'z']) {
				if (!used.has(to) && KEY_WEIGHT(to) < KEY_WEIGHT(key)) {
					yield [spec, rename_input(input, key, to)];
				}
			}
		}
	}
	if (WRAPPERS.has(spec.t)) yield [(spec as { of: DifferentialSpec }).of, input];
}

/**
 * The smallest case found, by the weights, for which `holds` is still true,
 * trying at most `budget` candidates.
 */
export const minimize_differential_case = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	holds: (spec: DifferentialSpec, input: DifferentialInput) => boolean,
	budget_max = 4000
): [DifferentialSpec, DifferentialInput] => {
	let budget = budget_max;
	let best_spec = spec;
	let best_input = input;
	const weight = (sp: DifferentialSpec, i: DifferentialInput): number =>
		spec_weight(sp) * 1000 + input_weight(i);
	let changed = true;
	while (changed && budget > 0) {
		changed = false;
		const now = weight(best_spec, best_input);
		const from_spec = best_spec;
		const from_input = best_input;
		const candidates = (function* (): Generator<[DifferentialSpec, DifferentialInput]> {
			yield* shrink_both(from_spec, from_input);
			for (const s2 of shrink_spec(from_spec)) yield [s2, from_input];
			for (const i2 of shrink_input(from_input)) yield [from_spec, i2];
		})();
		for (const [s2, i2] of candidates) {
			if (weight(s2, i2) >= now) continue;
			if (--budget <= 0) break;
			if (holds(s2, i2)) {
				best_spec = s2;
				best_input = i2;
				changed = true;
				break;
			}
		}
	}
	return [best_spec, best_input];
};

//
// Running many
//

export interface DifferentialOptions {
	seed: number;
	/** How many cases to generate. */
	count: number;
	/** A kind to generate often, and that every root schema has where it can. */
	focus?: DifferentialKind | null;
	/** How many distinct findings of each sort to minimize; the rest are counted. */
	minimize_limit?: number;
	/** Candidates the minimizer tries for each finding. */
	minimize_budget?: number;
	/** Whether to minimize the cases where zod and valibot disagree and this library goes with neither. */
	minimize_neither?: boolean;
}

export interface DifferentialFinding {
	verdict: DifferentialVerdict;
	spec: DifferentialSpec;
	input: DifferentialInput;
	results: DifferentialResults;
	/** How many generated cases minimized to this one. */
	count: number;
	/** The first generated case that did. */
	first: string;
}

export interface DifferentialReport {
	seed: number;
	count: number;
	focus: DifferentialKind | null;
	tally: {
		agree: number;
		declared: number;
		undeclared: number;
		refused: number;
		throws: number;
		sides: Record<DifferentialSide, number>;
	};
	/** How many cases each rule was needed for. */
	rules: Record<DifferentialRuleName, number>;
	/** The undeclared and the throws, minimized. */
	findings: Array<DifferentialFinding>;
	/** The cases where this library goes with neither, minimized when asked. */
	neither: Array<DifferentialFinding>;
	/** Findings not minimized past `minimize_limit`. */
	unminimized: number;
	/** Each invariant broken, with the first case that broke it. */
	invariants: Array<{ problem: string; spec: string; input: string; count: number }>;
	/** Each case where zod or valibot threw, by its text. */
	refusals: Array<{ text: string; spec: string; count: number }>;
}

const verdict_key = (verdict: DifferentialVerdict): string =>
	verdict.kind === 'sides' ? 'sides ' + verdict.side : verdict.kind;

/** Generates and classifies `count` cases from `seed`. */
export const run_differential = (options: DifferentialOptions): DifferentialReport => {
	const {
		seed,
		count,
		focus = null,
		minimize_limit = 50,
		minimize_budget = 4000,
		minimize_neither = false
	} = options;
	const rng = create_differential_rng(seed);
	const report: DifferentialReport = {
		seed,
		count,
		focus,
		tally: {
			agree: 0,
			declared: 0,
			undeclared: 0,
			refused: 0,
			throws: 0,
			sides: { zod: 0, valibot: 0, both: 0, neither: 0 }
		},
		rules: Object.fromEntries(DIFFERENTIAL_RULES.map((rule) => [rule.name, 0])) as any,
		findings: [],
		neither: [],
		unminimized: 0,
		invariants: [],
		refusals: []
	};
	const found: Map<string, DifferentialFinding> = new Map();
	const neither: Map<string, DifferentialFinding> = new Map();
	const invariants: Map<string, DifferentialReport['invariants'][number]> = new Map();
	const refusals: Map<string, DifferentialReport['refusals'][number]> = new Map();
	let minimized = 0;
	let minimized_neither = 0;

	const minimize_into = (
		into: Map<string, DifferentialFinding>,
		verdict: DifferentialVerdict,
		spec: DifferentialSpec,
		input: DifferentialInput
	): void => {
		const key = verdict_key(verdict);
		const holds = (s2: DifferentialSpec, i2: DifferentialInput): boolean =>
			verdict_key(classify_differential_case(s2, i2)) === key;
		const [ms, mi] = minimize_differential_case(spec, input, holds, minimize_budget);
		const text = show_spec(ms) + ' :: ' + show_input(mi);
		const existing = into.get(text);
		if (existing) existing.count++;
		else {
			into.set(text, {
				verdict,
				spec: ms,
				input: mi,
				results: run_differential_case(ms, mi),
				count: 1,
				first: show_spec(spec) + ' :: ' + show_input(input)
			});
		}
	};

	for (let n = 0; n < count; n++) {
		const spec = gen_root_spec(rng, focus);
		const input = gen_input(rng, spec);
		for (const problem of check_differential_invariants(spec, input)) {
			const name = problem.slice(0, problem.indexOf(':'));
			const entry = invariants.get(name);
			if (entry) entry.count++;
			else {
				invariants.set(name, {
					problem,
					spec: show_spec(spec),
					input: show_input(input),
					count: 1
				});
			}
		}
		const results = run_differential_case(spec, input);
		const verdict = classify_differential_case(spec, input, results);
		switch (verdict.kind) {
			case 'agree':
				report.tally.agree++;
				break;
			case 'declared':
				report.tally.declared++;
				for (const rule of verdict.rules) report.rules[rule]++;
				break;
			case 'sides':
				report.tally.sides[verdict.side]++;
				if (verdict.side === 'neither' && minimize_neither) {
					if (minimized_neither++ < minimize_limit) minimize_into(neither, verdict, spec, input);
				}
				break;
			case 'refused': {
				report.tally.refused++;
				const text = [results.zod.text, results.valibot.text]
					.filter((t) => !t.startsWith('ok') && !t.startsWith('fail'))
					.join(' | ');
				const entry = refusals.get(text);
				if (entry) entry.count++;
				else refusals.set(text, { text, spec: show_spec(spec), count: 1 });
				break;
			}
			case 'undeclared':
			case 'throws':
				report.tally[verdict.kind]++;
				if (minimized++ < minimize_limit) minimize_into(found, verdict, spec, input);
				else report.unminimized++;
				break;
		}
	}
	report.findings = [...found.values()];
	report.neither = [...neither.values()];
	report.invariants = [...invariants.values()];
	report.refusals = [...refusals.values()];
	return report;
};

//
// Reporting
//

const describe_finding = (finding: DifferentialFinding): string =>
	`[${verdict_key(finding.verdict)}] x${finding.count}\n` +
	`  schema      ${show_spec(finding.spec)}\n` +
	`  input       ${show_input(finding.input)}\n` +
	`  zod         ${finding.results.zod.text}\n` +
	`  valibot     ${finding.results.valibot.text}\n` +
	`  fuz_schema  ${finding.results.fuz_schema.text}\n` +
	`  from        ${finding.first.slice(0, 240)}\n` +
	source_case(finding.spec, finding.input)
		.split('\n')
		.map((line) => '  ' + line)
		.join('\n');

/** The report as text: the tallies, the rules used, and every finding as a case to paste. */
export const format_differential_report = (report: DifferentialReport): string => {
	const lines: Array<string> = [];
	const { tally } = report;
	lines.push(
		`seed ${report.seed}, ${report.count} cases${report.focus ? `, focus ${report.focus}` : ''}`,
		`  ${String(tally.agree).padStart(8)}  agree`,
		`  ${String(tally.declared).padStart(8)}  declared, by the rules below`,
		`  ${String(tally.undeclared).padStart(8)}  UNDECLARED`,
		`  ${String(tally.throws).padStart(8)}  THROWS (this library)`,
		`  ${String(tally.refused).padStart(8)}  refused or thrown by zod or valibot`
	);
	for (const side of ['zod', 'valibot', 'both', 'neither'] as const) {
		lines.push(
			`  ${String(tally.sides[side]).padStart(8)}  zod and valibot disagree, ours is ${side === 'both' ? 'both' : side === 'neither' ? 'neither' : side + "'s"}`
		);
	}
	lines.push('', 'rules (cases each was needed for, and its row):');
	for (const rule of DIFFERENTIAL_RULES) {
		lines.push(
			`  ${String(report.rules[rule.name]).padStart(8)}  ${rule.name.padEnd(22)}  ${rule.row}`
		);
	}
	if (report.invariants.length) {
		lines.push('', 'INVARIANTS BROKEN:');
		for (const entry of report.invariants) {
			lines.push(`  x${entry.count} ${entry.problem}\n    ${entry.spec} :: ${entry.input}`);
		}
	}
	if (report.findings.length) {
		lines.push('', `findings, minimized (${report.unminimized} more not minimized):`);
		for (const finding of report.findings) lines.push('', describe_finding(finding));
	}
	if (report.neither.length) {
		lines.push('', 'where zod and valibot disagree and this library goes with neither, minimized:');
		for (const finding of report.neither) lines.push('', describe_finding(finding));
	}
	if (report.refusals.length) {
		lines.push('', 'refused or thrown by zod or valibot:');
		for (const entry of report.refusals)
			lines.push(`  x${entry.count} ${entry.text}\n    ${entry.spec}`);
	}
	return lines.join('\n');
};
