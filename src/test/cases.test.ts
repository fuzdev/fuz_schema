import { test, assert, describe } from 'vitest';

import * as s from '#lib/schema.ts';
import {
	CASE_GROUPS,
	CASE_PATHS,
	create_cases,
	to_create_case,
	type Case,
	type CaseGroup,
	type SchemaLib
} from '../benchmarks/cases.ts';
import { build_cases } from '../benchmarks/grade_arm.ts';

describe('the case matrix', () => {
	// strict, so a group or a case built on its own that throws fails here
	const cases = create_cases(s, true);

	test('every group builds', () => {
		// called directly, since `create_cases` drops a group that throws unless it is strict
		for (const group of CASE_GROUPS) assert(group(s).length > 0);
	});

	test('a case built on its own that throws drops only itself', () => {
		const to_fake = (name: string): Case => ({
			name,
			group: 'fake',
			realistic: false,
			path: 'identity',
			valid: true,
			input: 1,
			run: () => 1,
			ok: () => true
		});
		const fake: CaseGroup = () => [
			to_fake('fake/kept/valid'),
			{
				name: 'fake/lacking/valid',
				build: () => {
					throw new Error('an export this version lacks');
				}
			},
			{ name: 'fake/built/valid', build: () => to_fake('fake/built/valid') }
		];
		assert.deepEqual(
			create_cases(s, false, [fake]).map((c) => c.name),
			['fake/kept/valid', 'fake/built/valid']
		);
		let thrown: unknown;
		try {
			create_cases(s, true, [fake]);
		} catch (error) {
			thrown = error;
		}
		assert(thrown instanceof Error);
		assert.include(thrown.message, '`fake/lacking/valid`');
	});

	test('a creation built on its own drops only itself in a version without its factory', () => {
		const group: CaseGroup = (v) => [
			to_create_case(v, 'create/kept/valid', () => v.optional(v.string)),
			{
				name: 'create/added/valid',
				build: () => to_create_case(v, 'create/added/valid', () => v.nullable(v.string))
			}
		];
		// a version from before `nullable`, as a baseline is before a new export
		const older = { ...s, nullable: undefined } as unknown as SchemaLib;
		assert.deepEqual(
			create_cases(s, true, [group]).map((c) => c.name),
			['create/kept/valid', 'create/added/valid']
		);
		assert.deepEqual(
			create_cases(older, false, [group]).map((c) => c.name),
			['create/kept/valid']
		);
	});

	test('names are unique and are group/shape/outcome', () => {
		assert.strictEqual(new Set(cases.map((c) => c.name)).size, cases.length);
		for (const c of cases) {
			assert.match(c.name, /^[a-z]+\/[a-z0-9_]+\/(valid|invalid)$/);
			assert.strictEqual(c.name.slice(0, c.name.indexOf('/')), c.group, c.name);
			assert.strictEqual(c.name.endsWith('/valid'), c.valid, c.name);
		}
	});

	test('every case matches or not as it says, and takes the path it names', () => {
		for (const c of cases) {
			assert(CASE_PATHS.includes(c.path), c.name);
			assert.strictEqual(c.ok(), c.valid, c.name);
			const output = c.run();
			if (c.path === 'create') {
				assert(s.is_schema(output), c.name);
				// a schema of its own each call
				assert.notStrictEqual(c.run(), output, c.name);
			} else if (c.path === 'probe') {
				assert.strictEqual(output, c.valid ? c.input : undefined, c.name);
			} else if (c.valid) {
				// `identity` is the input itself, `copy` anything else
				assert.strictEqual(output === c.input, c.path === 'identity', c.name);
			} else {
				assert.strictEqual(c.path, 'issues', c.name);
				assert.strictEqual(output, undefined, c.name);
			}
		}
	});

	test('the creation cases are the `create` group, and take the `create` path', () => {
		for (const c of cases) assert.strictEqual(c.path === 'create', c.group === 'create', c.name);
	});

	test('the realistic cases are the `real` group, and take every path', () => {
		for (const c of cases) assert.strictEqual(c.realistic, c.group === 'real', c.name);
		// a creation parses nothing, so its own group holds it
		for (const path of CASE_PATHS.filter((p) => p !== 'create')) {
			assert(
				cases.some((c) => c.realistic && c.path === path),
				path
			);
		}
	});
});

describe("the grader's arm", () => {
	/** The library with every function counted when called. */
	const to_counting_lib = (): { lib: SchemaLib; calls: { count: number } } => {
		const calls = { count: 0 };
		const lib: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(s)) {
			lib[key] =
				typeof value === 'function'
					? (...args: Array<unknown>) => {
							calls.count++;
							return (value as (...a: Array<unknown>) => unknown)(...args);
						}
					: value;
		}
		return { lib: lib as SchemaLib, calls };
	};

	test("the `create` cases call only their own library, and the rest only the arm's", () => {
		const parse = to_counting_lib();
		const create = to_counting_lib();
		const cases = build_cases(parse.lib, create.lib, true);
		assert(cases.some((c) => c.name.startsWith('create/')));
		assert(cases.some((c) => !c.name.startsWith('create/')));
		for (const c of cases) {
			parse.calls.count = 0;
			create.calls.count = 0;
			c.run();
			const [own, other] = c.name.startsWith('create/') ? [create, parse] : [parse, create];
			assert(own.calls.count > 0, c.name);
			assert.strictEqual(other.calls.count, 0, c.name);
		}
	});
});
