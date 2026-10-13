/**
 * Each harvested set head to head: a consumer's schemas in the library it
 * wrote them for, valibot or zod, against the same in this library, on its own
 * data. Bundle size, parse time, and heap bytes allocated. The comparisons
 * here of a real consumer's whole schema set, where the scenarios in
 * `scenarios.ts` are one small schema each.
 *
 * The sets are declared in `harvest_sets.ts`. Every row is run by each side
 * and the outputs compared before anything is measured, and a row whose
 * verdicts differ stops the run.
 *
 * What the sides promise differs, and each set's notes say how. Valibot and
 * zod return a fresh copy of what they read, and this library returns what it
 * was given wherever nothing changed. zod is reported twice, with the object
 * parsers it compiles and with its interpreter.
 *
 * **A side of a set is a process.** The consumer's library, this library, and
 * each of zod's two modes are timed in processes of their own, so what one
 * side's parses teach the engine is not there when another is timed, and zod's
 * two columns share none of zod's code. A process holds one set, so a set
 * reads the same run alone. The whole is repeated in passes of fresh
 * processes, and a time is the median of its passes beside their spread: see
 * `timing_passes.ts`.
 *
 * Time is taken under Node's own flags. Bytes are `measure_bytes`'s, which
 * forces no collection and needs flags of its own, so they are read in other
 * processes, a side to each, which this script gives the flags. Those are not
 * timed, so they run several at once, after every set has been timed, and the
 * tables are printed when they are done.
 *
 * Usage:
 *   npm run benchmark:harvest
 *   npm run benchmark:harvest -- --set package_json --set bench_results
 *   npm run benchmark:harvest -- --passes 9 --duration 3000
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import { to_bundle_size, type BundleSize } from './bundle_size.ts';
import {
	HARVEST_ASIDES,
	HARVEST_OURS,
	HARVEST_SETS,
	type HarvestAside,
	type HarvestRow,
	type HarvestRowsOf,
	type HarvestSet
} from './harvest_sets.ts';
import {
	ALLOCATION_NODE_FLAGS,
	format_table,
	has_some_allocation_node_flag,
	hold_benchmark_lock
} from './measure.ts';
import { TIMING_PRELUDE_MS } from './timing_job.ts';
import {
	format_spread,
	measure_units_bytes,
	time_units,
	to_pooled_timing,
	type BytesReadings,
	type TimingPlan,
	type TimingReadings,
	type TimingUnit
} from './timing_passes.ts';

const to_path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const SCHEMA_PATH = to_path('../lib/schema.ts');

//
// Arguments
//

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	set: z
		.union([z.string(), z.array(z.string())])
		.transform((value) => (Array.isArray(value) ? value : [value]))
		.optional()
		.meta({ description: 'set names to run, defaulting to all' }),
	duration: z
		.number()
		.positive()
		.default(1000)
		.meta({ description: 'measurement ms per row of a side, shared out over the passes' }),
	passes: z
		.number()
		.int()
		.positive()
		.default(5)
		.meta({ description: 'how many times the timing is repeated, in fresh processes' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const sets = HARVEST_SETS.filter((set) => !args.set || args.set.includes(set.name));
const unknown = args.set?.filter((name) => !HARVEST_SETS.some((set) => set.name === name));
if (!sets.length || unknown?.length) {
	console.error(
		`no set ${(unknown ?? []).join(', ')}: the sets are ${HARVEST_SETS.map((set) => set.name).join(', ')}`
	);
	process.exit(1);
}
if (has_some_allocation_node_flag()) {
	console.error(
		`harvest times under the flags a consumer has: take \`${ALLOCATION_NODE_FLAGS}\` off the ` +
			'command line and out of NODE_OPTIONS, the processes that measure bytes are given them'
	);
	process.exit(1);
}

hold_benchmark_lock('fuz_schema harvest');

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

const format_bundles = async (set: HarvestSet): Promise<string> => {
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
	return (
		`bundle: a module that parses one \`${root}\`, minified, in bytes\n\n` +
		format_table([
			['', 'minified', 'gzip'],
			[reference.name, String(theirs.minified), String(theirs.gzip)],
			['fuz_schema', String(ours.minified), String(ours.gzip)],
			[
				'ratio',
				(ours.minified / theirs.minified).toFixed(2) + 'x',
				(ours.gzip / theirs.gzip).toFixed(2) + 'x'
			]
		]) +
		(reference.bundle_note ? `\n\n${reference.bundle_note}` : '')
	);
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
	const names = [...set.reference.modes, HARVEST_OURS];
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

const format_seconds = (seconds: number): string =>
	seconds < 90 ? `${Math.round(seconds)}s` : `${(seconds / 60).toFixed(1)} min`;

// A row is run this long before it is timed, after the process has run every
// row of its side. A count alone leaves the first row of a new process timed
// in code the engine has yet to optimize, and the slower side is the further
// behind.
const WARM_MS = 200;

const plan: TimingPlan = {
	module: to_path('./harvest_sets.ts'),
	// a side's rows share its process, as a consumer's documents do, so each is
	// timed in code that has seen them all
	prelude: true,
	warm_ms: WARM_MS,
	duration_ms: args.duration / args.passes
};

// what a process takes to start and load a set, fitted to runs of this
const PROCESS_SECONDS = 0.5;

// said under every set's tables, before its library's notes and its own
const METHOD_NOTES = [
	`Time is the median of ${args.passes} ${args.passes === 1 ? 'pass' : 'passes'}, beside half of what the passes range over. In a pass every\n` +
		'column is a fresh process of its own, which runs every row before it times any, under the\n' +
		'flags a consumer has. A gap between two columns inside their spreads is not a finding.',
	'Bytes are read in other processes, a column to each, under the node flags they need: a young\n' +
		'generation large enough that a collection falls in few samples. No collection is forced, and\n' +
		'a row is sampled until two medians of its bytes agree: the same parse in two rows reads\n' +
		'within about a percent.'
];

/** What is known of a set once its sides are timed, kept until the bytes of every set are read. */
interface TimedSet {
	set: HarvestSet;
	bundles: string;
	rows: Array<HarvestRow>;
	asides: Array<HarvestAside>;
	sides: Array<string>;
	units: Array<TimingUnit>;
	times: TimingReadings;
}

// names a side of a set among every set's, for the bytes, which are read together
const to_bytes_id = (set: HarvestSet, side: string): string => `${set.name}/${side}`;

const time_set = async (set: HarvestSet): Promise<TimedSet> => {
	const bundles = await format_bundles(set);

	// held to one answer here, in a process that times nothing
	const { rows, asides = [] } = await set.load();
	for (const row of rows) assert_agreement(set, row);

	const sides = [...set.reference.modes, HARVEST_OURS];
	const units = [...sides, ...(asides.length ? [HARVEST_ASIDES] : [])].map((side): TimingUnit => {
		const of: HarvestRowsOf = { set: set.name, side };
		return { id: side, of };
	});
	// a process also times a function that does nothing, as it does a row
	const row_count = sides.length * rows.length + asides.length + units.length;
	const pass_seconds =
		units.length * PROCESS_SECONDS +
		(row_count * (TIMING_PRELUDE_MS + plan.warm_ms + plan.duration_ms)) / 1000;
	console.log(
		`${set.name}: timing ${units.length} processes a pass, ${args.passes} ` +
			`${args.passes === 1 ? 'pass' : 'passes'}, about ${format_seconds(pass_seconds * args.passes)}...`
	);
	const times = await time_units(units, plan, args.passes);
	return { set, bundles, rows, asides, sides, units, times };
};

const print_set = (timed: TimedSet, bytes: BytesReadings): void => {
	const { set, rows, asides, sides, times } = timed;
	const { reference } = set;
	const { modes } = reference;
	const to_bytes = (side: string, row: string): number =>
		bytes.get(to_bytes_id(set, side))!.get(row)!;
	console.log(`${set.name}: ${set.title}\n`);
	console.log(timed.bundles);

	const over = modes.map((mode) => `fuz/${mode}`);
	// each side's figure with its median batch beside it
	const time_table = [['', ...[...modes, 'fuz'].flatMap((side) => [side, 'median']), ...over]];
	const bytes_table = [['', ...modes, 'fuz', ...over]];
	for (const row of rows) {
		// this library's last
		const us = sides.map((side) => {
			const { ns, median_ns } = times.get(side)!.get(row.name)!;
			const { median, spread } = to_pooled_timing(ns);
			return { value: median / 1000, spread, batch: to_pooled_timing(median_ns).median / 1000 };
		});
		const our_us = us.at(-1)!.value;
		time_table.push([
			row.name,
			...us.flatMap(({ value, spread, batch }) => [
				`${format_number(value)} ${format_spread(spread)}`,
				format_number(batch)
			]),
			...modes.map((_, i) => format_ratio(our_us, us[i]!.value))
		]);
		const row_bytes = sides.map((side) => to_bytes(side, row.name));
		bytes_table.push([
			row.name,
			...row_bytes.map(format_number),
			...modes.map((_, i) => format_ratio(row_bytes.at(-1)!, row_bytes[i]!))
		]);
	}
	console.log(
		'\ntime: microseconds per parse with its spread, and this library over each. A time is the ' +
			'whole of a\ntiming over its calls and `median` its median batch, pooled the same way: a wide gap ' +
			'between them is\ncollection time\n'
	);
	console.log(format_table(time_table));
	console.log('\nallocation: heap bytes per parse, and this library over each\n');
	console.log(format_table(bytes_table));

	if (asides.length) {
		const aside_table = [['', 'us', 'median', 'bytes']];
		for (const aside of asides) {
			const { ns, median_ns } = times.get(HARVEST_ASIDES)!.get(aside.name)!;
			const { median, spread } = to_pooled_timing(ns);
			aside_table.push([
				aside.name,
				`${format_number(median / 1000)} ${format_spread(spread)}`,
				format_number(to_pooled_timing(median_ns).median / 1000),
				format_number(to_bytes(HARVEST_ASIDES, aside.name))
			]);
		}
		console.log(
			"\nchecks that are a rewrite's own code and no library's, in a process of their own\n"
		);
		console.log(format_table(aside_table));
	}

	for (const note of [...METHOD_NOTES, ...reference.notes, ...set.notes]) console.log(`\n${note}`);
};

const timed_sets: Array<TimedSet> = [];
for (const set of sets) {
	timed_sets.push(await time_set(set));
}

// Nothing is timed from here, so the bytes of every set are read together,
// several processes at once.
console.log('bytes...\n');
const bytes = await measure_units_bytes(
	timed_sets.flatMap(({ set, units }) =>
		units.map((unit): TimingUnit => ({ ...unit, id: to_bytes_id(set, unit.id) }))
	),
	plan
);

for (const timed of timed_sets) {
	if (timed !== timed_sets[0]) console.log('\n');
	print_set(timed, bytes);
}
