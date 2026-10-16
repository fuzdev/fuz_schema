/**
 * The mutants of `npm run mutate`: each a small break of the library, or of a
 * table the tests read, that the suite should fail on. `mutate.ts` applies
 * each to a copy of the working tree and runs the tests, see
 * `docs/benchmarks.md`. Typechecked and linted by `gro check`, never run by it.
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

export const MUTANTS: Array<Mutant> = [
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
				find: `						entry && !((key as string) in parent!) ? value : run(value, ctx)`,
				replace: `						run(value, ctx)`
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
				find: `	run: (v, ctx) => (v === undefined ? value : (schema.run(v, ctx) as Infer<T>))`,
				replace: `	run: (v, ctx) => (v == null ? value : (schema.run(v, ctx) as Infer<T>))`
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
				find: `	run: (v, ctx) => (v === undefined ? value : (schema.run(v, ctx) as Infer<T>))
});`,
				replace: `	run: (v, ctx) => { if (v === undefined) return value; const r = schema.run(v, ctx) as Infer<T>; return r === undefined ? value : r; }
});`
			}
		]
	},
	{
		name: 'default_runs_schema',
		edits: [
			{
				find: `	run: (v, ctx) => (v === undefined ? value : (schema.run(v, ctx) as Infer<T>))
});`,
				replace: `	run: (v, ctx) => (v === undefined ? (schema.run(value, ctx) as Infer<T>) : (schema.run(v, ctx) as Infer<T>))
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
	// a default zod fills in as it is and valibot runs through its schema, and`,
				replace: `	}].filter(() => false),
	// a default zod fills in as it is and valibot runs through its schema, and`
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
	}
];
