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
 * - Issue paths are built on unwind: a container prefixes its key onto the
 *   issues its child added, so valid input never touches a path.
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
	/** The type of the value that failed: `'null'`, `'array'`, or its `typeof`. */
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
 * The object schemas call an entry's `run` with two more arguments, the object
 * being read and the entry's key, so a schema that accepts `undefined` can tell
 * a key that is missing from one that is there. Every other call gives the
 * first two only, and a `run` that takes only those works as an entry.
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
	 * with no default and not as a rest: `message` passes them on only to a
	 * `run` whose `length` says it takes them.
	 *
	 * @param value - the value to validate
	 * @param ctx - the state of the parse, where a failure is reported with `fail`
	 * @param parent - the object `value` was read from, when an object schema is running an entry
	 * @param key - the entry's key in `parent`, given with it
	 */
	readonly run: (
		value: any,
		ctx: SchemaContext,
		parent?: Record<PropertyKey, unknown>,
		key?: PropertyKey
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
 * `optional`, `nullable`, and `with_default` have an object with their schema under
 * `schema`.
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
	finite: undefined;
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
	[K in keyof T]: T[K] extends { kind: 'optional' | 'with_default' } ? K : never;
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
		(ctx.issues ??= []).push({
			kind,
			expected,
			// `get_issue_value` names a type the same way, to compare against this
			received: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
			path: [],
			message: undefined
		});
	}
	return value;
};

// prefixes `key` onto the path of every issue added since `from`,
// callers must not be in probe mode
const prefix_path = (issues: Array<SchemaIssue>, from: number, key: PropertyKey): void => {
	for (let i = from; i < issues.length; i++) issues[i]!.path.unshift(key);
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
	return (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value) ===
		issue.received
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

/** Rejects `NaN`. Allows infinities, see `finite`. */
export const number: Schema<number, number, 'number', undefined> = {
	kind: 'number',
	def: undefined,
	run: (value, ctx) =>
		typeof value === 'number' && !Number.isNaN(value) ? value : fail(ctx, 'number', value)
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
 * It tells the two apart by the object and key the object schema hands it, so
 * it does only when it is the entry itself, which it is through a `flavor`, a
 * `brand`, or a `message`. Held by anything else, such as a `nullable` or a
 * `union`, it accepts a missing key as it does `undefined` anywhere.
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
 * Matches a single value by `===`.
 */
// @__NO_SIDE_EFFECTS__
export const literal = <const T extends SchemaLiteral>(value: T): Schema<T, T, 'literal', T> => {
	// built on first failure and kept, so a miss costs no allocation after that
	let expected: string | undefined;
	return {
		kind: 'literal',
		def: value,
		run: (v, ctx) =>
			v === value ? v : fail(ctx, 'literal', v, (expected ??= format_literals([value])))
	};
};

/**
 * Matches any of `values` by `===`.
 */
// @__NO_SIDE_EFFECTS__
export const one_of = <const T extends ReadonlyArray<SchemaLiteral>>(
	values: T
): Schema<T[number], T[number], 'one_of', T> => {
	let expected: string | undefined;
	return {
		kind: 'one_of',
		def: values,
		run: (v, ctx) =>
			values.includes(v) ? v : fail(ctx, 'one_of', v, (expected ??= format_literals(values)))
	};
};

//
// Wrappers
//

// `optional`, `nullable`, and `with_default` hold their schema as `def.schema`

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
 * Accepts `null`.
 */
// @__NO_SIDE_EFFECTS__
export const nullable = <T extends AnySchema>(
	schema: T
): Schema<Infer<T> | null, InferInput<T> | null, 'nullable', SchemaWrapperDef<T>> => ({
	kind: 'nullable',
	def: { schema },
	run: (value, ctx) => (value === null ? null : schema.run(value, ctx))
});

/**
 * Replaces `undefined` with `value`. As an object entry it makes the key
 * optional in the input and required in the output.
 *
 * @param value - returned as-is, so use only immutable defaults
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
 * Defers to the schema returned by `get`, for recursive schemas.
 * `get` is called once, on first use.
 */
// @__NO_SIDE_EFFECTS__
export const lazy = <T extends AnySchema>(
	get: () => T
): Schema<Infer<T>, InferInput<T>, 'lazy', () => T> => {
	let schema: T | undefined;
	return {
		kind: 'lazy',
		def: get,
		run: (value, ctx) => (schema ??= get()).run(value, ctx)
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
 * it hands `schema` the object and the key when `schema` takes them, so an
 * `unknown` under a `message` still needs its key.
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
		// and sharing the body below as one call
		run:
			schema.run.length > 2
				? (value, ctx, parent, key) => {
						const count = ctx.fails;
						const output = schema.run(value, ctx, parent, key);
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
 */
export type Flavored<TValue, TName> = TValue & Flavor<TName>;

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
 */
export type Branded<TValue, TName> = TValue & Brand<TName>;

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

// runs every entry and returns the output, or `undefined` when a probe failed,
// the output being `value` itself until an entry's output differs from its input,
// which copies the entries before it. An entry is handed `value` and its key
// too, for a schema that accepts `undefined` and still needs its key to be there
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
		const v = schemas[i]!.run(input, ctx, value, key);
		if (ctx.fails > count) {
			if (ctx.probe) return;
			prefix_path(ctx.issues!, count, key);
		} else if (output) {
			// a key the input doesn't have stays out of the output
			if (v !== undefined || key in value) output[key] = v;
		} else if (v !== input) {
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
 * Matches an object with `entries`, failing on unknown keys.
 * The output is the input itself when no entry changed.
 *
 * A key the input lacks reads as `undefined`, so it fails unless its entry
 * accepts that. `unknown` accepts `undefined` and still needs its key, failing
 * as a `missing_key` without it. This holds for `loose_object` and
 * `strip_object` too.
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
 * A `__proto__` key is left out whether or not the schema names it: an entry
 * named `__proto__` still runs, but its key is not written to a copy, as
 * assigning it would set the copy's prototype. `object` and `strip_object` do
 * write such an entry.
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
				// the object and the key too, as in `run_entries`
				const v = schemas[i]!.run(input, ctx, value, key);
				if (ctx.fails > count) {
					if (ctx.probe) return undefined;
					prefix_path(ctx.issues!, count, key);
				} else if (output) {
					// a key the input doesn't have stays out of the output, and a schema entry
					// named `__proto__` runs but isn't written, as assigning it sets the prototype
					if ((v !== undefined || key in value) && key !== '__proto__') output[key] = v;
				} else if (v !== input) {
					output = {};
					// this schema's keys first, in its order, as `run_entries` copies them
					for (let j = 0; j < i; j++) {
						const k = keys[j]!;
						const u = value[k];
						if ((u !== undefined || k in value) && k !== '__proto__') output[k] = u;
					}
					if (key !== '__proto__') output[key] = v;
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
			} else if (v !== input || !keep) {
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
			else if (v !== input) {
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

/**
 * Matches the first of `options` that accepts the value.
 * On failure reports one issue, not the options' own.
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
		run: (value, ctx) => {
			const { probe } = ctx;
			const count = ctx.fails;
			// options are only probed, so a failed one costs no allocation
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
			return fail(ctx, 'union', value, (expected ??= options.map((o) => o.kind).join(' | ')));
		}
	};
};

/**
 * Matches the object schema in `options` whose `key` literal equals the value's,
 * a discriminated union with constant-time dispatch.
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
	<T extends AnySchema, O1>(schema: T, a1: SchemaAction<Infer<T>, O1>): PipeSchema<O1, T>;
	<T extends AnySchema, O1, O2>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>
	): PipeSchema<O2, T>;
	<T extends AnySchema, O1, O2, O3>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>,
		a3: SchemaAction<O2, O3>
	): PipeSchema<O3, T>;
	<T extends AnySchema, O1, O2, O3, O4>(
		schema: T,
		a1: SchemaAction<Infer<T>, O1>,
		a2: SchemaAction<O1, O2>,
		a3: SchemaAction<O2, O3>,
		a4: SchemaAction<O3, O4>
	): PipeSchema<O4, T>;
}

/**
 * Runs `schema` then each action on its output, stopping at the first failure.
 */
// @__NO_SIDE_EFFECTS__
export const pipe: SchemaPipeFactory = (
	...schemas: Array<AnySchema>
): PipeSchema<any, AnySchema> => ({
	kind: 'pipe',
	// the overloads take any schema, and `def` is typed as the contract has it
	def: schemas as Array<SchemaNode>,
	run: (value, ctx) => {
		const count = ctx.fails;
		let output = value;
		for (let i = 0; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	}
});

//
// Actions
//

// Resolves to `T`, in a form nothing is inferred through. An action's `T` is the
// type it is given, which comes from its input in a `pipe` and never from what
// the schema around that `pipe` expects, which is any schema and would make it
// `any`. For the same reason the bound of a value action is typed by whether
// it is a number or a bigint and its `def` apart from `T`: either of them
// typed `T` would have the bound's literal type inferred as the value's.
type Uninferred<T> = T extends infer U ? U : never;

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

export const integer: Schema<number, number, 'integer', undefined> = {
	kind: 'integer',
	def: undefined,
	run: (value, ctx) => (Number.isInteger(value) ? value : fail(ctx, 'integer', value))
};

export const safe_integer: Schema<number, number, 'safe_integer', undefined> = {
	kind: 'safe_integer',
	def: undefined,
	run: (value, ctx) => (Number.isSafeInteger(value) ? value : fail(ctx, 'safe_integer', value))
};

export const finite: Schema<number, number, 'finite', undefined> = {
	kind: 'finite',
	def: undefined,
	run: (value, ctx) => (Number.isFinite(value) ? value : fail(ctx, 'finite', value))
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
