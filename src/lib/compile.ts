/**
 * Compiles a schema to a function of straight-line code: `compile_guard` to
 * what `is` answers, and `compile_parse` to what `parse` returns.
 *
 * The compiler reads a schema's `kind` and `def`, emits JavaScript source, and
 * makes a function of it with `new Function`. The interpreter is the oracle:
 * a compiled guard gives `is`'s verdict, and a compiled parse gives `parse`'s
 * result, the same `ok`, an output that is deep-equal and is the input itself
 * exactly where the interpreter's is, and on failure the interpreter's issues.
 *
 * - **Issues are never compiled.** Compiled code builds no issue. A compiled
 *   parse of an input that fails calls `parse`, so its issues are the
 *   library's own.
 * - **A kind the compiler has no code for runs in place.** A schema of a kind
 *   defined outside the library, or of a library kind whose `def` is not what
 *   the kind holds, is run by its own `run` for that subtree, handed the
 *   object and the key as the library hands them, and the code around it is
 *   compiled. So is, in a compiled parse, a `keyed_record`, an
 *   `object_with_rest`, a `union` that may try an option again without its
 *   key, and a `memo_union` that can change a value.
 * - **A schema is read, never written to**, and nothing is kept on one: the
 *   caller holds the function a compile returns. A `lazy`'s function is called
 *   once, at the compile.
 * - **Where `new Function` is refused**, as under a content security policy
 *   without `unsafe-eval`, the functions returned run the interpreter.
 * - **Where compiled code runs out of stack**, the interpreter answers, or
 *   throws its own `RangeError` where it runs out too. A schema that holds a
 *   `lazy`, a `memo_union`, or a schema of a kind the compiler has no code
 *   for catches a `RangeError` at its root, any `RangeError`, and calls `is`
 *   or `parse`. Another schema has no catch.
 *
 * **What is refused.** A failed parse is the library's walk and so is every
 * subtree run in place, so compiled code can't bound what the library doesn't,
 * and the compiler throws on a schema the library can walk in time
 * exponential in the depth of an input, naming where it is:
 *
 * - a `union` on a cycle, two or more options of which reach a cycle and
 *   could take the same array, or the same object unless a `literal` entry at
 *   one key, with a value of its own in each of those options, comes before
 *   every entry that reaches a cycle. It is the rule by which the Rust crate
 *   keeps a union's verdicts, asked of a union that is on a cycle. What to
 *   write instead: a `memo_union`, or where each option is an object schema,
 *   a `variant` or those `literal` entries first.
 * - a `pipe` on a cycle, two or more steps of which reach a cycle. What to
 *   write instead: the `pipe` as the one option of a `memo_union`.
 *
 * A cycle is one only a `lazy` closes, and one a `memo_union` is on is none,
 * as it is asked of a value once and then read back. So a `memo_union`, which
 * `is_memo_union` tells, is never refused, and compiled code keeps its
 * verdicts for the length of a call, as the library's does while it probes.
 * The rule refuses some unions the library walks in good time, whose options
 * differ below their first level. What it can't see is not refused, and is
 * not bounded: a kind defined outside the library, a function a `check` or a
 * `transform` calls, and a `union` given a `memo_union`'s own options array,
 * which is told as one though its own `run` keeps nothing.
 *
 * **The bound.** What compiles is never exponential in the depth of an input
 * that is a tree, in a guard, a parse that matches, or a parse that fails:
 * the bound is stated in `docs/design.md`, under Compiling, with what it is
 * not of.
 *
 * What may differ from the interpreter, each said at more length in
 * https://github.com/fuzdev/fuz_schema/blob/main/docs/design.md, which is
 * where they are listed:
 *
 * - **How often a user's function runs.** A compiled parse of an input that
 *   fails has run each `check`, `transform`, and `with_default_fn` it reached
 *   before the failure, and `parse` runs them again, as it does for a call
 *   that ran out of stack. A `RangeError` one throws under a schema that has
 *   the catch is taken for the stack's, and the interpreter runs the
 *   function again. A compiled `memo_union` keeps its verdicts from
 *   its first value, where the library's keeps them only while it probes, so
 *   a `check` under one can run fewer times.
 * - **What is read of the input.** A parse that matches first reads each
 *   value of the input in the library's order, an object's entries in the
 *   schema's and a union's options in theirs. It reads less often: a copy is
 *   filled from the values its entries ran on, and whether a key is present
 *   is asked only where the answer can change the result, after the entries.
 *   A guard makes no copy, so it reads nothing only a copy reads. A parse that
 *   fails reads the input again, in `parse`. A getter or a `Proxy` can tell.
 * - **A schema that takes a library kind's name and a `run` of its own** is
 *   compiled as the library's kind, by its `kind` and `def` alone, but a
 *   `uuid`, an `iso_datetime`, and a `to_integer`, which are run by the
 *   schema's `run`.
 * - **The depth of input at which the stack runs out.** Compiled code can
 *   answer an input so deep that the interpreter throws a `RangeError`, and
 *   never the reverse.
 *
 * It is a module of its own, so a bundle that compiles no schema carries none
 * of it.
 *
 * @module
 */

import {
	is,
	is_memo_union,
	is_schema,
	parse,
	type AnySchema,
	type Infer,
	type InferInput,
	type Schema,
	type SchemaContext,
	type SchemaResult
} from './schema.ts';

/**
 * The most schemas around one, through every `lazy`, that a compile follows.
 * A schema nested deeper is refused, which is how a `lazy` whose function
 * makes a new schema each time it is called ends.
 */
export const COMPILE_MAX_DEPTH = 127;

// Where a value was read from: the expression of the object and of the key,
// which reach a schema where the library's `run`s pass them on, and whether
// the schema is the entry itself, the library's `1`
interface Key {
	object: string;
	key: string;
	entry: boolean;
}

// what a helper gives for a value that failed, which no output is
const FAIL = {};

// The context a subtree with no `memo_union` under it is run in, by its own
// `run`: only its `fails` moves, and `handoff` puts it back. It is probing, as
// only the verdict and the output are wanted
const PROBE: SchemaContext = { issues: undefined, fails: 0, probe: true };

// The output of `schema`'s own `run` for `value` in `ctx`, or `FAIL`: a
// subtree run in place, handed what an entry is handed
const handoff = (
	schema: AnySchema,
	value: unknown,
	ctx: SchemaContext,
	parent?: Record<PropertyKey, unknown>,
	key?: PropertyKey,
	entry?: 1
): unknown => {
	const { fails } = ctx;
	const output = parent ? schema.run(value, ctx, parent, key, entry) : schema.run(value, ctx);
	if (ctx.fails === fails) return output;
	ctx.fails = fails;
	return FAIL;
};

const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

// A string as source text. JSON is ECMAScript, and the two line separators,
// which only a string literal of ES2019 takes, are escaped as well
const quote = (text: string): string =>
	JSON.stringify(text).replace(LINE_SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16));

const is_record = (value: unknown): value is Record<string, any> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

// the most values a `one_of` is tested against one by one: past it, a `Set` of them
const ONE_OF_INLINE_MAX = 12;

const OBJECT_KIND = /^(object|loose_object|strip_object)$/;
const WRAPPER_KIND = /^(optional|nullable|with_default|with_default_fn)$/;
// the kinds that match no array and no object
const SCALAR_KIND =
	/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;
// the kinds whose own output can differ from their input: a `record` copies
// to leave an own `__proto__` key out, and a schema run in place gives what
// its `run` gives
const CHANGER_KIND =
	/^(|with_default_fn|transform|to_lower_case|to_integer|strip_object|record|keyed_record|object_with_rest)$/;
// the kinds that get a function of their own where a schema of one is held in
// more than one place, so its code is written once
const SHARED_KIND =
	/^(object|loose_object|strip_object|object_with_rest|array|record|keyed_record|union|variant)$/;

const every_schema = (values: Array<unknown>): boolean => values.every((value) => is_schema(value));

// Whether `def` is what the library's schema of `kind` holds, as far as the
// compiler reads it: the shape, and a schema wherever the kind holds one
const is_def_of = (kind: string, def: any): boolean => {
	switch (kind) {
		case 'string':
		case 'number':
		case 'boolean':
		case 'bigint':
		case 'unknown':
		case 'literal':
		case 'integer':
		case 'safe_integer':
		case 'uuid':
		case 'iso_datetime':
		case 'to_lower_case':
		case 'min_length':
		case 'max_length':
		case 'min_value':
		case 'max_value':
			return true;
		case 'record':
		case 'array':
			return is_schema(def);
		case 'one_of':
			return Array.isArray(def);
		case 'union':
			return Array.isArray(def) && every_schema(def);
		case 'pipe':
			return Array.isArray(def) && def.length > 0 && every_schema(def);
		case 'optional':
		case 'nullable':
		case 'with_default':
			return is_record(def) && is_schema(def.schema);
		case 'with_default_fn':
			return is_record(def) && is_schema(def.schema) && typeof def.make === 'function';
		case 'keyed_record':
			return is_record(def) && is_schema(def.key) && is_schema(def.value);
		case 'to_integer':
			return is_record(def);
		case 'object':
		case 'loose_object':
		case 'strip_object':
			return is_record(def) && every_schema(Object.values(def));
		case 'object_with_rest':
			return (
				is_record(def) &&
				is_record(def.entries) &&
				every_schema(Object.values(def.entries)) &&
				is_schema(def.rest)
			);
		case 'lazy':
		case 'check':
		case 'transform':
			return typeof def === 'function';
		case 'regex':
			return def instanceof RegExp;
		case 'variant':
			return (
				is_record(def) &&
				typeof def.key === 'string' &&
				Array.isArray(def.options) &&
				def.options.every(
					(option: any) =>
						is_schema(option) &&
						OBJECT_KIND.test(option.kind) &&
						is_def_of(option.kind, option.def) &&
						Object.hasOwn(option.def as object, def.key)
				)
			);
		default:
			return false;
	}
};

interface CompiledSource {
	/** The body of a factory of `(c, handoff, P, FAIL, fallback)` that returns the function. */
	body: string;
	/** What the body reads as `c[i]`: every value that is not written as text. */
	captures: Array<unknown>;
}

// Emits the body of a factory for `root`: a guard, or with `output` a parse.
//
// Emitted source is built only from parts that can't break out of it or meet
// one another. A name the emitter makes, of a variable, a label, or a
// function, is `_` and a counter, from the one `fresh`. A captured value is
// `c` and its index, and is everything that is not text: a regex, a function,
// a default, a schema run in place. The names written out here (`v`, `p`,
// `k`, `c`, `ctx`, `keep`, `kept`, `r`, `X`, and the factory's
// parameters) are of neither form. A string of the schema's goes through
// `quote`, and a number or a bigint is printed once `typeof` says it is one
const to_source = (root: AnySchema, output: boolean): CompiledSource => {
	const captures: Map<unknown, number> = new Map();
	// the functions emitted beside the root's, and the state of one call: a
	// variable declared beside them, with what it is at the start of a call
	const fns: Array<string> = [];
	const state: Array<[name: string, initial: string]> = [];
	// what each lazy defers to, by the function it holds, which `message`
	// copies to a new schema: read once
	const targets: Map<unknown, AnySchema> = new Map();
	const kinds: Map<AnySchema, string> = new Map();
	// the function emitted for a schema, a lazy's target, a schema held in
	// more than one place, or a `memo_union`, by which of
	// those it is, whether it gives the output, and whether it takes a key
	const names: Map<AnySchema, Map<string, string>> = new Map();
	const changes: Map<AnySchema, boolean> = new Map();
	const cycles: Map<AnySchema, boolean> = new Map();
	// the schema whose function body is being emitted, which is not a call of itself
	let body_of: AnySchema | undefined;
	let ids = 0;

	const fresh = (): string => `_${ids++}`;

	const capture = (value: unknown): string => {
		let i = captures.get(value);
		if (i === undefined) captures.set(value, (i = captures.size));
		return `c${i}`;
	};

	// The kind of `schema` where its `def` is what the library's schema of that
	// kind holds, and `''` for any other schema: a kind defined outside the
	// library, or a `def` that is not the kind's. Such a schema is run in
	// place, by its own `run`
	const kind_of = (schema: AnySchema): string => {
		let kind = kinds.get(schema);
		if (kind === undefined) {
			kinds.set(schema, (kind = is_def_of(schema.kind, schema.def) ? schema.kind : ''));
		}
		return kind;
	};

	const target_of = (schema: AnySchema): AnySchema => {
		if (!targets.has(schema.def)) targets.set(schema.def, schema.def());
		return targets.get(schema.def)!;
	};

	// what `schema` holds, each with where it is from it. A new array each
	// call: a `union`'s and a `pipe`'s own `def` is never handed out
	const children = (schema: AnySchema): Array<[at: string, child: AnySchema]> => {
		const def: any = schema.def;
		switch (kind_of(schema)) {
			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];
			case 'lazy':
				return [['/def()', target_of(schema)]];
			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.keys(def).map((name) => [`/def/${name}`, def[name]]);
			case 'object_with_rest':
				return [
					...Object.keys(def.entries).map((name): [string, AnySchema] => [
						`/def/entries/${name}`,
						def.entries[name]
					]),
					['/def/rest', def.rest]
				];
			case 'record':
			case 'array':
				return [['/def', def]];
			case 'keyed_record':
				return [
					['/def/key', def.key],
					['/def/value', def.value]
				];
			case 'union':
			case 'pipe':
				return def.map((child: AnySchema, i: number) => [`/def/${i}`, child]);
			case 'variant':
				return def.options.map((child: AnySchema, i: number) => [`/def/options/${i}`, child]);
			default:
				return [];
		}
	};

	// Every schema the root reaches, each with how many places its code is
	// written in. A wrapper and a pipe are written where they are held, so what
	// they hold is counted again for each place that holds them.
	// Refuses a value that is no schema where the compiler has to read one,
	// the root and what a lazy's function gives, and a schema that never ends,
	// naming where
	const held: Map<AnySchema, number> = new Map();
	const paths: Map<AnySchema, string> = new Map();
	const visit = (schema: AnySchema, path: string, depth: number): void => {
		if (!is_schema(schema)) throw Error(`cannot compile at ${path || '/'}: not a schema`);
		const count = held.get(schema);
		held.set(schema, (count ?? 0) + 1);
		if (count !== undefined) {
			if (!WRAPPER_KIND.test(kind_of(schema)) && kind_of(schema) !== 'pipe') return;
		} else paths.set(schema, path || '/');
		if (depth > COMPILE_MAX_DEPTH) {
			throw Error(
				`cannot compile \`${schema.kind}\` at ${path}: more than ${COMPILE_MAX_DEPTH} schemas around it, through every lazy`
			);
		}
		for (const [at, child] of children(schema)) visit(child, path + at, depth + 1);
	};
	visit(root, '', 0);
	const all = [...held.keys()];
	// the unions that keep their verdicts, as the library's `memo_union` does
	const memos: Set<AnySchema> = new Set(
		all.filter((x) => kind_of(x) === 'union' && is_memo_union(x))
	);

	// Every schema `from` reaches below itself, through every lazy. With
	// `walked`, only what a walk of one value can come to again and again: not
	// what a `memo_union` holds, which is asked of a value once and then read back
	const reach_of = (from: AnySchema, walked?: boolean): Set<AnySchema> => {
		const seen: Set<AnySchema> = new Set();
		const stack = children(from);
		let next;
		while ((next = stack.pop())) {
			if (seen.has(next[1])) continue;
			seen.add(next[1]);
			if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));
		}
		return seen;
	};

	// whether the output of `schema` can differ from its input: whether it, or
	// anything it reaches, is a kind that changes a value or is run in place
	const may_change = (schema: AnySchema): boolean => {
		let known = changes.get(schema);
		if (known === undefined) {
			known = [schema, ...reach_of(schema)].some(
				(x) =>
					CHANGER_KIND.test(kind_of(x)) ||
					(kind_of(x) === 'with_default' && x.def.value !== undefined)
			);
			changes.set(schema, known);
		}
		return known;
	};

	// Whether a walk of `schema` reaches a cycle, which only a lazy closes:
	// whether it is or reaches a lazy that reaches itself. A cycle a
	// `memo_union` is on is none, as its verdict on a value is kept, and a
	// `memo_union` reaches none
	const looping: Set<AnySchema> = new Set(
		all.filter((x) => kind_of(x) === 'lazy' && reach_of(x, true).has(x))
	);
	const reaches_cycle = (schema: AnySchema): boolean => {
		let known = cycles.get(schema);
		if (known === undefined) {
			known = !memos.has(schema) && [schema, ...reach_of(schema, true)].some((x) => looping.has(x));
			cycles.set(schema, known);
		}
		return known;
	};

	// every step of a pipe in order, through the pipes it holds: a pipe that
	// starts with a pipe runs as one, and a pipe as a later step is called
	// with the value alone, as any step is. An action alone is a pipe of one
	const steps_of = (schema: AnySchema): Array<AnySchema> =>
		kind_of(schema) === 'pipe' ? schema.def.flatMap(steps_of) : [schema];

	// Whether what holds `schema` hands it the object and the key, where it
	// has them: the library's `run.length > 2 || kind === 'lazy'`, read of a
	// library kind from its `kind` and `def`, by which the library chose its
	// closure, and of a schema run in place from its `run`
	const is_handed = (schema: AnySchema): boolean => {
		const def: any = schema.def;
		switch (kind_of(schema)) {
			case '':
				return schema.run.length > 2 || schema.kind === 'lazy';
			case 'unknown':
			case 'lazy':
				return true;
			case 'literal':
				return def === undefined;
			case 'one_of':
				return def.includes(undefined);
			case 'nullable':
				return is_handed(def.schema);
			case 'union':
				return def.some(is_handed);
			case 'pipe':
				return kind_of(steps_of(schema)[0]!) === 'optional' || is_handed(def[0]);
			default:
				return false;
		}
	};

	// whether the object and the key, handed to `schema`, can matter to it
	// where it is not the entry itself: whether they reach a schema that reads
	// them
	const reads_key = (schema: AnySchema, seen: Set<AnySchema> = new Set()): boolean => {
		if (seen.has(schema)) return false;
		seen.add(schema);
		const def: any = schema.def;
		switch (kind_of(schema)) {
			case '':
			case 'unknown':
				return true;
			case 'literal':
				return def === undefined;
			case 'one_of':
				return def.includes(undefined);
			case 'nullable':
				return is_handed(def.schema) && reads_key(def.schema, seen);
			case 'lazy':
				return reads_key(target_of(schema), seen);
			case 'union':
				return def.some(is_handed) && def.some((option: AnySchema) => reads_key(option, seen));
			case 'pipe': {
				const first = steps_of(schema)[0]!;
				return kind_of(first) !== 'optional' && is_handed(first) && reads_key(first, seen);
			}
			default:
				return false;
		}
	};

	// whether `schema` could match an array, and whether it could an object,
	// by its kind, looked through wrappers, a lazy, the first schema of a pipe,
	// and the options of a union. A kind that reads a value as it likes, a
	// `check` or one run in place, could match either
	const holds = (schema: AnySchema, seen: Set<AnySchema> = new Set()): [boolean, boolean] => {
		if (seen.has(schema)) return [false, false];
		seen.add(schema);
		const kind = kind_of(schema);
		const def: any = schema.def;
		if (kind === 'array') return [true, false];
		if (/object|record|variant/.test(kind)) return [false, true];
		if (SCALAR_KIND.test(kind)) return [false, false];
		const through: Array<AnySchema> | undefined =
			kind === 'lazy'
				? [target_of(schema)]
				: kind === 'pipe'
					? [def[0]]
					: kind === 'union'
						? def
						: WRAPPER_KIND.test(kind)
							? [def.schema]
							: undefined;
		if (!through) return [true, true];
		let array = false;
		let object = false;
		for (const next of through) {
			const [a, o] = holds(next, seen);
			array ||= a;
			object ||= o;
		}
		return [array, object];
	};

	// the object schema `schema` is, looked through the wrappers and a lazy
	const object_of = (schema: AnySchema): AnySchema | undefined => {
		let at = schema;
		for (let depth = 0; depth <= COMPILE_MAX_DEPTH; depth++) {
			const kind = kind_of(at);
			if (OBJECT_KIND.test(kind)) return at;
			if (WRAPPER_KIND.test(kind)) at = at.def.schema;
			else if (kind === 'lazy') at = target_of(at);
			else return undefined;
		}
		return undefined;
	};

	// Whether one key tells `options` apart before any of them walks on, as
	// `told_apart` of the Rust crate's `builder.rs` has it: each, looked
	// through its wrappers and a lazy, is an object schema with a `literal` at
	// the key, their values distinct, and the entry comes before every entry
	// that reaches a cycle. The library runs an object's entries in their
	// order and a probe stops at the first that fails, so of the options asked
	// of one object at most one gets past the key
	const told_apart = (options: Array<AnySchema>): boolean => {
		const firsts = options.map((option) => {
			const found: Map<string, unknown> = new Map();
			const object = object_of(option);
			if (!object) return found;
			for (const name of Object.keys(object.def)) {
				const entry: AnySchema = object.def[name];
				if (reaches_cycle(entry)) break;
				if (kind_of(entry) === 'literal') found.set(name, entry.def);
			}
			return found;
		});
		return [...firsts[0]!.keys()].some((name) => {
			const values: Set<unknown> = new Set();
			return firsts.every(
				(found) => found.has(name) && values.size < values.add(found.get(name)).size
			);
		});
	};

	// Refuses what the library walks in time exponential in the depth of an
	// input, before anything is emitted, as compiled code can't bound it: a
	// parse that fails is the library's, and so is every subtree run in place.
	// The rule is the Rust crate's for the unions that keep their verdicts,
	// `union_memoized` in `builder.rs`, asked of a `union` on a cycle: two or
	// more of its options reach a cycle and could take the same array, or the
	// same object unless a `literal` tells those options apart first. And of a
	// `pipe` on a cycle: two or more of its steps reach a cycle. A `memo_union`
	// is never refused
	for (const schema of all) {
		const kind = kind_of(schema);
		if (memos.has(schema) || !/^(union|pipe)$/.test(kind)) continue;
		const walking = reach_of(schema, true).has(schema)
			? (schema.def as Array<AnySchema>).filter(reaches_cycle)
			: [];
		const of_pipe = kind === 'pipe';
		const objects = walking.filter((option) => holds(option)[1]);
		if (
			of_pipe
				? walking.length > 1
				: walking.filter((option) => holds(option)[0]).length > 1 ||
					(objects.length > 1 && !told_apart(objects))
		) {
			throw Error(
				`cannot compile \`${kind}\` at ${paths.get(schema)}: two or more of its ${of_pipe ? 'steps walk the value' : 'options can walk one array or object'} on into a cycle, and an input is walked again at every level: make it ${of_pipe ? 'the one option of a memo_union' : 'a memo_union, or where each option is an object schema, a variant, or put the literal entry that tells them apart first in each'}`
			);
		}
	}

	// The context a subtree is run in place with. Where the schema holds a
	// `memo_union`, or a schema run in place, which could hold one, it is one
	// context for the length of a call, as the library's is for a parse, since a
	// `memo_union` keeps its memo by context: made at the first subtree run,
	// probing where the library would be, which is everywhere in a guard, and
	// in a parse inside a union's options. Any other schema runs its subtrees
	// in the one context of the module
	const shares_context = memos.size > 0 || all.some((x) => kind_of(x) === '');
	if (shares_context) state.push(['ctx', 'undefined']);
	const context = shares_context
		? `(ctx ??= { issues: undefined, fails: 0, probe: ${!output} })`
		: 'P';

	// whether `schema` has a function of its own because more than one place
	// holds it. A `memo_union` has one already
	const is_shared = (schema: AnySchema): boolean =>
		held.get(schema)! > 1 && SHARED_KIND.test(kind_of(schema)) && !memos.has(schema);

	// a primitive as source text, and anything else captured
	const literal = (value: unknown): string => {
		switch (typeof value) {
			case 'string':
				return quote(value);
			case 'number':
				return Object.is(value, -0) ? '-0' : String(value);
			case 'bigint':
				return `${value}n`;
			case 'boolean':
				return String(value);
			case 'undefined':
				return 'void 0';
			default:
				return value === null ? 'null' : capture(value);
		}
	};

	// `v === value`, and `NaN` by the one value that isn't itself, as `literal` matches
	const equals = (v: string, value: unknown): string =>
		// eslint-disable-next-line no-self-compare
		value !== value ? `${v} !== ${v}` : `${v} === ${literal(value)}`;

	const read = (v: string, name: string): string => `${v}[${quote(name)}]`;

	// `a || b`, in parentheses so it can sit in a `&&`
	const any_of = (conds: Array<string>): string =>
		conds.length === 0 ? 'false' : conds.length === 1 ? conds[0]! : `(${conds.join(' || ')})`;

	const all_of = (conds: Array<string>): string =>
		conds.filter((c) => c !== 'true').join(' && ') || 'true';

	const not_object = (v: string): string =>
		`typeof ${v} !== "object" || ${v} === null || Array.isArray(${v})`;

	// the object and the key as arguments, and the `1` for the entry itself
	const key_args = (key: Key | null, entry = false): string =>
		key ? `, ${key.object}, ${key.key}${entry && key.entry ? ', 1' : ''}` : '';

	// The object and the key as what holds `schemas` hands them on: to a
	// schema that takes them, by the library's rule, and never the `1`
	const key_for = (key: Key | null, ...schemas: Array<AnySchema>): Key | null =>
		key && schemas.some(is_handed) ? { ...key, entry: false } : null;

	// true of a key no entry names
	const unknown_key = (k: string, entries: Record<string, AnySchema>): string => {
		const all_names = Object.keys(entries);
		return all_names.length
			? `!(${all_names.map((n) => `${k} === ${quote(n)}`).join(' || ')})`
			: 'true';
	};

	// The name of a function of `schema`, emitting it the first time. It is
	// named before its body is emitted, which is how a recursive schema ends
	const fn_of = (
		schema: AnySchema,
		variant: string,
		emit_fn: (name: string, key: Key | null) => string
	): string => {
		let of_schema = names.get(schema);
		if (!of_schema) names.set(schema, (of_schema = new Map()));
		let name = of_schema.get(variant);
		if (!name) {
			of_schema.set(variant, (name = fresh()));
			fns.push(
				emit_fn(name, variant.endsWith('k') ? { object: 'p', key: 'k', entry: false } : null)
			);
		}
		return name;
	};

	// A call of the function of `schema`, what a lazy defers to or a schema
	// held in more than one place, which gives whether `v` passes, or with
	// `out` its output or `FAIL`
	const call_of = (schema: AnySchema, v: string, key: Key | null, out: boolean): string => {
		const keyed = !!key && reads_key(schema);
		const name = fn_of(schema, (out ? 'o' : 'g') + (keyed ? 'k' : ''), (fn, of_fn) => {
			const params = `v${keyed ? ', p, k' : ''}`;
			body_of = schema;
			if (out) {
				const [code, o] = emit_out(schema, 'v', of_fn, 'return FAIL;');
				return `function ${fn}(${params}) {\n${code}return ${o};\n}`;
			}
			return `function ${fn}(${params}) {\n${emit(schema, 'v', of_fn, 'return false;')}return true;\n}`;
		});
		return `${name}(${v}${keyed ? key_args(key) : ''})`;
	};

	// whether `schema` is to be called by its function here, and not written:
	// one held in more than one place, but where its own function is being written
	const is_called = (schema: AnySchema): boolean => {
		if (schema === body_of) {
			body_of = undefined;
			return false;
		}
		return is_shared(schema);
	};

	// A `memo_union`: a call of a function that reads the verdict it kept for
	// an array or an object this call, or runs its options and keeps it, from
	// the first value, as the library's does while it probes. A value that
	// isn't an array or an object is never kept, so the object and the key,
	// which matter only to `undefined`, change no verdict
	const union_call = (schema: AnySchema, v: string, key: Key | null): string => {
		const keyed = !!key && reads_key(schema);
		const name = fn_of(schema, keyed ? 'uk' : 'u', (fn, of_fn) => {
			const map = fresh();
			state.push([map, 'undefined']);
			return (
				`function ${fn}(v${keyed ? ', p, k' : ''}) {\nconst keep = typeof v === "object" && v !== null;\n` +
				`if (keep) {\nconst kept = (${map} ??= new WeakMap()).get(v);\nif (kept !== undefined) return kept;\n}\n` +
				`let r = false;\nX: {\n${emit_union(schema, 'v', of_fn, 'break X;')}r = true;\n}\n` +
				`if (keep) ${map}.set(v, r);\nreturn r;\n}`
			);
		});
		return `${name}(${v}${keyed ? key_args(key) : ''})`;
	};

	// A boolean expression that is true where `v` passes `schema`, or
	// `undefined` where the schema needs statements: a loop, or a value made
	const cond = (schema: AnySchema, v: string, key: Key | null): string | undefined => {
		const kind = kind_of(schema);
		const def: any = schema.def;
		if (is_called(schema)) return call_of(schema, v, key, false);
		// present, where a missing key is what `undefined` could be
		const present = key ? `${key.key} in ${key.object}` : 'true';
		switch (kind) {
			case '':
				// run in place, by its own `run`, handed what the library hands it
				return `handoff(${capture(schema)}, ${v}, ${context}${key_args(key, true)}) !== FAIL`;
			case 'string':
			case 'boolean':
			case 'bigint':
				return `typeof ${v} === "${kind}"`;
			case 'number':
				return `Number.isFinite(${v})`;
			case 'unknown':
				return key ? `(${v} !== undefined || ${present})` : 'true';
			case 'literal':
				return def === undefined ? all_of([`${v} === undefined`, present]) : equals(v, def);
			case 'one_of': {
				const values = [...new Set(def as Array<unknown>)].filter((x) => x !== undefined);
				const tests =
					values.length > ONE_OF_INLINE_MAX
						? [`${capture(new Set(values))}.has(${v})`]
						: values.map((x) => equals(v, x));
				if (def.includes(undefined)) tests.push(all_of([`${v} === undefined`, present]));
				return any_of(tests);
			}
			case 'optional': {
				const inner = cond(def.schema, v, null);
				return inner && any_of([`${v} === undefined`, inner]);
			}
			case 'nullable': {
				const inner = cond(def.schema, v, key_for(key, def.schema));
				return inner && any_of([`${v} === null`, inner]);
			}
			case 'with_default': {
				const inner = cond(def.schema, v, null);
				return inner && any_of([`${v} === undefined`, inner]);
			}
			case 'lazy':
				return call_of(target_of(schema), v, key, false);
			case 'union': {
				if (memos.has(schema)) return union_call(schema, v, key);
				const conds: Array<string> = [];
				for (const option of def) {
					const c = cond(option, v, key_for(key, ...def));
					if (c === undefined) return undefined;
					conds.push(c);
				}
				return any_of(conds);
			}
			case 'pipe': {
				// a step that makes a value needs statements
				if (may_change(schema)) return undefined;
				const steps = steps_of(schema);
				const starts_optional = kind_of(steps[0]!) === 'optional';
				const conds: Array<string> = [];
				for (let i = 0; i < steps.length; i++) {
					const c = cond(steps[i]!, v, i || starts_optional ? null : key_for(key, steps[0]!));
					if (c === undefined) return undefined;
					conds.push(c);
				}
				const every = all_of(conds);
				// as the entry itself, a pipe that starts with an `optional` runs no step for a missing key
				return starts_optional && key?.entry ? any_of([`!(${present})`, every]) : every;
			}
			case 'min_length':
				return `${v}.length >= ${literal(def)}`;
			case 'max_length':
				return `${v}.length <= ${literal(def)}`;
			case 'min_value':
				return `${v} >= ${literal(def)}`;
			case 'max_value':
				return `${v} <= ${literal(def)}`;
			case 'integer':
				return `Number.isInteger(${v})`;
			case 'safe_integer':
				return `Number.isSafeInteger(${v})`;
			case 'regex':
				return `${capture(def)}.test(${v})`;
			case 'check':
				return `${capture(def)}(${v})`;
			case 'uuid':
			case 'iso_datetime':
				// the grammar is the library's, reached by the action's own `run`
				return `handoff(${capture(schema)}, ${v}, P) !== FAIL`;
			default:
				return undefined;
		}
	};

	// each option in a block left at its first failure, in the schema's order,
	// the union left at the first that passes
	const emit_union = (schema: AnySchema, v: string, key: Key | null, bail: string): string => {
		const done = fresh();
		const options: Array<AnySchema> = schema.def;
		let code = `${done}: {\n`;
		for (const option of options) {
			const miss = fresh();
			code += `${miss}: {\n${emit(option, v, key_for(key, ...options), `break ${miss};`)}break ${done};\n}\n`;
		}
		return `${code}${bail}\n}\n`;
	};

	// an object schema as a guard: its entries, then the keys no entry names
	const emit_object = (schema: AnySchema, v: string, bail: string, is_object: boolean): string => {
		const kind = kind_of(schema);
		const def: any = schema.def;
		const entries: Record<string, AnySchema> = kind === 'object_with_rest' ? def.entries : def;
		let code = is_object ? '' : `if (${not_object(v)}) ${bail}\n`;
		for (const name of Object.keys(entries)) {
			const e = fresh();
			code += `const ${e} = ${read(v, name)};\n`;
			code += emit(entries[name]!, e, { object: v, key: quote(name), entry: true }, bail);
		}
		const k = fresh();
		if (kind === 'object') {
			// an enumerable key, own or inherited, that no entry names
			code += `for (const ${k} in ${v}) if (${unknown_key(k, entries)}) ${bail}\n`;
		} else if (kind === 'object_with_rest') {
			// every other own enumerable string key through `rest`, but an own
			// `__proto__` key, which is dropped unread
			const e = fresh();
			code +=
				`for (const ${k} in ${v}) {\n` +
				`if (${unknown_key(k, entries)} && Object.hasOwn(${v}, ${k}) && ${k} !== "__proto__") {\n` +
				`const ${e} = ${v}[${k}];\n${emit(def.rest, e, null, bail)}}\n}\n`;
		}
		return code;
	};

	// Statements that fall through where `v` passes `schema`, and run `bail`
	// where it doesn't: the guard
	const emit = (schema: AnySchema, v: string, key: Key | null, bail: string): string => {
		const c = cond(schema, v, key);
		if (c !== undefined) {
			return c === 'true' ? '' : c === 'false' ? `${bail}\n` : `if (!(${c})) ${bail}\n`;
		}
		const kind = kind_of(schema);
		const def: any = schema.def;
		switch (kind) {
			case 'optional':
				return `if (${v} !== undefined) {\n${emit(def.schema, v, null, bail)}}\n`;
			case 'nullable':
				return `if (${v} !== null) {\n${emit(def.schema, v, key_for(key, def.schema), bail)}}\n`;
			case 'with_default':
				return `if (${v} !== undefined) {\n${emit(def.schema, v, null, bail)}}\n`;
			case 'with_default_fn':
				// `make` is called and what it gives dropped, as `is` does
				return `if (${v} === undefined) ${capture(def.make)}();\nelse {\n${emit(def.schema, v, null, bail)}}\n`;
			case 'object':
			case 'loose_object':
			case 'strip_object':
			case 'object_with_rest':
				return emit_object(schema, v, bail, false);
			case 'record':
			case 'keyed_record': {
				const k = fresh();
				const e = fresh();
				// every own enumerable string key, an own `__proto__` key among them. A
				// key that fails its schema has its value left unread
				return (
					`if (${not_object(v)}) ${bail}\n` +
					`for (const ${k} in ${v}) {\nif (!Object.hasOwn(${v}, ${k})) continue;\n` +
					(kind === 'keyed_record' ? emit(def.key, k, null, bail) : '') +
					`const ${e} = ${v}[${k}];\n${emit(kind === 'record' ? def : def.value, e, null, bail)}}\n`
				);
			}
			case 'array': {
				const i = fresh();
				const n = fresh();
				const e = fresh();
				// the length is read once, as the library reads it
				return (
					`if (!Array.isArray(${v})) ${bail}\n` +
					`for (let ${i} = 0, ${n} = ${v}.length; ${i} < ${n}; ${i}++) {\nconst ${e} = ${v}[${i}];\n` +
					`${emit(def, e, null, bail)}}\n`
				);
			}
			case 'union':
				return emit_union(schema, v, key, bail);
			case 'variant': {
				const d = fresh();
				let code = `if (${not_object(v)}) ${bail}\nconst ${d} = ${read(v, def.key)};\nswitch (${d}) {\n`;
				let of_nan = `${bail}\n`;
				for (const [value, option] of options_of(def)) {
					const body = emit_object(option, v, bail, true);
					// eslint-disable-next-line no-self-compare
					if (value !== value) of_nan = `if (${d} === ${d}) ${bail}\n${body}`;
					else code += `case ${literal(value)}: {\n${body}break;\n}\n`;
				}
				return `${code}default: {\n${of_nan}}\n}\n`;
			}
			default: {
				// a pipe, or an action that makes a value, alone
				if (may_change(schema)) return emit_out(schema, v, key, bail)[0];
				const steps = steps_of(schema);
				const starts_optional = kind_of(steps[0]!) === 'optional';
				const code = steps
					.map((step, i) =>
						emit(step, v, i || starts_optional ? null : key_for(key, steps[0]!), bail)
					)
					.join('');
				// as the entry itself, a pipe that starts with an `optional` runs no step for a missing key
				return starts_optional && key?.entry
					? `if (${key.key} in ${key.object}) {\n${code}}\n`
					: code;
			}
		}
	};

	// the option of each discriminator value, the last given of two alike, as
	// the library's map has it
	const options_of = (def: any): Map<unknown, AnySchema> => {
		const by_value: Map<unknown, AnySchema> = new Map();
		for (const option of def.options) by_value.set(option.def[def.key].def, option);
		return by_value;
	};

	// whether a valid output of `schema` is never `undefined`, so a copy always writes its key
	const is_definite = (schema: AnySchema): boolean => {
		const kind = kind_of(schema);
		const def: any = schema.def;
		return (
			/^(string|number|boolean|bigint|array|variant)$|object|record/.test(kind) ||
			(kind === 'literal' && def !== undefined) ||
			(kind === 'one_of' && !def.includes(undefined)) ||
			(kind === 'pipe' && !may_change(schema) && is_definite(def[0])) ||
			(kind === 'with_default' && def.value !== undefined && is_definite(def.schema))
		);
	};

	// The subtree of `schema` run in place, by its own `run`, for its output
	const emit_handoff = (
		schema: AnySchema,
		v: string,
		key: Key | null,
		bail: string
	): [code: string, out: string] => {
		const o = fresh();
		return [
			`const ${o} = handoff(${capture(schema)}, ${v}, ${context}${key_args(key, true)});\nif (${o} === FAIL) ${bail}\n`,
			o
		];
	};

	// Statements that run `bail` where `v` fails `schema` and otherwise leave
	// its output in the variable they name: `v` itself where nothing under the
	// schema can change a value, which is the guard's code, and else a copy
	// made only where a child's output differs, as the library copies
	const emit_out = (
		schema: AnySchema,
		v: string,
		key: Key | null,
		bail: string
	): [code: string, out: string] => {
		if (!may_change(schema)) return [emit(schema, v, key, bail), v];
		const kind = kind_of(schema);
		const def: any = schema.def;
		const o = fresh();
		const called = (target: AnySchema): [string, string] => [
			`const ${o} = ${call_of(target, v, key, true)};\nif (${o} === FAIL) ${bail}\n`,
			o
		];
		if (is_called(schema)) return called(schema);
		switch (kind) {
			case 'optional':
			case 'nullable': {
				const [code, out] = emit_out(
					def.schema,
					v,
					kind === 'optional' ? null : key_for(key, def.schema),
					bail
				);
				return [
					`let ${o} = ${v};\nif (${v} !== ${kind === 'optional' ? 'undefined' : 'null'}) {\n${code}${o} = ${out};\n}\n`,
					o
				];
			}
			case 'with_default':
			case 'with_default_fn': {
				const [code, out] = emit_out(def.schema, v, null, bail);
				// the value as it is, the same on every parse, or what `make` gives this one
				const filled = kind === 'with_default' ? literal(def.value) : `${capture(def.make)}()`;
				return [
					`let ${o};\nif (${v} === undefined) ${o} = ${filled};\nelse {\n${code}${o} = ${out};\n}\n`,
					o
				];
			}
			case 'lazy':
				return called(target_of(schema));
			case 'object':
			case 'loose_object':
			case 'strip_object':
				return emit_object_out(schema, v, bail, false);
			case 'array': {
				const i = fresh();
				const n = fresh();
				const e = fresh();
				const [code, out] = emit_out(def, e, null, bail);
				// one `slice` of the whole length at the first item that changed
				return [
					`if (!Array.isArray(${v})) ${bail}\nlet ${o} = ${v};\n` +
						`for (let ${i} = 0, ${n} = ${v}.length; ${i} < ${n}; ${i}++) {\nconst ${e} = ${v}[${i}];\n${code}` +
						`if (${o} !== ${v}) ${o}[${i}] = ${out};\nelse if (!Object.is(${out}, ${e})) {\n${o} = ${v}.slice(0, ${n});\n${o}[${i}] = ${out};\n}\n}\n`,
					o
				];
			}
			case 'record': {
				const k = fresh();
				const j = fresh();
				const e = fresh();
				const [code, out] = emit_out(def, e, null, bail);
				// an own `__proto__` key is validated and left out, which starts a copy
				return [
					`if (${not_object(v)}) ${bail}\nlet ${o} = ${v};\n` +
						`for (const ${k} in ${v}) {\nif (!Object.hasOwn(${v}, ${k})) continue;\nconst ${e} = ${v}[${k}];\n${code}` +
						`if (${o} !== ${v}) {\nif (${k} !== "__proto__") ${o}[${k}] = ${out};\n} else if (${k} === "__proto__" || !Object.is(${out}, ${e})) {\n${o} = {};\n` +
						`for (const ${j} in ${v}) {\nif (${j} === ${k}) break;\nif (Object.hasOwn(${v}, ${j}) && ${j} !== "__proto__") ${o}[${j}] = ${v}[${j}];\n}\n` +
						`if (${k} !== "__proto__") ${o}[${k}] = ${out};\n}\n}\n`,
					o
				];
			}
			case 'variant': {
				const d = fresh();
				let code = `if (${not_object(v)}) ${bail}\nlet ${o};\nconst ${d} = ${read(v, def.key)};\nswitch (${d}) {\n`;
				let of_nan = `${bail}\n`;
				for (const [value, option] of options_of(def)) {
					const [body, out] = emit_object_out(option, v, bail, true);
					// eslint-disable-next-line no-self-compare
					if (value !== value) of_nan = `if (${d} === ${d}) ${bail}\n${body}${o} = ${out};\n`;
					else code += `case ${literal(value)}: {\n${body}${o} = ${out};\nbreak;\n}\n`;
				}
				return [`${code}default: {\n${of_nan}}\n}\n`, o];
			}
			case 'union': {
				// The first option that matches gives the output. Left to the
				// interpreter: a `memo_union`, whose memo of outputs is the library's,
				// and a union whose options are handed the object and the key, which
				// the library may try again without them where a later option fills
				// a missing key in
				if (memos.has(schema) || key_for(key, ...def)) {
					return emit_handoff(schema, v, key, bail);
				}
				const done = fresh();
				// A subtree run in place under an option is probed, as the library
				// probes a union's options. Where every option fails, what follows is
				// an option of a union around this one, still probed, or the parse's end
				const was = fresh();
				const probes = shares_context && output;
				let code = `let ${o};\n${probes ? `const ${was} = ${context}.probe;\nctx.probe = true;\n` : ''}${done}: {\n`;
				for (const option of def) {
					const miss = fresh();
					const [of_option, out] = emit_out(option, v, null, `break ${miss};`);
					code += `${miss}: {\n${of_option}${o} = ${out};\nbreak ${done};\n}\n`;
				}
				return [`${code}${bail}\n}\n${probes ? `ctx.probe = ${was};\n` : ''}`, o];
			}
			case 'pipe':
			case 'to_lower_case':
			case 'to_integer':
			case 'transform': {
				const steps = steps_of(schema);
				const starts_optional = kind === 'pipe' && kind_of(steps[0]!) === 'optional';
				let code = '';
				let current = v;
				steps.forEach((step, i) => {
					const t = fresh();
					const of_step = kind_of(step);
					if (of_step === 'to_lower_case') code += `const ${t} = ${current}.toLowerCase();\n`;
					else if (of_step === 'transform') {
						code += `const ${t} = ${capture(step.def)}(${current});\n`;
					} else if (of_step === 'to_integer') {
						code += `const ${t} = handoff(${capture(step)}, ${current}, P);\nif (${t} === FAIL) ${bail}\n`;
					} else {
						const [of_it, out] = emit_out(
							step,
							current,
							i || starts_optional ? null : key_for(key, steps[0]!),
							bail
						);
						code += of_it;
						current = out;
						return;
					}
					current = t;
				});
				// as the entry itself, a pipe that starts with an `optional` runs no step for
				// a missing key and gives `undefined` for it
				return starts_optional && key?.entry
					? [`let ${o};\nif (${key.key} in ${key.object}) {\n${code}${o} = ${current};\n}\n`, o]
					: [code, current];
			}
			default:
				// a `keyed_record`, an `object_with_rest`, and a schema run in place
				return emit_handoff(schema, v, key, bail);
		}
	};

	// An object schema's output: its entries' outputs, and a copy where one
	// differs from what was read or a key is to be dropped. A copy has the
	// schema's keys in its order, each written from the output its entry gave,
	// a key the input lacks left out unless its entry gave a value, then for a
	// `loose_object` the input's other own keys in its order, but `__proto__`
	const emit_object_out = (
		schema: AnySchema,
		v: string,
		bail: string,
		is_object: boolean
	): [code: string, out: string] => {
		if (!may_change(schema)) return [emit_object(schema, v, bail, is_object), v];
		const kind = kind_of(schema);
		const def: Record<string, AnySchema> = schema.def;
		const all_names = Object.keys(def);
		// by entry: the variable it was read to, and the one its output is in.
		// Maps, as an entry may be named anything, `__proto__` too
		const read_of: Map<string, string> = new Map();
		const out_of: Map<string, string> = new Map();
		let code = is_object ? '' : `if (${not_object(v)}) ${bail}\n`;
		for (const name of all_names) {
			const e = fresh();
			const [of_entry, out] = emit_out(
				def[name]!,
				e,
				{ object: v, key: quote(name), entry: true },
				bail
			);
			code += `const ${e} = ${read(v, name)};\n${of_entry}`;
			read_of.set(name, e);
			out_of.set(name, out);
		}
		const k = fresh();
		if (kind === 'object') code += `for (const ${k} in ${v}) if (${unknown_key(k, def)}) ${bail}\n`;
		const o = fresh();
		code += `let ${o} = ${v};\n`;
		let changed =
			all_names
				.filter((n) => out_of.get(n) !== read_of.get(n))
				.map((n) => `!Object.is(${out_of.get(n)}, ${read_of.get(n)})`)
				.join(' || ') || 'false';
		if (kind === 'strip_object') {
			// a key to drop is looked for only where no entry changed
			const dropped = fresh();
			code += `let ${dropped} = ${changed};\nif (!${dropped}) for (const ${k} in ${v}) if (${unknown_key(k, def)}) {\n${dropped} = true;\nbreak;\n}\n`;
			changed = dropped;
		}
		// one literal where every key is always written, and else an empty
		// object and a write for each key, as the library makes a copy
		const literal_form = all_names.every((n) => is_definite(def[n]!));
		code += `if (${changed}) {\n${o} = { ${literal_form ? all_names.map((n) => `${quote(n)}: ${out_of.get(n)}`).join(', ') : ''} };\n`;
		if (!literal_form) {
			for (const n of all_names) {
				const write = `${o}[${quote(n)}] = ${out_of.get(n)};\n`;
				code += is_definite(def[n]!)
					? write
					: `if (${out_of.get(n)} !== undefined || ${quote(n)} in ${v}) ${write}`;
			}
		}
		if (kind === 'loose_object') {
			code += `for (const ${k} in ${v}) if (${unknown_key(k, def)} && Object.hasOwn(${v}, ${k}) && ${k} !== "__proto__") ${o}[${k}] = ${v}[${k}];\n`;
		}
		return [`${code}}\n`, o];
	};

	let main: string;
	// where compiled code can run the stack out, the root catches any
	// `RangeError` and the interpreter answers, or throws its own: a schema with
	// a lazy, a `memo_union`, or a schema of a kind the compiler has no code for
	const deep = targets.size > 0 || shares_context;
	if (output) {
		const [code, out] = emit_out(root, 'v', null, deep ? 'break X;' : 'return fallback(v);');
		main = `${deep ? 'X: {\n' : ''}${code}return { ok: true, value: ${out} };\n${deep ? '}\n' : ''}`;
	} else {
		main = `${emit(root, 'v', null, 'return false;')}return true;\n`;
	}
	// The state of a call is this call's own: what it was is kept as the root
	// is entered and put back as it is left, a throw included, so a call made
	// from a `check` this one is running leaves this one's state as it was.
	// Emitted only for a schema that has such state
	if (deep) {
		const saved = state.map(() => fresh());
		const error = fresh();
		main =
			(state.length
				? `const ${state.map(([name], i) => `${saved[i]} = ${name}`).join(', ')};\n`
				: '') +
			state.map(([name, initial]) => `${name} = ${initial};\n`).join('') +
			`try {\n${main}} catch (${error}) {\nif (!(${error} instanceof RangeError)) throw ${error};\n}` +
			(state.length
				? ` finally {\n${state.map(([name], i) => `${name} = ${saved[i]};\n`).join('')}}`
				: '') +
			`\nreturn fallback(v);\n`;
	}
	return {
		body:
			[...captures.values()].map((i) => `const c${i} = c[${i}];\n`).join('') +
			state.map(([name, initial]) => `let ${name} = ${initial};\n`).join('') +
			fns.map((fn) => fn + '\n').join('') +
			`return function (v) {\n${main}};\n`,
		captures: [...captures.keys()]
	};
};

// The function of `source`, or `undefined` where the environment refuses to
// make one from text, which is an `EvalError`
const to_function = (source: CompiledSource, fallback: (value: unknown) => unknown): any => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
		return new Function('c', 'handoff', 'P', 'FAIL', 'fallback', source.body)(
			source.captures,
			handoff,
			PROBE,
			FAIL,
			fallback
		);
	} catch (error) {
		if (error instanceof EvalError) return undefined;
		throw error;
	}
};

/**
 * Compiles `schema` to a guard: a function that gives `is(schema, value)`,
 * from straight-line code that builds no issue, and no context or output but
 * where a subtree runs in place, a `memo_union` keeps its verdicts, or a step
 * of a `pipe` makes the value the next step is given.
 *
 * Every kind of the library is compiled. A schema of a kind defined outside
 * it, or whose `def` is not what its kind holds, is run in place by its own
 * `run`, in probe mode, with the code around it compiled. Where `new Function`
 * is refused, the function returned calls `is`.
 *
 * A user's `check`, `transform`, and `with_default_fn` run as `is` runs them,
 * and again in `is` where compiled code ran out of stack, see the module's
 * comment for what may differ from `is`, what is refused, and the bound of a
 * schema that compiles.
 *
 * @param schema - read at the compile, by its `kind` and `def`, and never written to
 * @returns the guard, which the caller keeps: nothing is kept on the schema
 * @throws Error naming the path where `schema`, or what a `lazy`'s function returns, is not a schema, the kind and the path of a schema nested deeper than `COMPILE_MAX_DEPTH`, through every `lazy`, and the path of a `union` or a `pipe` the library can walk in time exponential in the depth of an input, with what to write instead
 * @example
 * ```ts
 * const User = s.object({name: s.string, tags: s.array(s.string)});
 * const is_user = compile_guard(User);
 * is_user({name: 'Ada', tags: []}); // true
 * is_user({name: 'Ada'}); // false
 * ```
 */
// @__NO_SIDE_EFFECTS__
export const compile_guard = <T extends Schema>(
	schema: T
): ((value: unknown) => value is InferInput<T>) => {
	const fallback = (value: unknown): value is InferInput<T> => is(schema, value);
	return to_function(to_source(schema, false), fallback) ?? fallback;
};

/**
 * Compiles `schema` to a parse: a function that gives `parse(schema, value)`.
 *
 * For an input that matches, the result is built by compiled code: the input
 * itself where nothing changed, and a copy only where the library makes one,
 * with the library's keys, in its order. A `keyed_record`, an
 * `object_with_rest`, a `union` that may try an option again without its key,
 * a `memo_union` that can change a value, and a schema with no code of the
 * compiler's are run in place, by their own `run`, for their output. For an
 * input that fails, the function calls `parse`, so the issues are the
 * library's. Where `new Function` is refused, it calls `parse` for every
 * input.
 *
 * A user's `check`, `transform`, and `with_default_fn` that ran before a
 * failure run again in that `parse`, see the module's comment for what may
 * differ from `parse`, what is refused, and the bound of a schema that
 * compiles.
 *
 * @param schema - read at the compile, by its `kind` and `def`, and never written to
 * @returns the parse, which the caller keeps: nothing is kept on the schema
 * @throws Error naming the path where `schema`, or what a `lazy`'s function returns, is not a schema, the kind and the path of a schema nested deeper than `COMPILE_MAX_DEPTH`, through every `lazy`, and the path of a `union` or a `pipe` the library can walk in time exponential in the depth of an input, with what to write instead
 * @example
 * ```ts
 * const Settings = s.object({theme: s.with_default(s.string, 'dark')});
 * const parse_settings = compile_parse(Settings);
 * parse_settings({}); // {ok: true, value: {theme: 'dark'}}
 * parse_settings({theme: 1}); // {ok: false, issues: [...]}, from `parse`
 * ```
 */
// @__NO_SIDE_EFFECTS__
export const compile_parse = <T extends Schema>(
	schema: T
): ((value: unknown) => SchemaResult<Infer<T>>) => {
	const fallback = (value: unknown): SchemaResult<Infer<T>> => parse(schema, value);
	return to_function(to_source(schema, true), fallback) ?? fallback;
};
