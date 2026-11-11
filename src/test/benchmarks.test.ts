import { describe, test, assert } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import * as s from '#lib/schema.ts';

import { APP_KEYS, SCENARIOS, to_app_payload } from '../benchmarks/scenarios.ts';
import {
	is_scenario_schema_kept,
	to_scenario_guard,
	to_scenario_output
} from '../benchmarks/scenario_schemas.ts';
import { LIBS } from '../benchmarks/libs.ts';
import { INTERNING_LIBS, LIB_NAMES } from '../benchmarks/lib_names.ts';
import * as fuz_schema_schemas from '../benchmarks/libs/schemas/fuz_schema.ts';
import { find_uncompiled_scenarios } from '../benchmarks/libs/schemas/zod_compiled.ts';

// the scripts that start a process for each library name them from `LIB_NAMES`
test('the libraries are the ones named, in that order', () => {
	assert.deepEqual(
		LIBS.map((lib) => lib.name),
		[...LIB_NAMES]
	);
});

// a benchmark only compares like with like if every library
// agrees on which inputs match
describe('benchmark scenario parity', () => {
	for (const lib of LIBS) {
		describe(lib.name, () => {
			for (const scenario of SCENARIOS) {
				test(scenario.name, () => {
					const run = lib.scenarios[`scenario_${scenario.name}`]();
					assert.strictEqual(run(scenario.valid), true, 'valid input');
					assert.strictEqual(run(scenario.invalid), false, 'invalid input');
				});
			}
		});
	}
});

// the guard regime compares like with like only if every library's guard,
// built from its schemas module, agrees with its factory, and so with the others
describe('benchmark guard parity', () => {
	for (const lib of LIBS) {
		describe(lib.name, () => {
			for (const scenario of SCENARIOS) {
				test(scenario.name, () => {
					const guard = to_scenario_guard(lib.schemas, scenario);
					assert.strictEqual(guard(scenario.valid), true, 'valid input');
					assert.strictEqual(guard(scenario.invalid), false, 'invalid input');
				});
			}
		});
	}
});

// The libraries that return an output return the same one, as the survey holds
// its shapes to. This library's is the reference, and the comparison is deep and
// strict, so a library that kept a key another drops fails.
describe('benchmark output parity', () => {
	const reference = LIBS.find((lib) => lib.name === 'fuz_schema')!;
	for (const scenario of SCENARIOS) {
		test(scenario.name, () => {
			const expected = to_scenario_output(reference.schemas, scenario)!(scenario.valid);
			assert(expected.ok);
			const wrong: Array<string> = [];
			for (const lib of LIBS) {
				const output = to_scenario_output(lib.schemas, scenario);
				if (!output) continue;
				const result = output(scenario.valid);
				if (!result.ok || !isDeepStrictEqual(result.value, expected.value)) wrong.push(lib.name);
				if (output(scenario.invalid).ok) wrong.push(`${lib.name} on the invalid input`);
			}
			assert.deepEqual(wrong, []);
		});
	}

	test('only typebox returns no output', () => {
		assert.deepEqual(
			LIBS.filter((lib) => !lib.schemas.to_output).map((lib) => lib.name),
			['typebox']
		);
	});
});

// the app's schemas are equivalent one by one: each library refuses a payload
// broken under any one key, and only by that key's schema, as do its guards
describe('the app scenario, schema by schema', () => {
	const app = SCENARIOS.find((scenario) => scenario.name === 'app')!;
	for (const lib of LIBS) {
		test(lib.name, () => {
			const run = lib.scenarios.scenario_app();
			const guard = to_scenario_guard(lib.schemas, app);
			for (const key of APP_KEYS) {
				assert.strictEqual(run(to_app_payload([key])), false, key);
				assert.strictEqual(guard(to_app_payload([key])), false, `${key}, the guard`);
			}
		});
	}
});

// what `zod_compiled` measures: compiled roots, but where `z.compile` can't compile
describe('zod_compiled', () => {
	test('compiles the root of every scenario but the recursive one', () => {
		assert.deepEqual(find_uncompiled_scenarios(), ['type_json']);
	});
});

// The source text of each top-level `export const <prefix>_<name>` of a module,
// by name: what follows its `=`, to the next line that starts a statement.
const to_definitions = (source: string, prefix: string): Map<string, string> => {
	const definitions: Map<string, string> = new Map();
	const pattern = new RegExp(
		`^export const ${prefix}_(\\w+)(?::[^=\\n]*)? =([\\s\\S]*?)(?=^[^\\s)\\]}]|(?![\\s\\S]))`,
		'gm'
	);
	for (const [, name, text] of source.matchAll(pattern)) definitions.set(name!, text!);
	return definitions;
};

// the index past the `)` that closes the call whose `(` is at `open`, past any string in it
const to_call_end = (text: string, open: number): number => {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i]!;
		if (c === "'" || c === '"' || c === '`') {
			i = text.indexOf(c, i + 1);
			if (i < 0) break;
		} else if (c === '(') {
			depth++;
		} else if (c === ')' && --depth === 0) {
			return i + 1;
		}
	}
	throw new Error(`no end to the call at ${open} of ${text}`);
};

// What a factory and its builder must agree on: the text of the definition,
// less comments, whitespace, the calls of a runner around the schema, and the
// prefix of a name, so `scenario_object_flat` and `schema_object_flat` are one.
const to_comparable = (text: string): string => {
	let out = text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.replace(/\s+/g, '')
		.replace(/\b(?:scenario|schema)_(?=\w)/g, '');
	for (const wrapper of ['to_runner(', 'to_app_runner(']) {
		for (let at = out.indexOf(wrapper); at >= 0; at = out.indexOf(wrapper)) {
			const open = at + wrapper.length - 1;
			const end = to_call_end(out, open);
			out = out.slice(0, at) + out.slice(open + 1, end - 1) + out.slice(end);
		}
	}
	return out;
};

const read_benchmark_source = (path: string): string =>
	readFileSync(new URL(`../benchmarks/${path}`, import.meta.url), 'utf8');

/**
 * What differs between two modules' definitions of every scenario, a line for
 * each scenario one lacks or whose texts differ, none when they agree.
 */
const find_definition_differences = (
	a: { path: string; prefix: string },
	b: { path: string; prefix: string }
): Array<string> => {
	const of_a = to_definitions(read_benchmark_source(a.path), a.prefix);
	const of_b = to_definitions(read_benchmark_source(b.path), b.prefix);
	const names = SCENARIOS.map((scenario) => scenario.name as string);
	const wrong: Array<string> = [];
	for (const name of new Set([...names, ...of_a.keys(), ...of_b.keys()])) {
		const text_a = of_a.get(name);
		const text_b = of_b.get(name);
		if (!names.includes(name)) wrong.push(`${name}: no scenario of the name`);
		if (text_a === undefined) wrong.push(`${name}: none in ${a.path}`);
		if (text_b === undefined) wrong.push(`${name}: none in ${b.path}`);
		if (text_a !== undefined && text_b !== undefined) {
			const left = to_comparable(text_a);
			const right = to_comparable(text_b);
			if (left !== right) {
				let i = 0;
				while (left[i] === right[i]) i++;
				wrong.push(
					`${name}: ${a.path} has ${left.slice(Math.max(0, i - 30), i + 30)} ` +
						`where ${b.path} has ${right.slice(Math.max(0, i - 30), i + 30)}`
				);
			}
		}
	}
	return wrong;
};

// The bundles are of the factories and the guard regime and the type benchmark
// of the builders, so the two are held to one text: a definition changed on one
// side and not the other fails here, where every verdict could still agree.
describe('every builder is its factory', () => {
	for (const lib of LIB_NAMES) {
		if (lib === 'zod_compiled') continue;
		test(lib, () => {
			assert.deepEqual(
				find_definition_differences(
					{ path: `libs/${lib}.ts`, prefix: 'scenario' },
					{ path: `libs/schemas/${lib}.ts`, prefix: 'schema' }
				),
				[]
			);
		});
	}

	// its builders are Zod's through `z.compile`, and its factories Zod's own text
	test('zod_compiled', () => {
		assert.deepEqual(
			find_definition_differences(
				{ path: 'libs/zod_compiled.ts', prefix: 'scenario' },
				{ path: 'libs/zod.ts', prefix: 'scenario' }
			),
			[]
		);
		const builders = to_definitions(
			read_benchmark_source('libs/schemas/zod_compiled.ts'),
			'schema'
		);
		assert.deepEqual(
			[...builders].map(([name, text]) => [name, to_comparable(text)]),
			SCENARIOS.map(({ name }) => [
				name,
				name === 'extra_keys'
					? 'object_flat;'
					: name === 'app'
						? '()=>compile_each(zod.app());'
						: `()=>z.compile(zod.${name}());`
			])
		);
	});

	test('a definition is read whole', () => {
		const source = read_benchmark_source('libs/valibot.ts');
		const definitions = to_definitions(source, 'scenario');
		assert.deepEqual(
			[...definitions.keys()],
			SCENARIOS.map((scenario) => scenario.name)
		);
		assert.include(definitions.get('pipe'), 'v.maxLength(50)');
		assert.include(definitions.get('app'), "event: v.variant('type'");
	});
});

// The cells a library's keeping of a definition's schema flatters are marked
// by `INTERNING_LIBS` and this, so the list names every library that keeps one.
// This library's `string` is a constant, which an app reuses too.
test('which scenarios a library hands back the schema of, built again', () => {
	const kept = LIBS.flatMap((lib) =>
		SCENARIOS.filter((scenario) => is_scenario_schema_kept(lib.schemas, scenario)).map(
			(scenario) => `${lib.name} ${scenario.name}`
		)
	);
	assert.deepEqual(kept, [
		'fuz_schema string',
		...['string', 'object_flat', 'extra_keys', 'strict_nested', 'pipe', 'union', 'list'].map(
			(name) => `arktype ${name}`
		)
	]);
	assert.deepEqual(INTERNING_LIBS, ['arktype']);
});

describe('benchmark scenario inputs', () => {
	// what `list` is there to measure: several issues, with paths two and three deep
	test('the invalid list fails at six places, two of them a level down', () => {
		const List = s.array(
			s.object({
				id: s.number,
				name: s.string,
				email: s.string,
				active: s.boolean,
				role: s.optional(s.string),
				tags: s.array(s.string)
			})
		);
		const { valid, invalid } = SCENARIOS.find((scenario) => scenario.name === 'list')!;
		assert.lengthOf(valid as Array<unknown>, 100);
		assert.strictEqual(s.parse(List, valid).ok, true);
		const result = s.parse(List, invalid);
		assert(!result.ok);
		assert.deepEqual(
			result.issues.map((issue) => issue.path),
			[
				[3, 'id'],
				[13, 'tags', 0],
				[40, 'active'],
				[58, 'role'],
				[71, 'tags', 1],
				[99, 'email']
			]
		);
	});

	// what `extra_keys` is there to measure: a copy without the keys the schema doesn't name
	test('the extra keys are dropped by the schema of object_flat', () => {
		const extra_keys = SCENARIOS.find((scenario) => scenario.name === 'extra_keys')!;
		const result = to_scenario_output(fuz_schema_schemas, extra_keys)!(extra_keys.valid);
		assert(result.ok);
		assert.deepEqual(result.value, {
			id: 1,
			name: 'Ada',
			email: 'ada@example.com',
			active: true
		});
		for (const lib of LIBS) {
			assert.strictEqual(lib.scenarios.scenario_extra_keys, lib.scenarios.scenario_object_flat);
			assert.strictEqual(lib.schemas.schema_extra_keys, lib.schemas.schema_object_flat);
		}
	});
});
