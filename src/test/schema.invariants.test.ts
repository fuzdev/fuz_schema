import { test, assert } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

import { SCHEMA_EXPORT_PATHS, get_schema_exports } from './schema_exports_test_helpers.ts';

// what the source and the package say of the library, which no parse shows

const ANNOTATION = '// @__NO_SIDE_EFFECTS__';

test('every factory carries the annotation a bundler drops an unused call by', () => {
	const program = ts.createProgram([...SCHEMA_EXPORT_PATHS], {
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		allowImportingTsExtensions: true,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: []
	});
	const factories = get_schema_exports(program).filter((e) => e.factory);
	const failures: Array<string> = [];
	for (const { name, statement } of new Map(factories.map((f) => [f.name, f])).values()) {
		const text = statement.getSourceFile().text;
		// the comment the statement starts after, which the bundler reads
		const last = ts.getLeadingCommentRanges(text, statement.pos)?.at(-1);
		if (!last || text.slice(last.pos, last.end) !== ANNOTATION) failures.push(name);
	}
	assert.deepEqual(failures, [], `without ${ANNOTATION}: ${failures.join(', ')}`);
	// the walk saw factories of each form: an arrow, overloads, a method's closure, and `meta.ts`
	const names = new Set(factories.map((f) => f.name));
	for (const name of ['object', 'with_default', 'lazy', 'pipe', 'check_at', 'meta']) {
		assert(names.has(name), name);
	}
	// and no constant, which needs none
	assert(!names.has('string'));
}, 60_000);

test('the library has no dependencies', () => {
	const package_json = JSON.parse(
		readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
	) as Record<string, unknown>;
	for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
		assert.notProperty(package_json, field, `package.json has ${field}`);
	}
	assert.property(package_json, 'devDependencies');
});
