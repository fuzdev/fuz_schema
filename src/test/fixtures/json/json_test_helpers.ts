/**
 * The JSON fixtures: schemas and JSON texts authored in TypeScript, and what
 * the library makes of each text, generated into an `expected.json` that the
 * Rust crate's tests read.
 *
 * A group is a directory with a `fixture.ts`, which exports a `fixture`, and
 * the `expected.json` generated from it by `gro task src/test/fixtures/json/update.task.ts`.
 * The generated file is never edited by hand. Beside the groups is a generated
 * `contract.json`, the constants the two sides must have the same.
 *
 * The library is the oracle: a text is given to `JSON.parse`, and what that
 * returns to `is` and `parse`. Where the Rust crate declares that it differs,
 * the case names how with a `JsonDivergence`, and the crate's tests assert
 * that behavior instead of the oracle's.
 *
 * @module
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as s from '#lib/schema.ts';
import {
	SCHEMA_JSON_REFUSED_KEYS,
	SCHEMA_JSON_MAX_DEPTH,
	SCHEMA_JSON_MAX_NESTING,
	SCHEMA_JSON_UNSUPPORTED_KINDS,
	to_schema_json,
	type SchemaJson
} from '#lib/schema_json.ts';

/** Every `JsonDivergence`. The Rust tests fail on a flag that isn't one of these. */
export const JSON_DIVERGENCES = [
	'duplicate_keys',
	'malformed_tail',
	'number_overflow',
	'lone_surrogate',
	'depth_limit',
	'number_overflow_unread',
	'lone_surrogate_unread',
	'depth_limit_unread'
] as const;

/**
 * How the Rust crate is declared to differ from the library on a text.
 *
 * - `duplicate_keys` - a key is written twice and the library, seeing the last
 *   value, accepts. The streaming evaluator checks every occurrence and
 *   rejects. The tree evaluator agrees with the library.
 * - `malformed_tail` - the text is not JSON, and stops matching before the
 *   point where it stops being JSON. The streaming evaluator says it does not
 *   match. The tree evaluator reports the error.
 * - `number_overflow` - a number too large for a double, which `JSON.parse`
 *   reads as `Infinity`. Both evaluators report an error.
 * - `lone_surrogate` - a `\u` escape of half a surrogate pair, which
 *   `JSON.parse` keeps. Both evaluators report an error.
 * - `depth_limit` - nesting past what the crate's parser goes to. Both
 *   evaluators report an error.
 * - `number_overflow_unread`, `lone_surrogate_unread`, `depth_limit_unread` -
 *   the same three where the streaming evaluator never reads the value,
 *   because it is skipped or comes after the first failure. The streaming
 *   evaluator agrees with the library. The tree evaluator reports the error.
 */
export type JsonDivergence = (typeof JSON_DIVERGENCES)[number];

/** A JSON text, or one with the way the Rust crate differs on it. */
export type JsonFixtureText = string | { text: string; diverges: JsonDivergence };

/**
 * What a `fixture.ts` exports as `fixture`. The cases are texts and not
 * values, because how a value is written is part of what's tested.
 */
export interface JsonFixture {
	schema: s.AnySchema;
	/** The texts, by a name that says what each one is for. */
	cases: Record<string, JsonFixtureText>;
}

/** An issue as the library reports it, without `message`, and its text. */
export interface JsonFixtureIssue {
	kind: string;
	expected: string;
	received: string;
	path: Array<string | number>;
	/** What `format_issue` writes of it without its `message`. */
	formatted: string;
}

/** What the library makes of one text. */
export interface JsonFixtureCase {
	name: string;
	text: string;
	/** Whether `JSON.parse` reads the text. The next two are present when it does. */
	json: boolean;
	/** Whether what it read matches the schema. */
	valid?: boolean;
	/** The issues of a value that doesn't match, and none for one that does. */
	issues?: Array<JsonFixtureIssue>;
	diverges?: JsonDivergence;
}

/** The contents of an `expected.json`. */
export interface JsonFixtureExpected {
	/** The schema in the interchange form. */
	schema: SchemaJson;
	cases: Array<JsonFixtureCase>;
}

export const JSON_FIXTURES_DIR = import.meta.dirname;

/** The names of the fixture groups, sorted. */
export const load_json_fixture_names = async (): Promise<Array<string>> =>
	(await readdir(JSON_FIXTURES_DIR, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.sort();

/**
 * Loads the `fixture` a group's `fixture.ts` exports.
 *
 * @throws Error when the group has no `fixture.ts`
 */
export const load_json_fixture = async (name: string): Promise<JsonFixture> => {
	if (!existsSync(join(JSON_FIXTURES_DIR, name, 'fixture.ts'))) {
		throw Error(`fixture group "${name}" has no fixture.ts`);
	}
	const module: { fixture: JsonFixture } = await import(`./${name}/fixture.ts`);
	return module.fixture;
};

/**
 * The divergences that can be told from the value `JSON.parse` returns, each
 * with whether `value` is what it is declared of: it holds an infinity, a
 * string or key that is not well-formed Unicode, or nesting deeper than the
 * crate's parser reads.
 */
const find_refused = (
	value: unknown
): Record<'number_overflow' | 'lone_surrogate' | 'depth_limit', boolean> => {
	const found = { number_overflow: false, lone_surrogate: false, depth_limit: false };
	const stack: Array<[value: unknown, depth: number]> = [[value, 0]];
	let next;
	while ((next = stack.pop())) {
		const [v, depth] = next;
		if (typeof v === 'number') {
			if (!Number.isFinite(v)) found.number_overflow = true;
		} else if (typeof v === 'string') {
			if (!v.isWellFormed()) found.lone_surrogate = true;
		} else if (v !== null && typeof v === 'object') {
			if (depth >= SCHEMA_JSON_MAX_DEPTH) found.depth_limit = true;
			for (const key of Object.keys(v)) {
				if (!key.isWellFormed()) found.lone_surrogate = true;
				stack.push([(v as Record<string, unknown>)[key], depth + 1]);
			}
		}
	}
	return found;
};

/**
 * Runs the oracle on one text.
 *
 * Three families of divergence are checked against the value: a case
 * declares `number_overflow`, `lone_surrogate`, or `depth_limit`, or the
 * `_unread` form of one, exactly when its value has what that is about.
 * Whether the streaming evaluator reads it is not checked here, nor is
 * `duplicate_keys` or `malformed_tail`. The Rust tests assert those.
 *
 * @throws Error when `is` and `parse` disagree, or a declared divergence can't be one, or one that must be declared isn't
 */
export const generate_json_fixture_case = (
	schema: s.AnySchema,
	name: string,
	input: JsonFixtureText
): JsonFixtureCase => {
	const text = typeof input === 'string' ? input : input.text;
	const diverges = typeof input === 'string' ? undefined : input.diverges;
	// the text is written into a JSON file, which can't hold half a surrogate pair
	if (!text.isWellFormed()) throw Error(`case "${name}" is not well-formed Unicode`);
	let value: unknown;
	let json = true;
	try {
		value = JSON.parse(text);
	} catch {
		json = false;
	}
	if (!json) {
		if (diverges !== undefined && diverges !== 'malformed_tail') {
			throw Error(`case "${name}" is not JSON, so it can't diverge as ${diverges}`);
		}
		return diverges === undefined ? { name, text, json } : { name, text, json, diverges };
	}
	const valid = s.is(schema, value);
	const result = s.parse(schema, value);
	if (valid !== result.ok) throw Error(`case "${name}": is and parse disagree`);
	if (diverges === 'malformed_tail') {
		throw Error(`case "${name}" is JSON, so it has no malformed tail`);
	}
	if (diverges === 'duplicate_keys' && !valid) {
		throw Error(`case "${name}" doesn't match, so its duplicate keys make no difference`);
	}
	for (const [family, found] of Object.entries(find_refused(value))) {
		const declared = diverges === family || diverges === `${family}_unread`;
		if (found && !declared) {
			throw Error(`case "${name}" must diverge as ${family} or ${family}_unread`);
		}
		if (declared && !found) {
			throw Error(`case "${name}" has nothing to diverge as ${diverges} by`);
		}
	}
	const issues = result.ok
		? []
		: result.issues.map((issue) => ({
				kind: issue.kind,
				expected: issue.expected,
				received: issue.received,
				// the keys of what `JSON.parse` returns, which are strings and indices
				path: issue.path.map((key) => {
					const segment = typeof key === 'number' ? key : String(key);
					// a path's keys are the input's, and the file can't hold this one either
					if (typeof segment === 'string' && !segment.isWellFormed()) {
						throw Error(`case "${name}" has an issue at a key that is not well-formed Unicode`);
					}
					return segment;
				}),
				formatted: s.format_issue({ ...issue, message: undefined })
			}));
	return diverges === undefined
		? { name, text, json, valid, issues }
		: { name, text, json, valid, issues, diverges };
};

/** Runs the oracle on every text of a fixture. */
export const generate_json_fixture = (fixture: JsonFixture): JsonFixtureExpected => ({
	schema: to_schema_json(fixture.schema),
	cases: Object.entries(fixture.cases).map(([name, input]) =>
		generate_json_fixture_case(fixture.schema, name, input)
	)
});

/** The text of an `expected.json` or of `contract.json`. */
export const format_json_fixture = (expected: JsonFixtureExpected | JsonFixtureContract): string =>
	JSON.stringify(expected, null, '\t') + '\n';

/**
 * The contents of `contract.json`: what the serializer and the fixtures hold
 * as constants that the Rust crate holds too. Its tests compare its own to these.
 */
export interface JsonFixtureContract {
	/** The most nesting a schema may have around one value. */
	max_nesting: number;
	/** The deepest that arrays and objects can be nested in a text the crate reads. */
	max_depth: number;
	/** The most issues a parse reports. */
	max_issues: number;
	/** The names both sides refuse of an entry, and of the key of a `variant`. */
	object_prototype_keys: ReadonlyArray<string>;
	/** The kinds neither side carries across. */
	unsupported_kinds: ReadonlyArray<string>;
	/** Every flag a case can declare. */
	divergences: ReadonlyArray<JsonDivergence>;
}

// the cap `fail` holds a parse's issues to, which the library doesn't export,
// read from what a parse of an input that fails more often returns
const read_max_issues = (): number => {
	const failures = 10_000;
	const result = s.parse(s.array(s.string), Array(failures).fill(1));
	if (result.ok || result.issues.length === failures) {
		throw Error(`a parse of ${failures} failures reported every one, or none`);
	}
	return result.issues.length;
};

export const generate_json_fixture_contract = (): JsonFixtureContract => ({
	max_nesting: SCHEMA_JSON_MAX_NESTING,
	max_depth: SCHEMA_JSON_MAX_DEPTH,
	max_issues: read_max_issues(),
	object_prototype_keys: SCHEMA_JSON_REFUSED_KEYS,
	unsupported_kinds: SCHEMA_JSON_UNSUPPORTED_KINDS,
	divergences: JSON_DIVERGENCES
});

const contract_path = join(JSON_FIXTURES_DIR, 'contract.json');

/** Reads `contract.json`, or `null` when there is none. */
export const read_json_fixture_contract = (): Promise<string | null> => read_or_null(contract_path);

const expected_path = (name: string): string => join(JSON_FIXTURES_DIR, name, 'expected.json');

const read_or_null = async (path: string): Promise<string | null> => {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
};

/** Reads a group's `expected.json`, or `null` when it has none. */
export const read_json_fixture_expected = (name: string): Promise<string | null> =>
	read_or_null(expected_path(name));

/**
 * Regenerates every group's `expected.json` and `contract.json`, writing only
 * the ones that changed.
 *
 * @returns the paths written, relative to the fixtures directory
 */
export const update_json_fixtures = async (): Promise<Array<string>> => {
	const written: Array<string> = [];
	const contract = format_json_fixture(generate_json_fixture_contract());
	if ((await read_json_fixture_contract()) !== contract) {
		await writeFile(contract_path, contract);
		written.push('contract.json');
	}
	for (const name of await load_json_fixture_names()) {
		const text = format_json_fixture(generate_json_fixture(await load_json_fixture(name)));
		if ((await read_json_fixture_expected(name)) !== text) {
			await writeFile(expected_path(name), text);
			written.push(`${name}/expected.json`);
		}
	}
	return written;
};
