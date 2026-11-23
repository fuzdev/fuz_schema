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

// `value` without the own keys of its objects that hold `undefined`, at any depth
const drop_undefined_keys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(drop_undefined_keys);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, of_key]) => of_key !== undefined)
			.map(([key, of_key]) => [key, drop_undefined_keys(of_key)])
	);
};

// Where a library's output is declared to differ from the others', and what is set aside
// to compare the rest. Sury's generated parse writes every key of an object schema, so an
// optional key the input lacks is in its output as `undefined`, where the others leave
// it out.
const OUTPUT_DIFFERENCES: Partial<Record<string, (value: unknown) => unknown>> = {
	sury: drop_undefined_keys
};

// The libraries that return an output return the same one, as the survey holds
// its shapes to. This library's is the reference, and the comparison is deep and
// strict, so a library that kept a key another drops fails, but for what
// `OUTPUT_DIFFERENCES` declares.
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
				const set_aside = OUTPUT_DIFFERENCES[lib.name];
				if (
					!result.ok ||
					!isDeepStrictEqual(set_aside ? set_aside(result.value) : result.value, expected.value)
				) {
					wrong.push(lib.name);
				}
				if (output(scenario.invalid).ok) wrong.push(`${lib.name} on the invalid input`);
			}
			assert.deepEqual(wrong, []);
		});
	}

	test('a declared difference is one: the output differs as it is, on some scenario', () => {
		for (const [name, set_aside] of Object.entries(OUTPUT_DIFFERENCES)) {
			const lib = LIBS.find((l) => l.name === name)!;
			const differs = SCENARIOS.some((scenario) => {
				const result = to_scenario_output(lib.schemas, scenario)!(scenario.valid);
				return result.ok && !isDeepStrictEqual(result.value, set_aside!(result.value));
			});
			assert.ok(differs, name);
		}
	});

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

// Calls `fn` and returns how many functions were made from text meanwhile, which
// is what a compile of this library does once a schema. A function is counted once
// it is made, so a compile the environment refused, which hands back the
// interpreter, counts none.
const count_compiled = (fn: () => void): number => {
	const original = globalThis.Function;
	let count = 0;
	globalThis.Function = new Proxy(original, {
		construct: (target, args) => {
			const made = Reflect.construct(target, args);
			count++;
			return made;
		}
	});
	try {
		fn();
	} finally {
		globalThis.Function = original;
	}
	return count;
};

// What `fuz_schema_compiled` measures: compiled code for every scenario, the
// recursive one too. A compile the library refused would throw as a factory is
// called, and one the environment refused would hand back the interpreter, which
// every parity test above would pass.
describe('fuz_schema_compiled', () => {
	const compiled = LIBS.find((lib) => lib.name === 'fuz_schema_compiled')!;
	const interpreted = LIBS.find((lib) => lib.name === 'fuz_schema')!;

	for (const scenario of SCENARIOS) {
		// one schema, or for a scenario of many each of them
		const roots = scenario.many_schemas ? APP_KEYS.length : 1;

		test(`${scenario.name}: its factory, its guard, and its parse are each made from text, a function a schema`, () => {
			assert.strictEqual(
				count_compiled(() => compiled.scenarios[`scenario_${scenario.name}`]()),
				roots,
				'the factory'
			);
			assert.strictEqual(
				count_compiled(() => to_scenario_guard(compiled.schemas, scenario)),
				roots,
				'the guard'
			);
			assert.strictEqual(
				count_compiled(() => to_scenario_output(compiled.schemas, scenario)),
				roots,
				'the parse'
			);
		});
	}

	test('the interpreter makes no function from text, building a scenario or running it', () => {
		for (const scenario of SCENARIOS) {
			assert.strictEqual(
				count_compiled(() => {
					const run = interpreted.scenarios[`scenario_${scenario.name}`]();
					run(scenario.valid);
					run(scenario.invalid);
					const guard = to_scenario_guard(interpreted.schemas, scenario);
					guard(scenario.valid);
				}),
				0,
				scenario.name
			);
		}
	});

	test('a compile is in the factory and none is in a call', () => {
		for (const scenario of SCENARIOS) {
			const run = compiled.scenarios[`scenario_${scenario.name}`]();
			const guard = to_scenario_guard(compiled.schemas, scenario);
			assert.strictEqual(
				count_compiled(() => {
					run(scenario.valid);
					run(scenario.invalid);
					guard(scenario.valid);
					guard(scenario.invalid);
				}),
				0,
				scenario.name
			);
		}
	});

	test('its output is the input itself exactly where the interpreter gives it back', () => {
		for (const scenario of SCENARIOS) {
			if (scenario.many_schemas) continue;
			const ours = to_scenario_output(interpreted.schemas, scenario)!(scenario.valid);
			const theirs = to_scenario_output(compiled.schemas, scenario)!(scenario.valid);
			assert(ours.ok && theirs.ok);
			assert.strictEqual(
				theirs.value === scenario.valid,
				ours.value === scenario.valid,
				scenario.name
			);
		}
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

// A source text with its comments dropped and its string, template, and regex
// literals taken out, each for a placeholder, so what is done to the code around
// them reaches into none: whitespace inside a string is the string's. A `/`
// starts a regex where no value can end before it. A template literal is taken
// whole to its closing backtick, so one holding another in a `${}` is not read.
const take_literals = (text: string): { code: string; literals: Array<string> } => {
	const literals: Array<string> = [];
	let code = '';
	// the last character of code that is not whitespace
	let last = '';
	for (let i = 0; i < text.length;) {
		const c = text[i]!;
		const next = text[i + 1];
		if (c === '/' && next === '/') {
			const end = text.indexOf('\n', i);
			if (end < 0) break;
			i = end;
			continue;
		}
		if (c === '/' && next === '*') {
			const end = text.indexOf('*/', i + 2);
			if (end < 0) break;
			i = end + 2;
			continue;
		}
		const is_quote = c === "'" || c === '"' || c === '`';
		const is_regex = c === '/' && (last === '' || '(,=:[!&|?{};'.includes(last));
		if (!is_quote && !is_regex) {
			code += c;
			if (!/\s/.test(c)) last = c;
			i++;
			continue;
		}
		let end = i + 1;
		let in_class = false;
		for (; end < text.length; end++) {
			const e = text[end]!;
			if (e === '\\') end++;
			else if (is_quote ? e === c : e === '/' && !in_class) break;
			else if (is_regex && e === '[') in_class = true;
			else if (is_regex && e === ']') in_class = false;
		}
		end++;
		// a regex's flags are part of it
		if (is_regex) while (/[a-z]/.test(text[end] ?? '')) end++;
		code += `\0${literals.length}\0`;
		literals.push(text.slice(i, end));
		last = '\0';
		i = end;
	}
	return { code, literals };
};

// What a factory and its builder must agree on: the text of the definition,
// less comments, whitespace, the calls of a runner around the schema, and the
// prefix of a name, so `scenario_object_flat` and `schema_object_flat` are one.
// Valita's runner of a scenario that drops keys, and the mark its builder puts on the
// schema in its place, are such calls too.
// None of that is done inside a string, template, or regex literal, which are
// compared as they are written.
const to_comparable = (text: string): string => {
	const { code, literals } = take_literals(text);
	let out = code.replace(/\s+/g, '').replace(/\b(?:scenario|schema)_(?=\w)/g, '');
	for (const wrapper of ['to_runner(', 'to_app_runner(', 'to_strip_runner(', 'to_strip(']) {
		for (let at = out.indexOf(wrapper); at >= 0; at = out.indexOf(wrapper)) {
			const open = at + wrapper.length - 1;
			const end = to_call_end(out, open);
			out = out.slice(0, at) + out.slice(open + 1, end - 1) + out.slice(end);
		}
	}
	return out.replace(/\0(\d+)\0/g, (_, index: string) => literals[Number(index)]!);
};

// The top-level helpers of a module that run a schema and define none: a
// factory's runners, a builder's guard and output, and what compiles a schema
// for either. Each side has its own, so they are not compared.
const RUNNER_HELPERS = [
	'to_runner',
	'to_app_runner',
	'to_strip_runner',
	'to_strip',
	'STRIPPED',
	'to_guard',
	'to_output',
	'compile_each',
	'find_uncompiled_scenarios'
];

// The source text of each top-level `const` of a module that is neither a
// scenario's nor a runner helper, by name: what the definitions share, as
// TypeBox's `STRICT`, which a scenario's own text doesn't hold.
const to_shared_constants = (source: string): Map<string, string> => {
	const constants: Map<string, string> = new Map();
	const pattern = /^(?:export )?const (\w+)(?::[^=\n]*)? =([\s\S]*?)(?=^[^\s)\]}]|(?![\s\S]))/gm;
	for (const [, name, text] of source.matchAll(pattern)) {
		if (/^(?:scenario|schema)_/.test(name!) || RUNNER_HELPERS.includes(name!)) continue;
		constants.set(name!, text!);
	}
	return constants;
};

const read_benchmark_source = (path: string): string =>
	readFileSync(new URL(`../benchmarks/${path}`, import.meta.url), 'utf8');

/** One side of a comparison: a module, and the prefix its definitions' names have. */
interface DefinitionsSide {
	path: string;
	prefix: string;
	/** The module's text, read from `path` when left out. */
	source?: string;
}

// where two comparable texts part, each with what is around it
const format_difference = (
	name: string,
	a: DefinitionsSide,
	b: DefinitionsSide,
	left: string,
	right: string
): string => {
	let i = 0;
	while (left[i] === right[i]) i++;
	return (
		`${name}: ${a.path} has ${left.slice(Math.max(0, i - 30), i + 30)} ` +
		`where ${b.path} has ${right.slice(Math.max(0, i - 30), i + 30)}`
	);
};

/**
 * What differs between two modules' definitions of every scenario, a line for
 * each scenario one lacks or whose texts differ, and for each top-level
 * constant the definitions share that one lacks or whose texts differ, none
 * when they agree.
 */
const find_definition_differences = (a: DefinitionsSide, b: DefinitionsSide): Array<string> => {
	const source_a = a.source ?? read_benchmark_source(a.path);
	const source_b = b.source ?? read_benchmark_source(b.path);
	const of_a = to_definitions(source_a, a.prefix);
	const of_b = to_definitions(source_b, b.prefix);
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
			if (left !== right) wrong.push(format_difference(name, a, b, left, right));
		}
	}
	const constants_a = to_shared_constants(source_a);
	const constants_b = to_shared_constants(source_b);
	for (const name of new Set([...constants_a.keys(), ...constants_b.keys()])) {
		const text_a = constants_a.get(name);
		const text_b = constants_b.get(name);
		if (text_a === undefined) wrong.push(`${name}: a constant of ${b.path} and not of ${a.path}`);
		else if (text_b === undefined) {
			wrong.push(`${name}: a constant of ${a.path} and not of ${b.path}`);
		} else {
			const left = to_comparable(text_a);
			const right = to_comparable(text_b);
			if (left !== right) wrong.push(format_difference(name, a, b, left, right));
		}
	}
	return wrong;
};

// The bundles are of the factories and the guard regime and the type benchmark
// of the builders, so the two are held to one text: a definition changed on one
// side and not the other fails here, where every verdict could still agree.
describe('every builder is its factory', () => {
	for (const lib of LIB_NAMES) {
		// a library in another mode holds its factories to its library's, below
		if (lib === 'zod_compiled' || lib === 'fuz_schema_compiled') continue;
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
				name === 'app' ? '()=>compile_each(zod.app());' : `()=>z.compile(zod.${name}());`
			])
		);
	});

	// its builders are this library's, which a compile leaves as they are, and its
	// factories this library's own text
	test('fuz_schema_compiled', () => {
		assert.deepEqual(
			find_definition_differences(
				{ path: 'libs/fuz_schema_compiled.ts', prefix: 'scenario' },
				{ path: 'libs/fuz_schema.ts', prefix: 'scenario' }
			),
			[]
		);
		const builders = to_definitions(
			read_benchmark_source('libs/schemas/fuz_schema_compiled.ts'),
			'schema'
		);
		assert.deepEqual(
			[...builders].map(([name, text]) => [name, to_comparable(text)]),
			SCENARIOS.map(({ name }) => [name, `()=>fuz_schema.${name}();`])
		);
	});

	// a definition of the compiled module that parts from the interpreter's, which
	// the comparison of the two factory modules must find
	test('finds a schema of fuz_schema_compiled that is not the one of fuz_schema', () => {
		const source = read_benchmark_source('libs/fuz_schema_compiled.ts');
		const from = 's.max_length(50)';
		assert.include(source, from);
		const differences = find_definition_differences(
			{
				path: 'libs/fuz_schema_compiled.ts',
				prefix: 'scenario',
				source: source.replace(from, 's.max_length(51)')
			},
			{ path: 'libs/fuz_schema.ts', prefix: 'scenario' }
		);
		assert.ok(
			differences.some((difference) => difference.startsWith('pipe:')),
			JSON.stringify(differences)
		);
	});

	// a change to one side of a library's two modules, which the comparison must find
	const MUTATIONS: Array<
		[
			label: string,
			lib: string,
			side: 'factory' | 'builder',
			from: string,
			to: string,
			finds: string
		]
	> = [
		[
			'a check of another length',
			'valibot',
			'builder',
			'v.maxLength(100)',
			'v.maxLength(101)',
			'app:'
		],
		[
			'an object that is no longer strict',
			'zod',
			'builder',
			'address: z.strictObject({ street',
			'address: z.object({ street',
			'strict_nested:'
		],
		[
			'a constant every strict scenario shares',
			'typebox',
			'factory',
			'additionalProperties: false',
			'additionalProperties: true',
			'STRICT:'
		],
		['whitespace inside a string', 'fuz_schema', 'factory', "'owner'", "'own er'", 'app:'],
		['a comment marker inside a string', 'fuz_schema', 'factory', "'owner'", "'own//er'", 'app:'],
		[
			'a constant only one side has',
			'typebox',
			'builder',
			'const STRICT =',
			'const SHUT =',
			'STRICT: a constant of'
		]
	];

	test.each(MUTATIONS)('finds %s', (_label, lib, side, from, to, finds) => {
		const factory: DefinitionsSide = { path: `libs/${lib}.ts`, prefix: 'scenario' };
		const builder: DefinitionsSide = { path: `libs/schemas/${lib}.ts`, prefix: 'schema' };
		const changed = side === 'factory' ? factory : builder;
		const source = read_benchmark_source(changed.path);
		assert.include(source, from, `${changed.path} no longer has the text this changes`);
		changed.source = source.replace(from, to);
		const differences = find_definition_differences(factory, builder);
		assert.ok(
			differences.some((difference) => difference.startsWith(finds)),
			`expected a difference of ${finds} and found ${JSON.stringify(differences)}`
		);
	});

	test('literals are taken out whole, and nothing else is', () => {
		const { code, literals } = take_literals(
			"a = 'x // y' /* gone */ + \"z's\" // gone\nb = /[/']+/g.test(`q ${1}`) ? 4 / 2 : c"
		);
		assert.deepEqual(literals, ["'x // y'", '"z\'s"', "/[/']+/g", '`q ${1}`']);
		assert.strictEqual(
			code.replace(/\s+/g, ''),
			'a=\x000\x00+\x001\x00b=\x002\x00.test(\x003\x00)?4/2:c'
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
		// the same constant, which a compile reads: its guard and parse are made anew
		'fuz_schema_compiled string',
		// each library's `string` is one schema too
		'valita string',
		'sury string'
	]);
	assert.deepEqual(INTERNING_LIBS, []);
});

describe('benchmark scenario inputs', () => {
	// what `list` is there to measure: several issues, with paths two and three deep
	test('the invalid list fails at six places, two of them a level down, the first halfway', () => {
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
				[50, 'id'],
				[53, 'tags', 0],
				[58, 'role'],
				[62, 'active'],
				[71, 'tags', 1],
				[99, 'email']
			]
		);
	});

	// what `object_copy` is there to measure: an output that is another object than the
	// input, with the keys the schema doesn't name dropped, a default filled in, and a
	// string lowercased
	test('the valid input of object_copy is copied: keys dropped, a default, a lowercase', () => {
		const object_copy = SCENARIOS.find((scenario) => scenario.name === 'object_copy')!;
		const result = to_scenario_output(fuz_schema_schemas, object_copy)!(object_copy.valid);
		assert(result.ok);
		assert.notStrictEqual(result.value, object_copy.valid);
		assert.deepEqual(result.value, {
			id: 1,
			name: 'Ada',
			email: 'ada@example.com',
			role: 'member'
		});
		// and it is the one scenario of a schema that is: this library returns the others' inputs
		for (const scenario of SCENARIOS) {
			if (scenario.many_schemas || typeof scenario.valid !== 'object') continue;
			const output = to_scenario_output(fuz_schema_schemas, scenario)!(scenario.valid);
			assert(output.ok);
			assert.strictEqual(
				output.value === scenario.valid,
				scenario.name !== 'object_copy',
				scenario.name
			);
		}
	});
});
