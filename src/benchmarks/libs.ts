/**
 * The libraries under comparison, in the order of `LIB_NAMES`: each one's
 * scenario module, whose factories the bundles are of, and its schemas
 * module, the same schemas as builders with the library's guard and parse,
 * which no bundle reaches.
 *
 * @module
 */

import type { LibName } from './lib_names.ts';
import type { ScenarioModule } from './scenarios.ts';
import type { ScenarioSchemaModule } from './scenario_schemas.ts';
import * as fuz_schema from './libs/fuz_schema.ts';
import * as valibot from './libs/valibot.ts';
import * as zod from './libs/zod.ts';
import * as zod_compiled from './libs/zod_compiled.ts';
import * as zod_mini from './libs/zod_mini.ts';
import * as typebox from './libs/typebox.ts';
import * as arktype from './libs/arktype.ts';
import * as fuz_schema_schemas from './libs/schemas/fuz_schema.ts';
import * as valibot_schemas from './libs/schemas/valibot.ts';
import * as zod_schemas from './libs/schemas/zod.ts';
import * as zod_compiled_schemas from './libs/schemas/zod_compiled.ts';
import * as zod_mini_schemas from './libs/schemas/zod_mini.ts';
import * as typebox_schemas from './libs/schemas/typebox.ts';
import * as arktype_schemas from './libs/schemas/arktype.ts';

export interface Lib {
	/** Also the basename of its module in `libs/` and of its schemas module in `libs/schemas/`. */
	name: LibName;
	scenarios: ScenarioModule;
	schemas: ScenarioSchemaModule;
}

/** The library every ratio is reported against. */
export const BASELINE_LIB = 'valibot';

export const LIBS: Array<Lib> = [
	{ name: 'fuz_schema', scenarios: fuz_schema, schemas: fuz_schema_schemas },
	{ name: 'valibot', scenarios: valibot, schemas: valibot_schemas },
	{ name: 'zod', scenarios: zod, schemas: zod_schemas },
	{ name: 'zod_compiled', scenarios: zod_compiled, schemas: zod_compiled_schemas },
	{ name: 'zod_mini', scenarios: zod_mini, schemas: zod_mini_schemas },
	{ name: 'typebox', scenarios: typebox, schemas: typebox_schemas },
	{ name: 'arktype', scenarios: arktype, schemas: arktype_schemas }
];
