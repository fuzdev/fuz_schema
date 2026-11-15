import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';
import {
	CONFORMANCE_FLAVORS,
	CONFORMANCE_LIBS,
	type ConformanceFlavor,
	type ConformanceLib
} from './conformance_adapters.ts';
import { find_compile_difference, to_compiled_pair } from './compile_test_helpers.ts';
import { minimize_differential_case } from './differential_classify.ts';
import {
	build_spec,
	gen_input,
	gen_root_spec,
	gen_spec,
	materialize_input,
	source_case,
	type DifferentialInput,
	type DifferentialSpec
} from './differential_generate.ts';
import { create_seeded_rng, type SeededRng } from './seeded_rng.ts';

// `compile_guard` and `compile_parse` against `is` and `parse` over schemas
// and inputs the differential's generator draws, the same seeds and counts on
// every run, each schema built a second time with every `union` a
// `memo_union`, which compiles to other code. A difference is minimized and
// printed as a case to paste.
const SEEDS = [1, 2, 3];
const COUNT = 3000;

const LIBS: Array<[string, ConformanceLib]> = [
	['union', CONFORMANCE_LIBS.fuz_schema],
	['memo_union', { ...CONFORMANCE_LIBS.fuz_schema, union: CONFORMANCE_LIBS.fuz_schema.memo_union }]
];

// how the compiled code of a case differs from the interpreter, or `null`,
// also where the library refuses to build the schema
const difference_of = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	lib: ConformanceLib
): string | null => {
	let schema: s.AnySchema;
	try {
		schema = build_spec(spec, lib);
	} catch {
		return null;
	}
	let pair;
	try {
		pair = to_compiled_pair(schema);
	} catch (error) {
		return 'the compile threw: ' + (error as Error).message;
	}
	return find_compile_difference(pair, () => materialize_input(input));
};

describe('compiled code against the interpreter over generated schemas and inputs', () => {
	for (const seed of SEEDS) {
		test(`seed ${seed}: no difference, with unions and with memo_unions`, () => {
			const rng = create_seeded_rng(seed);
			for (let n = 0; n < COUNT; n++) {
				const spec = gen_root_spec(rng);
				const input = gen_input(rng, spec);
				for (const [name, lib] of LIBS) {
					const found = difference_of(spec, input, lib);
					if (!found) continue;
					// the smallest case with a difference of the same kind
					const kind = found.slice(0, found.indexOf(':'));
					const [min_spec, min_input] = minimize_differential_case(
						spec,
						input,
						(sp, i) => !!difference_of(sp, i, lib)?.startsWith(kind),
						1500
					);
					assert.fail(
						`case ${n}, with every union a ${name}: ${difference_of(min_spec, min_input, lib)}\n` +
							source_case(min_spec, min_input)
					);
				}
			}
		}, 30_000);
	}
});

// Recursive unions, which the generator above doesn't draw: the family of
// `schema.differential.test.ts`'s `memo_union` test, `N = lazy(() =>
// U(options))`, each option an object whose recursive entry `x` comes before
// the `literal` tag `t`, or a leaf, over inputs that are trees reusing nodes,
// so a kept verdict is read back and an output is shared. Built with `union`
// and with `memo_union`, each held to the interpreter's own run of it.
const FAMILY_COUNT = 300;
const FAMILY_DEPTH = 5;
const FAMILY_TAGS = ['a', 'b', 'c', 1];

type FamilySlot = 'array' | 'self' | 'optional' | 'nullable' | 'record';
const FAMILY_SLOTS: Array<FamilySlot> = [
	'array',
	'array',
	'self',
	'optional',
	'nullable',
	'record'
];

type FamilyOption =
	| { t: 'leaf'; spec: DifferentialSpec }
	| {
			t: 'node';
			flavor: ConformanceFlavor;
			slot: FamilySlot;
			d: DifferentialSpec | null;
			tag: string | number;
			/** whether the `literal` comes before the entry that reads on */
			first: boolean;
	  };

const gen_family_options = (rng: SeededRng): Array<FamilyOption> =>
	Array.from({ length: 2 + rng.int(2) }, (): FamilyOption =>
		rng.chance(0.2)
			? { t: 'leaf', spec: gen_spec(rng, 1) }
			: {
					t: 'node',
					flavor: rng.pick(CONFORMANCE_FLAVORS),
					slot: rng.pick(FAMILY_SLOTS),
					d: rng.chance(0.4) ? gen_spec(rng, 1) : null,
					tag: rng.pick(FAMILY_TAGS),
					first: rng.chance(0.5)
				}
	);

const build_family = (
	options: Array<FamilyOption>,
	union: (options: Array<s.AnySchema>) => s.AnySchema
): s.AnySchema => {
	const l = CONFORMANCE_LIBS.fuz_schema;
	const N: s.AnySchema = s.lazy(() => inner);
	const slots: Record<FamilySlot, s.AnySchema> = {
		array: s.array(N),
		self: N,
		optional: s.optional(N),
		nullable: s.nullable(N),
		record: s.record(N)
	};
	const inner = union(
		options.map((o) =>
			o.t === 'leaf'
				? build_spec(o.spec, l)
				: l[o.flavor]({
						...(o.first ? { t: s.literal(o.tag) } : {}),
						x: slots[o.slot],
						...(o.d ? { d: build_spec(o.d, l) } : {}),
						...(o.first ? {} : { t: s.literal(o.tag) })
					})
		)
	);
	return N;
};

const gen_family_input = (
	rng: SeededRng,
	options: Array<FamilyOption>,
	depth: number,
	made: Array<unknown>
): unknown => {
	if (made.length && rng.chance(0.3)) return rng.pick(made);
	const o = rng.pick(options);
	if (o.t === 'leaf' || depth <= 0) {
		const leaves = options.flatMap((p) => (p.t === 'leaf' ? [p.spec] : []));
		const spec = o.t === 'leaf' ? o.spec : rng.pick([...leaves, { t: 'number' } as const]);
		return materialize_input(gen_input(rng, spec));
	}
	const child = (): unknown => gen_family_input(rng, options, depth - 1, made);
	const x =
		o.slot === 'array'
			? Array.from({ length: rng.int(3) }, child)
			: o.slot === 'record'
				? Object.fromEntries(Array.from({ length: rng.int(3) }, (_, i) => ['k' + i, child()]))
				: rng.chance(0.15)
					? rng.pick([undefined, null])
					: child();
	const node: Record<string, unknown> = { x };
	if (o.d && rng.chance(0.8)) node.d = materialize_input(gen_input(rng, o.d));
	node.t = rng.chance(0.8) ? o.tag : rng.pick(FAMILY_TAGS);
	made.push(node);
	return node;
};

describe('compiled code against the interpreter over recursive unions and inputs that reuse nodes', () => {
	for (const seed of SEEDS) {
		test(`seed ${seed}: no difference, as a memo_union, as a union where it compiles, and each under a union that probes it`, () => {
			const rng = create_seeded_rng(seed);
			let refused = 0;
			let compiled = 0;
			for (let n = 0; n < FAMILY_COUNT; n++) {
				const options = gen_family_options(rng);
				const input = gen_family_input(rng, options, FAMILY_DEPTH, []);
				for (const union of [s.union, s.memo_union]) {
					const schema = build_family(options, union as any);
					// a `union` the library can walk in exponential time is refused, and a
					// `memo_union` never
					try {
						compile_guard(schema);
						compiled++;
					} catch (error) {
						assert.strictEqual(union, s.union, `case ${n}`);
						assert.match((error as Error).message, /^cannot compile `union` at \/def\(\): two/);
						assert.throws(() => compile_parse(schema), (error as Error).message);
						refused++;
						continue;
					}
					// alone, under a union of one option, which probes it, and twice in
					// one input, where an output can be shared
					for (const [name, of_case, value] of [
						['alone', schema, input],
						['probed', s.union([schema]), input],
						['twice', s.array(schema), [input, input]],
						['twice and probed', s.union([s.array(schema), s.string]), [input, input]]
					] as const) {
						const found = find_compile_difference(to_compiled_pair(of_case), () => value);
						assert.isNull(
							found,
							`case ${n}, ${union === s.union ? 'union' : 'memo_union'}, ${name}`
						);
					}
				}
			}
			// both are drawn: unions that compile, past the `memo_union` of each, and unions refused
			assert.isAbove(compiled, FAMILY_COUNT + FAMILY_COUNT / 10);
			assert.isAbove(refused, FAMILY_COUNT / 10);
		}, 30_000);
	}
});

// Wide schemas of a consumer's kind, which neither generator above draws:
// objects of many entries, each with a `check`, a `transform`, or a `regex`
// of its own, so a schema holds as many captured values as it has entries,
// defaults beside them, nested `strip_object`s, one schema under two keys,
// and a `one_of` on either side of the size where its test changes form.
// What the emitter does by a count is crossed here: the names it makes
// against the captured values', the values of a `one_of`, and the places
// that hold one schema, a union handed its key among them.
const WIDE_COUNT = 150;
const WIDE_UUID = '550e8400-e29b-41d4-a716-446655440000';

type Wide = [schema: s.AnySchema, valid: () => unknown];

const gen_wide_entry = (rng: SeededRng, depth: number, i: number): Wide => {
	const kinds = ['check', 'checks', 'regex', 'transform', 'lower', 'default', 'default_fn'];
	kinds.push('optional', 'one_of', 'uuid', 'to_integer', 'check', 'regex', 'present');
	if (depth > 0) kinds.push('nested', 'array', 'union', 'record');
	switch (rng.pick(kinds)) {
		case 'check':
			return [
				s.pipe(
					s.string,
					s.check((v: string) => v.length < 9 + i)
				),
				() => 'abc'
			];
		case 'checks':
			return [
				s.pipe(
					s.number,
					s.check((v: number) => v > -1 - i),
					s.check((v: number) => v < 100 + i)
				),
				() => i
			];
		case 'regex':
			return [s.pipe(s.string, s.regex(new RegExp(`^[a-z]{1,${3 + i}}$`))), () => 'ab'];
		case 'transform':
			return [
				s.pipe(
					s.string,
					s.transform((v: string) => v.trim() + (i % 2 ? '' : '!'))
				),
				() => (rng.chance(0.5) ? ' ab ' : 'ab')
			];
		case 'lower':
			return [
				s.pipe(s.string, s.to_lower_case, s.min_length(1)),
				() => (rng.chance(0.5) ? 'Ab' : 'ab')
			];
		case 'default':
			return [s.with_default(s.number, i), () => (rng.chance(0.5) ? undefined : 5)];
		case 'default_fn':
			return [s.with_default_fn(s.array(s.string), () => ['made']), () => undefined];
		case 'optional':
			return [s.optional(s.boolean), () => (rng.chance(0.5) ? undefined : true)];
		case 'one_of': {
			// on either side of the size where the values are tested one by one
			const values: Array<s.SchemaLiteral> = Array.from(
				{ length: 9 + rng.int(8) },
				(_, j) => 'v' + j
			);
			if (rng.chance(0.3)) values.push(NaN);
			const defined = values.slice();
			// with `undefined`, which a missing key is not
			if (rng.chance(0.3)) values.push(undefined);
			return [s.one_of(values), () => rng.pick(defined)];
		}
		case 'present':
			// a union that is handed its key, as an option of it tells a missing key from `undefined`
			return [
				s.union([
					s.literal(undefined),
					s.pipe(
						s.string,
						s.check((v: string) => v !== 'no' + i)
					)
				]),
				() => 'abc'
			];
		case 'uuid':
			return [s.pipe(s.string, s.uuid), () => WIDE_UUID];
		case 'to_integer':
			return [s.pipe(s.string, s.to_integer(), s.min_value(i)), () => String(i + 3)];
		case 'nested':
			return gen_wide_object(rng, depth - 1);
		case 'array': {
			const [item, valid] = gen_wide_object(rng, depth - 1);
			return [s.array(item), () => [valid(), valid()]];
		}
		case 'record': {
			const [value, valid] = gen_wide_object(rng, depth - 1);
			return [s.record(value), () => ({ r: valid() })];
		}
		default: {
			const [option, valid] = gen_wide_object(rng, depth - 1);
			return [
				s.union([
					s.pipe(
						s.string,
						s.check((v: string) => v !== 'no' + i)
					),
					option
				]),
				valid
			];
		}
	}
};

const gen_wide_object = (rng: SeededRng, depth: number): Wide => {
	const entries: Record<string, s.AnySchema> = {};
	const valids: Record<string, () => unknown> = {};
	const width = 1 + rng.int(depth > 1 ? 8 : 24);
	for (let i = 0; i < width; i++) {
		// one schema under two keys, now and then
		const shared = i && rng.chance(0.15) ? 'k' + rng.int(i) : null;
		const [schema, valid] = shared
			? ([entries[shared], valids[shared]] as Wide)
			: gen_wide_entry(rng, depth, i);
		entries['k' + i] = schema;
		valids['k' + i] = valid;
	}
	const flavor = rng.pick([s.strip_object, s.strip_object, s.object, s.loose_object]);
	return [
		flavor(entries),
		() => {
			const value: Record<string, unknown> = {};
			for (const key of Object.keys(valids)) {
				const of_key = valids[key]!();
				if (of_key !== undefined) value[key] = of_key;
			}
			return value;
		}
	];
};

// a change of a value that matched, somewhere in it: a key added, a key
// dropped, or a value that is another's
const vary_wide = (rng: SeededRng, value: any): void => {
	const keys = Object.keys(value);
	const key = keys.length ? rng.pick(keys) : undefined;
	const at = key === undefined ? undefined : value[key];
	if (at !== null && typeof at === 'object' && rng.chance(0.6)) {
		vary_wide(rng, Array.isArray(at) && at.length ? at[0] : at);
	} else if (key === undefined || rng.chance(0.3)) value.extra_key = 1;
	else if (rng.chance(0.4)) delete value[key];
	else value[key] = rng.pick(['NO', 7, null, {}, 'v99', '  ', undefined]);
};

describe('compiled code against the interpreter over wide schemas of distinct functions', () => {
	for (const seed of SEEDS) {
		test(`seed ${seed}: no difference, alone, in a pipe, and as an array’s item`, () => {
			const rng = create_seeded_rng(seed);
			for (let n = 0; n < WIDE_COUNT; n++) {
				const [object, valid] = gen_wide_object(rng, 2);
				const inputs = [valid(), valid(), valid(), valid()];
				for (const input of inputs.slice(1)) vary_wide(rng, input);
				const schema = rng.pick([
					object,
					s.pipe(
						object,
						s.check((v: unknown) => v !== null)
					),
					s.array(object)
				]);
				const pair = to_compiled_pair(schema);
				for (const [i, input] of inputs.entries()) {
					const value = schema.kind === 'array' ? [input, structuredClone(inputs[0])] : input;
					const found = find_compile_difference(pair, () => structuredClone(value));
					assert.isNull(found, `case ${n}, input ${i}`);
				}
			}
		}, 30_000);
	}
});
