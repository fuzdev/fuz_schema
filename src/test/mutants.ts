/**
 * The mutants of `npm run mutate`: each a small break of the library, or of a
 * table the tests read, that the suite should fail on. `mutate.ts` applies
 * each to a copy of the working tree and runs the tests, see
 * `docs/testing.md`. Typechecked and linted by `gro check`, which never runs
 * a mutant and holds every anchor, in `mutants.test.ts`.
 *
 * A mutant's `file` is `src/lib/schema.ts` when omitted. Its `edits` apply in
 * order, and each `find` occurs exactly once in the file as the edits before
 * it left it: a `find` that doesn't is a stale anchor, and fails the run, as
 * do edits that leave the file unparsable to TypeScript. A mutant the suite can't kill names
 * why in `survives`.
 *
 * @module
 */

export interface MutantEdit {
	find: string;
	replace: string;
}

export interface Mutant {
	name: string;
	file?: string;
	edits: Array<MutantEdit>;
	survives?: string;
}

/** The file a mutant edits when it names none. */
export const MUTANT_DEFAULT_FILE = 'src/lib/schema.ts';

/**
 * The test files `npm run mutate` leaves out of every run: the snapshot of
 * sizes, which any edit of the library fails, the tests that render the
 * site's components, which need the site's plugins and which no mutant is
 * of, and the test of this table, whose anchors a mutant applied has taken
 * its own from.
 */
export const MUTATE_EXCLUDED_TESTS = [
	'src/test/sizes.test.ts',
	'src/test/site_render.test.ts',
	'src/test/results_roster.test.ts',
	'src/test/mutants.test.ts'
];

/**
 * Applies a mutant's edits to the text of its file.
 *
 * @param mutant - the mutant
 * @param original - the text of the mutant's file
 * @returns the mutated text as `text`, or as `problem` the reason an anchor is stale or the edits change nothing
 */
export const apply_mutant = (
	mutant: Mutant,
	original: string
): { text: string } | { problem: string } => {
	const file = mutant.file ?? MUTANT_DEFAULT_FILE;
	let text = original;
	for (let i = 0; i < mutant.edits.length; i++) {
		const { find, replace } = mutant.edits[i]!;
		const count = text.split(find).length - 1;
		if (count !== 1) {
			return {
				problem: `${mutant.name}: edit ${i + 1} finds ${count} occurrences in ${file}, not 1`
			};
		}
		text = text.replace(find, () => replace);
	}
	return text === original ? { problem: `${mutant.name}: its edits change nothing` } : { text };
};

export const MUTANTS: Array<Mutant> = [
	{
		name: 'issue_cap_off',
		edits: [
			{
				find: `const MAX_ISSUES = 100;`,
				replace: `const MAX_ISSUES = Infinity;`
			}
		]
	},
	{
		name: 'issue_cap_one_over',
		edits: [
			{
				find: `	if (ctx.fails++ < MAX_ISSUES && !ctx.probe) {`,
				replace: `	if (ctx.fails++ <= MAX_ISSUES && !ctx.probe) {`
			}
		]
	},
	{
		name: 'issue_cap_one_short',
		edits: [
			{
				find: `	if (ctx.fails++ < MAX_ISSUES && !ctx.probe) {`,
				replace: `	if (++ctx.fails < MAX_ISSUES && !ctx.probe) {`
			}
		]
	},
	{
		name: 'issue_cap_stops_count',
		edits: [
			{
				find: `	if (ctx.fails++ < MAX_ISSUES && !ctx.probe) {`,
				replace: `	if ((ctx.fails < MAX_ISSUES ? ctx.fails++ : ctx.fails) < MAX_ISSUES && !ctx.probe) {`
			}
		]
	},
	{
		name: 'issue_cap_stops_count_in_probe',
		edits: [
			{
				find: `	if (ctx.fails++ < MAX_ISSUES && !ctx.probe) {`,
				replace: `	if ((ctx.probe && ctx.fails >= MAX_ISSUES ? ctx.fails : ctx.fails++) < MAX_ISSUES && !ctx.probe) {`
			}
		]
	},
	{
		name: 'issue_cap_builds_in_probe',
		edits: [
			{
				find: `	if (ctx.fails++ < MAX_ISSUES && !ctx.probe) {`,
				replace: `	if (ctx.fails++ < MAX_ISSUES) {`
			}
		]
	},
	{
		name: 'error_message_every_issue',
		edits: [
			{
				find: `			issues.slice(0, 10).map(format_issue).join('\\n') +`,
				replace: `			issues.map(format_issue).join('\\n') +`
			}
		]
	},
	{
		name: 'error_message_eleven_issues',
		edits: [
			{
				find: `			issues.slice(0, 10).map(format_issue).join('\\n') +`,
				replace: `			issues.slice(0, 11).map(format_issue).join('\\n') +`
			}
		]
	},
	{
		name: 'error_message_no_more_line',
		edits: [
			{
				find: `				(fails > 10 ? \`\\nand \${fails - 10} more\` : '')`,
				replace: `				''`
			}
		]
	},
	{
		name: 'error_message_more_miscounted',
		edits: [
			{
				find: `\`\\nand \${fails - 10} more\``,
				replace: `\`\\nand \${fails - 9} more\``
			}
		]
	},
	{
		name: 'error_message_more_at_ten',
		edits: [
			{
				find: `(fails > 10 ?`,
				replace: `(fails >= 10 ?`
			}
		]
	},
	{
		name: 'object_accepts_unknown',
		edits: [
			{
				find: `					else if (!Object.hasOwn(entries, key)) {
						fail_at(ctx, 'unknown_key'`,
				replace: `					else if (false as boolean) {
						fail_at(ctx, 'unknown_key'`
			}
		]
	},
	{
		name: 'object_accepts_inherited_unknown',
		edits: [
			{
				find: `					else if (!Object.hasOwn(entries, key)) {
						fail_at(ctx, 'unknown_key'`,
				replace: `					else if (!Object.hasOwn(entries, key) && Object.hasOwn(value, key)) {
						fail_at(ctx, 'unknown_key'`
			}
		]
	},
	{
		name: 'object_accepts_unknown_proto_named',
		edits: [
			{
				find: `					else if (!Object.hasOwn(entries, key)) {
						fail_at(ctx, 'unknown_key'`,
				replace: `					else if (!Object.hasOwn(entries, key) && key !== '__proto__') {
						fail_at(ctx, 'unknown_key'`
			}
		]
	},
	{
		name: 'strip_not_stripping',
		edits: [
			{
				find: `			if (output !== value || ctx.fails > count) return output;`,
				replace: `			if ((true as boolean) || ctx.fails > count) return output;`
			}
		]
	},
	{
		name: 'strip_keeps_inherited_copy',
		edits: [
			{
				find: `						if (u !== undefined || k in value) copy[k] = u;`,
				replace: `						if (u !== undefined || k in value) copy[k] = u;
					}
					for (const k in value) if (!Object.hasOwn(value, k) && k !== '__proto__') copy[k] = value[k];
					if (0) {`
			}
		]
	},
	{
		name: 'union_last_option_plain',
		edits: [
			{
				find: `					for (let i = 0; i < options.length; i++) {
						const output = options[i]!.run(value, ctx);`,
				replace: `					for (let i = options.length - 1; i >= 0; i--) {
						const output = options[i]!.run(value, ctx);`
			}
		]
	},
	{
		name: 'union_last_option_keyed',
		edits: [
			{
				find: `					for (let i = 0; i < options.length; i++) {
						const output = options[i]!.run(value, ctx, parent, key);`,
				replace: `					for (let i = options.length - 1; i >= 0; i--) {
						const output = options[i]!.run(value, ctx, parent, key);`
			}
		]
	},
	{
		name: 'union_no_retry',
		edits: [
			{
				find: `							if (output !== undefined && parent && !((key as string) in parent)) {`,
				replace: `							if (false as boolean) {`
			}
		]
	},
	{
		name: 'record_skips_k1',
		edits: [
			{
				find: `			if (!Object.hasOwn(value, key)) continue;`,
				replace: `			if (!Object.hasOwn(value, key) || key === 'k1') continue;`
			}
		]
	},
	{
		name: 'record_skips_constructor',
		edits: [
			{
				find: `			if (!Object.hasOwn(value, key)) continue;`,
				replace: `			if (!Object.hasOwn(value, key) || key === 'constructor' || key === 'prototype') continue;`
			}
		]
	},
	{
		name: 'record_validates_inherited',
		edits: [{ find: `			if (!Object.hasOwn(value, key)) continue;`, replace: `` }]
	},
	{
		name: 'min_length_off_by_one',
		edits: [{ find: `			value.length >= min`, replace: `			value.length > min` }]
	},
	{
		name: 'max_length_off_by_one',
		edits: [{ find: `			value.length <= max`, replace: `			value.length < max` }]
	},
	{
		name: 'max_length_counts_code_points',
		edits: [
			{
				find: `			value.length <= max`,
				replace: `			(typeof value === 'string' ? [...value].length : value.length) <= max`
			}
		]
	},
	{
		name: 'optional_null_as_missing',
		edits: [
			{
				find: `	run: (value, ctx) => (value === undefined ? undefined : (schema.run(value, ctx) as Infer<T>))`,
				replace: `	run: (value, ctx) => (value == null ? undefined : (schema.run(value, ctx) as Infer<T>))`
			}
		]
	},
	{
		name: 'nan_named_number',
		edits: [
			{
				find: `						: typeof value === 'number' && !isFinite(value)`,
				replace: `						: typeof value === 'number' && !isFinite(value) && value === value`
			}
		]
	},
	{
		name: 'union_expected_text',
		edits: [
			{
				find: `join(' | '))
					);
				}
			: (value, ctx) => {`,
				replace: `join(' or '))
					);
				}
			: (value, ctx) => {`
			},
			{ find: `join(' | '))`, replace: `join(' or '))` }
		]
	},
	{
		name: 'number_takes_infinity',
		edits: [
			{
				find: `	run: (value, ctx) => (Number.isFinite(value) ? value : fail(ctx, 'number', value))`,
				replace: `	run: (value, ctx) => (typeof value === 'number' && value === value ? value : fail(ctx, 'number', value))`
			}
		]
	},
	{
		name: 'integer_safe_only',
		edits: [
			{
				find: `	run: (value, ctx) => (Number.isInteger(value) ? value : fail(ctx, 'integer', value))`,
				replace: `	run: (value, ctx) => (Number.isSafeInteger(value) ? value : fail(ctx, 'integer', value))`
			}
		]
	},
	{
		name: 'safe_integer_any',
		edits: [
			{
				find: `	run: (value, ctx) => (Number.isSafeInteger(value) ? value : fail(ctx, 'safe_integer', value))`,
				replace: `	run: (value, ctx) => (Number.isInteger(value) ? value : fail(ctx, 'safe_integer', value))`
			}
		]
	},
	{
		name: 'uuid_variant_c',
		edits: [
			{
				find: `(0x3000006 >>> value.charCodeAt(19))`,
				replace: `(0x300000e >>> value.charCodeAt(19))`
			}
		]
	},
	{
		name: 'uuid_version_9',
		edits: [
			{
				find: `(0x1fe0000 >>> value.charCodeAt(14))`,
				replace: `(0x3fe0000 >>> value.charCodeAt(14))`
			}
		]
	},
	{
		name: 'uuid_no_max',
		edits: [{ find: `/^[-0]+$|^[-f]+$/i`, replace: `/^[-0]+$/i` }]
	},
	{
		name: 'uuid_trailing_char',
		edits: [
			{
				find: `if (value.length !== 36) return false;`,
				replace: `if (value.length < 36) return false;`
			}
		]
	},
	{
		name: 'uuid_no_last_dash',
		edits: [{ find: `(0x842100 >>> i) & 1`, replace: `(0x042100 >>> i) & 1` }]
	},
	{
		name: 'uuid_last_char_unread',
		edits: [{ find: `for (let i = 0; i < 36; i++) {`, replace: `for (let i = 0; i < 35; i++) {` }]
	},
	{
		name: 'uuid_hex_to_g',
		edits: [
			{
				find: `(c - 48) >>> 0 > 9 && ((c | 32) - 97) >>> 0 > 5`,
				replace: `(c - 48) >>> 0 > 9 && ((c | 32) - 97) >>> 0 > 6`
			}
		]
	},
	{
		name: 'uuid_dash_masked',
		edits: [
			{
				find: `(0x842100 >>> i) & 1 ? c !== 45 :`,
				replace: `(0x842100 >>> i) & 1 ? (c & 0x3ff) !== 45 :`
			}
		]
	},
	{
		name: 'uuid_hex_to_colon',
		edits: [
			{
				find: `(c - 48) >>> 0 > 9 && ((c | 32) - 97) >>> 0 > 5`,
				replace: `(c - 48) >>> 0 > 10 && ((c | 32) - 97) >>> 0 > 5`
			}
		]
	},
	{
		name: 'uuid_hex_lowercase_only',
		edits: [
			{
				find: `(c - 48) >>> 0 > 9 && ((c | 32) - 97) >>> 0 > 5`,
				replace: `(c - 48) >>> 0 > 9 && (c - 97) >>> 0 > 5`
			}
		]
	},
	{
		name: 'uuid_dash_anywhere',
		edits: [{ find: `? c !== 45 :`, replace: `? c !== 45 : c !== 45 &&` }]
	},
	{
		name: 'uuid_no_type_guard',
		edits: [
			{
				find: `typeof value === 'string' && is_uuid(value)`,
				replace: `is_uuid(value)`
			}
		]
	},
	{
		name: 'iso_datetime_fraction_of_ten',
		edits: [{ find: `(?:\\.\\d{1,9})?Z$/`, replace: `(?:\\.\\d{1,10})?Z$/` }]
	},
	{
		name: 'iso_datetime_offset_of_an_hour',
		edits: [{ find: `(?:\\.\\d{1,9})?Z$/`, replace: `(?:\\.\\d{1,9})?(?:Z|[+-]\\d\\d)$/` }]
	},
	{
		name: 'iso_datetime_offset_after_a_space',
		edits: [{ find: `(?:\\.\\d{1,9})?Z$/`, replace: `(?:\\.\\d{1,9})?(?:Z| [+-]\\d\\d:\\d\\d)$/` }]
	},
	{
		name: 'iso_datetime_offset_one_digit',
		edits: [{ find: `(?:\\.\\d{1,9})?Z$/`, replace: `(?:\\.\\d{1,9})?(?:Z|[+-]\\d)$/` }]
	},
	{
		name: 'iso_datetime_space_before_z',
		edits: [{ find: `(?:\\.\\d{1,9})?Z$/`, replace: `(?:\\.\\d{1,9})? ?Z$/` }]
	},
	{
		name: 'iso_datetime_1900_leap',
		edits: [{ find: `|[13579][26]00)-02-29`, replace: `|\\d\\d00)-02-29` }]
	},
	{
		name: 'check_at_path_reversed',
		edits: [
			{
				find: `for (let i = keys.length; i--;) prefix_path(ctx.issues!, count, keys[i]!);`,
				replace: `for (let i = 0; i < keys.length; i++) prefix_path(ctx.issues!, count, keys[i]!);`
			}
		]
	},
	{
		name: 'check_at_received_of_the_value',
		edits: [
			{
				find: `for (const key of keys) at = at !== null && typeof at === 'object' ? at[key] : undefined;`,
				replace: ``
			}
		]
	},
	{
		name: 'check_at_walk_past_the_cap',
		edits: [
			{
				find: `const builds = count < MAX_ISSUES && !ctx.probe;`,
				replace: `const builds = !ctx.probe;`
			}
		]
	},
	{
		name: 'to_lower_case_identity',
		edits: [{ find: `run: (value) => value.toLowerCase()`, replace: `run: (value) => value` }]
	},
	{
		name: 'run_entries_writes_missing',
		edits: [
			{
				find: `			// a key the input doesn't have stays out of the output
			if (v !== undefined || key in value) output[key] = v;`,
				replace: `			output[key] = v;`
			}
		]
	},
	{
		name: 'loose_copies_inherited',
		edits: [
			{
				find: `						Object.hasOwn(value, key) &&
						!Object.hasOwn(entries, key) &&
						// assigning`,
				replace: `						!Object.hasOwn(entries, key) &&
						// assigning`
			}
		]
	},
	{
		name: 'loose_copies_own_proto_via_define',
		edits: [
			{
				find: `						key !== '__proto__'
					) {
						output[key] = value[key];`,
				replace: `						true
					) {
						Object.defineProperty(output, key, {value: value[key], enumerable: true, writable: true, configurable: true});`
			}
		]
	},
	{
		name: 'rest_validates_inherited',
		edits: [
			{
				find: `				else if (Object.hasOwn(value, key) && !Object.hasOwn(entries, key)) {
					const input = value[key];`,
				replace: `				else if (!Object.hasOwn(entries, key)) {
					const input = value[key];`
			}
		]
	},
	{
		name: 'variant_ignores_missing',
		edits: [
			{
				find: `			const option = by_value.get(value[key]);`,
				replace: `			const option = by_value.get(value[key]) ?? (key in value ? undefined : by_value.values().next().value);`
			}
		]
	},
	{
		name: 'array_skips_holes',
		edits: [
			{
				find: `		for (let i = 0; i < length; i++) {
			const input = value[i];`,
				replace: `		for (let i = 0; i < length; i++) {
			if (!(i in value)) continue;
			const input = value[i];`
			}
		]
	},
	{
		name: 'nullable_drops_key',
		edits: [
			{
				find: `					value === null ? null : (schema.run(value, ctx, parent, key) as Infer<T>)`,
				replace: `					value === null ? null : (schema.run(value, ctx) as Infer<T>)`
			}
		]
	},
	{
		name: 'pipe_optional_runs_steps',
		edits: [
			{
				find: `						if (entry && !((key as string) in parent!)) return;\n`,
				replace: ``
			}
		]
	},
	{
		name: 'pipe_optional_runs_first_twice',
		edits: [
			{
				find: `						if (entry && !((key as string) in parent!)) return;
						const count = ctx.fails;
						let output = schemas[0]!.run(value, ctx);
						for (let i = 1; i < schemas.length && ctx.fails === count; i++) {`,
				replace: `						if (entry && !((key as string) in parent!)) return;
						const count = ctx.fails;
						let output = schemas[0]!.run(value, ctx);
						for (let i = 0; i < schemas.length && ctx.fails === count; i++) {`
			}
		]
	},
	{
		name: 'pipe_optional_counts_after_first',
		edits: [
			{
				find: `						if (entry && !((key as string) in parent!)) return;
						const count = ctx.fails;
						let output = schemas[0]!.run(value, ctx);
						for (let i = 1; i < schemas.length && ctx.fails === count; i++) {`,
				replace: `						if (entry && !((key as string) in parent!)) return;
						let output = schemas[0]!.run(value, ctx);
						const count = ctx.fails;
						for (let i = 1; i < schemas.length && ctx.fails === count; i++) {`
			}
		]
	},
	{
		name: 'pipe_optional_runs_past_failure',
		edits: [
			{
				find: `						if (entry && !((key as string) in parent!)) return;
						const count = ctx.fails;
						let output = schemas[0]!.run(value, ctx);
						for (let i = 1; i < schemas.length && ctx.fails === count; i++) {`,
				replace: `						if (entry && !((key as string) in parent!)) return;
						const count = ctx.fails;
						let output = schemas[0]!.run(value, ctx);
						for (let i = 1; i < schemas.length && count === count; i++) {`
			}
		]
	},
	{
		// the guard declined in docs/declined.md: the tests pin the throw it would remove
		name: 'fail_names_revoked_proxy',
		edits: [
			{
				find: `					: Array.isArray(value)
						? 'array'`,
				replace: `					: (() => { try { return Array.isArray(value); } catch { return false; } })()
						? 'array'`
			}
		]
	},
	{
		name: 'pipe_continues_after_fail',
		edits: [
			{
				find: `		for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};`,
				replace: `		for (let i = 1; i < schemas.length && (ctx.fails === count || true); i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};`
			}
		]
	},
	{
		name: 'with_default_null',
		edits: [
			{
				find: `	run: (v, ctx) => (v === undefined ? value : schema.run(v, ctx))`,
				replace: `	run: (v, ctx) => (v == null ? value : schema.run(v, ctx))`
			}
		]
	},
	{
		name: 'check_fills_missing_key',
		edits: [
			{
				find: `	run: (value, ctx) => (fn(value) ? value : fail(ctx, 'check', value, expected))`,
				replace: `	run: (value: any, ctx: any, parent?: any, key?: any) => (parent && !(key in parent) ? 'X' : fn(value) ? value : fail(ctx, 'check', value, expected))`
			}
		]
	},
	{
		name: 'check_fails_missing_key_off_path',
		edits: [
			{
				find: `	run: (value, ctx) => (fn(value) ? value : fail(ctx, 'check', value, expected))`,
				replace: `	run: (value: any, ctx: any, parent?: any, key?: any) => (parent && !(key in parent) ? (fail(ctx, 'check', value, expected), (ctx.issues && ctx.issues.at(-1).path.push('zz')), value) : fn(value) ? value : fail(ctx, 'check', value, expected))`
			}
		]
	},
	{
		name: 'record_proto_fails_root',
		edits: [
			{
				find: `if (not_object(value)) return fail(ctx, 'record', value, 'object');`,
				replace: `if (not_object(value)) return fail(ctx, 'record', value, 'object');
		if (Object.hasOwn(value, '__proto__')) return fail(ctx, 'record', value, 'object');`
			}
		]
	},
	{
		name: 'record_proto_always_fails',
		edits: [
			{
				find: `			const v = schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`,
				replace: `			const v = key === '__proto__' ? fail(ctx, 'record', input, 'object') : schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`
			}
		]
	},
	{
		name: 'record_proto_unvalidated',
		edits: [
			{
				find: `			const v = schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`,
				replace: `			const v = key === '__proto__' ? input : schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`
			}
		]
	},
	{
		name: 'strip_ignores_proto_key',
		edits: [
			{
				find: `				else if (!Object.hasOwn(entries, key)) {
					const copy`,
				replace: `				else if (!Object.hasOwn(entries, key) && key !== '__proto__') {
					const copy`
			}
		]
	},
	{
		name: 'rest_validates_inherited_proto',
		edits: [
			{
				find: `				else if (Object.hasOwn(value, key) && !Object.hasOwn(entries, key)) {
					const input = value[key];`,
				replace: `				else if ((Object.hasOwn(value, key) || key === '__proto__') && !Object.hasOwn(entries, key)) {
					const input = value[key];`
			}
		]
	},
	{
		name: 'array_infinity_path_off',
		edits: [
			{
				find: `				prefix_path(ctx.issues!, count, i);`,
				replace: `				prefix_path(ctx.issues!, count, value[i] === Infinity || value[i] === -Infinity ? i + 1 : i);`
			}
		]
	},
	{
		name: 'number_takes_neg_infinity',
		edits: [
			{
				find: `	run: (value, ctx) => (Number.isFinite(value) ? value : fail(ctx, 'number', value))`,
				replace: `	run: (value, ctx) => (Number.isFinite(value) || value === -Infinity ? value : fail(ctx, 'number', value))`
			}
		]
	},
	{
		name: 'rest_fails_constructor_always',
		edits: [
			{
				find: `					const v = keep ? rest.run(input, ctx) : input;`,
				replace: `					const v = keep ? (key === 'constructor' ? fail(ctx, 'object_with_rest', input, 'object') : rest.run(input, ctx)) : input;`
			}
		]
	},
	{
		name: 'record_class_unvalidated',
		edits: [
			{
				find: `			const v = schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`,
				replace: `			const p0 = Object.getPrototypeOf(value);
			const v = p0 !== Object.prototype && p0 !== null && input !== undefined ? input : schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped`
			}
		]
	},
	{
		name: 'check_fills_missing_key_when_passing',
		edits: [
			{
				find: `	run: (value, ctx) => (fn(value) ? value : fail(ctx, 'check', value, expected))`,
				replace: `	run: (value: any, ctx: any, parent?: any, key?: any) => (fn(value) ? (parent && !(key in parent) ? 'X' : value) : fail(ctx, 'check', value, expected))`
			}
		]
	},
	{
		name: 'transform_fills_missing_key',
		edits: [
			{
				find: `	run: (value) => fn(value)
});`,
				replace: `	run: (value: any, _ctx: any, parent?: any, key?: any) =>
		parent && !(key in parent) ? ('X' as O) : fn(value)
});`
			}
		]
	},
	{
		name: 'loose_copy_omits_constructor',
		edits: [
			{
				find: `						key !== '__proto__'
					) {`,
				replace: `						key !== '__proto__' && key !== 'constructor'
					) {`
			}
		]
	},
	{
		name: 'record_copy_includes_inherited',
		edits: [
			{
				find: `					if (Object.hasOwn(value, k) && k !== '__proto__') output[k] = value[k];`,
				replace: `					if (k !== '__proto__') output[k] = value[k];`
			}
		]
	},
	{
		name: 'rest_copy_includes_inherited',
		edits: [
			{
				find: `							if (Object.hasOwn(value, k) && !Object.hasOwn(entries, k)) output[k] = value[k];`,
				replace: `							if (!Object.hasOwn(entries, k)) output[k] = value[k];`
			}
		]
	},
	{
		name: 'rest_class_unvalidated',
		edits: [
			{
				find: `					const v = keep ? rest.run(input, ctx) : input;`,
				replace: `					const v = keep && !(Object.getPrototypeOf(value) !== Object.prototype) ? rest.run(input, ctx) : input;`
			}
		]
	},
	{
		name: 'record_class_undefined_unfilled',
		edits: [
			{
				find: `			const v = schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped
			const keep = key !== '__proto__';`,
				replace: `			const v = input === undefined && Object.getPrototypeOf(value) !== Object.prototype ? input : schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped
			const keep = key !== '__proto__';`
			}
		]
	},
	{
		name: 'loose_entry_own_only',
		edits: [
			{
				find: `				const key = keys[i]!;
				const input = value[key];
				const count = ctx.fails;
				// the object, the key, and \`1\` too, as in \`run_entries\``,
				replace: `				const key = keys[i]!;
				const input = Object.hasOwn(value, key) ? value[key] : undefined;
				const count = ctx.fails;
				// the object, the key, and \`1\` too, as in \`run_entries\``
			}
		]
	},
	{
		name: 'optional_default_fills',
		edits: [
			{
				find: `	run: (value, ctx) => (value === undefined ? undefined : (schema.run(value, ctx) as Infer<T>))
});

/**
 * Accepts \`null\`.`,
				replace: `	run: (value, ctx) => (value === undefined ? (schema.kind === 'with_default' ? (schema.run(value, ctx) as Infer<T>) : undefined) : (schema.run(value, ctx) as Infer<T>))
});

/**
 * Accepts \`null\`.`
			}
		]
	},
	{
		name: 'record_refuses_class',
		edits: [
			{
				find: `		if (not_object(value)) return fail(ctx, 'record', value, 'object');
		let output`,
				replace: `		if (not_object(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return fail(ctx, 'record', value, 'object');
		let output`
			}
		]
	},
	{
		name: 'rest_drops_own_prototype',
		edits: [
			{
				find: `					const keep = key !== '__proto__';
					const count = ctx.fails;`,
				replace: `					const keep = key !== '__proto__' && key !== 'prototype';
					const count = ctx.fails;`
			}
		]
	},
	{
		name: 'loose_copy_drops_ctor_beside_missing',
		edits: [
			{
				find: `			let output: Record<string, unknown> | undefined;
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]!;
				const input = value[key];`,
				replace: `			let output: Record<string, unknown> | undefined;
			let missing_any = false;
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]!;
				if (!(key in value)) missing_any = true;
				const input = value[key];`
			},
			{
				find: `						key !== '__proto__'
					) {`,
				replace: `						key !== '__proto__' && !(missing_any && (key === 'constructor' || key === 'prototype'))
					) {`
			}
		]
	},
	{
		name: 'record_class_prototype_unread',
		edits: [
			{
				find: `			if (!Object.hasOwn(value, key)) continue;`,
				replace: `			if (!Object.hasOwn(value, key) || (key === 'prototype' && Object.getPrototypeOf(value) !== Object.prototype)) continue;`
			}
		]
	},
	{
		name: 'rest_inheriting_drops_ctor',
		edits: [
			{
				find: `					const keep = key !== '__proto__';
					const count = ctx.fails;`,
				replace: `					const keep = key !== '__proto__' && !((key === 'constructor' || key === 'prototype') && Object.getPrototypeOf(value) !== Object.prototype);
					const count = ctx.fails;`
			}
		]
	},
	{
		name: 'record_class_ignores_output',
		edits: [
			{
				find: `			const v = schema.run(input, ctx);
			// assigning a \`__proto__\` key would set the prototype, so it's dropped
			const keep = key !== '__proto__';`,
				replace: `			const v0 = schema.run(input, ctx);
			const v = Object.getPrototypeOf(value) !== Object.prototype && v0 !== undefined && typeof v0 !== 'object' ? input : v0;
			// assigning a \`__proto__\` key would set the prototype, so it's dropped
			const keep = key !== '__proto__';`
			}
		]
	},
	{
		name: 'loose_copy_drops_ctor_many_unknown',
		edits: [
			{
				find: `						key !== '__proto__'
					) {`,
				replace: `						key !== '__proto__' && !((key === 'constructor' || key === 'prototype') && Object.keys(value).filter((k) => !Object.hasOwn(entries, k)).length > 1)
					) {`
			}
		]
	},
	{
		name: 'record_skips_prototype',
		edits: [
			{
				find: `			if (!Object.hasOwn(value, key)) continue;
			const input = value[key];`,
				replace: `			if (!Object.hasOwn(value, key) || key === 'prototype') continue;
			const input = value[key];`
			}
		]
	},
	{
		name: 'loose_copies_dropping_inherited',
		edits: [
			{
				find: `			// only a copy looks at the unknown keys, which follow the schema's
			if (output) {`,
				replace: `			// only a copy looks at the unknown keys, which follow the schema's
			if (!output && ctx.fails === 0) { for (const k in value) if (!Object.hasOwn(value, k)) { output = {}; for (const j of keys) { if (j in value) output[j] = value[j]; } break; } }
			if (output) {`
			}
		]
	},
	{
		name: 'default_undefined_writes_key',
		edits: [
			{
				find: `		} else if (output) {
			// a key the input doesn't have stays out of the output
			if (v !== undefined || key in value) output[key] = v;
		} else if (!Object.is(v, input)) {
			output = {};
			// only this schema's keys, in its order`,
				replace: `		} else if (output) {
			// a key the input doesn't have stays out of the output
			if (v !== undefined || key in value || schemas[i]!.kind === 'with_default') output[key] = v;
		} else if (!Object.is(v, input) || (schemas[i]!.kind === 'with_default' && !(key in value))) {
			output = {};
			// only this schema's keys, in its order`
			}
		]
	},
	{
		name: 'default_fills_undefined_output',
		edits: [
			{
				find: `	run: (v, ctx) => (v === undefined ? value : schema.run(v, ctx))
});`,
				replace: `	run: (v, ctx) => { if (v === undefined) return value; const r = schema.run(v, ctx); return r === undefined ? value : r; }
});`
			}
		]
	},
	{
		name: 'default_runs_schema',
		edits: [
			{
				find: `	run: (v, ctx) => (v === undefined ? value : schema.run(v, ctx))
});`,
				replace: `	run: (v, ctx) => (v === undefined ? schema.run(value, ctx) : schema.run(v, ctx))
});`
			}
		]
	},
	{
		name: 'pipe_default_undefined_skips',
		edits: [
			{
				find: `			first.kind === 'optional'
				?`,
				replace: `			first.kind === 'optional' || ((first.kind === 'with_default') && (first.def as any).value === undefined)
				?`
			}
		]
	},
	{
		name: 'transform_missing_fails',
		edits: [
			{
				find: `	run: (value) => fn(value)
});`,
				replace: `	run: (value: any, ctx: any, parent?: any, key?: any) => (parent && !((key as string) in parent) ? fail(ctx, 'missing_key', value, 'a required key') : fn(value))
});`
			}
		]
	},
	{
		name: 'check_after_unknown_runs',
		edits: [
			{
				find: `		let output = schemas[0]!.run(value, ctx);
		for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};`,
				replace: `		let output = schemas[0]!.run(value, ctx);
		for (let i = 1; i < schemas.length && (ctx.fails === count || (!ctx.probe && schemas[i]!.kind === 'check' && ctx.issues!.slice(count).every((x) => x.kind === 'unknown_key'))); i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};`
			}
		]
	},
	{
		name: 'max_length_reports_length',
		edits: [
			{
				find: `		let output = schemas[0]!.run(value, ctx);
		for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		return output;
	};`,
				replace: `		let output = schemas[0]!.run(value, ctx);
		for (let i = 1; i < schemas.length && ctx.fails === count; i++) {
			output = schemas[i]!.run(output, ctx);
		}
		const m = schemas.find((x) => x.kind === 'max_length');
		if (ctx.fails > count && Array.isArray(value) && m && value.length > (m.def as number)) { if (ctx.issues) ctx.issues.length = count; ctx.fails = count; fail(ctx, 'max_length', value, \`length <= \${m.def}\`); }
		return output;
	};`
			}
		]
	},
	{
		name: 'record_takes_array',
		edits: [
			{
				find: `		if (not_object(value)) return fail(ctx, 'record', value, 'object');
		let output`,
				replace: `		if (value === null || typeof value !== 'object') return fail(ctx, 'record', value, 'object');
		let output`
			}
		]
	},
	{
		name: 'loose_drops_own_constructor_always',
		edits: [
			{
				find: `			// only a copy looks at the unknown keys, which follow the schema's
			if (output) {`,
				replace: `			// only a copy looks at the unknown keys, which follow the schema's
			if (!output && ctx.fails === 0 && ['constructor', 'prototype'].some((k) => Object.hasOwn(value, k) && !Object.hasOwn(entries, k))) { output = {}; for (const j of keys) { if (j in value) output[j] = value[j]; } }
			if (output) {`
			},
			{
				find: `						key !== '__proto__'
					) {`,
				replace: `						key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
					) {`
			}
		]
	},
	{
		name: 'loose_default_undefined_writes_key',
		edits: [
			{
				find: `				} else if (output) {
					// a key the input doesn't have stays out of the output
					if (v !== undefined || key in value) output[key] = v;
				} else if (!Object.is(v, input)) {`,
				replace: `				} else if (output) {
					// a key the input doesn't have stays out of the output
					if (v !== undefined || key in value || schemas[i]!.kind === 'with_default') output[key] = v;
				} else if (!Object.is(v, input) || (schemas[i]!.kind === 'with_default' && !(key in value))) {`
			}
		]
	},
	{
		name: 'message_labels_only_own',
		edits: [
			{
				find: `		issue.message ??=
			typeof message === 'string'`,
				replace: `		if (!issue.path.length) issue.message ??=
			typeof message === 'string'`
			}
		]
	},
	{
		name: 'message_outer_wins',
		edits: [
			{
				find: `		issue.message ??=
			typeof message === 'string'`,
				replace: `		issue.message =
			typeof message === 'string'`
			}
		]
	},
	{
		name: 'message_labels_earlier',
		edits: [
			{
				find: `	for (let i = count; i < issues.length; i++) {`,
				replace: `	for (let i = 0; i < issues.length; i++) {`
			}
		]
	},
	{
		name: 'message_value_at_path',
		edits: [
			{
				find: `message({ ...issue, path: issue.path.toReversed() }, value);`,
				replace: `message({ ...issue, path: issue.path.toReversed() }, issue.path.toReversed().reduce((v: any, k) => v?.[k], value));`
			}
		]
	},
	{
		name: 'message_path_innermost_first',
		edits: [
			{
				find: `message({ ...issue, path: issue.path.toReversed() }, value);`,
				replace: `message(issue, value);`
			}
		]
	},
	{
		name: 'message_reverses_path_in_place',
		edits: [
			{
				find: `message({ ...issue, path: issue.path.toReversed() }, value);`,
				replace: `message({ ...issue, path: issue.path.reverse() }, value);`
			}
		]
	},
	{
		name: 'parse_no_path_reverse',
		edits: [
			{
				find: `	// each path was built innermost first, and a path of one key or none is its own reverse
	for (const issue of ctx.issues!) if (issue.path.length > 1) issue.path.reverse();`,
				replace: ``
			}
		]
	},
	{
		name: 'parse_reverses_first_path_only',
		edits: [
			{
				find: `	// each path was built innermost first, and a path of one key or none is its own reverse
	for (const issue of ctx.issues!) if (issue.path.length > 1) issue.path.reverse();`,
				replace: `	ctx.issues![0]!.path.reverse();`
			}
		]
	},
	{
		name: 'parse_or_throw_no_path_reverse',
		edits: [
			{
				find: `		for (const issue of ctx.issues!) if (issue.path.length > 1) issue.path.reverse();
		throw new SchemaError(ctx.issues!, ctx.fails);`,
				replace: `		throw new SchemaError(ctx.issues!, ctx.fails);`
			}
		]
	},
	{
		name: 'parse_or_throw_formats_before_reverse',
		edits: [
			{
				find: `		for (const issue of ctx.issues!) if (issue.path.length > 1) issue.path.reverse();
		throw new SchemaError(ctx.issues!, ctx.fails);`,
				replace: `		const error = new SchemaError(ctx.issues!, ctx.fails);
		for (const issue of ctx.issues!) if (issue.path.length > 1) issue.path.reverse();
		throw error;`
			}
		]
	},
	{
		name: 'parse_or_throw_counts_issues_held',
		edits: [
			{
				find: `		throw new SchemaError(ctx.issues!, ctx.fails);`,
				replace: `		throw new SchemaError(ctx.issues!);`
			}
		]
	},
	{
		name: 'issue_value_of_a_key',
		edits: [
			{
				find: `		issue.kind !== 'unknown_key' &&
		issue.kind !== 'missing_key' &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'issue_value_uncut',
		edits: [
			{
				find: `JSON.stringify(value.slice(0, 32))`,
				replace: `JSON.stringify(value)`
			}
		]
	},
	{
		name: 'issue_value_raw_string',
		edits: [
			{
				find: `JSON.stringify(value.slice(0, 32))`,
				replace: `'"' + value.slice(0, 32) + '"'`
			}
		]
	},
	{
		name: 'issue_value_minus_zero_as_zero',
		edits: [
			{
				find: `				? Object.is(value, -0)`,
				replace: `				? false`
			}
		]
	},
	{
		name: 'pipe_optional_missing_gives_value',
		edits: [
			{
				find: `if (entry && !((key as string) in parent!)) return;`,
				replace: `if (entry && !((key as string) in parent!)) return value;`
			}
		]
	},
	{
		name: 'message_drops_meta',
		edits: [
			{
				find: `	if (meta) registry!.set(labeled, meta);`,
				replace: `	if (meta && (false as boolean)) registry!.set(labeled, meta);`
			}
		]
	},
	{
		name: 'message_meta_key_drifts',
		file: 'src/lib/meta.ts',
		edits: [
			{
				find: `		Symbol.for('@fuzdev/fuz_schema/meta')`,
				replace: `		Symbol.for('@fuzdev/fuz_schema/meta@2')`
			}
		]
	},
	{
		name: 'standard_schema_reverses_path_again',
		file: 'src/lib/standard_schema.ts',
		edits: [
			{
				find: `							path: issue.path`,
				replace: `							path: issue.path.toReversed()`
			}
		]
	},
	{
		name: 'json_schema_to_lower_case_after_any_type',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `					fits('string');
					break;
				case 'to_integer':`,
				replace: `					break;
				case 'to_integer':`
			}
		]
	},
	{
		name: 'json_schema_step_after_to_lower_case_kept',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `input ? first_lower >= 0 && i > first_lower : i < last_lower`,
				replace: `input ? false : i < last_lower`
			}
		]
	},
	{
		name: 'json_schema_step_before_to_lower_case_kept',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `input ? first_lower >= 0 && i > first_lower : i < last_lower`,
				replace: `input ? first_lower >= 0 && i > first_lower : false`
			}
		]
	},
	{
		name: 'json_schema_uuid_after_to_lower_case_refused',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `if (action.kind !== 'uuid' && lowered(action.kind, i, at)) break;`,
				replace: `if (lowered(action.kind, i, at)) break;`
			}
		]
	},
	{
		name: 'json_schema_object_left_open',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				return object(s.kind, s.def, path, () => false);`,
				replace: `				return object(s.kind, s.def, path, () => ({}));`
			}
		]
	},
	{
		// a looser output document: the differential's output side is one-way, so the unit tests hold this
		name: 'json_schema_output_default_left_optional',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `outcomes = s.def.value === undefined ? LEAVES_OUT : FILLS;`,
				replace: `outcomes = s.def.value === undefined || !input ? LEAVES_OUT : FILLS;`
			}
		]
	},
	{
		name: 'json_schema_optional_key_required',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			if (!optional_key(entries[key]!)) required.push(key);`,
				replace: `			required.push(key);`
			}
		]
	},
	{
		// the options before one that fills a missing key in tried again with the object and the key
		name: 'json_schema_union_retried_with_key',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `const retried = missing(options[j]!, false, false, seen);`,
				replace: `const retried = missing(options[j]!, true, false, seen);`
			}
		]
	},
	{
		// a pipe's steps taken to run on no missing key, under a union or wherever it isn't the entry
		name: 'json_schema_pipe_steps_skipped_for_missing_key',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `for (let i = 1; i < s.def.length && outcomes & ~REFUSES; i++) {`,
				replace: `for (let i = 1; i < 1 && outcomes & ~REFUSES; i++) {`
			}
		]
	},
	{
		name: 'json_schema_meta_overwrites_keyword',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			if (Object.hasOwn(KEYWORDS, key)) {`,
				replace: `			if (false) {`
			}
		]
	},
	{
		name: 'json_schema_step_after_transform_dropped',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `						if (i + 1 < steps.length) {`,
				replace: `						if (false as boolean) {`
			}
		]
	},
	{
		name: 'json_schema_regex_not_read_under_u',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `							RegExp(re.source, 'u');`,
				replace: `							RegExp(re.source);`
			}
		]
	},
	{
		name: 'json_schema_regex_read_alike_under_u',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `							if (reads_else_under_u(re.source)) reason = 'means something else';`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_regex_class_escape_missed',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: String.raw`		if (c === '\\') {`,
				replace: String.raw`		if (c === '\\' && !in_class) {`
			}
		]
	},
	{
		name: 'json_schema_regex_surrogate_missed',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: String.raw`		if (c >= '\uD800' && c <= '\uDFFF') return true;`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_regex_surrogate_escape_missed',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: String.raw`const ESCAPE_ELSE = /[upP]\{|u[dD][89a-fA-F]/y;`,
				replace: String.raw`const ESCAPE_ELSE = /[upP]\{/y;`
			}
		]
	},
	{
		name: 'json_schema_regex_class_not_read',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			in_class = true;`,
				replace: `			in_class = false;`
			}
		]
	},
	{
		name: 'json_schema_default_fn_keeps_inner_default',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				delete node.default;`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_lazy_loop_referred_to',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			if (chain.has(value)) {`,
				replace: `			if (false as boolean) {`
			}
		]
	},
	{
		name: 'json_schema_regex_written_twice',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `						if (!patterns.includes(re)) patterns.push(re);`,
				replace: `						patterns.push(re);`
			}
		]
	},
	{
		name: 'json_schema_safe_integer_lower_bound_dropped',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `							narrow('minimum', -MAX_SAFE, true);`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_array_key_not_an_item',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `keys.length !== value.length || keys.some((k, i) => k !== String(i))`,
				replace: `keys.length !== value.length`
			}
		]
	},
	{
		name: 'json_schema_union_left_unfolded',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			if (keys.length !== 1 || keys[0] !== 'type') return node;`,
				replace: `			return node;`
			}
		]
	},
	{
		// a bare check taken to refuse a missing key, which with 'any' requires a key it takes
		name: 'json_schema_bare_check_refuses_missing_key',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			case 'check':
				outcomes = REFUSES | LEAVES_OUT;
				break;
`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_one_of_undefined_always_refuses',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `outcomes = s.def.includes(undefined) && !keyed ? LEAVES_OUT : REFUSES;`,
				replace: `outcomes = REFUSES;`
			}
		]
	},
	{
		// with 'any', a discriminator of `{}` that two options match, which oneOf refuses
		name: 'json_schema_variant_always_one_of',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `const keyword = distinct ? 'oneOf' : 'anyOf';`,
				replace: `const keyword = 'oneOf';`
			}
		]
	},
	{
		// an option picked by the `def` of a discriminator that is no `literal`
		name: 'json_schema_variant_non_literal_discriminator_written',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `					o.def[key]?.kind === 'literal';`,
				replace: `					true;`
			}
		]
	},
	{
		// an `object_with_rest` option, whose `def[key]` is no entry
		name: 'json_schema_variant_rest_discriminator_written',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `					(o.kind === 'object' || o.kind === 'strip_object' || o.kind === 'loose_object') &&
					o.def[key]?.kind === 'literal';`,
				replace: `					(o.def as any)?.[key]?.kind === 'literal';`
			}
		]
	},
	{
		// as the entry, a pipe that starts with an optional and holds a transform taken to fill the key in
		name: 'json_schema_pipe_head_optional_transform_fills',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				if (head.kind === 'optional' && keyed && entry) {
					outcomes = LEAVES_OUT;`,
				replace: `				if (head.kind === 'optional' && keyed && entry) {
					outcomes = s.def.some((x) => x.kind === 'transform') ? FILLS : LEAVES_OUT;`
			}
		]
	},
	{
		name: 'json_schema_variant_keeps_shadowed_option',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `!options.some((later, j) => j > i && same_discriminator(o, later, key))`,
				replace: `!options.some((later, j) => j > i && false)`
			}
		]
	},
	{
		name: 'json_schema_differential_default_applies_to_all',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `applies: (c) => holds_kind(c.schema, ['with_default', 'with_default_fn']),`,
				replace: `applies: () => true,`
			}
		]
	},
	{
		name: 'json_schema_differential_transform_not_refilled',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `		return out === undefined ? FILLED_VALUE : out;`,
				replace: `		return out;`
			}
		]
	},
	{
		name: 'json_schema_differential_transform_in_throw_mode',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `		modes: ['any'],`,
				replace: ``
			}
		]
	},
	{
		// a `default` and a `required` read as keywords wherever the names are, a property's included
		name: 'json_schema_differential_rewrite_reads_names_anywhere',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `		if (SCHEMA_MAPS.has(k) && is_node(a) && is_node(b)) {
			if (!isDeepStrictEqual(Object.keys(a), Object.keys(b))) fail(here);
			for (const n of Object.keys(a)) loosens(a[n], b[n], pointer(here, n));
		} else if`,
				replace: `		if`
			},
			{
				find: `		if (SCHEMA_MAPS.has(k) && is_node(v)) {
			out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, without_defaults(x)]));
		} else if`,
				replace: `		if (SCHEMA_MAPS.has(k) && is_node(v)) {
			out[k] = without_defaults(v);
		} else if`
			},
			{
				find: `const SCHEMA_ONE = new Set([`,
				replace: `const SCHEMA_ONE = new Set([
	...SCHEMA_MAPS,`
			}
		]
	},
	{
		name: 'json_schema_differential_variants_not_varied',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `const spec = vary_variants(vary, gen_root_spec(rng, focus));`,
				replace: `const spec = gen_root_spec(rng, focus);`
			}
		]
	},
	{
		name: 'json_schema_differential_any_pass_skipped',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `for (const mode of any ? (['throw', 'any'] as const) : (['throw'] as const)) {`,
				replace: `for (const mode of ['throw'] as const) {`
			}
		]
	},
	{
		name: 'json_schema_check_counts_code_units',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: `const n = options.code_unit_lengths ? text.length : count_code_points(text);`,
				replace: `const n = text.length;`
			}
		]
	},
	{
		name: 'json_schema_check_pattern_read_without_u',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: `				re = RegExp(source, 'u');`,
				replace: `				re = RegExp(source);`
			}
		]
	},
	{
		name: 'json_schema_check_closed_object_left_open',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: `				} else if (additional === false) {
					return false;`,
				replace: `				} else if (additional === false) {
					continue;`
			}
		]
	},
	{
		name: 'json_schema_check_one_of_as_any_of',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: `.length !== 1) return false;`,
				replace: `.length < 1) return false;`
			}
		]
	},
	{
		name: 'json_schema_check_unknown_keyword_read_past',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: "\t\t\tmalformed(at, `the keyword ${JSON.stringify(key)}, which the checker doesn't know`);",
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_check_record_skips_proto',
		file: 'src/test/json_schema_check.ts',
		edits: [
			{
				find: `options.rest_skips_proto && properties !== undefined && s.propertyNames === undefined;`,
				replace: `options.rest_skips_proto;`
			}
		]
	},
	{
		name: 'json_schema_differential_default_fn_not_rewritten',
		file: 'src/test/json_schema_differential.ts',
		edits: [
			{
				find: `return mapped.t === 'default_fn' ? { ...mapped, t: 'default' } : mapped;`,
				replace: `return mapped;`
			}
		]
	},
	{
		name: 'prefix_path_drops_deeper_keys',
		edits: [
			{
				find: `		issues[i]!.path.length ? issues[i]!.path.push(key) : (issues[i]!.path = [key]);`,
				replace: `		issues[i]!.path = [key];`
			}
		]
	},
	{
		name: 'prefix_path_pushes_first_key',
		edits: [
			{
				find: `		issues[i]!.path.length ? issues[i]!.path.push(key) : (issues[i]!.path = [key]);`,
				replace: `		issues[i]!.path.push(key);`
			}
		],
		survives:
			'the same keys in the same order: only the capacity of a one-key path differs, which the allocation benchmark and the grade see and no test can'
	},
	{
		name: 'prefix_path_prepends',
		edits: [
			{
				find: `		issues[i]!.path.length ? issues[i]!.path.push(key) : (issues[i]!.path = [key]);`,
				replace: `		issues[i]!.path.unshift(key);`
			}
		]
	},
	{
		name: 'memo_union_in_reporting',
		edits: [
			{
				find: `		if (!ctx.probe || value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);`,
				replace: `		if (value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);`
			}
		]
	},
	{
		name: 'memo_union_read_outside_probe',
		edits: [
			{
				find: `		if (!ctx.probe || value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);
		}
		let memo = memos.get(ctx);
		if (!memo) memos.set(ctx, (memo = new WeakMap()));
		let output = memo.get(value);`,
				replace: `		if (value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);
		}
		let memo = memos.get(ctx);
		if (!memo) memos.set(ctx, (memo = new WeakMap()));
		let output = memo.get(value);
		if (!ctx.probe && output === undefined) return run(value, ctx, parent, key);`
			}
		]
	},
	{
		name: 'memo_union_keep_outside_probe',
		edits: [
			{
				find: `		if (!ctx.probe || value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);
		}`,
				replace: `		if (value === null || typeof value !== 'object') {
			return run(value, ctx, parent, key);
		}
		if (!ctx.probe) {
			let kept = memos.get(ctx);
			if (!kept) memos.set(ctx, (kept = new WeakMap()));
			const before = ctx.fails;
			const out = run(value, ctx, parent, key);
			kept.set(value, ctx.fails > before ? memos : out);
			return out;
		}`
			}
		]
	},
	{
		name: 'memo_union_cached_failure_uncounted',
		edits: [
			{
				find: `			// what \`fail\` does in probe mode
			ctx.fails++;`,
				replace: `			// what \`fail\` does in probe mode`
			}
		]
	},
	{
		name: 'memo_union_failure_kept_as_output',
		edits: [
			{
				find: `memo.set(value, ctx.fails > count ? memos : output);`,
				replace: `memo.set(value, ctx.fails > count && (false as boolean) ? memos : output);`
			}
		]
	},
	{
		name: 'memo_union_failure_not_kept',
		edits: [
			{
				find: `			memo.set(value, ctx.fails > count ? memos : output);`,
				replace: `			if (ctx.fails === count) memo.set(value, output);`
			}
		]
	},
	{
		name: 'memo_union_shared_across_parses',
		edits: [
			{
				find: `		let memo = memos.get(ctx);
		if (!memo) memos.set(ctx, (memo = new WeakMap()));`,
				replace: `		let memo = memos.get(memos as any);
		if (!memo) memos.set(memos as any, (memo = new WeakMap()));`
			}
		]
	},
	{
		name: 'memo_union_one_closure',
		edits: [
			{
				find: `		run: run.length > 2 ? memo_run : (value, ctx) => memo_run(value, ctx)`,
				replace: `		run: memo_run`
			}
		]
	},
	{
		name: 'memo_union_undefined_output_run_again',
		edits: [
			{
				find: `		if (output === undefined && !memo.has(value)) {`,
				replace: `		if (output === undefined) {`
			}
		]
	},
	{
		name: 'recognizer_row_renamed',
		file: 'src/test/differential_recognizers.ts',
		edits: [{ find: `		row: 'record, array',`, replace: `		row: 'record, an array',` }]
	},
	{
		name: 'recognizer_combination_renamed',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `		combination: 'a check after a strict object of a bare check entry, key missing, an unknown key',`,
				replace: `		combination: 'a check after a strict object, an unknown key',`
			}
		]
	},
	{
		name: 'recognizer_neither_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `		neither: (spec, input, run) => run('zod', without_default_of_undefined(spec), input)
`,
				replace: ``
			}
		]
	},
	{
		name: 'recognizer_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	// a check after an object with an unknown key: zod runs it, valibot stops
	{`,
				replace: `	// a check after an object with an unknown key: zod runs it, valibot stops
	...[{`
			},
			{
				find: `	},
	// a check after an object whose missing key is an \`unknown\`'s, then a check`,
				replace: `	}].filter(() => false),
	// a check after an object whose missing key is an \`unknown\`'s, then a check`
			}
		]
	},
	{
		name: 'recognizer_transform_under_union_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'union[string, bare transform to "T"] entry, key missing / *',`,
				replace: `	...[{
		row: 'union[string, bare transform to "T"] entry, key missing / *',`
			},
			{
				find: `			valibot_given_keys(spec, input, zod, run, is_transform_under('union'))
	},`,
				replace: `			valibot_given_keys(spec, input, zod, run, is_transform_under('union'))
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'format_recognizer_case_narrowed',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `without_nibble(text, UUID_VERSION_AT, 'abcdefABCDEF', '4')`,
				replace: `without_nibble(text, UUID_VERSION_AT, 'abcdef', '4')`
			}
		]
	},
	{
		name: 'format_recognizer_never_recognizes',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `		without: (text) => without_char_at(text, 10, ' ', 'T')`,
				replace: `		without: () => null`
			}
		]
	},
	{
		name: 'format_recognizer_any_direction',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `				zod.ok === SIDES[row].zod.startsWith('ok') &&
				valibot.ok === SIDES[row].valibot.startsWith('ok')`,
				replace: `				true`
			}
		]
	},
	{
		name: 'format_recognizer_held_to_the_other_side',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `held: side === 'zod' ? zod : side === 'valibot' ? valibot : null`,
				replace: `held: side === 'zod' ? valibot : side === 'valibot' ? zod : null`
			}
		]
	},
	{
		name: 'recognizer_transform_under_nullable_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'nullable(bare transform to "T") entry, key missing / *',`,
				replace: `	...[{
		row: 'nullable(bare transform to "T") entry, key missing / *',`
			},
			{
				find: `			valibot_given_keys(spec, input, zod, run, is_transform_under('nullable'))
	},`,
				replace: `			valibot_given_keys(spec, input, zod, run, is_transform_under('nullable'))
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_transform_under_lazy_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'lazy(bare transform to "T") entry, key missing / *',`,
				replace: `	...[{
		row: 'lazy(bare transform to "T") entry, key missing / *',`
			},
			{
				find: `			valibot_given_keys(spec, input, zod, run, is_transform_under('lazy'))
	},`,
				replace: `			valibot_given_keys(spec, input, zod, run, is_transform_under('lazy'))
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_unknown_key_missing_check_after_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'a check after an object of unknown then a check that fails, key missing',`,
				replace: `	...[{
		row: 'a check after an object of unknown then a check that fails, key missing',`
			},
			{
				find: `			return given !== input && both_give(zod, spec, given, run);
		}
	},`,
				replace: `			return given !== input && both_give(zod, spec, given, run);
		}
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_pipe_from_optional_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'optional(string) then a transform to "T" entry, key missing / *',`,
				replace: `	...[{
		row: 'optional(string) then a transform to "T" entry, key missing / *',`
			},
			{
				find: `					is_pipe_from_optional(at.chain[0])
			)
	},`,
				replace: `					is_pipe_from_optional(at.chain[0])
			)
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_infinity_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'number, Infinity',`,
				replace: `	...[{
		row: 'number, Infinity',`
			},
			{
				find: `					run('valibot', spec, finite).text === to
			);
		}
	},`,
				replace: `					run('valibot', spec, finite).text === to
			);
		}
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_infinity_proto_only',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `			(all || key === RENAMED_PROTO) &&`,
				replace: `			key === RENAMED_PROTO &&`
			}
		]
	},
	{
		name: 'recognizer_keyed_key_outside_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `			if (!z || z.ok || !v || v.ok || !has_finite_keyed_record(spec)) return false;`,
				replace: `			if (!z || z.ok || !v || v.ok || !has_finite_keyed_record(spec) || true) return false;`
			}
		]
	},
	{
		name: 'record_own_proto_copied_without_off',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `							(rules.has('loose_own_proto') && !holds_no_proto(r.fuz_schema, [t])) ||
							copied_without(t)`,
				replace: `							(rules.has('loose_own_proto') && !holds_no_proto(r.fuz_schema, [t]))`
			}
		]
	},
	{
		name: 'same_apart_excuses_what_ours_has',
		file: 'src/test/differential_rules.ts',
		edits: [
			{
				find: `						? (path, unknown_key) => above.rewritten(path) && !ours_has(path, unknown_key)`,
				replace: `						? (path) => above.rewritten(path)`
			}
		]
	},
	{
		name: 'recognizer_two_defaults_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'a default of a wrong value entry and a default of undefined entry, keys missing / *',`,
				replace: `	...[{
		row: 'a default of a wrong value entry and a default of undefined entry, keys missing / *',`
			},
			{
				find: `				agree(without_default_as_is(without_undefined))
			);
		}
	},`,
				replace: `				agree(without_default_as_is(without_undefined))
			);
		}
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_pipe_from_transform_dropped',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `	{
		row: 'transform to "T" then a transform entry, key missing / *',`,
				replace: `	...[{
		row: 'transform to "T" then a transform entry, key missing / *',`
			},
			{
				find: `			valibot_given_keys(spec, input, zod, run, is_pipe_from_transform)
	},`,
				replace: `			valibot_given_keys(spec, input, zod, run, is_pipe_from_transform)
	}].filter(() => false),`
			}
		]
	},
	{
		name: 'recognizer_optional_held_default_unread',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `return held !== spec && held !== without && both_give(valibot, held, input, run);`,
				replace: `return held !== spec && held !== without && false;`
			}
		]
	},
	{
		name: 'recognizer_default_of_undefined_keeps_head_defaults',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `? { t: 'optional', of: without_head_defaults(s.of) }`,
				replace: `? { t: 'optional', of: s.of }`
			}
		]
	},
	{
		name: 'check_missing_key_no_keys_one_at_a_time',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `		if (!next) {
			const strict_takes`,
				replace: `		if (false) {
			const strict_takes`
			}
		]
	},
	{
		name: 'check_missing_key_strict_always_takes',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `(['zod', 'valibot', 'fuz_schema'] as const).some((lib) => run(lib, strict, object).ok);`,
				replace: `true || !!strict || !!object;`
			}
		]
	},
	{
		name: 'check_after_keyed_option_every_union_only',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `return at_keys !== dropped && kept_without(next, at_keys);`,
				replace: `return false && at_keys !== dropped;`
			}
		]
	},
	{
		name: 'check_after_keyed_option_drops_before_first',
		file: 'src/test/differential_rules.ts',
		edits: [
			{
				find: `const last = union.of.findLastIndex(`,
				replace: `const last = union.of.findIndex(`
			}
		]
	},
	{
		name: 'record_own_proto_renamed_no_split',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `(rules.has('split_on_a_side') && zod.text !== valibot.text)`,
				replace: `false`
			}
		]
	},
	{
		name: 'record_own_proto_renamed_returned_not_left_out',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `							holder_returned(result, t) ||
`,
				replace: ``
			}
		]
	},
	{
		name: 'record_own_proto_renamed_never_named_back',
		file: 'src/test/differential_rules.ts',
		edits: [
			{
				find: `const returned = value === value_at(input, path);`,
				replace: `const returned = false && value === value_at(input, path);`
			}
		]
	},
	{
		name: 'symbol_ignored_never_tried',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `if (rules.has('symbol_ignored')) {`,
				replace: `if (false && rules.has('symbol_ignored')) {`
			}
		]
	},
	{
		name: 'symbol_ignored_key_read',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `left_unread(r.fuz_schema, next.touched)`,
				replace: `true`
			}
		]
	},
	{
		name: 'sides_row_dropped',
		file: 'src/test/conformance_tables.ts',
		edits: [
			{
				find: `	'record, array': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
`,
				replace: ``
			}
		]
	},
	{
		name: 'sides_row_flipped_to_valibot',
		file: 'src/test/conformance_tables.ts',
		edits: [
			{
				find: `	'unknown key named constructor / loose': {
		side: 'zod',`,
				replace: `	'unknown key named constructor / loose': {
		side: 'valibot',`
			}
		]
	},
	{
		name: 'sides_row_flipped_to_neither',
		file: 'src/test/conformance_tables.ts',
		edits: [
			{
				find: `	'record, array': { side: 'zod',`,
				replace: `	'record, array': { side: 'neither',`
			}
		]
	},
	{
		// the inferred types are the same, so only the walk of the declared types tells
		name: 'array_returns_structural_schema',
		edits: [
			{
				find: `): ArraySchema<T> => ({`,
				replace: `): Schema<Array<Infer<T>>, Array<InferInput<T>>, 'array', T> => ({`
			}
		]
	},
	{
		name: 'min_value_exclusive',
		edits: [
			{
				find: `value >= min ? value : fail(ctx, 'min_value'`,
				replace: `value > min ? value : fail(ctx, 'min_value'`
			}
		]
	},
	{
		name: 'min_value_inverted',
		edits: [
			{
				find: `value >= min ? value : fail(ctx, 'min_value'`,
				replace: `value < min ? value : fail(ctx, 'min_value'`
			}
		]
	},
	{
		name: 'max_value_exclusive',
		edits: [
			{
				find: `value <= max ? value : fail(ctx, 'max_value'`,
				replace: `value < max ? value : fail(ctx, 'max_value'`
			}
		]
	},
	{
		name: 'max_value_inverted',
		edits: [
			{
				find: `value <= max ? value : fail(ctx, 'max_value'`,
				replace: `value > max ? value : fail(ctx, 'max_value'`
			}
		]
	},
	{
		name: 'literal_nan_unmatched',
		edits: [
			{
				find: `v === value || (v !== v && value !== value)`,
				replace: `v === value`
			}
		]
	},
	{
		name: 'literal_nan_matches_any',
		edits: [
			{
				find: `v === value || (v !== v && value !== value)`,
				replace: `v === value || v !== v`
			}
		]
	},
	{
		name: 'lazy_drops_key',
		edits: [
			{
				find: `(schema.run(value, ctx, arguments[2], arguments[3]) as Infer<T>)`,
				replace: `(schema.run(value, ctx) as Infer<T>)`
			}
		]
	},
	{
		name: 'lazy_no_retry_after_throw',
		edits: [
			{
				find: `	let schema: T | undefined;
	return {
		kind: 'lazy',`,
				// typed as the schema, so only a test of a throw kills it and not the types
				replace: `	let schema = undefined as unknown as T;
	let called = false;
	return {
		kind: 'lazy',`
			},
			{
				find: `			schema ??= get();`,
				replace: `			if (!called) {
				called = true;
				schema = get();
			}`
			}
		]
	},
	{
		name: 'is_schema_no_def',
		edits: [
			{
				find: `	typeof (value as AnySchema).run === 'function' &&
	'def' in value;`,
				replace: `	typeof (value as AnySchema).run === 'function';`
			}
		]
	},
	{
		name: 'is_schema_kind_any',
		edits: [
			{
				find: `	typeof (value as AnySchema).kind === 'string' &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'is_not_probing',
		edits: [
			{
				find: `const ctx: SchemaContext = { issues: undefined, fails: 0, probe: true };`,
				replace: `const ctx: SchemaContext = { issues: undefined, fails: 0, probe: false };`
			}
		]
	},
	{
		name: 'format_issue_key_unquoted',
		edits: [
			{
				find: `.map((key) => (/^\\w+$/.test(key) ? key : JSON.stringify(key)))`,
				replace: `.map((key) => key)`
			}
		]
	},
	{
		name: 'format_issue_key_always_quoted',
		edits: [
			{
				find: `.map((key) => (/^\\w+$/.test(key) ? key : JSON.stringify(key)))`,
				replace: `.map((key) => JSON.stringify(key))`
			}
		]
	},
	{
		name: 'regex_accepts_all',
		edits: [
			{
				find: `run: (value, ctx) => (pattern.test(value) ? value : fail(ctx, 'regex', value, expected))`,
				replace: `run: (value) => value`
			}
		]
	},
	{
		name: 'regex_expected_kind',
		edits: [
			{
				find: `	expected: string = String(pattern)
`,
				replace: `	expected: string = 'regex'
`
			}
		]
	},
	{
		name: 'one_of_undefined_closure_dropped',
		edits: [
			{
				find: `run: set.has(undefined)`,
				replace: `run: false`
			}
		]
	},
	{
		name: 'with_default_fn_made_once',
		edits: [
			{
				find: `(v, ctx) => (v === undefined ? make() : schema.run(v, ctx))`,
				replace: `(v, ctx) => (v === undefined ? ((make as any).kept ??= make()) : schema.run(v, ctx))`
			}
		]
	},
	{
		name: 'union_probe_left_set',
		edits: [
			{
				find: `const output = options[i]!.run(value, ctx);
						if (ctx.fails === count) {
							ctx.probe = probe;
`,
				replace: `const output = options[i]!.run(value, ctx);
						if (ctx.fails === count) {
`
			}
		]
	},
	{
		name: 'union_probe_left_set_on_retry',
		edits: [
			{
				find: `										if (ctx.fails === count) {
											ctx.probe = probe;
											return v;`,
				replace: `										if (ctx.fails === count) {
											return v;`
			}
		]
	},
	{
		name: 'describe_option_no_null',
		edits: [
			{
				find: `kind === 'nullable' ? 'null' : []`,
				replace: `[]`
			}
		]
	},
	{
		name: 'describe_option_record_by_kind',
		edits: [
			{
				find: `	/object|record|variant/.test(kind)`,
				replace: `	/object|variant/.test(kind)`
			}
		]
	},
	{
		name: 'describe_option_keyed_record_by_kind',
		edits: [
			{
				find: `	/object|record|variant/.test(kind)`,
				replace: `	/object|^record$|variant/.test(kind)`
			}
		]
	},
	{
		name: 'describe_option_any_kind_of_object_text',
		edits: [
			{
				find: `	/object|record|variant/.test(kind)`,
				replace: `	/object|record|variant|lazy/.test(kind)`
			}
		]
	},
	{
		name: 'describe_option_pipe_by_kind',
		edits: [
			{
				find: `				: kind === 'pipe'
`,
				replace: `				: kind === 'pipe_'
`
			}
		]
	},
	{
		name: 'schema_json_pointer_tilde_unescaped',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `key.replaceAll('~', '~0').replaceAll('/', '~1')`,
				replace: `key.replaceAll('/', '~1')`
			}
		]
	},
	{
		name: 'schema_json_literal_minus_zero_kept',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `			// \`-0\` is \`0\` in JSON, and equal to it
			return value === 0 ? 0 : value;`,
				replace: `			return value;`
			}
		]
	},
	{
		name: 'schema_json_bound_minus_zero_kept',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `				return { kind, def: def === 0 ? 0 : def };`,
				replace: `				return { kind, def };`
			}
		]
	},
	{
		name: 'schema_json_action_in_child_kept',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `		if (is_schema(value) && PIPE_ONLY_ACTIONS.has(value.kind)) {
			refuse(value.kind, path, 'it means something only in a pipe');
		}
`,
				replace: ``
			}
		]
	},
	{
		name: 'schema_json_nesting_limit_one_short',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `		if (depth > SCHEMA_JSON_MAX_NESTING) {`,
				replace: `		if (depth >= SCHEMA_JSON_MAX_NESTING) {`
			}
		]
	},
	{
		name: 'schema_json_nesting_not_counted_through_lazy',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `				return [json.defs![def]!];`,
				replace: `				return [];`
			}
		]
	},
	{
		name: 'schema_json_lazy_named_at_parent',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `defs[name] = child(target, \`/defs/\${pointer_token(name)}\`, inner);`,
				replace: `defs[name] = child(target, path, inner);`
			}
		]
	},
	{
		name: 'schema_json_member_named_at_parent',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `				(def as Record<string, unknown>)[key],
				\`\${path}/\${pointer_token(key)}\`,`,
				replace: `				(def as Record<string, unknown>)[key],
				path,`
			}
		]
	},
	{
		name: 'schema_json_default_infinity_kept',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `			if (!Number.isFinite(v)) return 'the default is not a JSON value';`,
				replace: `			if (Number.isNaN(v)) return 'the default is not a JSON value';`
			}
		]
	},
	{
		name: 'schema_json_lazy_function_called_again',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `					} else {
						lazies.set(def, name);
					}`,
				replace: `					}`
			}
		]
	},
	{
		name: 'schema_json_refused_key_allowed',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `			if (SCHEMA_JSON_REFUSED_KEYS.includes(key)) {
				refuse(
`,
				replace: `			if (false) {
				refuse(
`
			}
		]
	},
	{
		name: 'introspect_pipe_no_layer',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `			case 'pipe':
				s = s.def[0]!;
				break;
`,
				replace: ``
			}
		]
	},
	{
		name: 'introspect_find_always_structural',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `				if (structural) for (const k in s.def) visit(s.def[k]!);`,
				replace: `				for (const k in s.def) visit(s.def[k]!);`
			}
		]
	},
	{
		name: 'introspect_optional_has_default',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `has_default: first !== undefined && first.kind !== 'optional',`,
				replace: `has_default: first !== undefined,`
			}
		]
	},
	{
		name: 'introspect_fields_innermost_default',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `				first = layer;
				break;`,
				replace: `				first = layer;`
			}
		]
	},
	{
		name: 'introspect_entry_key_unquoted',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `\${/^[A-Za-z_$][\\w$]*$/.test(key) ? key : JSON.stringify(key)}`,
				replace: `\${key}`
			}
		]
	},
	{
		name: 'introspect_lazy_of_lazy_elided',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `to_type((s = s.def()), s.kind !== 'lazy')`,
				replace: `to_type((s = s.def()), true)`
			}
		]
	},
	{
		name: 'introspect_entries_of_rest_dropped',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `			? s.def.entries
			: undefined;`,
				replace: `			? undefined
			: undefined;`
			}
		]
	},
	{
		name: 'keyed_record_no_relabel',
		edits: [
			{
				find: `				if (bad && ctx.issues![count]) ctx.issues![count].kind = 'invalid_key';
`,
				replace: ``
			}
		]
	},
	{
		name: 'keyed_record_relabel_all',
		edits: [
			{
				find: `				if (bad && ctx.issues![count]) ctx.issues![count].kind = 'invalid_key';`,
				replace: `				if (bad) for (let i = count; i < ctx.issues!.length; i++) ctx.issues![i]!.kind = 'invalid_key';`
			}
		]
	},
	{
		name: 'keyed_record_reads_bad_value',
		edits: [
			{
				find: `			const v_in = bad || input[k];`,
				replace: `			const v_in = input[k];`
			}
		]
	},
	{
		name: 'keyed_record_runs_bad_value',
		edits: [
			{
				find: `			const v = bad ? v_in : value.run(v_in, ctx);`,
				replace: `			const v = value.run(input[k], ctx);`
			}
		]
	},
	{
		name: 'keyed_record_rename_returns_input',
		edits: [
			{
				find: `			} else if (name !== k || !Object.is(v, v_in) || !keep) {`,
				replace: `			} else if (!Object.is(v, v_in) || !keep) {`
			}
		]
	},
	{
		name: 'keyed_record_keeps_proto',
		edits: [
			{
				find: `			const keep = name !== '__proto__';`,
				replace: `			const keep = true;`
			}
		]
	},
	{
		name: 'keyed_record_no_probe_break',
		edits: [
			{
				find: `			if (ctx.fails > count) {
				if (ctx.probe) break;
				// the key's own issue`,
				replace: `			if (ctx.fails > count) {
				// the key's own issue`
			}
		]
	},
	{
		name: 'keyed_record_no_key_in_path',
		edits: [
			{
				find: `				prefix_path(ctx.issues!, count, k);`,
				replace: `				if (!bad) prefix_path(ctx.issues!, count, k);`
			}
		]
	},
	{
		name: 'keyed_record_copy_starts_at_the_key',
		edits: [
			{
				find: `				for (const j in input) {
					if (j === k) break;`,
				replace: `				for (const j in input) {
					if (j === k || (true as boolean)) break;`
			}
		]
	},
	{
		name: 'keyed_record_first_key_wins',
		edits: [
			{
				find: `			} else if (output) {
				if (keep) output[name] = v;`,
				replace: `			} else if (output) {
				if (keep && !Object.hasOwn(output, name)) output[name] = v;`
			}
		]
	},
	{
		name: 'get_issue_value_invalid_key_reads_input',
		edits: [
			{
				find: `	if (issue.kind === 'invalid_key') return { ok: true, value: issue.path[issue.path.length - 1] };
`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_keyed_record_any_key',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `					propertyNames: into(s.def.key, \`\${path}/propertyNames\`),`,
				replace: `					propertyNames: { type: 'string' },`
			}
		]
	},
	{
		name: 'json_schema_keyed_record_transform_unseen',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				return t(s.def.key) || t(s.def.value);`,
				replace: `				return t(s.def.value);`
			}
		]
	},
	{
		name: 'introspect_keyed_record_key_unvisited',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `					visit(s.def.key);
`,
				replace: ``
			}
		]
	},
	{
		name: 'introspect_keyed_record_as_record',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `			return \`Record<\${to_type(s.def.key, inside)}, \${to_type(s.def.value, inside)}>\`;`,
				replace: `			return \`Record<string, \${to_type(s.def.value, inside)}>\`;`
			}
		]
	},
	{
		name: 'schema_json_keyed_record_unknown',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: `			case 'keyed_record':
			case 'to_integer':`,
				replace: `			case 'to_integer':`
			}
		]
	},
	{
		name: 'to_integer_negative_zero_kept',
		edits: [
			{
				find: `Number.isSafeInteger(n) ? n || 0 :`,
				replace: `Number.isSafeInteger(n) ? n :`
			}
		]
	},
	{
		name: 'to_integer_past_safe',
		edits: [
			{
				find: `return Number.isSafeInteger(n) ? n || 0`,
				replace: `return Number.isInteger(n) ? n || 0`
			}
		]
	},
	{
		name: 'to_integer_trim_ignored',
		edits: [
			{
				find: `INTEGER_PATTERNS[+unsigned + 2 * +trim]`,
				replace: `INTEGER_PATTERNS[+unsigned]`
			}
		]
	},
	{
		name: 'to_integer_unsigned_ignored',
		edits: [
			{
				find: `INTEGER_PATTERNS[+unsigned + 2 * +trim]`,
				replace: `INTEGER_PATTERNS[2 * +trim]`
			}
		]
	},
	{
		name: 'to_integer_next_line_dropped',
		edits: [
			{
				find: `if (n !== n) n = +value.replace(`,
				replace: `if (false as boolean) n = +value.replace(`
			}
		]
	},
	{
		name: 'to_integer_converts_any_value',
		edits: [
			{
				find: `if (typeof value === 'string' && pattern.test(value)) {`,
				replace: `if (pattern.test(value)) {`
			}
		]
	},
	{
		name: 'to_integer_grammars_swapped',
		edits: [
			{
				find: `INTEGER_PATTERNS[+unsigned + 2 * +trim]`,
				replace: `INTEGER_PATTERNS[2 * +unsigned + +trim]`
			}
		]
	},
	{
		name: 'to_integer_expected_swapped',
		edits: [
			{
				find: `unsigned ? UNSIGNED_INTEGER_EXPECTED : INTEGER_EXPECTED`,
				replace: `unsigned ? INTEGER_EXPECTED : UNSIGNED_INTEGER_EXPECTED`
			}
		]
	},
	{
		name: 'json_schema_to_integer_string_metadata_kept',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			node = { type: 'integer' };`,
				replace: `			node.type = 'integer';`
			}
		]
	},
	{
		name: 'json_schema_to_integer_bounds_ignored',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `const lo = Math.ceil(num.minimum!);
			const hi = Math.floor(num.maximum!);`,
				replace: `const lo = -MAX_SAFE;
			const hi = MAX_SAFE;`
			}
		]
	},
	{
		name: 'json_schema_to_integer_no_leading_zeros',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `0*(?:\${range(Math.max(lo, 0), hi)})`,
				replace: `(?:\${range(Math.max(lo, 0), hi)})`
			}
		]
	},
	{
		name: 'json_schema_to_integer_minus_when_unsigned',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `lo <= 0 && !unsigned)`,
				replace: `lo <= 0)`
			}
		]
	},
	{
		name: 'json_schema_to_integer_negative_zero_refused',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `if (lo <= 0 && !unsigned)`,
				replace: `if (lo < 0 && !unsigned)`
			}
		]
	},
	{
		name: 'json_schema_to_integer_string_step_kept',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `if (!/^(string|to_lower_case|transform)$/.test(step.kind)) {`,
				replace: `if (false) {`
			}
		]
	},
	{
		name: 'json_schema_to_integer_unsigned_minimum',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `.def.unsigned ? 0 : -MAX_SAFE;`,
				replace: `.def.unsigned ? -MAX_SAFE : -MAX_SAFE;`
			}
		]
	},
	{
		name: 'json_schema_to_integer_default_on_input',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			case 'transform':
			case 'to_integer':
				return true;`,
				replace: `			case 'transform':
				return true;`
			}
		]
	},
	{
		name: 'json_schema_to_integer_white_space_without_next_line',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `\\\\x85\\\\xa0\\\\u1680`,
				replace: `\\\\xa0\\\\u1680`
			}
		]
	},
	{
		name: 'json_schema_to_integer_metadata_of_bounds_kept',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `			steps.length = integer_at + 1;
`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_to_integer_digit_class',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `a || b < 9 ?`,
				replace: `a && b < 9 ?`
			}
		]
	},
	{
		name: 'json_schema_to_integer_low_digits_dropped',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `if (/[1-9]/.test(low)) span(low, '9'.repeat(n), prefix + a++, out);`,
				replace: `if (/[1-9]/.test(low)) a++;`
			}
		]
	},
	{
		name: 'json_schema_to_integer_power_of_ten_whole',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `if (lo !== 10 ** (m - 1)) span(`,
				replace: `if (lo === 10 ** (m - 1)) span(`
			}
		]
	},
	{
		name: 'schema_json_to_integer_in_a_pipe',
		file: 'src/lib/schema_json.ts',
		edits: [
			{
				find: ` || step.kind === 'to_integer'))`,
				replace: `))`
			}
		]
	},
	{
		name: 'memo_union_registers_its_run',
		edits: [
			{
				find: `	).add(options);`,
				replace: `	).add(run);`
			}
		]
	},
	{
		name: 'memo_union_registers_nothing_for_the_keyed_closure',
		edits: [
			{
				find: `	).add(options);`,
				replace: `	).add(run.length > 2 ? [] : options);`
			}
		]
	},
	{
		name: 'memo_union_registry_a_weakmap',
		edits: [
			{
				find: `] ??= new WeakSet()
	).add(options);`,
				replace: `] ??= new WeakMap() as any
	).add(options);`
			}
		]
	},
	{
		name: 'is_memo_union_reads_the_schema',
		edits: [
			{
				find: `	]?.has(schema.def);`,
				replace: `	]?.has(schema);`
			}
		]
	},
	{
		name: 'is_memo_union_reads_another_key',
		edits: [
			{
				find: `		Symbol.for('@fuzdev/fuz_schema/memo_union')
	]?.has(schema.def);`,
				replace: `		Symbol.for('@fuzdev/fuz_schema/memo_unions')
	]?.has(schema.def);`
			}
		]
	},
	{
		name: 'compile_number_takes_nan',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`Number.isFinite(\${v})\`;`,
				replace: `return \`typeof \${v} === "number"\`;`
			}
		]
	},
	{
		name: 'compile_arrays_are_objects',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\`typeof \${v} !== "object" || \${v} === null || Array.isArray(\${v})\`;`,
				replace: `\`typeof \${v} !== "object" || \${v} === null\`;`
			}
		]
	},
	{
		name: 'compile_unknown_ignores_its_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return key ? \`(\${v} !== undefined || \${present})\` : 'true';`,
				replace: `return 'true';`
			}
		]
	},
	{
		name: 'compile_literal_undefined_ignores_its_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `all_of([\`\${v} === undefined\`, present]) : equals(v, def);`,
				replace: `\`\${v} === undefined\` : equals(v, def);`
			}
		]
	},
	{
		name: 'compile_nullable_drops_the_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const inner = cond(def.schema, v, key_for(key, def.schema));`,
				replace: `const inner = cond(def.schema, v, null);`
			}
		]
	},
	{
		name: 'compile_pipe_after_optional_runs_for_a_missing_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return starts_optional && key?.entry ? any_of([\`!(\${present})\`, every]) : every;`,
				replace: `return every;`
			}
		]
	},
	{
		name: 'compile_object_takes_an_unknown_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `code += \`for (const \${k} in \${v}) if (\${unknown_key(k, entries)}) \${bail}\\n\`;`,
				replace: `code += '';`
			}
		]
	},
	{
		name: 'compile_keyed_record_key_unchecked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(kind === 'keyed_record' ? emit(def.key, k, null, bail) : '') +`,
				replace: `'' +`
			}
		]
	},
	{
		name: 'compile_memo_union_not_told',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `all.filter((x) => kind_of(x) === 'union' && is_memo_union(x))`,
				replace: `[] as Array<AnySchema>`
			}
		]
	},
	{
		name: 'compile_inner_call_takes_the_outer_state',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `state.map(([name, initial]) => \`\${name} = \${initial};\\n\`).join('') +
`,
				replace: `'' +
`
			}
		]
	},
	{
		name: 'compile_copy_writes_a_missing_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `: \`if (\${out_of.get(n)} !== undefined || \${quote(n)} in \${v}) \${write}\`;`,
				replace: `: write;`
			}
		]
	},
	{
		name: 'compile_strip_object_keeps_an_unknown_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!\${dropped}) for (const \${k} in \${v}) if (\${unknown_key(k, def)}) {\\n\${dropped} = true;\\nbreak;\\n}\\n\`;`,
				replace: `\`;`
			}
		]
	},
	{
		name: 'compile_loose_copy_takes_proto',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: ` && Object.hasOwn(\${v}, \${k}) && \${k} !== "__proto__") \${o}[\${k}] = \${v}[\${k}];\\n\`;`,
				replace: ` && Object.hasOwn(\${v}, \${k})) \${o}[\${k}] = \${v}[\${k}];\\n\`;`
			}
		]
	},
	{
		name: 'compile_default_fn_made_once',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const filled = kind === 'with_default' ? literal(def.value) : \`\${capture(def.make)}()\`;`,
				replace: `const filled = kind === 'with_default' ? literal(def.value) : capture(def.make());`
			}
		]
	},
	{
		name: 'compile_array_copy_is_the_input',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `{\\n\${o} = \${v}.slice(0, \${n});\\n\${o}[\${i}] = \${out};\\n}\\n}\\n\`,`,
				replace: `{\\n\${o}[\${i}] = \${out};\\n}\\n}\\n\`,`
			}
		]
	},
	{
		name: 'compile_handoff_without_the_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\`const \${o} = handoff(\${capture(schema)}, \${v}, \${context}\${key_args(key, true)});\\nif (\${o} === FAIL) \${bail}\\n\`,`,
				replace: `\`const \${o} = handoff(\${capture(schema)}, \${v}, \${context});\\nif (\${o} === FAIL) \${bail}\\n\`,`
			}
		]
	},
	{
		name: 'compile_context_of_the_module_for_a_memo_union',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const shares_context = memos.size > 0 || all.some((x) => kind_of(x) === '');`,
				replace: `const shares_context = false;`
			}
		]
	},
	{
		name: 'compile_own_kind_in_the_context_of_the_module',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const shares_context = memos.size > 0 || all.some((x) => kind_of(x) === '');`,
				replace: `const shares_context = memos.size > 0;`
			}
		]
	},
	{
		name: 'compile_union_option_not_probed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const \${was} = \${context}.probe;\\nctx.probe = true;\\n`,
				replace: `const \${was} = \${context}.probe;\\n`
			}
		]
	},
	{
		name: 'compile_probe_not_restored_after_a_match',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\${probes ? \`ctx.probe = \${was};\\n\` : ''}\`, o];`,
				replace: `\`, o];`
			}
		]
	},
	{
		name: 'compile_line_separators_unescaped',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `	JSON.stringify(text).replace(LINE_SEPARATORS, (c) => '\\\\u' + c.charCodeAt(0).toString(16));`,
				replace: `	JSON.stringify(text);`
			}
		]
	},
	{
		name: 'compile_string_as_text',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return quote(value);`,
				replace: `return value;`
			}
		]
	},
	{
		name: 'compile_throws_where_code_generation_is_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (error instanceof EvalError) return undefined;`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_any_error_falls_back',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (error instanceof EvalError) return undefined;
		throw error;`,
				replace: `		return undefined;`
			}
		]
	},
	{
		name: 'compile_depth_unbounded',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (depth > COMPILE_MAX_DEPTH) {`,
				replace: `if (depth < 0) {`
			}
		]
	},
	{
		name: 'compile_depth_one_short',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (depth > COMPILE_MAX_DEPTH) {`,
				replace: `if (depth >= COMPILE_MAX_DEPTH) {`
			}
		]
	},
	{
		name: 'compile_non_schema_not_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!is_schema(schema)) throw Error(\`cannot compile at \${path || '/'}: not a schema\`);`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_def_as_work_list',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const stack = children(from);`,
				replace: `const stack: Array<any> = kind_of(from) === 'union' ? from.def : children(from);`
			}
		]
	},
	{
		name: 'compile_name_of_a_captured_value',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const fresh = (): string => \`_\${ids++}\`;`,
				replace: `const fresh = (): string => \`c\${ids++}\`;`
			}
		]
	},
	{
		name: 'compile_shared_schema_in_line',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `held.get(schema)! > 1 &&`,
				replace: `held.get(schema)! > Infinity &&`
			}
		]
	},
	{
		name: 'compile_own_kind_handed_wherever_a_key_is',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return schema.run.length > 2 || schema.kind === 'lazy';`,
				replace: `return true;`
			}
		]
	},
	{
		name: 'compile_lazy_hands_on_by_what_reads',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const keyed = !!key && reads_key(schema);
		const name = fn_of(schema, (out`,
				replace: `const keyed = !!key && reads_key(schema) && kind_of(schema) !== '';
		const name = fn_of(schema, (out`
			}
		]
	},
	{
		name: 'compile_union_function_never_keyed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const keyed = !!key && reads_key(schema);
		const name = fn_of(schema, keyed ? 'uk'`,
				replace: `const keyed = false;
		const name = fn_of(schema, keyed ? 'uk'`
			}
		]
	},
	{
		name: 'compile_array_copy_by_strict_equality',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `else if (!Object.is(\${out}, \${e})) {\\n\${o} = \${v}.slice(0, \${n});`,
				replace: `else if (\${out} !== \${e}) {\\n\${o} = \${v}.slice(0, \${n});`
			}
		]
	},
	{
		name: 'compile_object_copy_by_strict_equality',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `.map((n) => \`!Object.is(\${out_of.get(n)}, \${read_of.get(n)})\`)`,
				replace: `.map((n) => \`\${out_of.get(n)} !== \${read_of.get(n)}\`)`
			}
		]
	},
	{
		name: 'compile_record_copy_by_strict_equality',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `} else if (\${k} === "__proto__" || !Object.is(\${out}, \${e})) {\\n\${o} = {};\\n\``,
				replace: `} else if (\${k} === "__proto__" || \${out} !== \${e}) {\\n\${o} = {};\\n\``
			}
		]
	},
	{
		name: 'compile_record_copy_keeps_proto',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `} else if (\${k} === "__proto__" || !Object.is(\${out}, \${e})) {\\n\${o} = {};\\n\``,
				replace: `} else if (!Object.is(\${out}, \${e})) {\\n\${o} = {};\\n\``
			}
		]
	},
	{
		name: 'compile_minus_zero_as_zero',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return Object.is(value, -0) ? '-0' : String(value);`,
				replace: `return String(value);`
			}
		]
	},
	{
		name: 'compile_nan_by_strict_equality',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `value !== value ? \`\${v} !== \${v}\` : \`\${v} === \${literal(value)}\`;`,
				replace: `\`\${v} === \${literal(value)}\`;`
			}
		]
	},
	{
		name: 'compile_variant_nan_never_matches',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (value !== value) of_nan = \`if (\${d} === \${d}) \${bail}\\n\${body}\`;`,
				replace: `if (value !== value) of_nan = \`\${bail}\\n\`;`
			}
		]
	},
	{
		name: 'compile_variant_first_of_two_alike',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `for (const option of def.options) by_value.set(option.def[def.key].def, option);`,
				replace: `for (const option of def.options) if (!by_value.has(option.def[def.key].def)) by_value.set(option.def[def.key].def, option);`
			}
		]
	},
	{
		name: 'compile_one_of_large_drops_undefined',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (def.includes(undefined)) tests.push(all_of([\`\${v} === undefined\`, present]));`,
				replace: `if (def.includes(undefined) && values.length <= ONE_OF_INLINE_MAX) tests.push(all_of([\`\${v} === undefined\`, present]));`
			}
		]
	},
	{
		name: 'compile_one_of_large_takes_a_missing_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (def.includes(undefined)) tests.push(all_of([\`\${v} === undefined\`, present]));`,
				replace: `if (def.includes(undefined)) tests.push(values.length > ONE_OF_INLINE_MAX ? \`\${v} === undefined\` : all_of([\`\${v} === undefined\`, present]));`
			}
		]
	},
	{
		name: 'compile_rest_validates_proto',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `&& Object.hasOwn(\${v}, \${k}) && \${k} !== "__proto__") {\\n\` +`,
				replace: `&& Object.hasOwn(\${v}, \${k})) {\\n\` +`
			}
		]
	},
	{
		name: 'compile_rest_validates_inherited',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (\${unknown_key(k, entries)} && Object.hasOwn(\${v}, \${k}) && \${k} !== "__proto__") {\\n\` +`,
				replace: `if (\${unknown_key(k, entries)} && \${k} !== "__proto__") {\\n\` +`
			}
		]
	},
	{
		name: 'compile_out_nullable_drops_the_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'optional' ? null : key_for(key, def.schema),`,
				replace: `null,`
			}
		]
	},
	{
		name: 'compile_guard_default_fn_not_called',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`if (\${v} === undefined) \${capture(def.make)}();\\nelse {\\n\${emit(def.schema, v, null, bail)}}\\n\`;`,
				replace: `return \`if (\${v} !== undefined) {\\n\${emit(def.schema, v, null, bail)}}\\n\`;`
			}
		]
	},
	{
		name: 'compile_strip_guard_refuses_unknown_keys',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (kind === 'object') {
			// an enumerable key, own or inherited, that no entry names`,
				replace: `		if (kind === 'object' || kind === 'strip_object') {
			// an enumerable key, own or inherited, that no entry names`
			}
		]
	},
	{
		name: 'compile_object_copy_takes_an_inherited_unknown_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind === 'object') code += \`for (const \${k} in \${v}) if (\${unknown_key(k, def)}) \${bail}\\n\`;`,
				replace: `if (kind === 'object') code += \`for (const \${k} in \${v}) if (\${unknown_key(k, def)} && Object.hasOwn(\${v}, \${k})) \${bail}\\n\`;`
			}
		]
	},
	{
		name: 'compile_object_guard_takes_an_inherited_unknown_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `code += \`for (const \${k} in \${v}) if (\${unknown_key(k, entries)}) \${bail}\\n\`;`,
				replace: `code += \`for (const \${k} in \${v}) if (\${unknown_key(k, entries)} && Object.hasOwn(\${v}, \${k})) \${bail}\\n\`;`
			}
		]
	},
	{
		name: 'compile_array_length_read_each_time',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\`for (let \${i} = 0, \${n} = \${v}.length; \${i} < \${n}; \${i}++) {\\nconst \${e} = \${v}[\${i}];\\n\` +
					\`\${emit(def, e, null, bail)}}\\n\``,
				replace: `\`for (let \${i} = 0, \${n} = 0; \${i} < \${v}.length; \${i}++, \${n}++) {\\nconst \${e} = \${v}[\${i}];\\n\` +
					\`\${emit(def, e, null, bail)}}\\n\``
			}
		]
	},
	{
		name: 'compile_uuid_is_any_string',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`handoff(\${capture(schema)}, \${v}, P) !== FAIL\`;`,
				replace: `return \`typeof \${v} === "string"\`;`
			}
		]
	},
	{
		name: 'compile_min_length_exclusive',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`\${v}.length >= \${literal(def)}\`;`,
				replace: `return \`\${v}.length > \${literal(def)}\`;`
			}
		]
	},
	{
		name: 'compile_max_value_exclusive',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`\${v} <= \${literal(def)}\`;`,
				replace: `return \`\${v} < \${literal(def)}\`;`
			}
		]
	},
	{
		name: 'compile_safe_integer_is_integer',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`Number.isSafeInteger(\${v})\`;`,
				replace: `return \`Number.isInteger(\${v})\`;`
			}
		]
	},
	{
		name: 'compile_bigint_takes_a_number',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return \`typeof \${v} === "\${kind}"\`;`,
				replace: `return kind === 'bigint' ? \`(typeof \${v} === "bigint" || typeof \${v} === "number")\` : \`typeof \${v} === "\${kind}"\`;`
			}
		]
	},
	{
		name: 'compile_lazy_function_never_keyed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const keyed = !!key && reads_key(schema);
		const name = fn_of(schema, (out`,
				replace: `const keyed = false;
		const name = fn_of(schema, (out`
			}
		]
	},
	{
		name: 'compile_out_pipe_first_step_without_the_key',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `							i || starts_optional ? null : key_for(key, steps[0]!),
							bail`,
				replace: `							null,
							bail`
			}
		]
	},
	{
		name: 'compile_memo_union_keeps_no_verdict',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				if (memos.has(schema)) return union_call(schema, v, key);`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_inner_call_drops_the_outer_state',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `? \` finally {\\n\${state.map(([name], i) => \`\${name} = \${saved[i]};\\n\`).join('')}}\``,
				replace: `? \` finally {\\n}\``
			}
		]
	},
	{
		name: 'compile_failed_parse_not_the_interpreter',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `deep ? 'break X;' : 'return fallback(v);'`,
				replace: `deep ? 'break X;' : 'return { ok: false, issues: [] };'`
			}
		]
	},
	{
		name: 'compile_failed_deep_parse_not_the_interpreter',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(catches ? \`\\nreturn fallback(v);\\n\` : '\\n');`,
				replace: `(catches ? \`\\nreturn \${output ? '{ ok: false, issues: [] }' : 'false'};\\n\` : '\\n');`
			}
		]
	},
	{
		name: 'compile_out_union_not_handed_for_a_retry',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (memos.has(schema) || key_for(key, ...def)) {`,
				replace: `if (memos.has(schema)) {`
			}
		]
	},
	{
		name: 'compile_out_memo_union_not_handed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (memos.has(schema) || key_for(key, ...def)) {`,
				replace: `if (key_for(key, ...def)) {`
			}
		]
	},
	{
		name: 'compile_two_array_options_not_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `: walking.filter((option) => holds(option)[0]).length > 1 ||`,
				replace: `: false ||`
			}
		]
	},
	{
		name: 'compile_two_object_options_not_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(objects.length > 1 && !told_apart(objects))`,
				replace: `false`
			}
		]
	},
	{
		name: 'compile_two_walking_steps_not_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `? walking.length > 1`,
				replace: `? false`
			}
		]
	},
	{
		name: 'compile_literal_after_the_walk_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				if (reaches_cycle(entry)) break;
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_literals_alike_tell_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(found) => found.has(name) && values.size < values.add(found.get(name)).size`,
				replace: `(found) => found.has(name)`
			}
		]
	},
	{
		name: 'compile_union_off_a_cycle_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const walking = reach_of(schema, true).has(schema)
			? (schema.def as Array<AnySchema>).filter(reaches_cycle)
			: [];`,
				replace: `const walking = (schema.def as Array<AnySchema>).filter(reaches_cycle);`
			}
		]
	},
	{
		name: 'compile_memo_union_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (memos.has(schema) || !/^(union|pipe)$/.test(kind)) continue;`,
				replace: `if (!/^(union|pipe)$/.test(kind)) continue;`
			}
		]
	},
	{
		name: 'compile_walk_through_a_memo_union',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_memo_union_option_walks_on',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `known = !memos.has(schema) && [schema, ...reach_of(schema, true)]`,
				replace: `known = [schema, ...reach_of(schema, true)]`
			}
		]
	},
	{
		name: 'compile_range_error_thrown',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `{\\nif (!(\${error} instanceof RangeError)) throw \${error};\\n}\``,
				replace: `{\\nthrow \${error};\\n}\``
			}
		]
	},
	{
		name: 'compile_any_error_is_the_interpreters',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `{\\nif (!(\${error} instanceof RangeError)) throw \${error};\\n}\``,
				replace: `{\\n}\``
			}
		]
	},
	{
		name: 'compile_no_catch_for_a_kind_run_in_place',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const deep = targets.size > 0 || shares_context;`,
				replace: `const deep = targets.size > 0;`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_optional',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'optional'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_nullable',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'nullable'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_with_default',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'with_default'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_with_default_fn',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'with_default_fn'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_lazy',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'lazy'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'object'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_loose_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'loose_object'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_strip_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'strip_object'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_object_with_rest',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'object_with_rest'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_record',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'record'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'array'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_keyed_record',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'keyed_record'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_union',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'union'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_pipe',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'pipe'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_walk_cut_at_variant',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!(walked && (memos.has(next[1]) || kind_of(next[1]) === 'variant'))) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_optional_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`,
				replace: `			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`
			}
		]
	},
	{
		name: 'compile_refusal_nullable_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`,
				replace: `			case 'optional':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`
			}
		]
	},
	{
		name: 'compile_refusal_with_default_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`,
				replace: `			case 'optional':
			case 'nullable':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`
			}
		]
	},
	{
		name: 'compile_refusal_with_default_fn_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'optional':
			case 'nullable':
			case 'with_default':
			case 'with_default_fn':
				return [['/def/schema', def.schema]];`,
				replace: `			case 'optional':
			case 'nullable':
			case 'with_default':
				return [['/def/schema', def.schema]];`
			}
		]
	},
	{
		name: 'compile_refusal_lazy_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return [['/def()', target_of(schema)]];`,
				replace: `return [];`
			}
		]
	},
	{
		name: 'compile_refusal_object_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`,
				replace: `			case 'loose_object':
			case 'strip_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`
			}
		]
	},
	{
		name: 'compile_refusal_loose_object_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`,
				replace: `			case 'object':
			case 'strip_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`
			}
		]
	},
	{
		name: 'compile_refusal_strip_object_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'object':
			case 'loose_object':
			case 'strip_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`,
				replace: `			case 'object':
			case 'loose_object':
				return Object.keys(def).map((name) => [\`/def/\${name}\`, def[name]]);`
			}
		]
	},
	{
		name: 'compile_refusal_rest_entries_not_walked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `...Object.keys(def.entries).map((name): [string, AnySchema] => [`,
				replace: `...[].map((name): [string, AnySchema] => [`
			}
		]
	},
	{
		name: 'compile_refusal_rest_not_walked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `					['/def/rest', def.rest]
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_refusal_record_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'record':
			case 'array':
				return [['/def', def]];`,
				replace: `			case 'array':
				return [['/def', def]];`
			}
		]
	},
	{
		name: 'compile_refusal_array_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'record':
			case 'array':
				return [['/def', def]];`,
				replace: `			case 'record':
				return [['/def', def]];`
			}
		]
	},
	{
		name: 'compile_refusal_keyed_record_key_not_walked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `					['/def/key', def.key],
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_refusal_keyed_record_value_not_walked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `					['/def/key', def.key],
					['/def/value', def.value]
`,
				replace: `					['/def/key', def.key]
`
			}
		]
	},
	{
		name: 'compile_refusal_union_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'union':
			case 'pipe':
				return def.map((child: AnySchema, i: number) => [\`/def/\${i}\`, child]);`,
				replace: `			case 'pipe':
				return def.map((child: AnySchema, i: number) => [\`/def/\${i}\`, child]);`
			}
		]
	},
	{
		name: 'compile_refusal_pipe_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'union':
			case 'pipe':
				return def.map((child: AnySchema, i: number) => [\`/def/\${i}\`, child]);`,
				replace: `			case 'union':
				return def.map((child: AnySchema, i: number) => [\`/def/\${i}\`, child]);`
			}
		]
	},
	{
		name: 'compile_refusal_variant_holds_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			case 'variant':
				return def.options.map((child: AnySchema, i: number) => [\`/def/options/\${i}\`, child]);
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_refusal_no_lazy_loops',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `all.filter((x) => kind_of(x) === 'lazy' && reach_of(x, true).has(x))`,
				replace: `all.filter((x) => kind_of(x) === 'lazy' && false)`
			}
		]
	},
	{
		name: 'compile_refusal_cycle_through_a_memo_union_counts',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `all.filter((x) => kind_of(x) === 'lazy' && reach_of(x, true).has(x))`,
				replace: `all.filter((x) => kind_of(x) === 'lazy' && reach_of(x).has(x))`
			}
		]
	},
	{
		name: 'compile_refusal_cycle_only_of_the_schema_itself',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `[schema, ...reach_of(schema, true)].some((x) => looping.has(x));`,
				replace: `[schema].some((x) => looping.has(x));`
			}
		]
	},
	{
		name: 'compile_refusal_reach_through_a_memo_union',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `[schema, ...reach_of(schema, true)].some((x) => looping.has(x));`,
				replace: `[schema, ...reach_of(schema)].some((x) => looping.has(x));`
			}
		]
	},
	{
		name: 'compile_refusal_memo_union_cut_everywhere',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!(walked && memos.has(next[1]))) stack.push(...children(next[1]));`,
				replace: `if (!memos.has(next[1])) stack.push(...children(next[1]));`
			}
		]
	},
	{
		name: 'compile_refusal_array_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind === 'array') return [true, false];`,
				replace: `if (kind === 'array') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_array_takes_an_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind === 'array') return [true, false];`,
				replace: `if (kind === 'array') return [true, true];`
			}
		]
	},
	{
		name: 'compile_refusal_object_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'object') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_object_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'object') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_loose_object_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'loose_object') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_loose_object_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'loose_object') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_strip_object_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'strip_object') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_strip_object_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'strip_object') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_object_with_rest_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'object_with_rest') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_object_with_rest_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'object_with_rest') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_record_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'record') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_record_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'record') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_keyed_record_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'keyed_record') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_keyed_record_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'keyed_record') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_variant_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (kind === 'variant') return [false, false];
		if (/object|record|variant/.test(kind)) return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_variant_takes_an_array',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/object|record|variant/.test(kind)) return [false, true];`,
				replace: `if (/object|record|variant/.test(kind) && kind !== 'variant') return [false, true];`
			}
		]
	},
	{
		name: 'compile_refusal_string_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_number_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_boolean_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_bigint_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_literal_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_one_of_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_integer_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_safe_integer_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_uuid_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|iso_datetime|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_iso_datetime_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|to_integer|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_to_integer_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_lower_case)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_to_lower_case_takes_a_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer|to_lower_case)$/;`,
				replace: `/^(string|number|boolean|bigint|literal|one_of|integer|safe_integer|uuid|iso_datetime|to_integer)$/;`
			}
		]
	},
	{
		name: 'compile_refusal_unknown_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'unknown') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_check_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'check') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_transform_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'transform') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_min_length_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'min_length') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_max_length_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'max_length') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_min_value_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'min_value') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_max_value_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'max_value') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_regex_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === 'regex') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_an_own_kind_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (SCALAR_KIND.test(kind)) return [false, false];`,
				replace: `if (SCALAR_KIND.test(kind) || kind === '') return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_what_reads_as_it_likes_takes_no_container',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!through) return [true, true];`,
				replace: `if (!through) return [false, false];`
			}
		]
	},
	{
		name: 'compile_refusal_under_a_lazy_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'lazy'
				? [target_of(schema)]`,
				replace: `kind === 'lazy'
				? []`
			}
		]
	},
	{
		name: 'compile_refusal_under_a_lazy_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'lazy'
				? [target_of(schema)]`,
				replace: `kind === 'lazy!'
				? [target_of(schema)]`
			}
		]
	},
	{
		name: 'compile_refusal_a_pipe_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'pipe'
					? [def[0]]`,
				replace: `kind === 'pipe'
					? []`
			}
		]
	},
	{
		name: 'compile_refusal_a_pipe_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'pipe'
					? [def[0]]`,
				replace: `kind === 'pipe!'
					? [def[0]]`
			}
		]
	},
	{
		name: 'compile_refusal_pipe_held_by_its_last_step',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'pipe'
					? [def[0]]`,
				replace: `kind === 'pipe'
					? [def[def.length - 1]]`
			}
		]
	},
	{
		name: 'compile_refusal_a_union_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'union'
						? def
`,
				replace: `kind === 'union'
						? []
`
			}
		]
	},
	{
		name: 'compile_refusal_a_union_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'union'
						? def
`,
				replace: `kind === 'union!'
						? def
`
			}
		]
	},
	{
		name: 'compile_refusal_a_union_takes_what_its_first_option_does',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `kind === 'union'
						? def
`,
				replace: `kind === 'union'
						? [def[0]]
`
			}
		]
	},
	{
		name: 'compile_refusal_under_a_wrapper_takes_nothing',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `WRAPPER_KIND.test(kind)
							? [def.schema]`,
				replace: `WRAPPER_KIND.test(kind)
							? []`
			}
		]
	},
	{
		name: 'compile_refusal_under_optional_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `WRAPPER_KIND.test(kind)
							? [def.schema]`,
				replace: `WRAPPER_KIND.test(kind) && kind !== 'optional'
							? [def.schema]`
			}
		]
	},
	{
		name: 'compile_refusal_under_nullable_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `WRAPPER_KIND.test(kind)
							? [def.schema]`,
				replace: `WRAPPER_KIND.test(kind) && kind !== 'nullable'
							? [def.schema]`
			}
		]
	},
	{
		name: 'compile_refusal_under_with_default_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `WRAPPER_KIND.test(kind)
							? [def.schema]`,
				replace: `WRAPPER_KIND.test(kind) && kind !== 'with_default'
							? [def.schema]`
			}
		]
	},
	{
		name: 'compile_refusal_under_with_default_fn_takes_either',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `WRAPPER_KIND.test(kind)
							? [def.schema]`,
				replace: `WRAPPER_KIND.test(kind) && kind !== 'with_default_fn'
							? [def.schema]`
			}
		]
	},
	{
		name: 'compile_refusal_array_and_object_swapped_under_a_wrapper',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const [a, o] = holds(next, seen);`,
				replace: `const [o, a] = holds(next, seen);`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_under_optional',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (WRAPPER_KIND.test(kind)) at = at.def.schema;`,
				replace: `if (WRAPPER_KIND.test(kind) && kind !== 'optional') at = at.def.schema;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_under_nullable',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (WRAPPER_KIND.test(kind)) at = at.def.schema;`,
				replace: `if (WRAPPER_KIND.test(kind) && kind !== 'nullable') at = at.def.schema;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_under_with_default',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (WRAPPER_KIND.test(kind)) at = at.def.schema;`,
				replace: `if (WRAPPER_KIND.test(kind) && kind !== 'with_default') at = at.def.schema;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_under_with_default_fn',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (WRAPPER_KIND.test(kind)) at = at.def.schema;`,
				replace: `if (WRAPPER_KIND.test(kind) && kind !== 'with_default_fn') at = at.def.schema;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_under_a_lazy',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			else if (kind === 'lazy') at = target_of(at);
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_in_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (OBJECT_KIND.test(kind)) return at;`,
				replace: `if (OBJECT_KIND.test(kind) && kind !== 'object') return at;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_in_loose_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (OBJECT_KIND.test(kind)) return at;`,
				replace: `if (OBJECT_KIND.test(kind) && kind !== 'loose_object') return at;`
			}
		]
	},
	{
		name: 'compile_refusal_no_literal_looked_for_in_strip_object',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (OBJECT_KIND.test(kind)) return at;`,
				replace: `if (OBJECT_KIND.test(kind) && kind !== 'strip_object') return at;`
			}
		]
	},
	{
		name: 'compile_refusal_told_apart_through_a_pipe',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			else if (kind === 'lazy') at = target_of(at);
			else return undefined;`,
				replace: `			else if (kind === 'lazy') at = target_of(at);
			else if (kind === 'pipe') at = at.def[0];
			else return undefined;`
			}
		]
	},
	{
		name: 'compile_refusal_told_apart_through_a_union',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			else if (kind === 'lazy') at = target_of(at);
			else return undefined;`,
				replace: `			else if (kind === 'lazy') at = target_of(at);
			else if (kind === 'union') at = at.def[0];
			else return undefined;`
			}
		]
	},
	{
		name: 'compile_refusal_told_apart_through_a_variant',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			else if (kind === 'lazy') at = target_of(at);
			else return undefined;`,
				replace: `			else if (kind === 'lazy') at = target_of(at);
			else if (kind === 'variant') at = at.def.options[0];
			else return undefined;`
			}
		]
	},
	{
		name: 'compile_refusal_told_apart_in_an_object_with_rest',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const object = object_of(option);
			if (!object) return found;
			for (const name of Object.keys(object.def)) {
				const entry: AnySchema = object.def[name];`,
				replace: `const of_option = object_of(option) ?? (kind_of(option) === 'object_with_rest' ? option : undefined);
			if (!of_option) return found;
			const object = { def: kind_of(of_option) === 'object_with_rest' ? of_option.def.entries : of_option.def };
			for (const name of Object.keys(object.def)) {
				const entry: AnySchema = object.def[name];`
			}
		]
	},
	{
		name: 'compile_refusal_option_that_is_no_object_left_out',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const firsts = options.map((option) => {`,
				replace: `const firsts = options.filter(object_of).map((option) => {`
			}
		]
	},
	{
		name: 'compile_refusal_one_of_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind_of(entry) === 'literal') found.set(name, entry.def);`,
				replace: `if (/^(literal|one_of)$/.test(kind_of(entry))) found.set(name, entry.def);`
			}
		]
	},
	{
		name: 'compile_refusal_optional_literal_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind_of(entry) === 'literal') found.set(name, entry.def);`,
				replace: `if (kind_of(entry) === 'literal') found.set(name, entry.def);
				else if (kind_of(entry) === 'optional' && kind_of(entry.def.schema) === 'literal') found.set(name, entry.def.schema.def);`
			}
		]
	},
	{
		name: 'compile_refusal_nullable_literal_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind_of(entry) === 'literal') found.set(name, entry.def);`,
				replace: `if (kind_of(entry) === 'literal') found.set(name, entry.def);
				else if (kind_of(entry) === 'nullable' && kind_of(entry.def.schema) === 'literal') found.set(name, entry.def.schema.def);`
			}
		]
	},
	{
		name: 'compile_refusal_with_default_literal_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind_of(entry) === 'literal') found.set(name, entry.def);`,
				replace: `if (kind_of(entry) === 'literal') found.set(name, entry.def);
				else if (kind_of(entry) === 'with_default' && kind_of(entry.def.schema) === 'literal') found.set(name, entry.def.schema.def);`
			}
		]
	},
	{
		name: 'compile_refusal_a_pipe_first_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (kind_of(entry) === 'literal') found.set(name, entry.def);`,
				replace: `if (kind_of(entry) === 'literal' || kind_of(entry) === 'pipe') found.set(name, entry);`
			}
		]
	},
	{
		name: 'compile_refusal_literal_only_as_the_first_entry',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (reaches_cycle(entry)) break;`,
				replace: `if (kind_of(entry) !== 'literal') break;`
			}
		]
	},
	{
		name: 'compile_refusal_every_literal_key_has_to_tell',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return [...firsts[0]!.keys()].some((name) => {`,
				replace: `return [...firsts[0]!.keys()].every((name) => {`
			}
		]
	},
	{
		name: 'compile_refusal_literal_in_some_options_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return firsts.every(
				(found) => found.has(name) && values.size < values.add(found.get(name)).size
			);`,
				replace: `return firsts.some(
				(found) => found.has(name) && values.size < values.add(found.get(name)).size
			);`
			}
		]
	},
	{
		name: 'compile_refusal_a_key_some_options_lack_tells_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return firsts.every(
				(found) => found.has(name) && values.size < values.add(found.get(name)).size
			);`,
				replace: `return firsts.every(
				(found) => values.size < values.add(found.get(name)).size
			);`
			}
		]
	},
	{
		name: 'compile_refusal_zero_and_minus_zero_tell_apart',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `return firsts.every(
				(found) => found.has(name) && values.size < values.add(found.get(name)).size
			);`,
				replace: `return firsts.every(
				(found) =>
					found.has(name) &&
					![...values].some((value) => Object.is(value, found.get(name))) &&
					!!values.add(found.get(name))
			);`
			}
		]
	},
	{
		name: 'compile_refusal_every_option_read_as_walking',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `? (schema.def as Array<AnySchema>).filter(reaches_cycle)`,
				replace: `? (schema.def as Array<AnySchema>)`
			}
		]
	},
	{
		name: 'compile_refusal_no_pipe_asked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `!/^(union|pipe)$/.test(kind)) continue;`,
				replace: `!/^(union)$/.test(kind)) continue;`
			}
		]
	},
	{
		name: 'compile_refusal_no_union_asked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `!/^(union|pipe)$/.test(kind)) continue;`,
				replace: `!/^(pipe)$/.test(kind)) continue;`
			}
		]
	},
	{
		name: 'compile_refusal_only_of_the_root',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (memos.has(schema) || !/^(union|pipe)$/.test(kind)) continue;`,
				replace: `if (memos.has(schema) || !/^(union|pipe)$/.test(kind) || schema !== root) continue;`
			}
		]
	},
	{
		name: 'compile_refusal_arrays_counted_as_objects',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `: walking.filter((option) => holds(option)[0]).length > 1 ||`,
				replace: `: walking.filter((option) => holds(option)[1]).length > 1 ||`
			}
		]
	},
	{
		name: 'compile_refusal_objects_counted_as_arrays',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const objects = walking.filter((option) => holds(option)[1]);`,
				replace: `const objects = walking.filter((option) => holds(option)[0]);`
			}
		]
	},
	{
		name: 'compile_refusal_three_array_options_needed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `: walking.filter((option) => holds(option)[0]).length > 1 ||`,
				replace: `: walking.filter((option) => holds(option)[0]).length > 2 ||`
			}
		]
	},
	{
		name: 'compile_refusal_three_object_options_needed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(objects.length > 1 && !told_apart(objects))`,
				replace: `(objects.length > 2 && !told_apart(objects))`
			}
		]
	},
	{
		name: 'compile_refusal_three_steps_needed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `? walking.length > 1`,
				replace: `? walking.length > 2`
			}
		]
	},
	{
		name: 'compile_refusal_told_apart_refused',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `(objects.length > 1 && !told_apart(objects))`,
				replace: `(objects.length > 1 && told_apart(objects))`
			}
		]
	},
	{
		name: 'compile_refusal_union_on_a_cycle_unasked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const walking = reach_of(schema, true).has(schema)
`,
				replace: `const walking = reach_of(schema, true).has(schema) && false
`
			}
		]
	},
	{
		name: 'compile_wrapper_counted_once',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!WRAPPER_KIND.test(kind_of(schema)) && kind_of(schema) !== 'pipe') return;`,
				replace: `if (kind_of(schema) !== 'pipe') return;`
			}
		]
	},
	{
		name: 'compile_pipe_counted_once',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (!WRAPPER_KIND.test(kind_of(schema)) && kind_of(schema) !== 'pipe') return;`,
				replace: `if (!WRAPPER_KIND.test(kind_of(schema))) return;`
			}
		]
	},
	{
		name: 'compile_emit_any_name_written',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (typeof name !== 'string' || !/^[A-Za-z_$][\\w$]*$/.test(name)) {`,
				replace: `if (typeof name !== 'string') {`
			}
		]
	},
	{
		name: 'compile_emit_a_name_that_is_no_string',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (typeof name !== 'string' || !/^[A-Za-z_$][\\w$]*$/.test(name)) {`,
				replace: `if (!/^[A-Za-z_$][\\w$]*$/.test(name)) {`
			}
		]
	},
	{
		name: 'compile_emit_a_name_matched_in_part',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `!/^[A-Za-z_$][\\w$]*$/.test(name)`,
				replace: `!/^[A-Za-z_$][\\w$]*/.test(name)`
			}
		]
	},
	{
		name: 'compile_emit_a_name_that_starts_with_a_digit',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `!/^[A-Za-z_$][\\w$]*$/.test(name)`,
				replace: `!/^[\\w$]+$/.test(name)`
			}
		]
	},
	{
		name: 'compile_emit_name_unquoted_in_its_refusal',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `named \${quote(String(name))}: not an identifier`,
				replace: `named "\${String(name)}": not an identifier`
			}
		]
	},
	{
		name: 'compile_emit_uuid_has_no_text',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/^(uuid|iso_datetime|to_integer)$/.test(kind)) {`,
				replace: `if (/^(iso_datetime|to_integer)$/.test(kind)) {`
			}
		]
	},
	{
		name: 'compile_emit_iso_datetime_has_no_text',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/^(uuid|iso_datetime|to_integer)$/.test(kind)) {`,
				replace: `if (/^(uuid|to_integer)$/.test(kind)) {`
			}
		]
	},
	{
		name: 'compile_emit_to_integer_has_no_text',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (/^(uuid|iso_datetime|to_integer)$/.test(kind)) {`,
				replace: `if (/^(uuid|iso_datetime)$/.test(kind)) {`
			}
		]
	},
	{
		name: 'compile_emit_action_not_imported',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			imports.add(kind);
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_emit_to_integer_signed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `unsigned: \${!!value.def.unsigned}`,
				replace: `unsigned: false`
			}
		]
	},
	{
		name: 'compile_emit_to_integer_untrimmed',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `trim: \${!!value.def.trim}`,
				replace: `trim: false`
			}
		]
	},
	{
		name: 'compile_emit_regex_subclass_written',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			Object.getPrototypeOf(value) === RegExp.prototype &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_emit_regex_with_a_property_written',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			Object.getPrototypeOf(value) === RegExp.prototype &&
			Reflect.ownKeys(value).length < 2
`,
				replace: `			Object.getPrototypeOf(value) === RegExp.prototype
`
			}
		]
	},
	{
		name: 'compile_emit_pattern_unquoted',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `written = \`new RegExp(\${quote(value.source)}, \${quote(value.flags)})\`;`,
				replace: `written = \`new RegExp("\${value.source}", \${quote(value.flags)})\`;`
			}
		]
	},
	{
		name: 'compile_emit_pattern_as_a_literal',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `written = \`new RegExp(\${quote(value.source)}, \${quote(value.flags)})\`;`,
				replace: `written = \`/\${value.source}/\${value.flags}\`;`
			}
		]
	},
	{
		name: 'compile_emit_pattern_by_stringify_alone',
		file: 'src/lib/compile.ts',
		survives:
			"an engine escapes the line terminators of a regex's `source`, as the specification has it, so only a `Proxy` that lies about its `source`, a degenerate schema, hands `quote` one to escape, and a raw U+2028 or U+2029 in a string literal is valid since ES2019: the text loads and means the same",
		edits: [
			{
				find: `written = \`new RegExp(\${quote(value.source)}, \${quote(value.flags)})\`;`,
				replace: `written = \`new RegExp(\${JSON.stringify(value.source)}, \${quote(value.flags)})\`;`
			}
		]
	},
	{
		name: 'compile_emit_flags_dropped',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `written = \`new RegExp(\${quote(value.source)}, \${quote(value.flags)})\`;`,
				replace: `written = \`new RegExp(\${quote(value.source)})\`;`
			}
		]
	},
	{
		name: 'compile_emit_flags_unquoted',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `written = \`new RegExp(\${quote(value.source)}, \${quote(value.flags)})\`;`,
				replace: `written = \`new RegExp(\${quote(value.source)}, "\${value.flags}")\`;`
			}
		]
	},
	{
		name: 'compile_emit_what_has_no_text_written',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (written === undefined) {
			throw Error(
				\`cannot write \\\`\${at}\\\` at \${path}: it is run by a function, or holds a value, that can't be written as source\`
			);
		}
`,
				replace: `		// to the types a text, and still none
		if (written === undefined) written = undefined as unknown as string;
`
			}
		]
	},
	{
		name: 'compile_emit_no_ts_nocheck',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		'// @ts-nocheck\\n/* eslint-disable */\\n' +
`,
				replace: `		'/* eslint-disable */\\n' +
`
			}
		]
	},
	{
		name: 'compile_emit_no_eslint_disable',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		'// @ts-nocheck\\n/* eslint-disable */\\n' +
`,
				replace: `		'// @ts-nocheck\\n' +
`
			}
		]
	},
	{
		name: 'compile_emit_then_written',
		file: 'src/lib/compile.ts',
		edits: [{ find: `if (name === 'then') {`, replace: `if (name === 'than') {` }]
	},
	{
		name: 'compile_emit_library_unchecked',
		file: 'src/lib/compile.ts',
		edits: [{ find: `if (typeof library !== 'string') {`, replace: `if (library === undefined) {` }]
	},
	{
		name: 'compile_emit_any_regex_written',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			at === 'regex' &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_emit_library_unquoted',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `} from \${quote(library)};\\n\``,
				replace: `} from "\${library}";\\n\``
			}
		]
	},
	{
		name: 'compile_emit_no_failure_value',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `((rest + main).includes('FAIL') ? 'const FAIL = {};\\n' : '')`,
				replace: `''`
			}
		]
	},
	{
		name: 'compile_emit_action_failure_passes',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `'if (P.fails === fails) return output;\\nP.fails = fails;\\nreturn FAIL;\\n};\\n'`,
				replace: `'if (P.fails === fails) return output;\\nP.fails = fails;\\nreturn undefined;\\n};\\n'`
			}
		]
	},
	{
		name: 'compile_emit_action_always_fails',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `'if (P.fails === fails) return output;\\nP.fails = fails;\\nreturn FAIL;\\n};\\n'`,
				replace: `'P.fails = fails;\\nreturn FAIL;\\n};\\n'`
			}
		]
	},
	{
		name: 'compile_emit_captures_misnumbered',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `texts.map((text, i) => \`const c\${i} = \${text};\\n\`).join('')`,
				replace: `texts.map((text, i) => \`const c\${i + 1} = \${text};\\n\`).join('')`
			}
		]
	},
	{
		name: 'compile_emit_exported_under_another_name',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `export { _ as \${name} };\\n\``,
				replace: `export { _ as guard };\\n\``
			}
		]
	},
	{
		name: 'compile_emit_the_guard_named_as_given',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\`function _(v) {\\n\${main}}\\nexport { _ as \${name} };\\n\``,
				replace: `\`export function \${name}(v) {\\n\${main}}\\n\``
			}
		]
	},
	{
		name: 'compile_emit_a_context_in_a_module',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `if (shares_context && !write) state.push(['ctx', 'undefined']);`,
				replace: `if (shares_context) state.push(['ctx', 'undefined']);`
			}
		]
	},
	{
		name: 'compile_emit_a_catch_in_a_module',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `const catches = deep && !write;`,
				replace: `const catches = deep;`
			}
		]
	},
	{
		name: 'compile_emit_set_values_unquoted',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\`new Set([\${values.map(literal).join(', ')}])\``,
				replace: `\`new Set([\${values.map(String).join(', ')}])\``
			}
		]
	},
	{
		name: 'compile_emit_set_has_no_text',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `capture(new Set(values), () => \`new Set([\${values.map(literal).join(', ')}])\`)`,
				replace: `capture(new Set(values))`
			}
		]
	},
	{
		name: 'compile_emit_refusal_names_the_schema_before_the_step',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `					emitting = step;
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_emit_refusal_names_what_a_default_holds',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				const [code, out] = emit_out(def.schema, v, null, bail);
				emitting = schema;
`,
				replace: `				const [code, out] = emit_out(def.schema, v, null, bail);
`
			}
		]
	},
	{
		name: 'compile_emit_refusal_names_the_root',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				emitting.kind,
				paths.get(emitting)!
`,
				replace: `				root.kind,
				paths.get(root)!
`
			}
		]
	},
	{
		name: 'compile_emit_set_text_after_its_number',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			const written = write && text?.();
			captures.set(value, (i = captures.size));
`,
				replace: `			captures.set(value, (i = captures.size));
			const written = write && text?.();
`
			}
		]
	},
	{
		name: 'compile_emit_captured_schema_has_no_kind',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				is_schema(value) ? kind_of(value) : '',
`,
				replace: `				'',
`
			}
		]
	},
	// what a test whose inputs can't tell a guard from none let through: a
	// `__proto__` key whose value is an object, a probe that goes on, a def
	// that holds what is no schema
	{
		name: 'record_copy_begun_keeps_proto',
		edits: [
			{
				find: `			} else if (output) {
				if (keep) output[key] = v;
			} else if (!Object.is(v, input) || !keep) {`,
				replace: `			} else if (output) {
				output[key] = v;
			} else if (!Object.is(v, input) || !keep) {`
			}
		]
	},
	{
		name: 'record_copy_begun_by_proto_keeps_it',
		edits: [
			{
				find: `					if (Object.hasOwn(value, k) && k !== '__proto__') output[k] = value[k];
				}
				if (keep) output[key] = v;`,
				replace: `					if (Object.hasOwn(value, k) && k !== '__proto__') output[k] = value[k];
				}
				output[key] = v;`
			}
		]
	},
	{
		name: 'keyed_record_copy_begun_keeps_proto',
		edits: [
			{
				find: `			} else if (output) {
				if (keep) output[name] = v;`,
				replace: `			} else if (output) {
				output[name] = v;`
			}
		]
	},
	{
		name: 'keyed_record_copy_begun_by_proto_keeps_it',
		edits: [
			{
				find: `					if (Object.hasOwn(input, j) && j !== '__proto__') output[j] = input[j];
				}
				if (keep) output[name] = v;`,
				replace: `					if (Object.hasOwn(input, j) && j !== '__proto__') output[j] = input[j];
				}
				output[name] = v;`
			}
		]
	},
	{
		name: 'keyed_record_failed_proto_copied',
		edits: [
			{
				find: `					if (Object.hasOwn(input, j) && j !== '__proto__') output[j] = input[j];`,
				replace: `					if (Object.hasOwn(input, j)) output[j] = input[j];`
			}
		]
	},
	{
		name: 'rest_copy_begun_keeps_proto',
		edits: [
			{
				find: `					} else if (output !== value) {
						if (keep) output[key] = v;`,
				replace: `					} else if (output !== value) {
						output[key] = v;`
			}
		]
	},
	{
		name: 'rest_probe_goes_on',
		edits: [
			{
				find: `					if (ctx.fails > count) {
						if (ctx.probe) return;
						prefix_path(ctx.issues!, count, key);`,
				replace: `					if (ctx.fails > count) {
						if (ctx.probe) continue;
						prefix_path(ctx.issues!, count, key);`
			}
		]
	},
	{
		name: 'object_probe_goes_on_past_an_unknown_key',
		edits: [
			{
				find: `						fail_at(ctx, 'unknown_key', value, 'no unknown keys', key);
						if (ctx.probe) break;`,
				replace: `						fail_at(ctx, 'unknown_key', value, 'no unknown keys', key);`
			}
		]
	},
	{
		name: 'void_refuses_an_inherited_key',
		edits: [
			{
				find: `			? // the key comes with the object
				parent && !((key as string) in parent)
				? fail(ctx, 'missing_key', v, 'a required key')`,
				replace: `			? // the key comes with the object
				parent && !Object.hasOwn(parent, key as string)
				? fail(ctx, 'missing_key', v, 'a required key')`
			}
		]
	},
	{
		name: 'message_keyed_labels_earlier',
		edits: [
			{
				find: `						const output = schema.run(value, ctx, parent, key, entry);
						if (ctx.issues) label_issues(ctx.issues, count, message, value);`,
				replace: `						const output = schema.run(value, ctx, parent, key, entry);
						if (ctx.issues) label_issues(ctx.issues, count * 0, message, value);`
			}
		]
	},
	{
		name: 'check_at_keeps_the_callers_path',
		edits: [
			{
				find: `Array.isArray(path) ? [...path] : [path as PropertyKey]`,
				replace: `Array.isArray(path) ? path : [path as PropertyKey]`
			}
		]
	},
	{
		name: 'variant_first_of_two_alike',
		edits: [
			{
				find: `	for (const option of options) by_value.set(option.def[key]!.def, option);`,
				replace: `	for (const option of options) {
		if (!by_value.has(option.def[key]!.def)) by_value.set(option.def[key]!.def, option);
	}`
			}
		]
	},
	{
		name: 'compile_entry_not_said_to_a_schema_run_in_place',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `\${entry && key.entry ? ', 1' : ''}`,
				replace: `\${entry && key.entry ? '' : ''}`
			}
		]
	},
	{
		name: 'compile_union_and_variant_never_shared',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `|keyed_record|union|variant)$/;`,
				replace: `|keyed_record)$/;`
			}
		]
	},
	{
		name: 'compile_def_of_union_with_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			return Array.isArray(def) && every_schema(def);`,
				replace: `			return Array.isArray(def);`
			}
		]
	},
	{
		name: 'compile_def_of_pipe_with_no_schema',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			return Array.isArray(def) && def.length > 0 && every_schema(def);`,
				replace: `			return Array.isArray(def) && def.length > 0;`
			}
		]
	},
	{
		name: 'compile_def_of_keyed_record_key_unasked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			return is_record(def) && is_schema(def.key) && is_schema(def.value);`,
				replace: `			return is_record(def) && is_schema(def.value);`
			}
		]
	},
	{
		name: 'compile_def_of_rest_unasked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				every_schema(Object.values(def.entries)) &&
				is_schema(def.rest)`,
				replace: `				every_schema(Object.values(def.entries))`
			}
		]
	},
	{
		name: 'compile_def_of_lazy_unasked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			return typeof def === 'function';`,
				replace: `			return true;`
			}
		]
	},
	{
		name: 'compile_def_of_variant_option_of_any_kind',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `						is_schema(option) &&
						OBJECT_KIND.test(option.kind) &&
						is_def_of(option.kind, option.def) &&`,
				replace: `						is_schema(option) &&`
			}
		]
	},
	{
		name: 'compile_def_of_variant_key_unasked',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `				typeof def.key === 'string' &&`,
				replace: `				true &&`
			}
		]
	},
	{
		name: 'compile_optional_read_as_definite',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `			/^(string|number|boolean|bigint|array|variant)$|object|record/.test(kind) ||`,
				replace: `			/^(string|number|boolean|bigint|array|variant|optional|unknown)$|object|record/.test(kind) ||`
			}
		]
	},
	{
		name: 'introspect_keyed_record_value_depth_dropped',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `\${to_type(s.def.key, inside)}, \${to_type(s.def.value, inside)}>`,
				replace: `\${to_type(s.def.key, inside)}, \${to_type(s.def.value)}>`
			}
		]
	},
	{
		name: 'json_schema_id_copied',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `	$id: 1,
`,
				replace: ``
			}
		]
	},
	{
		name: 'json_schema_negative_length_written',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `					if (!Number.isInteger(bound) || bound < 0) {`,
				replace: `					if (!Number.isInteger(bound)) {`
			}
		]
	},
	{
		name: 'rest_copy_begun_by_proto_keeps_it',
		edits: [
			{
				find: `							if (Object.hasOwn(value, k) && !Object.hasOwn(entries, k)) output[k] = value[k];
						}
						if (keep) output[key] = v;`,
				replace: `							if (Object.hasOwn(value, k) && !Object.hasOwn(entries, k)) output[k] = value[k];
						}
						output[key] = v;`
			}
		]
	},
	{
		name: 'fail_at_reads_in_probe',
		edits: [
			{
				find: `	fail(ctx, kind, ctx.probe || value[key], expected);`,
				replace: `	fail(ctx, kind, value[key], expected);`
			}
		]
	},
	{
		name: 'regex_takes_a_global_pattern',
		edits: [
			{
				find: `if (pattern.global || pattern.sticky) throw`,
				replace: `if (pattern.sticky) throw`
			}
		]
	},
	{
		name: 'regex_takes_a_sticky_pattern',
		edits: [
			{
				find: `if (pattern.global || pattern.sticky) throw`,
				replace: `if (pattern.global) throw`
			}
		]
	},
	{
		name: 'compile_handed_asked_at_each_place',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (known === undefined) handed.set(schema, (known = handed_of(schema)));`,
				replace: `		known = handed_of(schema);`
			}
		]
	},
	{
		name: 'compile_cond_built_at_each_place',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `		if (of_schema.has(at)) return of_schema.get(at);
`,
				replace: ``
			}
		]
	},
	{
		name: 'compile_variant_value_written_after_its_body',
		file: 'src/lib/compile.ts',
		edits: [
			{
				find: `					emitting = schema;
					const of_value = literal(value);
					const body = emit_object(option, v, bail, true);`,
				replace: `					const body = emit_object(option, v, bail, true);
					const of_value = literal(value);`
			}
		]
	},
	{
		name: 'issue_value_read_under_a_message',
		edits: [
			{
				find: `		issue.message === undefined &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'introspect_meta_cleared_key_read_through',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `		if (meta && Object.hasOwn(meta, key)) return meta[key];`,
				replace: `		if (meta?.[key] !== undefined) return meta[key];`
			}
		]
	},
	{
		name: 'introspect_find_meta_reads_under_a_clear',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `			if (value === undefined) cleared = true;
			else found.push`,
				replace: `			if (value !== undefined) found.push`
			}
		]
	},
	{
		name: 'introspect_find_meta_clear_reaches_later_steps',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `visit(s.def[i]!, !i && cleared);`,
				replace: `visit(s.def[i]!, cleared);`
			}
		]
	},
	{
		name: 'introspect_find_meta_walked_under_a_clear_is_seen',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `		(above_cleared ? walked : seen).add(s);`,
				replace: `		seen.add(s);`
			}
		]
	},
	{
		name: 'introspect_empty_union_has_no_text',
		file: 'src/lib/introspect.ts',
		edits: [
			{
				find: `			return s.def.map((o) => to_type(o, inside)).join(' | ') || 'never';`,
				replace: `			return s.def.map((o) => to_type(o, inside)).join(' | ');`
			}
		]
	},
	{
		name: 'json_schema_empty_union_written_as_no_types',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				return s.def.length
					? compact({ anyOf: s.def.map((o, i) => emit(o, \`\${path}/anyOf/\${i}\`)) })
					: { not: {} };`,
				replace: `				return compact({ anyOf: s.def.map((o, i) => emit(o, \`\${path}/anyOf/\${i}\`)) });`
			}
		]
	},
	{
		name: 'json_schema_empty_variant_written_as_no_options',
		file: 'src/lib/json_schema.ts',
		edits: [
			{
				find: `				if (!options.length) return { not: {} };
`,
				replace: ``
			}
		]
	},
	{
		name: 'differential_hole_after_a_change_allowed',
		file: 'src/test/differential_rules.ts',
		edits: [
			{
				find: `					: env.rules.has('hole_in_copy') && is_hole_kept(ours, given, i))`,
				replace: `					: env.rules.has('hole_in_copy'))`
			}
		]
	},
	{
		name: 'differential_present_key_left_out_allowed',
		file: 'src/test/differential_rules.ts',
		edits: [
			{
				find: `	!(is_object(given) && key in given) &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'differential_minimizer_weighs_no_uuid',
		file: 'src/test/differential_classify.ts',
		edits: [
			{
				find: `	uuid: 7,
`,
				replace: ``
			}
		]
	},
	{
		name: 'differential_walk_skips_a_keyed_key',
		file: 'src/test/differential_generate.ts',
		edits: [
			{
				find: `			const key = fn(spec.key);
			const of = fn(spec.of);
			return key !== spec.key || of !== spec.of ? { ...spec, key, of } : spec;`,
				replace: `			const of = fn(spec.of);
			return of !== spec.of ? { ...spec, of } : spec;`
			}
		]
	},
	{
		name: 'recognizer_keyed_key_outside_claims_a_value_under_it',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `				p.length <= u.length + 1 &&
`,
				replace: ``
			}
		]
	},
	{
		name: 'recognizer_own_named_claims_a_key_outside_a_set',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `					!(p.t === 'keyed_record' && is_key_outside(p.key, key))`,
				replace: `					true`
			}
		]
	},
	{
		name: 'recognizer_own_named_leaves_every_set_of_keys',
		file: 'src/test/differential_recognizers.ts',
		edits: [
			{
				find: `					!(p.t === 'keyed_record' && is_key_outside(p.key, key))`,
				replace: `					!(p.t === 'keyed_record' && is_finite_key(p.key))`
			}
		]
	}
];
