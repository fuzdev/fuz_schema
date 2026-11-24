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

// the README names the newest built-ins the library calls, and the Node that
// has both: a built-in past them, as a method of `Set` or of an iterator,
// compiles under the repo's own `tsconfig` and would break a consumer's runtime
test('the library calls no built-in newer than the two the README names', () => {
	const dir = new URL('../lib/', import.meta.url);
	const files = readdirSync(dir)
		.filter((name) => name.endsWith('.ts'))
		.map((name) => fileURLToPath(new URL(name, dir)));
	assert.isAbove(files.length, 0);
	// the messages of the errors under the built-ins of one edition of the language
	const errors_under = (edition: string): Array<string> => {
		const program = ts.createProgram(files, {
			target: ts.ScriptTarget.ESNext,
			lib: [`lib.${edition}.d.ts`],
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			allowImportingTsExtensions: true,
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			types: []
		});
		return ts
			.getPreEmitDiagnostics(program)
			.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
	};
	assert.deepEqual(errors_under('es2024'), []);
	// and each of the two is the newest of its edition that is called: without
	// the edition, it alone is missing
	const naming = (errors: Array<string>, name: string): boolean =>
		errors.length > 0 && errors.every((error) => error.includes(`'${name}'`));
	assert(naming(errors_under('es2023'), 'isWellFormed'), errors_under('es2023').join('\n'));
	const before = errors_under('es2022');
	assert(
		before.length > 0 &&
			before.every((e) => e.includes("'toReversed'") || e.includes("'isWellFormed'")) &&
			before.some((e) => e.includes("'toReversed'")),
		before.join('\n')
	);
	const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
	assert.include(readme, '`Array.prototype.toReversed`');
	assert.include(readme, '`String.prototype.isWellFormed`');
}, 60_000);
