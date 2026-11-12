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
	type ConformanceFlavor,
	type ConformanceLib,
	type ConformanceLibName,
	type ConformanceParsed
} from './conformance_adapters.ts';
import { ConformanceList, ConformancePoint } from './conformance_cases.ts';
import { render_parsed, render_value } from './conformance_test_helpers.ts';
import { seeded_shuffle, type SeededRng } from './seeded_rng.ts';

//
// Schemas
//

type LeafKind =
	| 'string'
	| 'number'
	| 'integer'
	| 'safe_integer'
	| 'boolean'
	| 'bigint'
	| 'unknown'
	| 'undef'
	| DifferentialFormat;

/** A format test, which `build_spec` makes as a `pipe` from a string. */
export type DifferentialFormat = 'uuid' | 'iso_datetime';
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
	| { t: 'keyed_record'; key: DifferentialSpec; of: DifferentialSpec }
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
	'uuid',
	'iso_datetime',
	'literal',
	'one_of',
	'optional',
	'nullable',
	'lazy',
	'message',
	'array',
	'record',
	'keyed_record',
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
		case 'uuid':
		case 'iso_datetime':
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
		case 'keyed_record':
			return l.keyed_record(build_spec(spec.key, l), build_spec(spec.of, l));
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

// TODO: `to_lower_case` is held by the conformance matrix and the JSON
// fixtures, not generated here: it is a step that changes the value, which the
// rules read as only a `map` does, and needs strings whose lowercase differs
// TODO: `to_integer` is held by the conformance matrix and the JSON Schema
// differential's family of its own, not generated here: it is a step that
// changes the value too, and needs texts of its grammar's pieces, on which
// both declared differences of its grammar and of `-0` would need rules
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
	'uuid',
	'iso_datetime',
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
	'keyed_record',
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

// the key schemas of a `keyed_record`: any string, lowercase letters, which
// refuse a digit, an underscore, and a capital, a set of keys and one key the
// generated inputs name, and a set that takes an own `__proto__` key and
// what `record_own_proto` renames it to, which every other set refuses as it
// does `__proto__`
// TODO: a key schema that changes the key, as `pipe(string, to_lower_case)`,
// is held by the conformance matrix and not generated here, as `to_lower_case`
// is not: the rules read an output that differs from the input as a `map`'s
const KEYED_KEYS: Array<DifferentialSpec> = [
	{ t: 'string' },
	{ t: 'regex', of: { t: 'string' }, re: 'lower' },
	{ t: 'one_of', vs: ['k0', 'k1', 'z'] },
	{ t: 'literal', v: 'k0' },
	{ t: 'one_of', vs: ['k0', '__proto__', 'renamed__proto__'] }
];

const gen_entries = (
	rng: SeededRng,
	keys: Array<string>,
	depth: number,
	focus: DifferentialKind | null
): Array<[string, DifferentialSpec]> => keys.map((key) => [key, gen_spec(rng, depth - 1, focus)]);

/** A node of `kind`, its children generated. */
const gen_node = (
	rng: SeededRng,
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
		case 'uuid':
		case 'iso_datetime':
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
		case 'keyed_record':
			return { t: kind, key: rng.pick(KEYED_KEYS), of: gen_spec(rng, depth - 1, focus) };
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
	rng: SeededRng,
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

/**
 * `spec` with the discriminators of its variants now and then made as
 * `gen_spec` never makes them, as zod refuses them: the last option's the
 * first's, which shadows the first, `0` and `-0`, which a `Map` reads as one,
 * and one that is no `literal`, which `variant` registers by its `def`. The
 * JSON Schema differential's alone.
 */
export const vary_variants = (rng: SeededRng, spec: DifferentialSpec): DifferentialSpec => {
	const mapped = map_spec_children(spec, (child) => vary_variants(rng, child));
	if (mapped.t !== 'variant') return mapped;
	const discriminate = (
		option: DifferentialObjectSpec,
		t: DifferentialSpec
	): DifferentialObjectSpec => ({
		...option,
		entries: option.entries.map(([k, e]): [string, DifferentialSpec] => [
			k,
			k === mapped.key ? t : e
		])
	});
	const of = mapped.of.slice();
	const first = of[0]!.entries.find(([k]) => k === mapped.key)![1];
	const last = of.length - 1;
	const roll = rng.int(20);
	if (roll === 0) {
		of[last] = discriminate(of[last]!, first);
	} else if (roll === 1) {
		of[0] = discriminate(of[0]!, { t: 'literal', v: 0 });
		of[last] = discriminate(of[last]!, { t: 'literal', v: -0 });
	} else if (roll === 2) {
		const v = first.t === 'literal' ? first.v : 'a';
		const others: Array<DifferentialSpec> = [
			{ t: 'optional', of: first },
			{ t: 'nullable', of: first },
			{ t: 'one_of', vs: [v, 'z'] },
			{ t: 'string' },
			{ t: 'message', of: first }
		];
		of[0] = discriminate(of[0]!, rng.pick(others));
	} else {
		return mapped;
	}
	return { ...mapped, of };
};

/** The root schema of a case: most often an object, as most differences are in one. */
export const gen_root_spec = (
	rng: SeededRng,
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

/** The symbol key an object input is given, `SYMBOL` in `conformance_cases.ts`. */
export const DIFFERENTIAL_SYMBOL = Symbol.for('sym');

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

const HEX = '0123456789abcdefABCDEF';
// what a character of a near miss is replaced by or added: hex digits of
// either case, the separators, the letters of a date and time in either case,
// a letter past hex, a space, a brace, a newline, a fullwidth digit, and an `é`
const NEAR = HEX + '-:.+TZtz g{}\n\uFF10é';

// a character of `chars`, each one code unit
const pick_char = (rng: SeededRng, chars: string): string => chars[rng.int(chars.length)]!;

const replace_char = (text: string, i: number, char: string): string =>
	text.slice(0, i) + char + text.slice(i + 1);

// a mutation of a single character: one replaced, one taken out, or one added
const mutate_char = (rng: SeededRng, text: string): string => {
	const i = rng.int(text.length + 1);
	const char = pick_char(rng, NEAR);
	const r = rng.int(3);
	return r === 0
		? replace_char(text, Math.min(i, text.length - 1), char)
		: r === 1
			? text.slice(0, i) + text.slice(i + 1)
			: text.slice(0, i) + char + text.slice(i);
};

const hex_digits = (rng: SeededRng, n: number, upper: boolean): string =>
	Array.from({ length: n }, () =>
		pick_char(rng, upper ? '0123456789ABCDEF' : '0123456789abcdef')
	).join('');

// a UUID both grammars take: a version from 1 to 8 and the RFC's variant, in
// one case, or the nil UUID, or the max UUID in lowercase
const gen_uuid_base = (rng: SeededRng): string => {
	const r = rng.int(10);
	if (r === 0) return '00000000-0000-0000-0000-000000000000';
	if (r === 1) return 'ffffffff-ffff-ffff-ffff-ffffffffffff';
	const upper = rng.chance(0.2);
	const variant = pick_char(rng, upper ? '89AB' : '89ab');
	return (
		`${hex_digits(rng, 8, upper)}-${hex_digits(rng, 4, upper)}-${1 + rng.int(8)}` +
		`${hex_digits(rng, 3, upper)}-${variant}${hex_digits(rng, 3, upper)}-${hex_digits(rng, 12, upper)}`
	);
};

/** Where the version and the variant of a UUID are, its nibbles the RFC fixes. */
export const UUID_VERSION_AT = 14;
export const UUID_VARIANT_AT = 19;

const gen_uuid_text = (rng: SeededRng): string => {
	const base = gen_uuid_base(rng);
	switch (rng.int(9)) {
		case 0:
		case 1:
			return base;
		case 2:
			return replace_char(base, UUID_VERSION_AT, pick_char(rng, HEX));
		case 3:
			return replace_char(base, UUID_VARIANT_AT, pick_char(rng, HEX));
		case 4: {
			// the max UUID, all of it or one group in uppercase, or one character
			const max = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
			const r = rng.int(3);
			if (r === 0) return max.toUpperCase();
			if (r === 1) return replace_char(max, rng.int(max.length), pick_char(rng, 'F-0'));
			const groups = max.split('-');
			const g = rng.int(groups.length);
			groups[g] = groups[g]!.toUpperCase();
			return groups.join('-');
		}
		case 5:
			return rng.pick([
				`{${base}}`,
				base.replaceAll('-', ''),
				`urn:uuid:${base}`,
				base + '\n',
				base.toUpperCase(),
				base.slice(1),
				base + '0'
			]);
		default:
			return mutate_char(rng, base);
	}
};

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

const is_leap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const days_in = (year: number, month: number): number =>
	month === 2 ? (is_leap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

const YEARS = [0, 1, 1900, 1970, 2000, 2023, 2024, 2100, 2400, 9999];

// a date and time zod's grammar takes, with a fraction of 0 to 12 digits, so
// past 9 valibot's does not
const gen_iso_datetime_base = (rng: SeededRng): string => {
	const year = rng.chance(0.5) ? rng.pick(YEARS) : rng.int(10_000);
	const month = 1 + rng.int(12);
	const day = rng.chance(0.3) ? days_in(year, month) : 1 + rng.int(days_in(year, month));
	const time = `${pad(rng.int(24), 2)}:${pad(rng.int(60), 2)}:${pad(rng.int(60), 2)}`;
	const digits = rng.chance(0.5) ? 0 : rng.int(13);
	const fraction = digits ? '.' + Array.from({ length: digits }, () => rng.int(10)).join('') : '';
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${time}${fraction}Z`;
};

// offsets for the `Z`: the ones of RFC 3339 valibot takes, with no colon, of
// an hour alone, after a space, out of range, and near misses both refuse
const OFFSETS = [
	'+01:00',
	'-00:00',
	'+00:00',
	'-23:59',
	'+0100',
	'-0530',
	'+01',
	' +01:00',
	' +0100',
	'+24:00',
	'+01:60',
	' +01',
	' Z',
	'+1',
	'+1:00',
	'+01:0',
	'z'
];

const gen_iso_datetime_text = (rng: SeededRng): string => {
	const base = gen_iso_datetime_base(rng);
	switch (rng.int(8)) {
		case 0:
		case 1:
			return base;
		case 2:
			return base.slice(0, -1) + rng.pick(OFFSETS);
		case 3:
			return replace_char(base, 10, rng.pick([' ', 't', '_']));
		case 4: {
			// a day the month doesn't have: February 29 of a year that is not
			// leap, February 30 and 31, the 31st of a month of 30 days, and the
			// 0th and the 32nd
			const year = rng.pick(YEARS);
			const [month, day] = rng.pick([
				[2, 29],
				[2, 30],
				[2, 31],
				[rng.pick([4, 6, 9, 11]), 31],
				[1 + rng.int(12), 0],
				[1 + rng.int(12), 32],
				[13, 1],
				[0, 1]
			] as const);
			return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` + base.slice(10);
		}
		case 5:
			return rng.pick([
				// no seconds, the hour 24, and a leap second
				base.slice(0, 16) + 'Z',
				base.slice(0, 11) + '24' + base.slice(13),
				base.slice(0, 17) + '60' + base.slice(19),
				base + '\n',
				'+' + pad(10_000 + rng.int(10_000), 5) + base.slice(4),
				base.slice(0, 10)
			]);
		default:
			return mutate_char(rng, base);
	}
};

/**
 * A string for the format test `format`: one zod's grammar takes, or a near
 * miss of one, by a character, the version or variant of a UUID, the case of
 * the max UUID, the length of a fraction, an offset, or a day the month
 * doesn't have.
 */
export const gen_format_text = (rng: SeededRng, format: DifferentialFormat): string =>
	format === 'uuid' ? gen_uuid_text(rng) : gen_iso_datetime_text(rng);

// a string of `gen_format_text` that zod and valibot give one verdict on
// alone. Their disagreements are drawn alone, each by a row of `SIDES`, in
// `run_format_differential`: under a structure, one beside a declared
// difference is a combination, which needs a declared row of its own
// TODO: declare the combinations of a format's `SIDES` row with a declared
// difference, as a `record` given a class instance or a `max_length` after an
// array, each with a UUID item zod refuses, and draw every near miss here
const gen_agreed_format_text = (rng: SeededRng, format: DifferentialFormat): string => {
	const zod = CONFORMANCE_LIBS.zod[format];
	const valibot = CONFORMANCE_LIBS.valibot[format];
	for (;;) {
		const text = gen_format_text(rng, format);
		if (
			CONFORMANCE_LIBS.zod.parse(zod, text).ok === CONFORMANCE_LIBS.valibot.parse(valibot, text).ok
		) {
			return text;
		}
	}
};

const edge = (rng: SeededRng): DifferentialInput =>
	rng.chance(0.15) ? (rng.chance(0.5) ? arr_in([]) : obj_in([])) : value_in(rng.pick(EDGES));

const dedupe = (list: DifferentialEntries): DifferentialEntries => {
	const seen: Set<string> = new Set();
	return list.filter(([key]) => !seen.has(key) && !!seen.add(key));
};

// what an object input is past its own enumerable keys, now and then
const vary_object = (rng: SeededRng, input: DifferentialInput & { t: 'obj' }): void => {
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
	rng: SeededRng,
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
	if (rng.chance(0.1)) seeded_shuffle(rng, own);
	const input = obj_in(dedupe(own), dedupe(proto)) as DifferentialInput & { t: 'obj' };
	vary_object(rng, input);
	return input;
};

/** An input shaped by `spec`, with an edge in place of a value now and then. */
export const gen_input = (rng: SeededRng, spec: DifferentialSpec, depth = 0): DifferentialInput => {
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
		case 'uuid':
		case 'iso_datetime':
			return value_in(gen_agreed_format_text(rng, spec.t));
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
		case 'record':
		case 'keyed_record': {
			// a key of a `keyed_record` its key schema may refuse: a capital, or one
			// outside a set
			// TODO: declare the combinations of `constructor` or `prototype` outside
			// a set of keys, a `neither` row of `SIDES`, with a declared difference,
			// as a `max_length` after an array too long whose item has one, and draw
			// those keys for a set here too
			const extra =
				spec.t === 'keyed_record' && (spec.key.t === 'one_of' || spec.key.t === 'literal')
					? EXTRA_KEYS.filter((key) => key !== 'constructor' && key !== 'prototype')
					: EXTRA_KEYS;
			const own: DifferentialEntries = Array.from({ length: rng.int(3) }, (_, i) => [
				rng.chance(0.15)
					? rng.pick(extra)
					: spec.t === 'keyed_record' && rng.chance(0.15)
						? rng.pick(['K' + i, 'k', 'z'])
						: 'k' + i,
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
			if (input.symbol) object[DIFFERENTIAL_SYMBOL] = materialize_input(input.symbol);
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
		case 'keyed_record':
			return `keyed_record(${show_spec(spec.key)},${show_spec(spec.of)})`;
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
		case 'keyed_record':
			return `l.keyed_record(${source_spec(spec.key)}, ${source_spec(spec.of)})`;
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
 * `conformance_cases.ts` has in scope: `with_hidden`, `SYMBOL`,
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
