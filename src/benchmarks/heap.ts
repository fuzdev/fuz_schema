/**
 * Retained heap: the memory a library still holds after its schemas are built
 * and have each parsed once, with everything collectable collected.
 * `run_heap.ts` reports across libraries and `grade.ts` compares two versions
 * of this repo's library.
 *
 * A fresh process imports a scenario's bundle, builds the schema `count`
 * times, parses the valid input through each, and calls `gc()` until a
 * collection changes the used heap by under `HEAP_SETTLED_BELOW_BYTES`. It
 * then reads three figures:
 *
 * - **heap**: V8's heap spaces other than machine code
 * - **code**: the machine-code spaces, which hold optimized functions and the
 *   output of anything that generates code, so leaving them out would favor
 *   libraries that compile validators
 * - **external**: memory outside the heap, such as a wasm module's
 *
 * Each is reported over a bare process holding the same input and no library,
 * for one schema, which carries the library's own fixed memory. What each
 * further schema costs an app that defines a lot of them is read apart, as
 * the difference per schema in heap and external memory between processes
 * holding `HEAP_COUNTS.few` and `HEAP_COUNTS.many`: the schema object, its
 * `def`, its closures and their contexts, and its slot in the array that
 * holds them. Machine code, and what V8 keeps beside it in its trusted spaces
 * (bytecode, deoptimization data), is left out, since schemas share it and the
 * parses keep tiering it up and down past any count, by tens of bytes a schema
 * between the two. Not from one: the parses of the first few dozen schemas
 * tier the engine's code up, which holds feedback once, and spread over a few
 * dozen schemas reads as up to a hundred bytes or so each. The figure differs
 * by the pair it is read between, so only figures of one pair compare. Every
 * schema is built from the same definition, which flatters a library that
 * caches by definition.
 *
 * **Flags, for this reading only** (`HEAP_NODE_FLAGS`): `--expose-gc`;
 * a fixed young generation, which V8 otherwise sizes from the machine's
 * memory; one thread, so no compilation lands between the collections and
 * the reading. Figures depend on V8's object layout, so they are for one Node
 * version and architecture, and repeat to within about a kilobyte.
 *
 * The method follows syntax-highlighter-bench's retained-heap reading.
 *
 * @module
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { SCENARIOS } from './scenarios.ts';
import { PROGRAM } from './program.ts';
import { build_bundle } from './bundle_size.ts';
import {
	CHILD_DIR,
	prepare_entry,
	run_child,
	to_child_report_source,
	write_if_changed,
	type EntryVariant
} from './child.ts';

const HEAP_NODE_FLAGS = ['--expose-gc', '--max-semi-space-size=16', '--single-threaded'];

const HEAP_CODE_SPACES = ['code_space', 'code_large_object_space'];

/**
 * A collection that changes the heap by less than this has settled it. Not
 * zero: a collection can move a few hundred bytes back and forth indefinitely.
 */
export const HEAP_SETTLED_BELOW_BYTES = 1024;

const HEAP_MAX_COLLECTIONS = 50;

/**
 * The two counts of schemas the figure per further schema is read between:
 * the fewer is past where the parses have tiered the engine's code up, and
 * the many far enough past it that what a collection leaves behind is a byte
 * or so per schema. Read from one and `few` instead, the figure holds up to a
 * hundred bytes or so of that tier-up a schema, and from one and `many` tens.
 */
export const HEAP_COUNTS = { few: 50, many: 250 };

const HeapOutput = z.strictObject({
	heap_bytes: z.number().int().nonnegative(),
	code_bytes: z.number().int().nonnegative(),
	// the part of `heap_bytes` in V8's trusted spaces
	trusted_bytes: z.number().int().nonnegative(),
	external_bytes: z.number().int().nonnegative(),
	collections: z.number().int().positive(),
	settled: z.boolean(),
	held: z.number().int().nonnegative(),
	// what an export's process threw, as a baseline that lacks the export does
	failed: z.string().nullable().default(null)
});
type HeapOutput = z.infer<typeof HeapOutput>;

/** What a library holds over a bare process, in bytes, never negative. */
export interface RetainedHeap {
	heap_bytes: number;
	code_bytes: number;
	external_bytes: number;
	/** The three summed. */
	total_bytes: number;
	/** What each further schema holds in heap and external memory, past the engine's tier-up, see `HEAP_COUNTS`. */
	further_schema_bytes: number;
}

/**
 * The lines that collect until the heap settles, read the three figures, and
 * print them with `fields`, which are read after the figures and so keep what
 * they name alive until then.
 */
const to_reading_source = (fields: Array<string>): Array<string> => [
	"const v8 = process.getBuiltinModule('node:v8');",
	'let used = -Infinity;',
	'let collections = 0;',
	`while (collections < ${HEAP_MAX_COLLECTIONS}) {`,
	'\tglobalThis.gc();',
	'\tcollections++;',
	'\tconst now = v8.getHeapStatistics().used_heap_size;',
	`\tif (Math.abs(now - used) < ${HEAP_SETTLED_BELOW_BYTES}) break;`,
	'\tused = now;',
	'}',
	`const code_spaces = ${JSON.stringify(HEAP_CODE_SPACES)};`,
	'let heap_bytes = 0;',
	'let code_bytes = 0;',
	'let trusted_bytes = 0;',
	'for (const space of v8.getHeapSpaceStatistics()) {',
	'\tif (code_spaces.includes(space.space_name)) code_bytes += space.space_used_size;',
	'\telse heap_bytes += space.space_used_size;',
	"\tif (space.space_name.includes('trusted')) trusted_bytes += space.space_used_size;",
	'}',
	'const external_bytes = process.memoryUsage().external;',
	...to_child_report_source([
		'heap_bytes',
		'code_bytes',
		'trusted_bytes',
		'external_bytes',
		'collections',
		`settled: collections < ${HEAP_MAX_COLLECTIONS}`,
		...fields
	])
];

/**
 * Writes the module a heap process runs. The bare module is the same without
 * the import and the calls, so what the two share, the input among it,
 * cancels out.
 *
 * @param entry - the entry module's path, or null for the bare baseline
 * @param count - how many schemas to build and keep
 */
const to_child_source = (
	entry: string | null,
	scenario: string,
	count: number,
	input: unknown
): string =>
	[
		'// generated by src/benchmarks/heap.ts: one heap reading, and nothing of the harness',
		...(entry === null ? [] : [`import * as exports from ${JSON.stringify(entry)};`]),
		`const input = ${JSON.stringify(input)};`,
		'const runs = [];',
		...(entry === null
			? []
			: [
					`for (let i = 0; i < ${count}; i++) runs.push(exports.scenario_${scenario}());`,
					// every schema parses once, so one that compiles on first use has compiled
					'for (const run of runs) {',
					"\tif (run(input) !== true) throw new Error('the valid input did not match');",
					'}'
				]),
		// read after the figures, which keeps the schemas alive until then
		...to_reading_source(['held: runs.length'])
	].join('\n');

const read_heap = (path: string, held: number): HeapOutput => {
	const output = HeapOutput.parse(run_child(path, HEAP_NODE_FLAGS));
	if (output.failed !== null) return output;
	if (!output.settled) {
		throw new Error(
			`${path}: the heap was still changing after ${HEAP_MAX_COLLECTIONS} collections`
		);
	}
	if (output.held !== held) throw new Error(`${path}: held ${output.held} schemas, not ${held}`);
	return output;
};

const to_total = (o: HeapOutput): number => o.heap_bytes + o.code_bytes + o.external_bytes;

/**
 * What a schema holds of its own: the heap and external memory. Machine code,
 * and what V8 keeps beside it in its trusted spaces (bytecode, deoptimization
 * data), is left out.
 */
const to_held = (o: HeapOutput): number => o.heap_bytes - o.trusted_bytes + o.external_bytes;

/** What each schema past `few` holds of its own, between the two counts. */
const to_further_schema_bytes = (few: HeapOutput, many: HeapOutput): number =>
	Math.max(0, Math.round((to_held(many) - to_held(few)) / (HEAP_COUNTS.many - HEAP_COUNTS.few)));

/**
 * Reads what a library retains for one scenario, in processes of their own.
 *
 * @param lib - basename of a module in `libs/`
 * @param variant - builds against another version of this repo's library
 * @throws Error when a process fails or its heap never settles
 */
export const measure_retained_heap = async (
	lib: string,
	scenario_name: string,
	variant?: EntryVariant
): Promise<RetainedHeap> => {
	const scenario = SCENARIOS.find((s) => s.name === scenario_name);
	if (!scenario) throw new Error(`unknown scenario ${scenario_name}`);
	const bare_path = join(CHILD_DIR, 'heap', `${scenario.name}.bare.mjs`);
	write_if_changed(bare_path, to_child_source(null, scenario.name, 0, scenario.valid));
	const bare = read_heap(bare_path, 0);
	const entry = await prepare_entry(lib, scenario.name, 'bundled', variant);
	const dir = join(CHILD_DIR, 'heap', variant ? `${lib}.${variant.id}` : lib);
	const read = (count: number): HeapOutput => {
		const path = join(dir, `${scenario.name}.${count}.mjs`);
		write_if_changed(path, to_child_source(entry, scenario.name, count, scenario.valid));
		return read_heap(path, count);
	};
	const one = read(1);
	const few = read(HEAP_COUNTS.few);
	const many = read(HEAP_COUNTS.many);
	return {
		heap_bytes: Math.max(0, one.heap_bytes - bare.heap_bytes),
		code_bytes: Math.max(0, one.code_bytes - bare.code_bytes),
		external_bytes: Math.max(0, one.external_bytes - bare.external_bytes),
		total_bytes: Math.max(0, to_total(one) - to_total(bare)),
		further_schema_bytes: to_further_schema_bytes(few, many)
	};
};

/** What each further schema of one export retains, or why it could not be read. */
export interface ExportHeap {
	/** The export, as `PROGRAM` names it. */
	name: string;
	/** Bytes each further schema holds, see `HEAP_COUNTS`, `NaN` when the version could not build or run it. */
	further_schema_bytes: number;
	/** What the process threw, as a version that lacks the export does, or `null`. */
	failed: string | null;
}

/**
 * Writes the module a process of one export runs: `count` schemas of the
 * export's `PROGRAM` entry, each parsing its valid input once.
 *
 * @param entry - a bundle exporting the library as `s` and `PROGRAM`
 * @param name - the entry's name
 */
const to_export_child_source = (entry: string, name: string, count: number): string =>
	[
		'// generated by src/benchmarks/heap.ts: one heap reading, and nothing of the harness',
		`import { s, PROGRAM } from ${JSON.stringify(entry)};`,
		`const entry = PROGRAM.find((e) => e.name === ${JSON.stringify(name)});`,
		'const runs = [];',
		'let failed = null;',
		'try {',
		`\tfor (let i = 0; i < ${count}; i++) runs.push(entry.create(s));`,
		'\tfor (const schema of runs) {',
		"\t\tif (!s.parse(schema, entry.valid).ok) throw new Error('the valid input did not match');",
		'\t}',
		'} catch (error) {',
		'\tfailed = String(error?.message ?? error);',
		'}',
		...to_reading_source(['held: runs.length', 'failed'])
	].join('\n');

/**
 * Reads what each further schema of every export retains, one export at a
 * time, each schema built from the export's entry in `PROGRAM`: one of every
 * kind the library makes, and of each action inside a `pipe`. A scenario
 * reaches only the kinds it is built of, so a change to any other is read
 * here and nowhere else. Only the figure per further schema is read, between
 * the two of `HEAP_COUNTS`: the library and `PROGRAM` are in both and cancel.
 *
 * @param variant - another version of this repo's library, by default the working tree's
 * @param strict - whether an entry that fails throws, where otherwise its figure is `NaN`, as for a version with an older API
 * @throws Error when a process fails, its heap never settles, or `strict` and an entry fails
 */
export const measure_export_heap = async (
	variant?: Pick<EntryVariant, 'id' | 'schema_path'>,
	strict = false
): Promise<Array<ExportHeap>> => {
	const program_path = fileURLToPath(new URL('./program.ts', import.meta.url));
	const dir = join(CHILD_DIR, 'heap', variant ? `exports.${variant.id}` : 'exports');
	const entry = join(dir, 'entry.mjs');
	write_if_changed(
		entry,
		await build_bundle(
			"import * as s from '#lib/schema.ts';\nexport { s };\n" +
				`export { PROGRAM } from ${JSON.stringify(program_path)};`,
			variant?.schema_path,
			'the exports heap entry'
		)
	);
	return PROGRAM.map(({ name }): ExportHeap => {
		const read = (count: number): HeapOutput => {
			const path = join(dir, `${name}.${count}.mjs`);
			write_if_changed(path, to_export_child_source(entry, name, count));
			const output = read_heap(path, count);
			if (strict && output.failed !== null) throw new Error(`${path}: ${output.failed}`);
			return output;
		};
		const few = read(HEAP_COUNTS.few);
		const many = few.failed === null ? read(HEAP_COUNTS.many) : few;
		const failed = many.failed;
		return {
			name,
			further_schema_bytes: failed === null ? to_further_schema_bytes(few, many) : NaN,
			failed
		};
	});
};
