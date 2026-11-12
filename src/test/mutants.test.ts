import { assert, test } from 'vitest';
import { readFileSync } from 'node:fs';

import { apply_mutant, MUTANT_DEFAULT_FILE, MUTANTS } from './mutants.ts';

// `npm run mutate` checks the same as it starts, which is too late to hear of
// an anchor an edit moved: this holds the table to the tree on every check
test('every mutant has a name of its own and edits that apply to its file', () => {
	const texts: Map<string, string> = new Map();
	const names: Set<string> = new Set();
	const problems: Array<string> = [];
	for (const mutant of MUTANTS) {
		if (names.has(mutant.name)) problems.push(`${mutant.name}: named twice`);
		names.add(mutant.name);
		const file = mutant.file ?? MUTANT_DEFAULT_FILE;
		let text = texts.get(file);
		if (text === undefined) {
			text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
			texts.set(file, text);
		}
		const applied = apply_mutant(mutant, text);
		if ('problem' in applied) problems.push(applied.problem);
	}
	assert.deepEqual(problems, []);
});
