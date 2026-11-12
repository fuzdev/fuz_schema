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
 * was given wherever nothing changed. zod is reported three times, with the
 * object parsers it compiles on a first parse, with its interpreter, and with
 * each root through `z.compile`, which has no figure of a row whose root it
 * hands back uncompiled: that row is `-` in its column.
 *
 * **A side of a set is a process.** The consumer's library, this library, and
 * each of zod's three modes are timed in processes of their own, so what one
 * side's parses teach the engine is not there when another is timed, and zod's
 * columns share none of zod's code. A process holds one set, so a set
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

import {
	DataArg,
	meta,
	parse_args,
	s,
	to_count_arg,
	to_duration_arg,
	to_names_arg,
	write_benchmark_data
} from './args.ts';
import type { HarvestData } from './results_schema.ts';
import { build_bundle, to_bundle_size, type BundleSize } from './bundle_size.ts';
import {
	HARVEST_ASIDES,
	HARVEST_OURS,
	HARVEST_SETS,
	HARVEST_ZOD_COMPILED,
	take_uncompiled_harvest_rows,
	type HarvestAside,
	type HarvestRow,
	type HarvestRowsOf,
	type HarvestSet
} from './harvest_sets.ts';
import { format_benchmark_header } from './machine.ts';
import {
	format_number,
	format_seconds,
	format_table,
	refuse_timing_node_flags
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

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => []),
	set: meta(
		s.optional(
			to_names_arg(
				'set',
				'sets',
				HARVEST_SETS.map((set) => set.name)
			)
		),
		{ description: 'set names to run, defaulting to all' }
	),
	duration: meta(to_duration_arg(1000), {
		description: 'measurement ms per row of a side, shared out over the passes'
	}),
	passes: meta(to_count_arg(5), {
		description: 'how many times the timing is repeated, in fresh processes'
	}),
	data: DataArg
});

const args = parse_args(Args);

const sets = HARVEST_SETS.filter((set) => !args.set || args.set.includes(set.name));
refuse_timing_node_flags('harvest', true);

console.log(format_benchmark_header(['valibot', 'zod', 'rolldown']) + '\n');

//
// Bundle size
//

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

const measure_bundle = async (entry: string, port: string): Promise<BundleSize> =>
	to_bundle_size(await build_bundle(entry, SCHEMA_PATH, 'a harvested set', { [PORT_ID]: port }));

/** The bundles of a set: the consumer's library, each mode of it with a bundle of its own, and this library. */
interface SetBundles {
	theirs: BundleSize;
	their_modes: Array<{ mode: string; size: BundleSize }>;
	ours: BundleSize;
}

const measure_bundles = async (set: HarvestSet): Promise<SetBundles> => {
	const { reference, root } = set;
	const port = to_port_module(set);
	const their_path = to_path(`./${set.name}/${set.name}_${reference.name}.ts`);
	const theirs = await measure_bundle(reference.to_entry(root, their_path), port);
	const their_modes = await Promise.all(
		Object.entries(reference.to_mode_entries ?? {}).map(async ([mode, to_entry]) => ({
			mode,
			size: await measure_bundle(to_entry(root, their_path), port)
		}))
	);
	const ours = await measure_bundle(
		`import { parse } from ${JSON.stringify(SCHEMA_PATH)};
import { ${root} } from ${JSON.stringify(PORT_ID)};
export const run = (value) => parse(${root}, value);`,
		port
	);
	return { theirs, their_modes, ours };
};

const format_bundles = (set: HarvestSet, { theirs, their_modes, ours }: SetBundles): string => {
	const { reference, root } = set;
	return (
		`bundle: a module that parses one \`${root}\`, minified, in bytes\n\n` +
		format_table([
			['', 'minified', 'gzip'],
			[reference.name, String(theirs.minified), String(theirs.gzip)],
			...their_modes.map(({ mode, size }) => [mode, String(size.minified), String(size.gzip)]),
			['fuz_schema', String(ours.minified), String(ours.gzip)],
			[
				`fuz_schema/${reference.name}`,
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
	const ours = row.ours()();
	const outputs = [...row.theirs.map((side) => side()()), ours];
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

const format_ratio = (ours: number, theirs: number | undefined): string =>
	theirs !== undefined && theirs > 0 ? (ours / theirs).toFixed(2) + 'x' : '-';

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

// said once, after every set's tables
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
	bundle_sizes: SetBundles;
	rows: Array<HarvestRow>;
	/** The rows `HARVEST_ZOD_COMPILED` has no figure of, which it times none of. */
	uncompiled: Array<string>;
	asides: Array<HarvestAside>;
	sides: Array<string>;
	units: Array<TimingUnit>;
	times: TimingReadings;
}

// names a side of a set among every set's, for the bytes, which are read together
const to_bytes_id = (set: HarvestSet, side: string): string => `${set.name}/${side}`;

const time_set = async (set: HarvestSet): Promise<TimedSet> => {
	const bundle_sizes = await measure_bundles(set);
	const bundles = format_bundles(set, bundle_sizes);

	// held to one answer here, in a process that times nothing
	const { rows, asides = [] } = await set.load();
	take_uncompiled_harvest_rows();
	for (const row of rows) assert_agreement(set, row);
	const uncompiled = take_uncompiled_harvest_rows();

	const sides = [...set.reference.modes, HARVEST_OURS];
	// a side's process holds every row, and times the ones it has a figure of
	const units = [...sides, ...(asides.length ? [HARVEST_ASIDES] : [])].flatMap(
		(side): Array<TimingUnit> => {
			const of: HarvestRowsOf = { set: set.name, side };
			if (side !== HARVEST_ZOD_COMPILED || !uncompiled.length) return [{ id: side, of }];
			const timed = rows.map((row) => row.name).filter((name) => !uncompiled.includes(name));
			return timed.length ? [{ id: side, of, rows: timed }] : [];
		}
	);
	// a process also times a function that does nothing, as it does a row
	const row_count = units.reduce(
		(sum, unit) =>
			sum + 1 + (unit.rows?.length ?? (unit.id === HARVEST_ASIDES ? asides.length : rows.length)),
		0
	);
	const pass_seconds =
		units.length * PROCESS_SECONDS +
		(row_count * (TIMING_PRELUDE_MS + plan.warm_ms + plan.duration_ms)) / 1000;
	console.log(
		`${set.name}: timing ${units.length} processes a pass, ${args.passes} ` +
			`${args.passes === 1 ? 'pass' : 'passes'}, about ${format_seconds(pass_seconds * args.passes)}...`
	);
	const times = await time_units(units, plan, args.passes);
	return { set, bundles, bundle_sizes, rows, uncompiled, asides, sides, units, times };
};

// the libraries whose notes have been said, under the first of their sets
const noted_references: Set<string> = new Set();

const print_set = (timed: TimedSet, bytes: BytesReadings): void => {
	const { set, rows, uncompiled, asides, sides, times } = timed;
	const { reference } = set;
	const { modes } = reference;
	const has_figure = (side: string, row: string): boolean =>
		side !== HARVEST_ZOD_COMPILED || !uncompiled.includes(row);
	const to_bytes = (side: string, row: string): number | undefined =>
		has_figure(side, row) ? bytes.get(to_bytes_id(set, side))!.get(row)! : undefined;
	console.log(`${set.name}: ${set.title}\n`);
	console.log(timed.bundles);

	const over = modes.map((mode) => `fuz/${mode}`);
	// each side's figure with its median batch beside it
	const time_table = [['', ...[...modes, 'fuz'].flatMap((side) => [side, 'median']), ...over]];
	const bytes_table = [['', ...modes, 'fuz', ...over]];
	for (const row of rows) {
		// this library's last
		const us = sides.map((side) => {
			if (!has_figure(side, row.name)) return undefined;
			const { ns, median_ns } = times.get(side)!.get(row.name)!;
			const { median, spread } = to_pooled_timing(ns);
			return { value: median / 1000, spread, batch: to_pooled_timing(median_ns).median / 1000 };
		});
		const our_us = us.at(-1)!.value;
		time_table.push([
			row.name,
			...us.flatMap((side) =>
				side
					? [
							`${format_number(side.value)} ${format_spread(side.spread)}`,
							format_number(side.batch)
						]
					: ['-', '-']
			),
			...modes.map((_, i) => format_ratio(our_us, us[i]?.value))
		]);
		const row_bytes = sides.map((side) => to_bytes(side, row.name));
		bytes_table.push([
			row.name,
			...row_bytes.map((b) => (b === undefined ? '-' : format_number(b))),
			...modes.map((_, i) => format_ratio(row_bytes.at(-1)!, row_bytes[i]))
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
				format_number(to_bytes(HARVEST_ASIDES, aside.name)!)
			]);
		}
		console.log(
			"\nchecks that are a rewrite's own code and no library's, in a process of their own\n"
		);
		console.log(format_table(aside_table));
	}

	if (uncompiled.length) {
		console.log(
			`\n\`-\` is a row a column has no figure of. \`${HARVEST_ZOD_COMPILED}\` has none of the rows ` +
				'whose roots\n`z.compile` hands back uncompiled, and times none of them:\n' +
				uncompiled.map((name) => `  ${name}`).join('\n')
		);
	}
	const notes = noted_references.has(reference.name)
		? set.notes
		: [...reference.notes, ...set.notes];
	noted_references.add(reference.name);
	for (const note of notes) console.log(`\n${note}`);
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

console.log('\n\nhow every set above was measured');
for (const note of METHOD_NOTES) console.log(`\n${note}`);

if (args.data !== undefined) {
	// what the tables above were printed from, unformatted
	type HarvestSetData = HarvestData['sets'][number];
	type HarvestCell = HarvestSetData['rows'][number]['sides'][string];
	// a side's name as an id, as `zod jitless` is `zod_jitless`
	const to_side_id = (side: string): string => side.replaceAll(' ', '_');
	const to_spread = (spread: number): number | null => (Number.isNaN(spread) ? null : spread);
	write_benchmark_data(args.data, 'harvest', {
		passes: args.passes,
		duration_ms: args.duration,
		warm_ms: WARM_MS,
		sets: timed_sets.map(
			({ set, bundle_sizes, rows, uncompiled, asides, sides, times }): HarvestSetData => {
				const to_cell = (side: string, row: string): HarvestCell => {
					if (side === HARVEST_ZOD_COMPILED && uncompiled.includes(row)) {
						const none = {
							none: 'uncompiled' as const,
							why: '`z.compile` hands the root back uncompiled'
						};
						return { time: none, bytes: none };
					}
					const { ns, median_ns } = times.get(side)!.get(row)!;
					const { median, spread } = to_pooled_timing(ns);
					return {
						time: {
							ns: median,
							batch_ns: to_pooled_timing(median_ns).median,
							spread: to_spread(spread)
						},
						bytes: { bytes: bytes.get(to_bytes_id(set, side))!.get(row)! }
					};
				};
				return {
					name: set.name,
					title: set.title,
					reference: set.reference.name,
					root: set.root,
					sides: sides.map((side) => ({ id: to_side_id(side), label: side })),
					bundles: Object.fromEntries([
						[to_side_id(set.reference.name), bundle_sizes.theirs],
						...bundle_sizes.their_modes.map(({ mode, size }) => [to_side_id(mode), size]),
						[to_side_id(HARVEST_OURS), bundle_sizes.ours]
					]),
					rows: rows.map((row) => ({
						name: row.name,
						valid: row.valid,
						sides: Object.fromEntries(
							sides.map((side) => [to_side_id(side), to_cell(side, row.name)])
						)
					})),
					asides: asides.map((aside) => {
						const { ns, median_ns } = times.get(HARVEST_ASIDES)!.get(aside.name)!;
						const { median, spread } = to_pooled_timing(ns);
						return {
							name: aside.name,
							ns: median,
							batch_ns: to_pooled_timing(median_ns).median,
							spread: to_spread(spread),
							bytes: bytes.get(to_bytes_id(set, HARVEST_ASIDES))!.get(aside.name)!
						};
					})
				};
			}
		)
	});
}
