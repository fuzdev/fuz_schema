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
 *   fuz_repos's status report, fuz_util's `package.json`,
 *   syntax-highlighter-bench's results, and the requests and responses of
 *   fuz_app's cell and account surface, with zzz's streamed token. Speed is
 *   judged on these, so they
 *   are chosen as a set: each differs from the rest in the schema kinds it
 *   leans on or in the path it takes.
 * - The other groups hold one case per code path, at one medium size. `each`
 *   runs a schema over a hundred items so its cost shows over the fixed cost
 *   of a parse, which `fixed` measures alone. The array's own loop is most of
 *   such a case, so it shows a schema getting slower, not what the schema costs.
 * - `scale` repeats a shape at the sizes where a different cost takes over.
 * - `create` builds schemas and parses nothing, what an app pays once a
 *   schema as its modules load.
 *
 * Every case names its path: `identity` returns the input itself, `copy`
 * returns another value, `issues` fails and builds issues, `probe` goes
 * through `is`, which builds none, and `create` builds a schema and parses
 * nothing. A summary by path says what a group mean can't, such as a change
 * that speeds identity up and slows copy down.
 *
 * Schemas are written as literals and inputs come from `JSON.parse`, as a
 * consumer's do: an object built key by key can be a different kind of object
 * to the engine, and cost differently. The one exception is a case of such an
 * object, a query as Hono gives one.
 *
 * Naming is `group/shape/outcome`. A case's `run` returns the parse result so
 * the caller can check it and see whether the output is the input itself.
 *
 * @module
 */

import { readFileSync } from 'node:fs';

import type * as schema_lib from '#lib/schema.ts';
import type { CasePath } from './grade_job.ts';
import { INPUT_COPIES_MAX, to_input_copies } from './inputs.ts';
import { create_docinfo } from './docinfo/docinfo_fuz_schema.ts';
import { create_repos_status } from './repos_status/repos_status_fuz_schema.ts';
import { create_package_json } from './package_json/package_json_fuz_schema.ts';
import { create_bench_results } from './bench_results/bench_results_fuz_schema.ts';
import { create_fuz_app } from './fuz_app/fuz_app_fuz_schema.ts';

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

export interface Case {
	name: string;
	group: string;
	/**
	 * Whether the case resembles real consumer usage. The acceptance rules
	 * judge speed on these, not on the rest.
	 */
	realistic: boolean;
	path: CasePath;
	/** Whether the input should match. A case of the `create` path has none, and is `valid`. */
	valid: boolean;
	/**
	 * The copies of the input `run` cycles through, a copy a call, made by
	 * `to_input_copies`. A case of the `create` path has none.
	 */
	inputs: ReadonlyArray<unknown>;
	/**
	 * Parses the next copy of the input, returning the output, or `undefined`
	 * when it didn't match, but for a case that formats its issues, which
	 * returns the length of their text.
	 */
	run: () => unknown;
	/** The copy the last call of `run` was given. */
	given: () => unknown;
	/** Whether a parse of the input succeeds, checked once against `valid` before measuring. */
	ok: () => boolean;
}

/**
 * A case built on its own, when its group is built and apart from the rest of
 * it: one a version can't build is dropped alone, where a case built with its
 * group drops the whole group. A case of an export the baseline may lack is
 * one, its schema made inside `build`, or it goes in a group of its own.
 */
export interface CaseBuild {
	/** The name of the case `build` returns. */
	name: string;
	build: () => Case;
}

/** A case, or a case built on its own. */
export type CaseEntry = Case | CaseBuild;

/** Builds a group of cases against a version of the library. */
export type CaseGroup = (s: SchemaLib) => Array<CaseEntry>;

/** Whether an entry of a group is built on its own. */
const is_case_build = (entry: CaseEntry): entry is CaseBuild => 'build' in entry;

const to_group = (name: string): string => name.slice(0, name.indexOf('/'));

// a case through `parse`, whose name ends in its outcome, cycling through the
// copies of its input `to_input_copies` makes, or through the ones it is given
const to_case = (
	s: SchemaLib,
	name: string,
	schema: schema_lib.AnySchema,
	input: unknown,
	path: Exclude<CasePath, 'probe'>,
	inputs: Array<unknown> = to_input_copies(input)
): Case => {
	const group = to_group(name);
	const mask = inputs.length - 1;
	let at = 0;
	return {
		name,
		group,
		realistic: group === 'real',
		path,
		valid: path !== 'issues',
		inputs,
		run: () => {
			const result = to_parse(s)(schema, inputs[(at = (at + 1) & mask)]);
			return result.ok ? result.value : undefined;
		},
		given: () => inputs[at],
		ok: () => to_parse(s)(schema, inputs[0]).ok
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
	const inputs = to_input_copies(input);
	const mask = inputs.length - 1;
	let at = 0;
	return {
		name,
		group,
		realistic: group === 'real',
		path: 'probe',
		valid,
		inputs,
		run: () => {
			const given = inputs[(at = (at + 1) & mask)];
			return s.is(schema, given) ? given : undefined;
		},
		given: () => inputs[at],
		ok: () => to_parse(s)(schema, inputs[0]).ok
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

// a client that drops what it doesn't name at every level, as one written for
// a library whose plain object does
const create_account = (s: SchemaLib): schema_lib.AnySchema =>
	to_strip_object(s)({
		id: s.number,
		login: s.string,
		name: s.nullable(s.string),
		email: s.string,
		avatar_url: s.string,
		created_at: s.string,
		plan: to_strip_object(s)({ name: s.string, seats: s.number }),
		roles: s.array(s.string)
	});

const to_account = (i: number): Record<string, unknown> => ({
	id: i,
	login: `user${i}`,
	name: i % 5 ? `User ${i}` : null,
	email: `user${i}@example.com`,
	avatar_url: `https://example.com/avatars/${i}.png`,
	created_at: '2024-01-01T00:00:00Z',
	plan: { name: i % 2 ? 'free' : 'team', seats: 1 + (i % 9) },
	roles: ['member', 'admin'].slice(0, 1 + (i % 2))
});

// the same from an API that has since grown fields the client doesn't name,
// among the ones it does and a level down
const to_account_extra = (i: number): Record<string, unknown> => {
	const { id, login, name, email, avatar_url, created_at, plan, roles } = to_account(i);
	return {
		id,
		node_id: `n${i}`,
		login,
		name,
		email,
		avatar_url,
		url: `https://example.com/users/${i}`,
		created_at,
		updated_at: '2024-06-01T00:00:00Z',
		plan: { ...(plan as object), private_repos: i },
		roles
	};
};

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
	const Account = create_account(s);
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
		// a response that is what its schema names, through objects that would drop
		to_case(
			s,
			'real/accounts_100/valid',
			s.array(Account),
			to_json(range(100).map(to_account)),
			'identity'
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
		// modules of other declarations than a component, each stored without
		// its defaults and copied where they are filled in: a class beside an
		// interface and a variable, functions with their parameters, and types
		// and interfaces, whose members fill theirs
		to_case(s, 'real/docinfo_class_module/valid', ModuleJson, to_module('site.svelte.ts'), 'copy'),
		to_case(s, 'real/docinfo_functions_module/valid', ModuleJson, to_module('tome.ts'), 'copy'),
		to_case(s, 'real/docinfo_types_module/valid', ModuleJson, to_module('dialog.ts'), 'copy'),
		// the same as it is once read, with nothing left to fill in
		to_case(s, 'real/docinfo_module_full/valid', ModuleJson, to_json(parsed.value), 'identity'),
		to_case(s, 'real/docinfo_types/valid', s.array(TypeJson), types, 'identity'),
		// the same trees through `is`, where every `lazy` is probed
		to_probe_case(s, 'scale/docinfo_types_is/valid', s.array(TypeJson), types, true),
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
// (`bench_results/`): a results document of strict objects, records keyed by id,
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
		)
	];
};

// What fuz_app's server and every frontend over it parse on the way of a request
// (`fuz_app/`), over frames and bodies its in-memory app wrote: the inputs a
// server parses a request's params through, and a client before it sends them,
// and the outputs a client reads a response through, the large ones being a
// page of a list. The rows are as the server writes them: timestamps to the
// second, each cell's `data` with its keys in the order Postgres's `jsonb` keeps
// them. And zzz's streamed token, a notification parsed once a token.
const real_fuz_app: CaseGroup = (s) => {
	const app = create_fuz_app(s);
	const documents = read_harvest('fuz_app/fuz_app_documents.json', 'documents');
	const list_request = to_document(documents, 'cell_list_request') as any;
	const create_request = to_document(documents, 'cell_create_request') as any;
	const list_response = to_document(documents, 'cell_list_response') as any;
	const notification = to_document(documents, 'completion_progress_notification') as any;
	// a create a client got wrong: a parent id cut short, and a visibility the
	// server doesn't have
	const create_bad = to_json(create_request.params);
	create_bad.parent_id = create_bad.parent_id.slice(0, -1);
	create_bad.visibility = 'unlisted';
	// the page from a newer server, whose rows each have a field this client
	// doesn't name: an issue a row, which fuz_app's reader strips and parses again
	const drifted = to_json(list_response.result);
	for (const cell of drifted.cells) cell.comment_count = 0;
	// and from a reader whose last row has its timestamp in Postgres's own text form
	const pg_timestamp = to_json(list_response.result);
	const last = pg_timestamp.cells.at(-1);
	last.created_at = last.created_at.replace('T', ' ').replace('Z', '+00');
	// a query as Hono gives one, an object of no prototype its keys are set on one
	// by one, here with the one key fuz_app's one query schema names
	const query = (): unknown => {
		const q = Object.create(null);
		q.acting = list_request.params.root_id;
		return q;
	};
	return [
		to_case(
			s,
			'real/fuz_app_cell_list_input/valid',
			app.CellListInput,
			list_request.params,
			'identity'
		),
		to_case(
			s,
			'real/fuz_app_cell_create_input/valid',
			app.CellCreateInput,
			create_request.params,
			'identity'
		),
		to_case(
			s,
			'real/fuz_app_cell_create_input_bad/invalid',
			app.CellCreateInput,
			create_bad,
			'issues'
		),
		to_case(
			s,
			'real/fuz_app_cell_list_output_50/valid',
			app.CellListOutput,
			list_response.result,
			'identity'
		),
		to_case(
			s,
			'real/fuz_app_cell_get_output/valid',
			app.CellGetOutput,
			(to_document(documents, 'cell_get_response') as any).result,
			'identity'
		),
		to_case(
			s,
			'real/fuz_app_account_status/valid',
			app.AccountStatusOutput,
			to_document(documents, 'account_status_response'),
			'identity'
		),
		to_case(
			s,
			'real/fuz_app_completion_progress/valid',
			app.CompletionProgressInput,
			notification.params,
			'identity'
		),
		// a list asked for with no params, which a client that wants every cell
		// sends: the server's input fills its default in, a fresh object a call
		to_case(s, 'real/fuz_app_cell_list_input_absent/valid', app.CellListInput, undefined, 'copy'),
		// what a server asks of every frame before it reads one, through `is`
		to_probe_case(s, 'real/fuz_app_jsonrpc_is/valid', app.JsonrpcRequest, list_request, true),
		// a bearer token's scope as its row holds it, read on every request it makes
		to_case(
			s,
			'fixed/fuz_app_token_scope/valid',
			app.TokenScope,
			to_document(documents, 'token_scope_row'),
			'identity'
		),
		to_case(s, 'object/fuz_app_cells_50_drifted/invalid', app.CellListOutput, drifted, 'issues'),
		to_case(
			s,
			'object/fuz_app_cells_50_pg_timestamp/invalid',
			app.CellListOutput,
			pg_timestamp,
			'issues'
		),
		to_case(
			s,
			'object/fuz_app_query_null_proto/valid',
			app.AuditStreamQuery,
			query(),
			'identity',
			Array.from({ length: INPUT_COPIES_MAX }, query)
		)
	];
};

//
// Creation
//

/**
 * A case that builds a schema, whose `run` returns it. It builds one as it is
 * made, so a version that lacks a factory it calls loses the case where it is
 * built, as a case through `parse` does: with its group, or alone inside a
 * `CaseBuild`. Every instance pays that one call the same.
 */
export const to_create_case = (
	s: SchemaLib,
	name: string,
	create: () => schema_lib.AnySchema
): Case => {
	create();
	return {
		name,
		group: 'create',
		realistic: false,
		path: 'create',
		valid: true,
		inputs: [],
		run: create,
		given: () => undefined,
		ok: () => s.is_schema(create())
	};
};

// made once, as a consumer's module would, so a creation times the library and not the literal
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

// what building schemas costs, the factories called and nothing parsed: an app
// pays it once a schema, as its modules load, and a change that moves work
// from the parse to the factory shows here and in no parse
const create: CaseGroup = (s) => [
	to_create_case(s, 'create/optional_string/valid', () => s.optional(s.string)),
	to_create_case(s, 'create/array/valid', () => s.array(s.string)),
	to_create_case(s, 'create/record/valid', () => s.record(s.number)),
	to_create_case(s, 'create/pipe/valid', () =>
		s.pipe(s.string, s.min_length(1), s.max_length(254), s.regex(EMAIL_PATTERN))
	),
	to_create_case(s, 'create/object_flat/valid', () =>
		to_object(s)({
			id: s.number,
			name: s.string,
			email: s.string,
			active: s.boolean,
			score: s.optional(s.number),
			role: to_one_of(s)(['member', 'admin', 'owner'])
		})
	),
	// an entity as an app writes one: nested objects, an array, optional and
	// nullable entries, and pipes
	to_create_case(s, 'create/object_nested/valid', () =>
		to_object(s)({
			id: s.pipe(s.number, s.integer, s.min_value(1)),
			slug: s.pipe(s.string, s.max_length(80), s.regex(SLUG_PATTERN)),
			title: s.pipe(s.string, s.min_length(1), s.max_length(200)),
			body: s.string,
			author: to_object(s)({
				id: s.number,
				name: s.string,
				email: s.pipe(s.string, s.regex(EMAIL_PATTERN))
			}),
			tags: s.array(s.string),
			published_at: s.nullable(s.string),
			meta: s.optional(to_object(s)({ views: s.number, likes: s.number }))
		})
	),
	to_create_case(s, 'create/strip_object/valid', () =>
		to_strip_object(s)({
			id: s.number,
			name: s.string,
			email: s.string,
			active: s.boolean,
			score: s.optional(s.number),
			role: to_one_of(s)(['member', 'admin', 'owner'])
		})
	),
	// built on its own, as a baseline may lack `loose_object`
	{
		name: 'create/loose_object/valid',
		build: () =>
			to_create_case(s, 'create/loose_object/valid', () =>
				s.loose_object({
					id: s.number,
					name: s.string,
					email: s.string,
					active: s.boolean,
					score: s.optional(s.number),
					role: to_one_of(s)(['member', 'admin', 'owner'])
				})
			)
	},
	// a tree as an app writes one, an object that holds itself through a `lazy`
	to_create_case(s, 'create/lazy/valid', () => {
		const tree: schema_lib.AnySchema = to_object(s)({
			value: s.string,
			children: s.array(s.lazy(() => tree))
		});
		return tree;
	}),
	// the same of a union that keeps what its options read, the union made as the
	// case is called and not left to a `lazy`'s first parse: built on its own, as
	// a baseline may lack `memo_union`
	{
		name: 'create/memo_union/valid',
		build: () => {
			if (!s.memo_union) throw Error('this version has no `memo_union`');
			return to_create_case(s, 'create/memo_union/valid', () => {
				const node: schema_lib.AnySchema = s.memo_union(
					['a', 'b'].map((op) =>
						to_object(s)({ args: s.array(s.lazy(() => node)), op: s.literal(op) })
					)
				);
				return node;
			});
		}
	},
	// built on its own, as a baseline may lack `keyed_record`
	{
		name: 'create/keyed_record/valid',
		build: () =>
			to_create_case(s, 'create/keyed_record/valid', () =>
				s.keyed_record(s.pipe(s.string, s.regex(/^[a-z]+$/)), s.number)
			)
	},
	to_create_case(s, 'create/union/valid', () =>
		s.union([
			to_object(s)({ type: s.literal('click'), x: s.number, y: s.number }),
			to_object(s)({ type: s.literal('key'), key: s.string }),
			to_object(s)({ type: s.literal('scroll'), dy: s.number })
		])
	),
	to_create_case(s, 'create/variant/valid', () =>
		s.variant('type', [
			to_object(s)({ type: s.literal('click'), x: s.number, y: s.number }),
			to_object(s)({ type: s.literal('key'), key: s.string }),
			to_object(s)({ type: s.literal('scroll'), dy: s.number })
		])
	),
	// the harvested fuz_app schemas, every one, as its modules build them as
	// they load: built on their own, as a baseline may lack a name they use
	{
		name: 'create/fuz_app_specs/valid',
		build: () =>
			to_create_case(s, 'create/fuz_app_specs/valid', () => create_fuz_app(s).CellListOutput)
	}
];

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

// a `pipe` that starts with an `optional`
const to_optional_check = (s: SchemaLib): schema_lib.AnySchema =>
	s.pipe(
		s.optional(s.string),
		s.check((v: string | undefined) => v !== '')
	);

// an object whose one entry is that pipe
const to_optional_checked = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({ a: to_optional_check(s) });

// an object whose one entry is a `pipe` that starts with a `with_default`
const to_default_checked = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({
		a: s.pipe(
			s.with_default(s.string, 'd'),
			s.check((v: string) => v !== '')
		)
	});

// the same with a step that gives `undefined`
const to_default_undefined = (s: SchemaLib): schema_lib.AnySchema =>
	to_object(s)({
		a: s.pipe(
			s.with_default(s.string, 'd'),
			s.transform((v: string) => (v === 'd' ? undefined : v))
		)
	});

// the format tests over a hundred items: a UUID and a date and time each
// taken, and each refused at its last character, so the whole string is
// read, and a date refused for its day, a February 29 of a year not leap
const format_entries = (
	s: SchemaLib,
	of: (
		name: string,
		schema: schema_lib.AnySchema,
		item: unknown,
		path?: Exclude<CasePath, 'probe'>
	) => Case
): Array<CaseBuild> => {
	const entry = (name: string, to: () => Case): CaseBuild => ({ name: `each/${name}`, build: to });
	// a `pipe` given a step this version lacks is made without a throw, so the lack throws here
	const pipe_to = (format: 'uuid' | 'iso_datetime'): schema_lib.AnySchema => {
		const step = s[format];
		if (!step) throw Error(`this version has no \`${format}\``);
		return s.pipe(s.string, step);
	};
	return [
		entry('pipe_uuid/valid', () =>
			of('pipe_uuid/valid', pipe_to('uuid'), '123e4567-e89b-42d3-a456-426614174000')
		),
		entry('pipe_uuid_last_char_bad/invalid', () =>
			of(
				'pipe_uuid_last_char_bad/invalid',
				pipe_to('uuid'),
				'123e4567-e89b-42d3-a456-42661417400g',
				'issues'
			)
		),
		entry('pipe_iso_datetime/valid', () =>
			of('pipe_iso_datetime/valid', pipe_to('iso_datetime'), '2024-02-29T23:59:59.123Z')
		),
		entry('pipe_iso_datetime_last_char_bad/invalid', () =>
			of(
				'pipe_iso_datetime_last_char_bad/invalid',
				pipe_to('iso_datetime'),
				'2024-02-29T23:59:59.123z',
				'issues'
			)
		),
		entry('pipe_iso_datetime_leap_day_bad/invalid', () =>
			of(
				'pipe_iso_datetime_leap_day_bad/invalid',
				pipe_to('iso_datetime'),
				'2023-02-29T23:59:59.123Z',
				'issues'
			)
		),
		entry('pipe_uuid_distinct/valid', () =>
			to_case(
				s,
				'each/pipe_uuid_distinct/valid',
				s.array(pipe_to('uuid')),
				to_json(range(100).map(to_uuid)),
				'identity'
			)
		),
		entry('pipe_iso_datetime_distinct/valid', () =>
			to_case(
				s,
				'each/pipe_iso_datetime_distinct/valid',
				s.array(pipe_to('iso_datetime')),
				to_json(range(100).map(to_datetime)),
				'identity'
			)
		),
		// a lowercase string is given back as it is, and one with an uppercase
		// letter is lowercased, which copies the array
		entry('pipe_to_lower_case/valid', () =>
			of('pipe_to_lower_case/valid', s.pipe(s.string, s.to_lower_case), to_uuid(1))
		),
		entry('pipe_to_lower_case_upper/valid', () =>
			of(
				'pipe_to_lower_case_upper/valid',
				s.pipe(s.string, s.to_lower_case),
				to_uuid(1).toUpperCase(),
				'copy'
			)
		)
	];
};

// `n` hex digits drawn from `seed`, the same on every call
const to_hex = (seed: number, n: number): string => {
	let hex = '';
	for (let i = 0; i < n; i++) hex += (Math.imul(seed + i, 2654435761) >>> 28).toString(16);
	return hex;
};

// a UUID of its own for each `i`, of version 4 or 7 and each variant, as an app's ids are
const to_uuid = (i: number): string => {
	const at = i * 32;
	return `${to_hex(at, 8)}-${to_hex(at + 8, 4)}-${i % 2 ? '7' : '4'}${to_hex(at + 12, 3)}-${'89ab'[i % 4]}${to_hex(at + 15, 3)}-${to_hex(at + 18, 12)}`;
};

// a date and time of its own for each `i`, with a fraction of 3 digits
const to_datetime = (i: number): string => {
	const two = (n: number): string => String(n).padStart(2, '0');
	return `${2000 + (i % 30)}-${two((i % 12) + 1)}-${two((i % 28) + 1)}T${two(i % 24)}:${two((i * 7) % 60)}:${two((i * 13) % 60)}.${String((i * 37) % 1000).padStart(3, '0')}Z`;
};

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
		of('number_fractional/valid', s.number, 3.25),
		of('literal/valid', s.literal('a'), 'a'),
		of('one_of_20_first/valid', to_one_of(s)(range(20)), 0),
		of('one_of_20_last/valid', to_one_of(s)(range(20)), 19),
		of('one_of_5_strings_first/valid', to_one_of(s)(['a', 'b', 'c', 'd', 'e']), 'a'),
		of('one_of_5_strings_last/valid', to_one_of(s)(['a', 'b', 'c', 'd', 'e']), 'e'),
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
		of('pipe_safe_integer/valid', s.pipe(s.number, s.safe_integer), 36),
		// a check of one entry of an object, which finds the entry for its issue:
		// built on its own, as a baseline may lack `check_at`
		{
			name: 'each/pipe_check_at/valid',
			build: () => of('pipe_check_at/valid', to_check_at(s), { a: 1 })
		},
		// neither has a JSON form, so the items are not parsed. A `void` is built
		// on its own, as a baseline may lack it, and an array of what a version
		// lacks is made without a throw
		to_case(s, 'each/bigint/valid', s.array(s.bigint), range(100).map(BigInt), 'identity'),
		{
			name: 'each/void/valid',
			build: () => {
				if (!s.void) throw Error('this version has no `void`');
				return to_case(
					s,
					'each/void/valid',
					s.array(s.void),
					range(100).map(() => undefined),
					'identity'
				);
			}
		},
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
		// an entry that hands the object and the key on, to an `unknown` that
		// looks for the key: the closure of each that takes them, and a `lazy`,
		// which passes on what it is given
		of('entry_nullable_unknown/valid', to_object(s)({ a: s.nullable(s.unknown) }), { a: 1 }),
		of('entry_lazy_unknown/valid', to_object(s)({ a: s.lazy(() => s.unknown) }), { a: 1 }),
		of('entry_union_unknown_last/valid', to_object(s)({ a: s.union([s.string, s.unknown]) }), {
			a: 1
		}),
		of(
			'entry_pipe_unknown_check/valid',
			to_object(s)({
				a: s.pipe(
					s.unknown,
					s.check((v: unknown) => v !== null)
				)
			}),
			{ a: 1 }
		),
		// a `pipe` whose first schema is an `optional`, as an entry: with the key,
		// where its check runs, and without it, where no step after the first does
		of('entry_pipe_optional_check_present/valid', to_optional_checked(s), { a: 'x' }),
		of('entry_pipe_optional_check_absent/valid', to_optional_checked(s), {}),
		// the same under a `message`, which hands the pipe what the loop handed it
		of(
			'entry_message_pipe_optional_present/valid',
			to_object(s)({ a: s.message(to_optional_check(s), 'must not be empty') }),
			{ a: 'x' }
		),
		of(
			'entry_message_pipe_optional_absent/valid',
			to_object(s)({ a: s.message(to_optional_check(s), 'must not be empty') }),
			{}
		),
		// a `pipe` whose first schema is a `with_default`, as an entry: with the
		// key, and without it, where the check runs on the default and the key is
		// written
		of('entry_pipe_default_check_present/valid', to_default_checked(s), { a: 'x' }),
		of('entry_pipe_default_check_absent/valid', to_default_checked(s), {}, 'copy'),
		// the same with a step that gives `undefined` for the default: with the
		// key, and without it, where the steps run on the default and the key
		// stays out
		of('entry_pipe_default_undefined_present/valid', to_default_undefined(s), { a: 'x' }),
		of('entry_pipe_default_undefined_absent/valid', to_default_undefined(s), {}),
		// a `union` whose first option needs its key and whose second lets it be
		// missing, as an entry: without the key, where the second matches, and with
		// it as `undefined`, where the first does. Neither input is parsed, as
		// `JSON.stringify` leaves the second's key out
		to_case(
			s,
			'each/entry_union_unknown_optional_absent/valid',
			s.array(to_object(s)({ a: s.union([s.unknown, s.optional(s.string)]) })),
			range(100).map(() => ({})),
			'identity'
		),
		to_case(
			s,
			'each/entry_union_unknown_optional_undefined/valid',
			s.array(to_object(s)({ a: s.union([s.unknown, s.optional(s.string)]) })),
			range(100).map(() => ({ a: undefined })),
			'identity'
		),
		// a `lazy` over an object, as an entry: the object's loop, called with the
		// object and the key the `lazy` passes on, which it doesn't read
		of(
			'entry_lazy_object/valid',
			to_object(s)({ a: s.lazy(() => to_object(s)({ b: s.string })) }),
			{ a: { b: 'x' } }
		),
		// an entry that looks for its key itself, as the closure of each that does:
		// a `literal` of `undefined`, and a `one_of` with `undefined` among its
		// values. `JSON.stringify` leaves a key that is `undefined` out, so the
		// first is not parsed
		to_case(
			s,
			'each/entry_literal_undefined/valid',
			s.array(to_object(s)({ a: s.literal(undefined) })),
			range(100).map(() => ({ a: undefined })),
			'identity'
		),
		of(
			'entry_one_of_undefined_present/valid',
			to_object(s)({ a: to_one_of(s)(['x', undefined]) }),
			{ a: 'x' }
		),
		// the format tests, each scanning the whole string, built on their own as
		// a baseline may not have them
		...format_entries(s, of),
		// a hundred issues, each with an index for its path
		of('string/invalid', s.string, 42, 'issues'),
		of('message/invalid', s.message(s.string, 'must be text'), 42, 'issues'),
		of('literal/invalid', s.literal('a'), 'b', 'issues'),
		of('pipe_string_first_action_bad/invalid', Name, '', 'issues'),
		of('pipe_string_last_action_bad/invalid', Name, 'Ada', 'issues'),
		of('union_3_primitives/invalid', primitives, null, 'issues'),
		of('variant_10_unknown_kind/invalid', Shape, { kind: 'zz', value: 1 }, 'issues'),
		// the option is found and one of its entries fails
		of('variant_10_entry_bad/invalid', Shape, { kind: 'k9', value: 'x' }, 'issues'),
		// the check fails, and its issue is at the entry it names
		{
			name: 'each/pipe_check_at_bad/invalid',
			build: () => of('pipe_check_at_bad/invalid', to_check_at(s), { a: 0 }, 'issues')
		}
	];
};

// an object whose one entry `check_at` checks, made only by a version that has it
const to_check_at = (s: SchemaLib): schema_lib.AnySchema => {
	if (!s.check_at) throw Error('this version has no `check_at`');
	return s.pipe(
		to_object(s)({ a: s.number }),
		s.check_at('a', (v: { a: number }) => v.a > 0)
	);
};

// a case through `parse` of an input that fails, each of its issues formatted,
// cycling through the copies it is given
const to_formatting_case = (
	s: SchemaLib,
	name: string,
	schema: schema_lib.AnySchema,
	inputs: Array<unknown>,
	format: (issue: schema_lib.SchemaIssue, input: unknown) => string
): Case => {
	const mask = inputs.length - 1;
	let at = 0;
	return {
		name,
		group: to_group(name),
		realistic: false,
		path: 'issues',
		valid: false,
		inputs,
		run: () => {
			const input = inputs[(at = (at + 1) & mask)];
			const result = to_parse(s)(schema, input);
			if (result.ok) return result.value;
			// the length of the text, so what the loop is given is of the formatting
			let length = 0;
			for (const issue of result.issues) length += format(issue, input).length;
			return length;
		},
		given: () => inputs[at],
		ok: () => to_parse(s)(schema, inputs[0]).ok
	};
};

// `object`, and with it everything it shares with `strip_object`
const object: CaseGroup = (s) => {
	const O = to_object(s)(to_six(s.string));
	const input = to_six('v');
	// the copies the thrown case cycles through, as `to_case`'s do
	const all_bad = to_input_copies(to_six(1));
	const mask = all_bad.length - 1;
	let at = 0;
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
		// the same at width, and with the absent key in the middle, and with three of
		// them spread out, so the keys after each come one place early
		to_case(
			s,
			'object/21_keys_first_optional_absent/valid',
			to_object(s)({ first: s.optional(s.string), ...to_entries(20, s.string) }),
			to_record(20),
			'identity'
		),
		to_case(
			s,
			'object/21_keys_mid_optional_absent/valid',
			to_object(s)({
				...to_entries(10, s.string),
				mid: s.optional(s.string),
				...Object.fromEntries(range(10).map((i) => [`k${i + 10}`, s.string]))
			}),
			to_record(20),
			'identity'
		),
		to_case(
			s,
			'object/23_keys_3_optional_absent/valid',
			to_object(s)({
				a: s.optional(s.string),
				...to_entries(7, s.string),
				b: s.optional(s.string),
				...Object.fromEntries(range(7).map((i) => [`k${i + 7}`, s.string])),
				c: s.optional(s.string),
				...Object.fromEntries(range(6).map((i) => [`k${i + 14}`, s.string]))
			}),
			to_record(20),
			'identity'
		),
		// out of the schema's order: wide and reversed, rotated, and swapped in pairs
		to_case(
			s,
			'object/21_keys_reversed/valid',
			to_object(s)(to_entries(21, s.string)),
			to_json(Object.fromEntries(Object.entries(to_record(21)).reverse())),
			'identity'
		),
		to_case(s, 'object/6_keys_rotated/valid', O, to_rotated(input, 3), 'identity'),
		to_case(
			s,
			'object/20_keys_pairs_swapped/valid',
			to_object(s)(to_entries(20, s.string)),
			to_json(Object.fromEntries(range(20).map((i) => [`k${i ^ 1}`, 'v']))),
			'identity'
		),
		// an unknown key after each the schema names
		to_case(
			s,
			'object/20_keys_unknown_interleaved/invalid',
			to_object(s)(to_entries(20, s.string)),
			to_json(
				Object.fromEntries(
					range(20).flatMap((i) => [
						[`k${i}`, 'v'],
						[`z${i}`, 'v']
					])
				)
			),
			'issues'
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
		// the same with each default made by a function, an array as it is for:
		// a version without `with_default_fn` goes without the case
		...('with_default_fn' in s
			? [
					to_case(
						s,
						'object/6_default_fns_absent/valid',
						to_object(s)(to_six(s.with_default_fn(s.array(s.string), () => []))),
						{},
						'copy'
					)
				]
			: []),
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
		// the same failure with each issue formatted, alone and with the value it is of
		to_formatting_case(s, 'object/6_keys_all_bad_format_issue/invalid', O, all_bad, (issue) =>
			s.format_issue(issue)
		),
		{
			name: 'object/6_keys_all_bad_format_issue_with_value/invalid',
			build: () => {
				if (!s.format_issue_with_value)
					throw Error('this version has no `format_issue_with_value`');
				return to_formatting_case(
					s,
					'object/6_keys_all_bad_format_issue_with_value/invalid',
					O,
					all_bad,
					s.format_issue_with_value
				);
			}
		},
		// the same failure thrown, its issues formatted into the error's message
		{
			name: 'object/6_keys_all_bad_throw/invalid',
			group: 'object',
			realistic: false,
			path: 'issues',
			valid: false,
			inputs: all_bad,
			run: () => {
				try {
					return to_parse_or_throw(s)(O, all_bad[(at = (at + 1) & mask)]);
				} catch {
					return undefined;
				}
			},
			given: () => all_bad[at],
			ok: () => to_parse(s)(O, all_bad[0]).ok
		},
		to_probe_case(s, 'object/6_keys_is/valid', O, to_json(input), true),
		to_probe_case(s, 'object/6_keys_last_bad_is/invalid', O, to_json({ ...input, k5: 1 }), false)
	];
};

// `strip_object` where it differs from `object`, which is with keys to drop,
// beside inputs with none
const strip: CaseGroup = (s) => {
	const O = to_strip_object(s)(to_six(s.string));
	const Account = create_account(s);
	const input = to_six('v');
	const to_option = (type: string): schema_lib.AnySchema =>
		to_strip_object(s)({ type: s.literal(type), id: s.number, name: s.string, note: s.string });
	const Shapes = s.union([to_option('a'), to_option('b'), to_option('c')]);
	const to_shape = (type: string): Record<string, unknown> => ({
		type,
		id: 1,
		name: 'v',
		note: 'v'
	});
	return [
		to_case(s, 'strip/6_of_6_keys/valid', O, to_json(input), 'identity'),
		// the input's keys in another order than the schema's, and after an optional
		// key it lacks, so that none comes where the schema has it
		to_case(
			s,
			'strip/6_of_6_keys_reversed/valid',
			O,
			to_json(Object.fromEntries(Object.entries(input).reverse())),
			'identity'
		),
		to_case(
			s,
			'strip/6_of_7_keys_first_optional_absent/valid',
			to_strip_object(s)({ first: s.optional(s.string), ...to_six(s.string) }),
			to_json(input),
			'identity'
		),
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
		// an entry that changes and no key to drop: the copy is made, and no key looked for
		to_case(
			s,
			'strip/7_of_7_keys_last_defaulted/valid',
			to_strip_object(s)({ ...to_six(s.string), last: s.with_default(s.string, 'd') }),
			to_json(input),
			'copy'
		),
		// a failure's output is unused, so the keys to drop are never looked for
		to_case(
			s,
			'strip/6_of_7_keys_first_bad/invalid',
			O,
			to_json({ ...input, k0: 1, z: 1 }),
			'issues'
		),
		// and a failure with no key to drop
		to_case(s, 'strip/6_keys_first_bad/invalid', O, to_json({ ...input, k0: 1 }), 'issues'),
		// through `is`, which returns at the entry that fails: with no key to drop,
		// and with one ahead of that entry
		to_probe_case(s, 'strip/6_keys_first_bad_is/invalid', O, to_json({ ...input, k0: 1 }), false),
		to_probe_case(
			s,
			'strip/6_of_7_keys_first_bad_is/invalid',
			O,
			to_json({ z: 1, ...input, k0: 1 }),
			false
		),
		// a key to drop at each of two levels
		to_case(
			s,
			'strip/nested_unknown_at_each_level/valid',
			to_strip_object(s)({
				a: s.string,
				inner: to_strip_object(s)({ b: s.string, c: s.string }),
				d: s.string
			}),
			to_json({ a: 'v', y: 1, inner: { b: 'v', c: 'v', z: 1 }, d: 'v' }),
			'copy'
		),
		// a `union` of objects told apart by their first entry, which probes each
		// until one matches: the first, and the last after the others have missed
		to_case(s, 'strip/union_3_first/valid', Shapes, to_json(to_shape('a')), 'identity'),
		to_case(s, 'strip/union_3_last/valid', Shapes, to_json(to_shape('c')), 'identity'),
		// and with a key to drop, which every option that misses is handed too: after
		// the keys the options name, and ahead of them
		to_case(
			s,
			'strip/union_3_first_unknown_last/valid',
			Shapes,
			to_json({ ...to_shape('a'), z: 1 }),
			'copy'
		),
		to_case(
			s,
			'strip/union_3_last_unknown_last/valid',
			Shapes,
			to_json({ ...to_shape('c'), z: 1 }),
			'copy'
		),
		to_case(
			s,
			'strip/union_3_last_unknown_first/valid',
			Shapes,
			to_json({ z: 1, ...to_shape('c') }),
			'copy'
		),
		// the response of `real/accounts_100` with fields to drop, alone and as a
		// list, kept out of the realistic cases speed is judged on
		to_case(s, 'strip/account_extra_fields/valid', Account, to_json(to_account_extra(1)), 'copy'),
		to_case(
			s,
			'strip/accounts_100_extra_fields/valid',
			s.array(Account),
			to_json(range(100).map(to_account_extra)),
			'copy'
		)
	];
};

// `loose_object`, which has a loop of its own
const loose: CaseGroup = (s) => {
	const O = s.loose_object(to_six(s.string));
	const Last = s.loose_object({ ...to_six(s.string), k5: s.with_default(s.string, 'd') });
	const input = to_six('v');
	const { k5: _k5, ...wide } = to_record(20);
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
		// the last entry changes, so a copy rereads the five before it
		to_case(s, 'loose/6_keys_last_default_absent/valid', Last, to_record(5), 'copy'),
		// and in a wide input, where a copy also carries every unknown key across
		to_case(s, 'loose/6_keys_last_default_absent_14_unknown/valid', Last, to_json(wide), 'copy'),
		to_case(s, 'loose/6_keys_first_bad/invalid', O, to_json({ ...input, k0: 1 }), 'issues')
	];
};

// `object_with_rest`, which validates the keys the schema doesn't name in a
// loop of its own. A version without it goes without the group
const rest: CaseGroup = (s) => {
	const O = s.object_with_rest(to_six(s.string), s.string);
	const Defaulted = s.object_with_rest(to_six(s.with_default(s.string, 'd')), s.number);
	const Upper = s.object_with_rest(
		to_six(s.string),
		s.pipe(
			s.string,
			s.transform((v: string) => v.toUpperCase())
		)
	);
	const input = to_six('v');
	const bad_last = { ...to_record(20), k19: 1 };
	return [
		// no other key, so only the entries and the one pass over the input's keys
		to_case(s, 'rest/6_keys/valid', O, to_json(input), 'identity'),
		// every other key validated, and the input still comes back
		to_case(s, 'rest/6_of_20_keys/valid', O, to_record(20), 'identity'),
		// an entry changes, so the copy carries every other key across
		to_case(
			s,
			'rest/6_defaults_absent_3_rest/valid',
			Defaulted,
			to_json({ x: 1, y: 2, z: 3 }),
			'copy'
		),
		// the first other key changes, so the copy is begun there
		to_case(s, 'rest/6_of_20_keys_rest_changes/valid', Upper, to_record(20), 'copy'),
		to_case(s, 'rest/6_of_20_keys_last_bad/invalid', O, to_json(bad_last), 'issues'),
		to_probe_case(s, 'rest/6_of_20_keys_is/valid', O, to_record(20), true),
		to_probe_case(s, 'rest/6_of_20_keys_last_bad_is/invalid', O, to_json(bad_last), false)
	];
};

// a recursive `memo_union` as `program.ts` builds one: a node is an op and its
// args, each a node, and its options are told apart by the op, after the args.
// A `lazy` reads its schema only when it parses, so a version without
// `memo_union` throws here and not at its first parse
const create_memo_tree = (s: SchemaLib): schema_lib.AnySchema => {
	if (!s.memo_union) throw Error('this version has no `memo_union`');
	const node: schema_lib.AnySchema = s.lazy(() =>
		s.memo_union(['a', 'b'].map((op) => to_object(s)({ args: s.array(node), op: s.literal(op) })))
	);
	return node;
};

// a node of a tree whose every level holds the one below twice, the same object
// both times, as a parse of an expression with a shared subterm gives one
interface SharedNode {
	args: Array<SharedNode>;
	op: string;
}
const to_shared_tree = (depth: number): SharedNode => {
	let node: SharedNode = { args: [], op: 'b' };
	for (let i = 0; i < depth; i++) node = { args: [node, node], op: 'b' };
	return node;
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
		),
		// a recursive `memo_union` whose second option is the one that matches, over
		// a tree that reuses its nodes: the first option walks a node's args before
		// it misses at its op, and the second reads what the first kept of them.
		// Built on its own: a version without `memo_union` goes without the case
		{
			name: 'nested/memo_union_shared_depth_10/valid',
			build: () =>
				to_case(
					s,
					'nested/memo_union_shared_depth_10/valid',
					create_memo_tree(s),
					undefined,
					'identity',
					// each copy built apart from the others, as `to_input_copies` makes
					// them, so no copy shares a node with another, and each keeps the
					// nodes its own tree shares. Not through `to_input_copies`: its JSON
					// text writes a shared node out at every place that holds it, so a
					// copy from it would share nothing, and the text's length would cut
					// the copies to two where the tree is a few objects
					Array.from({ length: INPUT_COPIES_MAX }, () => to_shared_tree(10))
				)
		}
	];
};

// `array` itself, its items being the cheapest there are
const array: CaseGroup = (s) => {
	const Defaulted = s.array(s.with_default(s.number, 0));
	return [
		// one change in a large value: the whole is copied once, wherever the change is
		to_case(s, 'array/100_first_defaulted/valid', Defaulted, [undefined, ...range(99)], 'copy'),
		to_case(s, 'array/100_last_defaulted/valid', Defaulted, [...range(99), undefined], 'copy'),
		// no item changed, though none is `===` itself
		to_case(
			s,
			'array/100_nan/valid',
			s.array(s.unknown),
			range(100).map(() => NaN),
			'identity'
		),
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

// a record whose keys are checked: a group of its own, as a baseline may lack
// `keyed_record`. Its keys are run through a schema of their own, the rest is
// `record`'s: every key that gives itself, a key that gives another, which
// begins a copy, a value refused under a key that isn't, and a key refused
const keyed_record: CaseGroup = (s) => {
	const Key = s.pipe(s.string, s.regex(/^[a-z][a-z0-9]*$/));
	const Lower = s.pipe(s.string, s.to_lower_case);
	return [
		to_case(s, 'keyed/20_keys/valid', s.keyed_record(Key, s.string), to_record(20), 'identity'),
		// `to_lower_case` makes a string of every key, which gives itself by `===`
		to_case(
			s,
			'keyed/20_keys_lowercase/valid',
			s.keyed_record(Lower, s.string),
			to_record(20),
			'identity'
		),
		to_case(
			s,
			'keyed/20_keys_last_renamed/valid',
			s.keyed_record(Lower, s.string),
			to_json({ ...to_record(19), Z: 'v' }),
			'copy'
		),
		to_case(
			s,
			'keyed/20_keys_last_value_bad/invalid',
			s.keyed_record(Key, s.string),
			to_json({ ...to_record(19), z: 1 }),
			'issues'
		),
		to_case(
			s,
			'keyed/20_keys_last_key_bad/invalid',
			s.keyed_record(Key, s.string),
			to_json({ ...to_record(19), Z: 'v' }),
			'issues'
		)
	];
};

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
		// a wide `strip_object` with one key to drop, after the keys it keeps and
		// ahead of them, and with nothing to drop, the identity they are read against
		to_case(
			s,
			'scale/strip_20_of_20_keys/valid',
			to_strip_object(s)(to_entries(20, s.string)),
			to_record(20),
			'identity'
		),
		to_case(
			s,
			'scale/strip_20_of_21_keys_unknown_last/valid',
			to_strip_object(s)(to_entries(20, s.string)),
			to_json({ ...to_record(20), z: 1 }),
			'copy'
		),
		to_case(
			s,
			'scale/strip_20_of_21_keys_unknown_first/valid',
			to_strip_object(s)(to_entries(20, s.string)),
			to_json({ z: 1, ...to_record(20) }),
			'copy'
		),
		// a copy of a wide `strip_object` begun at its last key, with no key to drop
		// and with one
		to_case(
			s,
			'scale/strip_21_of_21_keys_last_defaulted/valid',
			to_strip_object(s)({ ...to_entries(20, s.string), last: s.with_default(s.string, 'd') }),
			to_record(20),
			'copy'
		),
		to_case(
			s,
			'scale/strip_21_of_22_keys_last_defaulted/valid',
			to_strip_object(s)({ ...to_entries(20, s.string), last: s.with_default(s.string, 'd') }),
			to_json({ ...to_record(20), z: 1 }),
			'copy'
		),
		// the same wide schemas given the key their default is for, so nothing is copied
		to_case(
			s,
			'scale/object_21_keys_last_default_present/valid',
			to_object(s)({ ...to_entries(20, s.string), last: s.with_default(s.string, 'd') }),
			to_json({ ...to_record(20), last: 'v' }),
			'identity'
		),
		to_case(
			s,
			'scale/strip_21_of_21_keys_last_default_present/valid',
			to_strip_object(s)({ ...to_entries(20, s.string), last: s.with_default(s.string, 'd') }),
			to_json({ ...to_record(20), last: 'v' }),
			'identity'
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
		// a hundred issues at the bottom, each path prefixed at every level
		to_case(
			s,
			'scale/nested_depth_64_100_bad/invalid',
			((): schema_lib.AnySchema => {
				const to_spine = (depth: number): schema_lib.AnySchema =>
					depth === 0 ? s.array(s.number) : to_object(s)({ next: to_spine(depth - 1) });
				return to_spine(64);
			})(),
			to_json(
				((): unknown => {
					let value: unknown = range(100).map(String);
					for (let i = 0; i < 64; i++) value = { next: value };
					return value;
				})()
			),
			'issues'
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
	real_fuz_app,
	fixed,
	each,
	object,
	strip,
	loose,
	rest,
	nested,
	array,
	record,
	keyed_record,
	scale,
	create
];

/**
 * The `create` group, which `grade` builds through an instance of the library
 * of its own, see `grade_arm.ts`.
 */
export const CREATE_GROUP: CaseGroup = create;

// a group or a case that throws while it builds, as the error a strict build fails with
const to_build_error = (what: string, cause: unknown): Error =>
	new Error(`${what} did not build: ` + (cause instanceof Error ? cause.message : String(cause)), {
		cause
	});

// a group's entries, or none when it throws and the build is not strict
const to_entries_of = (s: SchemaLib, group: CaseGroup, strict: boolean): Array<CaseEntry> => {
	try {
		return group(s);
	} catch (error) {
		if (strict) throw to_build_error(`the \`${group.name}\` group of cases`, error);
		return [];
	}
};

// an entry as its case, or none when it is built on its own, throws, and the build is not strict
const to_built = (entry: CaseEntry, strict: boolean): Case | undefined => {
	if (!is_case_build(entry)) return entry;
	let built: Case;
	try {
		built = entry.build();
	} catch (error) {
		if (strict) throw to_build_error(`the case \`${entry.name}\``, error);
		return undefined;
	}
	if (built.name !== entry.name) {
		throw new Error(`the case built as \`${entry.name}\` is named \`${built.name}\``);
	}
	return built;
};

/**
 * Builds every case the given library version supports.
 *
 * @param strict - whether a group or a case built on its own that throws while it builds fails the whole, where otherwise the version loses that group's cases, or that one case. For a version that is to have every case, as the one a grade is of.
 * @param groups - the groups to build, every one by default
 * @throws Error when `strict` and a group or a case throws, naming it
 */
export const create_cases = (
	s: SchemaLib,
	strict = false,
	groups: ReadonlyArray<CaseGroup> = CASE_GROUPS
): Array<Case> =>
	groups.flatMap((group) =>
		to_entries_of(s, group, strict).flatMap((entry) => to_built(entry, strict) ?? [])
	);

/**
 * Builds the one named case, a group at a time, stopping at the group that has
 * it. For a process that is to run one case and nothing else: the group that
 * parses a document while it builds is tried last, so that no other group's
 * case has a parse ahead of its own.
 *
 * @param strict - whether a group that throws while it builds fails the whole, as in `create_cases`, and the case itself when it is built on its own
 * @param groups - the groups to look in, every one by default
 * @returns the case, or `undefined` when the given library version has none of that name or can't build it
 * @throws Error when `strict` and a group built on the way throws, or the case, naming it
 */
export const create_case = (
	s: SchemaLib,
	name: string,
	strict = false,
	groups: ReadonlyArray<CaseGroup> = CASE_GROUPS
): Case | undefined => {
	const ordered = groups.includes(real_docinfo)
		? [...groups.filter((g) => g !== real_docinfo), real_docinfo]
		: groups;
	for (const group of ordered) {
		const found = to_entries_of(s, group, strict).find((entry) => entry.name === name);
		if (found) return to_built(found, strict);
	}
	return undefined;
};
