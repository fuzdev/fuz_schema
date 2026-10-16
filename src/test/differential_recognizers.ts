/**
 * The disagreements of zod and valibot the differential tells apart, each by
 * its row of `SIDES`: where a rule brings one out, exactly one entry of
 * `SPLIT_RECOGNIZERS` must recognize it, and this library's result is held to
 * that of the row's side.
 *
 * @module
 */

import { render_shape, render_value } from './conformance_test_helpers.ts';
import {
	SIDES,
	type ConformanceDifferencesRow,
	type ConformanceSidesRow
} from './conformance_tables.ts';
import {
	map_spec_children,
	type DifferentialEntries,
	type DifferentialInput,
	type DifferentialResult,
	type DifferentialRun,
	type DifferentialSpec
} from './differential_generate.ts';
import {
	LENGTH_AND_VALUE_STEPS,
	PIPE_STEPS,
	RENAMED_PROTO,
	WRAPPERS,
	is_bare_transform,
	is_index,
	is_object,
	names_entry,
	rewrite_input,
	rewrite_missing_keys,
	structures,
	unwrap_messages,
	value_at,
	walk_path,
	without_touched,
	type DifferentialInherited,
	type DifferentialPath
} from './differential_rules.ts';

/**
 * A disagreement of zod and valibot that a row of `SIDES` records, told apart
 * where a rule brings one out: ours is held to the result of the row's side.
 */
export interface SplitRecognizer {
	/** The row of `SIDES`, whose side is read when a case is classified. */
	row: ConformanceSidesRow;
	/** The row of `DIFFERENCES` that combines it with a declared one, a case of the matrix. */
	combination: ConformanceDifferencesRow;
	/** Whether zod and valibot differ on a case only where the row's disagreement shows. */
	at: (
		spec: DifferentialSpec,
		input: DifferentialInput,
		zod: DifferentialResult,
		valibot: DifferentialResult,
		run: DifferentialRun
	) => boolean;
	/** Of a `neither` row, the result ours is held to, as the row says. */
	neither?: (
		spec: DifferentialSpec,
		input: DifferentialInput,
		run: DifferentialRun
	) => DifferentialResult;
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
	input: DifferentialInput,
	run: DifferentialRun
): boolean =>
	run('zod', spec, input).text === to.text && run('valibot', spec, input).text === to.text;

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

// the default of a schema, under its messages, `nullable`s and `lazy`s, taken
// out, the same where it reaches none
const without_held_default = (spec: DifferentialSpec): DifferentialSpec => {
	if (spec.t === 'message' || spec.t === 'nullable' || spec.t === 'lazy') {
		const of = without_held_default(spec.of);
		return of === spec.of ? spec : { ...spec, of };
	}
	return is_default(spec) ? (spec as { of: DifferentialSpec }).of : spec;
};

// each default of a value but `undefined` made to take its value as it is,
// as zod does, by a `one_of` of it before its schema
const without_default_as_is = (spec: DifferentialSpec): DifferentialSpec =>
	map_spec(spec, (s) =>
		(s.t === 'default' || s.t === 'default_fn') && s.v !== undefined
			? { ...s, of: { t: 'union', of: [{ t: 'one_of', vs: [s.v] }, s.of] } }
			: null
	);

// a schema with the defaults it reaches without a structure taken out:
// under a wrapper, as an option of a union, or at the start of a pipe
const without_head_defaults = (spec: DifferentialSpec): DifferentialSpec => {
	if (is_default(spec)) return without_head_defaults((spec as { of: DifferentialSpec }).of);
	if (spec.t === 'union' || WRAPPERS.has(spec.t)) {
		return map_spec_children(spec, without_head_defaults);
	}
	return spec;
};

// each `with_default` of `undefined` an `optional`, as valibot reads it, which
// gives `undefined` for a missing key and runs its schema only on a value, so
// the defaults that schema reaches without a structure taken out
const without_default_of_undefined = (spec: DifferentialSpec): DifferentialSpec =>
	map_spec(spec, (s) =>
		s.t === 'default' && s.v === undefined
			? { t: 'optional', of: without_head_defaults(s.of) }
			: null
	);

// the length of a string in code points, as zod's `max_length` counts it
const code_points = (value: string): number =>
	value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;

// whether a value has a key at `path`, own or inherited
const has_path = (value: unknown, path: DifferentialPath): boolean => {
	const holder = value_at(value, path.slice(0, -1));
	const key = path.at(-1);
	return is_object(holder) && key !== undefined && key in holder;
};

// the paths at which two values differ, as `render_value` writes them: a key
// one has and the other not, or a value not the same
const differing_paths = (
	a: unknown,
	b: unknown,
	path: DifferentialPath = [],
	out: Array<DifferentialPath> = []
): Array<DifferentialPath> => {
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
		path: DifferentialPath;
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

// whether a schema reaches a `transform` as it is, under a `nullable`, a
// `lazy`, or a `message`, or as an option of a `union`
const reaches_transform = (spec: DifferentialSpec): boolean => {
	if (spec.t === 'transform') return true;
	if (spec.t === 'nullable' || spec.t === 'lazy' || spec.t === 'message') {
		return reaches_transform(spec.of);
	}
	return spec.t === 'union' && spec.of.some(reaches_transform);
};

// whether an entry, past its messages, is a schema of `kind` that holds a
// transform it reaches, so the outermost of a `union`, a `nullable`, and a
// `lazy` names the entry's row
const is_transform_under =
	(kind: 'union' | 'nullable' | 'lazy') =>
	(spec: DifferentialSpec): boolean => {
		const head = unwrap_messages(spec);
		return head.t === kind && reaches_transform(head);
	};

// whether zod's result is valibot's given the missing keys of the entries
// `needs` names, and a key valibot then writes as `undefined` left out, as
// zod leaves out a key whose entry gives `undefined`
const valibot_given_keys = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	zod: DifferentialResult,
	run: DifferentialRun,
	needs: (entry: DifferentialSpec) => boolean
): boolean => {
	const { input: given, touched } = rewrite_missing_keys(spec, input, needs);
	if (given === input) return false;
	const valibot = run('valibot', spec, given);
	if (valibot.text === zod.text) return true;
	const left_out = touched.filter(
		(t) => value_at(valibot.value, t) === undefined && !has_path(zod.value, t)
	);
	return (
		zod.ok &&
		valibot.ok &&
		render_value(without_touched(valibot.value, left_out)) === render_value(zod.value)
	);
};

// whether a schema reaches an `unknown` under steps of a pipe, a `nullable`,
// a `lazy`, or a `message`
const reaches_unknown = (spec: DifferentialSpec): boolean => {
	if (spec.t === 'unknown') return true;
	if (
		spec.t === 'nullable' ||
		spec.t === 'lazy' ||
		spec.t === 'message' ||
		PIPE_STEPS.has(spec.t)
	) {
		return reaches_unknown((spec as { of: DifferentialSpec }).of);
	}
	return false;
};

// the schema a pipe starts with, as the entry itself or under a `message`,
// through every pipe that is its first schema, `null` where it is no pipe
const pipe_start = (spec: DifferentialSpec): DifferentialSpec | null => {
	let head = unwrap_messages(spec);
	if (!PIPE_STEPS.has(head.t)) return null;
	while (PIPE_STEPS.has(head.t)) head = unwrap_messages((head as { of: DifferentialSpec }).of);
	return head;
};

// whether a pipe starts with an `optional`
const is_pipe_from_optional = (spec: DifferentialSpec): boolean =>
	pipe_start(spec)?.t === 'optional';

// whether a pipe starts with a `transform`
const is_pipe_from_transform = (spec: DifferentialSpec): boolean =>
	pipe_start(spec)?.t === 'transform';

// the finite number an infinity is given as, and its sign
const FINITE = Number.MAX_VALUE;

// each infinity that is the value of an own `__proto__` key of a `record`
// input, renamed as `record_own_proto` renames it, given as `FINITE` of its
// sign, the same input where it has none
const without_proto_infinities = (input: DifferentialInput): DifferentialInput => {
	const entries = (list: DifferentialEntries, at_key: boolean): DifferentialEntries => {
		const next = list.map(([key, x]): [string, DifferentialInput] => [
			key,
			at_key && key === RENAMED_PROTO && x.t === 'v' && (x.v === Infinity || x.v === -Infinity)
				? { t: 'v', v: x.v > 0 ? FINITE : -FINITE }
				: without_proto_infinities(x)
		]);
		return next.some(([, x], i) => x !== list[i]![1]) ? next : list;
	};
	switch (input.t) {
		case 'v':
			return input;
		case 'arr': {
			const items = input.items.map((x) => x && without_proto_infinities(x));
			const extra = entries(input.extra, false);
			return items.some((x, i) => x !== input.items[i]) || extra !== input.extra
				? { ...input, items, extra }
				: input;
		}
		case 'obj': {
			const own = entries(input.own, true);
			const proto = entries(input.proto, false);
			const hidden = entries(input.hidden, false);
			const symbol = input.symbol && without_proto_infinities(input.symbol);
			return own !== input.own ||
				proto !== input.proto ||
				hidden !== input.hidden ||
				symbol !== input.symbol
				? { ...input, own, proto, hidden, symbol }
				: input;
		}
	}
};

const RECOGNIZERS: Array<SplitRecognizer> = [
	// an own key named `constructor` or `prototype` an object doesn't name:
	// zod validates it and keeps it, valibot leaves it out unread
	{
		row: 'unknown key named constructor / loose',
		combination: 'loose, a bare check entry, key missing, an unknown key named constructor',
		at: (spec, input, _zod, valibot, run) => {
			const without = without_own_named(spec, input, false);
			return without !== input && both_give(valibot, spec, without, run);
		}
	},
	{
		row: 'record, own key named prototype, wrong',
		combination: 'a check after a record, class instance, own key named prototype, wrong',
		at: (spec, input, _zod, valibot, run) => {
			const without = without_own_named(spec, input, true);
			return without !== input && both_give(valibot, spec, without, run);
		}
	},
	// an enumerable key the input inherits that an object doesn't name: zod
	// copies it, valibot drops it, and an input that comes back still inherits
	// it
	{
		row: 'unknown inherited key / loose',
		combination: 'loose, a bare check entry, key missing, an unknown inherited key',
		at: (spec, input, _zod, valibot, run) => {
			const without = without_inherited(spec, input);
			return without !== input && both_give(valibot, spec, without, run);
		},
		neither: (spec, input, run) => run('zod', spec, without_inherited(spec, input)),
		inherited: true
	},
	// a default under an optional: zod fills it in
	{
		row: 'optional(default) entry, key undefined / *',
		combination: 'a bare check entry and an optional(default) entry, keys missing',
		at: (spec, input, _zod, valibot, run) => {
			const without = map_spec(spec, (s) =>
				s.t === 'optional' && is_default(unwrap_messages(s.of))
					? { ...s, of: without_default(s.of) }
					: null
			);
			if (without !== spec && both_give(valibot, without, input, run)) return true;
			// or under a `nullable` or a `lazy` the optional holds
			const held = map_spec(spec, (s) => {
				if (s.t !== 'optional') return null;
				const of = without_held_default(s.of);
				return of === s.of ? null : { ...s, of };
			});
			return held !== spec && held !== without && both_give(valibot, held, input, run);
		}
	},
	// a default of `undefined`: zod writes the missing key
	{
		row: 'default of undefined entry, key missing / *',
		combination: 'a bare check entry and a default of undefined entry, keys missing',
		at: (spec, input, _zod, valibot, run) => {
			const without = without_default_of_undefined(spec);
			return without !== spec && both_give(valibot, without, input, run);
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
		at: (spec, input, zod, _valibot, run) => {
			const without = without_default_as_is(spec);
			return without !== spec && both_give(zod, without, input, run);
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
	// a pipe from an optional as the entry, its key missing: zod runs its steps
	// and writes what they give, valibot runs none and leaves the key out
	{
		row: 'optional(string) then a transform to "T" entry, key missing / *',
		combination:
			'a bare check entry and an optional(string) then a transform to "T" entry, keys missing',
		at: (spec, _input, zod, valibot) =>
			differs_only_at(
				spec,
				zod,
				valibot,
				(at) =>
					!at.has.input &&
					at.has.zod &&
					!at.has.valibot &&
					!!at.chain[0] &&
					is_pipe_from_optional(at.chain[0])
			)
	},
	// a bare transform, its key missing: zod runs it, valibot needs the key
	{
		row: 'bare transform to "T" entry, key missing / *',
		combination: 'union[string, object of a bare check and a bare transform], keys missing',
		at: (spec, input, zod, _valibot, run) =>
			valibot_given_keys(spec, input, zod, run, is_bare_transform)
	},
	// a transform under a union, a nullable, or a lazy, its key missing: zod
	// runs it, valibot needs the key
	{
		row: 'union[string, bare transform to "T"] entry, key missing / *',
		combination:
			'union[string, object of a bare check and a union[string, bare transform to "T"]], keys missing',
		at: (spec, input, zod, _valibot, run) =>
			valibot_given_keys(spec, input, zod, run, is_transform_under('union'))
	},
	{
		row: 'nullable(bare transform to "T") entry, key missing / *',
		combination:
			'union[string, object of a bare check and a nullable(bare transform to "T")], keys missing',
		at: (spec, input, zod, _valibot, run) =>
			valibot_given_keys(spec, input, zod, run, is_transform_under('nullable'))
	},
	{
		row: 'lazy(bare transform to "T") entry, key missing / *',
		combination:
			'union[string, object of a bare check and a lazy(bare transform to "T")], keys missing',
		at: (spec, input, zod, _valibot, run) =>
			valibot_given_keys(spec, input, zod, run, is_transform_under('lazy'))
	},
	// a pipe that starts with a transform, its key missing: zod runs it,
	// valibot needs the key
	{
		row: 'transform to "T" then a transform entry, key missing / *',
		combination:
			'a check after an object of a bare check and a transform then a check that fails, keys missing',
		at: (spec, input, zod, _valibot, run) =>
			valibot_given_keys(spec, input, zod, run, is_pipe_from_transform)
	},
	// a check after an object with an unknown key: zod runs it, valibot stops
	{
		row: 'a check after an object with an unknown key',
		combination: 'a check after a strict object of a bare check entry, key missing, an unknown key',
		at: (spec, input, _zod, valibot, run) => {
			if (valibot.parsed?.ok !== false || !valibot.parsed.unknown_keys.length) return false;
			const without = map_spec(spec, (s) =>
				LENGTH_AND_VALUE_STEPS.has(s.t) && structures((s as { of: DifferentialSpec }).of).length
					? (s as { of: DifferentialSpec }).of
					: null
			);
			return without !== spec && both_give(valibot, without, input, run);
		}
	},
	// a check after an object whose missing key is an `unknown`'s, then a check
	// that fails: zod runs both checks, valibot refuses the key and stops. Given
	// the key, valibot runs them too, and gives zod's result
	{
		row: 'a check after an object of unknown then a check that fails, key missing',
		combination:
			'a check after an object of a bare check and unknown then a check that fails, keys missing',
		at: (spec, input, zod, valibot, run) => {
			if (zod.ok || valibot.ok) return false;
			const { input: given } = rewrite_missing_keys(spec, input, reaches_unknown);
			return given !== input && both_give(zod, spec, given, run);
		}
	},
	// a default zod fills in as it is and valibot runs through its schema, and
	// an own key named `constructor` or `prototype` zod keeps and valibot drops
	{
		row: 'loose, a default of a transform, an unknown key named constructor',
		combination:
			'loose, a bare check entry, key missing, a default of a transform, an unknown key named constructor',
		at: (spec, input, zod, valibot, run) => {
			const spec_without = without_default_as_is(spec);
			const input_without = without_own_named(spec, input, false);
			if (spec_without === spec || input_without === input) return false;
			// each library sees its trigger and not the other's, and they agree
			// without both
			return (
				run('zod', spec_without, input).text === zod.text &&
				run('zod', spec, input_without).text !== zod.text &&
				run('valibot', spec, input_without).text === valibot.text &&
				run('valibot', spec_without, input).text !== valibot.text &&
				run('zod', spec_without, input_without).text ===
					run('valibot', spec_without, input_without).text
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
		at: (spec, input, _zod, valibot, run) => {
			const spec_without = without_default_of_undefined(spec);
			const input_without = without_own_named(spec, input, false);
			return (
				spec_without !== spec &&
				input_without !== input &&
				!both_give(valibot, spec_without, input, run) &&
				!both_give(valibot, spec, input_without, run) &&
				both_give(valibot, spec_without, input_without, run)
			);
		},
		neither: (spec, input, run) => run('zod', without_default_of_undefined(spec), input)
	},
	// a default zod fills in as it is and valibot runs through its schema, and
	// a default of `undefined` zod writes the missing key of, which valibot
	// leaves out: ours goes with zod on the one, and with valibot on the other
	{
		row: 'a default of a wrong value entry and a default of undefined entry, keys missing / *',
		combination:
			'union[string, object of a default of a wrong value, a bare check, and a default of undefined], keys missing',
		neither: (spec, input, run) => run('zod', without_default_of_undefined(spec), input),
		at: (spec, input, _zod, _valibot, run) => {
			const without_undefined = without_default_of_undefined(spec);
			const without_as_is = without_default_as_is(spec);
			if (without_undefined === spec || without_as_is === spec) return false;
			// each library sees each trigger, and they agree without both
			const agree = (s: DifferentialSpec): boolean =>
				run('zod', s, input).text === run('valibot', s, input).text;
			return (
				!agree(without_undefined) &&
				!agree(without_as_is) &&
				agree(without_default_as_is(without_undefined))
			);
		}
	},
	// a length check after an array too long whose item fails: zod reports the
	// length, valibot the item
	{
		row: 'a max_length after an array too long, an item wrong',
		combination:
			'a max_length after an array too long, an item with an own key named prototype, a max_length after an array too long, an item wrong',
		at: (spec, input, _zod, valibot, run) => {
			const without = map_spec(spec, (s) =>
				s.t === 'max_length' && s.of.t === 'array' ? s.of : null
			);
			return without !== spec && both_give(valibot, without, input, run);
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
	// an infinity, the value of an own `__proto__` key of a record: zod's
	// `number` refuses it, valibot's takes it. Given a finite number, both
	// give valibot's result, with the number
	{
		row: 'number, Infinity',
		combination:
			'union[record(number), transform to undefined], own __proto__ key whose value is Infinity',
		at: (spec, input, _zod, valibot, run) => {
			const finite = without_proto_infinities(input);
			if (finite === input) return false;
			const to = valibot.text.replaceAll('Infinity', String(FINITE));
			return run('zod', spec, finite).text === to && run('valibot', spec, finite).text === to;
		}
	},
	// an array given to a record: valibot takes it as an object
	{
		row: 'record, array',
		combination:
			'union[array(max_length(string, 1)), record(string)] entry, an array of a surrogate pair, beside a key missing',
		at: (spec, input, _zod, valibot, run) => {
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
									...array.items.flatMap((item, i): DifferentialEntries =>
										item ? [[String(i), item]] : []
									),
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
			return without !== input && both_give(valibot, spec, without, run);
		}
	}
];

/**
 * The disagreements of zod and valibot the differential tells apart, each
 * by its row of `SIDES`. Where a rule brings one out, exactly one must
 * recognize it, and ours is held to the result of its row's side.
 */
export const SPLIT_RECOGNIZERS: ReadonlyArray<SplitRecognizer> = Object.freeze(RECOGNIZERS);

/** The result ours is held to, of a disagreement one entry of `SPLIT_RECOGNIZERS` recognized. */
export interface DifferentialSideHeld {
	result: DifferentialResult;
	inherited: DifferentialInherited;
}

/**
 * What `split_side` found of a disagreement of zod and valibot: no entry of
 * `SPLIT_RECOGNIZERS` that recognizes it, several, or one, with the result
 * ours is held to, `null` where the side of its row holds ours to none.
 */
export type DifferentialSplit =
	| { kind: 'none' }
	| { kind: 'several'; rows: Array<ConformanceSidesRow> }
	| { kind: 'one'; row: ConformanceSidesRow; held: DifferentialSideHeld | null };

/**
 * Which entries of `SPLIT_RECOGNIZERS` recognize a disagreement of zod and
 * valibot on a case, and where exactly one does, the result ours is held to:
 * that of the side of its row.
 */
export const split_side = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	zod: DifferentialResult,
	valibot: DifferentialResult,
	run: DifferentialRun
): DifferentialSplit => {
	const found = SPLIT_RECOGNIZERS.filter((entry) => entry.at(spec, input, zod, valibot, run));
	if (!found.length) return { kind: 'none' };
	if (found.length > 1) return { kind: 'several', rows: found.map((entry) => entry.row) };
	const entry = found[0]!;
	return { kind: 'one', row: entry.row, held: side_held(entry, spec, input, zod, valibot, run) };
};

const side_held = (
	entry: SplitRecognizer,
	spec: DifferentialSpec,
	input: DifferentialInput,
	zod: DifferentialResult,
	valibot: DifferentialResult,
	run: DifferentialRun
): DifferentialSideHeld | null => {
	switch (SIDES[entry.row].side) {
		case 'zod':
			return { result: zod, inherited: null };
		case 'valibot':
			return { result: valibot, inherited: null };
		case 'neither':
			return entry.neither
				? {
						result: entry.neither(spec, input, run),
						inherited: entry.inherited ? 'neither_inherited' : null
					}
				: null;
		case 'both':
			return null;
	}
};
