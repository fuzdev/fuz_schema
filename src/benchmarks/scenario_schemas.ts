/**
 * What a schemas module in `libs/schemas/` exports, and the guard and the parse
 * of a scenario built from one. Apart from `scenarios.ts`, which the scenario
 * modules import, so the type benchmark of a scenario module checks none of it.
 *
 * @module
 */

import type { Scenario, ScenarioName, ScenarioRunner } from './scenarios.ts';

/** What a parse returned, reduced to whether it matched and, where it did, its output. */
export type ScenarioOutput = { ok: true; value: unknown } | { ok: false };

/**
 * What a schemas module in `libs/schemas/` exports, which no scenario's bundle
 * reaches: the schema each factory of its library's module wraps, as
 * `schema_<name>`, the schemas of `app` as a record by key, and the library's
 * guard over a schema, and its parse where it has one that returns an output.
 */
export type ScenarioSchemaModule = Record<`schema_${ScenarioName}`, () => unknown> & {
	to_guard: (schema: any) => ScenarioRunner;
	to_output?: (schema: any) => (value: unknown) => ScenarioOutput;
};

/**
 * A scenario's guard in one library: whether a value matches, by the
 * library's guard over the scenario's schema, and for a scenario of many
 * schemas over each of them on its own key, as its factory parses them.
 */
export const to_scenario_guard = (
	schemas: ScenarioSchemaModule,
	scenario: Scenario
): ScenarioRunner => {
	const schema = schemas[`schema_${scenario.name}`]();
	if (!scenario.many_schemas) return schemas.to_guard(schema);
	const guards = Object.entries(schema as Record<string, unknown>).map(
		([key, of_key]) => [key, schemas.to_guard(of_key)] as const
	);
	return (value: any) => {
		let ok = true;
		for (const [key, guard] of guards) ok = guard(value[key]) && ok;
		return ok;
	};
};

/**
 * Whether building a scenario's schema again hands back the one built before,
 * every one of a scenario of many schemas: what a library that keeps the
 * schema of a definition does, see `INTERNING_LIBS`.
 */
export const is_scenario_schema_kept = (
	schemas: ScenarioSchemaModule,
	scenario: Scenario
): boolean => {
	const build = schemas[`schema_${scenario.name}`];
	const first = build();
	const again = build();
	if (!scenario.many_schemas) return first === again;
	const of_again = again as Record<string, unknown>;
	return Object.entries(first as Record<string, unknown>).every(
		([key, schema]) => schema === of_again[key]
	);
};

/**
 * A scenario's parse in one library, for a test to read its output, or
 * `undefined` for a library that returns none. For a scenario of many schemas
 * the output is an object of each one's on its own key.
 */
export const to_scenario_output = (
	schemas: ScenarioSchemaModule,
	scenario: Scenario
): ((value: unknown) => ScenarioOutput) | undefined => {
	const { to_output } = schemas;
	if (!to_output) return undefined;
	const schema = schemas[`schema_${scenario.name}`]();
	if (!scenario.many_schemas) return to_output(schema);
	const outputs = Object.entries(schema as Record<string, unknown>).map(
		([key, of_key]) => [key, to_output(of_key)] as const
	);
	return (value: any) => {
		const output: Record<string, unknown> = {};
		for (const [key, parse] of outputs) {
			const result = parse(value[key]);
			if (!result.ok) return { ok: false };
			output[key] = result.value;
		}
		return { ok: true, value: output };
	};
};
