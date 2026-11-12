import { test, assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SCHEMA_EXPORT_PATHS, get_schema_exports } from './schema_exports_test_helpers.ts';

// The declarations a consumer emits for its own generic helpers over the
// library: each must name what it infers through, or the emitted file
// refers to a type parameter it doesn't declare and fails to compile where
// it is read. A probe module is emitted in memory beside this one and the
// emitted file compiled on its own, both free of errors. And the declarations
// it emits for its exported schemas: every factory's type is named, so a
// schema that holds another writes it by name and not its output and input.

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
export const wrapped_entries = <T extends s.Schema<string>>(x: T) => s.object({ a: s.nullable(x), b: s.lazy(() => x), c: s.union([x, s.number]) });
export const defaulted = <T extends s.Schema>(x: T, d: s.Infer<T>) => s.object({ a: s.with_default(x, d) });
export const defaulted_optional = <T extends s.Schema>(x: T, d: s.Infer<T>) => s.object({ a: s.with_default(s.optional(x), d) });
export const branded = <T extends s.Schema<string>>(x: T) => s.object({ a: s.brand(x, 'B'), b: s.flavor(x, 'F') });
export const checked_at = <T extends s.Schema<{ a: string; b: Array<string> }>>(x: T) => s.pipe(x, s.check_at('a', (v) => v.a !== ''), s.check_at(['b', 0], (_v: { b: Array<string> }) => true));
export const branded_uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');
export const branded_pipe = s.brand(s.pipe(s.string, s.min_length(1)), 'B');
export const flavored_pipe = s.flavor(s.pipe(s.string, s.min_length(1)), 'F');
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

// emits `probe` as a declaration, free of errors, and compiles what it emitted on its own
const emit = (probe: string): string => {
	const files = new Map([[probe_path, probe]]);
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
	return emitted;
};

// two programs over the library each, which take seconds beside the other suites
const TIMEOUT = 60_000;

test(
	'a generic helper over the library emits a declaration that compiles',
	() => {
		emit(PROBE);
	},
	TIMEOUT
);

// nested exported schemas with no annotation, one of every factory: an object
// in an array in a variant in an object
const NESTED = `import * as s from '../lib/schema.ts';
export const Doc = s.object({
	id: s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid'),
	slug: s.flavor(s.pipe(s.string, s.min_length(1)), 'Slug'),
	title: s.optional(s.string),
	parent: s.nullable(s.number),
	role: s.with_default(s.one_of(['user', 'admin']), 'user'),
	tags: s.with_default_fn(s.array(s.string), () => []),
	counts: s.record(s.number),
	scores: s.keyed_record(s.one_of(['a', 'b']), s.number),
	port: s.pipe(s.string, s.to_integer({ unsigned: true }), s.max_value(65535)),
	value: s.union([s.number, s.boolean, s.literal(null)]),
	memo: s.memo_union([s.string, s.bigint]),
	data: s.unknown,
	nothing: s.optional(s.void),
	blocks: s.array(
		s.variant('kind', [
			s.object({ kind: s.literal('text'), body: s.strip_object({ text: s.string }) }),
			s.object({
				kind: s.literal('list'),
				items: s.array(s.loose_object({ label: s.string, at: s.optional(s.number) })),
				extra: s.object_with_rest({ n: s.number }, s.string),
				next: s.lazy(() => s.string)
			})
		])
	)
});
export const defaulted = <T extends s.Schema>(x: T, d: s.Infer<T>) => s.with_default(x, d);
export const defaulted_fn = <T extends s.Schema>(x: T, d: s.Infer<T>) => s.with_default_fn(x, () => d);
`;

const NAMES = [
	'ObjectSchema',
	'StripObjectSchema',
	'LooseObjectSchema',
	'ObjectWithRestSchema',
	'ArraySchema',
	'RecordSchema',
	'KeyedRecordSchema',
	'OptionalSchema',
	'NullableSchema',
	'WithDefaultSchema',
	'WithDefaultFnSchema',
	'WithUndefinedDefaultSchema',
	'WithUndefinedDefaultFnSchema',
	'LazySchema',
	'UnionSchema',
	'VariantSchema',
	'LiteralSchema',
	'OneOfSchema',
	'StringSchema',
	'NumberSchema',
	'BooleanSchema',
	'BigintSchema',
	'UnknownSchema',
	'VoidSchema',
	'BrandSchema',
	'FlavorSchema',
	'PipeSchema'
];

test(
	'nested exported schemas emit every factory by its name',
	() => {
		const emitted = emit(NESTED);
		for (const name of NAMES) assert.include(emitted, `s.${name}`, `${name} missing\n\n${emitted}`);
		// `Schema` itself written with type arguments is an output and an input written out,
		// and so is any of the types that compute one, or the union of every kind. A
		// `PipeSchema`'s output is written out too, which here is a `string`, or the
		// `number` of a `to_integer`, see below
		assert.notMatch(emitted, /\bSchema</, emitted);
		const pipes = emitted.match(/PipeSchema<[^>]*>/g) ?? [];
		assert.isNotEmpty(pipes);
		for (const pipe of pipes) {
			assert.include(
				['PipeSchema<string, s.StringSchema>', 'PipeSchema<number, s.StringSchema>'],
				pipe,
				emitted
			);
		}
		assert.notMatch(
			emitted,
			/Schema(?:Strict|Strip)?Object(?:Output|Input)|SchemaNode|SchemaOfKind|Branded<|Flavored</,
			emitted
		);
		// written out, the same module's declaration is many times this
		assert.isBelow(emitted.length, 3000, emitted);
	},
	TIMEOUT
);

test(
	'a pipe writes out the output its steps compute, unless it is named',
	() => {
		const emitted = emit(`import * as s from '../lib/schema.ts';
export const P = s.pipe(s.object({ a: s.string }), s.transform((v) => ({ ...v, b: 1 })));
export const Holder = s.object({ p: P });
const FirstEntries = { a: s.string };
export interface FirstSchema extends s.ObjectSchema<typeof FirstEntries> {}
export const First: FirstSchema = s.object(FirstEntries);
export interface Named { a: string; b: number }
export interface NamedSchema extends s.PipeSchema<Named, FirstSchema> {}
export const Named: NamedSchema = s.pipe(First, s.transform((v) => ({ ...v, b: 1 })));
export const NamedHolder = s.object({ p: Named, ps: s.array(Named) });
`);
		// as it is: the output written out where the pipe is, and again where it is held
		const written =
			's.PipeSchema<{\n    b: number;\n    a: string;\n}, s.ObjectSchema<{\n    a: s.StringSchema;\n}>>';
		assert.include(emitted, `export declare const P: ${written};`, emitted);
		assert.include(emitted, `p: ${written.replaceAll('\n', '\n    ')};`, emitted);
		// named, it is referenced by its name
		assert.include(
			emitted,
			'export declare const NamedHolder: s.ObjectSchema<{\n    p: NamedSchema;\n    ps: s.ArraySchema<NamedSchema>;\n}>;',
			emitted
		);
	},
	TIMEOUT
);

test(
	'an exported object schema named by its interface is referenced by that name',
	() => {
		const emitted = emit(`import * as s from '../lib/schema.ts';
const UserEntries = { kind: s.literal('user'), name: s.string, age: s.optional(s.number) };
export interface UserSchema extends s.ObjectSchema<typeof UserEntries> {}
export const User: UserSchema = s.object(UserEntries);
const BotEntries = { kind: s.literal('bot'), owner: User };
export interface BotSchema extends s.ObjectSchema<typeof BotEntries> {}
export const Bot: BotSchema = s.object(BotEntries);
export const Holder = s.object({ user: User, users: s.array(User) });
export const Actor = s.variant('kind', [User, Bot]);
`);
		assert.include(
			emitted,
			'export declare const Holder: s.ObjectSchema<{\n    user: UserSchema;\n    users: s.ArraySchema<UserSchema>;\n}>;',
			emitted
		);
		assert.include(
			emitted,
			'export declare const Actor: s.VariantSchema<"kind", readonly [UserSchema, BotSchema]>;',
			emitted
		);
		assert.notMatch(emitted, /\bSchema<|Object(?:Output|Input)/, emitted);
	},
	TIMEOUT
);

// what an export of `schema.ts` that is a schema, or a call signature that returns one, may
// declare as its type: a named interface of a schema, the types of a pipe and of an action,
// or a type parameter of the signature, as `message` returns the schema it was given
const NAMED_SCHEMA_TYPES = new Set([
	'StringSchema',
	'NumberSchema',
	'BooleanSchema',
	'BigintSchema',
	'UnknownSchema',
	'LiteralSchema',
	'VoidSchema',
	'OneOfSchema',
	'OptionalSchema',
	'NullableSchema',
	'WithDefaultSchema',
	'WithUndefinedDefaultSchema',
	'WithDefaultFnSchema',
	'WithUndefinedDefaultFnSchema',
	'LazySchema',
	'BrandSchema',
	'FlavorSchema',
	'ObjectSchema',
	'LooseObjectSchema',
	'ObjectWithRestSchema',
	'StripObjectSchema',
	'RecordSchema',
	'KeyedRecordSchema',
	'ArraySchema',
	'UnionSchema',
	'VariantSchema',
	'PipeSchema',
	'SchemaAction',
	'SchemaRefinement'
]);

test(
	'every export of schema.ts and meta.ts that is or makes a schema declares a named type',
	() => {
		const [lib_path] = SCHEMA_EXPORT_PATHS;
		const program = ts.createProgram([...SCHEMA_EXPORT_PATHS], { ...OPTIONS, noEmit: true });
		const checker = program.getTypeChecker();
		const source = program.getSourceFile(lib_path!)!;
		const module_symbol = checker.getSymbolAtLocation(source)!;
		// the reason `node`, a declared type, isn't one of the allowed, or `undefined`
		const refuse = (node: ts.TypeNode | undefined): string | undefined => {
			if (!node) return 'no declared type';
			if (!ts.isTypeReferenceNode(node)) return `declares ${node.getText()}`;
			const named = checker.getSymbolAtLocation(node.typeName);
			// a name imported into `meta.ts` is the one `schema.ts` declares
			const symbol =
				named && named.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(named) : named;
			if (symbol && symbol.flags & ts.SymbolFlags.TypeParameter) return undefined;
			const name = node.typeName.getText();
			if (!NAMED_SCHEMA_TYPES.has(name)) return `declares ${node.getText()}`;
			const declared = symbol?.declarations?.[0]?.getSourceFile();
			return declared === source ? undefined : `declares ${name} from another module`;
		};
		const found: Array<string> = [];
		const failures: Array<string> = [];
		for (const { name, node } of get_schema_exports(program)) {
			found.push(name);
			const reason = refuse(node);
			if (reason) failures.push(`${name}: ${reason}`);
		}
		assert.deepEqual(failures, [], failures.join('\n'));
		// the walk saw the kinds of export there are: constants, arrows, overloads, a pipe, actions
		for (const name of [
			'string',
			'void',
			'object',
			'with_default',
			'message',
			'brand',
			'pipe',
			'integer',
			'check',
			'meta'
		]) {
			assert.include(found, name);
		}
		// and every allowed name is one `schema.ts` exports
		const exported = new Set(checker.getExportsOfModule(module_symbol).map((s) => s.name));
		for (const name of NAMED_SCHEMA_TYPES) assert(exported.has(name), name);
	},
	TIMEOUT
);
