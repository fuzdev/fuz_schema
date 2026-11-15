/**
 * The process of the fallback test of `compile.test.ts`, run under
 * `--disallow-code-generation-from-strings`, where `new Function` throws:
 * `compile_guard` and `compile_parse` must then return functions that give
 * the interpreter's answers, and not throw.
 *
 * It writes one line of JSON to stdout, a `CompileFallbackOutput`.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { compile_guard, compile_parse } from '#lib/compile.ts';

export interface CompileFallbackOutput {
	/** Whether `new Function` threw in this process, as the test needs it to. */
	refused: boolean;
	/** The guard's verdicts on a value that matches and on one that doesn't. */
	guard: [boolean, boolean];
	/** Whether each result of the parse is deep-equal to `parse`'s, as JSON. */
	parse: [boolean, boolean];
	/** What a compile of a value that is no schema threw. */
	refusal: string;
}

let refused: boolean;
try {
	// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
	refused = !new Function('return 1');
} catch {
	refused = true;
}

const User = s.object({ name: s.string, tags: s.with_default(s.array(s.string), []) });
const guard = compile_guard(User);
const parse = compile_parse(User);
const good = { name: 'Ada' };
const bad = { name: 1, extra: true };
const same = (value: unknown): boolean =>
	JSON.stringify(parse(value)) === JSON.stringify(s.parse(User, value));

let refusal = '';
try {
	compile_guard(s.lazy(() => 5 as any));
} catch (error) {
	refusal = (error as Error).message;
}

const output: CompileFallbackOutput = {
	refused,
	guard: [guard(good), guard(bad)],
	parse: [same(good), same(bad)],
	refusal
};
process.stdout.write(JSON.stringify(output) + '\n');
