import { describe, test, assert, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { find_uncovered_shape_exports } from './shape_test_helpers.ts';
import type { ShapeChildOutput } from './shape_test_child.ts';

// Every schema is `{kind, def, run}` to the engine: one map, whose fields are
// never written after a schema is made. A second map makes every `schema.run`
// load in the library polymorphic. A write to one schema's `run` makes that
// field mutable for every schema, as they share the map, and the engine then
// loads it on calls it had folded. Neither changes what a parse returns, and
// `npm run grade` sees neither, as its two versions share a process.
//
// The engine is asked in a process of its own, under `--allow-natives-syntax`:
// `%HaveSameMap` for the map, and for the fields what `%DebugPrint` prints of
// a schema, which has no other way out. That print is the engine's own format,
// so the process prints two controls first, an object nothing wrote to and
// then the same map after a write, and a test here fails when they don't read
// as that: a format this can't read fails, and never passes.

const CHILD_PATH = fileURLToPath(new URL('./shape_test_child.ts', import.meta.url));
const SCHEMA_FIELDS = ['kind', 'def', 'run'];
const CONTROL_FIELDS = ['shape_control_a', 'shape_control_b', 'shape_control_c'];

interface PrintedField {
	name: string;
	index: number;
	constant: boolean;
}

// the fields of one printed object: a line each, as
// `#run: 0x... <JSFunction run> (const data field 2, attrs: [WEC]) @ Any`,
// where a field that has been written to is a `data field` with no `const`
const read_fields = (block: string, names: Array<string>): Array<PrintedField> =>
	Array.from(
		block.matchAll(
			new RegExp(
				String.raw`^\s*(?:0x[0-9a-f]+: \[String\]: )?#(${names.join('|')}): .*\((const )?data field (\d+)[,)]`,
				'gm'
			)
		),
		(m) => ({ name: m[1]!, index: Number(m[3]), constant: !!m[2] })
	);

const format_fields = (fields: Array<PrintedField>): string =>
	fields.map((f) => `${f.name} ${f.constant ? 'const' : 'written to'}`).join(', ') ||
	'no field read';

const is_all = (fields: Array<PrintedField>, names: Array<string>, written = -1): boolean =>
	fields.length === names.length &&
	fields.every((f, i) => f.name === names[i] && f.index === i && f.constant === (i !== written));

let output: ShapeChildOutput;
let blocks: Array<string>;

beforeAll(async () => {
	const { stdout, stderr } = await promisify(execFile)(
		process.execPath,
		['--allow-natives-syntax', CHILD_PATH],
		{ maxBuffer: 2 ** 28 }
	);
	output = JSON.parse(stderr.trim().split('\n').at(-1)!);
	blocks = stdout.split(/^DebugPrint: /m).slice(1);
});

describe('schema shape', () => {
	test('every export of schema.ts that is or makes a schema has a sample', () => {
		assert.deepEqual(find_uncovered_shape_exports(), []);
	});

	test('every sample is run, and matches what it says', () => {
		assert.isAbove(output.names.length, 0);
		assert.deepEqual(output.wrong, []);
	});

	test('every schema has the keys kind, def, run, in that order', () => {
		assert.deepEqual(output.other_keys, []);
	});

	test('every schema has the one map', () => {
		assert.deepEqual(output.other_map, [], 'schemas whose map is not the one `string` has');
	});

	test('the print of an object is read: its fields, and which were written to', () => {
		const hint =
			`the format of %DebugPrint is not the one this test reads, on Node ${process.version}: ` +
			'update `read_fields`';
		assert.strictEqual(blocks.length, output.names.length + 2, `${hint}, which found no objects`);
		const untouched = read_fields(blocks[0]!, CONTROL_FIELDS);
		const written = read_fields(blocks[1]!, CONTROL_FIELDS);
		assert(
			is_all(untouched, CONTROL_FIELDS),
			`${hint}. An object never written to read as: ${format_fields(untouched)}`
		);
		assert(
			is_all(written, CONTROL_FIELDS, 2),
			`${hint}. An object whose last field was written to read as: ${format_fields(written)}`
		);
	});

	test('no field of a schema has been written to', () => {
		assert.strictEqual(blocks.length, output.names.length + 2);
		const not_const: Array<string> = [];
		for (const [i, name] of output.names.entries()) {
			// which fields a schema has, and in what order, is another test's
			const fields = read_fields(blocks[i + 2]!, SCHEMA_FIELDS);
			if (!fields.length || fields.some((f) => !f.constant)) {
				not_const.push(`${name}: ${format_fields(fields)}`);
			}
		}
		// every schema shares the map, so one write shows on all of them
		assert.deepEqual(
			not_const.slice(0, 8),
			[],
			`a field the engine no longer holds constant, on ${not_const.length} of ` +
				`${output.names.length} schemas: something wrote to a schema, and they share the map`
		);
	});
});
