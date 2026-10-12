/**
 * The libraries under comparison, in display order.
 *
 * @module
 */

import type { ScenarioModule } from './scenarios.ts';
import * as fuz_schema from './libs/fuz_schema.ts';
import * as valibot from './libs/valibot.ts';
import * as zod from './libs/zod.ts';
import * as zod_mini from './libs/zod_mini.ts';
import * as typebox from './libs/typebox.ts';
import * as arktype from './libs/arktype.ts';

export interface Lib {
	/** Also the basename of the module in `libs/`. */
	name: string;
	scenarios: ScenarioModule;
}

/** The library every ratio is reported against. */
export const BASELINE_LIB = 'valibot';

export const LIBS: Array<Lib> = [
	{ name: 'fuz_schema', scenarios: fuz_schema },
	{ name: 'valibot', scenarios: valibot },
	{ name: 'zod', scenarios: zod },
	{ name: 'zod_mini', scenarios: zod_mini },
	{ name: 'typebox', scenarios: typebox },
	{ name: 'arktype', scenarios: arktype }
];
