/**
 * Each harvested set head to head: a consumer's schemas in the library it
 * wrote them for, valibot or zod, against the same in this library, on its own
 * data. Bundle size, parse time, and heap bytes allocated. The comparisons
 * here of a real consumer's whole schema set, where the scenarios in
 * `scenarios.ts` are one small schema each.
 *
 * A set is declared once, in `SETS`: its reference library, its root schema,
 * its rows, and what to say under its tables. Every row is run by each side
 * and the outputs compared before anything is timed, and a row whose verdicts
 * differ stops the run.
 *
 * What the sides promise differs, and each set's notes say how. Valibot and
 * zod return a fresh copy of what they read, and this library returns what it
 * was given wherever nothing changed. zod is reported twice, with the object
 * parsers it compiles and with its interpreter.
 *
 * Each set is measured in a process of its own, so that what one set's
 * schemas teach the engine about the libraries' shared code is not there when
 * the next is timed, and a set gives the same figures run alone.
 *
 * Bytes are `measure_bytes`'s, which forces no collection. Time is taken in the
 * same process, under the flags the bytes need.
 *
 * Usage (`npm run benchmark:harvest` passes the node flags the bytes need):
 *   npm run benchmark:harvest
 *   npm run benchmark:harvest -- --set package_json --set bench_results
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import type * as v from 'valibot';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import * as s from '#lib/schema.ts';
import { to_bundle_size, type BundleSize } from './bundle_size.ts';
import {
	format_table,
	hold_benchmark_lock,
	measure_bytes,
	measure_ms,
	median,
	require_allocation_node_flags
} from './measure.ts';

const to_path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const to_json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const SCHEMA_PATH = to_path('../lib/schema.ts');

//
// What a set declares
//

interface HarvestRow {
	name: string;
	valid: boolean;
	/** The reference library's parse, once for each of its modes, in their order. */
	theirs: Array<() => unknown>;
	ours: () => unknown;
}

/** A check that is a rewrite's own code and no library's, timed alone. */
interface HarvestAside {
	name: string;
	run: () => unknown;
}

interface LoadedSet {
	rows: Array<HarvestRow>;
	asides?: Array<HarvestAside>;
}

interface HarvestReference {
	name: string;
	/** A column for each way the library is run. */
	modes: Array<string>;
	/** The body of a module that exports `run`, which parses a value with `root` imported from `path`. */
	to_entry: (root: string, path: string) => string;
	/** Said under the bundle table. */
	bundle_note?: string;
	/** Throws when a mode is not what its column says, before any row has run. */
	assert_modes?: (rows: Array<HarvestRow>) => void;
	/** Said under every set of this library's, before the set's own notes. */
	notes: Array<string>;
}

interface HarvestSet {
	/** Its directory, and what its two schema modules are named by. */
	name: string;
	title: string;
	reference: HarvestReference;
	/** The schema the bundles parse with, exported by the consumer's module and returned by the port's factory. */
	root: string;
	/** Its schemas and data are loaded here and not by this module, so a run of one set holds no other's. */
	load: () => Promise<LoadedSet>;
	notes: Array<string>;
}

const read_set_json = (path: string): any => JSON.parse(readFileSync(to_path(`./${path}`), 'utf8'));

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
	// for one that does. So the interpreter is run first, on schemas that have
	// compiled nothing yet, and must compile nothing.
	assert_modes: (rows) => {
		const interpreted = count_compiled(() => {
			for (const row of rows) row.theirs[1]!();
		});
		if (interpreted) throw new Error(`zod compiled ${interpreted} functions when asked not to`);
		const compiled = count_compiled(() => {
			for (const row of rows) row.theirs[0]!();
		});
		if (!compiled) throw new Error('zod compiled nothing: its `zod` column would be `zod jitless`');
	},
	notes: [
		'zod compiles a parser for each object schema with `new Function`, on its first parse, where\n' +
			'the environment lets it. `zod jitless` is its interpreter, which is all it has under\n' +
			'`z.config({jitless: true})` or a content security policy that refuses eval. It is asked for\n' +
			'here a parse at a time, `safeParse(value, {jitless: true})`, on the same schemas, and the run\n' +
			'has checked that those parses compiled nothing, and that the others compiled some.',
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

const SETS: Array<HarvestSet> = [
	{
		name: 'docinfo',
		title: "svelte-docinfo's analysis output, in valibot and in this library",
		reference: VALIBOT,
		root: 'ModuleJson',
		// The data is its analysis of a whole library, stored as it writes it, with
		// the fields that have their defaults left out, so a parse fills them in.
		// `full` rows are the same data with every default in place.
		load: async () => {
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
		load: async () => {
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
		load: async () => {
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
		load: async () => {
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
// Arguments, and a process for each set
//

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	set: z
		.union([z.string(), z.array(z.string())])
		.transform((value) => (Array.isArray(value) ? value : [value]))
		.optional()
		.meta({ description: 'set names to run, defaulting to all' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const sets = SETS.filter((set) => !args.set || args.set.includes(set.name));
const unknown = args.set?.filter((name) => !SETS.some((set) => set.name === name));
if (!sets.length || unknown?.length) {
	console.error(
		`no set ${(unknown ?? []).join(', ')}: the sets are ${SETS.map((set) => set.name).join(', ')}`
	);
	process.exit(1);
}

// The process this script starts for a set is told so here, with the set's
// name, and not by an argument, which a caller could pass and get one set
// measured under no lock.
const ISOLATED_ENV = 'FUZ_SCHEMA_HARVEST_ISOLATED_SET';
const isolated = process.env[ISOLATED_ENV];
if (isolated !== undefined && (sets.length !== 1 || sets[0]!.name !== isolated)) {
	console.error(
		`${ISOLATED_ENV} is this script's own, for the process it starts for a set: unset it`
	);
	process.exit(1);
}

require_allocation_node_flags();

// the process of one set runs under its parent's lock
if (isolated === undefined) hold_benchmark_lock('fuz_schema harvest');

//
// Bundle size
//

const ENTRY_ID = 'virtual:harvest_entry.ts';
const PORT_ID = 'virtual:harvest_port.ts';

// The port takes the library as a parameter, which a bundler can't see
// through: handed the namespace, it keeps every export. So the bundle is built
// from the port's text with the parameter turned into an import. Every port is
// one factory that ends by returning its schemas by name.
const to_port_module = (set: HarvestSet): string => {
	const file = `${set.name}_fuz_schema.ts`;
	const source = readFileSync(to_path(`./${set.name}/${file}`), 'utf8');
	const open = /^export const create_\w+ = \(s: SchemaLib\): \w+ => \{\n/m.exec(source);
	const close = /\n\treturn \{([^}]*)\};\n\};\n$/.exec(source);
	if (!open || !close || !close[1]!.split(/[\s,]+/).includes(set.root)) {
		throw new Error(`${file} is not in the shape this script rewrites`);
	}
	return (
		`import * as s from ${JSON.stringify(SCHEMA_PATH)};\n` +
		source.slice(open.index + open[0].length, close.index).replaceAll('schema_lib.', 's.') +
		`\nexport { ${set.root} };\n`
	);
};

const measure_bundle = async (entry: string, port: string): Promise<BundleSize> => {
	const bundle = await rolldown({
		input: ENTRY_ID,
		platform: 'browser',
		logLevel: 'silent',
		plugins: [
			{
				name: 'virtual_entry',
				resolveId: (id) => (id === ENTRY_ID || id === PORT_ID ? id : null),
				load: (id) => (id === ENTRY_ID ? entry : id === PORT_ID ? port : null)
			}
		]
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	if (output.length !== 1) throw new Error(`expected one chunk, got ${output.length}`);
	return to_bundle_size(output[0].code);
};

const print_bundles = async (set: HarvestSet): Promise<void> => {
	const { reference, root } = set;
	const port = to_port_module(set);
	const theirs = await measure_bundle(
		reference.to_entry(root, to_path(`./${set.name}/${set.name}_${reference.name}.ts`)),
		port
	);
	const ours = await measure_bundle(
		`import { parse } from ${JSON.stringify(SCHEMA_PATH)};
import { ${root} } from ${JSON.stringify(PORT_ID)};
export const run = (value) => parse(${root}, value);`,
		port
	);
	console.log(`bundle: a module that parses one \`${root}\`, minified, in bytes\n`);
	console.log(
		format_table([
			['', 'minified', 'gzip'],
			[reference.name, String(theirs.minified), String(theirs.gzip)],
			['fuz_schema', String(ours.minified), String(ours.gzip)],
			[
				'ratio',
				(ours.minified / theirs.minified).toFixed(2) + 'x',
				(ours.gzip / theirs.gzip).toFixed(2) + 'x'
			]
		])
	);
	if (reference.bundle_note) console.log(`\n${reference.bundle_note}`);
};

//
// Parse time and allocation
//

// Throws unless every side gives the verdict the row names and the same
// output. The comparison is the whole of both outputs, deeply and strictly:
// every way the ports' headers say a rewrite differs is on input this data
// doesn't have (a `__proto__` key, a URL with whitespace to drop) or in the
// issues of one that doesn't match, which are not compared here. A row that
// fails this is a finding, to be reported and not dropped or loosened.
const assert_agreement = (set: HarvestSet, row: HarvestRow): void => {
	const ours = row.ours();
	const outputs = [...row.theirs.map((run) => run()), ours];
	const names = [...set.reference.modes, 'fuz_schema'];
	for (let i = 0; i < outputs.length; i++) {
		if ((outputs[i] !== undefined) !== row.valid) {
			throw new Error(
				`${set.name}, ${row.name}: expected valid=${row.valid} and ${names[i]} says otherwise`
			);
		}
		if (!isDeepStrictEqual(outputs[i], ours)) {
			throw new Error(`${set.name}, ${row.name}: the outputs of ${names[i]} and fuz_schema differ`);
		}
	}
};

const format_number = (n: number): string =>
	n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

const format_ratio = (ours: number, theirs: number): string =>
	theirs > 0 ? (ours / theirs).toFixed(2) + 'x' : '-';

// A row is run for this long and this many times before it is timed, whichever
// is more. A count alone leaves the first row of a new process timed in code
// the engine has yet to optimize, and the slower side is the further behind.
const WARMUP_MS = 1000;
const WARMUP_CALLS = 300;
const ROUNDS = 9;
// What a timing of this library aims to last, in milliseconds, and the other
// sides run as many calls. Long enough that a collection of the young
// generation is a small part of a timing, whether one fell in it or a few did.
const TIMING_MS = 20;

// The median milliseconds per call of each of `runs`, which are timed in
// turns, each round starting one later, so none always follows another.
const measure_together = (runs: Array<() => unknown>): Array<number> => {
	const warm_until = performance.now() + WARMUP_MS;
	for (let calls = 0; calls < WARMUP_CALLS || performance.now() < warm_until; calls++) {
		for (const run of runs) run();
	}
	const batch = Math.max(1, Math.round(TIMING_MS / measure_ms(runs.at(-1)!, 20, 3)));
	const times: Array<Array<number>> = runs.map(() => []);
	for (let round = 0; round < ROUNDS; round++) {
		for (let i = 0; i < runs.length; i++) {
			const at = (round + i) % runs.length;
			times[at]!.push(measure_ms(runs[at]!, batch, 1));
		}
	}
	return times.map(median);
};

// said under every set's tables, before its library's notes and its own
const METHOD_NOTES = [
	'Time and bytes are taken in one process, under the node flags the bytes need: a young\n' +
		'generation large enough that a collection falls in few samples. Those are not the flags a\n' +
		"consumer runs under, and a side's time moves with them, by set and not always the same way.\n" +
		'No collection is forced, and a row is sampled until two medians of its bytes agree: the same\n' +
		'parse in two rows reads within about a percent.'
];

const run_set = async (set: HarvestSet): Promise<void> => {
	const { reference } = set;
	const { modes } = reference;
	console.log(`${set.name}: ${set.title}\n`);
	await print_bundles(set);

	const { rows, asides = [] } = await set.load();
	reference.assert_modes?.(rows);
	for (const row of rows) assert_agreement(set, row);

	const over = modes.map((mode) => `fuz/${mode}`);
	const time_table = [['', ...modes, 'fuz', ...over]];
	const bytes_table = [['', ...modes, 'fuz', ...over]];
	for (const row of rows) {
		// this library's last, which the batch is sized by
		const runs = [...row.theirs, row.ours];
		const us = measure_together(runs).map((ms) => ms * 1000);
		const bytes = runs.map((run) => measure_bytes(run));
		for (const [table, values] of [
			[time_table, us],
			[bytes_table, bytes]
		] as const) {
			const ours = values.at(-1)!;
			table.push([
				row.name,
				...values.map(format_number),
				...modes.map((_, i) => format_ratio(ours, values[i]!))
			]);
		}
	}
	console.log('\ntime: median microseconds per parse, and this library over each\n');
	console.log(format_table(time_table));
	console.log('\nallocation: heap bytes per parse, and this library over each\n');
	console.log(format_table(bytes_table));

	if (asides.length) {
		const aside_table = [['', 'us', 'bytes']];
		for (const aside of asides) {
			aside_table.push([
				aside.name,
				format_number(measure_together([aside.run])[0]! * 1000),
				format_number(measure_bytes(aside.run))
			]);
		}
		console.log("\nchecks that are a rewrite's own code and no library's, each alone\n");
		console.log(format_table(aside_table));
	}

	for (const note of [...METHOD_NOTES, ...reference.notes, ...set.notes]) console.log(`\n${note}`);
};

if (isolated !== undefined) {
	await run_set(sets[0]!);
} else {
	for (const set of sets) {
		if (set !== sets[0]) console.log('\n');
		const child = spawnSync(
			process.execPath,
			[...process.execArgv, fileURLToPath(import.meta.url), '--set', set.name],
			{ stdio: 'inherit', env: { ...process.env, [ISOLATED_ENV]: set.name } }
		);
		if (child.status !== 0) process.exit(child.status ?? 1);
	}
}
