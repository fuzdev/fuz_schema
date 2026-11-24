import { test, assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

import * as s from '#lib/schema.ts';

// The repo's own `tsconfig.json` has `exactOptionalPropertyTypes` off, under
// which `a?: X` and `a?: X | undefined` are one type, so the `| undefined` of
// an optional key in `schema.inference.test.ts` holds nothing. A consumer may
// have the flag on, where the two differ and a key typed `a?: X` can't hold
// `undefined`. This checks the library under it: a key a parse can give as
// `undefined` is typed so, and one it can't is not.

const probe_path = fileURLToPath(new URL('./exact_optional_probe.ts', import.meta.url));

const ENTRIES = `{
	optional: s.optional(s.string),
	defaulted: s.with_default(s.string, 'd'),
	piped: s.pipe(
		s.optional(s.string),
		s.transform((v) => v ?? 'x')
	),
	nullable_optional: s.nullable(s.optional(s.string)),
	union: s.union([s.string, s.optional(s.number)]),
	keyed: s.keyed_record(s.one_of(['p', 'q']), s.optional(s.number)),
	required: s.string
}`;

const PROBE = `import * as s from '../lib/schema.ts';
type Same<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare const same: <A, B>(...ok: Same<A, B> extends true ? [] : [never]) => void;

// the flag is on: with it off these are one type, and the directive is unused, an error
// @ts-expect-error
same<{ a?: string }, { a?: string | undefined }>();

const O = s.object(${ENTRIES});
same<
	s.Infer<typeof O>,
	{
		defaulted: string;
		keyed: Partial<Record<'p' | 'q', number | undefined>>;
		required: string;
		// given as \`undefined\`, it comes back so
		optional?: string | undefined;
		// a step runs on a key given as \`undefined\`, and none on one missing
		piped?: string;
		nullable_optional?: string | null | undefined;
		union?: string | number | undefined;
	}
>();
same<
	s.InferInput<typeof O>,
	{
		keyed: Partial<Record<'p' | 'q', number | undefined>>;
		required: string;
		optional?: string | undefined;
		defaulted?: string | undefined;
		piped?: string | undefined;
		nullable_optional?: string | null | undefined;
		union?: string | number | undefined;
	}
>();
// what a parse is given and gives assigns as it is typed
const given: s.InferInput<typeof O> = { required: 'r', keyed: { p: undefined }, optional: undefined, piped: undefined };
export const parsed: s.Infer<typeof O> = s.parse_or_throw(O, given);
`;

test('under exactOptionalPropertyTypes a key is typed with undefined where a parse can give it one', () => {
	const options: ts.CompilerOptions = {
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		target: ts.ScriptTarget.ESNext,
		strict: true,
		exactOptionalPropertyTypes: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		skipLibCheck: true,
		types: []
	};
	const host = ts.createCompilerHost(options);
	const { getSourceFile, fileExists, readFile } = host;
	host.getSourceFile = (name, language, ...rest) =>
		name === probe_path
			? ts.createSourceFile(name, PROBE, language)
			: getSourceFile.call(host, name, language, ...rest);
	host.fileExists = (name) => name === probe_path || fileExists.call(host, name);
	host.readFile = (name) => (name === probe_path ? PROBE : readFile.call(host, name));
	const program = ts.createProgram([probe_path], options, host);
	// of the probe and of the library it imports, which compiles under the flag
	const errors = ts.getPreEmitDiagnostics(program).map((d) => {
		const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
		if (d.file === undefined || d.start === undefined) return text;
		// with the line it is of, which says which check of the probe failed
		const { line } = d.file.getLineAndCharacterOfPosition(d.start);
		const at = d.file.fileName === probe_path ? 'the probe' : d.file.fileName;
		return `${at}, line ${line + 1}, \`${d.file.text.split('\n')[line]!.trim()}\`: ${text}`;
	});
	assert.deepEqual(errors, []);
}, 60_000);

test('and the runtime gives what those types say', () => {
	// the entries of the probe, as written there
	// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
	const O = new Function('s', `return s.object(${ENTRIES});`)(s) as s.AnySchema;
	const given = { required: 'r', keyed: { p: undefined }, optional: undefined, piped: undefined };
	const output = s.parse_or_throw(O, given) as Record<string, unknown>;
	// `optional` given as `undefined` stays, and `piped` given so has its step run
	assert.deepEqual(output, {
		required: 'r',
		keyed: { p: undefined },
		optional: undefined,
		piped: 'x',
		defaulted: 'd'
	});
	assert(Object.hasOwn(output, 'optional'));
	// a key missing stays out, but for the default's
	assert.deepEqual(s.parse_or_throw(O, { required: 'r', keyed: {} }), {
		required: 'r',
		keyed: {},
		defaulted: 'd'
	});
});
