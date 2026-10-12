/**
 * Standard Schema support, kept out of `schema.ts` so schemas don't carry a
 * `~standard` property they'd pay for in bytes and in a second object shape.
 * Wrap a schema with `to_standard_schema` where a library asks for one.
 *
 * @see https://standardschema.dev/
 *
 * @module
 */

import { format_issue, parse, type AnySchema, type Infer, type InferInput } from './schema.ts';

/**
 * The Standard Schema v1 interface, copied from the spec as it recommends
 * so there's no dependency on `@standard-schema/spec`.
 */
export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
	readonly '~standard': StandardSchemaV1Props<TInput, TOutput>;
}

export interface StandardSchemaV1Props<TInput = unknown, TOutput = TInput> {
	readonly version: 1;
	readonly vendor: string;
	readonly validate: (
		value: unknown
	) => StandardSchemaV1Result<TOutput> | Promise<StandardSchemaV1Result<TOutput>>;
	readonly types?: { readonly input: TInput; readonly output: TOutput } | undefined;
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
							// the path is its own field here, so leave it out of the text
							message: format_issue({ ...issue, path: [] }),
							path: issue.path
						}))
					};
		}
	}
});
