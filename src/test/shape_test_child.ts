/**
 * The process of `schema.shape.test.ts`, run under `--allow-natives-syntax`:
 * it builds and runs every sample, then asks the engine what shape each
 * schema has.
 *
 * It writes one line of JSON to stderr, a `ShapeChildOutput`. Stdout is the
 * engine's own: `%DebugPrint` of two controls and then of every schema, in
 * the order of `names`, which the test reads the fields' constness from.
 *
 * @module
 */

import * as s from '#lib/schema.ts';
import { run_shape_samples } from './shape_test_helpers.ts';

export interface ShapeChildOutput {
	/** Every schema, in the order printed. */
	names: Array<string>;
	/** Where a sample gave another answer than it says, see `ShapeRun`. */
	wrong: Array<string>;
	/** The schemas whose own keys are not `kind`, `def`, `run` in that order. */
	other_keys: Array<string>;
	/** The schemas whose map is not the one `string` has. */
	other_map: Array<string>;
}

// natives are not syntax a module can hold, so each is compiled from text
// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
const have_same_map = new Function('a', 'b', 'return %HaveSameMap(a, b)') as (
	a: object,
	b: object
) => boolean;
// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
const debug_print = new Function('o', '%DebugPrint(o)') as (o: object) => void;

const { schemas, wrong } = run_shape_samples();

// what tells the test that it reads the print right: an object whose fields
// were never written, then one of the same map after a write to the last
const create_control = (): Record<string, number> => ({
	shape_control_a: 1,
	shape_control_b: 2,
	shape_control_c: 3
});
const control = create_control();
debug_print(control);
create_control().shape_control_c = 4;
debug_print(control);

for (const { schema } of schemas) debug_print(schema);

const output: ShapeChildOutput = {
	names: schemas.map((x) => x.name),
	wrong,
	other_keys: schemas
		.filter((x) => Object.keys(x.schema).join() !== 'kind,def,run')
		.map((x) => `${x.name}: ${Object.keys(x.schema).join()}`),
	other_map: schemas.filter((x) => !have_same_map(s.string, x.schema)).map((x) => x.name)
};
console.error(JSON.stringify(output));
