/**
 * The case matrix: schema-and-input pairs `grade` runs against two versions of
 * the library, so a change shows where it helps and where it costs.
 *
 * Cases take the library as a parameter so the same matrix is built against
 * both versions. Where the cross-library scenarios in `scenarios.ts` answer
 * "how do we compare", these answer "what does this code path cost".
 *
 * The cases come in tiers, by what one is for:
 *
 * - `real` is what a consumer has. Some are written for the purpose: an
 *   object, a list, a config, a form, an event stream, a union of shapes.
 *   The rest are harvested from consumers, their schemas rewritten for this
 *   library and run over their own data: svelte-docinfo's analysis output,
 *   fuz_repos's status report, fuz_util's `package.json`, and
 *   syntax-highlighter-bench's results. Speed is judged on these, so they
 *   are chosen as a set: each differs from the rest in the schema kinds it
 *   leans on or in the path it takes.
 * - The other groups hold one case per code path, at one medium size. `each`
 *   runs a schema over a hundred items so its cost shows over the fixed cost
 *   of a parse, which `fixed` measures alone. The array's own loop is most of
 *   such a case, so it shows a schema getting slower, not what the schema costs.
 * - `scale` repeats a shape at the sizes where a different cost takes over.
 *
 * Every case names its path: `identity` returns the input itself, `copy`
 * returns another value, `issues` fails and builds issues, and `probe` goes
 * through `is`, which builds none. A summary by path says what a group mean
 * can't, such as a change that speeds identity up and slows copy down.
 *
 * Schemas are written as literals and inputs come from `JSON.parse`, as a
 * consumer's do: an object built key by key can be a different kind of object
 * to the engine, and cost differently.
 *
 * Naming is `group/shape/outcome`. A case's `run` returns the parse result so
 * the caller can check it and see whether the output is the input itself.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

import type * as schema_lib from '#lib/schema.ts';
import { create_docinfo } from './docinfo/docinfo_fuz_schema.ts';
import { create_repos_status } from './repos_status/repos_status_fuz_schema.ts';
import { create_package_json } from './package_json/package_json_fuz_schema.ts';
import { create_bench_results } from './bench_results/bench_results_fuz_schema.ts';

export type SchemaLib = typeof schema_lib;

// these exist so a baseline from before the `parse` rename, where `safe_parse`
// returned the result and `parse` threw, can still be graded
type ParseResult = (
	schema: schema_lib.AnySchema,
	value: unknown
) => schema_lib.SchemaResult<unknown>;
type ParseThrowing = (schema: schema_lib.AnySchema, value: unknown) => unknown;

const to_parse = (s: SchemaLib): ParseResult =>
	'parse_or_throw' in s ? s.parse : (s as unknown as { safe_parse: ParseResult }).safe_parse;

const to_parse_or_throw = (s: SchemaLib): ParseThrowing =>
	'parse_or_throw' in s ? s.parse_or_throw : (s as unknown as { parse: ParseThrowing }).parse;

type ObjectFactory = (entries: schema_lib.SchemaEntries) => schema_lib.AnySchema;

// and these so a baseline from before the object rename, where `strict_object`
// rejected unknown keys and `object` dropped them, can still be graded
const to_object = (s: SchemaLib): ObjectFactory =>
	'strip_object' in s ? s.object : (s as unknown as { strict_object: ObjectFactory }).strict_object;

const to_strip_object = (s: SchemaLib): ObjectFactory =>
	'strip_object' in s ? s.strip_object : (s as unknown as { object: ObjectFactory }).object;

type OneOfFactory = (values: ReadonlyArray<schema_lib.SchemaLiteral>) => schema_lib.AnySchema;

// and this so a baseline from before `picklist` was renamed `one_of` can still be graded
const to_one_of = (s: SchemaLib): OneOfFactory =>
	'one_of' in s ? s.one_of : (s as unknown as { picklist: OneOfFactory }).picklist;

/**
 * What a case's parse does:
 *
 * - `identity` - matches, and the output is the input itself
 * - `copy` - matches, and the output is another value
 * - `issues` - doesn't match, through `parse`, which builds issues
 * - `probe` - goes through `is`, which builds none, matching or not
 */
export type CasePath = 'identity' | 'copy' | 'issues' | 'probe';

export const CASE_PATHS: ReadonlyArray<CasePath> = ['identity', 'copy', 'issues', 'probe'];

export interface Case {
	name: string;
	group: string;
	/**
	 * Whether the case resembles real consumer usage. The acceptance rules
	 * judge speed on these, not on the rest.
	 */
	realistic: boolean;
	path: CasePath;
	/** Whether the input should match. */
	valid: boolean;
	input: unknown;
	/** Parses `input`, returning the output, or `undefined` when it didn't match. */
	run: () => unknown;
	/** Whether the call succeeded, checked once against `valid` before measuring. */
	ok: () => boolean;
}

type CaseGroup = (s: SchemaLib) => Array<Case>;

const to_group = (name: string): string => name.slice(0, name.indexOf('/'));

// a case through `parse`, whose name ends in its outcome
const to_case = (
	s: SchemaLib,
	name: string,
	schema: schema_lib.AnySchema,
	input: unknown,
	path: Exclude<CasePath, 'probe'>
): Case => {
	const group = to_group(name);
	return {
		name,
		group,
		realistic: group === 'real',
		path,
		valid: path !== 'issues',
		input,
		run: () => {
			const result = to_parse(s)(schema, input);
			return result.ok ? result.value : undefined;
		},
		ok: () => to_parse(s)(schema, input).ok
	};
};

// a case through `is`
const to_probe_case = (
	s: SchemaLib,
	name: string,
	schema: schema_lib.AnySchema,
	input: unknown,
	valid: boolean
): Case => {
	const group = to_group(name);
	return {
		name,
		group,
		realistic: group === 'real',
		path: 'probe',
		valid,
		input,
		run: () => (s.is(schema, input) ? input : undefined),
		ok: () => to_parse(s)(schema, input).ok
	};
};

const range = (n: number): Array<number> => Array.from({ length: n }, (_, i) => i);

// what a parsed response body is: fresh objects, no literals shared with the source
const to_json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// `n` items of `value`, parsed
const to_items = (value: unknown, n = 100): Array<unknown> => to_json(range(n).map(() => value));

// six entries as a literal, the width the path cases share
const to_six = <T>(x: T): Record<`k${0 | 1 | 2 | 3 | 4 | 5}`, T> => ({
	k0: x,
	k1: x,
	k2: x,
	k3: x,
	k4: x,
	k5: x
});

// `n` keys `k0`..`k{n-1}` of `value`, parsed
const to_record = (n: number, value: unknown = 'v'): Record<string, unknown> =>
	to_json(Object.fromEntries(range(n).map((i) => [`k${i}`, value])));

// `n` entries `k0`..`k{n-1}`, for widths too great to write out. The keys come
// from a parse and the schemas are set over them, which leaves the object as a
// literal would be, where one built key by key need not be. Only below 128 keys:
// from there a parse makes a dictionary, and a literal doesn't.
const to_entries = (n: number, schema: schema_lib.AnySchema): schema_lib.SchemaEntries => {
	const entries: schema_lib.SchemaEntries = to_record(n, 0) as any;
	for (const key in entries) entries[key] = schema;
	return entries;
};

// `value` with its keys starting `shift` places on, parsed
const to_rotated = (value: Record<string, unknown>, shift: number): Record<string, unknown> => {
	const entries = Object.entries(value);
	const at = shift % entries.length;
	return to_json(Object.fromEntries([...entries.slice(at), ...entries.slice(0, at)]));
};

//
// Schemas and inputs the realistic cases share
//

const create_user = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({
		id: s.number,
		name: s.string,
		email: s.string,
		active: s.boolean,
		tags: s.array(s.string),
		address: to_object(s)({ street: s.string, city: s.string, zip: s.string })
	});

const to_user = (i: number): Record<string, unknown> => ({
	id: i,
	name: `user ${i}`,
	email: `user${i}@example.com`,
	active: i % 2 === 0,
	tags: ['a', 'b'],
	address: { street: `${i} Main St`, city: 'Springfield', zip: '12345' }
});

const create_post = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({
		id: s.number,
		title: s.string,
		body: s.string,
		author: to_object(s)({ id: s.number, name: s.string }),
		tags: s.array(s.string),
		published_at: s.nullable(s.string),
		likes: s.number
	});

const to_post = (i: number): Record<string, unknown> => ({
	id: i,
	title: `post ${i}`,
	body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
	author: { id: i % 7, name: `author ${i % 7}` },
	tags: ['news', 'tech', 'long read'].slice(0, i % 4),
	published_at: i % 3 ? '2024-01-01T00:00:00Z' : null,
	likes: i * 3
});

const create_name = (s: SchemaLib): schema_lib.AnySchema =>
	s.pipe(s.string, s.min_length(1), s.max_length(50), s.regex(/^[a-z ]+$/));

const create_age = (s: SchemaLib): schema_lib.AnySchema =>
	s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150));

//
// Realistic
//

const real: CaseGroup = (s) => {
	const User = create_user(s);
	const Post = create_post(s);
	const Posts = s.array(Post);
	const posts = range(100).map(to_post);
	// defaults fill what a config leaves out, so its output is a copy
	const Config = to_object(s)({
		host: s.string,
		port: s.with_default(s.pipe(s.number, s.integer, s.min_value(1), s.max_value(65535)), 8080),
		tls: s.optional(to_object(s)({ cert: s.string, key: s.string })),
		log_level: s.with_default(to_one_of(s)(['debug', 'info', 'warn', 'error']), 'info'),
		retries: s.with_default(s.pipe(s.number, s.integer, s.min_value(0)), 3),
		timeout_ms: s.optional(s.number),
		allow: s.with_default(s.array(s.string), []),
		verbose: s.optional(s.boolean)
	});
	const Form = to_strip_object(s)({
		name: create_name(s),
		email: s.pipe(s.string, s.max_length(254), s.regex(/^[^@\s]+@[^@\s]+$/)),
		age: create_age(s),
		newsletter: s.optional(s.boolean)
	});
	const form = { name: 'ada lovelace', email: 'ada@example.com', age: 36, newsletter: true };
	const Event = s.variant('type', [
		to_object(s)({
			type: s.literal('click'),
			at: s.number,
			x: s.number,
			y: s.number,
			target: s.string
		}),
		to_object(s)({ type: s.literal('key'), at: s.number, key: s.string, mods: s.array(s.string) }),
		to_object(s)({ type: s.literal('scroll'), at: s.number, dx: s.number, dy: s.number }),
		to_object(s)({ type: s.literal('nav'), at: s.number, from: s.string, to: s.string })
	]);
	const to_event = (i: number): unknown =>
		[
			{ type: 'click', at: i, x: i, y: i * 2, target: '#save' },
			{ type: 'key', at: i, key: 'a', mods: ['ctrl'] },
			{ type: 'scroll', at: i, dx: 0, dy: 120 },
			{ type: 'nav', at: i, from: '/', to: '/about' }
		][i % 4];
	// shapes told apart by what keys they have, with no discriminator to dispatch on
	const Reply = s.union([
		to_object(s)({ data: Post }),
		to_object(s)({ error: to_object(s)({ code: s.number, message: s.string }) }),
		to_object(s)({ redirect: s.string })
	]);
	const to_reply = (i: number): unknown =>
		[{ data: to_post(i) }, { error: { code: 404, message: 'not found' } }, { redirect: '/login' }][
			i % 3
		];
	// a process's environment: every value a string, most keys not the schema's
	const Env = to_strip_object(s)({
		NODE_ENV: to_one_of(s)(['development', 'test', 'production']),
		PORT: s.pipe(
			s.string,
			s.regex(/^\d+$/),
			s.transform((v: string) => Number(v))
		),
		DATABASE_URL: s.string,
		LOG_LEVEL: s.with_default(to_one_of(s)(['debug', 'info', 'warn', 'error']), 'info'),
		DEBUG: s.optional(s.string)
	});
	return [
		to_case(s, 'real/user/valid', User, to_json(to_user(1)), 'identity'),
		to_case(s, 'real/posts_100/valid', Posts, to_json(posts), 'identity'),
		// the same list from sources that write their keys in different orders
		to_case(
			s,
			'real/posts_100_mixed_order/valid',
			Posts,
			posts.map((post, i) => to_rotated(post, i)),
			'identity'
		),
		to_case(
			s,
			'real/config_defaults/valid',
			Config,
			to_json({ host: 'example.com', tls: { cert: 'a', key: 'b' }, retries: 5 }),
			'copy'
		),
		to_case(s, 'real/form/valid', Form, to_json(form), 'identity'),
		// with the fields a form posts beside its own, which are dropped
		to_case(
			s,
			'real/form_extra_fields/valid',
			Form,
			to_json({ csrf: 'f3a9', ...form, submit: 'Save' }),
			'copy'
		),
		to_case(
			s,
			'real/events_100/valid',
			s.array(Event),
			to_json(range(100).map(to_event)),
			'identity'
		),
		to_case(
			s,
			'real/replies_30/valid',
			s.array(Reply),
			to_json(range(30).map(to_reply)),
			'identity'
		),
		to_case(
			s,
			'real/env/valid',
			Env,
			to_json({
				SHELL: '/bin/sh',
				HOME: '/home/app',
				LANG: 'C.UTF-8',
				PATH: '/usr/local/bin:/usr/bin:/bin',
				HOSTNAME: 'web-1',
				NODE_ENV: 'production',
				NODE_OPTIONS: '--enable-source-maps',
				PORT: '8080',
				DATABASE_URL: 'postgres://db.internal/app',
				REDIS_URL: 'redis://cache.internal',
				TZ: 'UTC',
				PWD: '/srv/app'
			}),
			'copy'
		),
		// a guard that fails inside a list, where no issue is built
		to_probe_case(
			s,
			'real/user_is/invalid',
			User,
			to_json({ ...to_user(1), tags: ['a', 7] }),
			false
		),
		// what a form gets wrong: two fields, each stopped at an action
		to_case(
			s,
			'real/form_two_bad/invalid',
			Form,
			to_json({ ...form, name: '', email: 'ada' }),
			'issues'
		),
		// a few issues, each some levels down
		to_case(
			s,
			'real/posts_100_some_bad/invalid',
			Posts,
			to_json(
				posts.map((post, i) =>
					i % 20 ? post : { ...post, author: { id: i, name: null }, tags: ['news', 7] }
				)
			),
			'issues'
		)
	];
};

interface HarvestedDocument {
	name: string;
	value: unknown;
}

// the documents of a harvested set's data file, by its path from this directory
// and the key it holds them under
const read_harvest = (path: string, key: string): Array<HarvestedDocument> => {
	const documents: unknown = JSON.parse(
		readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
	)[key];
	if (!Array.isArray(documents)) throw new Error(`no ${key} in ${path}`);
	return documents;
};

const to_document = (documents: Array<HarvestedDocument>, name: string): unknown => {
	const found = documents.find((d) => d.name === name);
	if (!found) throw new Error(`no document ${name}`);
	return found.value;
};

// The cases below are harvested, not invented: each group runs a consumer's own
// schemas, rewritten for this library, over that consumer's own data. They are
// written with this library's current names, so a version from before one of
// them loses the group.

// What svelte-docinfo validates, with its own schemas (`docinfo/`) and its own
// output for a whole library. A module is stored without the fields that have
// their defaults, so parsing one fills them in and copies it all the way down.
const real_docinfo: CaseGroup = (s) => {
	const { ModuleJson, TypeJson } = create_docinfo(s);
	const modules: Array<Record<string, unknown>> = JSON.parse(
		readFileSync(new URL('./docinfo/docinfo_fuz_ui.json', import.meta.url), 'utf8')
	).modules;
	const to_module = (path: string): Record<string, unknown> => {
		const found = modules.find((m) => m.path === path);
		if (!found) throw new Error(`no module ${path}`);
		return found;
	};
	const component = to_module('Dialog.svelte');
	const parsed = to_parse(s)(ModuleJson, component);
	if (!parsed.ok) throw new Error('Dialog.svelte does not match');
	// every type the library's declarations carry, each a tree of its own
	const types: Array<unknown> = [];
	const collect = (value: unknown): void => {
		if (value === null || typeof value !== 'object') return;
		for (const [key, child] of Object.entries(value)) {
			if (key === 'typeInfo' || key === 'returnTypeInfo') types.push(child);
			else collect(child);
		}
	};
	collect(modules);
	// a class's module with one value wrong, as far down a type as its types go
	const broken = to_json(to_module('module.svelte.ts'));
	let deepest: { node: Record<string, unknown>; depth: number } | undefined;
	const descend = (value: unknown, depth: number, in_type: boolean): void => {
		if (value === null || typeof value !== 'object') return;
		if (in_type && !Array.isArray(value) && 'kind' in value && depth > (deepest?.depth ?? 0)) {
			deepest = { node: value, depth };
		}
		for (const [key, child] of Object.entries(value)) {
			descend(child, depth + 1, in_type || key === 'typeInfo' || key === 'returnTypeInfo');
		}
	};
	descend(broken, 0, false);
	if (!deepest) throw new Error('module.svelte.ts has no types');
	deepest.node.kind = 'bogus';
	return [
		to_case(s, 'real/docinfo_module/valid', ModuleJson, component, 'copy'),
		// the same as it is once read, with nothing left to fill in
		to_case(s, 'real/docinfo_module_full/valid', ModuleJson, to_json(parsed.value), 'identity'),
		to_case(s, 'real/docinfo_types/valid', s.array(TypeJson), types, 'identity'),
		to_case(s, 'real/docinfo_module_bad/invalid', ModuleJson, broken, 'issues'),
		// the whole library: the module case again at a size too large to stay in the
		// nearest cache, so it is a case at scale and not one speed is judged on
		to_case(s, 'scale/docinfo_library/valid', s.array(ModuleJson), modules, 'copy')
	];
};

// What fuz_repos reads the output of its `repos status --json` through
// (`repos_status/`): strict objects and discriminated unions nested several
// deep, under a plain union of a report and an error.
const real_repos_status: CaseGroup = (s) => {
	const { ReposStatusDocument } = create_repos_status(s);
	const documents = read_harvest('repos_status/repos_status_documents.json', 'documents');
	const report = to_document(documents, 'status_report');
	// a report from a newer tool than the schema mirrors: its last entry's
	// presence is of a kind the mirror doesn't have, which the union's first
	// option finds only after the rest of the document has matched
	const drifted = to_json(report) as any;
	drifted.entries.at(-1).presence = { kind: 'not_yet_known' };
	return [
		to_case(s, 'real/repos_status/valid', ReposStatusDocument, report, 'identity'),
		// the union's second option, after its first has missed
		to_case(
			s,
			'real/repos_status_error/valid',
			ReposStatusDocument,
			to_document(documents, 'error_report_registry_invalid'),
			'identity'
		),
		to_case(s, 'real/repos_status_drifted/invalid', ReposStatusDocument, drifted, 'issues')
	];
};

// What gro and fuz_repos read a `package.json` through (`package_json/`): a
// loose object of optional keys, records, and unions with no discriminator.
const real_package_json: CaseGroup = (s) => {
	const { PackageJson } = create_package_json(s);
	const manifests = read_harvest('package_json/package_json_manifests.json', 'manifests');
	return [
		// a published manifest, with no `glyph`: the check on one is the consumer's
		// own code and would be most of the time
		to_case(
			s,
			'real/package_json/valid',
			PackageJson,
			to_document(manifests, 'svelte@5.57.2'),
			'identity'
		),
		// and one the schema doesn't take: `sideEffects` is `false`
		to_case(
			s,
			'real/package_json_side_effects/invalid',
			PackageJson,
			to_document(manifests, 'vitest@5.0.0'),
			'issues'
		)
	];
};

// What syntax-highlighter-bench reads a run's results through
// (`bench_results/`): a large document of strict objects, records keyed by id,
// and numbers each with its checks.
const real_bench_results: CaseGroup = (s) => {
	const { BenchResults } = create_bench_results(s);
	const documents = read_harvest('bench_results/bench_results_documents.json', 'documents');
	return [
		to_case(
			s,
			'real/bench_results/valid',
			BenchResults,
			to_document(documents, 'fixture_run'),
			'identity'
		),
		// a published run: the same at a size too large for any cache but the last
		to_case(
			s,
			'scale/bench_results_run/valid',
			BenchResults,
			to_document(documents, 'latest'),
			'identity'
		)
	];
};

//
// Paths
//

// the cost every parse has, whatever the schema
const fixed: CaseGroup = (s) => [
	to_case(s, 'fixed/parse_string/valid', s.string, 'hello', 'identity'),
	to_case(s, 'fixed/parse_string/invalid', s.string, 42, 'issues'),
	to_probe_case(s, 'fixed/is_string/valid', s.string, 'hello', true),
	to_probe_case(s, 'fixed/is_string/invalid', s.string, 42, false)
];

// a hundred items through one schema, so the schema's cost shows over a parse's
const each: CaseGroup = (s) => {
	const Name = create_name(s);
	const Age = create_age(s);
	const primitives = s.union([s.string, s.number, s.boolean]);
	const Shape = s.variant(
		'kind',
		range(10).map((i) => to_object(s)({ kind: s.literal(`k${i}`), value: s.number }))
	);
	const of = (
		name: string,
		schema: schema_lib.AnySchema,
		item: unknown,
		path: Exclude<CasePath, 'probe'> = 'identity'
	): Case => to_case(s, `each/${name}`, s.array(schema), to_items(item), path);
	return [
		of('string/valid', s.string, 'hello'),
		of('number/valid', s.number, 42),
		of('literal/valid', s.literal('a'), 'a'),
		of('one_of_20_last/valid', to_one_of(s)(range(20)), 19),
		of('optional_present/valid', s.optional(s.string), 'x'),
		of('nullable_null/valid', s.nullable(s.string), null),
		of(
			'lazy/valid',
			s.lazy(() => s.string),
			'x'
		),
		of('message/valid', s.message(s.string, 'must be text'), 'x'),
		// `JSON.stringify` writes `undefined` in an array as `null`, so not parsed
		to_case(
			s,
			'each/default_absent/valid',
			s.array(s.with_default(s.string, 'd')),
			range(100).map(() => undefined),
			'copy'
		),
		of(
			'transform/valid',
			s.pipe(
				s.number,
				s.transform((v: number) => v + 1)
			),
			1,
			'copy'
		),
		of('pipe_string_3_actions/valid', Name, 'ada lovelace'),
		of('pipe_number_3_actions/valid', Age, 36),
		of(
			'pipe_check/valid',
			s.pipe(
				s.number,
				s.check((v: number) => v % 2 === 0)
			),
			36
		),
		of('union_3_primitives_first/valid', primitives, 'x'),
		of('union_3_primitives_last/valid', primitives, true),
		of(
			'union_4_literals_last/valid',
			s.union([s.literal('a'), s.literal('b'), s.literal('c'), s.literal('d')]),
			'd'
		),
		// an inner union that misses, inside an outer one that matches
		of('union_nested_inner_miss/valid', s.union([s.union([s.string, s.number]), s.boolean]), true),
		// an option that misses at an action, which describes what it expected
		of(
			'union_2_pipes_first_action_miss/valid',
			s.union([s.pipe(s.string, s.max_length(3)), s.pipe(s.string, s.min_length(1))]),
			'hello'
		),
		of(
			'union_3_objects_last/valid',
			s.union([
				to_object(s)({ a: s.string }),
				to_object(s)({ b: s.string }),
				to_object(s)({ c: s.string, d: s.array(s.number) })
			]),
			{ c: 'x', d: [1, 2] }
		),
		// an option whose entries all match and that misses at a key it doesn't have
		of(
			'union_2_objects_first_unknown_key/valid',
			s.union([to_object(s)({ a: s.string }), to_object(s)({ a: s.string, b: s.string })]),
			{ a: 'x', b: 'y' }
		),
		of('variant_10_last/valid', Shape, { kind: 'k9', value: 1 }),
		// a hundred issues, each with an index for its path
		of('string/invalid', s.string, 42, 'issues'),
		of('message/invalid', s.message(s.string, 'must be text'), 42, 'issues'),
		of('pipe_string_first_action_bad/invalid', Name, '', 'issues'),
		of('pipe_string_last_action_bad/invalid', Name, 'Ada', 'issues'),
		of('union_3_primitives/invalid', primitives, null, 'issues'),
		of('variant_10_unknown_kind/invalid', Shape, { kind: 'zz', value: 1 }, 'issues'),
		// the option is found and one of its entries fails
		of('variant_10_entry_bad/invalid', Shape, { kind: 'k9', value: 'x' }, 'issues')
	];
};

// `object`, and with it everything it shares with `strip_object`
const object: CaseGroup = (s) => {
	const O = to_object(s)(to_six(s.string));
	const input = to_six('v');
	const all_bad = to_json(to_six(1));
	return [
		to_case(s, 'object/6_keys/valid', O, to_json(input), 'identity'),
		// the input's keys in another order than the schema's
		to_case(
			s,
			'object/6_keys_reversed/valid',
			O,
			to_json(Object.fromEntries(Object.entries(input).reverse())),
			'identity'
		),
		// an absent optional key ahead of the rest, so no key comes where the schema has it
		to_case(
			s,
			'object/7_keys_first_optional_absent/valid',
			to_object(s)({ first: s.optional(s.string), ...to_six(s.string) }),
			to_json(input),
			'identity'
		),
		// and behind them, so every key the input has does
		to_case(
			s,
			'object/7_keys_last_optional_absent/valid',
			to_object(s)({ ...to_six(s.string), last: s.optional(s.string) }),
			to_json(input),
			'identity'
		),
		to_case(
			s,
			'object/6_optional_absent/valid',
			to_object(s)(to_six(s.optional(s.string))),
			{},
			'identity'
		),
		// one entry changes, and the copy is begun at it
		to_case(
			s,
			'object/7_keys_first_defaulted/valid',
			to_object(s)({ first: s.with_default(s.string, 'd'), ...to_six(s.string) }),
			to_json(input),
			'copy'
		),
		to_case(
			s,
			'object/7_keys_last_defaulted/valid',
			to_object(s)({ ...to_six(s.string), last: s.with_default(s.string, 'd') }),
			to_json(input),
			'copy'
		),
		to_case(
			s,
			'object/6_defaults_absent/valid',
			to_object(s)(to_six(s.with_default(s.string, 'd'))),
			{},
			'copy'
		),
		// a key the input has changes: the copy is begun while its keys are enumerated,
		// and the keys after it are written to it
		to_case(
			s,
			'object/6_keys_first_transformed/valid',
			to_object(s)({
				...to_six(s.string),
				k0: s.pipe(
					s.string,
					s.transform((v: string) => v + '!')
				)
			}),
			to_json(input),
			'copy'
		),
		to_case(s, 'object/6_keys_first_bad/invalid', O, to_json({ ...input, k0: 1 }), 'issues'),
		to_case(s, 'object/6_keys_all_bad/invalid', O, to_json(to_six(1)), 'issues'),
		to_case(s, 'object/unknown_key_last/invalid', O, to_json({ ...input, z: 1 }), 'issues'),
		to_case(s, 'object/unknown_key_first/invalid', O, to_json({ z: 1, ...input }), 'issues'),
		// an array is not an object, whatever its length
		to_case(s, 'object/array_100/invalid', O, range(100), 'issues'),
		// a message on the object looks at each of its entries' issues and labels none
		to_case(
			s,
			'object/6_keys_all_bad_message/invalid',
			s.message(O, 'must be a row'),
			to_json(to_six(1)),
			'issues'
		),
		// the same failure thrown, its issues formatted into the error's message
		{
			name: 'object/6_keys_all_bad_throw/invalid',
			group: 'object',
			realistic: false,
			path: 'issues',
			valid: false,
			input: all_bad,
			run: () => {
				try {
					return to_parse_or_throw(s)(O, all_bad);
				} catch {
					return undefined;
				}
			},
			ok: () => to_parse(s)(O, all_bad).ok
		},
		to_probe_case(s, 'object/6_keys_is/valid', O, to_json(input), true),
		to_probe_case(s, 'object/6_keys_last_bad_is/invalid', O, to_json({ ...input, k5: 1 }), false)
	];
};

// `strip_object` where it differs from `object`, which is with keys to drop:
// with none it is the same work, and `object`'s cases stand for it
const strip: CaseGroup = (s) => {
	const O = to_strip_object(s)(to_six(s.string));
	const input = to_six('v');
	return [
		to_case(s, 'strip/6_of_7_keys_unknown_last/valid', O, to_json({ ...input, z: 1 }), 'copy'),
		to_case(s, 'strip/6_of_7_keys_unknown_first/valid', O, to_json({ z: 1, ...input }), 'copy'),
		// far more unknown keys than known ones, of which the first is enough to know
		to_case(s, 'strip/6_of_20_keys/valid', O, to_record(20), 'copy'),
		// a key to drop and an optional key the input lacks, which the copy leaves out
		to_case(
			s,
			'strip/6_of_7_keys_optional_absent/valid',
			to_strip_object(s)({ ...to_six(s.string), last: s.optional(s.string) }),
			to_json({ ...input, z: 1 }),
			'copy'
		),
		// a key to drop and an entry that changes
		to_case(
			s,
			'strip/7_of_8_keys_last_defaulted/valid',
			to_strip_object(s)({ ...to_six(s.string), last: s.with_default(s.string, 'd') }),
			to_json({ ...input, z: 1 }),
			'copy'
		),
		// a failure's output is unused, so the keys to drop are never looked for
		to_case(
			s,
			'strip/6_of_7_keys_first_bad/invalid',
			O,
			to_json({ ...input, k0: 1, z: 1 }),
			'issues'
		)
	];
};

// `loose_object`, which has a loop of its own
const loose: CaseGroup = (s) => {
	const O = s.loose_object(to_six(s.string));
	const input = to_six('v');
	return [
		to_case(s, 'loose/6_keys/valid', O, to_json(input), 'identity'),
		// unknown keys are never looked at, so they cost nothing
		to_case(s, 'loose/6_of_20_keys/valid', O, to_record(20), 'identity'),
		// a default changes the value, so this one copies the whole input
		to_case(
			s,
			'loose/6_defaults_absent_3_unknown/valid',
			s.loose_object(to_six(s.with_default(s.string, 'd'))),
			to_json({ x: 1, y: 2, z: 3 }),
			'copy'
		),
		to_case(s, 'loose/6_keys_first_bad/invalid', O, to_json({ ...input, k0: 1 }), 'issues')
	];
};

const nested: CaseGroup = (s) => {
	const to_schema = (depth: number): schema_lib.AnySchema =>
		depth === 0 ? s.string : to_object(s)({ a: s.number, next: to_schema(depth - 1) });
	const to_input = (depth: number, leaf: unknown): unknown =>
		depth === 0 ? leaf : { a: depth, next: to_input(depth - 1, leaf) };
	return [
		to_case(s, 'nested/depth_8/valid', to_schema(8), to_json(to_input(8, 'x')), 'identity'),
		// one issue whose path is prefixed at every level on the way out
		to_case(s, 'nested/depth_8_leaf_bad/invalid', to_schema(8), to_json(to_input(8, 1)), 'issues'),
		// one change at the bottom, and a copy of every level above it
		to_case(
			s,
			'nested/depth_8_leaf_defaulted/valid',
			((): schema_lib.AnySchema => {
				const to_defaulted = (depth: number): schema_lib.AnySchema =>
					depth === 0
						? to_object(s)({ a: s.number, last: s.with_default(s.string, 'd') })
						: to_object(s)({ a: s.number, next: to_defaulted(depth - 1) });
				return to_defaulted(7);
			})(),
			to_json(to_input(7, { a: 0 })),
			'copy'
		)
	];
};

// `array` itself, its items being the cheapest there are
const array: CaseGroup = (s) => {
	const Defaulted = s.array(s.with_default(s.number, 0));
	return [
		// one change in a large value: the whole is copied once, wherever the change is
		to_case(s, 'array/100_first_defaulted/valid', Defaulted, [undefined, ...range(99)], 'copy'),
		to_case(s, 'array/100_last_defaulted/valid', Defaulted, [...range(99), undefined], 'copy'),
		to_case(
			s,
			'array/100_last_bad/invalid',
			s.array(s.number),
			to_json([...range(99), 'x']),
			'issues'
		)
	];
};

const record: CaseGroup = (s) => [
	to_case(s, 'record/20_keys/valid', s.record(s.string), to_record(20), 'identity'),
	to_case(
		s,
		'record/20_keys_last_transformed/valid',
		s.record(
			s.pipe(
				s.string,
				s.transform((v: string) => (v === 'last' ? 'changed' : v))
			)
		),
		to_json({ ...to_record(19), z: 'last' }),
		'copy'
	),
	// every value changes: the copy is begun at the first and the rest written to it
	to_case(
		s,
		'record/20_keys_all_transformed/valid',
		s.record(
			s.pipe(
				s.string,
				s.transform((v: string) => v + '!')
			)
		),
		to_record(20),
		'copy'
	),
	to_case(
		s,
		'record/20_keys_last_bad/invalid',
		s.record(s.string),
		to_json({ ...to_record(19), z: 1 }),
		'issues'
	)
];

//
// Scale
//

const scale: CaseGroup = (s) => {
	const to_bad_every = (n: number, every: number): Array<unknown> =>
		to_json(range(n).map((i) => (i % every === 0 ? 'x' : i)));
	const to_nested_schema = (depth: number): schema_lib.AnySchema =>
		depth === 0 ? s.string : to_object(s)({ next: to_nested_schema(depth - 1) });
	const to_nested_input = (depth: number): unknown =>
		depth === 0 ? 'x' : { next: to_nested_input(depth - 1) };
	return [
		// width
		to_case(
			s,
			'scale/object_20_keys/valid',
			to_object(s)(to_entries(20, s.string)),
			to_record(20),
			'identity'
		),
		to_case(
			s,
			'scale/object_100_keys/valid',
			to_object(s)(to_entries(100, s.string)),
			to_record(100),
			'identity'
		),
		// wide enough that the parsed input is a dictionary to the engine
		to_case(
			s,
			'scale/object_200_keys/valid',
			to_object(s)(to_entries(200, s.string)),
			to_record(200),
			'identity'
		),
		// every key looked up, none where the schema has it
		to_case(
			s,
			'scale/object_100_keys_reversed/valid',
			to_object(s)(to_entries(100, s.string)),
			to_json(Object.fromEntries(Object.entries(to_record(100)).reverse())),
			'identity'
		),
		// a config-like object: many optional keys, few given
		to_case(
			s,
			'scale/object_20_optional_2_present/valid',
			to_object(s)(to_entries(20, s.optional(s.string))),
			to_json({ k3: 'a', k17: 'b' }),
			'identity'
		),
		// a copy of a wide object, begun at its first key and at its last
		to_case(
			s,
			'scale/object_21_keys_first_defaulted/valid',
			to_object(s)({ first: s.with_default(s.string, 'd'), ...to_entries(20, s.string) }),
			to_record(20),
			'copy'
		),
		to_case(
			s,
			'scale/object_21_keys_last_defaulted/valid',
			to_object(s)({ ...to_entries(20, s.string), last: s.with_default(s.string, 'd') }),
			to_record(20),
			'copy'
		),
		to_case(
			s,
			'scale/strip_20_of_40_keys/valid',
			to_strip_object(s)(to_entries(20, s.string)),
			to_record(40),
			'copy'
		),
		to_case(s, 'scale/record_1000_keys/valid', s.record(s.string), to_record(1000), 'identity'),
		// length
		to_case(s, 'scale/array_10_numbers/valid', s.array(s.number), to_json(range(10)), 'identity'),
		to_case(
			s,
			'scale/array_10000_numbers/valid',
			s.array(s.number),
			to_json(range(10_000)),
			'identity'
		),
		// failures at different rates, each one an issue with a path
		to_case(
			s,
			'scale/array_1000_1pct_bad/invalid',
			s.array(s.number),
			to_bad_every(1000, 100),
			'issues'
		),
		to_case(
			s,
			'scale/array_1000_half_bad/invalid',
			s.array(s.number),
			to_bad_every(1000, 2),
			'issues'
		),
		// depth
		to_case(
			s,
			'scale/nested_depth_64/valid',
			to_nested_schema(64),
			to_json(to_nested_input(64)),
			'identity'
		),
		// options tried and missed before the one that matches
		to_case(
			s,
			'scale/union_10_objects_last/valid',
			s.union(range(10).map((i) => to_object(s)({ [`k${i}`]: s.string }))),
			to_json({ k9: 'x' }),
			'identity'
		)
	];
};

/**
 * Every group, each built separately so a library version missing an export
 * loses only the groups that need it.
 */
export const CASE_GROUPS: Array<CaseGroup> = [
	real,
	real_docinfo,
	real_repos_status,
	real_package_json,
	real_bench_results,
	fixed,
	each,
	object,
	strip,
	loose,
	nested,
	array,
	record,
	scale
];

/**
 * Builds every case the given library version supports.
 */
export const create_cases = (s: SchemaLib): Array<Case> =>
	CASE_GROUPS.flatMap((group) => {
		try {
			return group(s);
		} catch {
			return [];
		}
	});
