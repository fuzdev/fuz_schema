import { assert, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

import { apply_mutant, MUTANT_DEFAULT_FILE, MUTANTS, MUTATE_EXCLUDED_TESTS } from './mutants.ts';

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

// the copies of `npm run mutate` run without the site's plugins, so a test
// file that imports a component fails to load there, and the run stops at its
// unmutated copy
test('every test file that imports a component is left out of the mutants’ runs', () => {
	const dir = new URL('./', import.meta.url);
	const importing = readdirSync(dir)
		.filter((name) => name.endsWith('.test.ts'))
		.filter((name) =>
			// a component imported for its value, on one line or several, or for its
			// effect: a type alone is erased and loads
			/^import (?!type )[^;]*?['"][^'"]+\.svelte['"];$/m.test(
				readFileSync(new URL(name, dir), 'utf8')
			)
		)
		.map((name) => `src/test/${name}`);
	assert.isAbove(importing.length, 0);
	assert.includeMembers(MUTATE_EXCLUDED_TESTS, importing);
});
