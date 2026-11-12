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
				replace: `					else if (false) {
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
				replace: `			return output;`
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
				replace: `							if (false) {`
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
				replace: `		for (let i = 1; i < schemas.length; i++) {
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
				replace: `	run: (value: any, _ctx: any, parent?: any, key?: any) => (parent && !(key in parent) ? 'X' : fn(value))
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
				find: `issue.kind !== 'unknown_key' && issue.kind !== 'missing_key' && `,
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
		name: 'issue_value_over_message',
		edits: [
			{
				find: `	return format_issue(text ? { ...issue, received: text } : issue);`,
				replace: `	return format_issue(text ? { ...issue, received: text, message: undefined } : issue);`
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
				replace: ``
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
				replace: `						if (false) {`
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
				replace: `			if (false) {`
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
				find: `(o.kind === 'object' || o.kind === 'strip_object' || o.kind === 'loose_object') &&`,
				replace: `true &&`
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
				replace: `memo.set(value, output);`
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
				find: `				first ??= layer;`,
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
					if (j === k || true) break;`
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
				replace: `if (false) n = +value.replace(`
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
	}
];
