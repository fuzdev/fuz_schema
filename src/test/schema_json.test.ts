import { describe, test, assert } from 'vitest';

import * as s from '#lib/schema.ts';
import {
	SCHEMA_JSON_REFUSED_KEYS,
	SCHEMA_JSON_MAX_DEPTH,
	SCHEMA_JSON_MAX_NESTING,
	to_schema_json,
	type SchemaJsonNode
} from '#lib/schema_json.ts';

const node = (schema: s.AnySchema): SchemaJsonNode => to_schema_json(schema).schema;

const STRING = { kind: 'string' };
const NUMBER = { kind: 'number' };

describe('to_schema_json', () => {
	test('a message around an unknown entry is written as the unknown it behaves as', () => {
		// the form has no `message`, so what is written must give the verdicts of what was given
		for (const factory of [s.object, s.strip_object, s.loose_object]) {
			const Given = factory({ a: s.message(s.unknown, 'm') });
			const Written = factory({ a: s.unknown });
			assert.deepEqual(to_schema_json(Given), to_schema_json(Written), Given.kind);
			assert.deepEqual(node(Given).def, { a: { kind: 'unknown' } }, Given.kind);
			for (const input of [{}, { a: undefined }, { a: null }, Object.create({ a: undefined })]) {
				assert.strictEqual(s.is(Given, input), s.is(Written, input), Given.kind);
				assert.strictEqual(s.parse(Given, input).ok, s.parse(Written, input).ok, Given.kind);
			}
			assert(!s.is(Given, {}), Given.kind);
			assert(s.is(Given, { a: undefined }), Given.kind);
		}
	});

	test('writes a kind with no def as its kind alone', () => {
		for (const schema of [
			s.string,
			s.number,
			s.boolean,
			s.bigint,
			s.unknown,
			s.integer,
			s.safe_integer
		]) {
			assert.deepEqual(to_schema_json(schema), { schema: { kind: schema.kind } });
		}
	});

	test('writes negative zero as the zero it equals', () => {
		assert.strictEqual(JSON.stringify(node(s.literal(-0))), '{"kind":"literal","def":0}');
		assert(Object.is(node(s.literal(-0)).def, 0));
		assert(Object.is((node(s.one_of([-0])).def as Array<unknown>)[0], 0));
		assert(Object.is((node(s.pipe(s.number, s.min_value(-0))).def as Array<any>)[1].def, 0));
		const with_default = node(s.with_default(s.unknown, [-0])).def as { value: Array<unknown> };
		assert(Object.is(with_default.value[0], 0));
	});

	test('writes literals as they are', () => {
		assert.deepEqual(node(s.literal('a')), { kind: 'literal', def: 'a' });
		assert.deepEqual(node(s.literal(1.5)), { kind: 'literal', def: 1.5 });
		assert.deepEqual(node(s.literal(false)), { kind: 'literal', def: false });
		assert.deepEqual(node(s.literal(null)), { kind: 'literal', def: null });
		assert.deepEqual(node(s.one_of(['a', 1, null, true])), {
			kind: 'one_of',
			def: ['a', 1, null, true]
		});
		assert.deepEqual(node(s.one_of([])), { kind: 'one_of', def: [] });
		// a null literal keeps its def, which is what tells it from `undefined`
		assert.strictEqual(JSON.stringify(node(s.literal(null))), '{"kind":"literal","def":null}');
	});

	test('writes wrappers with their schema under schema', () => {
		assert.deepEqual(node(s.optional(s.string)), { kind: 'optional', def: { schema: STRING } });
		assert.deepEqual(node(s.nullable(s.string)), { kind: 'nullable', def: { schema: STRING } });
		assert.deepEqual(node(s.with_default(s.number, 0)), {
			kind: 'with_default',
			def: { schema: NUMBER, value: 0 }
		});
		assert.deepEqual(node(s.with_default(s.unknown, { a: [1, null, 'x', { b: true }] })), {
			kind: 'with_default',
			def: { schema: { kind: 'unknown' }, value: { a: [1, null, 'x', { b: true }] } }
		});
	});

	test('writes containers', () => {
		assert.deepEqual(node(s.object({ id: s.number, name: s.string })), {
			kind: 'object',
			def: { id: NUMBER, name: STRING }
		});
		assert.deepEqual(node(s.loose_object({ id: s.number })), {
			kind: 'loose_object',
			def: { id: NUMBER }
		});
		assert.deepEqual(node(s.strip_object({})), { kind: 'strip_object', def: {} });
		assert.deepEqual(node(s.record(s.number)), { kind: 'record', def: NUMBER });
		assert.deepEqual(node(s.array(s.string)), { kind: 'array', def: STRING });
		assert.deepEqual(node(s.union([s.string, s.number])), {
			kind: 'union',
			def: [STRING, NUMBER]
		});
		assert.deepEqual(node(s.union([])), { kind: 'union', def: [] });
		assert.deepEqual(
			node(
				s.variant('kind', [
					s.object({ kind: s.literal('a') }),
					s.loose_object({ kind: s.literal(1), n: s.number })
				])
			),
			{
				kind: 'variant',
				def: {
					key: 'kind',
					options: [
						{ kind: 'object', def: { kind: { kind: 'literal', def: 'a' } } },
						{ kind: 'loose_object', def: { kind: { kind: 'literal', def: 1 }, n: NUMBER } }
					]
				}
			}
		);
	});

	test('keeps the order of entries', () => {
		const json = node(s.object({ b: s.string, a: s.string, c: s.string }));
		assert.deepEqual(Object.keys(json.def as object), ['b', 'a', 'c']);
	});

	test('writes pipes and actions', () => {
		assert.deepEqual(node(s.pipe(s.number, s.integer, s.min_value(0), s.max_value(150))), {
			kind: 'pipe',
			def: [
				NUMBER,
				{ kind: 'integer' },
				{ kind: 'min_value', def: 0 },
				{ kind: 'max_value', def: 150 }
			]
		});
		assert.deepEqual(node(s.pipe(s.string, s.min_length(1), s.max_length(50))), {
			kind: 'pipe',
			def: [STRING, { kind: 'min_length', def: 1 }, { kind: 'max_length', def: 50 }]
		});
		assert.deepEqual(node(s.pipe(s.array(s.string), s.max_length(1.5))), {
			kind: 'pipe',
			def: [
				{ kind: 'array', def: STRING },
				{ kind: 'max_length', def: 1.5 }
			]
		});
		// a pipe, or a number test, fixes the type as well as the schema it starts with
		assert.deepEqual(node(s.pipe(s.pipe(s.string, s.min_length(1)), s.max_length(2))), {
			kind: 'pipe',
			def: [
				{ kind: 'pipe', def: [STRING, { kind: 'min_length', def: 1 }] },
				{ kind: 'max_length', def: 2 }
			]
		});
		assert.deepEqual(node(s.pipe(s.integer, s.min_value(0))), {
			kind: 'pipe',
			def: [{ kind: 'integer' }, { kind: 'min_value', def: 0 }]
		});
		assert.deepEqual(node(s.array(s.safe_integer)), {
			kind: 'array',
			def: { kind: 'safe_integer' }
		});
	});

	test('names what a lazy defers to', () => {
		interface Tree {
			children: Array<Tree>;
		}
		const tree: s.Schema<Tree> = s.object({ children: s.array(s.lazy(() => tree)) });
		assert.deepEqual(to_schema_json(tree), {
			schema: {
				kind: 'object',
				def: { children: { kind: 'array', def: { kind: 'lazy', def: '$0' } } }
			},
			defs: {
				$0: {
					kind: 'object',
					def: { children: { kind: 'array', def: { kind: 'lazy', def: '$0' } } }
				}
			}
		});
	});

	test('a lazy at the root is a name', () => {
		const json: s.AnySchema = s.lazy(() => s.union([s.string, s.array(json)]));
		assert.deepEqual(to_schema_json(json), {
			schema: { kind: 'lazy', def: '$0' },
			defs: {
				$0: { kind: 'union', def: [STRING, { kind: 'array', def: { kind: 'lazy', def: '$0' } }] }
			}
		});
	});

	test('names are in the order they are met, and shared by lazies that defer to one schema', () => {
		const leaf = s.object({ v: s.number });
		const b: s.AnySchema = s.object({ a: s.optional(s.lazy(() => a)) });
		const a: s.AnySchema = s.object({
			leaf: s.lazy(() => leaf),
			b: s.optional(s.lazy(() => b)),
			other_leaf: s.lazy(() => leaf)
		});
		const json = to_schema_json(a);
		assert.deepEqual(Object.keys(json.defs!), ['$0', '$1', '$2']);
		const def = json.schema.def as Record<string, any>;
		assert.deepEqual(def.leaf, { kind: 'lazy', def: '$0' });
		assert.deepEqual(def.other_leaf, { kind: 'lazy', def: '$0' });
		assert.deepEqual(def.b.def.schema, { kind: 'lazy', def: '$1' });
		assert.deepEqual(json.defs!.$0, { kind: 'object', def: { v: NUMBER } });
		// `b` comes back to `a`, which the root holds directly and `$2` names
		assert.deepEqual((json.defs!.$1!.def as any).a.def.schema, { kind: 'lazy', def: '$2' });
		assert.deepEqual(json.defs!.$2, json.schema);
	});

	test('a lazy that defers to a lazy names each', () => {
		const inner = s.lazy(() => s.string);
		const outer = s.lazy(() => inner);
		assert.deepEqual(to_schema_json(s.array(outer)), {
			schema: { kind: 'array', def: { kind: 'lazy', def: '$0' } },
			defs: { $0: { kind: 'lazy', def: '$1' }, $1: STRING }
		});
	});

	test('calls the function of a lazy once', () => {
		let calls = 0;
		const lazy = s.lazy(() => {
			calls++;
			return s.string;
		});
		to_schema_json(s.object({ a: lazy, b: lazy, c: s.array(lazy) }));
		assert.strictEqual(calls, 1);
	});

	test('a lazy copied by message is the same lazy', () => {
		let calls = 0;
		const lazy = s.lazy(() => {
			calls++;
			// a new schema each call, which a second call would give a second name
			return s.array(s.string);
		});
		const json = to_schema_json(s.object({ a: lazy, b: s.message(lazy, 'no') }));
		assert.strictEqual(calls, 1);
		assert.deepEqual(json.schema.def, {
			a: { kind: 'lazy', def: '$0' },
			b: { kind: 'lazy', def: '$0' }
		});
		assert.deepEqual(Object.keys(json.defs!), ['$0']);
	});

	test('a function that makes a new schema each call is called once', () => {
		const make = (): s.AnySchema => s.object({ next: s.optional(s.lazy(make)) });
		assert.deepEqual(to_schema_json(make()), {
			schema: {
				kind: 'object',
				def: { next: { kind: 'optional', def: { schema: { kind: 'lazy', def: '$0' } } } }
			},
			defs: {
				$0: {
					kind: 'object',
					def: { next: { kind: 'optional', def: { schema: { kind: 'lazy', def: '$0' } } } }
				}
			}
		});
	});

	test('nests a document as deep as the crate reads', () => {
		// the envelope, an array schema per level, and the string schema
		let schema: s.AnySchema = s.string;
		for (let i = 0; i < SCHEMA_JSON_MAX_DEPTH - 2; i++) schema = s.array(schema);
		const depth = (value: unknown): number =>
			value !== null && typeof value === 'object'
				? 1 + Math.max(0, ...Object.values(value).map(depth))
				: 0;
		assert.strictEqual(depth(to_schema_json(schema)), SCHEMA_JSON_MAX_DEPTH);
	});

	test('has no defs without a lazy', () => {
		assert.notProperty(to_schema_json(s.array(s.string)), 'defs');
	});

	test('does not see message, flavor, or brand', () => {
		assert.deepEqual(node(s.message(s.string, 'no')), STRING);
		assert.deepEqual(node(s.flavor(s.string, 'Id')), STRING);
		assert.deepEqual(node(s.brand(s.pipe(s.string, s.min_length(1)), 'Name')), {
			kind: 'pipe',
			def: [STRING, { kind: 'min_length', def: 1 }]
		});
	});

	test('writes plain JSON', () => {
		const schema = s.object({
			a: s.optional(s.pipe(s.string, s.max_length(3))),
			b: s.with_default(s.array(s.nullable(s.one_of([1, 'x', null]))), []),
			c: s.record(s.union([s.boolean, s.literal(-0)]))
		});
		const json = to_schema_json(schema);
		assert.deepEqual(JSON.parse(JSON.stringify(json)), json);
	});

	test('nests as far as the limit', () => {
		let schema: s.AnySchema = s.string;
		for (let i = 0; i < SCHEMA_JSON_MAX_NESTING; i++) schema = s.optional(schema);
		to_schema_json(schema);
		// and a container starts the count again
		let outer: s.AnySchema = s.array(schema);
		for (let i = 0; i < SCHEMA_JSON_MAX_NESTING; i++) outer = s.nullable(outer);
		to_schema_json(outer);
	});
});

describe('to_schema_json refuses', () => {
	const refuses = (schema: () => s.AnySchema, message: string): void => {
		try {
			to_schema_json(schema());
		} catch (error) {
			assert(error instanceof Error);
			assert.strictEqual(error.message, message);
			return;
		}
		assert.fail(`expected a throw: ${message}`);
	};

	test('kinds that hold a JavaScript value', () => {
		refuses(
			() => s.pipe(s.string, s.regex(/a/)),
			'cannot serialize `regex` at /schema/def/1: it holds a JavaScript value and is not portable'
		);
		refuses(
			() =>
				s.object({
					a: s.pipe(
						s.number,
						s.check((n: number) => n > 0)
					)
				}),
			'cannot serialize `check` at /schema/def/a/def/1: it holds a JavaScript value and is not portable'
		);
		refuses(
			() =>
				s.array(
					s.pipe(
						s.string,
						s.transform((v: string) => v.length)
					)
				),
			'cannot serialize `transform` at /schema/def/def/1: it holds a JavaScript value and is not portable'
		);
		refuses(
			() => s.regex(/a/),
			'cannot serialize `regex` at /schema: it holds a JavaScript value and is not portable'
		);
		// not among the kinds the crate refuses by name: it refuses it as one it doesn't know
		let made = 0;
		refuses(
			() => s.object({ a: s.nullable(s.with_default_fn(s.array(s.string), () => (made++, []))) }),
			'cannot serialize `with_default_fn` at /schema/def/a/def/schema: it holds a JavaScript value and is not portable'
		);
		refuses(
			() => s.with_default_fn(s.number, () => 1),
			'cannot serialize `with_default_fn` at /schema: it holds a JavaScript value and is not portable'
		);
		assert.strictEqual(made, 0, '`make` is never called');
	});

	test('an object_with_rest, which the crate does not carry', () => {
		// not among the kinds the crate refuses by name: it refuses it as one it doesn't know
		refuses(
			() => s.object_with_rest({ a: s.string }, s.number),
			'cannot serialize `object_with_rest` at /schema: it is not portable, as the Rust crate does not carry it'
		);
		refuses(
			() => s.array(s.object_with_rest({}, s.string)),
			'cannot serialize `object_with_rest` at /schema/def: it is not portable, as the Rust crate does not carry it'
		);
	});

	test('literals JSON does not hold', () => {
		refuses(
			() => s.literal(undefined),
			'cannot serialize `literal` at /schema/def: a literal must be a string, a finite number, a boolean, or null, not undefined'
		);
		refuses(
			() => s.literal(1n),
			'cannot serialize `literal` at /schema/def: a literal must be a string, a finite number, a boolean, or null, not bigint'
		);
		refuses(
			() => s.literal(NaN),
			'cannot serialize `literal` at /schema/def: a literal must be a string, a finite number, a boolean, or null, not NaN'
		);
		refuses(
			() => s.one_of(['a', Infinity]),
			'cannot serialize `literal` at /schema/def/1: a literal must be a string, a finite number, a boolean, or null, not Infinity'
		);
		refuses(
			() => s.one_of([1, undefined]),
			'cannot serialize `literal` at /schema/def/1: a literal must be a string, a finite number, a boolean, or null, not undefined'
		);
	});

	test('bounds that are not finite numbers', () => {
		refuses(
			() => s.pipe(s.number, s.min_value(1n) as any),
			'cannot serialize `min_value` at /schema/def/1/def: the bound is not a finite number'
		);
		refuses(
			() => s.pipe(s.number, s.max_value(Infinity)),
			'cannot serialize `max_value` at /schema/def/1/def: the bound is not a finite number'
		);
		refuses(
			() => s.pipe(s.string, s.min_length(NaN)),
			'cannot serialize `min_length` at /schema/def/1/def: the bound is not a finite number'
		);
	});

	test('strings that are not well-formed Unicode', () => {
		const reason = 'a string that is not well-formed Unicode, which the crate does not read';
		const lead = '\ud800';
		const trail = 'a\udc00';
		refuses(() => s.literal(lead), `cannot serialize \`literal\` at /schema/def: ${reason}`);
		refuses(
			() => s.array(s.one_of(['a', trail])),
			`cannot serialize \`literal\` at /schema/def/def/1: ${reason}`
		);
		for (const object of [s.object, s.loose_object, s.strip_object]) {
			const schema = object({ a: s.string, [lead]: s.string });
			refuses(
				() => schema,
				`cannot serialize \`${schema.kind}\` at /schema/def: an entry is named by ${reason}`
			);
		}
		refuses(
			() => s.variant(lead, [s.object({ [lead]: s.literal('a') })]),
			`cannot serialize \`variant\` at /schema/def/key: its key is ${reason}`
		);
		for (const value of [lead, ['a', [trail]], { a: { [lead]: 1 } }, { a: [{ b: trail }] }]) {
			refuses(
				() => s.object({ a: s.with_default(s.unknown, value) }),
				`cannot serialize \`with_default\` at /schema/def/a/def/value: the default holds ${reason}`
			);
		}
		// a pair is a well-formed string
		to_schema_json(s.literal('\ud83d\ude00'));
		to_schema_json(
			s.object({ '\ud83d\ude00': s.with_default(s.unknown, { '\ud83d\ude00': '\ud83d\ude00' }) })
		);
	});

	test('a document nested deeper than the crate reads', () => {
		let schema: s.AnySchema = s.string;
		for (let i = 0; i < SCHEMA_JSON_MAX_DEPTH - 1; i++) schema = s.array(schema);
		refuses(
			() => schema,
			`cannot serialize at /schema${'/def'.repeat(SCHEMA_JSON_MAX_DEPTH - 1)}: the document nests deeper than ${SCHEMA_JSON_MAX_DEPTH}, which is as deep as the crate reads`
		);
		// objects nest twice as fast, an entry and its schema
		let objects: s.AnySchema = s.string;
		for (let i = 0; i < SCHEMA_JSON_MAX_DEPTH / 2; i++) objects = s.object({ a: objects });
		refuses(
			() => objects,
			`cannot serialize at /schema${'/def/a'.repeat((SCHEMA_JSON_MAX_DEPTH - 1) / 2)}: the document nests deeper than ${SCHEMA_JSON_MAX_DEPTH}, which is as deep as the crate reads`
		);
		// and a default is part of the document
		let value: unknown = 1;
		for (let i = 0; i < SCHEMA_JSON_MAX_DEPTH - 3; i++) value = [value];
		to_schema_json(s.with_default(s.unknown, value));
		refuses(
			() => s.with_default(s.unknown, [value]),
			`cannot serialize at /schema/def/value${'/0'.repeat(SCHEMA_JSON_MAX_DEPTH - 3)}: the document nests deeper than ${SCHEMA_JSON_MAX_DEPTH}, which is as deep as the crate reads`
		);
	});

	test('a default that holds itself', () => {
		const array: Array<unknown> = [1];
		array.push(array);
		const object: Record<string, unknown> = { a: 1 };
		object.b = { c: object };
		for (const value of [array, object, { a: [object] }]) {
			refuses(
				() => s.with_default(s.unknown, value),
				`cannot serialize \`with_default\` at /schema/def/value: the default nests deeper than ${SCHEMA_JSON_MAX_DEPTH}`
			);
		}
	});

	test('a lazy whose function makes a new lazy each call', () => {
		// a new function each time, so each is a lazy never seen before
		const make = (): s.AnySchema => s.object({ next: s.optional(s.lazy(() => make())) });
		try {
			to_schema_json(make());
		} catch (error) {
			assert(error instanceof Error);
			assert.notStrictEqual(error.name, 'RangeError');
			assert.match(
				error.message,
				/^cannot serialize `\w+` at \/defs\/\$\d+(\/def\/\w+)*: more than 127 schemas around it, through every lazy$/
			);
			return;
		}
		assert.fail('expected a throw');
	});

	test('defaults that are not JSON', () => {
		for (const value of [undefined, 1n, NaN, new Date(0), () => 1, [undefined], { a: undefined }]) {
			refuses(
				() => s.object({ a: s.with_default(s.unknown, value) }),
				'cannot serialize `with_default` at /schema/def/a/def/value: the default is not a JSON value'
			);
		}
	});

	test('entries named like members of Object.prototype', () => {
		for (const key of SCHEMA_JSON_REFUSED_KEYS) {
			for (const object of [s.object, s.loose_object, s.strip_object]) {
				// computed, so that `__proto__` is an entry and not the prototype
				const schema = object({ ok: s.string, [key]: s.unknown });
				refuses(
					() => s.array(schema),
					`cannot serialize \`${schema.kind}\` at /schema/def/def/${key}: the entry is named like a member of Object.prototype`
				);
			}
			// a `variant` with no option reads its key off the input all the same
			refuses(
				() => s.array(s.variant(key, [])),
				'cannot serialize `variant` at /schema/def/def/key: the key is named like a member of Object.prototype'
			);
			// with options the key is an entry, and is refused as one
			refuses(
				() => s.variant(key, [s.object({ [key]: s.literal('a') })]),
				`cannot serialize \`object\` at /schema/def/options/0/def/${key}: the entry is named like a member of Object.prototype`
			);
		}
	});

	test('the names are the members of Object.prototype', () => {
		assert.deepEqual(
			[...SCHEMA_JSON_REFUSED_KEYS],
			Object.getOwnPropertyNames(Object.prototype).sort()
		);
		assert.strictEqual(Object.getPrototypeOf(Object.prototype), null);
	});

	test('actions outside a pipe', () => {
		refuses(
			() => s.min_length(1),
			'cannot serialize `min_length` at /schema: it means something only in a pipe'
		);
		refuses(
			() => s.object({ 'a/b~c': s.max_value(1) }),
			'cannot serialize `max_value` at /schema/def/a~1b~0c: it means something only in a pipe'
		);
		refuses(
			() => s.array(s.optional(s.max_length(1))),
			'cannot serialize `max_length` at /schema/def/def/schema: it means something only in a pipe'
		);
		refuses(
			() => s.union([s.string, s.min_value(1)]),
			'cannot serialize `min_value` at /schema/def/1: it means something only in a pipe'
		);
		refuses(
			() => s.lazy(() => s.min_value(1)),
			'cannot serialize `min_value` at /defs/$0: it means something only in a pipe'
		);
	});

	test('pipes that do not fix a type, or act on another', () => {
		// `pipe` itself reads its first schema when it is made, so one with none is written by hand
		refuses(
			() => ({ kind: 'pipe', def: [], run: s.unknown.run }) satisfies s.SchemaNode<'pipe'>,
			'cannot serialize `pipe` at /schema: it has no schema'
		);
		for (const head of [s.unknown, s.boolean, s.nullable(s.string), s.record(s.string)]) {
			refuses(
				() => s.pipe(head, s.min_length(1)),
				'cannot serialize `pipe` at /schema/def/0: a pipe must start with a schema that fixes the type of its value'
			);
		}
		refuses(
			() => s.pipe(s.string, s.string),
			"cannot serialize `pipe` at /schema/def/1: only actions follow a pipe's first schema"
		);
		refuses(
			() => s.pipe(s.string, s.min_value(0) as any),
			'cannot serialize `pipe` at /schema/def/1: the action is not for a string'
		);
		refuses(
			() => s.pipe(s.string, s.min_length(0), s.integer as any),
			'cannot serialize `pipe` at /schema/def/2: the action is not for a string'
		);
		refuses(
			() => s.pipe(s.number, s.max_length(1) as any),
			'cannot serialize `pipe` at /schema/def/1: the action is not for a number'
		);
		refuses(
			() => s.pipe(s.array(s.string), s.safe_integer as any),
			'cannot serialize `pipe` at /schema/def/1: the action is not for a array'
		);
	});

	test('variants whose options have no literal to select them by', () => {
		// the library throws on most of these itself, so the variant is put together by hand
		const variant = (key: string, options: Array<s.AnySchema>): s.AnySchema => ({
			...s.variant(key, []),
			def: { key, options }
		});
		refuses(
			() => variant('k', [s.object({ k: s.literal('a') }), s.string]),
			'cannot serialize `variant` at /schema/def/options/1: an option must be an object schema'
		);
		// one the library builds: the wrapper's `def` has a `schema`, which is a literal
		refuses(
			() => s.variant('schema', [s.optional(s.literal('a')) as any]),
			'cannot serialize `variant` at /schema/def/options/0: an option must be an object schema'
		);
		for (const option of [
			s.object({}),
			s.object({ k: s.string }),
			s.object({ k: s.optional(s.literal('a')) }),
			s.object({ other: s.literal('a') })
		]) {
			refuses(
				() => variant('k', [option]),
				'cannot serialize `variant` at /schema/def/options/0: an option needs a `literal` entry at "k"'
			);
		}
		// built by the library too, and an inherited member is not an entry
		refuses(
			() => s.variant('toString', [s.object({}) as any]),
			'cannot serialize `variant` at /schema/def/options/0: an option needs a `literal` entry at "toString"'
		);
	});

	test('schemas that come back to themselves without reading into the value', () => {
		const message = ': the schema comes back to itself without reading into the value';
		const optional: s.AnySchema = s.optional(s.lazy(() => optional));
		refuses(() => optional, 'cannot serialize `optional` at /schema' + message);
		const union: s.AnySchema = s.union([s.string, s.lazy(() => union)]);
		refuses(() => s.array(union), 'cannot serialize `union` at /schema' + message);
		const self: s.AnySchema = s.lazy(() => self);
		refuses(() => self, 'cannot serialize `lazy` at /schema' + message);
		const a: s.AnySchema = s.nullable(s.lazy(() => b));
		const b: s.AnySchema = s.with_default(
			s.lazy(() => a),
			null
		);
		refuses(() => s.object({ a }), 'cannot serialize `with_default` at /schema' + message);
	});

	test('schemas that come back to themselves through a container are fine', () => {
		const list: s.AnySchema = s.nullable(s.array(s.lazy(() => list)));
		to_schema_json(list);
		const record: s.AnySchema = s.union([s.string, s.record(s.lazy(() => record))]);
		to_schema_json(record);
		const object: s.AnySchema = s.object({ next: s.optional(s.lazy(() => object)) });
		to_schema_json(object);
	});

	test('nesting past the limit', () => {
		let schema: s.AnySchema = s.string;
		for (let i = 0; i <= SCHEMA_JSON_MAX_NESTING; i++) schema = s.nullable(schema);
		refuses(
			() => schema,
			`cannot serialize \`nullable\` at /schema: more than ${SCHEMA_JSON_MAX_NESTING} wrappers, lazies, unions, and pipes around one value`
		);
	});

	test('what is not a schema, or not a kind of the library', () => {
		refuses(() => s.array(1 as any), 'cannot serialize at /schema/def: not a schema');
		refuses(
			() => ({ kind: 'date', def: undefined, run: (v: unknown) => v }),
			'cannot serialize at /schema: unknown kind "date"'
		);
	});
});
