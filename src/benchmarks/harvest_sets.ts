/**
 * The harvested sets as `harvest.ts` compares them: each set's reference
 * library, its root schema, its rows, and what to say under its tables,
 * declared once in `HARVEST_SETS`.
 *
 * `load_rows` is what a process that `timing_child.ts` is loads one side of a
 * set through. A side is one column: a mode of the reference library, this
 * library, or the set's asides. The process loads the set whole, so both
 * schema modules are built in it and this library prepares the inputs that are
 * its own output, and from then on it runs its side's rows and no other's.
 * The reference library is imported by the sets that use it, so a process of a
 * valibot set holds no zod and one of a zod set no valibot.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import type * as v from 'valibot';
import type { z } from 'zod';

import * as s from '#lib/schema.ts';
import type { LoadTimingRows, TimingRow } from './timing_job.ts';

const to_json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

//
// What a set declares
//

export interface HarvestRow {
	name: string;
	valid: boolean;
	/** The reference library's parse, once for each of its modes, in their order. */
	theirs: Array<() => unknown>;
	ours: () => unknown;
}

/** A check that is a rewrite's own code and no library's, timed alone. */
export interface HarvestAside {
	name: string;
	run: () => unknown;
}

export interface LoadedSet {
	rows: Array<HarvestRow>;
	asides?: Array<HarvestAside>;
}

export interface HarvestReference {
	name: string;
	/** A column for each way the library is run. */
	modes: Array<string>;
	/** The body of a module that exports `run`, which parses a value with `root` imported from `path`. */
	to_entry: (root: string, path: string) => string;
	/** Said under the bundle table. */
	bundle_note?: string;
	/**
	 * Runs `run_rows`, which calls every row of the mode at `mode` once and is
	 * the first thing to, and throws when the mode is not what its column says.
	 */
	assert_mode?: (mode: number, run_rows: () => void) => void;
	/** Said under every set of this library's, before the set's own notes. */
	notes: Array<string>;
}

export interface HarvestSet {
	/** Its directory, and what its two schema modules are named by. */
	name: string;
	title: string;
	reference: HarvestReference;
	/** The schema the bundles parse with, exported by the consumer's module and returned by the port's factory. */
	root: string;
	/** Its schemas and data are loaded here and not by this module, so a process of one set holds no other's. */
	load: () => Promise<LoadedSet>;
	notes: Array<string>;
}

const read_set_json = (path: string): any =>
	JSON.parse(readFileSync(new URL(`./${path}`, import.meta.url), 'utf8'));

interface HarvestedDocument {
	name: string;
	value: unknown;
}

const to_document = (documents: Array<HarvestedDocument>, name: string): unknown => {
	const found = documents.find((d) => d.name === name);
	if (!found) throw new Error(`no document ${name}`);
	return found.value;
};

const to_ours = (schema: s.AnySchema, input: unknown) => (): unknown => {
	const result = s.parse(schema, input);
	return result.ok ? result.value : undefined;
};

//
// The reference libraries
//

const VALIBOT: HarvestReference = {
	name: 'valibot',
	modes: ['valibot'],
	to_entry: (root, path) =>
		`import { safeParse } from 'valibot';
import { ${root} } from ${JSON.stringify(path)};
export const run = (value) => safeParse(${root}, value);`,
	notes: []
};

// zod's parse context for its interpreter, one object for every parse
const ZOD_JITLESS = { jitless: true };

// Calls `fn` and returns how many functions were compiled from text meanwhile.
const count_compiled = (fn: () => void): number => {
	const original = globalThis.Function;
	let count = 0;
	globalThis.Function = new Proxy(original, {
		construct: (target, args) => {
			count++;
			return Reflect.construct(target, args);
		}
	});
	try {
		fn();
	} finally {
		globalThis.Function = original;
	}
	return count;
};

const ZOD: HarvestReference = {
	name: 'zod',
	modes: ['zod', 'zod jitless'],
	to_entry: (root, path) =>
		`import { ${root} } from ${JSON.stringify(path)};
export const run = (value) => ${root}.safeParse(value);`,
	bundle_note:
		"zod's is the consumer's module as it is written, on classic `zod` and not `zod/mini`",
	// An object schema decides when it is made whether it may compile, compiles
	// on its first parse that doesn't ask otherwise, and keeps its interpreter
	// for one that does. A process runs one of the two, so its schemas have
	// compiled nothing when its rows first run: the interpreter must then compile
	// nothing, and the other mode something.
	assert_mode: (mode, run_rows) => {
		const compiled = count_compiled(run_rows);
		if (mode === 1 && compiled) {
			throw new Error(`zod compiled ${compiled} functions when asked not to`);
		}
		if (mode === 0 && !compiled) {
			throw new Error('zod compiled nothing: its `zod` column would be `zod jitless`');
		}
	},
	notes: [
		'zod compiles a parser for each object schema with `new Function`, on its first parse, where\n' +
			'the environment lets it. `zod jitless` is its interpreter, which is all it has under\n' +
			'`z.config({jitless: true})` or a content security policy that refuses eval. It is asked for\n' +
			'here a parse at a time, `safeParse(value, {jitless: true})`, on the same schemas, in a process\n' +
			'of its own, which has checked that those parses compiled nothing, as the process of the\n' +
			'other column has that its parses compiled some.',
		'zod has no guard: its side of a guard row is `safeParse` read for `success`.'
	]
};

const to_valibot_row = (
	valibot: typeof v,
	name: string,
	theirs: v.GenericSchema,
	ours: s.AnySchema,
	input: unknown,
	valid = true
): HarvestRow => ({
	name,
	valid,
	theirs: [
		() => {
			const result = valibot.safeParse(theirs, input);
			return result.success ? result.output : undefined;
		}
	],
	ours: to_ours(ours, input)
});

const to_zod_row = (
	name: string,
	theirs: z.ZodType,
	ours: s.AnySchema,
	input: unknown,
	valid = true
): HarvestRow => ({
	name,
	valid,
	theirs: [
		() => {
			const result = theirs.safeParse(input);
			return result.success ? result.data : undefined;
		},
		() => {
			const result = theirs.safeParse(input, ZOD_JITLESS);
			return result.success ? result.data : undefined;
		}
	],
	ours: to_ours(ours, input)
});

const to_zod_guard_row = (
	name: string,
	theirs: z.ZodType,
	ours: s.AnySchema,
	input: unknown
): HarvestRow => ({
	name,
	valid: true,
	theirs: [
		() => (theirs.safeParse(input).success ? input : undefined),
		() => (theirs.safeParse(input, ZOD_JITLESS).success ? input : undefined)
	],
	ours: () => (s.is(ours, input) ? input : undefined)
});

//
// The sets
//

export const HARVEST_SETS: Array<HarvestSet> = [
	{
		name: 'docinfo',
		title: "svelte-docinfo's analysis output, in valibot and in this library",
		reference: VALIBOT,
		root: 'ModuleJson',
		// The data is its analysis of a whole library, stored as it writes it, with
		// the fields that have their defaults left out, so a parse fills them in.
		// `full` rows are the same data with every default in place.
		load: async (): Promise<LoadedSet> => {
			const valibot = await import('valibot');
			const theirs = await import('./docinfo/docinfo_valibot.ts');
			const { create_docinfo } = await import('./docinfo/docinfo_fuz_schema.ts');
			const ours = create_docinfo(s);
			const modules: Array<Record<string, unknown>> = read_set_json(
				'docinfo/docinfo_fuz_ui.json'
			).modules;
			const to_module = (path: string): Record<string, unknown> => {
				const found = modules.find((m) => m.path === path);
				if (!found) throw new Error(`no module ${path}`);
				return found;
			};
			const their_modules = valibot.array(theirs.ModuleJson);
			const our_modules = s.array(ours.ModuleJson);
			const full = to_json(s.parse_or_throw(our_modules, modules));
			const broken = to_json(modules) as any;
			broken.at(-1).declarations.at(-1).name = 1;
			const to_row = (
				name: string,
				their_schema: v.GenericSchema,
				our_schema: s.AnySchema,
				input: unknown,
				valid = true
			): HarvestRow => to_valibot_row(valibot, name, their_schema, our_schema, input, valid);
			return {
				rows: [
					to_row('a component', theirs.ModuleJson, ours.ModuleJson, to_module('Dialog.svelte')),
					to_row(
						'a component, full',
						theirs.ModuleJson,
						ours.ModuleJson,
						to_json(s.parse_or_throw(ours.ModuleJson, to_module('Dialog.svelte')))
					),
					to_row('a class', theirs.ModuleJson, ours.ModuleJson, to_module('declaration.svelte.ts')),
					to_row('the library', their_modules, our_modules, modules),
					to_row('the library, full', their_modules, our_modules, full),
					to_row('the library, last name bad', their_modules, our_modules, broken, false),
					{
						name: 'the library, full, as a guard',
						valid: true,
						theirs: [() => (valibot.is(their_modules, full) ? full : undefined)],
						ours: () => (s.is(our_modules, full) ? full : undefined)
					}
				]
			};
		},
		notes: [
			'valibot returns a fresh copy of everything; this library returns its input where nothing\n' +
				'changed, which is all of a `full` row: those compare a copy with a check.'
		]
	},
	{
		name: 'repos_status',
		title: "fuz_repos's status report, in zod and in this library",
		reference: ZOD,
		root: 'ReposStatusDocument',
		load: async (): Promise<LoadedSet> => {
			const theirs = (await import('./repos_status/repos_status_zod.ts')).ReposStatusDocument;
			const { create_repos_status } = await import('./repos_status/repos_status_fuz_schema.ts');
			const ours = create_repos_status(s).ReposStatusDocument;
			const documents: Array<HarvestedDocument> = read_set_json(
				'repos_status/repos_status_documents.json'
			).documents;
			const report = to_document(documents, 'status_report');
			// a report from a newer tool than the schema mirrors: its last entry's
			// presence is of a kind the mirror doesn't have, which the union's first
			// option finds only after the rest of the document has matched
			const drifted = to_json(report) as any;
			drifted.entries.at(-1).presence = { kind: 'not_yet_known' };
			return {
				rows: [
					to_zod_row('a report', theirs, ours, report),
					to_zod_row(
						'a report of one repo',
						theirs,
						ours,
						to_document(documents, 'status_report_targeted')
					),
					// the union's second option, after its first has missed
					to_zod_row(
						'an error',
						theirs,
						ours,
						to_document(documents, 'error_report_registry_invalid')
					),
					to_zod_row('a report, last presence unknown', theirs, ours, drifted, false),
					to_zod_guard_row('a report, as a guard', theirs, ours, report)
				]
			};
		},
		notes: [
			'zod returns a fresh copy of every object and array; this library returns its input where\n' +
				'nothing changed. No schema of this set has a default or a transform, so that is every\n' +
				'matching row: each compares a copy with a check. Every object is strict, so no copy is\n' +
				'without a key the input had.',
			'The data is the test goldens of the consumer, which it never reads as one collection, so\n' +
				'there is no row for all of them.'
		]
	},
	{
		name: 'package_json',
		title: "fuz_util's `package.json`, in zod and in this library",
		reference: ZOD,
		root: 'PackageJson',
		load: async (): Promise<LoadedSet> => {
			const theirs = (await import('./package_json/package_json_zod.ts')).PackageJson;
			const { create_package_json } = await import('./package_json/package_json_fuz_schema.ts');
			const ours = create_package_json(s).PackageJson;
			const manifests: Array<HarvestedDocument> = read_set_json(
				'package_json/package_json_manifests.json'
			).manifests;
			// a manifest as published has its version in its name here, and no `glyph`
			const is_published = (document: HarvestedDocument): boolean =>
				document.name.lastIndexOf('@') > 0;
			const published = manifests
				.filter((d) => is_published(d) && s.is(ours, d.value))
				.map((d) => d.value);
			const ecosystem = manifests.filter((d) => !is_published(d)).map((d) => d.value);
			const published_one = to_document(manifests, 'svelte@5.57.2') as Record<string, unknown>;
			const ecosystem_one = to_document(manifests, '@fuzdev/fuz_ui') as Record<string, unknown>;
			if ('glyph' in published_one || typeof ecosystem_one.glyph !== 'string') {
				throw new Error('the manifests no longer differ in having a `glyph`');
			}
			// the same with nothing of the consumer's to segment
			const { glyph: _, ...ecosystem_one_bare } = ecosystem_one;
			// what the schemas read as a URL in the published one
			const urls = [
				published_one.homepage,
				(published_one.repository as any)?.url,
				(published_one.bugs as any)?.url
			];
			if (!urls.every((url) => typeof url === 'string')) {
				throw new Error('the published manifest no longer has the URLs timed alone');
			}
			const { z } = await import('zod');
			const their_manifests = z.array(theirs);
			const our_manifests = s.array(ours);
			return {
				rows: [
					to_zod_row('published, one', theirs, ours, published_one),
					to_zod_row('published, all that match', their_manifests, our_manifests, published),
					// `sideEffects` is `false`, and the schema takes an array
					to_zod_row(
						'published, one refused',
						theirs,
						ours,
						to_document(manifests, 'vitest@5.0.0'),
						false
					),
					to_zod_guard_row('published, one, as a guard', theirs, ours, published_one),
					to_zod_row('ecosystem, one', theirs, ours, ecosystem_one),
					to_zod_row('ecosystem, one, no glyph', theirs, ours, to_json(ecosystem_one_bare)),
					to_zod_row('ecosystem, all', their_manifests, our_manifests, ecosystem)
				],
				asides: [
					{
						// as the port writes it, where zod has `z.url()`
						name: "the URL checks of 'published, one', as the rewrite writes them",
						run: () => {
							let checked = 0;
							for (const url of urls) {
								const trimmed = url.trim();
								if (URL.canParse(trimmed)) checked += trimmed.replace(/[\t\n\r]/g, '').length;
							}
							return checked;
						}
					}
				]
			};
		},
		notes: [
			'Not all of a parse here is a library. Nearly every `ecosystem` manifest has a `glyph`, which\n' +
				'the consumer checks by segmenting it with a new `Intl.Segmenter`, the same code in both\n' +
				'schema modules: the row with the `glyph` taken out shows what that is of a parse. No\n' +
				'`published` manifest has one, so those rows compare the libraries more nearly. And a URL\n' +
				'is checked by `z.url()` in zod and, in the rewrite, by code of its own around\n' +
				'`URL.canParse`, which is timed alone above, to be read against the row it is part of.',
			'zod returns a fresh copy of every loose object and record, with the keys the schema does\n' +
				'not name copied across; this library returns the manifest it was given where nothing\n' +
				'changed. The set has transforms, on a URL and on `exports`, and they change nothing in\n' +
				'this data, so every matching row compares a copy with a check.'
		]
	},
	{
		name: 'bench_results',
		title: "syntax-highlighter-bench's results document, in zod and in this library",
		reference: ZOD,
		root: 'BenchResults',
		load: async (): Promise<LoadedSet> => {
			const theirs = (await import('./bench_results/bench_results_zod.ts')).BenchResults;
			const { create_bench_results } = await import('./bench_results/bench_results_fuz_schema.ts');
			const ours = create_bench_results(s).BenchResults;
			const documents: Array<HarvestedDocument> = read_set_json(
				'bench_results/bench_results_documents.json'
			).documents;
			const fixture = to_document(documents, 'fixture_run');
			// a count that is not a whole number, in the last of the cells
			const broken = to_json(fixture) as any;
			broken.cells.at(-1).bytes = 1.5;
			return {
				rows: [
					to_zod_row('a fixture run', theirs, ours, fixture),
					// the same at a size too large for any cache but the last
					to_zod_row('a published run', theirs, ours, to_document(documents, 'latest')),
					to_zod_row('a fixture run, last cell bad', theirs, ours, broken, false),
					to_zod_guard_row('a fixture run, as a guard', theirs, ours, fixture)
				]
			};
		},
		notes: [
			"This is the document's structure and not all the consumer checks: every `.refine` and\n" +
				'`.superRefine` was left out of the zod module and of the rewrite alike, so neither side\n' +
				'runs the cross-references that are a share of the real parse.',
			'zod returns a fresh copy of every object, array, and record; this library returns its\n' +
				'input where nothing changed, which is every matching row. Every object is strict.',
			"A record with checked keys is zod's own `record(key, value)`, and in the rewrite a\n" +
				'`record(value)` between two checks of its own, the second a loop over the keys. That is in\n' +
				"this library's columns as time, and the loop allocates nothing: the bytes of a matching\n" +
				'row are allocated reading the numbers of the `startup` entries.'
		]
	}
];

//
// One side of a set, for a process
//

/** The side that is this library, in every set. */
export const HARVEST_OURS = 'fuz_schema';

/** The side that is a set's asides, which are no library's. */
export const HARVEST_ASIDES = 'asides';

/** What a process of `harvest.ts` holds. */
export interface HarvestRowsOf {
	/** A set's name. */
	set: string;
	/** One of the reference's modes, `HARVEST_OURS`, or `HARVEST_ASIDES`. */
	side: string;
}

export const load_rows: LoadTimingRows = async (of: HarvestRowsOf) => {
	const set = HARVEST_SETS.find((candidate) => candidate.name === of.set);
	if (!set) throw new Error(`no set ${of.set}`);
	const { reference } = set;
	const loaded = await set.load();
	if (of.side === HARVEST_ASIDES) {
		return (loaded.asides ?? []).map(({ name, run }) => ({ name, run }));
	}
	const mode = reference.modes.indexOf(of.side);
	if (mode < 0 && of.side !== HARVEST_OURS) throw new Error(`${set.name} has no side ${of.side}`);
	const rows: Array<TimingRow> = loaded.rows.map((row) => ({
		name: row.name,
		run: mode < 0 ? row.ours : row.theirs[mode]!
	}));
	const run_rows = (): void => {
		for (const [i, row] of rows.entries()) {
			const { valid } = loaded.rows[i]!;
			if ((row.run() !== undefined) !== valid) {
				throw new Error(
					`${set.name}, ${row.name}: expected valid=${valid} and ${of.side} says otherwise`
				);
			}
		}
	};
	if (mode >= 0 && reference.assert_mode) reference.assert_mode(mode, run_rows);
	else run_rows();
	return rows;
};
