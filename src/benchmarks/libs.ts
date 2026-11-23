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
import * as fuz_schema_compiled from './libs/fuz_schema_compiled.ts';
import * as valibot from './libs/valibot.ts';
import * as zod from './libs/zod.ts';
import * as zod_compiled from './libs/zod_compiled.ts';
import * as zod_mini from './libs/zod_mini.ts';
import * as typebox from './libs/typebox.ts';
import * as valita from './libs/valita.ts';
import * as sury from './libs/sury.ts';
import * as fuz_schema_schemas from './libs/schemas/fuz_schema.ts';
import * as fuz_schema_compiled_schemas from './libs/schemas/fuz_schema_compiled.ts';
import * as valibot_schemas from './libs/schemas/valibot.ts';
import * as zod_schemas from './libs/schemas/zod.ts';
import * as zod_compiled_schemas from './libs/schemas/zod_compiled.ts';
import * as zod_mini_schemas from './libs/schemas/zod_mini.ts';
import * as typebox_schemas from './libs/schemas/typebox.ts';
import * as valita_schemas from './libs/schemas/valita.ts';
import * as sury_schemas from './libs/schemas/sury.ts';

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
	{
		name: 'fuz_schema_compiled',
		scenarios: fuz_schema_compiled,
		schemas: fuz_schema_compiled_schemas
	},
	{ name: 'valibot', scenarios: valibot, schemas: valibot_schemas },
	{ name: 'zod', scenarios: zod, schemas: zod_schemas },
	{ name: 'zod_compiled', scenarios: zod_compiled, schemas: zod_compiled_schemas },
	{ name: 'zod_mini', scenarios: zod_mini, schemas: zod_mini_schemas },
	{ name: 'typebox', scenarios: typebox, schemas: typebox_schemas },
	{ name: 'valita', scenarios: valita, schemas: valita_schemas },
	{ name: 'sury', scenarios: sury, schemas: sury_schemas }
];
