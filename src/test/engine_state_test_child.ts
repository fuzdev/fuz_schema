/**
 * The process of `engine_state.test.ts`, run under `--allow-natives-syntax`
 * and `--expose-gc`, in one of three modes given as its argument:
 *
 * - `protectors` runs the program of `program.ts`, which uses every kind of
 *   schema, and then reads each of the engine's protectors
 * - `control` breaks one protector and reads them, which tells the test it
 *   reads them right
 * - `heap` parses a thousand distinct inputs through a few schemas, reads what
 *   the heap retains, parses a thousand more, and reads it again: the first
 *   thousand settle the engine's own code and feedback, so the second adds
 *   only what the library keeps of its inputs
 *
 * It writes one line of JSON to stdout, an `EngineStateOutput`.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { run_program } from '../benchmarks/program.ts';

export interface EngineStateOutput {
	/** By protector, whether it is intact, for those this engine has. */
	protectors?: Record<string, boolean>;
	/** Heap bytes retained after a thousand distinct inputs of each schema, and after a thousand more. */
	heap?: { first: number; second: number };
}

/**
 * The protectors a fast path of the engine depends on, each read by the
 * intrinsic of its name. One that is invalidated stays so for the life of the
 * process, and every function that relied on it is slower. A name this engine
 * doesn't have is left out of the output.
 */
export const PROTECTOR_NAMES = [
	'ArraySpeciesProtector',
	'NoElementsProtector',
	'MapIteratorProtector',
	'SetIteratorProtector',
	'StringIteratorProtector',
	'ArrayIteratorProtector',
	'IsConcatSpreadableProtector',
	'RegExpSpeciesProtector',
	'PromiseSpeciesProtector',
	'TypedArraySpeciesProtector',
	'StringWrapperToPrimitiveProtector',
	'NumberStringNotRegexpLikeProtector'
];

const read_protectors = (): Record<string, boolean> => {
	const read: Record<string, boolean> = {};
	for (const name of PROTECTOR_NAMES) {
		let intrinsic: () => boolean;
		try {
			// natives are not syntax a module can hold, so each is compiled from text
			// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
			intrinsic = new Function(`return %${name}()`) as () => boolean;
		} catch {
			continue;
		}
		read[name] = intrinsic();
	}
	return read;
};

const gc = (globalThis as unknown as { gc: () => void }).gc;

// what the heap holds once collected until it settles
const read_retained = (): number => {
	let used = Infinity;
	for (let i = 0; i < 10; i++) {
		gc();
		const next = process.memoryUsage().heapUsed;
		if (next >= used) return next;
		used = next;
	}
	return used;
};

const Item = s.object({ id: s.number, name: s.string, tags: s.array(s.string) });
const Kind = s.object({ kind: s.literal('other'), value: s.number });
interface Tree {
	value: number;
	children: Array<Tree>;
}
const Tree: s.Schema<Tree> = s.object({
	value: s.number,
	children: s.array(s.lazy(() => Tree))
});
const HEAP_SCHEMAS: Array<s.AnySchema> = [
	Item,
	s.strip_object({ id: s.number, name: s.string }),
	s.union([Item, Kind]),
	s.array(s.memo_union([Item, Kind])),
	s.record(Item),
	Tree
];

// the `i`th distinct input, valid or not, of each schema, made fresh from JSON text
const to_inputs = (i: number): Array<unknown> => {
	const item = { id: i, name: `n${i}`, tags: [`t${i}`, `u${i}`] };
	const bad = { id: `x${i}`, name: i, tags: [i] };
	const values = [
		item,
		bad,
		{ ...item, extra: i },
		bad,
		item,
		bad,
		[item, { kind: 'other', value: i }],
		[bad],
		{ [`k${i}`]: item, [`j${i}`]: item },
		{ [`k${i}`]: bad },
		{ value: i, children: [{ value: i + 1, children: [] }] },
		{ value: i, children: [{ value: `${i}`, children: [] }] }
	];
	return values.map((v) => JSON.parse(JSON.stringify(v)));
};

/** How many distinct inputs of each schema a batch parses. */
export const HEAP_INPUTS = 1000;

const parse_inputs = (count: number, from: number): void => {
	for (let i = from; i < from + count; i++) {
		const inputs = to_inputs(i);
		for (const [at, schema] of HEAP_SCHEMAS.entries()) {
			for (const input of inputs.slice(at * 2, at * 2 + 2)) {
				s.parse(schema, input);
				s.is(schema, input);
			}
		}
	}
};

const mode = process.argv[2];
const output: EngineStateOutput = {};
if (mode === 'protectors') {
	run_program(s, true);
	output.protectors = read_protectors();
} else if (mode === 'control') {
	// a subclass as the species of `Array`, which any code may do, and which
	// costs every `Array.prototype.map` of the process its fast path
	class Other extends Array {}
	Object.defineProperty(Array, Symbol.species, { value: Other });
	output.protectors = read_protectors();
} else if (mode === 'heap') {
	parse_inputs(HEAP_INPUTS, 0);
	const first = read_retained();
	parse_inputs(HEAP_INPUTS, HEAP_INPUTS);
	output.heap = { first, second: read_retained() };
} else {
	throw new Error(`no mode ${mode}`);
}
process.stdout.write(JSON.stringify(output) + '\n');
