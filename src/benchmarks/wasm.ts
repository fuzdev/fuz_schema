/**
 * The wasm build of the Rust crate against the library, on the question both
 * answer: does this JSON text match the schema?
 *
 * The schema is an array of the `strict_nested` scenario's object. The
 * payloads are generated: one item, about 10 KB, and about 4 MB, each valid,
 * with a bad first element, and with a bad last element, though the one item
 * has no last, and the large size again with strings that are mostly not ASCII.
 *
 * A caller holds the text one of two ways, and each is compared only with
 * itself:
 *
 * - **a string**: `JSON.parse` then `is`, against `is_json`, which the glue
 *   transcodes to UTF-8, and against `encodeInto` the handle's buffer then
 *   `is_json_input`
 * - **bytes**: a decode, then `JSON.parse` then `is`, against `is_json_bytes`,
 *   which the glue copies in, against a copy into the handle's buffer then
 *   `is_json_input`, and against `is_json_input` alone, which is what a source
 *   that writes into the buffer itself would pay
 *
 * `JSON.parse` alone and `is` alone are there to read the others by. For a
 * valid payload so is the wasm verdict followed by `JSON.parse`, the cost when
 * the value is wanted after all.
 *
 * Before anything is timed, every row's verdict is asserted, and every shared
 * fixture under `src/test/fixtures/json/` is run through each entry point of
 * the wasm handle against the divergences the Rust tests assert.
 *
 * The summary at the end is of the large payloads, each figure a wasm row's
 * time over the JS of its holding. The stop signal is the payload with a bad
 * first element, ASCII and then not, which measures early exit: the wasm stops
 * validating at the bad element, after transcoding a string whole, and the JS
 * parses the whole text first. Beside it are the
 * equal-work figures, the rows that hold bytes on the valid payloads and those
 * with a bad last element, where both sides read the whole text.
 *
 * Needs the wasm built, `npm run build:wasm`, and newer than what it is built
 * from. Otherwise it prints NOT RUN and exits with 1.
 *
 * Usage:
 *   node src/benchmarks/wasm.ts
 *   node src/benchmarks/wasm.ts --rounds 31 --round-ms 50
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { args_parse, argv_parse } from '@fuzdev/fuz_util/args.ts';

import * as s from '#lib/schema.ts';
import { to_schema_json } from '../test/schema_json.ts';
import {
	load_json_fixture,
	load_json_fixture_names,
	read_json_fixture_expected,
	type JsonDivergence,
	type JsonFixtureCase,
	type JsonFixtureExpected
} from '../test/fixtures/json/json_test_helpers.ts';
import { SCENARIOS } from './scenarios.ts';
import { format_table, hold_benchmark_lock, median } from './measure.ts';

const Args = z.strictObject({
	_: z.array(z.string()).default([]),
	rounds: z
		.number()
		.int()
		.min(1)
		.default(15)
		.meta({ description: 'timings per row, the median is reported' }),
	'round-ms': z
		.number()
		.positive()
		.default(20)
		.meta({ description: 'ms one timing of a row aims to take' })
});

const parsed = args_parse(argv_parse(process.argv.slice(2)), Args);
if (!parsed.success) {
	console.error(z.prettifyError(parsed.error));
	process.exit(1);
}
const args = parsed.data;

const ROOT_DIR = join(import.meta.dirname, '../..');
const WASM_DIR = join(ROOT_DIR, 'target/fuz_schema_wasm');
const WASM_PATH = join(WASM_DIR, 'fuz_schema_wasm_bg.wasm');
const GLUE_PATH = join(WASM_DIR, 'fuz_schema_wasm.js');
const BUILD_COMMAND = 'npm run build:wasm';

const not_run = (reason: string): never => {
	console.error(`NOT RUN: ${reason}\nbuild it with: ${BUILD_COMMAND}`);
	process.exit(1);
};

// what the wasm is built from: the toolchain pin, the build command, every Rust
// source and manifest, and the lockfile
const find_wasm_sources = (): Array<string> => [
	join(ROOT_DIR, 'rust-toolchain.toml'),
	join(ROOT_DIR, 'package.json'),
	join(ROOT_DIR, 'Cargo.lock'),
	join(ROOT_DIR, 'Cargo.toml'),
	...readdirSync(join(ROOT_DIR, 'crates'), { recursive: true, encoding: 'utf8' })
		.filter((path) => path.endsWith('.rs') || path.endsWith('Cargo.toml'))
		.map((path) => join(ROOT_DIR, 'crates', path))
];

if (!existsSync(WASM_PATH) || !existsSync(GLUE_PATH)) {
	not_run(`there is no wasm at ${relative(ROOT_DIR, WASM_DIR)}`);
}
const wasm_mtime = statSync(WASM_PATH).mtimeMs;
for (const source of find_wasm_sources()) {
	if (statSync(source).mtimeMs > wasm_mtime) {
		not_run(`the wasm is older than ${relative(ROOT_DIR, source)}`);
	}
}

/** The handle the wasm crate exports, as its generated glue has it. */
interface WasmCompiledSchema {
	is_json: (text: string) => boolean;
	is_json_bytes: (bytes: Uint8Array) => boolean;
	input_ptr: (len: number) => number;
	is_json_input: (len: number) => boolean;
	free: () => void;
}

/**
 * The generated glue, which is not there to import when the wasm is not built,
 * so it is imported by a computed path and typed here.
 */
interface WasmGlue {
	initSync: (input: { module: Uint8Array }) => { memory: WebAssembly.Memory };
	CompiledSchema: new (schema_json: string) => WasmCompiledSchema;
}

const wasm_file = readFileSync(WASM_PATH);
const glue: WasmGlue = await import(pathToFileURL(GLUE_PATH).href);
const { CompiledSchema } = glue;
const { memory } = glue.initSync({ module: wasm_file });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// the three ways a text gets from a string or bytes to a verdict through the
// buffer a handle lends

/** `input_ptr`, which answers `0` when the memory cannot hold `len` bytes. */
const wasm_input_ptr = (handle: WasmCompiledSchema, len: number): number => {
	const ptr = handle.input_ptr(len);
	if (ptr === 0) throw Error(`the wasm memory cannot hold an input of ${len} bytes`);
	return ptr;
};

const wasm_set_input = (handle: WasmCompiledSchema, bytes: Uint8Array): void => {
	const ptr = wasm_input_ptr(handle, bytes.length);
	// the view is made after `input_ptr`, which can grow the memory and so detach an older one
	new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
};

const wasm_is_json_set = (handle: WasmCompiledSchema, bytes: Uint8Array): boolean => {
	wasm_set_input(handle, bytes);
	return handle.is_json_input(bytes.length);
};

const wasm_is_json_encode_into = (handle: WasmCompiledSchema, text: string): boolean => {
	// a UTF-16 code unit is at most three bytes of UTF-8
	const capacity = text.length * 3;
	const ptr = wasm_input_ptr(handle, capacity);
	const { written } = encoder.encodeInto(text, new Uint8Array(memory.buffer, ptr, capacity));
	return handle.is_json_input(written);
};

const to_bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

const fail = (message: string): never => {
	console.error(`pre-check failed: ${message}`);
	process.exit(1);
};

// what the wasm entry points say of a fixture case that declares a divergence,
// by the streaming column of the table in `crates/fuz_schema/tests/fixtures.rs`,
// with an error collapsed to `false`: `oracle` is the library's verdict
const WASM_DIVERGENCES: Record<JsonDivergence, 'oracle' | 'false'> = {
	duplicate_keys: 'false',
	malformed_tail: 'false',
	number_overflow: 'false',
	lone_surrogate: 'false',
	depth_limit: 'false',
	number_overflow_unread: 'oracle',
	lone_surrogate_unread: 'oracle',
	depth_limit_unread: 'oracle'
};

const expect_of_fixture_case = (c: JsonFixtureCase): boolean => {
	// a text `JSON.parse` throws on is an error in the crate, so `false` here
	const oracle = c.json && c.valid === true;
	if (c.diverges === undefined) return oracle;
	const declared = WASM_DIVERGENCES[c.diverges] as 'oracle' | 'false' | undefined;
	if (declared === undefined) return fail(`unknown divergence ${c.diverges}`);
	return declared === 'oracle' ? oracle : false;
};

const check_fixtures = async (): Promise<{ groups: number; cases: number }> => {
	const failures: Array<string> = [];
	const names = await load_json_fixture_names();
	let cases = 0;
	for (const name of names) {
		const text = await read_json_fixture_expected(name);
		if (text === null) return fail(`fixture group ${name} has no expected.json`);
		const expected: JsonFixtureExpected = JSON.parse(text);
		// the schema as a caller would bring it across, from the TypeScript schema
		const schema_json = JSON.stringify(to_schema_json((await load_json_fixture(name)).schema));
		if (schema_json !== JSON.stringify(expected.schema)) {
			return fail(`fixture group ${name} has a stale expected.json`);
		}
		const handle = new CompiledSchema(schema_json);
		for (const c of expected.cases) {
			cases++;
			const expect = expect_of_fixture_case(c);
			const bytes = to_bytes(c.text);
			const actual = {
				is_json: handle.is_json(c.text),
				is_json_bytes: handle.is_json_bytes(bytes),
				is_json_input: wasm_is_json_set(handle, bytes),
				'encodeInto + is_json_input': wasm_is_json_encode_into(handle, c.text)
			};
			for (const [entry, verdict] of Object.entries(actual)) {
				if (verdict !== expect) {
					failures.push(`${name}/${c.name}: ${entry} is ${verdict}, expected ${expect}`);
				}
			}
		}
		handle.free();
	}
	if (!names.length || !cases) return fail('there are no fixtures');
	if (failures.length) return fail(`${failures.length} fixture cases\n${failures.join('\n')}`);
	return { groups: names.length, cases };
};

/**
 * The one divergence that is the wasm boundary's and not the crate's: a
 * JavaScript string can hold half a surrogate pair, UTF-8 cannot, and an
 * encoder writes U+FFFD for it. No fixture can hold such a text, so it is
 * asserted here.
 */
const check_lone_surrogate = (): void => {
	const text = '"\ud800"';
	const replaced = new CompiledSchema(JSON.stringify(to_schema_json(s.literal('�'))));
	const any_string = new CompiledSchema(JSON.stringify(to_schema_json(s.string)));
	const checks: Array<[what: string, actual: boolean, expect: boolean]> = [
		['the library on a lone surrogate', s.is(s.literal('�'), JSON.parse(text)), false],
		// looser than the library: the text is read as though U+FFFD were written
		['is_json on a lone surrogate', replaced.is_json(text), true],
		['encodeInto on a lone surrogate', wasm_is_json_encode_into(replaced, text), true],
		['is_json of a string with a lone surrogate', any_string.is_json(text), true],
		// and bytes that hold one as it is are not UTF-8
		[
			'is_json_bytes on a lone surrogate',
			any_string.is_json_bytes(Uint8Array.of(0x22, 0xed, 0xa0, 0x80, 0x22)),
			false
		]
	];
	for (const [what, actual, expect] of checks) {
		if (actual !== expect) fail(`${what} is ${actual}, expected ${expect}`);
	}
	replaced.free();
	any_string.free();
};

/**
 * A length no memory of the module can hold gets `0` from `input_ptr`, and
 * neither a trap nor a handle that no longer answers.
 */
const check_input_ptr_refusal = (): void => {
	const text = '"held"';
	const bytes = to_bytes(text);
	const handle = new CompiledSchema(JSON.stringify(to_schema_json(s.string)));
	try {
		wasm_set_input(handle, bytes);
		const refused = handle.input_ptr(2 ** 32 - 1);
		if (refused !== 0) fail(`input_ptr of more than the memory can hold is ${refused}`);
		const checks: Array<[what: string, actual: boolean, expect: boolean]> = [
			// the buffer is as it was, with the bytes written before
			['is_json_input after a refused input_ptr', handle.is_json_input(bytes.length), true],
			['is_json after a refused input_ptr', handle.is_json(text), true],
			['is_json_bytes after a refused input_ptr', handle.is_json_bytes(bytes), true],
			['a set after a refused input_ptr', wasm_is_json_set(handle, to_bytes('7')), false],
			['encodeInto after a refused input_ptr', wasm_is_json_encode_into(handle, text), true]
		];
		for (const [what, actual, expect] of checks) {
			if (actual !== expect) fail(`${what} is ${actual}, expected ${expect}`);
		}
	} catch (error) {
		fail(`a refused input_ptr threw: ${String(error)}`);
	}
	handle.free();
};

// the object of the `strict_nested` scenario in `libs/fuz_schema.ts`, which
// `check_item_schema` holds to that scenario's inputs
const Item = s.object({
	id: s.number,
	name: s.string,
	tags: s.array(s.string),
	address: s.object({ street: s.string, city: s.string, zip: s.string })
});
type Item = s.Infer<typeof Item>;
const Items = s.array(Item);

const check_item_schema = (): void => {
	const scenario = SCENARIOS.find((scenario) => scenario.name === 'strict_nested');
	if (!scenario) return fail('there is no strict_nested scenario');
	if (!s.is(Item, scenario.valid) || s.is(Item, scenario.invalid)) {
		fail('the item schema is not the strict_nested scenario');
	}
};

const pick = <T>(values: ReadonlyArray<T>, i: number): T => values[i % values.length]!;

const ASCII = {
	names: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Donald'],
	tags: ['math', 'engines', 'notes', 'letters', 'tables', 'proofs', 'looms'],
	streets: ['12 St James Square', '5 Cumberland Road', '80 Prinsengracht'],
	cities: ['London', 'Arlington', 'Rotterdam', 'Cambridge'],
	zips: ['SW1Y 4JH', '22201', '3011 AB', '02139']
};

const NON_ASCII = {
	names: ['Зинаида Ершова', '石川 啄木', 'Ελένη Γλύκατζη', 'Øyvind Ødegård', 'عمر الخيام'],
	tags: ['数学', 'машины', 'σημειώσεις', 'écriture', 'ノート', 'таблицы', '証明'],
	streets: ['千代田区丸の内一丁目', 'Невский проспект, 28', 'Οδός Ερμού 15'],
	cities: ['東京', 'Санкт-Петербург', 'Αθήνα', 'Tromsø'],
	zips: ['〒100-0005', '191186', '105 63', '9008']
};

const make_item = (i: number, words: typeof ASCII): Item => ({
	id: i,
	name: `${pick(words.names, i)} ${i}`,
	tags: [pick(words.tags, i), pick(words.tags, i + 2), pick(words.tags, i * 3 + 1)],
	address: {
		street: pick(words.streets, i),
		city: pick(words.cities, i),
		zip: pick(words.zips, i)
	}
});

// what the `strict_nested` scenario's invalid input gets wrong: a tag and the zip
const break_item = (item: Item): unknown => ({
	...item,
	tags: [item.tags[0], 7, item.tags[2]],
	address: { ...item.address, zip: 12345 }
});

type Outcome = 'valid' | 'first_bad' | 'last_bad';

interface Payload {
	size: string;
	outcome: Outcome;
	text: string;
	bytes: Uint8Array;
	items: number;
}

/**
 * The payloads of one size: items made until their text is `target_bytes` of
 * UTF-8, and one item at least, then a text per outcome.
 */
const make_payloads = (size: string, target_bytes: number, words: typeof ASCII): Array<Payload> => {
	const items: Array<Item> = [];
	let length = 2;
	do {
		const item = make_item(items.length, words);
		items.push(item);
		length += Buffer.byteLength(JSON.stringify(item)) + 1;
	} while (length < target_bytes);
	// one item is both the first and the last
	const outcomes: Array<Outcome> =
		items.length > 1 ? ['valid', 'first_bad', 'last_bad'] : ['valid', 'first_bad'];
	return outcomes.map((outcome) => {
		const bad = outcome === 'first_bad' ? 0 : outcome === 'last_bad' ? items.length - 1 : -1;
		const text = JSON.stringify(items.map((item, i) => (i === bad ? break_item(item) : item)));
		return { size, outcome, text, bytes: to_bytes(text), items: items.length };
	});
};

type Holding = 'string' | 'bytes';

interface Row {
	holding: Holding | null;
	side: 'js' | 'wasm' | 'reference';
	label: string;
	run: () => unknown;
	/** What `run` returns, for the rows that return a verdict. */
	verdict: boolean | null;
}

const LABEL_IS_JSON = 'wasm is_json(text)';
const LABEL_ENCODE_INTO = 'wasm encodeInto, is_json_input';
const LABEL_IS_JSON_BYTES = 'wasm is_json_bytes(bytes)';
const LABEL_SET = 'wasm set, is_json_input';
const LABEL_IN_PLACE = 'wasm is_json_input, bytes in place';

const items_json = JSON.stringify(to_schema_json(Items));
const handle = new CompiledSchema(items_json);
// its own handle, so that no other row writes over the bytes it has in place
const handle_in_place = new CompiledSchema(items_json);

const make_rows = (payload: Payload): Array<Row> => {
	const { text, bytes, outcome } = payload;
	const expect = outcome === 'valid';
	const value: unknown = JSON.parse(text);
	const node_buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	wasm_set_input(handle_in_place, bytes);
	const length = bytes.length;
	const rows: Array<Row> = [
		{
			holding: null,
			side: 'reference',
			label: 'JSON.parse(text)',
			run: () => JSON.parse(text),
			verdict: null
		},
		{
			holding: null,
			side: 'reference',
			label: 'is(value), parsed already',
			run: () => s.is(Items, value),
			verdict: expect
		},
		{
			holding: 'string',
			side: 'js',
			label: 'JSON.parse, is',
			run: () => s.is(Items, JSON.parse(text)),
			verdict: expect
		},
		{
			holding: 'string',
			side: 'wasm',
			label: LABEL_IS_JSON,
			run: () => handle.is_json(text),
			verdict: expect
		},
		{
			holding: 'string',
			side: 'wasm',
			label: LABEL_ENCODE_INTO,
			run: () => wasm_is_json_encode_into(handle, text),
			verdict: expect
		},
		{
			holding: 'bytes',
			side: 'js',
			label: 'TextDecoder, JSON.parse, is',
			run: () => s.is(Items, JSON.parse(decoder.decode(bytes))),
			verdict: expect
		},
		{
			holding: 'bytes',
			side: 'js',
			label: 'Buffer.toString, JSON.parse, is',
			run: () => s.is(Items, JSON.parse(node_buffer.toString('utf8'))),
			verdict: expect
		},
		{
			holding: 'bytes',
			side: 'wasm',
			label: LABEL_IS_JSON_BYTES,
			run: () => handle.is_json_bytes(bytes),
			verdict: expect
		},
		{
			holding: 'bytes',
			side: 'wasm',
			label: LABEL_SET,
			run: () => wasm_is_json_set(handle, bytes),
			verdict: expect
		},
		{
			holding: 'bytes',
			side: 'wasm',
			label: LABEL_IN_PLACE,
			run: () => handle_in_place.is_json_input(length),
			verdict: expect
		}
	];
	if (expect) {
		rows.push(
			{
				holding: 'string',
				side: 'reference',
				label: 'wasm is_json(text), then JSON.parse',
				run: () => (handle.is_json(text) ? JSON.parse(text) : null),
				verdict: null
			},
			{
				holding: 'bytes',
				side: 'reference',
				label: 'wasm is_json_bytes(bytes), then TextDecoder, JSON.parse',
				run: () => (handle.is_json_bytes(bytes) ? JSON.parse(decoder.decode(bytes)) : null),
				verdict: null
			}
		);
	}
	return rows;
};

const name_payload = (payload: Payload): string => `${payload.size}, ${payload.outcome}`;

const check_rows = (payload: Payload, rows: Array<Row>): void => {
	for (const row of rows) {
		const actual = row.run();
		if (row.verdict === null) {
			if (actual === null) fail(`${name_payload(payload)}: ${row.label} has no value`);
		} else if (actual !== row.verdict) {
			fail(`${name_payload(payload)}: ${row.label} is ${String(actual)}`);
		}
	}
};

let sink = 0;

const time_batch = (run: () => unknown, batch: number): number => {
	const start = performance.now();
	for (let i = 0; i < batch; i++) {
		if (run()) sink++;
	}
	return (performance.now() - start) / batch;
};

const WARMUP_MS = 100;

/**
 * Times every row, a round at a time so that the rows share whatever the
 * machine is doing, and each round starting a row later than the one before.
 *
 * @returns each row's milliseconds per call, a round each
 */
const time_rows = (rows: Array<Row>): Array<Array<number>> => {
	const batches = rows.map((row) => {
		const start = performance.now();
		let calls = 0;
		do {
			if (row.run()) sink++;
			calls++;
		} while (performance.now() - start < WARMUP_MS);
		// sized from the warmed row, so one timing is well above timer resolution
		const per_call = time_batch(row.run, Math.min(calls, 100));
		return Math.max(1, Math.round(args['round-ms'] / per_call));
	});
	const samples: Array<Array<number>> = rows.map(() => []);
	for (let round = 0; round < args.rounds; round++) {
		for (let n = 0; n < rows.length; n++) {
			const i = (n + round) % rows.length;
			samples[i]!.push(time_batch(rows[i]!.run, batches[i]!));
		}
	}
	return samples;
};

const format_us = (ms: number): string => {
	const us = ms * 1000;
	return us >= 100 ? us.toFixed(0) : us >= 1 ? us.toFixed(2) : us.toFixed(3);
};

const format_ratio = (ratio: number): string => `${ratio.toFixed(2)}x`;

/** A wasm row's median over the fastest JS row's of the same holding. */
type Ratios = Map<string, number>;

const report_payload = (payload: Payload): Ratios => {
	const rows = make_rows(payload);
	check_rows(payload, rows);
	const samples = time_rows(rows);
	const medians = samples.map((sample) => median(sample));
	const fastest_js = (holding: Holding): number =>
		Math.min(...medians.filter((_, i) => rows[i]!.side === 'js' && rows[i]!.holding === holding));
	const ratios: Ratios = new Map();
	const table = [['holding', 'row', 'median µs', 'min µs', 'vs JS']];
	rows.forEach((row, i) => {
		let ratio = '';
		if (row.side === 'wasm' && row.holding) {
			const value = medians[i]! / fastest_js(row.holding);
			ratios.set(row.label, value);
			ratio = format_ratio(value);
		}
		table.push([
			row.holding ?? '',
			row.label,
			format_us(medians[i]!),
			format_us(Math.min(...samples[i]!)),
			ratio
		]);
	});
	const items = `${payload.items} ${payload.items === 1 ? 'item' : 'items'}`;
	console.log(
		`\n${name_payload(payload)}: ${items}, ${payload.bytes.length} bytes of UTF-8, ${payload.text.length} UTF-16 code units\n`
	);
	console.log(format_table(table, 2));
	return ratios;
};

check_item_schema();
const checked = await check_fixtures();
check_lone_surrogate();
check_input_ptr_refusal();
console.log(
	`pre-checks pass: ${checked.cases} cases of ${checked.groups} fixture groups through every wasm entry point, the lone surrogate, and a refused input_ptr`
);

hold_benchmark_lock('fuz_schema wasm');

const LARGE = '4 MB';
const LARGE_NON_ASCII = `${LARGE} non-ASCII`;
const payloads = [
	...make_payloads('1 item', 0, ASCII),
	...make_payloads('10 KB', 10_000, ASCII),
	...make_payloads(LARGE, 4_000_000, ASCII),
	...make_payloads(LARGE_NON_ASCII, 4_000_000, NON_ASCII)
];

console.log(
	`\nwasm against the library, node ${process.version}, median of ${args.rounds} rounds\n` +
		'"vs JS" is a wasm row over the fastest JS row of the same holding, under 1 is faster'
);

// the ratios of the large payloads, which the summary is made of
const large_ratios: Map<string, Ratios> = new Map();
for (const payload of payloads) {
	const ratios = report_payload(payload);
	if (payload.size === LARGE || payload.size === LARGE_NON_ASCII) {
		large_ratios.set(name_payload(payload), ratios);
	}
}

console.log(`\nsink: ${sink}`);

const format_large_ratio = (size: string, outcome: Outcome, label: string): string => {
	const ratio = large_ratios.get(`${size}, ${outcome}`)?.get(label);
	if (ratio === undefined) throw Error(`the ${size}, ${outcome} payload has no ${label} row`);
	return format_ratio(ratio);
};

const SUMMARY_ROWS: Array<[holding: Holding, label: string]> = [
	['string', LABEL_IS_JSON],
	['string', LABEL_ENCODE_INTO],
	['bytes', LABEL_IS_JSON_BYTES],
	['bytes', LABEL_SET],
	['bytes', LABEL_IN_PLACE]
];

console.log(
	'\nsummary: wasm time over JS time, under 0.90x is a win, and a difference under 10% is noise'
);

// the wasm stops validating at the bad element, and the JS parses the whole
// text first
console.log('\nstop signal: a bad first element, which measures early exit\n');
console.log(
	format_table(
		[
			['holding', 'row', LARGE, LARGE_NON_ASCII],
			...SUMMARY_ROWS.map(([holding, label]) => [
				holding,
				label,
				format_large_ratio(LARGE, 'first_bad', label),
				format_large_ratio(LARGE_NON_ASCII, 'first_bad', label)
			])
		],
		2
	)
);

const EQUAL_WORK_PAYLOADS: Array<[size: string, outcome: Outcome]> = [
	[LARGE, 'valid'],
	[LARGE, 'last_bad'],
	[LARGE_NON_ASCII, 'valid'],
	[LARGE_NON_ASCII, 'last_bad']
];

console.log('\nequal work: both sides read the whole text, holding bytes\n');
console.log(
	format_table([
		['row', ...EQUAL_WORK_PAYLOADS.map(([size, outcome]) => `${size}, ${outcome}`)],
		...SUMMARY_ROWS.filter(([holding]) => holding === 'bytes').map(([, label]) => [
			label,
			...EQUAL_WORK_PAYLOADS.map(([size, outcome]) => format_large_ratio(size, outcome, label))
		])
	])
);
console.log(
	`\nwasm size: ${wasm_file.length} bytes, ${gzipSync(wasm_file, { level: 9 }).length} gzipped`
);
