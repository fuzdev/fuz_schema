import { test, assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The declarations a consumer emits for its own generic helpers over the
// library: each must name what it infers through, or the emitted file
// refers to a type parameter it doesn't declare and fails to compile where
// it is read. A probe module is emitted in memory beside this one and the
// emitted file compiled on its own, both free of errors.

const dir = dirname(fileURLToPath(import.meta.url));
const probe_path = join(dir, 'emit_probe.ts');
const emitted_path = join(dir, 'emit_probe.d.ts');

const PROBE = `import * as s from '../lib/schema.ts';
import { pipe, regex, type Schema } from '../lib/schema.ts';
export const piped_regex = <T extends s.Schema<string>>(x: T) => s.pipe(x, s.regex(/a/));
export const piped_length = <T extends s.Schema<string>>(x: T) => s.pipe(x, s.min_length(1));
export const piped_integer = <T extends s.Schema<number>>(x: T) => s.pipe(x, s.integer);
export const piped_check = <T extends s.Schema<string>>(x: T) => s.pipe(x, s.check((v) => v !== ''));
export const piped_two = <T extends s.Schema<string>>(x: T) => s.pipe(x, s.regex(/a/), s.max_length(9));
export const piped_message = <T extends s.Schema<string>>(x: T) => s.pipe(x, s.message(s.regex(/a/), 'm'));
export const piped_entry = <T extends s.Schema<string>>(x: T) => s.object({ a: s.pipe(x, s.regex(/a/)) });
export const regex_of = <T extends string>() => s.regex<T>(/a/);
export const piped_action = <O>(a: s.SchemaAction<string, O>) => s.pipe(s.string, a, s.check((v) => v !== null));
export const piped_named = <T extends Schema<string>>(x: T) => pipe(x, regex(/a/));
`;

const OPTIONS: ts.CompilerOptions = {
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	target: ts.ScriptTarget.ESNext,
	strict: true,
	declaration: true,
	emitDeclarationOnly: true,
	allowImportingTsExtensions: true,
	skipLibCheck: true,
	types: []
};

const create_host = (files: Map<string, string>): ts.CompilerHost => {
	const host = ts.createCompilerHost(OPTIONS);
	const { getSourceFile, fileExists, readFile } = host;
	host.getSourceFile = (name, language, ...rest) => {
		const text = files.get(name);
		return text === undefined
			? getSourceFile.call(host, name, language, ...rest)
			: ts.createSourceFile(name, text, language);
	};
	host.fileExists = (name) => files.has(name) || fileExists.call(host, name);
	host.readFile = (name) => files.get(name) ?? readFile.call(host, name);
	host.writeFile = (name, text) => files.set(name, text);
	return host;
};

const format = (diagnostics: ReadonlyArray<ts.Diagnostic>): string =>
	diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');

test('a generic helper over the library emits a declaration that compiles', () => {
	const files = new Map([[probe_path, PROBE]]);
	const program = ts.createProgram([probe_path], OPTIONS, create_host(files));
	const result = program.emit(program.getSourceFile(probe_path));
	const errors = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
	assert.strictEqual(errors.length, 0, format(errors));
	const emitted = files.get(emitted_path);
	assert(emitted !== undefined, 'no declaration emitted');

	const reader = ts.createProgram(
		[emitted_path],
		{
			...OPTIONS,
			declaration: false,
			emitDeclarationOnly: false,
			noEmit: true,
			// checks the emitted file, a `.d.ts`, which `skipLibCheck` would skip
			skipLibCheck: false,
			skipDefaultLibCheck: true
		},
		create_host(new Map([[emitted_path, emitted]]))
	);
	const read_errors = reader.getSemanticDiagnostics(reader.getSourceFile(emitted_path));
	assert.strictEqual(read_errors.length, 0, `${format(read_errors)}\n\n${emitted}`);
});
