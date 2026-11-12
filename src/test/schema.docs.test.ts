import { test, assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// What an editor shows for a property of a type inferred from an object
// schema: the doc comment written on its entry, and the entry as its
// definition. Neither is in what a parse returns or in what compiles, so the
// language service is asked, over a probe module served from memory beside
// this one.

const dir = dirname(fileURLToPath(import.meta.url));
const probe_path = join(dir, 'docs_probe.ts');

// every `/*name*/` marks the position after it, the start of a property access
const PROBE = `import * as s from '../lib/schema.ts';
const Entries = {
	/** The required doc. */
	required: s.string,
	/** The optional doc. */
	optional: s.optional(s.number),
	/** The defaulted doc. */
	defaulted: s.with_default(s.boolean, false),
	/** The piped doc. */
	piped: s.pipe(s.optional(s.string), s.check((v) => v !== ''))
};
const Strict = s.object(Entries);
const Strip = s.strip_object(Entries);
const Loose = s.loose_object(Entries);
const Rest = s.object_with_rest(Entries, s.number);
const Extended = s.object({
	...Strict.def,
	/** The added doc. */
	added: s.string
});
const Holder = s.object({
	/** The nested doc. */
	nested: Strict,
	/** The items doc. */
	items: s.array(Strict)
});
const Variant = s.variant('kind', [
	s.object({
		/** The discriminator doc. */
		kind: s.literal('a'),
		/** The a doc. */
		a: s.string
	}),
	s.object({ kind: s.literal('b') })
]);
const Readonly = s.object({
	/** The required doc. */
	required: s.string
} as const);
const make = <const T extends s.SchemaEntries>(entries: T) => s.loose_object(entries);
const Made = make({
	/** The optional doc. */
	optional: s.optional(s.number)
});
type UnionEntries =
	| typeof Entries
	| {
			/** The added doc. */
			added: typeof s.string;
	  };
interface NamedOutput extends s.SchemaStrictObjectOutput<typeof Entries> {}
interface NamedInput extends s.SchemaStrictObjectInput<typeof Entries> {}

declare const strict_out: s.Infer<typeof Strict>;
declare const strict_in: s.InferInput<typeof Strict>;
declare const strip_out: s.Infer<typeof Strip>;
declare const strip_in: s.InferInput<typeof Strip>;
declare const loose_out: s.Infer<typeof Loose>;
declare const loose_in: s.InferInput<typeof Loose>;
declare const rest_out: s.Infer<typeof Rest>;
declare const rest_in: s.InferInput<typeof Rest>;
declare const readonly_out: s.Infer<typeof Readonly>;
declare const readonly_in: s.InferInput<typeof Readonly>;
declare const made_out: s.Infer<typeof Made>;
declare const union_out: s.Infer<s.LooseObjectSchema<UnionEntries>>;
declare const union_rest_out: s.Infer<s.ObjectWithRestSchema<UnionEntries, typeof s.unknown>>;
declare const extended_out: s.Infer<typeof Extended>;
declare const holder_out: s.Infer<typeof Holder>;
declare const variant_out: s.Infer<typeof Variant>;
declare const named_out: NamedOutput;
declare const named_in: NamedInput;

strict_out./*strict_out.required*/required;
strict_out./*strict_out.optional*/optional;
strict_out./*strict_out.defaulted*/defaulted;
strict_out./*strict_out.piped*/piped;
strict_in./*strict_in.required*/required;
strict_in./*strict_in.optional*/optional;
strict_in./*strict_in.defaulted*/defaulted;
strict_in./*strict_in.piped*/piped;
strip_out./*strip_out.required*/required;
strip_in./*strip_in.optional*/optional;
loose_out./*loose_out.required*/required;
loose_in./*loose_in.defaulted*/defaulted;
rest_out./*rest_out.required*/required;
rest_in./*rest_in.optional*/optional;
readonly_out./*readonly_out.required*/required;
readonly_in./*readonly_in.required*/required;
made_out./*made_out.optional*/optional;
if ('added' in union_out) union_out./*union_out.added*/added;
if ('piped' in union_out) union_out./*union_out.piped*/piped;
if ('added' in union_rest_out) union_rest_out./*union_rest_out.added*/added;
extended_out./*extended_out.required*/required;
extended_out./*extended_out.added*/added;
holder_out./*holder_out.nested*/nested;
holder_out.nested./*holder_out.nested.optional*/optional;
holder_out./*holder_out.items*/items;
holder_out.items[0]!./*holder_out.items.defaulted*/defaulted;
if (variant_out.kind === 'a') variant_out./*variant_out.a*/a;
variant_out./*variant_out.kind*/kind;
named_out./*named_out.required*/required;
named_out./*named_out.defaulted*/defaulted;
named_in./*named_in.optional*/optional;
named_in./*named_in.piped*/piped;
`;

// the doc each marked property must show, by the name of its entry
const DOCS: Record<string, string> = {
	required: 'The required doc.',
	optional: 'The optional doc.',
	defaulted: 'The defaulted doc.',
	piped: 'The piped doc.',
	added: 'The added doc.',
	nested: 'The nested doc.',
	items: 'The items doc.',
	a: 'The a doc.',
	kind: 'The discriminator doc.'
};

const OPTIONS: ts.CompilerOptions = {
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	target: ts.ScriptTarget.ESNext,
	strict: true,
	noUncheckedIndexedAccess: true,
	noEmit: true,
	allowImportingTsExtensions: true,
	skipLibCheck: true,
	types: []
};

const create_service = (): ts.LanguageService =>
	ts.createLanguageService({
		getScriptFileNames: () => [probe_path],
		getScriptVersion: () => '1',
		getScriptSnapshot: (name) => {
			const text = name === probe_path ? PROBE : ts.sys.readFile(name);
			return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
		},
		getCurrentDirectory: () => dir,
		getCompilationSettings: () => OPTIONS,
		getDefaultLibFileName: ts.getDefaultLibFilePath,
		fileExists: (name) => name === probe_path || ts.sys.fileExists(name),
		readFile: (name) => (name === probe_path ? PROBE : ts.sys.readFile(name)),
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories
	});

test('a property of an inferred object type has its entry’s doc and definition', () => {
	const service = create_service();
	const errors = [
		...service.getSyntacticDiagnostics(probe_path),
		...service.getSemanticDiagnostics(probe_path)
	];
	assert.strictEqual(
		errors.length,
		0,
		errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')
	);

	const marks = [...PROBE.matchAll(/\/\*([\w.]+)\*\//g)];
	assert(marks.length > 0, 'the probe marks no property');
	const failures: Array<string> = [];
	for (const mark of marks) {
		const label = mark[1]!;
		const position = mark.index + mark[0].length;
		const name = label.slice(label.lastIndexOf('.') + 1);
		const expected = DOCS[name];
		assert(expected !== undefined, `no doc is expected for ${label}`);

		const doc = ts.displayPartsToString(
			service.getQuickInfoAtPosition(probe_path, position)?.documentation
		);
		if (doc !== expected) failures.push(`${label}: doc is ${JSON.stringify(doc)}`);

		// the definition is the entry: a property assignment in the probe, of that name
		const definitions = service.getDefinitionAtPosition(probe_path, position) ?? [];
		const entry = definitions.find(
			(d) =>
				d.fileName === probe_path &&
				d.name === name &&
				PROBE.slice(0, d.textSpan.start).trimEnd().endsWith('*/')
		);
		if (!entry) failures.push(`${label}: no definition at its entry`);
	}
	assert.strictEqual(failures.length, 0, failures.join('\n'));
	// a language service over the library, which takes seconds beside the other suites
}, 60_000);
