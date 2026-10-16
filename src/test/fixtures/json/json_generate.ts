/**
 * Generated JSON fixtures: a random schema the Rust crate carries, drawn from
 * a seed, and JSON texts aimed at it, written as a `JsonFixture` so the oracle
 * and the crate's tests take them as they take an authored group.
 *
 * The texts are values near the schema, wrong ones, edge numbers, escaped and
 * raw Unicode, extra and missing keys, keys written twice, deep nesting, and
 * texts cut short or with something after them. A text is kept only when
 * what the crate does with it is known from the library's answer: one deeper
 * than the crate reads is dropped, as is one whose key written twice could
 * make the streaming evaluator refuse what the library accepts. A text cut
 * short is a valid one cut after a `[`, `{`, `,` or `:`, and one with
 * something after it declares `malformed_tail` when what comes before
 * doesn't match.
 *
 * Committed groups are `generated_*`. `deep.ts` runs many more seeds, with
 * the output outside the repo.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { SCHEMA_JSON_MAX_DEPTH, to_schema_json } from '#lib/schema_json.ts';
import { create_seeded_rng, type SeededRng } from '../../seeded_rng.ts';
import type { JsonFixture, JsonFixtureText } from './json_test_helpers.ts';

/** The cases a generated group has unless it is asked for another number. */
export const GENERATED_JSON_CASES = 40;

/** A generated group's seed, mixing its index in so each group of a seed differs. */
const group_seed = (seed: number, index: number): number =>
	(seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;

//
// Schemas
//

const STRINGS = [
	'',
	'a',
	'b',
	'x',
	'ab',
	'abc',
	'é',
	'日本',
	'😀',
	'a"b',
	'a\\b',
	'\n',
	' ',
	'null',
	'0',
	'\u0000',
	'\u2028',
	'/'
];
const LITERALS: Array<s.SchemaLiteral> = [
	'',
	'a',
	'b',
	'é',
	'😀',
	'null',
	0,
	1,
	-1,
	1.5,
	2 ** 53,
	1e21,
	true,
	false,
	null
];
const ENTRY_KEYS = ['a', 'b', 'c', '0', '1', '', 'é', 'a b', 'k"q', '😀'];
const DEFAULTS: Array<unknown> = ['D', 1, 0, null, true, [], {}, { a: 1 }, [1, 'x']];
const NUMBER_BOUNDS = [0, 1, -1, 1.5, 2, 2 ** 53];
const LENGTH_BOUNDS = [0, 1, 2, 3];

type Gen = (rng: SeededRng, depth: number, self: s.AnySchema | null) => s.AnySchema;

const pipe = (head: s.AnySchema, ...steps: Array<s.AnySchema>): s.AnySchema =>
	(s.pipe as any)(head, ...steps);

const gen_number_pipe = (rng: SeededRng): s.AnySchema => {
	const head = rng.pick([s.number, s.number, s.integer, s.safe_integer]);
	const steps = Array.from({ length: 1 + rng.int(2) }, () =>
		rng.pick([
			() => s.min_value(rng.pick(NUMBER_BOUNDS)),
			() => s.max_value(rng.pick(NUMBER_BOUNDS)),
			() => s.integer,
			() => s.safe_integer
		])()
	);
	return pipe(head, ...(steps as Array<s.AnySchema>));
};

const length_steps = (rng: SeededRng): Array<s.AnySchema> =>
	Array.from(
		{ length: 1 + rng.int(2) },
		() =>
			(rng.chance(0.5)
				? s.min_length(rng.pick(LENGTH_BOUNDS))
				: s.max_length(rng.pick(LENGTH_BOUNDS))) as s.AnySchema
	);

const gen_leaf: Gen = (rng, _depth, self) => {
	if (self && rng.chance(0.25)) return self;
	switch (rng.int(14)) {
		case 0:
		case 1:
			return s.string;
		case 2:
			return s.number;
		case 3:
			return rng.pick([s.integer, s.safe_integer]);
		case 4:
			return s.boolean;
		case 5:
			return rng.chance(0.3) ? s.bigint : s.unknown;
		case 6:
		case 7:
			return s.literal(rng.pick(LITERALS));
		case 8:
			return s.one_of([
				...new Set(Array.from({ length: 1 + rng.int(4) }, () => rng.pick(LITERALS)))
			]);
		case 9:
			return gen_number_pipe(rng);
		case 10: {
			const head = pipe(s.string, ...length_steps(rng));
			// a pipe whose first schema is a pipe
			return rng.chance(0.3) ? pipe(head, ...length_steps(rng)) : head;
		}
		default:
			return rng.pick([s.string, s.number, s.boolean, s.unknown]);
	}
};

const gen_entries = (
	rng: SeededRng,
	depth: number,
	self: s.AnySchema | null,
	keys: Array<string>
): Record<string, s.AnySchema> => {
	const entries: Record<string, s.AnySchema> = {};
	for (const key of keys) entries[key] = gen_schema(rng, depth - 1, self, true);
	return entries;
};

const pick_keys = (rng: SeededRng, count: number): Array<string> => {
	const keys: Set<string> = new Set();
	for (let i = 0; i < count; i++) keys.add(rng.pick(ENTRY_KEYS));
	return [...keys];
};

const gen_object = (
	rng: SeededRng,
	depth: number,
	self: s.AnySchema | null,
	least = 0
): s.AnySchema => {
	const entries = gen_entries(rng, depth, self, pick_keys(rng, least + rng.int(5 - least)));
	return rng.pick([s.object, s.object, s.loose_object, s.strip_object])(entries);
};

const gen_array = (rng: SeededRng, depth: number, self: s.AnySchema | null): s.AnySchema =>
	s.array(gen_schema(rng, depth - 1, self, true));

/**
 * A schema of at most `depth` levels. `self` is the `lazy` around the nearest
 * recursive schema, which a schema inside an array or an object may be.
 */
const gen_schema = (
	rng: SeededRng,
	depth: number,
	self: s.AnySchema | null,
	inside = false
): s.AnySchema => {
	const own_self = inside ? self : null;
	if (depth <= 0 || rng.chance(0.25)) return gen_leaf(rng, depth, own_self);
	const d = depth - 1;
	switch (rng.int(17)) {
		case 0:
		case 1:
			return s.optional(gen_schema(rng, d, self, inside));
		case 2:
			return s.nullable(gen_schema(rng, d, self, inside));
		case 3:
			return s.with_default(gen_schema(rng, d, self, inside) as any, rng.pick(DEFAULTS) as any);
		case 4:
			return s.message(gen_schema(rng, d, self, inside), 'm');
		case 5: {
			const inner = gen_schema(rng, d, self, inside);
			return s.lazy(() => inner);
		}
		case 6:
		case 7:
			return gen_object(rng, depth, self);
		case 8:
			return s.record(gen_schema(rng, d, self, true));
		case 9:
			return gen_array(rng, depth, self);
		case 10:
			return pipe(s.array(gen_schema(rng, d, self, true)), ...length_steps(rng));
		case 11:
		case 12: {
			// `self` in one option at most: two options that reach the same `lazy`
			// make the library try each on every level of a deep text, which is
			// exponential in its depth
			const length = 1 + rng.int(3);
			const keep = self ? rng.int(length) : -1;
			// so options still share a JSON type, which the stream buffers at every
			// level of the recursion, one more option is a container of the kept
			// one's type that doesn't reach `self`
			const twin = keep !== -1 && length > 1 ? (keep + 1) % length : -1;
			const container = rng.chance(0.5) ? gen_object : gen_array;
			return s.union(
				Array.from({ length }, (_, i) =>
					i === keep && twin !== -1
						? container(rng, d, self)
						: i === twin
							? container(rng, d, null)
							: gen_schema(rng, d, i === keep ? self : null, inside)
				)
			);
		}
		case 13: {
			const values = [...new Set(Array.from({ length: 2 + rng.int(2) }, () => rng.pick(LITERALS)))];
			const key = rng.pick(['t', 'type', 'a']);
			return s.variant(
				key,
				values.map((value) => {
					const entries = gen_entries(rng, depth, self, pick_keys(rng, rng.int(3)));
					return rng.pick([s.object, s.loose_object, s.strip_object])({
						...entries,
						[key]: s.literal(value)
					});
				}) as any
			);
		}
		case 14: {
			// recursive: a lazy that its own arrays and objects hold
			let target: s.AnySchema;
			const lazy = s.lazy(() => target);
			target = rng.chance(0.6)
				? gen_object(rng, depth, lazy, 1)
				: rng.pick([s.array, s.record])(gen_schema(rng, d, lazy, true));
			return lazy;
		}
		default:
			return gen_object(rng, depth, self);
	}
};

/** A schema `to_schema_json` writes: an object most of the time, as most differences are in one. */
const gen_root_schema = (rng: SeededRng): s.AnySchema => {
	for (;;) {
		const schema = rng.chance(0.6) ? gen_object(rng, 4, null, 2) : gen_schema(rng, 4, null);
		try {
			to_schema_json(schema);
			return schema;
		} catch {
			// refused, so try another
		}
	}
};

//
// Texts
//

const NUMBER_TEXTS = [
	'0',
	'-0',
	'1',
	'-1',
	'1.5',
	'-1.5',
	'0.1',
	'1e2',
	'1E2',
	'1e+2',
	'1e-7',
	'2.5e-3',
	'100',
	'1.0',
	'-0.0',
	'2e0',
	'9007199254740991',
	'9007199254740992',
	'9007199254740993',
	'-9007199254740992',
	'1e21',
	'1E+21',
	'1.7976931348623157e308',
	'5e-324',
	'1e-400',
	'123456789012345678901234567890',
	'0.30000000000000004'
];
const INTEGER_TEXTS = [
	'0',
	'-0',
	'1',
	'-1',
	'2',
	'1.0',
	'1e0',
	'1.5',
	'9007199254740991',
	'9007199254740992',
	'9007199254740994',
	'1e21',
	'-1e21'
];
const WRONG_TEXTS = [
	'null',
	'true',
	'false',
	'0',
	'-1.5',
	'""',
	'"x"',
	'[]',
	'{}',
	'[null]',
	'{"a":1}',
	'1e300',
	'[[]]',
	'{"":{}}'
];
const EXTRA_KEYS = ['z', '__proto__', 'constructor', 'toString', '0', 'a', ''];
const RECORD_KEYS = ['k0', 'k1', '', ' ', 'é', '0', '10', '__proto__', 'a"b', 'constructor', '😀'];
const SPACES = [' ', '\n', '\t', '\r\n', '  '];

/** One text being written, and what it has done that decides whether it can be kept. */
interface TextState {
	rng: SeededRng;
	/** The chance of a wrong value in place of any value. */
	wrong: number;
	pretty: boolean;
	escape: boolean;
	/** Whether a key was written twice with a different value first. */
	duplicate: boolean;
	/** How many more values the text can have before each is a short one, so recursion ends. */
	budget: number;
}

const ws = (t: TextState): string => (t.pretty && t.rng.chance(0.5) ? t.rng.pick(SPACES) : '');

const string_text = (t: TextState, value: string): string => {
	if (!t.escape) return JSON.stringify(value);
	let out = '"';
	for (const char of value) {
		if (t.rng.chance(0.5)) {
			for (let i = 0; i < char.length; i++) {
				const hex = char.charCodeAt(i).toString(16).padStart(4, '0');
				out += '\\u' + (t.rng.chance(0.5) ? hex : hex.toUpperCase());
			}
		} else if (char === '/' && t.rng.chance(0.5)) {
			out += '\\/';
		} else {
			out += JSON.stringify(char).slice(1, -1);
		}
	}
	return out + '"';
};

const number_text = (t: TextState, value: number): string => {
	const plain = String(value);
	if (!Number.isInteger(value) || Math.abs(value) >= 1e21 || !t.rng.chance(0.4)) return plain;
	// `00e-1` is not JSON
	return t.rng.pick([`${plain}.0`, `${plain}e0`, value ? `${plain}0e-1` : '0e5', `${plain}E+0`]);
};

const literal_text = (t: TextState, value: s.SchemaLiteral): string => {
	if (typeof value === 'string') return string_text(t, value);
	if (typeof value === 'number') return number_text(t, value);
	return JSON.stringify(value) ?? 'null';
};

const array_text = (t: TextState, items: Array<string>): string =>
	'[' + ws(t) + items.join(ws(t) + ',' + ws(t)) + ws(t) + ']';

const object_text = (t: TextState, pairs: Array<[string, string]>): string =>
	'{' +
	ws(t) +
	pairs
		.map(([key, value]) => string_text(t, key) + ws(t) + ':' + ws(t) + value)
		.join(ws(t) + ',' + ws(t)) +
	ws(t) +
	'}';

const shuffle = <T>(rng: SeededRng, list: Array<T>): void => {
	for (let i = list.length - 1; i > 0; i--) {
		const j = rng.int(i + 1);
		[list[i], list[j]] = [list[j]!, list[i]!];
	}
};

const wrong_text = (t: TextState): string => {
	if (t.rng.chance(0.1)) {
		const depth = t.rng.pick([10, 60, 120]);
		return '['.repeat(depth) + ']'.repeat(depth);
	}
	return t.rng.pick(WRONG_TEXTS);
};

const any_text = (t: TextState, depth: number): string => {
	switch (depth > 3 ? t.rng.int(5) : t.rng.int(7)) {
		case 0:
			return t.rng.pick(['null', 'true', 'false']);
		case 1:
			return t.rng.pick(NUMBER_TEXTS);
		case 2:
		case 3:
			return string_text(t, t.rng.pick(STRINGS));
		case 4:
			return wrong_text(t);
		case 5:
			return array_text(
				t,
				Array.from({ length: t.rng.int(3) }, () => any_text(t, depth + 1))
			);
		default:
			return object_text(
				t,
				[...new Set(Array.from({ length: t.rng.int(3) }, () => t.rng.pick(RECORD_KEYS)))].map(
					(key) => [key, any_text(t, depth + 1)]
				)
			);
	}
};

/** The pairs of an object aimed at `entries`, with keys missing, extra, and written twice. */
const entries_text = (
	t: TextState,
	entries: Record<string, s.AnySchema>,
	depth: number,
	first: Array<[string, string]> = []
): string => {
	const pairs: Array<[string, string]> = [...first];
	for (const [key, schema] of Object.entries(entries)) {
		if (first.some(([k]) => k === key)) continue;
		const r = t.rng.int(100);
		if (r < 80) pairs.push([key, value_text(t, schema, depth + 1)]);
		else if (r < 90) continue;
		else pairs.push([key, 'null']);
	}
	if (t.rng.chance(0.15)) {
		const key = t.rng.pick(EXTRA_KEYS);
		// an extra key that an entry has is not written twice by chance
		if (!pairs.some(([k]) => k === key)) pairs.push([key, any_text(t, depth + 1)]);
	}
	if (t.rng.chance(0.3)) shuffle(t.rng, pairs);
	if (pairs.length && t.rng.chance(0.06)) {
		const [key, value] = t.rng.pick(pairs);
		if (t.rng.chance(0.5)) {
			pairs.push([key, value]);
		} else {
			// a different value first, which the streaming evaluator also checks
			pairs.unshift([key, any_text(t, depth + 1)]);
			t.duplicate = true;
		}
	}
	return object_text(t, pairs);
};

/** The steps of a pipe and every pipe it starts with, and the schema it starts with. */
const flatten_pipe = (schema: s.AnySchema): [s.AnySchema, Array<s.AnySchema>] => {
	let head = schema;
	const steps: Array<s.AnySchema> = [];
	while (head.kind === 'pipe') {
		const def = head.def as Array<s.AnySchema>;
		steps.unshift(...def.slice(1));
		head = def[0]!;
	}
	return [head, steps];
};

const near = (t: TextState, bounds: Array<number>, fallback: number): number => {
	const bound = bounds.length ? t.rng.pick(bounds) : fallback;
	return bound + t.rng.pick([-1, 0, 0, 1, 0.5]);
};

const pipe_text = (t: TextState, schema: s.AnySchema, depth: number): string => {
	const [head, steps] = flatten_pipe(schema);
	if (t.rng.chance(0.3)) return value_text(t, head, depth);
	const bounds = steps
		.filter((step) => typeof step.def === 'number')
		.map((step) => step.def as number);
	if (head.kind === 'string') {
		const length = Math.max(0, Math.floor(near(t, bounds, 1)));
		let value = '';
		while (value.length < length) value += t.rng.pick(['a', 'é', '😀', 'b']);
		return string_text(t, value);
	}
	if (head.kind === 'array') {
		const length = Math.max(0, Math.floor(near(t, bounds, 1)));
		return array_text(
			t,
			Array.from({ length }, () => value_text(t, head.def as s.AnySchema, depth + 1))
		);
	}
	const value = near(t, bounds, 0);
	return t.rng.chance(0.5) ? number_text(t, value) : t.rng.pick(INTEGER_TEXTS);
};

/** A text aimed at `schema`, at `depth` arrays and objects in. */
const value_text = (t: TextState, schema: s.AnySchema, depth: number): string => {
	if (t.rng.chance(t.wrong) || depth > 20 || --t.budget < 0) return wrong_text(t);
	const def: any = schema.def;
	switch (schema.kind) {
		case 'string':
			return string_text(t, t.rng.pick(STRINGS));
		case 'number':
			return t.rng.pick(NUMBER_TEXTS);
		case 'integer':
		case 'safe_integer':
			return t.rng.pick(INTEGER_TEXTS);
		case 'boolean':
			return t.rng.pick(['true', 'false']);
		case 'literal':
			return literal_text(t, def);
		case 'one_of':
			return def.length ? literal_text(t, t.rng.pick(def)) : wrong_text(t);
		case 'optional':
		case 'nullable':
		case 'with_default':
			return t.rng.chance(0.25) ? 'null' : value_text(t, def.schema, depth);
		case 'lazy':
			return value_text(t, def(), depth);
		case 'object':
		case 'loose_object':
		case 'strip_object':
			return entries_text(t, def, depth);
		case 'record':
			return object_text(
				t,
				[...new Set(Array.from({ length: t.rng.int(4) }, () => t.rng.pick(RECORD_KEYS)))].map(
					(key) => [key, value_text(t, def, depth + 1)]
				)
			);
		case 'array':
			return array_text(
				t,
				Array.from({ length: t.rng.int(4) }, () => value_text(t, def, depth + 1))
			);
		case 'union':
			return def.length ? value_text(t, t.rng.pick(def), depth) : any_text(t, depth);
		case 'variant': {
			if (!def.options.length) return any_text(t, depth);
			const option: s.AnySchema = t.rng.pick(def.options);
			// the key first now and then, as a variant reads it before the rest
			const key: string = def.key;
			const first: Array<[string, string]> = t.rng.chance(0.5)
				? [[key, value_text(t, (option.def as any)[key], depth + 1)]]
				: [];
			return entries_text(t, option.def as Record<string, s.AnySchema>, depth, first);
		}
		case 'pipe':
			return pipe_text(t, schema, depth);
		default:
			return any_text(t, depth);
	}
};

//
// Cases
//

/** How deep a text's arrays and objects go, read as a token stream, and where it could be cut. */
const scan_text = (text: string): { depth: number; cuts: Array<number> } => {
	let depth = 0;
	let max = 0;
	let in_string = false;
	const cuts: Array<number> = [];
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (in_string) {
			if (c === '\\') i++;
			else if (c === '"') in_string = false;
		} else if (c === '"') {
			in_string = true;
		} else if (c === '[' || c === '{') {
			max = Math.max(max, ++depth);
			cuts.push(i + 1);
		} else if (c === ']' || c === '}') {
			depth--;
		} else if (c === ',' || c === ':') {
			cuts.push(i + 1);
		}
	}
	return { depth: max, cuts };
};

const TAILS = [' x', ',', ' ]', ' {}', ' 1', '}', ' null', ' //'];

/** Whether `text` matches `schema`, or `null` when it is not JSON, which an aimed text must be. */
const verdict = (schema: s.AnySchema, text: string): boolean | null => {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	return s.is(schema, value);
};

/**
 * A generated group: a random schema the crate carries, and `cases` texts.
 *
 * @param seed - the seed of the run
 * @param index - which group of the seed
 * @param cases - how many texts
 */
export const generate_random_json_fixture = (
	seed: number,
	index = 0,
	cases = GENERATED_JSON_CASES
): JsonFixture => {
	const rng = create_seeded_rng(group_seed(seed, index));
	const schema = gen_root_schema(rng);
	const out: Record<string, JsonFixtureText> = {};
	const text_state = (wrong: number): TextState => ({
		rng,
		wrong,
		pretty: rng.chance(0.2),
		escape: rng.chance(0.2),
		duplicate: false,
		budget: 200
	});
	let n = 0;
	for (let tries = 0; n < cases && tries < cases * 20; tries++) {
		const r = rng.int(100);
		const name = String(n).padStart(2, '0');
		if (r < 75) {
			const t = text_state(rng.pick([0, 0, 0.03, 0.1, 0.3]));
			const text = value_text(t, schema, 0);
			if (scan_text(text).depth > SCHEMA_JSON_MAX_DEPTH) continue;
			const valid = verdict(schema, text);
			if (valid === null || (t.duplicate && valid)) continue;
			// `near` has no wrong value put in, and may still not match
			out[`${name}_${t.wrong ? 'aimed' : 'near'}`] = text;
		} else if (r < 87) {
			// a text that matches, cut short where the crate's parser can't read on
			const t = text_state(0);
			const text = value_text(t, schema, 0);
			const { depth, cuts } = scan_text(text);
			if (depth > SCHEMA_JSON_MAX_DEPTH || !cuts.length || t.duplicate) continue;
			if (verdict(schema, text) !== true) continue;
			out[`${name}_cut`] = text.slice(0, rng.pick(cuts));
		} else {
			// a whole value with something after it, which the streaming
			// evaluator need not read when the value doesn't match
			const t = text_state(rng.pick([0, 0.1, 0.3]));
			const text = value_text(t, schema, 0);
			if (scan_text(text).depth > SCHEMA_JSON_MAX_DEPTH) continue;
			const valid = verdict(schema, text);
			if (valid === null || (t.duplicate && valid)) continue;
			const tail = text + rng.pick(TAILS);
			out[`${name}_tail`] = valid ? tail : { text: tail, diverges: 'malformed_tail' };
		}
		n++;
	}
	return { schema, cases: out };
};
