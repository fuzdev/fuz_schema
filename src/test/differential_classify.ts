/**
 * The differential: schemas and inputs generated from a seed, run through
 * zod, valibot and this library by the adapters of the conformance matrix,
 * and each result classified by the tables of `conformance_tables.ts`.
 *
 * A case is one of:
 * - `agree`: this library's result is zod's, and zod's is valibot's
 * - `declared`: zod and valibot agree, this library doesn't, and the rules
 *   of `differential_rules.ts` explain it, each a rule of one declared
 *   difference
 * - `undeclared`: zod and valibot agree, and the rules don't explain this
 *   library's result. It is minimized and printed as a case for the matrix
 * - `sides`: zod and valibot disagree, tallied by whose result this
 *   library's is. Reported, never a failure
 * - `refused`: zod or valibot threw, building the schema or parsing
 * - `throws`: this library threw
 *
 * Every case is also run through this library's invariants: the input is not
 * mutated, every issue is the five fields, `is` agrees with `parse`, a second
 * parse gives the same result, and the context's count is kept. A schema with
 * a `union` is built again with every `union` a `memo_union`, which must give
 * the same: the result of `parse`, and `is`, alone and under a `union` of one
 * option, which probes it.
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
	CONFORMANCE_LIBS,
	type ConformanceLibName,
	type ConformanceParsed
} from './conformance_adapters.ts';
import { render_parsed, render_value, render_whole } from './conformance_test_helpers.ts';
import type { ConformanceSidesRow } from './conformance_tables.ts';
import {
	build_spec,
	create_differential_run,
	differential_error_line,
	gen_input,
	gen_root_spec,
	materialize_input,
	obj_in,
	run_differential_case,
	show_input,
	show_spec,
	source_case,
	spec_has_kind,
	value_in,
	type DifferentialEntries,
	type DifferentialInput,
	type DifferentialKind,
	type DifferentialObjectSpec,
	type DifferentialResult,
	type DifferentialResults,
	type DifferentialRun,
	type DifferentialSpec
} from './differential_generate.ts';
import {
	ALL_RULES,
	DIFFERENTIAL_RULES,
	LENGTH_AND_VALUE_STEPS,
	NO_RULES,
	RELAXATIONS,
	RENAMED_PROTO,
	WRAPPERS,
	collect_input_objects,
	drop_before_check,
	drop_before_check_at,
	entry_specs,
	holder_returned,
	holds_no_proto,
	is_bare_transform,
	is_index,
	is_object,
	left_unread,
	path_text,
	reaches_check,
	rewrite_missing_keys,
	rewrite_prototypes,
	rewrite_record_proto,
	rewrite_record_symbols,
	same_apart,
	same_given_keys,
	same_issues_renamed,
	same_value,
	structures,
	unrename,
	value_at,
	visit_objects,
	walk_path,
	type DifferentialAboveTaken,
	type DifferentialInherited,
	type DifferentialPath,
	type DifferentialRewritten,
	type DifferentialRuleName
} from './differential_rules.ts';
import { split_side, type DifferentialSplit } from './differential_recognizers.ts';
import { create_seeded_rng } from './seeded_rng.ts';

//
// Comparing
//

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

const UNION_OWN_PATH: ReadonlySet<DifferentialRuleName> = new Set(['union_own_path']);

/** A failure, its paths under those of a part. */
interface PartFailure {
	ok: false;
	paths: Array<DifferentialPath>;
	unknown_keys: Array<DifferentialPath>;
}

// what `lib` gives a part of the input alone, by the schema at it, a failure's
// paths put under `at`, the part's path, and a union's issue at its own path,
// as ours reports it. `null` where it throws
const part_verdict = (
	lib: ConformanceLibName,
	part: DifferentialSpec,
	value: unknown,
	at: DifferentialPath,
	run: DifferentialRun
): { ok: true } | PartFailure | null => {
	const parsed = parse_alone(lib, part, value);
	if (!parsed || parsed.ok) return parsed && { ok: true };
	const relaxed = relax_paths(part, parsed, value, null, UNION_OWN_PATH, run) as typeof parsed;
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
	rules: ReadonlySet<DifferentialRuleName>,
	run: DifferentialRun
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
		const moved: Array<DifferentialPath> = [];
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
			const zod_items = part_verdict('zod', array, value, path, run);
			if (!zod_items || zod_items.ok || !parse_alone('valibot', array, value)?.ok) return [path];
			moved.push(...zod_items.unknown_keys);
			// but at a symbol key, which ours takes, as valibot does, and at a part
			// valibot disagrees on, the issues of the side the table names
			return zod_items.paths
				.filter((at) => typeof at.at(-1) !== 'symbol')
				.flatMap((at) => split_part_paths(spec, input, recipe, at, run) ?? [at]);
		});
		unknown_keys = [...unknown_keys, ...moved];
	}
	if (rules.has('constructor_valibot_verdict')) {
		const read: Array<DifferentialPath> = [];
		const read_unknown: Array<DifferentialPath> = [];
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
					const by_valibot = part_verdict('valibot', e, value, at, run);
					const by_ours = part_verdict('fuz_schema', e, value, at, run);
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
		for (const path of split_union_paths(spec, input, recipe, run)) {
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
	run: DifferentialRun,
	inherited: DifferentialInherited = null
): boolean => {
	if (ours.text === theirs.text) return true;
	if (!ours.parsed || !theirs.parsed || ours.ok !== theirs.ok) return false;
	if (!theirs.parsed.ok) {
		return (
			render_parsed(ours.parsed) ===
			render_parsed(relax_paths(spec, theirs.parsed, theirs.input, theirs.recipe, rules, run))
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
// Splits the rules read a part of the input for
//

// the recipe of the part of an input at `path`, read as the input is: an own
// key, a hidden one, then one it inherits
const input_at = (input: DifferentialInput, path: DifferentialPath): DifferentialInput | null => {
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
	path: DifferentialPath,
	run: DifferentialRun
): Array<DifferentialPath> | null => {
	const part_recipe = recipe && input_at(recipe, path);
	const { union_at, chain } = walk_path(spec, path, input);
	const part = chain[0];
	if (!part_recipe || !part || union_at !== null) return null;
	const zod = run('zod', part, part_recipe);
	const valibot = run('valibot', part, part_recipe);
	if (zod.text === valibot.text || !zod.parsed || !valibot.parsed) return null;
	const side = split_side(part, part_recipe, zod, valibot, run);
	const held = side.kind === 'one' ? side.held : null;
	const parsed = held?.result.parsed;
	if (!held || !parsed || parsed.ok) return null;
	const relaxed = relax_paths(part, parsed, held.result.input, null, UNION_OWN_PATH, run);
	if (relaxed.ok || relaxed.unknown_keys.length) return null;
	return relaxed.paths.map((p) => [...path, ...p]);
};

// the paths of the unions zod and valibot both take by different options,
// where ours refuses each option as the side of their disagreement on it
// that the table names
const split_union_paths = (
	spec: DifferentialSpec,
	input: unknown,
	recipe: DifferentialInput,
	run: DifferentialRun
): Array<DifferentialPath> => {
	const found: Array<DifferentialPath> = [];
	const consider = (path: DifferentialPath): void => {
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
			const zod = run('zod', option, part_recipe);
			const valibot = run('valibot', option, part_recipe);
			if (zod.ok === valibot.ok) return false;
			const side = split_side(option, part_recipe, zod, valibot, run);
			return (
				side.kind === 'one' &&
				side.held !== null &&
				!side.held.result.ok &&
				!run('fuz_schema', option, part_recipe).ok
			);
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

//
// Explaining
//

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

/** Whether the rules made the three agree, and what `split_side` found where they ended in a split. */
interface Explained {
	explained: boolean;
	split: DifferentialSplit | null;
}

// whether the rules make the three agree. A rewrite is applied only where
// ours did on the rewritten input what it did on the input, apart from the
// keys the rewrite touched, so a rule credits nothing but what its row says
// ours does
const explain = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	results: DifferentialResults,
	rules: ReadonlySet<DifferentialRuleName>,
	run: DifferentialRun
): Explained => {
	let r = results;
	let current = input;
	let checked = false;
	let taken_away = false;
	// the input with an own `__proto__` key of a `record` renamed, theirs on it,
	// the paths of the renamed keys, and whether a result of theirs left one out
	let renamed: {
		input: DifferentialInput;
		results: DifferentialResults;
		to: Array<DifferentialPath>;
		left_out: (result: DifferentialResult) => boolean;
	} | null = null;
	if (rules.has('prototype_ignored')) {
		const plain = rewrite_prototypes(spec, current);
		if (plain !== current) {
			const r2 = run_differential_case(spec, plain, run);
			// where ours did the same, and zod and valibot either did too, or now
			// disagree, which `split_on_a_side` is for
			const theirs_kept = r2.zod.text === r.zod.text && r2.valibot.text === r.valibot.text;
			if (
				(theirs_kept || r2.zod.text !== r2.valibot.text) &&
				same_ours(spec, r.fuz_schema, r2.fuz_schema, rules)
			) {
				current = plain;
				r = r2;
				taken_away = true;
			}
		}
	}
	if (rules.has('symbol_ignored')) {
		const next = rewrite_record_symbols(spec, current);
		if (next.input !== current) {
			const r2 = run_differential_case(spec, next.input, run);
			// where ours did the same apart from the key, and left the key unread,
			// and zod and valibot either did the same too, or now disagree, which
			// `split_on_a_side` is for
			const theirs_kept = r2.zod.text === r.zod.text && r2.valibot.text === r.valibot.text;
			if (
				(theirs_kept || r2.zod.text !== r2.valibot.text) &&
				same_apart(r.fuz_schema, r2.fuz_schema, next.touched) &&
				left_unread(r.fuz_schema, next.touched)
			) {
				current = next.input;
				r = r2;
				taken_away = true;
			}
		}
	}
	const keeps = (
		ours: DifferentialResult,
		given: DifferentialResult,
		touched: Array<DifferentialPath>
	): boolean => same_apart(ours, given, touched) && same_given_keys(ours, given, touched);
	const give_keys = (
		needs: (entry: DifferentialSpec) => boolean,
		past_options = false
	): boolean => {
		const all = rewrite_missing_keys(spec, current, needs);
		const kept_without = (next: DifferentialRewritten, dropped: DifferentialSpec): boolean => {
			if (dropped === spec) return false;
			const ours = run('fuz_schema', dropped, current);
			return (
				ours.text === r.fuz_schema.text &&
				keeps(ours, run('fuz_schema', dropped, next.input), next.touched)
			);
		};
		const kept = (next: DifferentialRewritten): boolean => {
			if (keeps(r.fuz_schema, run('fuz_schema', spec, next.input), next.touched)) return true;
			if (!past_options) return false;
			// the options before the check, which ours did without on the input:
			// of every union, else only of those of the keys given
			const dropped = drop_before_check(spec);
			if (kept_without(next, dropped)) return true;
			const at_keys = drop_before_check_at(spec, next.touched);
			return at_keys !== dropped && kept_without(next, at_keys);
		};
		let next: DifferentialRewritten | null = all.input !== current && kept(all) ? all : null;
		// else the keys of one structure at a time, as where options of a union
		// the input is given to name different keys
		for (let i = 0; !next && i < all.visits; i++) {
			const one = rewrite_missing_keys(spec, current, needs, { only: i });
			if (one.input !== current && kept(one)) next = one;
		}
		// else only the keys whose check takes them, one at a time: a key ours
		// does more with than leave `undefined` is not one, as a check beside
		// another option of a union that needs the key. And a strict object
		// beside a key that doesn't name it keeps the key out only where one of
		// the three takes the object without it
		if (!next) {
			const strict_takes = (strict: DifferentialObjectSpec, object: DifferentialInput): boolean =>
				(['zod', 'valibot', 'fuz_schema'] as const).some((lib) => run(lib, strict, object).ok);
			const candidates = rewrite_missing_keys(spec, current, needs, { strict_takes });
			const keys: Set<string> = new Set();
			let found: DifferentialRewritten | null = null;
			for (const path of candidates.touched) {
				const text = path_text(path);
				if (keys.has(text)) continue;
				const with_key = new Set([...keys, text]);
				const one = rewrite_missing_keys(spec, current, needs, { keys: with_key, strict_takes });
				if (one.input !== current && kept(one)) {
					keys.add(text);
					found = one;
				}
			}
			next = found;
		}
		if (!next) return false;
		current = next.input;
		r = run_differential_case(spec, next.input, run);
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
			const r2 = run_differential_case(spec, next.input, run);
			// a failure above the key only at a union, which reports one at its
			// path, with `union_own_path`, and one the rewritten input has above it only at a step the
			// key's failure stopped, where a pipe stops at its first failing step
			const above: DifferentialAboveTaken = {
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
			const renamed_input = rewrite_record_proto(spec, current, RENAMED_PROTO).input;
			const ours_renamed = run('fuz_schema', spec, renamed_input);
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
				const r3 = run_differential_case(spec, renamed_input, run);
				// where theirs leave the renamed key out, as they do the key, or keep
				// it where ours keeps the key, which `loose_own_proto` is for, or in
				// their input returned as it is, as ours returns its own
				const left_out = (result: DifferentialResult): boolean =>
					!result.ok ||
					to.every(
						(t) =>
							value_at(result.value, t) === undefined ||
							holder_returned(result, t) ||
							(rules.has('loose_own_proto') && !holds_no_proto(r.fuz_schema, [t]))
					);
				const zod = unrename(r3.zod, to);
				const valibot = unrename(r3.valibot, to);
				// or where one keeps it, and they disagree, which `split_on_a_side`
				// is for, on the input with the key renamed
				if (
					(left_out(r3.zod) && left_out(r3.valibot)) ||
					(rules.has('split_on_a_side') && zod.text !== valibot.text)
				) {
					r = { zod, valibot, fuz_schema: r.fuz_schema };
					renamed = { input: renamed_input, results: r3, to, left_out };
				}
			}
		}
	}
	if (!r.fuz_schema.parsed || !r.zod.parsed || !r.valibot.parsed) {
		return { explained: false, split: null };
	}
	if (r.zod.text !== r.valibot.text) {
		// a split the check's key brought out, the prototype or a symbol key
		// taken away, or an own `__proto__` key of a record renamed, that one
		// entry of the table recognizes, on the side of whose row ours is
		if (!(checked || taken_away || renamed) || !rules.has('split_on_a_side')) {
			return { explained: false, split: null };
		}
		if (renamed) {
			// told apart on the input with the key renamed, where they disagree
			// there too, and held to the result of the side that left it out,
			// read as on the input
			const { input: renamed_at, results, to, left_out } = renamed;
			if (results.zod.text === results.valibot.text) return { explained: false, split: null };
			const split = split_side(spec, renamed_at, results.zod, results.valibot, run);
			const held = split.kind === 'one' ? split.held : null;
			return {
				explained:
					held !== null &&
					left_out(held.result) &&
					same_differential_result(
						spec,
						r.fuz_schema,
						unrename(held.result, to),
						rules,
						run,
						held.inherited
					),
				split
			};
		}
		const split = split_side(spec, current, r.zod, r.valibot, run);
		const held = split.kind === 'one' ? split.held : null;
		return {
			explained:
				held !== null &&
				same_differential_result(spec, r.fuz_schema, held.result, rules, run, held.inherited),
			split
		};
	}
	return {
		explained: same_differential_result(spec, r.fuz_schema, r.zod, rules, run),
		split: null
	};
};

//
// Classifying
//

export type DifferentialSide = 'zod' | 'valibot' | 'both' | 'neither';

/**
 * Of an undeclared case the rules brought to a disagreement of zod and
 * valibot, the rows of the entries of `SPLIT_RECOGNIZERS` that recognized it:
 * none, several, or one whose side ours is not on.
 */
export interface DifferentialSplitFound {
	rows: Array<ConformanceSidesRow>;
}

export type DifferentialVerdict =
	| { kind: 'agree' }
	| { kind: 'declared'; rules: Array<DifferentialRuleName> }
	| { kind: 'undeclared'; split: DifferentialSplitFound | null }
	| { kind: 'sides'; side: DifferentialSide }
	| { kind: 'refused' }
	| { kind: 'throws' };

/** What the three libraries did with a case, by the rule and the tables. */
export const classify_differential_case = (
	spec: DifferentialSpec,
	input: DifferentialInput,
	results: DifferentialResults = run_differential_case(spec, input),
	run: DifferentialRun = create_differential_run()
): DifferentialVerdict => {
	const { zod, valibot, fuz_schema: ours } = results;
	if (!ours.parsed) return { kind: 'throws' };
	if (!zod.parsed || !valibot.parsed) return { kind: 'refused' };
	if (zod.text !== valibot.text) {
		const is_zod = same_differential_result(spec, ours, zod, RELAXATIONS, run);
		const is_valibot = same_differential_result(spec, ours, valibot, RELAXATIONS, run);
		return {
			kind: 'sides',
			side: is_zod ? (is_valibot ? 'both' : 'zod') : is_valibot ? 'valibot' : 'neither'
		};
	}
	if (same_differential_result(spec, ours, zod, NO_RULES, run)) return { kind: 'agree' };
	// every rule, or the relaxations alone, where a rewrite changed what zod
	// or valibot did with something else
	let start: ReadonlySet<DifferentialRuleName> | null = null;
	let split: DifferentialSplit | null = null;
	for (const rules of [ALL_RULES, RELAXATIONS]) {
		const explained = explain(spec, input, results, rules, run);
		split ??= explained.split;
		if (explained.explained) {
			start = rules;
			break;
		}
	}
	if (!start) return { kind: 'undeclared', split: split && split_found(split) };
	// each rule dropped in turn, the last first, and kept where the case needs it
	const used = new Set(start);
	for (const rule of [...start].reverse()) {
		used.delete(rule);
		if (!explain(spec, input, results, used, run).explained) used.add(rule);
	}
	return { kind: 'declared', rules: [...used] };
};

const split_found = (split: DifferentialSplit): DifferentialSplitFound => ({
	rows: split.kind === 'none' ? [] : split.kind === 'several' ? split.rows : [split.row]
});

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

// this library with every `union` a `memo_union`
const MEMO_LIB = {
	...CONFORMANCE_LIBS.fuz_schema,
	union: CONFORMANCE_LIBS.fuz_schema.memo_union
};

// what `schema` gives `value`: the result of `parse`, and `is`, alone and
// under a `union` of one option, which probes it
const memo_texts = (schema: s.Schema, value: unknown): Array<string> =>
	[
		() => result_text(s.parse(schema, value)),
		() => String(s.is(schema, value)),
		() => result_text(s.parse(s.union([schema]), value)),
		() => String(s.is(s.union([schema]), value))
	].map((run) => {
		try {
			return run();
		} catch (error) {
			return 'threw ' + differential_error_line(error);
		}
	});

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
		return ['build threw: ' + differential_error_line(error)];
	}
	const value = materialize_input(input);
	const before = render_whole(value);
	let first: s.SchemaResult<unknown>;
	try {
		first = s.parse(schema, value);
	} catch (error) {
		return ['parse threw: ' + differential_error_line(error)];
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
	// past the hundredth a failure builds no issue
	if (Math.min(ctx.fails, 100) !== (ctx.issues?.length ?? 0)) {
		problems.push(`ctx.fails is not the count of issues: ${ctx.fails}, ${ctx.issues?.length ?? 0}`);
	}
	const probe: s.SchemaContext = { issues: undefined, fails: 0, probe: true };
	schema.run(value, probe);
	if (probe.issues !== undefined) problems.push('probe touched ctx.issues: ');
	if (!probe.probe) problems.push('probe not restored: ');
	if (!probe.fails !== first.ok)
		problems.push(`probe verdict differs from parse: parse ok ${first.ok}`);
	if (render_whole(value) !== before) problems.push('input mutated by run: ' + before);
	if (spec_has_kind(spec, 'union')) {
		let memo: s.Schema;
		try {
			memo = build_spec(spec, MEMO_LIB);
		} catch (error) {
			return [...problems, 'memo_union build threw: ' + differential_error_line(error)];
		}
		const ours = memo_texts(schema, value);
		const memo_ours = memo_texts(memo, value);
		for (const [i, name] of ['parse', 'is', 'parse in a union', 'is in a union'].entries()) {
			if (memo_ours[i] !== ours[i]) {
				problems.push(`memo_union differs in ${name}: ${ours[i]} where it gives ${memo_ours[i]}`);
			}
		}
	}
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
	const entries = (list: DifferentialEntries): number =>
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

function* shrink_entries_input(list: DifferentialEntries): Generator<DifferentialEntries> {
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
	const rename = (list: DifferentialEntries): DifferentialEntries =>
		list.map(([key, x]) => [key === from ? to : key, x]);
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
	/** The verdict on the case minimized, of the same sort as the case found. */
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
	const rng = create_seeded_rng(seed);
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
			const results = run_differential_case(ms, mi);
			into.set(text, {
				// of the case minimized, whose key is the verdict's
				verdict: classify_differential_case(ms, mi, results),
				spec: ms,
				input: mi,
				results,
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

// which entries of `SPLIT_RECOGNIZERS` recognized the split the rules
// brought an undeclared case to, where they did
const describe_split = (verdict: DifferentialVerdict): string => {
	if (verdict.kind !== 'undeclared' || !verdict.split) return '';
	const { rows } = verdict.split;
	const text =
		rows.length === 0
			? 'no entry of SPLIT_RECOGNIZERS recognizes it'
			: rows.length > 1
				? `ambiguous, ${rows.length} entries of SPLIT_RECOGNIZERS recognize it: ${rows.map((row) => `"${row}"`).join(', ')}`
				: `"${rows[0]}" recognizes it, and ours is not on its side`;
	return `  split       ${text}\n`;
};

const describe_finding = (finding: DifferentialFinding): string =>
	`[${verdict_key(finding.verdict)}] x${finding.count}\n` +
	describe_split(finding.verdict) +
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
