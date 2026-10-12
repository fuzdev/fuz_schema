/**
 * fuz_util's schema of a `package.json`, as it writes it for zod: what gro and
 * fuz_repos read every manifest through. A snapshot, taken from
 * https://github.com/fuzdev/fuz_util at 33f3612de579 (`src/lib/package_json.ts`),
 * MIT licensed, copyright fuz.dev. What is left out is what doesn't validate:
 * its comments, its type exports, and the `.meta()` descriptions. The three
 * helpers it imports are written in where they are used. What it accepts is
 * what the zod installed here accepts, which need not be the consumer's.
 *
 * `package_json_fuz_schema.ts` is the same schemas in this library, and
 * `src/test/harvest.test.ts` holds the two to the same answers.
 *
 * @module
 */

import { z } from 'zod';

const Url = z.url();

export const PackageJsonRepository = z.union([
	z.string(),
	z.looseObject({
		type: z.string(),
		url: Url,
		directory: z.string().optional()
	})
]);

export const PackageJsonAuthor = z.union([
	z.string(),
	z.looseObject({
		name: z.string(),
		email: z.email().optional(),
		url: Url.optional()
	})
]);

export const PackageJsonFunding = z.union([
	z.string(),
	z.looseObject({
		type: z.string(),
		url: Url
	})
]);
const export_value_schema: z.ZodType = z.lazy(() =>
	z.union([
		z.string(),
		z.null(),
		z.record(
			z.string(),
			z.lazy(() => export_value_schema)
		)
	])
);
export const ExportValue = export_value_schema;

export const PackageJsonExports = z.union([
	z.string(),
	z.null(),
	z.record(z.string(), export_value_schema)
]);

export const PackageJson = z.looseObject({
	name: z.string(),
	version: z.string().optional(),
	private: z.boolean().optional(),
	description: z.string().optional(),
	tagline: z.string().optional(),
	glyph: z
		.string()
		.refine(
			(v) => [...new Intl.Segmenter().segment(v)].length === 1,
			'must be a single unicode character'
		)
		.optional(),
	logo: z.string().optional(),
	logo_alt: z.string().optional(),
	license: z.string().optional(),
	scripts: z.record(z.string(), z.string()).optional(),
	homepage: Url.optional(),
	author: z.union([z.string(), PackageJsonAuthor.optional()]),
	repository: z.union([z.string(), Url, PackageJsonRepository]).optional(),
	contributors: z.array(z.union([z.string(), PackageJsonAuthor])).optional(),
	bugs: z
		.union([z.string(), z.looseObject({ url: Url.optional(), email: z.email().optional() })])
		.optional(),
	funding: z
		.union([Url, PackageJsonFunding, z.array(z.union([Url, PackageJsonFunding]))])
		.optional(),
	keywords: z.array(z.string()).optional(),

	type: z.string().optional(),
	engines: z.record(z.string(), z.string()).optional(),
	os: z.array(z.string()).optional(),
	cpu: z.array(z.string()).optional(),

	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
	peerDependenciesMeta: z.record(z.string(), z.looseObject({ optional: z.boolean() })).optional(),
	optionalDependencies: z.record(z.string(), z.string()).optional(),

	bin: z.record(z.string(), z.string()).optional(),
	sideEffects: z.array(z.string()).optional(),
	files: z.array(z.string()).optional(),
	main: z.string().optional(),
	exports: PackageJsonExports.transform((value) =>
		value && Object.keys(value).length === 0 ? undefined : value
	).optional()
});
