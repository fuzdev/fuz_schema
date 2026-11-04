/**
 * The JSON Schema differential: the document `to_json_schema` writes, read by
 * `json_schema_check.ts`, against the library's own verdict, over schemas and
 * JSON inputs generated from a seed. On the input side the document must take
 * exactly what `is` takes; on the output side it must take what `parse`
 * returns. A disagreement is allowed only where one of
 * `JSON_SCHEMA_DIFFERENCES` explains it, each a sentence of `docs/design.md`
 * § JSON Schema, by a relaxation of the checker, a rewrite of the schema
 * that takes away what triggers it, or what the parse gives without it.
 * Anything else is a finding, minimized.
 *
 * The documents of `unrepresentable: 'any'` are held one way: one must take
 * every input `is` takes and every output of `parse`, as `{}` and a keyword
 * left out loosen it past exactness.
 *
 * Schemas come from two generators: the differential's, `differential_generate.ts`,
 * over every kind with a counterpart in zod and valibot, and the generated JSON
 * fixtures', `json_generate.ts`, over what the Rust crate carries, with
 * recursive `lazy` schemas, defaults of any JSON, and texts with astral
 * characters and `__proto__` keys. Each is written on both sides in the
 * default mode, `'throw'`, and a schema the emitter refuses on a side is
 * counted and skipped there, and then in `'any'`.
 *
 * @module
 */

import { isDeepStrictEqual } from 'node:util';

import * as s from '#lib/schema.ts';
import { to_json_schema, type JsonSchema, type JsonSchemaOptions } from '#lib/json_schema.ts';
import { check_json_schema, type JsonSchemaCheckOptions } from './json_schema_check.ts';
import { CONFORMANCE_LIBS } from './conformance_adapters.ts';
import {
	build_spec,
	gen_input,
	gen_root_spec,
	map_spec_children,
	materialize_input,
	show_spec,
	vary_variants,
	type DifferentialKind,
	type DifferentialSpec
} from './differential_generate.ts';
import { generate_random_json_fixture } from './fixtures/json/json_generate.ts';
import { create_seeded_rng } from './seeded_rng.ts';

/** Which side of a parse a document describes. */
export type JsonSchemaSide = 'input' | 'output';

/** What the emitter does with what it can't write: `'throw'` is held exactly, `'any'` one way. */
export type JsonSchemaMode = NonNullable<JsonSchemaOptions['unrepresentable']>;

/** A declared reason the document's verdict differs from the library's. */
export interface JsonSchemaDifference {
	name: string;
	/** Words of its sentence in `docs/design.md` § JSON Schema, which a test finds there, whatever the line breaks. */
	design: string;
	sides: ReadonlyArray<JsonSchemaSide>;
	/** The modes it is of, both when omitted. */
	modes?: ReadonlyArray<JsonSchemaMode>;
	/** How the checker reads the document without what triggers it. */
	relax: JsonSchemaCheckOptions;
	/** Whether the value has what triggers it, without which it explains nothing. */
	trigger?: (value: unknown) => boolean;
	/** Whether the schema has what triggers it, without which it explains nothing. */
	applies?: (c: JsonSchemaCase) => boolean;
	/**
	 * The schema without what triggers it, where the trigger is in the schema,
	 * whose document may differ from the original only by a `default` and a
	 * `required` it takes keys out of.
	 */
	rewrite?: (spec: DifferentialSpec) => DifferentialSpec;
	/**
	 * What the parse of `input` gives without what triggers it, where the
	 * trigger is in what a step gives, checked in place of the real output, or
	 * `undefined` where the parse fails then or gives the real output, which
	 * leaves it nothing to explain.
	 */
	refill?: (c: JsonSchemaCase, input: unknown) => { value: unknown } | undefined;
}

// whether a string of `value`, or a key of an object in it, holds a surrogate pair
const has_astral = (value: unknown): boolean => {
	if (typeof value === 'string') return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(value);
	if (typeof value !== 'object' || value === null) return false;
	if (Array.isArray(value)) return value.some(has_astral);
	return Object.entries(value).some(([k, v]) => has_astral(k) || has_astral(v));
};

const has_own_proto = (value: unknown): boolean => {
	if (typeof value !== 'object' || value === null) return false;
	if (Array.isArray(value)) return value.some(has_own_proto);
	return Object.hasOwn(value, '__proto__') || Object.values(value).some(has_own_proto);
};

// each `with_default_fn` as the `with_default` of what its `make` returns, so
// the document carries the `default` that `default_fills` reads
const default_fn_as_default = (spec: DifferentialSpec): DifferentialSpec => {
	const mapped = map_spec_children(spec, default_fn_as_default);
	return mapped.t === 'default_fn' ? { ...mapped, t: 'default' } : mapped;
};

// what `FILLED_LIB` gives where a `transform` gives `undefined`
// a step after a `transform` that takes `undefined` and refuses this would
// decline the refill and surface a declared case as a finding; the generator
// builds no such step
const FILLED_VALUE = 'x-filled';
const filled =
	(fn: (x?: any) => any) =>
	(x?: any): any => {
		const out = fn(x);
		return out === undefined ? FILLED_VALUE : out;
	};
// this library's adapter with each `transform` that gives `undefined` giving a
// value instead, as the emitter takes a `transform` to give one
const FILLED_LIB: typeof CONFORMANCE_LIBS.fuz_schema = {
	...CONFORMANCE_LIBS.fuz_schema,
	map: (schema, fn) => s.pipe(schema, s.transform(filled(fn))),
	transform: (fn) => s.transform(filled(fn))
};

// what the parse of `input` gives when no `transform` of the case's spec gives
// `undefined`, where that differs from what it gives with them
const refill_transforms = (c: JsonSchemaCase, input: unknown): { value: unknown } | undefined => {
	if (!c.spec) return undefined;
	const real = s.parse(c.schema, input);
	const result = s.parse(build_spec(c.spec, FILLED_LIB), input);
	if (!real.ok || !result.ok) return undefined;
	const a = json_round_trip(real.value);
	const b = json_round_trip(result.value);
	if (!a || !b || isDeepStrictEqual(a.value, b.value)) return undefined;
	return b;
};

// whether `schema` holds a schema of one of `kinds`, through every schema it holds
const holds_kind = (schema: s.AnySchema, kinds: ReadonlyArray<string>): boolean => {
	const seen: Set<unknown> = new Set();
	const visit = (value: unknown): boolean => {
		if (typeof value !== 'object' || value === null || seen.has(value)) return false;
		seen.add(value);
		if (Array.isArray(value)) return value.some(visit);
		if (s.is_schema(value)) {
			if (kinds.includes(value.kind)) return true;
			return visit(value.kind === 'lazy' ? (value.def as () => unknown)() : value.def);
		}
		return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).some(visit);
	};
	return visit(schema);
};

// whether `spec` holds a spec of one of `kinds`
const spec_holds = (spec: DifferentialSpec, kinds: ReadonlyArray<string>): boolean => {
	let found = kinds.includes(spec.t);
	map_spec_children(spec, (child) => {
		found ||= spec_holds(child, kinds);
		return child;
	});
	return found;
};

/**
 * The declared differences, each of a sentence of `docs/design.md`. A case is
 * credited to the fewest that explain it together.
 */
export const JSON_SCHEMA_DIFFERENCES: ReadonlyArray<JsonSchemaDifference> = [
	{
		name: 'code_point_lengths',
		design: '**`minLength` and `maxLength` count code points**',
		sides: ['input', 'output'],
		relax: { code_unit_lengths: true },
		trigger: has_astral
	},
	{
		name: 'pattern_under_u',
		design: '**A `pattern` is read under `u`**',
		sides: ['input', 'output'],
		relax: { pattern_without_u: true },
		trigger: has_astral
	},
	{
		name: 'rest_drops_proto',
		design: '**`object_with_rest` drops an own `__proto__` key unread**',
		sides: ['input'],
		relax: { rest_skips_proto: true },
		trigger: has_own_proto
	},
	{
		name: 'output_refuses_default',
		design: '**The output side can refuse real output.**',
		sides: ['output'],
		relax: { default_fills: true },
		applies: (c) => holds_kind(c.schema, ['with_default', 'with_default_fn']),
		rewrite: default_fn_as_default
	},
	{
		name: 'output_transform_undefined',
		design: 'so does an entry whose `transform` gives `undefined`',
		sides: ['output'],
		modes: ['any'],
		relax: {},
		applies: (c) => !!c.spec && spec_holds(c.spec, ['map', 'transform']),
		refill: refill_transforms
	}
];

/** A schema of a case, with the spec it was built from where it has one. */
export interface JsonSchemaCase {
	schema: s.AnySchema;
	spec: DifferentialSpec | null;
	/** What the schema is, to read: its spec, or its generated group. */
	label: string;
}

/** A disagreement no declared difference explains, or a throw. */
export interface JsonSchemaFinding {
	kind: 'undeclared' | 'checker_throws' | 'library_throws';
	side: JsonSchemaSide;
	mode: JsonSchemaMode;
	label: string;
	/** The value of the input, minimized for an undeclared one. */
	value: unknown;
	/** The output of the parse, on the output side. */
	output?: unknown;
	doc: JsonSchema | null;
	/** What the library said: `is` on the input side, `true` on the output side. */
	expected?: boolean;
	error?: string;
}

/** What a run did. */
export interface JsonSchemaDifferentialReport {
	seed: number;
	schemas: number;
	/** The schemas the emitter refused on each side, by the first line of its error. */
	refused: Record<JsonSchemaSide, number>;
	refusals: Record<string, number>;
	/** The inputs compared on the input side, and the outputs on the output side. */
	compared: Record<JsonSchemaSide, number>;
	/** The inputs of the input side `is` took. */
	accepted: number;
	agree: number;
	/** The disagreements credited to declared differences, by their names joined with `+`. */
	declared: Record<string, number>;
	/** The one-way pass of `'any'`: what it refused, compared, found agreeing, and credited. */
	any: {
		refused: Record<JsonSchemaSide, number>;
		compared: Record<JsonSchemaSide, number>;
		agree: number;
		declared: Record<string, number>;
	} | null;
	/** The first findings, as many as `FINDINGS_KEPT`. */
	findings: Array<JsonSchemaFinding>;
	/** Every finding, kept or not. */
	finding_count: number;
}

/** How many findings a report keeps. */
const FINDINGS_KEPT = 20;

/** Options of `run_json_schema_differential`. */
export interface JsonSchemaDifferentialOptions {
	seed: number;
	/** Schemas from the differential's generator. */
	count: number;
	/** Groups from the JSON fixtures' generator, `count / 10` when omitted. */
	groups?: number;
	/** Inputs drawn for each schema of the differential's generator. */
	inputs?: number;
	focus?: DifferentialKind | null;
	/** How many findings are minimized; the rest are reported as found. */
	minimize_limit?: number;
	/** Whether each schema is written with `'any'` too and held one way, `true` when omitted. */
	any?: boolean;
}

/** A JSON value of `value`, or `undefined` where it has none. */
export const json_round_trip = (value: unknown): { value: unknown } | undefined => {
	let text: string | undefined;
	try {
		text = JSON.stringify(value);
	} catch {
		return undefined;
	}
	return text === undefined ? undefined : { value: JSON.parse(text) };
};

const fuz = CONFORMANCE_LIBS.fuz_schema;

/** The document of `schema` on `side` in `mode`, or why the emitter refused it. */
const emit = (
	schema: s.AnySchema,
	side: JsonSchemaSide,
	mode: JsonSchemaMode = 'throw'
): JsonSchema | Error => {
	try {
		return to_json_schema(schema, { io: side, unrepresentable: mode });
	} catch (error) {
		return error as Error;
	}
};

// the keywords whose value is a map of schemas, a list of them, and one
const SCHEMA_MAPS = new Set(['properties', '$defs', 'patternProperties', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const SCHEMA_ONE = new Set([
	'items',
	'additionalProperties',
	'propertyNames',
	'not',
	'contains',
	'if',
	'then',
	'else',
	'unevaluatedProperties',
	'unevaluatedItems'
]);

const is_node = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// a copy of the schema `node` with no `default` in it, a schema of any keyword
// included and a value of any other not, and each `anyOf` of bare types folded
// again, as a `default` in an option keeps the emitter from folding it
const without_defaults = (node: unknown): unknown => {
	if (!is_node(node)) return node;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(node)) {
		if (k === 'default') continue;
		if (SCHEMA_MAPS.has(k) && is_node(v)) {
			out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, without_defaults(x)]));
		} else if (SCHEMA_LISTS.has(k) && Array.isArray(v)) {
			out[k] = v.map(without_defaults);
		} else if (SCHEMA_ONE.has(k)) {
			out[k] = without_defaults(v);
		} else {
			out[k] = v;
		}
	}
	const options = out.anyOf;
	if (
		Array.isArray(options) &&
		options.every((o) => is_node(o) && Object.keys(o).length === 1 && Object.hasOwn(o, 'type'))
	) {
		const types: Array<unknown> = [];
		for (const o of options) for (const t of [o.type].flat()) if (!types.includes(t)) types.push(t);
		delete out.anyOf;
		out.type = types.length === 1 ? types[0] : types;
	}
	return out;
};

/**
 * Throws unless `rewritten` is `original` but for a `default` and keys taken
 * out of a `required`, of a schema anywhere in the document, as a rewrite may
 * change it. A property named `default` or `required` is a property as any other.
 *
 * @throws Error - naming the first place they differ otherwise
 */
export const assert_rewrite_loosens = (original: unknown, rewritten: unknown): void => {
	loosens(without_defaults(original), without_defaults(rewritten), '#');
};

const pointer = (at: string, key: string | number): string =>
	`${at}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

// `original` and `rewritten` are schemas at `at`
const loosens = (original: unknown, rewritten: unknown, at: string): void => {
	const fail = (where = at): never => {
		throw Error(`the rewrite changed the document at ${where} past a default and a required`);
	};
	if (!is_node(original) || !is_node(rewritten)) {
		if (!isDeepStrictEqual(original, rewritten)) fail();
		return;
	}
	// key order means nothing in a JSON Schema, and refolding moves `type`
	const keys = (o: Record<string, unknown>): Array<string> =>
		Object.keys(o)
			.filter((k) => k !== 'required')
			.sort();
	if (!isDeepStrictEqual(keys(original), keys(rewritten))) fail();
	const required = new Set((original.required as Array<string> | undefined) ?? []);
	if (!((rewritten.required as Array<string> | undefined) ?? []).every((k) => required.has(k))) {
		fail(pointer(at, 'required'));
	}
	for (const k of keys(original)) {
		const a = original[k];
		const b = rewritten[k];
		const here = pointer(at, k);
		if (SCHEMA_MAPS.has(k) && is_node(a) && is_node(b)) {
			if (!isDeepStrictEqual(Object.keys(a), Object.keys(b))) fail(here);
			for (const n of Object.keys(a)) loosens(a[n], b[n], pointer(here, n));
		} else if (SCHEMA_LISTS.has(k) && Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) fail(here);
			a.forEach((x, i) => loosens(x, b[i], pointer(here, i)));
		} else if (SCHEMA_ONE.has(k)) {
			loosens(a, b, here);
		} else if (!isDeepStrictEqual(a, b)) {
			fail(here);
		}
	}
};

const subsets = <T>(items: ReadonlyArray<T>): Array<Array<T>> => {
	const all: Array<Array<T>> = [[]];
	for (const item of items) for (const set of all.slice()) all.push([...set, item]);
	return all.slice(1).sort((a, b) => a.length - b.length);
};

/**
 * Which declared differences explain the document's verdict on `value`
 * differing from the library's, the fewest that do, or `null` when none do.
 *
 * @param c - the schema
 * @param side - which side `doc` is of
 * @param doc - the document of `c` on `side`
 * @param input - the JSON input
 * @param value - the JSON value checked: the input, or on the output side the parse's output
 * @param expected - the library's verdict
 * @param mode - what `doc` was written with
 * @throws Error - when the checker throws, the rewritten schema can't be written, or its document changes more than a rewrite may
 */
export const explain_json_schema_disagreement = (
	c: JsonSchemaCase,
	side: JsonSchemaSide,
	doc: JsonSchema,
	input: unknown,
	value: unknown,
	expected: boolean,
	mode: JsonSchemaMode = 'throw'
): Array<JsonSchemaDifference> | null => {
	const candidates = JSON_SCHEMA_DIFFERENCES.filter(
		(d) =>
			d.sides.includes(side) &&
			(!d.modes || d.modes.includes(mode)) &&
			(!d.trigger || d.trigger(value)) &&
			(!d.applies || d.applies(c))
	);
	sets: for (const set of subsets(candidates)) {
		// what the parse gives without each trigger in a step, one after another
		let checked = value;
		for (const d of set) {
			if (!d.refill) continue;
			const refilled = d.refill(c, input);
			if (!refilled) continue sets;
			checked = refilled.value;
		}
		let target = doc;
		// a schema with no spec, of the JSON fixtures' generator, has no
		// `with_default_fn` or `transform`, which the rewrites are for
		let spec = c.spec;
		const rewrites = set.filter((d) => d.rewrite);
		if (spec && rewrites.length) {
			for (const d of rewrites) spec = d.rewrite!(spec);
			const rewritten = emit(build_spec(spec, fuz), side, mode);
			if (rewritten instanceof Error) throw rewritten;
			assert_rewrite_loosens(doc, rewritten);
			target = rewritten;
		}
		const relax: JsonSchemaCheckOptions = Object.assign({}, ...set.map((d) => d.relax));
		if (check_json_schema(target, checked, relax) === expected) return set;
	}
	return null;
};

/** What a case gives on `side` for the input `input`: agreement, the differences credited, or a finding. */
type Outcome =
	| { t: 'skip' }
	| { t: 'agree' }
	| { t: 'declared'; names: string }
	| { t: 'finding'; finding: JsonSchemaFinding };

const run_side = (
	c: JsonSchemaCase,
	side: JsonSchemaSide,
	mode: JsonSchemaMode,
	doc: JsonSchema,
	input: unknown
): Outcome => {
	let expected: boolean;
	let value: unknown = input;
	let output: unknown;
	try {
		if (side === 'input') {
			expected = s.is(c.schema, input);
			// held one way, to what the library takes
			if (mode === 'any' && !expected) return { t: 'skip' };
		} else {
			const result = s.parse(c.schema, input);
			if (!result.ok) return { t: 'skip' };
			const json = json_round_trip(result.value);
			if (!json) return { t: 'skip' };
			value = output = json.value;
			expected = true;
		}
	} catch (error) {
		return {
			t: 'finding',
			finding: {
				kind: 'library_throws',
				side,
				mode,
				label: c.label,
				value: input,
				doc,
				error: String(error)
			}
		};
	}
	const finding = (kind: JsonSchemaFinding['kind'], error?: string): Outcome => ({
		t: 'finding',
		finding: { kind, side, mode, label: c.label, value: input, output, doc, expected, error }
	});
	try {
		if (check_json_schema(doc, value) === expected) return { t: 'agree' };
		const set = explain_json_schema_disagreement(c, side, doc, input, value, expected, mode);
		if (!set) return finding('undeclared');
		return { t: 'declared', names: set.map((d) => d.name).join('+') };
	} catch (error) {
		return finding('checker_throws', (error as Error).message);
	}
};

// the values a value shrinks to, each smaller by one step
const shrink_value = (value: unknown): Array<unknown> => {
	const out: Array<unknown> = [];
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) out.push(value.toSpliced(i, 1));
		value.forEach((item, i) => {
			for (const smaller of shrink_value(item)) out.push(value.with(i, smaller));
		});
	} else if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value);
		const make = (list: Array<[string, unknown]>): unknown => {
			// own data properties, so a `__proto__` key stays an own key
			const o = {};
			for (const [k, v] of list) {
				Object.defineProperty(o, k, {
					value: v,
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			return o;
		};
		for (let i = 0; i < entries.length; i++) out.push(make(entries.toSpliced(i, 1)));
		entries.forEach(([k, v], i) => {
			for (const smaller of shrink_value(v)) out.push(make(entries.with(i, [k, smaller])));
		});
	} else if (typeof value === 'string' && value.length) {
		out.push('', value.slice(1), value.slice(0, -1));
	} else if (typeof value === 'number' && value !== 0) {
		out.push(0);
	}
	return out;
};

// the specs a spec shrinks to, each by one step: a node replaced by one it
// holds, an entry or an option dropped
const shrink_spec = (spec: DifferentialSpec): Array<DifferentialSpec> => {
	const out: Array<DifferentialSpec> = [];
	switch (spec.t) {
		case 'union':
			out.push(...spec.of);
			if (spec.of.length > 1)
				spec.of.forEach((_, i) => out.push({ ...spec, of: spec.of.toSpliced(i, 1) }));
			break;
		case 'object':
			spec.entries.forEach((_, i) => out.push({ ...spec, entries: spec.entries.toSpliced(i, 1) }));
			out.push(...spec.entries.map(([, e]) => e));
			break;
		case 'rest':
			spec.entries.forEach((_, i) => out.push({ ...spec, entries: spec.entries.toSpliced(i, 1) }));
			out.push(...spec.entries.map(([, e]) => e), spec.rest);
			break;
		case 'variant':
			break;
		default:
			if ('of' in spec && !Array.isArray(spec.of)) out.push(spec.of);
	}
	// one child shrunk, the others kept
	let index = 0;
	const children: Array<DifferentialSpec> = [];
	map_spec_children(spec, (child) => {
		children.push(child);
		return child;
	});
	for (const child of children) {
		for (const smaller of shrink_spec(child)) {
			let i = 0;
			const at = index;
			out.push(map_spec_children(spec, (c) => (i++ === at ? smaller : c)));
		}
		index++;
	}
	return out;
};

/** `finding` with its input, and its schema where it has a spec, made as small as it stays undeclared. */
const minimize = (c: JsonSchemaCase, finding: JsonSchemaFinding): JsonSchemaFinding => {
	const still = (k: JsonSchemaCase, input: unknown): JsonSchemaFinding | null => {
		const doc = emit(k.schema, finding.side, finding.mode);
		if (doc instanceof Error) return null;
		const outcome = run_side(k, finding.side, finding.mode, doc, input);
		return outcome.t === 'finding' && outcome.finding.kind === finding.kind
			? outcome.finding
			: null;
	};
	let current = c;
	let best = finding;
	for (let budget = 2000, changed = true; changed && budget > 0;) {
		changed = false;
		for (const v of shrink_value(best.value)) {
			if (--budget < 0) break;
			const f = still(current, v);
			if (f) {
				best = f;
				changed = true;
				break;
			}
		}
		if (changed || !current.spec) continue;
		for (const spec of shrink_spec(current.spec)) {
			if (--budget < 0) break;
			let schema: s.AnySchema;
			try {
				schema = build_spec(spec, fuz);
			} catch {
				continue;
			}
			const k = { schema, spec, label: show_spec(spec) };
			const f = still(k, best.value);
			if (f) {
				current = k;
				best = f;
				changed = true;
				break;
			}
		}
	}
	return best;
};

/**
 * Runs the JSON Schema differential of `seed`.
 *
 * @param options - the seed, and how many schemas of each generator
 * @returns the tallies and the findings
 */
export const run_json_schema_differential = (
	options: JsonSchemaDifferentialOptions
): JsonSchemaDifferentialReport => {
	const { seed, count, focus = null, minimize_limit = 5, any = true } = options;
	const groups = options.groups ?? Math.ceil(count / 10);
	const per = options.inputs ?? 8;
	const report: JsonSchemaDifferentialReport = {
		seed,
		schemas: 0,
		refused: { input: 0, output: 0 },
		refusals: {},
		compared: { input: 0, output: 0 },
		accepted: 0,
		agree: 0,
		declared: {},
		any: any
			? {
					refused: { input: 0, output: 0 },
					compared: { input: 0, output: 0 },
					agree: 0,
					declared: {}
				}
			: null,
		findings: [],
		finding_count: 0
	};
	let minimized = 0;

	const run_case = (c: JsonSchemaCase, inputs: Array<unknown>): void => {
		report.schemas++;
		for (const mode of any ? (['throw', 'any'] as const) : (['throw'] as const)) {
			const tally = mode === 'throw' ? report : report.any!;
			for (const side of ['input', 'output'] as const) {
				const doc = emit(c.schema, side, mode);
				if (doc instanceof Error) {
					tally.refused[side]++;
					if (mode === 'throw') {
						const line = doc.message.replace(/ at #.*?: /, ': ');
						report.refusals[line] = (report.refusals[line] ?? 0) + 1;
					}
					continue;
				}
				for (const input of inputs) {
					const outcome = run_side(c, side, mode, doc, input);
					if (outcome.t === 'skip') continue;
					tally.compared[side]++;
					if (mode === 'throw' && side === 'input' && s.is(c.schema, input)) report.accepted++;
					if (outcome.t === 'agree') tally.agree++;
					else if (outcome.t === 'declared') {
						tally.declared[outcome.names] = (tally.declared[outcome.names] ?? 0) + 1;
					} else {
						const f = outcome.finding;
						if (report.finding_count++ >= FINDINGS_KEPT) continue;
						report.findings.push(
							f.kind === 'undeclared' && minimized++ < minimize_limit ? minimize(c, f) : f
						);
					}
				}
			}
		}
	};

	const rng = create_seeded_rng(seed);
	// draws of its own, apart from the generator's
	const vary = create_seeded_rng(seed + 0x9e3779b9);
	for (let i = 0; i < count; i++) {
		const spec = vary_variants(vary, gen_root_spec(rng, focus));
		let schema: s.AnySchema;
		try {
			schema = build_spec(spec, fuz);
		} catch {
			continue;
		}
		const inputs: Array<unknown> = [];
		for (let j = 0; j < per; j++) {
			const json = json_round_trip(materialize_input(gen_input(rng, spec)));
			if (json) inputs.push(json.value);
		}
		run_case({ schema, spec, label: show_spec(spec) }, inputs);
	}
	for (let index = 0; index < groups; index++) {
		const fixture = generate_random_json_fixture(seed, index, 20);
		const inputs: Array<unknown> = [];
		for (const text of Object.values(fixture.cases)) {
			try {
				inputs.push(JSON.parse(typeof text === 'string' ? text : text.text));
			} catch {
				// a text cut short, or with something after it
			}
		}
		run_case(
			{ schema: fixture.schema, spec: null, label: `generated JSON group ${seed}/${index}` },
			inputs
		);
	}
	return report;
};

const show_json = (value: unknown): string => {
	const text = JSON.stringify(value);
	return text.length > 600 ? text.slice(0, 600) + '…' : text;
};

/** A report as text: the tallies, then each finding. */
export const format_json_schema_differential_report = (
	report: JsonSchemaDifferentialReport
): string => {
	const lines: Array<string> = [
		`seed ${report.seed}: ${report.schemas} schemas, refused ${report.refused.input} on the input side and ${report.refused.output} on the output side`,
		`  compared ${report.compared.input} inputs (${report.accepted} taken) and ${report.compared.output} outputs: ${report.agree} agree, ${report.finding_count} findings${report.finding_count > report.findings.length ? `, the first ${report.findings.length} below` : ''}`,
		`  declared: ${
			Object.entries(report.declared)
				.map(([k, n]) => `${k} ${n}`)
				.join(', ') || 'none'
		}`,
		'  refused by:',
		...Object.entries(report.refusals)
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => `    ${n} ${k}`)
	];
	const any = report.any;
	if (any) {
		lines.push(
			`  with 'any', one way: refused ${any.refused.input} on the input side and ${any.refused.output} on the output side, compared ${any.compared.input} inputs taken and ${any.compared.output} outputs: ${any.agree} agree`,
			`    declared: ${
				Object.entries(any.declared)
					.map(([k, n]) => `${k} ${n}`)
					.join(', ') || 'none'
			}`
		);
	}
	for (const f of report.findings) {
		lines.push(
			'',
			`${f.kind.toUpperCase()} on the ${f.side} side, with '${f.mode}': ${f.label}`,
			`  input:  ${show_json(f.value)}`,
			...(f.side === 'output' ? [`  output: ${show_json(f.output)}`] : []),
			...(f.expected === undefined
				? []
				: [
						`  the library ${f.side === 'input' ? (f.expected ? 'takes it' : 'refuses it') : 'returns it'}, the document doesn't agree`
					]),
			`  doc:    ${show_json(f.doc)}`,
			...(f.error ? [`  error:  ${f.error}`] : [])
		);
	}
	return lines.join('\n');
};
