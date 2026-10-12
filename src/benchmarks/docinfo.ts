/**
 * svelte-docinfo's schemas in valibot, as it has them, against the same in
 * this library: bundle size, parse time, and heap bytes allocated, on its own
 * output. The one comparison here of a real consumer's whole schema set, where
 * the scenarios in `scenarios.ts` are one small schema each.
 *
 * The data is its analysis of a whole library, stored as it writes it, with
 * the fields that have their defaults left out, so a parse fills them in. Each
 * row is run by both and their outputs compared before anything is timed.
 *
 * The two differ in what they promise: valibot returns a fresh copy of
 * everything, and this library returns what it was given wherever nothing
 * changed. `full` rows are the same data with every default in place, where
 * this library has nothing to copy.
 *
 * Usage (`npm run benchmark:docinfo` passes the node flags it needs):
 *   npm run benchmark:docinfo
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import * as v from 'valibot';

import * as s from '#lib/schema.ts';
import * as docinfo_valibot from './docinfo/docinfo_valibot.ts';
import { create_docinfo } from './docinfo/docinfo_fuz_schema.ts';
import { format_table, hold_benchmark_lock, measure_bytes, measure_ms } from './measure.ts';

hold_benchmark_lock('fuz_schema docinfo');

const to_path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const docinfo = create_docinfo(s);
const modules: Array<Record<string, unknown>> = JSON.parse(
	readFileSync(to_path('./docinfo/docinfo_fuz_ui.json'), 'utf8')
).modules;

//
// Bundle size
//

// The port takes the library as a parameter, which a bundler can't see
// through: handed the namespace, it keeps every export. So the bundle is built
// from the port's text with the parameter turned into an import.
const to_port_module = (): string => {
	const source = readFileSync(to_path('./docinfo/docinfo_fuz_schema.ts'), 'utf8');
	const open = 'export const create_docinfo = (s: SchemaLib): DocinfoSchemas => {\n';
	const close = /\n\treturn \{[^}]*\};\n\};\n$/;
	if (!source.includes(open) || !close.test(source)) {
		throw new Error('docinfo_fuz_schema.ts is not in the shape this script rewrites');
	}
	return (
		`import * as s from ${JSON.stringify(to_path('../lib/schema.ts'))};\n` +
		source
			.slice(source.indexOf(open) + open.length)
			.replace(close, '\nexport { ModuleJson };\n')
			.replaceAll('schema_lib.AnySchema', 's.AnySchema')
	);
};

const ENTRY_ID = 'virtual:docinfo_entry.ts';
const PORT_ID = 'virtual:docinfo_port.ts';

const measure_bundle = async (entry: string): Promise<{ minified: number; gzip: number }> => {
	const bundle = await rolldown({
		input: ENTRY_ID,
		platform: 'browser',
		logLevel: 'silent',
		plugins: [
			{
				name: 'virtual_entry',
				resolveId: (id) => (id === ENTRY_ID || id === PORT_ID ? id : null),
				load: (id) => (id === ENTRY_ID ? entry : id === PORT_ID ? to_port_module() : null)
			}
		]
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	if (output.length !== 1) throw new Error(`expected one chunk, got ${output.length}`);
	const code = output[0].code;
	return { minified: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
};

const bundles = {
	valibot: await measure_bundle(
		`import { safeParse } from 'valibot';
import { ModuleJson } from ${JSON.stringify(to_path('./docinfo/docinfo_valibot.ts'))};
export const run = (value) => safeParse(ModuleJson, value);`
	),
	fuz_schema: await measure_bundle(
		`import { parse } from ${JSON.stringify(to_path('../lib/schema.ts'))};
import { ModuleJson } from ${JSON.stringify(PORT_ID)};
export const run = (value) => parse(ModuleJson, value);`
	)
};

console.log('bundle: a module that parses one `ModuleJson`, minified, in bytes\n');
console.log(
	format_table([
		['', 'minified', 'gzip'],
		['valibot', String(bundles.valibot.minified), String(bundles.valibot.gzip)],
		['fuz_schema', String(bundles.fuz_schema.minified), String(bundles.fuz_schema.gzip)],
		[
			'ratio',
			(bundles.fuz_schema.minified / bundles.valibot.minified).toFixed(2) + 'x',
			(bundles.fuz_schema.gzip / bundles.valibot.gzip).toFixed(2) + 'x'
		]
	])
);

//
// Parse time and allocation
//

const to_json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const to_module = (path: string): Record<string, unknown> => {
	const found = modules.find((m) => m.path === path);
	if (!found) throw new Error(`no module ${path}`);
	return found;
};

const Modules_valibot = v.array(docinfo_valibot.ModuleJson);
const Modules = s.array(docinfo.ModuleJson);

const full = to_json(s.parse_or_throw(Modules, modules));
const broken = to_json(modules) as any;
broken.at(-1).declarations.at(-1).name = 1;

interface Row {
	name: string;
	valid: boolean;
	valibot: () => unknown;
	fuz_schema: () => unknown;
}

const to_row = (
	name: string,
	schema_valibot: v.GenericSchema,
	schema: s.AnySchema,
	input: unknown,
	valid = true
): Row => ({
	name,
	valid,
	valibot: () => {
		const result = v.safeParse(schema_valibot, input);
		return result.success ? result.output : undefined;
	},
	fuz_schema: () => {
		const result = s.parse(schema, input);
		return result.ok ? result.value : undefined;
	}
});

const rows: Array<Row> = [
	to_row('a component', docinfo_valibot.ModuleJson, docinfo.ModuleJson, to_module('Dialog.svelte')),
	to_row(
		'a component, full',
		docinfo_valibot.ModuleJson,
		docinfo.ModuleJson,
		to_json(s.parse_or_throw(docinfo.ModuleJson, to_module('Dialog.svelte')))
	),
	to_row(
		'a class',
		docinfo_valibot.ModuleJson,
		docinfo.ModuleJson,
		to_module('declaration.svelte.ts')
	),
	to_row('the library', Modules_valibot, Modules, modules),
	to_row('the library, full', Modules_valibot, Modules, full),
	to_row('the library, last name bad', Modules_valibot, Modules, broken, false),
	{
		name: 'the library, full, as a guard',
		valid: true,
		valibot: () => (v.is(Modules_valibot, full) ? full : undefined),
		fuz_schema: () => (s.is(Modules, full) ? full : undefined)
	}
];

for (const row of rows) {
	const a = row.valibot();
	const b = row.fuz_schema();
	if ((a !== undefined) !== row.valid || (b !== undefined) !== row.valid) {
		throw new Error(`${row.name}: expected valid=${row.valid}`);
	}
	if (!isDeepStrictEqual(a, b)) throw new Error(`${row.name}: the outputs differ`);
}

const format_number = (n: number): string =>
	n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

console.log(
	'\nparse: median microseconds and heap bytes per parse, and this library over valibot\n'
);
const table = [['', 'valibot us', 'fuz us', 'time', 'valibot B', 'fuz B', 'alloc']];
for (const row of rows) {
	for (let i = 0; i < 300; i++) {
		row.valibot();
		row.fuz_schema();
	}
	const batch = Math.max(1, Math.round(2 / measure_ms(row.fuz_schema, 20, 3)));
	// alternated, so neither always follows the other
	const times = { valibot: [] as Array<number>, fuz_schema: [] as Array<number> };
	for (let round = 0; round < 9; round++) {
		for (const lib of round % 2
			? (['valibot', 'fuz_schema'] as const)
			: (['fuz_schema', 'valibot'] as const)) {
			times[lib].push(measure_ms(row[lib], batch, 1));
		}
	}
	const median = (values: Array<number>): number =>
		values.toSorted((a, b) => a - b)[values.length >> 1]!;
	const us = { valibot: median(times.valibot) * 1000, fuz_schema: median(times.fuz_schema) * 1000 };
	const bytes = { valibot: measure_bytes(row.valibot), fuz_schema: measure_bytes(row.fuz_schema) };
	table.push([
		row.name,
		format_number(us.valibot),
		format_number(us.fuz_schema),
		(us.fuz_schema / us.valibot).toFixed(2) + 'x',
		format_number(bytes.valibot),
		format_number(bytes.fuz_schema),
		(bytes.fuz_schema / bytes.valibot).toFixed(2) + 'x'
	]);
}
console.log(format_table(table));
console.log(
	'\nvalibot returns a fresh copy of everything; this library returns its input where nothing\n' +
		'changed, which is all of a `full` row: those compare a copy with a check.'
);
