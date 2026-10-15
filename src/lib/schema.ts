/**
 * Small, fast schema validation.
 *
 * The strategy is valibot's: one tree-shakeable export per schema and action,
 * schemas as plain data, and `pipe` for refinement. The internals differ:
 *
 * - Every schema and action is the same three-field object, `kind`, `def`,
 *   and `run`. There is no separate action type, so `pipe` is a loop over
 *   schemas, and every `run` call site loads from one object shape.
 * - `kind` and `def` describe a schema as data. What each kind's `def` holds
 *   is written down in `SchemaDefs`.
 * - `run` returns the output directly and reports failure by counting it in
 *   `ctx.fails`. Nothing is allocated per node on the success path.
 * - Output is copy-on-write: a container returns its input when nothing in it
 *   changed, so a valid value with no defaults, transforms, or keys to drop
 *   comes back as the same object. Callers must not assume a fresh copy, and
 *   a changed subtree still shares its unchanged siblings with the input.
 *   Changed is as `Object.is` tells: a `0` made `-0` is, a `NaN` kept is not.
 * - Issue paths are built on unwind: a container prefixes its key onto the
 *   issues its child added, so valid input never touches a path. Each prefix
 *   is a new array, so a path is replaced as it grows and never changed.
 * - Schemas with no options are constants (`string`, not `string()`).
 * - Messages are derived from structured issues by `format_issue`, which is
 *   only bundled when used.
 * - An issue names the type of the value that failed and never holds the
 *   value, so issues can be logged, serialized, and kept without the input.
 * - A `union` tries its options, and `is` runs, in probe mode: failures are
 *   counted without building issues.
 *
 * Import as a namespace: `import * as s from '@fuzdev/fuz_schema/schema.ts'`.
 * The design is described at more length in `docs/design.md`.
 *
 * @module
 */

/**
 * A validation failure. It holds nothing of the input but the keys in `path`:
 * the value that failed is described by `received` and not kept. A `message`
 * function is handed the value, and `get_issue_value` reads it back out of
 * the input.
 */
export interface SchemaIssue {
	/**
	 * The `kind` of the schema or check that failed, or `unknown_key` or
	 * `missing_key` for a failure about a key of an object.
	 */
	kind: string;
	/** Describes what was expected. */
	expected: string;
	/**
	 * The type of the value that failed: `'null'`, `'array'`, `'NaN'`,
	 * `'Infinity'`, or `'-Infinity'`, or else its `typeof`.
	 */
	received: string;
	/**
	 * Keys from the root value to the one that failed, outermost first.
	 * The keys are the input's: an unknown key or a `record` key is whatever
	 * the input named it, so treat them as untrusted text.
	 */
	path: Array<PropertyKey>;
	/** Custom text set by `message`, used by `format_issue` in place of the default. */
	message: string | undefined;
}

/**
 * Mutable state threaded through a single parse.
 */
export interface SchemaContext {
	/**
	 * One per failure, except in probe mode where it stays as it was.
	 * `undefined` until the first, so a parse with no failure allocates none.
	 */
	issues: Array<SchemaIssue> | undefined;
	/**
	 * How many failures have been reported. A container knows a child failed
	 * when this grew. Outside probe mode it equals `issues.length`, and is `0`
	 * while there is no `issues`.
	 */
	fails: number;
	/**
	 * When `true` only whether the value matches is wanted: failures are
	 * counted without building issues, and containers return at their first
	 * failed child. Set by `union` while trying options and by `is`.
	 */
	probe: boolean;
}

/**
 * A schema or action. `run` returns the output for `value`,
 * or reports a failure with `fail` and returns anything.
 *
 * All schemas share this exact shape so `run` call sites stay monomorphic;
 * kind-specific data goes in `def`.
 *
 * The object schemas call an entry's `run` with three more arguments, the
 * object being read, the entry's key, and `1`, so a schema that accepts
 * `undefined` can tell a key that is missing from one that is there.
 * `nullable`, `lazy`, `union`, `pipe`, and `message` pass the object and the
 * key on to what they hold as the entry, and only `message` passes the third,
 * which says that what it holds is the entry itself. Every other call gives
 * the first two only, and a `run` that takes only those works as an entry.
 */
export interface Schema<
	TOutput = unknown,
	TInput = TOutput,
	TKind extends string = string,
	TDef = unknown
> {
	readonly kind: TKind;
	readonly def: TDef;
	/**
	 * A schema that reads `parent` and `key` declares them as plain parameters,
	 * with no default and not as a rest: `nullable`, `union`, `pipe`, and
	 * `message` pass them on only to a `run` whose `length` says it takes them
	 * or to a schema of kind `'lazy'`, read once when each is made. A `lazy`
	 * passes on the object and the key it is called with.
	 *
	 * @param value - the value to validate
	 * @param ctx - the state of the parse, where a failure is reported with `fail`
	 * @param parent - the object `value` was read from, when an object schema is running an entry
	 * @param key - the entry's key in `parent`, given with it
	 * @param entry - `1` when this schema is the entry itself, as an object schema hands it and a `message` around it passes on, and absent where another schema passes the object and the key on
	 */
	readonly run: (
		value: any,
		ctx: SchemaContext,
		parent?: Record<PropertyKey, unknown>,
		key?: PropertyKey,
		entry?: 1
	) => TOutput;
	/** Type-only, never set at runtime. */
	readonly '~types'?: { readonly input: TInput };
}

export type AnySchema = Schema<any, any, string, any>;

/**
 * What the `def` of each kind of schema holds: the contract for reading a
 * schema as data. `kind` names an entry here, and `def` is that entry's type.
 *
 * A `def` is as close to plain JSON as its kind allows. A kind that takes no
 * options has `undefined`, one that takes a single value has that value, and
 * `optional`, `nullable`, `with_default`, and `with_default_fn` have an object
 * with their schema under `schema`. The object schemas have their entries, and
 * `object_with_rest` has an object with them under `entries`.
 *
 * `message`, `flavor`, and `brand` have no kind of their own: what they
 * return has the `kind` and `def` of the schema they were given.
 *
 * A schema of a kind defined outside this module is typed by adding its
 * entry through declaration merging, which adds it to `SchemaNode` too.
 */
export interface SchemaDefs {
	string: undefined;
	number: undefined;
	boolean: undefined;
	bigint: undefined;
	unknown: undefined;
	/** The value matched. */
	literal: SchemaLiteral;
	/** The values matched, in the order given. */
	one_of: ReadonlyArray<SchemaLiteral>;
	optional: { readonly schema: SchemaNode };
	nullable: { readonly schema: SchemaNode };
	/** `value` replaces `undefined`, and is returned as it is. */
	with_default: { readonly schema: SchemaNode; readonly value: unknown };
	/** `make` is called for each `undefined`, and what it returns replaces it. */
	with_default_fn: { readonly schema: SchemaNode; readonly make: () => unknown };
	/**
	 * The function given, which returns the schema deferred to. It is not a
	 * wrapper's `schema` because nothing is held until it is called, and
	 * following it is how a walk of a recursive schema comes back to where it was.
	 */
	lazy: () => SchemaNode;
	/** The entries, in the order they run. */
	object: Readonly<Record<string, SchemaNode>>;
	loose_object: Readonly<Record<string, SchemaNode>>;
	strip_object: Readonly<Record<string, SchemaNode>>;
	/** The entries, in the order they run, and `rest`, the schema of every other own key. */
	object_with_rest: {
		readonly entries: Readonly<Record<string, SchemaNode>>;
		readonly rest: SchemaNode;
	};
	/** The schema of every value. */
	record: SchemaNode;
	/** The schema of every item. */
	array: SchemaNode;
	/** The options, in the order they are tried. */
	union: ReadonlyArray<SchemaNode>;
	/** `key` is the discriminator, a `literal` entry of every one of `options`. */
	variant: {
		readonly key: string;
		readonly options: ReadonlyArray<SchemaNode<'object' | 'loose_object' | 'strip_object'>>;
	};
	/** The schema, then the actions run on its output. */
	pipe: ReadonlyArray<SchemaNode>;
	min_length: number;
	max_length: number;
	min_value: number | bigint;
	max_value: number | bigint;
	integer: undefined;
	safe_integer: undefined;
	regex: RegExp;
	check: (value: any) => boolean;
	transform: (value: any) => unknown;
}

/** The `kind` of every schema and action `SchemaDefs` describes. */
export type SchemaKind = keyof SchemaDefs;

/** The type of `def` for the kind `TKind`. */
export type SchemaDef<TKind extends SchemaKind = SchemaKind> = SchemaDefs[TKind];

/**
 * A schema read as data: a union of one member per kind, each pairing its
 * `kind` with its `def`, so checking `kind` narrows `def`. With no argument
 * it is every kind, and with one it is the member of that kind.
 *
 * The schemas inside a `def` are typed as this too, so a walk needs no cast:
 *
 * ```ts
 * const count = (schema: SchemaNode): number => {
 * 	switch (schema.kind) {
 * 		case 'optional':
 * 		case 'nullable':
 * 		case 'with_default':
 * 		case 'with_default_fn':
 * 			return 1 + count(schema.def.schema);
 * 		case 'array':
 * 		case 'record':
 * 			return 1 + count(schema.def);
 * 		default:
 * 			return 1;
 * 	}
 * };
 * ```
 *
 * A schema whose own type names its kind is assignable to it. One typed as
 * `AnySchema` or as a bare `Schema` is not, and gets here through `is_schema`.
 */
export type SchemaNode<TKind extends SchemaKind = SchemaKind> = TKind extends unknown
	? SchemaOfKind<TKind>
	: never;

interface SchemaOfKind<TKind extends SchemaKind> extends Schema<
	unknown,
	unknown,
	TKind,
	SchemaDefs[TKind]
> {}

/** The output type of a schema. */
export type Infer<T extends AnySchema> = ReturnType<T['run']>;

/** The input type a schema accepts. */
export type InferInput<T extends AnySchema> = NonNullable<T['~types']>['input'];

/**
 * A schema that refines or transforms an already-typed value, for use in `pipe`.
 */
export type SchemaAction<TInput, TOutput = TInput> = Schema<TOutput, TInput>;

export type SchemaEntries = Record<string, AnySchema>;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

type OptionalOutputKeys<T extends SchemaEntries> = {
	[K in keyof T]: T[K] extends { kind: 'optional' } ? K : never;
}[keyof T];

type OptionalInputKeys<T extends SchemaEntries> = {
	[K in keyof T]: T[K] extends { kind: 'optional' | 'with_default' | 'with_default_fn' }
		? K
		: never;
}[keyof T];

export type SchemaObjectOutput<T extends SchemaEntries> = Flatten<
	{ [K in Exclude<keyof T, OptionalOutputKeys<T>>]: Infer<T[K]> } & {
		[K in OptionalOutputKeys<T>]?: Infer<T[K]>;
	}
>;

export type SchemaObjectInput<T extends SchemaEntries> = Flatten<
	{ [K in Exclude<keyof T, OptionalInputKeys<T>>]: InferInput<T[K]> } & {
		[K in OptionalInputKeys<T>]?: InferInput<T[K]>;
	}
>;

export type SchemaResult<T> = { ok: true; value: T } | { ok: false; issues: Array<SchemaIssue> };

export type SchemaLiteral = string | number | bigint | boolean | null | undefined;

//
// Core
//

// runs every entry and returns the output, or `undefined` when a probe failed,
// the output being `value` itself until an entry's output differs from its input,
// which copies the entries before it. Every container tells that by `Object.is`:
// `===` reads a `0` made `-0` as no change, and a `NaN` passed through as one.
// An entry is handed `value`, its key, and `1` too, for a schema that accepts
// `undefined` and still needs its key to be there, and for a `pipe` that
// starts with an `optional`, which runs no step for a key that is missing.
// It is first in the module, where the core bundle measured smaller than
// beside the object schemas
const run_entries = (
	keys: Array<string>,
	schemas: Array<AnySchema>,
	value: Record<string, unknown>,
	ctx: SchemaContext
): Record<string, unknown> | undefined => {
	let output: Record<string, unknown> | undefined;
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!;
		const input = value[key];
		const count = ctx.fails;
		const v = schemas[i]!.run(input, ctx, value, key, 1);
		if (ctx.fails > count) {
			if (ctx.probe) return;
			prefix_path(ctx.issues!, count, key);
		} else if (output) {
			// a key the input doesn't have stays out of the output
			if (v !== undefined || key in value) output[key] = v;
		} else if (!Object.is(v, input)) {
			output = {};
			// only this schema's keys, in its order
			for (let j = 0; j < i; j++) {
				const k = keys[j]!;
				const u = value[k];
				if (u !== undefined || k in value) output[k] = u;
			}
			output[key] = v;
		}
	}
	return output ?? value;
};

/**
 * Records an issue. Returns `value` so a `run` can fail in expression position.
 *
 * @param value - the value that failed, which the issue names the type of and doesn't hold
 * @param expected - describes what was expected, defaulting to `kind`
 * @mutates ctx - increments `ctx.fails`, and outside probe mode pushes to `ctx.issues`, creating it on the first
 */
export const fail = (
	ctx: SchemaContext,
	kind: string,
	value: unknown,
	expected: string = kind
): any => {
	ctx.fails++;
	if (!ctx.probe) {
		const issue: SchemaIssue = {
			kind,
			expected,
			// `get_issue_value` names a type the same way, to compare against this.
			// `isFinite` converts what it is given, and is given only a number
			received:
				value === null
					? 'null'
					: Array.isArray(value)
						? 'array'
						: typeof value === 'number' && !isFinite(value)
							? '' + value
							: typeof value,
			path: [],
			message: undefined
		};
		// the first issue is the array's one element: a push onto an empty array
		// grows it to hold many
		if (ctx.issues) ctx.issues.push(issue);
		else ctx.issues = [issue];
	}
	return value;
};

// prefixes `key` onto the path of every issue added since `from`,
// callers must not be in probe mode. The path is a new array each time:
// `unshift` is a call the engine doesn't inline, and its first on an empty
// array grows it to hold many. A path past one key pays for that in bytes,
// an array a level
const prefix_path = (issues: Array<SchemaIssue>, from: number, key: PropertyKey): void => {
	for (let i = from; i < issues.length; i++) issues[i]!.path = [key, ...issues[i]!.path];
};

// like `fail` for an issue about `key` of `value`, which is read only when an
// issue is built: a probe has no use for it, and is handed `true` in its place
const fail_at = (
	ctx: SchemaContext,
	kind: string,
	value: Record<PropertyKey, unknown>,
	expected: string,
	key: PropertyKey
): void => {
	const count = ctx.fails;
	fail(ctx, kind, ctx.probe || value[key], expected);
	if (!ctx.probe) prefix_path(ctx.issues!, count, key);
};

// whether `value` is anything but an object that isn't an array,
// stated in the negative because that is the form every caller wants
const not_object = (value: unknown): boolean =>
	value === null || typeof value !== 'object' || Array.isArray(value);

/**
 * Validates `value`, returning the output or every issue found.
 */
export const parse = <T extends AnySchema>(schema: T, value: unknown): SchemaResult<Infer<T>> => {
	const ctx: SchemaContext = { issues: undefined, fails: 0, probe: false };
	const output = schema.run(value, ctx);
	return ctx.fails ? { ok: false, issues: ctx.issues! } : { ok: true, value: output };
};

/**
 * Validates `value` and returns the output.
 *
 * @throws SchemaError when `value` doesn't match
 */
export const parse_or_throw = <T extends AnySchema>(schema: T, value: unknown): Infer<T> => {
	const ctx: SchemaContext = { issues: undefined, fails: 0, probe: false };
	const output = schema.run(value, ctx);
	if (ctx.fails) throw new SchemaError(ctx.issues!);
	return output;
};

/**
 * Checks whether `value` matches `schema`, without building issues
 * and stopping at the first failure.
 * Narrows to the input type because the output is discarded.
 */
export const is = <T extends AnySchema>(schema: T, value: unknown): value is InferInput<T> => {
	const ctx: SchemaContext = { issues: undefined, fails: 0, probe: true };
	schema.run(value, ctx);
	return !ctx.fails;
};

/**
 * Checks whether `value` has the shape of a schema: an object with a string
 * `kind`, a `def`, and a `run` function.
 *
 * The check is structural and stops there. It doesn't look at whether `kind`
 * is one `SchemaDefs` describes or whether `def` is what that kind holds, so
 * the narrowing is a claim about values this library built, not a validation
 * of ones that came from elsewhere. Keys past the three are ignored.
 *
 * The narrowed type is for reading a schema as data. A schema typed with its
 * kind keeps its own type, while one typed as a bare `Schema` or `AnySchema`
 * (as recursive schemas usually are) reads as `SchemaNode`, whose output type
 * is `unknown`.
 */
export const is_schema = (value: unknown): value is SchemaNode =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as AnySchema).kind === 'string' &&
	typeof (value as AnySchema).run === 'function' &&
	'def' in value;

/**
 * Formats an issue as `path: expected X, received Y`, the path's keys joined
 * with `.`.
 *
 * A key that isn't only word characters is quoted as JSON, so the text reads
 * one way whatever the input's keys are: `a.b` is two keys and `"a.b"` is
 * one, and a key with a newline or carriage return stays on its line. Text set by
 * `message` is used as it is.
 */
export const format_issue = (issue: SchemaIssue): string =>
	(issue.path.length
		? issue.path
				.map(String)
				.map((key) => (/^\w+$/.test(key) ? key : JSON.stringify(key)))
				.join('.') + ': '
		: '') + (issue.message ?? `expected ${issue.expected}, received ${issue.received}`);

/**
 * Reads the value `issue` is about out of `input`, the value that was parsed,
 * by following `issue.path`. It refuses where it would have to guess:
 *
 * - when the path leads through something that isn't an object or array
 * - when what it finds is not of the type the issue received
 *
 * Only own keys are read. A key that is missing reads as `undefined`, which
 * is what the schema saw, so a missing required key is found with the value
 * `undefined`. An inherited value is never returned.
 *
 * The check is by type name, so it can't tell a value from another of the
 * same type. Where an earlier step of a `pipe` replaced the value with one of
 * its own type (a `transform`, or a container that applied a default or
 * dropped a key) the issue is about the replacement, and what is returned is
 * the input's value at that path.
 *
 * @param input - the value given to `parse`, unchanged since
 * @returns `ok` with the value, or not `ok` when it can't be reached
 */
export const get_issue_value = (
	issue: SchemaIssue,
	input: unknown
): { ok: true; value: unknown } | { ok: false } => {
	let value: any = input;
	for (const key of issue.path) {
		if (value === null || typeof value !== 'object') return { ok: false };
		value = Object.hasOwn(value, key) ? value[key] : undefined;
	}
	// the type as `fail` names it
	return (value === null
		? 'null'
		: Array.isArray(value)
			? 'array'
			: typeof value === 'number' && !isFinite(value)
				? '' + value
				: typeof value) === issue.received
		? { ok: true, value }
		: { ok: false };
};

/**
 * Thrown by `parse_or_throw`. The message lists every issue, one per line,
 * as `format_issue` writes it. Like its issues, it holds nothing of the input
 * but the keys in their paths.
 */
export class SchemaError extends Error {
	issues: Array<SchemaIssue>;

	constructor(issues: Array<SchemaIssue>) {
		super(issues.map(format_issue).join('\n'));
		this.name = 'SchemaError';
		this.issues = issues;
	}
}

//
// Primitives
//

export const string: Schema<string, string, 'string', undefined> = {
	kind: 'string',
	def: undefined,
	run: (value, ctx) => (typeof value === 'string' ? value : fail(ctx, 'string', value))
};

/**
 * Matches a finite number: rejects `NaN` and the infinities, with the issue
 * any value that isn't a number gets.
 *
 * A JSON text can carry an infinity as a number too large for a double, which
 * `JSON.parse` reads `1e999` as, and `JSON.stringify` writes one back as
 * `null`. An integer of any size is a finite number, see `integer`.
 *
 * Only `number` is about which numbers: a `literal` or a `one_of` of an
 * infinity still matches it, and a bound of `min_value` or `max_value` may
 * be one.
 */
export const number: Schema<number, number, 'number', undefined> = {
	kind: 'number',
	def: undefined,
	// true of a finite number and of nothing else, so the type is not asked first
	run: (value, ctx) => (Number.isFinite(value) ? value : fail(ctx, 'number', value))
};

export const boolean: Schema<boolean, boolean, 'boolean', undefined> = {
	kind: 'boolean',
	def: undefined,
	run: (value, ctx) => (typeof value === 'boolean' ? value : fail(ctx, 'boolean', value))
};

export const bigint: Schema<bigint, bigint, 'bigint', undefined> = {
	kind: 'bigint',
	def: undefined,
	run: (value, ctx) => (typeof value === 'bigint' ? value : fail(ctx, 'bigint', value))
};

/**
 * Accepts anything.
 *
 * As an object entry it needs its key: `undefined` at a key the object has,
 * own or inherited, is accepted, and a key that is missing fails as a
 * `missing_key`. Write `optional(unknown)` to let the key be missing.
 *
 * It tells the two apart by the object and key the object schema hands it,
 * which reach it as the entry itself and through `flavor`, `brand`, `message`,
 * `nullable`, `lazy`, an option of a `union`, and the first schema of a
 * `pipe`. Anywhere else it is told nothing of a key and accepts `undefined`:
 * at the top level, as an array's item, as a record's value, and as a step
 * of a `pipe` after the first. Under a `union` whose first option to match a
 * missing key after it fills the key in, as a `with_default` does, the key
 * is optional, and it accepts the `undefined`, see `union`.
 */
export const unknown: Schema<unknown, unknown, 'unknown', undefined> = {
	kind: 'unknown',
	def: undefined,
	run: (value, ctx, parent, key) =>
		// the key comes with the object
		value === undefined && parent && !((key as string) in parent)
			? fail(ctx, 'missing_key', value, 'a required key')
			: value
};

// describes literals for an issue's `expected`, quoting strings
const format_literals = (values: Iterable<unknown>): string =>
	Array.from(values, (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(' | ');

/**
 * Matches a single value by `===`, so `0` and `-0` match each other, and
 * matches `NaN` when the value is `NaN`, which `===` alone never would.
 *
 * `literal(undefined)` as an object entry needs its key, as `unknown` does and
 * wherever `unknown` is handed the object and the key: `undefined` at a key
 * the object has, own or inherited, is accepted, and a key that is missing
 * fails as a `missing_key`. Write `optional(literal(undefined))` to let the
 * key be missing.
 */
// @__NO_SIDE_EFFECTS__
export const literal = <const T extends SchemaLiteral>(value: T): Schema<T, T, 'literal', T> => {
	// built on first failure and kept, so a miss costs no allocation after that
	let expected: string | undefined;
	return {
		kind: 'literal',
		def: value,
		// two closures chosen once here, as in `message`. Only `undefined` is what
		// a missing key reads as, so only its literal takes the object and the
		// key: a `run` of four parameters measured slower for every literal
		run:
			value === undefined
				? (v, ctx, parent, key) =>
						v === value
							? // the key comes with the object
								parent && !((key as string) in parent)
								? fail(ctx, 'missing_key', v, 'a required key')
								: v
							: fail(ctx, 'literal', v, (expected ??= format_literals([value])))
				: (v, ctx) =>
						// `NaN` is the one value that isn't itself, and is looked for only after a miss
						// eslint-disable-next-line no-self-compare
						v === value || (v !== v && value !== value)
							? v
							: fail(ctx, 'literal', v, (expected ??= format_literals([value])))
	};
};

/**
 * Matches any of `values` as `literal` matches one: by `===`, so `0` and `-0`
 * match each other, and `NaN` when it is among them.
 *
 * With `undefined` among `values` it needs its key as an object entry, as
 * `literal(undefined)` does. `values` are read once, when the schema is made:
 * changing the array afterwards changes `def` and not what the schema matches.
 */
// @__NO_SIDE_EFFECTS__
export const one_of = <const T extends ReadonlyArray<SchemaLiteral>>(
	values: T
): Schema<T[number], T[number], 'one_of', T> => {
	let expected: string | undefined;
	// built once here and kept in the closure, so `def` stays the array. `has`
	// matches as `includes` does, `NaN` included, in a time the length doesn't
	// set, and the first value is looked at before it. An empty list's first is
	// `NaN`, which `===` never matches, and not the `undefined` it would read as
	const set = new Set(values);
	const first = values.length ? values[0] : NaN;
	return {
		kind: 'one_of',
		def: values,
		// two closures chosen once here, as in `literal`
		run: set.has(undefined)
			? (v, ctx, parent, key) =>
					v === undefined
						? parent && !((key as string) in parent)
							? fail(ctx, 'missing_key', v, 'a required key')
							: v
						: v === first || set.has(v)
							? v
							: fail(ctx, 'one_of', v, (expected ??= format_literals(values)))
			: (v, ctx) =>
					v === first || set.has(v)
						? v
						: fail(ctx, 'one_of', v, (expected ??= format_literals(values)))
	};
};

//
// Wrappers
//

// `optional`, `nullable`, `with_default`, and `with_default_fn` hold their
// schema as `def.schema`

/**
 * The `def` of `optional` and `nullable`. An interface, so it has no index
 * signature and is not mistaken for the entries of an object schema.
 */
export interface SchemaWrapperDef<T extends AnySchema> {
	schema: T;
}

/**
 * Accepts `undefined`. As an object entry it makes the key optional: the
 * input may leave it out, and a key left out stays out of the output.
 */
// @__NO_SIDE_EFFECTS__
export const optional = <T extends AnySchema>(
	schema: T
): Schema<Infer<T> | undefined, InferInput<T> | undefined, 'optional', SchemaWrapperDef<T>> => ({
	kind: 'optional',
	def: { schema },
	run: (value, ctx) => (value === undefined ? undefined : schema.run(value, ctx))
});

/**
 * Accepts `null`. As an object entry it hands `schema` the object and the key
 * when `schema` takes them, so a key `schema` needs is still needed:
 * `nullable(unknown)` fails a missing key and `nullable(optional(string))`
 * accepts one.
 */
// @__NO_SIDE_EFFECTS__
export const nullable = <T extends AnySchema>(
	schema: T
): Schema<Infer<T> | null, InferInput<T> | null, 'nullable', SchemaWrapperDef<T>> => ({
	kind: 'nullable',
	def: { schema },
	// two closures chosen once here, as in `message`
	run:
		schema.run.length > 2 || schema.kind === 'lazy'
			? (value, ctx, parent, key) => (value === null ? null : schema.run(value, ctx, parent, key))
			: (value, ctx) => (value === null ? null : schema.run(value, ctx))
});

/**
 * Replaces `undefined` with `value`. As an object entry it makes the key
 * optional in the input and required in the output.
 *
 * `value` is not validated, and is returned as it is: every parse that fills
 * it in gives the same object, so an array or an object changed by one
 * consumer is changed for every other. `with_default_fn` makes a new one each
 * time.
 *
 * @param value - returned as it is, the same reference on every parse
 */
// @__NO_SIDE_EFFECTS__
export const with_default = <T extends AnySchema>(
	schema: T,
	value: Infer<T>
): Schema<Infer<T>, InferInput<T> | undefined, 'with_default', { schema: T; value: Infer<T> }> => ({
	kind: 'with_default',
	def: { schema, value },
	run: (v, ctx) => (v === undefined ? value : schema.run(v, ctx))
});

/**
 * Replaces `undefined` with what `make` returns, called with no arguments once
 * for each value it fills in. As an object entry it makes the key optional in
 * the input and required in the output, as `with_default` does.
 *
 * What `make` returns is not validated, as with `with_default`, and as in Zod.
 * It is for a default that must be new on every parse, as a mutable array or
 * object must, or that is computed when it is filled in:
 * `with_default_fn(s.array(s.string), () => [])`.
 *
 * As an object entry whose key is missing, a `make` that returns `undefined`
 * leaves the key out, as `with_default` with a value of `undefined` does.
 *
 * @param make - called for each `undefined`, with no arguments, and never called otherwise
 */
// @__NO_SIDE_EFFECTS__
export const with_default_fn = <T extends AnySchema>(
	schema: T,
	make: () => Infer<T>
): Schema<
	Infer<T>,
	InferInput<T> | undefined,
	'with_default_fn',
	{ schema: T; make: () => Infer<T> }
> => ({
	kind: 'with_default_fn',
	def: { schema, make },
	run: (v, ctx) => (v === undefined ? make() : schema.run(v, ctx))
});

/**
 * Defers to the schema returned by `get`, for recursive schemas.
 * `get` is called once, on first use, and again when it threw.
 *
 * It calls the schema with the arguments it is called with, so as an object
 * entry it hands the schema the object and the key, and a key the schema
 * needs is still needed: `lazy(() => unknown)` fails a missing key and
 * `lazy(() => optional(string))` accepts one.
 */
// @__NO_SIDE_EFFECTS__
export const lazy = <T extends AnySchema>(
	get: () => T
): Schema<Infer<T>, InferInput<T>, 'lazy', () => T> => {
	let schema: T | undefined;
	return {
		kind: 'lazy',
		def: get,
		// a method for its `arguments`: the schema isn't known until the first
		// call, so this passes on what it is given. It declares two parameters,
		// as a third and fourth cost a caller that gives two
		run(value, ctx) {
			schema ??= get();
			return arguments.length > 2
				? // eslint-disable-next-line prefer-rest-params
					schema.run(value, ctx, arguments[2], arguments[3])
				: schema.run(value, ctx);
		}
	};
};

// sets `message` on the issues from `count` on that a schema reported itself
const label_issues = (
	issues: Array<SchemaIssue>,
	count: number,
	message: string | ((issue: SchemaIssue, value: unknown) => string),
	value: unknown
): void => {
	for (let i = count; i < issues.length; i++) {
		const issue = issues[i]!;
		// a child's issues already have their path prefixed
		if (!issue.path.length) {
			issue.message ??= typeof message === 'string' ? message : message(issue, value);
		}
	}
};

/**
 * Sets custom text on the issues `schema` itself reports, leaving those of
 * its children alone. Works on actions too, and the innermost `message` wins.
 * The result is otherwise indistinguishable from `schema`: as an object entry
 * it hands `schema` the object and the key when `schema` takes them, so a
 * key `schema` needs is still needed under a `message`.
 *
 * A function is called with the issue and with the value `schema` was given
 * to validate. Around an action that is the action's input, so the output of
 * the pipe's steps before it. Around a whole `pipe` it is the pipe's input,
 * whichever step failed. The issue doesn't hold the value, so text built from
 * it puts input into an issue that otherwise has none.
 *
 * @param message - the text, or a function that builds it from the issue and the value
 */
// @__NO_SIDE_EFFECTS__
export const message = <T extends AnySchema>(
	schema: T,
	message: string | ((issue: SchemaIssue, value: unknown) => string)
): T =>
	({
		kind: schema.kind,
		def: schema.def,
		// two closures that differ only in what they pass on, chosen once here:
		// handing the object and the key to a `run` that doesn't take them
		// measured slower on valid input, and so did choosing on every call
		// and sharing the body below as one call. A `lazy` declares two
		// parameters and passes on what it is given, so it is named. The test
		// is written out here and in `nullable`, `union`, and `pipe`: one
		// function for all of them measured larger in the bundle of each alone.
		// What this holds is the entry wherever this is, so `entry` is passed
		// on too
		run:
			schema.run.length > 2 || schema.kind === 'lazy'
				? (value, ctx, parent, key, entry) => {
						const count = ctx.fails;
						const output = schema.run(value, ctx, parent, key, entry);
						if (ctx.issues && !ctx.probe) label_issues(ctx.issues, count, message, value);
						return output;
					}
				: (value, ctx) => {
						const count = ctx.fails;
						const output = schema.run(value, ctx);
						if (ctx.issues && !ctx.probe) label_issues(ctx.issues, count, message, value);
						return output;
					}
	}) as AnySchema as T;

//
// Nominal types
//

declare const FlavoredSymbol: unique symbol;
declare const BrandedSymbol: unique symbol;

// `Flavored` and `Branded` are an intersection of the value with a union: the
// marker, and the `null` and `undefined` of the value, which the marker alone
// would drop. With the union on the outside they resolve to the same types
// and print as what they resolve to, not by name

/** The marker `Flavored` adds: an optional property, so unmarked values still fit. */
export interface Flavor<T> {
	readonly [FlavoredSymbol]?: T;
}

/** The marker `Branded` adds: a required property, so unmarked values don't fit. */
export interface Brand<T> {
	readonly [BrandedSymbol]: T;
}

/**
 * Loose nominal typing. A plain value of the base type is assignable to the flavored type,
 * so producing one needs no cast or parse, but two different flavors of the same base type
 * are not assignable to each other. Good for values like ids and units,
 * where mixing them up is the bug to prevent.
 *
 * ```ts
 * type Email = Flavored<string, 'Email'>;
 * type Address = Flavored<string, 'Address'>;
 * const email: Email = 'a@b.c'; // ok
 * const address: Address = email; // error!
 * ```
 *
 * `null` and `undefined` pass through unmarked: `Flavored<string | null, 'Email'>`
 * is the flavored string or `null`.
 *
 * Of a type parameter whose constraint rules out `null` and `undefined`, as
 * `T extends string` and `T extends {}` do, two flavors assign to each other.
 * Generic code that keeps them apart flavors the constraint and intersects it
 * with the parameter, which a plain `T` still assigns to:
 *
 * ```ts
 * // compiles: the two flavors of `T` mix
 * const f = <T extends string>(x: Flavored<T, 'UserId'>): Flavored<T, 'PostId'> => x;
 * // error!
 * const g = <T extends string>(
 * 	x: T & Flavored<string, 'UserId'>
 * ): T & Flavored<string, 'PostId'> => x;
 * ```
 */
export type Flavored<TValue, TName> = TValue & (Flavor<TName> | Extract<TValue, null | undefined>);

/**
 * Strict nominal typing. A plain value of the base type is not assignable to the branded type,
 * so the only way to get one is through a schema or a cast.
 * Good for values that must have been validated.
 *
 * ```ts
 * type Uuid = Branded<string, 'Uuid'>;
 * const a: Uuid = 'abc'; // error!
 * const b: Uuid = 'abc' as Uuid; // ok
 * ```
 *
 * `null` and `undefined` pass through unmarked: `Branded<string | null, 'Uuid'>`
 * is the branded string or `null`, and a plain `null` is assignable to it.
 */
export type Branded<TValue, TName> = TValue & (Brand<TName> | Extract<TValue, null | undefined>);

/**
 * Flavors the output type of `schema` with `name`, see `Flavored`.
 * The input type is unchanged. The schema is returned as-is, so this adds nothing
 * to a parse and is invisible to introspection: `kind` and `def` are the wrapped schema's.
 *
 * @param schema - the schema to flavor
 * @param name - the flavor's name, which exists only in the types and is not stored
 */
// @__NO_SIDE_EFFECTS__
export const flavor: <T extends AnySchema, const TName extends string>(
	schema: T,
	name: TName
) => Schema<Flavored<Infer<T>, TName>, InferInput<T>, T['kind'], T['def']> = (schema: AnySchema) =>
	schema;

/**
 * Brands the output type of `schema` with `name`, see `Branded`.
 * The input type is unchanged. The schema is returned as-is, so this adds nothing
 * to a parse and is invisible to introspection: `kind` and `def` are the wrapped schema's.
 *
 * @param schema - the schema to brand
 * @param name - the brand's name, which exists only in the types and is not stored
 */
// @__NO_SIDE_EFFECTS__
export const brand: <T extends AnySchema, const TName extends string>(
	schema: T,
	name: TName
) => Schema<Branded<Infer<T>, TName>, InferInput<T>, T['kind'], T['def']> = (schema: AnySchema) =>
	schema;

//
// Containers
//

/**
 * Matches an object with `entries`, failing on unknown keys.
 * The output is the input itself when no entry changed.
 *
 * A key the input lacks reads as `undefined`, so it fails unless its entry
 * accepts that. `unknown`, `literal(undefined)`, and a `one_of` with
 * `undefined` among its values accept `undefined` and still need their key,
 * failing as a `missing_key` without it. This holds for the entries of the
 * other object schemas too.
 */
// @__NO_SIDE_EFFECTS__
export const object = <T extends SchemaEntries>(
	entries: T
): Schema<SchemaObjectOutput<T>, SchemaObjectInput<T>, 'object', T> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'object',
		def: entries,
		run: (value, ctx): any => {
			if (not_object(value)) return fail(ctx, 'object', value);
			const output = run_entries(keys, schemas, value, ctx);
			// a failed probe has nothing more to find
			if (output) {
				let i = 0;
				for (const key in value) {
					// a key in the schema's order is known without a lookup
					if (key === keys[i]) i++;
					else if (!Object.hasOwn(entries, key)) {
						fail_at(ctx, 'unknown_key', value, 'no unknown keys', key);
						if (ctx.probe) break;
					}
				}
			}
			return output;
		}
	};
};

/**
 * Matches an object with `entries`, keeping unknown keys as they are.
 * The cheapest of the object schemas on input that comes back as it is:
 * unknown keys are never looked at, and the output is the input itself when no
 * entry changed.
 *
 * When an entry changed the output is a copy: the schema's keys as `object`
 * copies them, then the input's other own enumerable string keys in the
 * input's order. Of the keys the schema doesn't name, a symbol key, an
 * inherited key, a non-enumerable key, and a `__proto__` key are left out of it.
 */
// @__NO_SIDE_EFFECTS__
export const loose_object = <T extends SchemaEntries>(
	entries: T
): Schema<
	SchemaObjectOutput<T> & Record<string, unknown>,
	SchemaObjectInput<T> & Record<string, unknown>,
	'loose_object',
	T
> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'loose_object',
		def: entries,
		// its own loop, so keeping unknown keys costs the other object schemas nothing
		run: (value, ctx): any => {
			if (not_object(value)) return fail(ctx, 'loose_object', value, 'object');
			let output: Record<string, unknown> | undefined;
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]!;
				const input = value[key];
				const count = ctx.fails;
				// the object, the key, and `1` too, as in `run_entries`
				const v = schemas[i]!.run(input, ctx, value, key, 1);
				if (ctx.fails > count) {
					if (ctx.probe) return undefined;
					prefix_path(ctx.issues!, count, key);
				} else if (output) {
					// a key the input doesn't have stays out of the output
					if (v !== undefined || key in value) output[key] = v;
				} else if (!Object.is(v, input)) {
					output = {};
					// this schema's keys first, in its order, as `run_entries` copies them
					for (let j = 0; j < i; j++) {
						const k = keys[j]!;
						const u = value[k];
						if (u !== undefined || k in value) output[k] = u;
					}
					output[key] = v;
				}
			}
			// only a copy looks at the unknown keys, which follow the schema's
			if (output) {
				let i = 0;
				for (const key in value) {
					// a key in the schema's order is known without a lookup
					if (key === keys[i]) i++;
					else if (
						Object.hasOwn(value, key) &&
						!Object.hasOwn(entries, key) &&
						// assigning a `__proto__` key would set the prototype, so it's dropped
						key !== '__proto__'
					) {
						output[key] = value[key];
					}
				}
			}
			return output ?? value;
		}
	};
};

/**
 * Matches an object with `entries`, and every other own enumerable string key
 * of it with `rest`: `object_with_rest({_: array(string)}, number)`
 * matches `{_: [], a: 1}` and refuses `{_: [], a: 'x'}`, at the key `a`.
 *
 * - The entries run first, then `rest` on each other key in the input's order,
 *   and the issues are reported in that order: an entry that fails doesn't stop
 *   the keys after it from being validated.
 * - A key the input inherits is neither validated nor copied, as Valibot has
 *   it, and is still read through an input that comes back. An own key named
 *   `constructor` or `prototype` is validated as any other, as Zod has it. An
 *   array is refused.
 * - An own `__proto__` key is left out of the output and not validated, as
 *   both do: assigning it would set the prototype.
 * - The output is the input itself when nothing changed and there is no
 *   `__proto__` key. A copy has the schema's keys first, as `object` copies
 *   them, then the other own keys in the input's order.
 *
 * `variant` can't take it as an option: its types refuse one, as its `def` is
 * not the entries. One forced through by a cast has its discriminator looked
 * up in that `def`, so `variant` throws when it is made, or is made and takes
 * the discriminator's values from that `def`, not from the entries.
 *
 * @param rest - the schema of the value of every own key that isn't an entry
 */
// @__NO_SIDE_EFFECTS__
export const object_with_rest = <T extends SchemaEntries, R extends AnySchema>(
	entries: T,
	rest: R
): Schema<
	SchemaObjectOutput<T> & Record<string, Infer<R>>,
	SchemaObjectInput<T> & Record<string, InferInput<R>>,
	'object_with_rest',
	{ entries: T; rest: R }
> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'object_with_rest',
		def: { entries, rest },
		// its own loop over the other keys, so validating them costs the other
		// object schemas nothing
		run: (value, ctx): any => {
			if (not_object(value)) return fail(ctx, 'object_with_rest', value, 'object');
			// a failed entry outside probe mode still gives an output, so the
			// other keys are validated after it
			let output = run_entries(keys, schemas, value, ctx);
			if (!output) return;
			let i = 0;
			for (const key in value) {
				// a key in the schema's order is known without a lookup
				if (key === keys[i]) i++;
				else if (Object.hasOwn(value, key) && !Object.hasOwn(entries, key)) {
					const input = value[key];
					// assigning a `__proto__` key would set the prototype, so it's dropped unread
					const keep = key !== '__proto__';
					const count = ctx.fails;
					const v = keep ? rest.run(input, ctx) : input;
					if (ctx.fails > count) {
						if (ctx.probe) return;
						prefix_path(ctx.issues!, count, key);
					} else if (output !== value) {
						if (keep) output[key] = v;
					} else if (!keep || !Object.is(v, input)) {
						// the schema's keys, as `run_entries` copies them, then the other
						// own keys before this one, none of them `__proto__`, which
						// would have begun the copy
						output = {};
						for (let j = 0; j < keys.length; j++) {
							const k = keys[j]!;
							const u = value[k];
							if (u !== undefined || k in value) output[k] = u;
						}
						for (const k in value) {
							if (k === key) break;
							if (Object.hasOwn(value, k) && !Object.hasOwn(entries, k)) output[k] = value[k];
						}
						if (keep) output[key] = v;
					}
				}
			}
			return output;
		}
	};
};

/**
 * Matches an object with `entries`, dropping unknown keys from the output.
 * Dropping means copying, so where no entry changed this costs more than
 * `object` or `loose_object` whenever there is a key to drop. The output is
 * the input itself when no entry changed and there was nothing to drop.
 */
// @__NO_SIDE_EFFECTS__
export const strip_object = <T extends SchemaEntries>(
	entries: T
): Schema<SchemaObjectOutput<T>, SchemaObjectInput<T>, 'strip_object', T> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'strip_object',
		def: entries,
		run: (value, ctx): any => {
			if (not_object(value)) return fail(ctx, 'strip_object', value, 'object');
			const count = ctx.fails;
			const output = run_entries(keys, schemas, value, ctx);
			// a copy has only this schema's keys already, and a failure's output is unused
			if (output !== value || ctx.fails > count) return output;
			let i = 0;
			for (const key in value) {
				// a key in the schema's order is known without a lookup
				if (key === keys[i]) i++;
				else if (!Object.hasOwn(entries, key)) {
					const copy: Record<string, unknown> = {};
					for (let j = 0; j < keys.length; j++) {
						const k = keys[j]!;
						const u = value[k];
						if (u !== undefined || k in value) copy[k] = u;
					}
					return copy;
				}
			}
			return value;
		}
	};
};

/**
 * Matches an object with string keys whose values all match `schema`.
 * The output is the input itself when no value changed.
 */
// @__NO_SIDE_EFFECTS__
export const record = <T extends AnySchema>(
	schema: T
): Schema<Record<string, Infer<T>>, Record<string, InferInput<T>>, 'record', T> => ({
	kind: 'record',
	def: schema,
	run: (value, ctx): any => {
		if (not_object(value)) return fail(ctx, 'record', value, 'object');
		let output: Record<string, unknown> | undefined;
		for (const key in value) {
			if (!Object.hasOwn(value, key)) continue;
			const input = value[key];
			const count = ctx.fails;
			const v = schema.run(input, ctx);
			// assigning a `__proto__` key would set the prototype, so it's dropped
			const keep = key !== '__proto__';
			if (ctx.fails > count) {
				if (ctx.probe) break;
				prefix_path(ctx.issues!, count, key);
			} else if (output) {
				if (keep) output[key] = v;
			} else if (!Object.is(v, input) || !keep) {
				output = {};
				for (const k in value) {
					if (k === key) break;
					if (Object.hasOwn(value, k)) output[k] = value[k];
				}
				if (keep) output[key] = v;
			}
		}
		return output ?? value;
	}
});

/**
 * Matches an array whose items all match `schema`.
 * The output is the input itself when no item changed.
 */
// @__NO_SIDE_EFFECTS__
export const array = <T extends AnySchema>(
	schema: T
): Schema<Array<Infer<T>>, Array<InferInput<T>>, 'array', T> => ({
	kind: 'array',
	def: schema,
	run: (value, ctx): any => {
		if (!Array.isArray(value)) return fail(ctx, 'array', value);
		let output: Array<unknown> | undefined;
		// the length is read once, so every item of a copy is one that was run
		const { length } = value;
		for (let i = 0; i < length; i++) {
			const input = value[i];
			const count = ctx.fails;
			const v = schema.run(input, ctx);
			if (ctx.fails > count) {
				if (ctx.probe) break;
				prefix_path(ctx.issues!, count, i);
			} else if (output) output[i] = v;
			else if (!Object.is(v, input)) {
				// one allocation of the whole length, where a prefix would be regrown,
				// with both bounds given: the no-argument form measured slower on the
				// valid path
				output = value.slice(0, length);
				output[i] = v;
			}
		}
		return output ?? value;
	}
});

// what an option adds to a union's `expected`: a union its options', at any
// depth, a `pipe` what its first schema adds, and any other schema its kind.
// A `lazy` is its kind, so a recursive union is never followed back to itself
const describe_option = ({ kind, def }: AnySchema): Array<string> =>
	kind === 'union'
		? (def as Array<AnySchema>).flatMap(describe_option)
		: kind === 'pipe'
			? describe_option((def as Array<AnySchema>)[0]!)
			: [kind];

// a union's `expected`, each part once, where it first appears
const describe_options = (options: ReadonlyArray<AnySchema>): string =>
	Array.from(new Set(options.flatMap(describe_option))).join(' | ');

/**
 * Matches the first of `options` that accepts the value.
 * On failure reports one issue, not the options' own. It expects the kinds of
 * the options, each once: a union among them by its own options, at any
 * depth, and a `pipe` by its first schema, so
 * `union([number, union([string, pipe(string, min_length(1)), array(string)])])`
 * expects `number | string | array`.
 *
 * As an object entry it hands every option the object and the key when any of
 * them takes them. So a missing key matches only where an option lets its key
 * be missing, as an `optional` does and an `unknown` doesn't, and with none it
 * fails as any other value does, with the union's issue. The first option
 * that matches is the union's, and a missing key it leaves `undefined` stays
 * out: `union([unknown, optional(string)])` accepts a missing key with the
 * `optional`. When the option that matches fills a value in, as a
 * `with_default` or a `with_default_fn` does, the key is optional and the
 * `undefined` it reads as is for the options before to match: each of them
 * that takes the object and the key is run again without them, and the first
 * that matches is the union's. So
 * `union([pipe(unknown, ...), with_default(...)])` runs the pipe's steps on
 * `undefined` in place of filling the default in, and
 * `union([unknown, with_default(...)])` leaves the key out. The `make` of a
 * `with_default_fn` there is called, and what it returns dropped. An option
 * run again runs twice in the parse, and a `transform` in it that the first
 * run reached runs twice too, once more for each enclosing union that tries
 * it again.
 */
// @__NO_SIDE_EFFECTS__
export const union = <const T extends ReadonlyArray<AnySchema>>(
	options: T
): Schema<Infer<T[number]>, InferInput<T[number]>, 'union', T> => {
	// built on first failure and kept, as in `literal`: a union that misses
	// inside another that matches describes itself once
	let expected: string | undefined;
	return {
		kind: 'union',
		def: options,
		// two closures chosen once here, as in `message`. Options are only
		// probed, so a failed one costs no allocation
		run: options.some((o) => o.run.length > 2 || o.kind === 'lazy')
			? (value, ctx, parent, key) => {
					const { probe } = ctx;
					const count = ctx.fails;
					ctx.probe = true;
					for (let i = 0; i < options.length; i++) {
						const output = options[i]!.run(value, ctx, parent, key);
						if (ctx.fails === count) {
							// an option that fills a missing key in makes it optional, and the
							// key is then the `undefined` it reads as to every option. Of the
							// options before this one, only one that takes the object and the
							// key can have failed for the key, so each such is tried again
							// without them, and the first that matches is the union's. A key
							// that isn't in the object is missing, and its value `undefined`
							if (output !== undefined && parent && !((key as string) in parent)) {
								for (let j = 0; j < i; j++) {
									if (options[j]!.run.length > 2 || options[j]!.kind === 'lazy') {
										const v = options[j]!.run(value, ctx);
										if (ctx.fails === count) {
											ctx.probe = probe;
											return v;
										}
									}
									ctx.fails = count;
								}
							}
							ctx.probe = probe;
							return output;
						}
						ctx.fails = count;
					}
					ctx.probe = probe;
					return fail(ctx, 'union', value, (expected ??= describe_options(options)));
				}
			: (value, ctx) => {
					const { probe } = ctx;
					const count = ctx.fails;
					ctx.probe = true;
					for (let i = 0; i < options.length; i++) {
						const output = options[i]!.run(value, ctx);
						if (ctx.fails === count) {
							ctx.probe = probe;
							return output;
						}
						ctx.fails = count;
					}
					ctx.probe = probe;
					return fail(ctx, 'union', value, (expected ??= describe_options(options)));
				}
	};
};

/**
 * Matches the object schema in `options` whose `key` literal equals the value's,
 * a discriminated union with constant-time dispatch.
 *
 * An input without the key reads as `undefined` there, so it selects an option
 * whose literal is `undefined`, and that option's entry then fails it as a
 * `missing_key`.
 *
 * @param key - the discriminator, which must be a `literal` entry in every option
 */
// @__NO_SIDE_EFFECTS__
export const variant = <
	TKey extends string,
	const T extends ReadonlyArray<Schema<any, any, string, SchemaEntries>>
>(
	key: TKey,
	options: T
): Schema<Infer<T[number]>, InferInput<T[number]>, 'variant', { key: TKey; options: T }> => {
	const by_value: Map<unknown, AnySchema> = new Map();
	for (const option of options) by_value.set(option.def[key]!.def, option);
	let expected: string | undefined;
	return {
		kind: 'variant',
		def: { key, options },
		run: (value, ctx) => {
			if (not_object(value)) return fail(ctx, 'variant', value, 'object');
			const option = by_value.get(value[key]);
			if (option) return option.run(value, ctx);
			fail_at(ctx, 'variant', value, (expected ??= format_literals(by_value.keys())), key);
			return value;
		}
	};
};

//
// Pipe
//

export type PipeSchema<TOutput, T extends AnySchema> = Schema<
	TOutput,
	InferInput<T>,
	'pipe',
	ReadonlyArray<SchemaNode>
>;

export interface SchemaPipeFactory {
	<T extends AnySchema, O1>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>
	): PipeSchema<Uninferred<O1>, T>;
	<T extends AnySchema, O1, O2>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>
	): PipeSchema<Uninferred<O2>, T>;
	<T extends AnySchema, O1, O2, O3>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>,
		a3: SchemaAction<O2, O3>
	): PipeSchema<Uninferred<O3>, T>;
	<T extends AnySchema, O1, O2, O3, O4>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>,
		a3: SchemaAction<O2, O3>,
		a4: SchemaAction<O3, O4>
	): PipeSchema<Uninferred<O4>, T>;
}

/**
 * Runs `schema` then each action on its output, stopping at the first failure.
 *
 * As an object entry it hands `schema` the object and the key when `schema`
 * takes them, so `pipe(unknown, ...)` fails a missing key and runs no action.
 * The actions are handed neither.
 *
 * As an object entry whose key is missing, a pipe that starts with an
 * `optional` runs no action, and the key stays out of the output:
 * `object({a: pipe(optional(string), check(...))})` accepts `{}` whatever the
 * check says, and a `transform` there writes no key. `with_default` and
 * `with_default_fn` are what fill a missing key in. With the key there every
 * action runs, on `undefined` too.
 *
 * That is of an `optional` itself, and of a pipe that starts with such a
 * pipe, as the entry itself or under a `message`. Under a `nullable`, a
 * `lazy`, or a `union` its actions run on the `undefined` a missing key reads
 * as, and so do a pipe's after a `nullable`, a `lazy`, or a `union` that
 * reaches an `optional`.
 */
// @__NO_SIDE_EFFECTS__
export const pipe: SchemaPipeFactory = (
	...schemas: Array<AnySchema>
): PipeSchema<any, AnySchema> => {
	// what a value reaches first, through every pipe this one starts with.
	// The kind is read, as `message`, `flavor`, `brand`, and `meta` keep it
	let first = schemas[0]!;
	while (first.kind === 'pipe') first = first.def[0];
	// the steps in order, handed no object or key. The first is called apart
	// from the rest, as the closure that passes them on calls it: one loop from
	// the first measured slower in a program of one pipe, whether or not it
	// starts with an `optional`
	const run = (value: any, ctx: SchemaContext): any => {
		const count = ctx.fails;
		let output = schemas[0]!.run(value, ctx);
		for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};
	return {
		kind: 'pipe',
		// the overloads take any schema, and `def` is typed as the contract has it
		def: schemas as Array<SchemaNode>,
		// three closures chosen once here, as in `message`. The first is of a
		// pipe that starts with an `optional`: as the entry itself, a key that
		// isn't in the object is missing, and its value `undefined`, so it stays
		// out and nothing runs. A key not `in` the object reads as `undefined`
		// for every object but a Proxy that answers otherwise, whose value then
		// passes unchecked. It shares the steps with the third, which a pipe it
		// starts with is called with
		run:
			first.kind === 'optional'
				? (value, ctx, parent, key, entry) =>
						entry && !((key as string) in parent!) ? value : run(value, ctx)
				: schemas[0]!.run.length > 2 || schemas[0]!.kind === 'lazy'
					? (value, ctx, parent, key) => {
							const count = ctx.fails;
							let output = schemas[0]!.run(value, ctx, parent, key);
							for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
								output = schemas[i]!.run(output, ctx);
							}
							return output;
						}
					: run
	};
};

//
// Actions
//

// Resolves to `T`, in a form nothing is inferred through. An action's `T` is the
// type it is given, which comes from its input in a `pipe` and never from what
// the schema around that `pipe` expects, which is any schema and would make it
// `any`. For the same reason the bound of a value action is typed by whether
// it is a number or a bigint and its `def` apart from `T`: either of them
// typed `T` would have the bound's literal type inferred as the value's. A
// `pipe` writes its output in it too: inferred from what the schema around it
// expects, the output would be `any`, and so would the value an unannotated
// `check` or `transform` at its end is given. The `extends T` bound keeps the
// result assignable to `T` while `T` is still generic, and the tuple keeps it
// from distributing over a generic `T`, which would have the `check` at the
// end of a pipe of a generic schema typed from the pipe's declared type and
// not as the schema's output. So a function that pipes its own generic action
// or schema can return the pipe as its declared type, and inference is blocked
// all the same.
type Uninferred<T> = [T] extends [infer U extends T] ? U : never;

// @__NO_SIDE_EFFECTS__
export const min_length = <T extends { length: number }>(
	min: number
): Schema<Uninferred<T>, T, 'min_length', number> => {
	let expected: string | undefined;
	return {
		kind: 'min_length',
		def: min,
		run: (value, ctx) =>
			value.length >= min
				? value
				: fail(ctx, 'min_length', value, (expected ??= `length >= ${min}`))
	};
};

// @__NO_SIDE_EFFECTS__
export const max_length = <T extends { length: number }>(
	max: number
): Schema<Uninferred<T>, T, 'max_length', number> => {
	let expected: string | undefined;
	return {
		kind: 'max_length',
		def: max,
		run: (value, ctx) =>
			value.length <= max
				? value
				: fail(ctx, 'max_length', value, (expected ??= `length <= ${max}`))
	};
};

// @__NO_SIDE_EFFECTS__
export const min_value = <T extends number | bigint>(
	min: T extends bigint ? bigint : number
): Schema<Uninferred<T>, T, 'min_value', number | bigint> => {
	let expected: string | undefined;
	return {
		kind: 'min_value',
		def: min,
		run: (value, ctx) =>
			value >= min ? value : fail(ctx, 'min_value', value, (expected ??= `>= ${min}`))
	};
};

// @__NO_SIDE_EFFECTS__
export const max_value = <T extends number | bigint>(
	max: T extends bigint ? bigint : number
): Schema<Uninferred<T>, T, 'max_value', number | bigint> => {
	let expected: string | undefined;
	return {
		kind: 'max_value',
		def: max,
		run: (value, ctx) =>
			value <= max ? value : fail(ctx, 'max_value', value, (expected ??= `<= ${max}`))
	};
};

/**
 * Fails a number that isn't an integer: one with a fraction, and alone `NaN`
 * and the infinities too. An integer past the safe range passes, as it is an
 * integer: `safe_integer` is the stricter test.
 */
export const integer: Schema<number, number, 'integer', undefined> = {
	kind: 'integer',
	def: undefined,
	run: (value, ctx) => (Number.isInteger(value) ? value : fail(ctx, 'integer', value))
};

/**
 * Fails a number that isn't a safe integer: an integer from
 * `Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`, the range in which
 * every integer is a double of its own.
 */
export const safe_integer: Schema<number, number, 'safe_integer', undefined> = {
	kind: 'safe_integer',
	def: undefined,
	run: (value, ctx) => (Number.isSafeInteger(value) ? value : fail(ctx, 'safe_integer', value))
};

/**
 * @param pattern - must not have the `g` or `y` flag, whose `lastIndex` state would leak between calls
 */
// @__NO_SIDE_EFFECTS__
export const regex = (
	pattern: RegExp,
	expected: string = String(pattern)
): Schema<string, string, 'regex', RegExp> => ({
	kind: 'regex',
	def: pattern,
	run: (value, ctx) => (pattern.test(value) ? value : fail(ctx, 'regex', value, expected))
});

/**
 * Fails when `fn` returns `false`.
 */
// @__NO_SIDE_EFFECTS__
export const check = <T>(
	fn: (value: T) => boolean,
	expected: string = 'check'
): Schema<T, T, 'check', (value: T) => boolean> => ({
	kind: 'check',
	def: fn,
	run: (value, ctx) => (fn(value) ? value : fail(ctx, 'check', value, expected))
});

/**
 * Replaces the value with the result of `fn`.
 */
// @__NO_SIDE_EFFECTS__
export const transform = <T, O>(
	fn: (value: T) => O
): Schema<O, T, 'transform', (value: T) => O> => ({
	kind: 'transform',
	def: fn,
	run: (value) => fn(value)
});
