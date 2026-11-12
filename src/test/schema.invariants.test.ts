import { test, assert } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

test('every export of the library has a doc comment of its own', () => {
	const lib = fileURLToPath(new URL('../lib/', import.meta.url));
	const paths = readdirSync(lib)
		.filter((f) => f.endsWith('.ts'))
		.map((f) => lib + f);
	const program = ts.createProgram(paths, {
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		allowImportingTsExtensions: true,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: []
	});
	const checker = program.getTypeChecker();
	const failures: Array<string> = [];
	const seen: Array<string> = [];
	for (const path of paths) {
		const module_symbol = checker.getSymbolAtLocation(program.getSourceFile(path)!)!;
		for (const exported of checker.getExportsOfModule(module_symbol)) {
			// `void` is exported as an alias of `void_`
			const symbol =
				exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
			seen.push(exported.name);
			// what an editor shows for it, which a statement between the comment and the
			// export takes away
			if (!symbol.getDocumentationComment(checker).length) failures.push(exported.name);
		}
	}
	assert.deepEqual(failures, [], `without a doc comment: ${failures.join(', ')}`);
	// the walk saw a constant, a factory, an alias, a type, and each module
	for (const name of ['string', 'to_integer', 'void', 'Schema', 'meta', 'to_json_schema']) {
		assert.include(seen, name);
	}
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
