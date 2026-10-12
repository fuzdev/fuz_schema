/**
 * Standard Schema support, kept out of `schema.ts` so schemas don't carry a
 * `~standard` property they'd pay for in bytes and in a second object shape.
 * Wrap a schema with `to_standard_schema` where a library asks for one.
 *
 * @see https://standardschema.dev/
 *
 * @module
 */

import { parse, type AnySchema, type Infer, type InferInput } from './schema.ts';

/**
 * The Standard Schema types for a schema library without JSON Schema output,
 * copied from version 1.1 of the spec as it recommends so there's no
 * dependency on `@standard-schema/spec`. The spec nests its types in
 * namespaces. Here each is flat, named by its path.
 *
 * Left out: the spec's JSON Schema interface, which nothing here produces,
 * and its inference helpers, which a consumer takes from the spec itself and
 * which work on these types as they are.
 */
export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
	readonly '~standard': StandardSchemaV1Props<TInput, TOutput>;
}

/**
 * The base the spec's other interfaces extend: a vendor, a version, and types.
 */
export interface StandardTypedV1<TInput = unknown, TOutput = TInput> {
	readonly '~standard': StandardTypedV1Props<TInput, TOutput>;
}

export interface StandardTypedV1Props<TInput = unknown, TOutput = TInput> {
	readonly version: 1;
	readonly vendor: string;
	/** Type-only: `to_standard_schema` never sets it. */
	readonly types?: StandardTypedV1Types<TInput, TOutput> | undefined;
}

export interface StandardTypedV1Types<TInput = unknown, TOutput = TInput> {
	readonly input: TInput;
	readonly output: TOutput;
}

export interface StandardSchemaV1Props<
	TInput = unknown,
	TOutput = TInput
> extends StandardTypedV1Props<TInput, TOutput> {
	readonly validate: (
		value: unknown,
		options?: StandardSchemaV1Options
	) => StandardSchemaV1Result<TOutput> | Promise<StandardSchemaV1Result<TOutput>>;
}

export interface StandardSchemaV1Options {
	/** Vendor-specific parameters. `to_standard_schema` reads none. */
	readonly libraryOptions?: Record<string, unknown> | undefined;
}

export type StandardSchemaV1Result<TOutput> =
	| { readonly value: TOutput; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<StandardSchemaV1Issue> };

export interface StandardSchemaV1Issue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * Wraps `schema` in a Standard Schema, for passing to libraries that accept one.
 * The result is not itself a `Schema`, so it can't be nested in other schemas.
 *
 * Its `validate` is synchronous and ignores the options argument, and `types`
 * is left unset: the input and output types are carried by the return type.
 */
// @__NO_SIDE_EFFECTS__
export const to_standard_schema = <T extends AnySchema>(
	schema: T
): StandardSchemaV1<InferInput<T>, Infer<T>> => ({
	'~standard': {
		version: 1,
		vendor: 'fuz_schema',
		validate: (value) => {
			const result = parse(schema, value);
			return result.ok
				? { value: result.value }
				: {
						issues: result.issues.map((issue) => ({
							// the text `format_issue` writes, without the path, which is its own field here
							message: issue.message ?? `expected ${issue.expected}, received ${issue.received}`,
							path: issue.path
						}))
					};
		}
	}
});
