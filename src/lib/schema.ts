/**
 * Small, fast schema validation.
 *
 * The strategy is valibot's: one tree-shakeable export per schema and action,
 * schemas as plain data, and `pipe` for refinement. The internals differ:
 *
 * - Every schema and action is the same three-field object, `kind`, `def`,
 *   and `run`. There is no separate action type, so `pipe` is a loop over
 *   schemas, and every `run` call site loads from one object shape.
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
 *
 * - A `union` tries its options, and `is` runs, in probe mode: failures are
 *   counted without building issues.
 *
 * Import as a namespace: `import * as s from '@fuzdev/fuz_schema/schema.ts'`.
 * The design is described at more length in `docs/design.md`.
 *
 * @module
 */

/**
 * A validation failure.
 */
export interface SchemaIssue {
	/** The `kind` of the schema or check that failed. */
	kind: string;
	/** Describes what was expected. */
	expected: string;
	/** The value that failed. */
	value: unknown;
	/** Keys from the root value to `value`, outermost first. */
	path: Array<PropertyKey>;
	/** Custom text set by `message`, used by `format_issue` in place of the default. */
	message: string | undefined;
}

/**
 * Mutable state threaded through a single parse.
 */
export interface SchemaContext {
	/** One per failure, except in probe mode where it stays as it was. */
	issues: Array<SchemaIssue>;
	/**
	 * How many failures have been reported. A container knows a child failed
	 * when this grew. Outside probe mode it equals `issues.length`.
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
 */
export interface Schema<
	TOutput = unknown,
	TInput = TOutput,
	TKind extends string = string,
	TDef = unknown
> {
	readonly kind: TKind;
	readonly def: TDef;
	readonly run: (value: any, ctx: SchemaContext) => TOutput;
	/** Type-only, never set at runtime. */
	readonly '~types'?: { readonly input: TInput };
}

export type AnySchema = Schema<any, any, string, any>;

/** The output type of a schema. */
export type Infer<T extends AnySchema> = ReturnType<T['run']>;

/** The input type a schema accepts. */
export type InferInput<T extends AnySchema> = NonNullable<T['~types']>['input'];

/**
 * A schema that refines or transforms an already-typed value, for use in `pipe`.
 */
export type Action<TInput, TOutput = TInput> = Schema<TOutput, TInput>;

export type SchemaEntries = Record<string, AnySchema>;

export type Flatten<T> = { [K in keyof T]: T[K] } & {};

type OptionalOutputKeys<T extends SchemaEntries> = {
	[K in keyof T]: T[K] extends { kind: 'optional' } ? K : never;
}[keyof T];

type OptionalInputKeys<T extends SchemaEntries> = {
	[K in keyof T]: T[K] extends { kind: 'optional' | 'default' } ? K : never;
}[keyof T];

export type ObjectOutput<T extends SchemaEntries> = Flatten<
	{ [K in Exclude<keyof T, OptionalOutputKeys<T>>]: Infer<T[K]> } & {
		[K in OptionalOutputKeys<T>]?: Infer<T[K]>;
	}
>;

export type ObjectInput<T extends SchemaEntries> = Flatten<
	{ [K in Exclude<keyof T, OptionalInputKeys<T>>]: InferInput<T[K]> } & {
		[K in OptionalInputKeys<T>]?: InferInput<T[K]>;
	}
>;

export type SchemaResult<T> = { ok: true; value: T } | { ok: false; issues: Array<SchemaIssue> };

export type Literal = string | number | bigint | boolean | null | undefined;

//
// Core
//

/**
 * Records an issue. Returns `value` so a `run` can fail in expression position.
 *
 * @param expected - describes what was expected, defaulting to `kind`
 * @mutates ctx - increments `ctx.fails`, and pushes to `ctx.issues` outside probe mode
 */
export const fail = (
	ctx: SchemaContext,
	kind: string,
	value: unknown,
	expected: string = kind
): any => {
	ctx.fails++;
	if (!ctx.probe) ctx.issues.push({ kind, expected, value, path: [], message: undefined });
	return value;
};

// prefixes `key` onto the path of every issue added since `from`,
// callers must not be in probe mode
const prefix_path = (issues: Array<SchemaIssue>, from: number, key: PropertyKey): void => {
	for (let i = from; i < issues.length; i++) issues[i]!.path.unshift(key);
};

// like `fail` for an issue about `key` of the current value
const fail_at = (
	ctx: SchemaContext,
	kind: string,
	value: unknown,
	expected: string,
	key: PropertyKey
): void => {
	const count = ctx.fails;
	fail(ctx, kind, value, expected);
	if (!ctx.probe) prefix_path(ctx.issues, count, key);
};

const is_object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

/**
 * Validates `value`, returning the output or every issue found.
 */
export const parse = <T extends AnySchema>(schema: T, value: unknown): SchemaResult<Infer<T>> => {
	const ctx: SchemaContext = { issues: [], fails: 0, probe: false };
	const output = schema.run(value, ctx);
	return ctx.fails ? { ok: false, issues: ctx.issues } : { ok: true, value: output };
};

/**
 * Validates `value` and returns the output.
 *
 * @throws SchemaError when `value` doesn't match
 */
export const parse_or_throw = <T extends AnySchema>(schema: T, value: unknown): Infer<T> => {
	const ctx: SchemaContext = { issues: [], fails: 0, probe: false };
	const output = schema.run(value, ctx);
	if (ctx.fails) throw new SchemaError(ctx.issues);
	return output;
};

/**
 * Checks whether `value` matches `schema`, without building issues
 * and stopping at the first failure.
 * Narrows to the input type because the output is discarded.
 */
export const is = <T extends AnySchema>(schema: T, value: unknown): value is InferInput<T> => {
	const ctx: SchemaContext = { issues: [], fails: 0, probe: true };
	schema.run(value, ctx);
	return !ctx.fails;
};

/**
 * Names the type of `value` for messages, splitting `null` and `array` out of `object`.
 */
export const to_type_name = (value: unknown): string =>
	value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

/**
 * Formats an issue as `path: expected X, received Y`.
 */
export const format_issue = (issue: SchemaIssue): string =>
	(issue.path.length ? issue.path.join('.') + ': ' : '') +
	(issue.message ?? `expected ${issue.expected}, received ${to_type_name(issue.value)}`);

/**
 * Thrown by `parse_or_throw`. The message lists every issue, one per line.
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

/** Accepts anything. */
export const unknown: Schema<unknown, unknown, 'unknown', undefined> = {
	kind: 'unknown',
	def: undefined,
	run: (value) => value
};

// describes literals for an issue's `expected`, quoting strings
const format_literals = (values: Iterable<unknown>): string =>
	Array.from(values, (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(' | ');

/**
 * Matches a single value by `===`.
 */
// @__NO_SIDE_EFFECTS__
export const literal = <const T extends Literal>(value: T): Schema<T, T, 'literal', T> => {
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
export const picklist = <const T extends ReadonlyArray<Literal>>(
	values: T
): Schema<T[number], T[number], 'picklist', T> => {
	let expected: string | undefined;
	return {
		kind: 'picklist',
		def: values,
		run: (v, ctx) =>
			values.includes(v) ? v : fail(ctx, 'picklist', v, (expected ??= format_literals(values)))
	};
};

//
// Wrappers
//

/**
 * Accepts `undefined`. As an object entry it makes the key optional.
 */
// @__NO_SIDE_EFFECTS__
export const optional = <T extends AnySchema>(
	schema: T
): Schema<Infer<T> | undefined, InferInput<T> | undefined, 'optional', T> => ({
	kind: 'optional',
	def: schema,
	run: (value, ctx) => (value === undefined ? undefined : schema.run(value, ctx))
});

/**
 * Accepts `null`.
 */
// @__NO_SIDE_EFFECTS__
export const nullable = <T extends AnySchema>(
	schema: T
): Schema<Infer<T> | null, InferInput<T> | null, 'nullable', T> => ({
	kind: 'nullable',
	def: schema,
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
): Schema<Infer<T>, InferInput<T> | undefined, 'default', { schema: T; value: Infer<T> }> => ({
	kind: 'default',
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

/**
 * Sets custom text on the issues `schema` itself reports, leaving those of
 * its children alone. Works on actions too, and the innermost `message` wins.
 * The result is otherwise indistinguishable from `schema`.
 *
 * @param message - the text, or a function that builds it from the issue
 */
// @__NO_SIDE_EFFECTS__
export const message = <T extends AnySchema>(
	schema: T,
	message: string | ((issue: SchemaIssue) => string)
): T =>
	({
		kind: schema.kind,
		def: schema.def,
		run: (value, ctx) => {
			const count = ctx.fails;
			const output = schema.run(value, ctx);
			if (!ctx.probe) {
				const { issues } = ctx;
				for (let i = count; i < issues.length; i++) {
					const issue = issues[i]!;
					// a child's issues already have their path prefixed
					if (!issue.path.length) {
						issue.message ??= typeof message === 'string' ? message : message(issue);
					}
				}
			}
			return output;
		}
	}) as AnySchema as T;

//
// Containers
//

// copies the first `end` entries of `value`, skipping keys it doesn't have
const copy_entries = (
	keys: Array<string>,
	value: Record<string, unknown>,
	end: number
): Record<string, unknown> => {
	const output: Record<string, unknown> = {};
	for (let i = 0; i < end; i++) {
		const key = keys[i]!;
		const v = value[key];
		if (v !== undefined || key in value) output[key] = v;
	}
	return output;
};

// runs every entry, returning a new object only if some entry's output
// differs from its input, and `undefined` otherwise
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
		const v = schemas[i]!.run(input, ctx);
		if (ctx.fails > count) {
			if (ctx.probe) return undefined;
			prefix_path(ctx.issues, count, key);
		} else if (output) {
			if (v !== undefined || key in value) output[key] = v;
		} else if (v !== input) {
			output = copy_entries(keys, value, i);
			output[key] = v;
		}
	}
	return output;
};

/**
 * Matches an object with `entries`, dropping unknown keys from the output.
 * The output is the input itself when no entry changed and there was nothing to drop.
 */
// @__NO_SIDE_EFFECTS__
export const object = <T extends SchemaEntries>(
	entries: T
): Schema<ObjectOutput<T>, ObjectInput<T>, 'object', T> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'object',
		def: entries,
		run: (value, ctx): any => {
			if (!is_object(value)) return fail(ctx, 'object', value);
			const count = ctx.fails;
			const output = run_entries(keys, schemas, value, ctx);
			if (output || ctx.fails > count) return output;
			for (const key in value) {
				if (!Object.hasOwn(entries, key)) return copy_entries(keys, value, keys.length);
			}
			return value;
		}
	};
};

/**
 * Matches an object with `entries`, failing on unknown keys.
 * The output is the input itself when no entry changed.
 */
// @__NO_SIDE_EFFECTS__
export const strict_object = <T extends SchemaEntries>(
	entries: T
): Schema<ObjectOutput<T>, ObjectInput<T>, 'strict_object', T> => {
	const keys = Object.keys(entries);
	const schemas = Object.values(entries);
	return {
		kind: 'strict_object',
		def: entries,
		run: (value, ctx): any => {
			if (!is_object(value)) return fail(ctx, 'strict_object', value, 'object');
			const count = ctx.fails;
			const output = run_entries(keys, schemas, value, ctx);
			if (ctx.probe && ctx.fails > count) return undefined;
			for (const key in value) {
				if (!Object.hasOwn(entries, key)) {
					fail_at(ctx, 'unknown_key', value[key], 'no unknown keys', key);
					if (ctx.probe) break;
				}
			}
			return output ?? value;
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
		if (!is_object(value)) return fail(ctx, 'record', value, 'object');
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
				prefix_path(ctx.issues, count, key);
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
		for (let i = 0; i < value.length; i++) {
			const input = value[i];
			const count = ctx.fails;
			const v = schema.run(input, ctx);
			if (ctx.fails > count) {
				if (ctx.probe) break;
				prefix_path(ctx.issues, count, i);
			} else if (output) output[i] = v;
			else if (v !== input) {
				output = value.slice(0, i);
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
): Schema<Infer<T[number]>, InferInput<T[number]>, 'union', T> => ({
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
		return fail(ctx, 'union', value, options.map((o) => o.kind).join(' | '));
	}
});

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
			if (!is_object(value)) return fail(ctx, 'variant', value, 'object');
			const option = by_value.get(value[key]);
			if (option) return option.run(value, ctx);
			fail_at(ctx, 'variant', value[key], (expected ??= format_literals(by_value.keys())), key);
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
	ReadonlyArray<AnySchema>
>;

export interface Pipe {
	<T extends AnySchema, O1>(schema: T, a1: Action<Infer<T>, O1>): PipeSchema<O1, T>;
	<T extends AnySchema, O1, O2>(
		schema: T,
		a1: Action<Infer<T>, O1>,
		a2: Action<O1, O2>
	): PipeSchema<O2, T>;
	<T extends AnySchema, O1, O2, O3>(
		schema: T,
		a1: Action<Infer<T>, O1>,
		a2: Action<O1, O2>,
		a3: Action<O2, O3>
	): PipeSchema<O3, T>;
	<T extends AnySchema, O1, O2, O3, O4>(
		schema: T,
		a1: Action<Infer<T>, O1>,
		a2: Action<O1, O2>,
		a3: Action<O2, O3>,
		a4: Action<O3, O4>
	): PipeSchema<O4, T>;
}

/**
 * Runs `schema` then each action on its output, stopping at the first failure.
 */
// @__NO_SIDE_EFFECTS__
export const pipe: Pipe = (...schemas: Array<AnySchema>): PipeSchema<any, AnySchema> => ({
	kind: 'pipe',
	def: schemas,
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

// @__NO_SIDE_EFFECTS__
export const min_length = <T extends { length: number }>(
	min: number
): Schema<T, T, 'min_length', number> => ({
	kind: 'min_length',
	def: min,
	run: (value, ctx) =>
		value.length >= min ? value : fail(ctx, 'min_length', value, `length >= ${min}`)
});

// @__NO_SIDE_EFFECTS__
export const max_length = <T extends { length: number }>(
	max: number
): Schema<T, T, 'max_length', number> => ({
	kind: 'max_length',
	def: max,
	run: (value, ctx) =>
		value.length <= max ? value : fail(ctx, 'max_length', value, `length <= ${max}`)
});

// @__NO_SIDE_EFFECTS__
export const min_value = <T extends number | bigint>(min: T): Schema<T, T, 'min_value', T> => ({
	kind: 'min_value',
	def: min,
	run: (value, ctx) => (value >= min ? value : fail(ctx, 'min_value', value, `>= ${min}`))
});

// @__NO_SIDE_EFFECTS__
export const max_value = <T extends number | bigint>(max: T): Schema<T, T, 'max_value', T> => ({
	kind: 'max_value',
	def: max,
	run: (value, ctx) => (value <= max ? value : fail(ctx, 'max_value', value, `<= ${max}`))
});

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
