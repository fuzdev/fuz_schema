/**
 * fuz_util's `package.json` schemas in this library: `package_json_zod.ts`
 * rewritten call for call, in the same order. It takes the library as a
 * parameter so `grade` can build it against two versions.
 *
 * What stands in for what zod has built in:
 *
 * - `z.url()` is a `check` that the text parses as a URL, between two
 *   `transform`s: zod trims the text first and returns it without the tabs and
 *   newlines a URL parser drops.
 * - `z.email()` is a `regex` with zod's pattern.
 * - `z.record(z.string(), x)` is `record(x)`, whose keys are any strings.
 * - `.refine` is `check`, and `.transform` on a schema is a `pipe` ending in
 *   `transform`.
 *
 * And what differs: zod's `looseObject` and `record` return a copy, where this
 * library returns the manifest it was given when nothing in it changed. With
 * a `__proto__` key, zod's copy of a loose object is without it, and its
 * `record` leaves the key out unvalidated, where `record` here validates its
 * value first.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

type SchemaLib = typeof schema_lib;

/** The schemas `create_package_json` returns, typed loosely: they are run, not inferred from. */
export type PackageJsonSchemas = Record<
	| 'PackageJsonRepository'
	| 'PackageJsonAuthor'
	| 'PackageJsonFunding'
	| 'ExportValue'
	| 'PackageJsonExports'
	| 'PackageJson',
	schema_lib.AnySchema
>;

export const create_package_json = (s: SchemaLib): PackageJsonSchemas => {
	const EMAIL =
		/^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
	// zod trims the text, tests that it parses, and returns it trimmed and
	// without the tabs and newlines a URL parser drops
	const Url = s.pipe(
		s.string,
		s.transform((v: string) => v.trim()),
		s.check((v: string) => URL.canParse(v), 'a URL'),
		s.transform((v: string) => v.replace(/[\t\n\r]/g, ''))
	);

	const PackageJsonRepository = s.union([
		s.string,
		s.loose_object({
			type: s.string,
			url: Url,
			directory: s.optional(s.string)
		})
	]);

	const PackageJsonAuthor = s.union([
		s.string,
		s.loose_object({
			name: s.string,
			email: s.optional(s.pipe(s.string, s.regex(EMAIL, 'an email'))),
			url: s.optional(Url)
		})
	]);

	const PackageJsonFunding = s.union([
		s.string,
		s.loose_object({
			type: s.string,
			url: Url
		})
	]);
	const export_value_schema: schema_lib.AnySchema = s.lazy(() =>
		s.union([s.string, s.literal(null), s.record(s.lazy(() => export_value_schema))])
	);
	const ExportValue = export_value_schema;

	const PackageJsonExports = s.union([s.string, s.literal(null), s.record(export_value_schema)]);

	const PackageJson = s.loose_object({
		name: s.string,
		version: s.optional(s.string),
		private: s.optional(s.boolean),
		description: s.optional(s.string),
		tagline: s.optional(s.string),
		glyph: s.optional(
			s.pipe(
				s.string,
				s.check(
					(v) => [...new Intl.Segmenter().segment(v)].length === 1,
					'must be a single unicode character'
				)
			)
		),
		logo: s.optional(s.string),
		logo_alt: s.optional(s.string),
		license: s.optional(s.string),
		scripts: s.optional(s.record(s.string)),
		homepage: s.optional(Url),
		author: s.union([s.string, s.optional(PackageJsonAuthor)]),
		repository: s.optional(s.union([s.string, Url, PackageJsonRepository])),
		contributors: s.optional(s.array(s.union([s.string, PackageJsonAuthor]))),
		bugs: s.optional(
			s.union([
				s.string,
				s.loose_object({
					url: s.optional(Url),
					email: s.optional(s.pipe(s.string, s.regex(EMAIL, 'an email')))
				})
			])
		),
		funding: s.optional(
			s.union([Url, PackageJsonFunding, s.array(s.union([Url, PackageJsonFunding]))])
		),
		keywords: s.optional(s.array(s.string)),

		type: s.optional(s.string),
		engines: s.optional(s.record(s.string)),
		os: s.optional(s.array(s.string)),
		cpu: s.optional(s.array(s.string)),

		dependencies: s.optional(s.record(s.string)),
		devDependencies: s.optional(s.record(s.string)),
		peerDependencies: s.optional(s.record(s.string)),
		peerDependenciesMeta: s.optional(s.record(s.loose_object({ optional: s.boolean }))),
		optionalDependencies: s.optional(s.record(s.string)),

		bin: s.optional(s.record(s.string)),
		sideEffects: s.optional(s.array(s.string)),
		files: s.optional(s.array(s.string)),
		main: s.optional(s.string),
		exports: s.optional(
			s.pipe(
				PackageJsonExports,
				s.transform((value) => (value && Object.keys(value).length === 0 ? undefined : value))
			)
		)
	});

	return {
		PackageJsonRepository,
		PackageJsonAuthor,
		PackageJsonFunding,
		ExportValue,
		PackageJsonExports,
		PackageJson
	};
};
