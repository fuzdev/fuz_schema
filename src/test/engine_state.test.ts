import { describe, test, assert } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { EngineStateOutput } from './engine_state_test_child.ts';

// What the library may not do to the engine a process shares, asked in
// processes of their own, `engine_state_test_child.ts`, under
// `--allow-natives-syntax` and `--expose-gc`.
//
// A protector is a promise the engine keeps about the built-ins, that no one
// has replaced `Array`'s species or put elements on `Array.prototype`. Code
// that breaks one costs every fast path that relied on it, in the whole
// process and for its life, and the grader's two versions share a process, so
// it reads as no difference. The `apart` regime would see it only on a case
// that leaned on that path.
//
// A cache that holds what a parse was given grows with the count of distinct
// inputs, which no timing sees and a long-running server pays in memory.

const CHILD_PATH = fileURLToPath(new URL('./engine_state_test_child.ts', import.meta.url));

// the protectors Node 26.13's engine has, which the child must read: one gone
// from a later engine fails here, and is taken off the list
const KNOWN_PROTECTORS = [
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
	'StringWrapperToPrimitiveProtector'
];

// what the heap may grow by over the second thousand inputs: the engine's own
// bookkeeping is 10 to 30 KB over a thousand inputs on Node 24 and 26 with the
// library unchanged, whatever strings the inputs hold, and a strong map of one
// schema's thousand inputs is about 200 KB; a map of a thousand small keys
// still passes
const HEAP_SLACK = 96 * 1024;

const run_child = async (mode: string): Promise<EngineStateOutput> => {
	const { stdout } = await promisify(execFile)(process.execPath, [
		'--allow-natives-syntax',
		'--expose-gc',
		CHILD_PATH,
		mode
	]);
	return JSON.parse(stdout.trim().split('\n').at(-1)!);
};

describe('engine state', () => {
	test('a broken protector reads as broken, and the rest as intact', async () => {
		const { protectors } = await run_child('control');
		assert(protectors);
		for (const name of KNOWN_PROTECTORS) assert(name in protectors, `${name} is not read`);
		assert.strictEqual(protectors.ArraySpeciesProtector, false);
		assert.strictEqual(protectors.NoElementsProtector, true);
	});

	test('every protector is intact after the program uses every kind of schema', async () => {
		const { protectors } = await run_child('protectors');
		assert(protectors);
		for (const name of KNOWN_PROTECTORS) assert(name in protectors, `${name} is not read`);
		assert.deepEqual(
			Object.entries(protectors)
				.filter(([, intact]) => !intact)
				.map(([name]) => name),
			[]
		);
	});

	test('the heap does not grow with the count of distinct inputs', async () => {
		const { heap } = await run_child('heap');
		assert(heap);
		assert.isBelow(
			heap.second - heap.first,
			HEAP_SLACK,
			`a thousand more inputs left ${heap.second - heap.first} bytes more on the heap`
		);
	});
});
