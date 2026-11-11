/**
 * Whether `z.compile` compiles a root, the one test every script that runs Zod
 * compiled asks it by. Zod is a parameter and imported only as a type, so a
 * process that holds another library loads none of it.
 *
 * @module
 */

import type * as zod from 'zod';

/**
 * `z.compile` of a root, or `undefined` where it would hand the root back
 * uncompiled, asked with `{strict: true}`, which throws where it would. A
 * `zod_compiled` figure of a root it hands back would be Zod's runtime parser
 * timed in another process, so the scripts print none. A root that compiles
 * around a child it can't, which `z.compile` runs by its runtime parser
 * inside the compiled root, is not told apart: `{strict: true}` doesn't throw
 * for one.
 *
 * @param z - Zod, the module, as the caller loaded it
 * @param root - the schema a parse starts from
 * @returns the compiled clone, or `undefined` when there is none
 */
export const compile_zod_root = <T extends zod.ZodType>(z: typeof zod, root: T): T | undefined => {
	try {
		return z.compile(root, { strict: true });
	} catch {
		return undefined;
	}
};
