/**
 * The refusals both sides make of a schema whose interchange document could be
 * written: each a schema `to_schema_json` throws on, the document a writer
 * without that refusal would write of it, and the `SchemaBuildErrorKind` the
 * crate refuses that document with, by its name in snake case and, for a
 * `Json` error, the kind of that error after it.
 *
 * `generate_json_fixture_contract` asserts the TypeScript half as it writes
 * the rows into `contract.json`: `to_schema_json` throws on each schema, with
 * a message that holds the row's, so a refusal another one stands in for
 * fails too. The crate's fixture tests assert the Rust half: each document is
 * refused, with the row's kind, and each kind its `DOCUMENT_REFUSALS` lists
 * has a row. A refusal dropped from either side fails a test.
 *
 * What the form can't hold at all is not here: a function a `lazy` holds, a
 * bigint, and a value that isn't a schema. Nor is what a lenient writer would
 * write as something the crate loads: `JSON.stringify` writes a literal or a
 * default that is not finite as `null`, and the crate would take that `null`
 * as the value, so only `to_schema_json` stands between the two.
 *
 * @module
 */

import * as s from '#lib/schema.ts';

/** A refusal of both sides. */
export interface JsonRefusal {
	/** What the row is of. */
	name: string;
	/** A schema `to_schema_json` refuses. */
	schema: s.AnySchema;
	/** The document a writer without the refusal would write of `schema`. */
	document: string;
	/** The `SchemaBuildErrorKind` of the crate's refusal of `document`. */
	refused: string;
	/** A part of the message `to_schema_json` throws on `schema`, which says why. */
	message: string;
}

/**
 * A schema of `kind` holding `def`, as one written by hand would be, for what
 * the factories refuse or type away before `to_schema_json` sees it.
 */
const by_hand = (kind: string, def: unknown): s.AnySchema =>
	({ kind, def, run: (value: unknown) => value }) as unknown as s.AnySchema;

/** A document of one schema node. */
const doc = (node: string, defs?: string): string =>
	defs === undefined ? `{"schema":${node}}` : `{"schema":${node},"defs":${defs}}`;

const STRING = '{"kind":"string"}';

/** `count` arrays around a string, and the document of them. */
const arrays_around = (count: number): [s.AnySchema, string] => {
	let schema: s.AnySchema = s.string;
	for (let i = 0; i < count; i++) schema = s.array(schema);
	return [schema, `${'{"kind":"array","def":'.repeat(count)}${STRING}${'}'.repeat(count)}`];
};

/** `count` nullables around a string, and the document of them. */
const nullables_around = (count: number): [s.AnySchema, string] => {
	let schema: s.AnySchema = s.string;
	for (let i = 0; i < count; i++) schema = s.nullable(schema);
	return [
		schema,
		`${'{"kind":"nullable","def":{"schema":'.repeat(count)}${STRING}${'}}'.repeat(count)}`
	];
};

const nested = (count: number): string => `${'['.repeat(count)}${']'.repeat(count)}`;

const self: s.AnySchema = s.lazy(() => self);
const self_nullable: s.AnySchema = s.lazy(() => s.nullable(self_nullable));

const [deepest_arrays, deepest_arrays_document] = arrays_around(127);
const [most_nullables, most_nullables_document] = nullables_around(17);

/** Every refusal, in the order of the reasons `to_schema_json` gives. */
export const JSON_REFUSALS: ReadonlyArray<JsonRefusal> = [
	{
		name: 'regex',
		schema: s.pipe(s.string, s.regex(/a/)),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"regex","def":{}}]}`),
		refused: 'unsupported_kind',
		message: '`regex` at /schema/def/1: it holds a JavaScript value and is not portable'
	},
	{
		name: 'check',
		schema: s.pipe(
			s.string,
			s.check(() => true)
		),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"check"}]}`),
		refused: 'unsupported_kind',
		message: '`check` at /schema/def/1: it holds a JavaScript value and is not portable'
	},
	{
		name: 'transform',
		schema: s.pipe(
			s.string,
			s.transform((v: string) => v)
		),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"transform"}]}`),
		refused: 'unsupported_kind',
		message: '`transform` at /schema/def/1: it holds a JavaScript value and is not portable'
	},
	{
		name: 'with_default_fn',
		schema: s.with_default_fn(s.string, () => 'a'),
		document: doc(`{"kind":"with_default_fn","def":{"schema":${STRING}}}`),
		refused: 'unknown_kind',
		message: '`with_default_fn` at /schema: it holds a JavaScript value and is not portable'
	},
	{
		name: 'object_with_rest',
		schema: s.object_with_rest({ a: s.string }, s.number),
		document: doc(
			`{"kind":"object_with_rest","def":{"entries":{"a":${STRING}},"rest":{"kind":"number"}}}`
		),
		refused: 'unknown_kind',
		message:
			'`object_with_rest` at /schema: it is not portable, as the Rust crate does not carry it'
	},
	{
		name: 'length_at_the_root',
		schema: s.min_length(1),
		document: doc('{"kind":"min_length","def":1}'),
		refused: 'action_outside_pipe',
		message: '`min_length` at /schema: it means something only in a pipe'
	},
	{
		name: 'to_lower_case_at_the_root',
		schema: s.to_lower_case,
		document: doc('{"kind":"to_lower_case"}'),
		refused: 'action_outside_pipe',
		message: '`to_lower_case` at /schema: it means something only in a pipe'
	},
	{
		name: 'format_test_as_items',
		schema: s.array(s.uuid),
		document: doc('{"kind":"array","def":{"kind":"uuid"}}'),
		refused: 'action_outside_pipe',
		message: '`uuid` at /schema/def: it means something only in a pipe'
	},
	{
		name: 'bound_as_an_entry',
		schema: s.object({ a: s.max_value(1) }),
		document: doc('{"kind":"object","def":{"a":{"kind":"max_value","def":1}}}'),
		refused: 'action_outside_pipe',
		message: '`max_value` at /schema/def/a: it means something only in a pipe'
	},
	{
		name: 'format_test_as_an_option',
		schema: s.union([s.string, s.iso_datetime]),
		document: doc(`{"kind":"union","def":[${STRING},{"kind":"iso_datetime"}]}`),
		refused: 'action_outside_pipe',
		message: '`iso_datetime` at /schema/def/1: it means something only in a pipe'
	},
	{
		name: 'to_lower_case_in_a_wrapper',
		schema: s.optional(s.to_lower_case),
		document: doc('{"kind":"optional","def":{"schema":{"kind":"to_lower_case"}}}'),
		refused: 'action_outside_pipe',
		message: '`to_lower_case` at /schema/def/schema: it means something only in a pipe'
	},
	{
		name: 'undefined_literal',
		schema: s.literal(undefined),
		document: doc('{"kind":"literal"}'),
		refused: 'unsupported_literal',
		message: 'a literal must be a string, a finite number, a boolean, or null, not undefined'
	},
	{
		name: 'ill_formed_literal',
		schema: s.literal('\ud800'),
		document: doc('{"kind":"literal","def":"\\ud800"}'),
		refused: 'json_lone_surrogate',
		message: '`literal` at /schema/def: a string that is not well-formed Unicode'
	},
	{
		name: 'ill_formed_value',
		schema: s.one_of(['a', '\udc00']),
		document: doc('{"kind":"one_of","def":["a","\\udc00"]}'),
		refused: 'json_lone_surrogate',
		message: '`literal` at /schema/def/1: a string that is not well-formed Unicode'
	},
	{
		name: 'default_of_no_value',
		schema: s.with_default(s.string, undefined as unknown as string),
		document: doc(`{"kind":"with_default","def":{"schema":${STRING}}}`),
		refused: 'malformed',
		message: '`with_default` at /schema/def/value: the default is not a JSON value'
	},
	{
		name: 'default_of_a_function',
		schema: s.with_default(s.string, (() => 'a') as unknown as string),
		document: doc(`{"kind":"with_default","def":{"schema":${STRING}}}`),
		refused: 'malformed',
		message: '`with_default` at /schema/def/value: the default is not a JSON value'
	},
	{
		name: 'ill_formed_default',
		schema: s.with_default(s.unknown, { a: ['\ud800'] }),
		document: doc(
			'{"kind":"with_default","def":{"schema":{"kind":"unknown"},"value":{"a":["\\ud800"]}}}'
		),
		refused: 'json_lone_surrogate',
		message:
			'`with_default` at /schema/def/value: the default holds a string that is not well-formed Unicode'
	},
	{
		name: 'default_too_deep',
		schema: s.with_default(s.unknown, JSON.parse(nested(128))),
		document: doc(
			`{"kind":"with_default","def":{"schema":{"kind":"unknown"},"value":${nested(128)}}}`
		),
		refused: 'json_depth_limit',
		message: '`with_default` at /schema/def/value: the default nests deeper than 127'
	},
	{
		name: 'ill_formed_key',
		schema: s.object({ '\udfff': s.string }),
		document: doc(`{"kind":"object","def":{"\\udfff":${STRING}}}`),
		refused: 'json_lone_surrogate',
		message:
			'`object` at /schema/def: an entry is named by a string that is not well-formed Unicode'
	},
	{
		name: 'prototype_key',
		schema: s.object({ constructor: s.string }),
		document: doc(`{"kind":"object","def":{"constructor":${STRING}}}`),
		refused: 'prototype_key',
		message:
			'`object` at /schema/def/constructor: the entry is named like a member of Object.prototype'
	},
	{
		name: 'proto_key',
		schema: s.loose_object({ ['__proto__']: s.string }),
		document: doc(`{"kind":"loose_object","def":{"__proto__":${STRING}}}`),
		refused: 'prototype_key',
		message:
			'`loose_object` at /schema/def/__proto__: the entry is named like a member of Object.prototype'
	},
	{
		name: 'prototype_key_of_a_variant_with_no_options',
		schema: by_hand('variant', { key: 'toString', options: [] }),
		document: doc('{"kind":"variant","def":{"key":"toString","options":[]}}'),
		refused: 'prototype_key',
		message: '`variant` at /schema/def/key: the key is named like a member of Object.prototype'
	},
	{
		name: 'ill_formed_variant_key',
		schema: by_hand('variant', { key: '\ud800', options: [] }),
		document: doc('{"kind":"variant","def":{"key":"\\ud800","options":[]}}'),
		refused: 'json_lone_surrogate',
		message: '`variant` at /schema/def/key: its key is a string that is not well-formed Unicode'
	},
	{
		name: 'variant_option_not_an_object',
		schema: by_hand('variant', { key: 'k', options: [s.string] }),
		document: doc(`{"kind":"variant","def":{"key":"k","options":[${STRING}]}}`),
		refused: 'variant_option',
		message: '`variant` at /schema/def/options/0: an option must be an object schema'
	},
	{
		name: 'variant_option_with_no_literal',
		schema: by_hand('variant', { key: 'k', options: [s.object({ k: s.string })] }),
		document: doc(
			`{"kind":"variant","def":{"key":"k","options":[{"kind":"object","def":{"k":${STRING}}}]}}`
		),
		refused: 'variant_discriminator',
		message: '`variant` at /schema/def/options/0: an option needs a `literal` entry at "k"'
	},
	{
		name: 'variant_option_with_no_key',
		schema: by_hand('variant', { key: 'k', options: [s.object({ a: s.literal('a') })] }),
		document: doc(
			'{"kind":"variant","def":{"key":"k","options":[{"kind":"object","def":{"a":{"kind":"literal","def":"a"}}}]}}'
		),
		refused: 'variant_discriminator',
		message: '`variant` at /schema/def/options/0: an option needs a `literal` entry at "k"'
	},
	{
		name: 'empty_pipe',
		schema: by_hand('pipe', []),
		document: doc('{"kind":"pipe","def":[]}'),
		refused: 'empty_pipe',
		message: '`pipe` at /schema: it has no schema'
	},
	{
		name: 'pipe_of_a_literal',
		schema: by_hand('pipe', [s.literal('a'), s.min_length(1)]),
		document: doc(
			'{"kind":"pipe","def":[{"kind":"literal","def":"a"},{"kind":"min_length","def":1}]}'
		),
		refused: 'pipe_head',
		message:
			'`pipe` at /schema/def/0: a pipe must start with a schema that fixes the type of its value'
	},
	{
		name: 'pipe_of_an_object',
		schema: by_hand('pipe', [s.object({}), s.min_length(1)]),
		document: doc(
			'{"kind":"pipe","def":[{"kind":"object","def":{}},{"kind":"min_length","def":1}]}'
		),
		refused: 'pipe_head',
		message:
			'`pipe` at /schema/def/0: a pipe must start with a schema that fixes the type of its value'
	},
	{
		name: 'schema_after_the_first',
		schema: by_hand('pipe', [s.string, s.number]),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"number"}]}`),
		refused: 'pipe_step',
		message: "`pipe` at /schema/def/1: only actions follow a pipe's first schema"
	},
	{
		name: 'length_of_a_number',
		schema: by_hand('pipe', [s.number, s.min_length(1)]),
		document: doc('{"kind":"pipe","def":[{"kind":"number"},{"kind":"min_length","def":1}]}'),
		refused: 'action_mismatch',
		message: '`pipe` at /schema/def/1: the action is not for numbers'
	},
	{
		name: 'number_test_of_a_string',
		schema: by_hand('pipe', [s.string, s.integer]),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"integer"}]}`),
		refused: 'action_mismatch',
		message: '`pipe` at /schema/def/1: the action is not for strings'
	},
	{
		name: 'to_lower_case_of_an_array',
		schema: by_hand('pipe', [s.array(s.string), s.to_lower_case]),
		document: doc(
			`{"kind":"pipe","def":[{"kind":"array","def":${STRING}},{"kind":"to_lower_case"}]}`
		),
		refused: 'action_mismatch',
		message: '`pipe` at /schema/def/1: the action is not for arrays'
	},
	{
		name: 'bound_not_finite',
		schema: s.pipe(s.string, s.max_length(Infinity)),
		document: doc(`{"kind":"pipe","def":[${STRING},{"kind":"max_length","def":null}]}`),
		refused: 'malformed',
		message: '`max_length` at /schema/def/1/def: the bound is not a finite number'
	},
	{
		name: 'lazy_to_itself',
		schema: self,
		document: doc('{"kind":"lazy","def":"$0"}', '{"$0":{"kind":"lazy","def":"$0"}}'),
		refused: 'unguarded_recursion',
		message: '`lazy` at /schema: the schema comes back to itself without reading into the value'
	},
	{
		name: 'wrapper_around_itself',
		schema: self_nullable,
		document: doc(
			'{"kind":"lazy","def":"$0"}',
			'{"$0":{"kind":"nullable","def":{"schema":{"kind":"lazy","def":"$0"}}}}'
		),
		refused: 'unguarded_recursion',
		message: '`nullable` at /schema: the schema comes back to itself without reading into the value'
	},
	{
		name: 'too_nested',
		schema: most_nullables,
		document: doc(most_nullables_document),
		refused: 'too_nested',
		message:
			'`nullable` at /schema: more than 16 wrappers, lazies, unions, and pipes around one value'
	},
	{
		name: 'document_too_deep',
		schema: deepest_arrays,
		document: doc(deepest_arrays_document),
		refused: 'json_depth_limit',
		message: 'the document nests deeper than 127, which is as deep as the crate reads'
	}
];
