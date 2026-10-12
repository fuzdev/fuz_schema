/**
 * svelte-docinfo's schemas, as it writes them for valibot: every schema of a
 * module and of its diagnostics, and the shape its test fixtures are stored in. A snapshot, taken from
 * https://github.com/fuzdev/svelte-docinfo at 201167635284
 * (`src/lib/types.ts`, `src/lib/diagnostics.ts`, and `ModuleFixtureJson` from
 * its fixture helpers), MIT licensed, copyright fuz.dev. What is left out is
 * what doesn't run: its comments, its type exports but the two the recursive
 * schema is annotated with, and the named interfaces it declares for its
 * package's types.
 *
 * `docinfo_fuz_schema.ts` is the same schemas in this library, and
 * `src/test/docinfo.test.ts` holds the two to the same answers.
 *
 * @module
 */

import * as v from 'valibot';

export const DiagnosticSeverity = v.picklist(['error', 'warning']);

export const DiagnosticKind = v.picklist([
	'type_extraction_failed',
	'signature_analysis_failed',
	'class_member_failed',
	'svelte_prop_failed',
	'legacy_props',
	'module_skipped',
	'module_unreadable',
	'import_parse_failed',
	'duplicate_comment',
	'misplaced_tag',
	'unknown_param',
	'source_map_failed',
	'duplicate_declaration',
	'transform_failed',
	'resolver_failed',
	'alias_lost'
]);

const baseDiagnosticFields = {
	file: v.string(),
	line: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
	column: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
	message: v.string(),
	severity: DiagnosticSeverity
};
export const TypeExtractionDiagnostic = v.strictObject({
	kind: v.literal('type_extraction_failed'),
	...baseDiagnosticFields,
	symbolName: v.string()
});

export const SignatureAnalysisDiagnostic = v.strictObject({
	kind: v.literal('signature_analysis_failed'),
	...baseDiagnosticFields,
	functionName: v.string()
});

export const ClassMemberDiagnostic = v.strictObject({
	kind: v.literal('class_member_failed'),
	...baseDiagnosticFields,
	className: v.string(),
	memberName: v.string()
});

export const SveltePropDiagnostic = v.strictObject({
	kind: v.literal('svelte_prop_failed'),
	...baseDiagnosticFields,
	componentName: v.string(),
	propName: v.string()
});

export const LegacyPropsDiagnostic = v.strictObject({
	kind: v.literal('legacy_props'),
	...baseDiagnosticFields,
	componentName: v.string(),
	propNames: v.pipe(v.array(v.string()), v.minLength(1))
});

export const ModuleSkippedDiagnostic = v.strictObject({
	kind: v.literal('module_skipped'),
	...baseDiagnosticFields,
	reason: v.picklist(['not_in_program', 'no_analyzer', 'requires_program'])
});

export const ModuleUnreadableDiagnostic = v.strictObject({
	kind: v.literal('module_unreadable'),
	...baseDiagnosticFields
});

export const ImportParseDiagnostic = v.strictObject({
	kind: v.literal('import_parse_failed'),
	...baseDiagnosticFields
});

export const DuplicateCommentDiagnostic = v.strictObject({
	kind: v.literal('duplicate_comment'),
	...baseDiagnosticFields,
	commentType: v.picklist(['module_comment', 'doc_comment'])
});

export const MisplacedTagDiagnostic = v.strictObject({
	kind: v.literal('misplaced_tag'),
	...baseDiagnosticFields,
	tagName: v.picklist([
		'example',
		'deprecated',
		'internal',
		'since',
		'see',
		'throws',
		'mutates',
		'default',
		'nodocs'
	]),
	functionName: v.optional(v.string())
});

export const UnknownParamDiagnostic = v.strictObject({
	kind: v.literal('unknown_param'),
	...baseDiagnosticFields,
	paramName: v.string(),
	functionName: v.string()
});

export const DuplicateDeclarationDiagnostic = v.strictObject({
	kind: v.literal('duplicate_declaration'),
	...baseDiagnosticFields,
	declarationName: v.string(),
	modules: v.pipe(v.array(v.string()), v.minLength(2))
});

export const SourceMapFailedDiagnostic = v.strictObject({
	kind: v.literal('source_map_failed'),
	...baseDiagnosticFields
});

export const TransformFailedDiagnostic = v.strictObject({
	kind: v.literal('transform_failed'),
	...baseDiagnosticFields
});

export const ResolverFailedDiagnostic = v.strictObject({
	kind: v.literal('resolver_failed'),
	...baseDiagnosticFields,
	specifier: v.string()
});

export const AliasLostDiagnostic = v.strictObject({
	kind: v.literal('alias_lost'),
	...baseDiagnosticFields,
	aliasName: v.string()
});
export const Diagnostic = v.variant('kind', [
	TypeExtractionDiagnostic,
	SignatureAnalysisDiagnostic,
	ClassMemberDiagnostic,
	SveltePropDiagnostic,
	LegacyPropsDiagnostic,
	ModuleSkippedDiagnostic,
	ModuleUnreadableDiagnostic,
	ImportParseDiagnostic,
	DuplicateCommentDiagnostic,
	MisplacedTagDiagnostic,
	UnknownParamDiagnostic,
	SourceMapFailedDiagnostic,
	DuplicateDeclarationDiagnostic,
	TransformFailedDiagnostic,
	ResolverFailedDiagnostic,
	AliasLostDiagnostic
]);

export const DeclarationKind = v.picklist([
	'type',
	'function',
	'variable',
	'class',
	'interface',
	'enum',
	'component',
	'snippet',
	'namespace'
]);

export const DeclarationModifier = v.picklist([
	'public',
	'protected',
	'readonly',
	'static',
	'abstract',
	'getter',
	'setter'
]);

export const Reactivity = v.picklist(['$state', '$state.raw', '$derived', '$derived.by']);

export const GenericParamJson = v.strictObject({
	name: v.string(),
	constraint: v.optional(v.string()),
	defaultType: v.optional(v.string())
});

export type TypeJson =
	| { kind: 'intrinsic'; text: string }
	| { kind: 'literal'; value: string | number | boolean; text: string }
	| { kind: 'reference'; name: string; module?: string; typeArgs?: Array<TypeJson> }
	| { kind: 'array'; element: TypeJson; readonly?: boolean }
	| { kind: 'tuple'; elements?: Array<TupleElementJson>; readonly?: boolean }
	| { kind: 'union'; alias?: string; members: Array<TypeJson> }
	| { kind: 'intersection'; alias?: string; members: Array<TypeJson> }
	| { kind: 'function'; text: string }
	| { kind: 'object'; text: string }
	| { kind: 'other'; text: string };

export interface TupleElementJson {
	name?: string;
	type: TypeJson;
	optional?: boolean;
	rest?: boolean;
}
export const TypeJson: v.GenericSchema<TypeJson> = v.variant('kind', [
	v.strictObject({ kind: v.literal('intrinsic'), text: v.string() }),
	v.strictObject({
		kind: v.literal('literal'),
		value: v.union([v.string(), v.pipe(v.number(), v.finite()), v.boolean()]),
		text: v.string()
	}),
	v.strictObject({
		kind: v.literal('reference'),
		name: v.string(),
		module: v.optional(v.string()),
		typeArgs: v.optional(v.array(v.lazy(() => TypeJson)))
	}),
	v.strictObject({
		kind: v.literal('array'),
		element: v.lazy(() => TypeJson),
		readonly: v.optional(v.boolean())
	}),
	v.strictObject({
		kind: v.literal('tuple'),
		elements: v.optional(v.array(v.lazy(() => TupleElementJson))),
		readonly: v.optional(v.boolean())
	}),
	v.strictObject({
		kind: v.literal('union'),
		alias: v.optional(v.string()),
		members: v.array(v.lazy(() => TypeJson))
	}),
	v.strictObject({
		kind: v.literal('intersection'),
		alias: v.optional(v.string()),
		members: v.array(v.lazy(() => TypeJson))
	}),
	v.strictObject({ kind: v.literal('function'), text: v.string() }),
	v.strictObject({ kind: v.literal('object'), text: v.string() }),
	v.strictObject({ kind: v.literal('other'), text: v.string() })
]);
export const TupleElementJson: v.GenericSchema<TupleElementJson> = v.strictObject({
	name: v.optional(v.string()),
	type: TypeJson,
	optional: v.optional(v.boolean()),
	rest: v.optional(v.boolean())
});

const StringRecord: v.GenericSchema<Record<string, string>> = v.pipe(
	v.custom<Record<string, string>>((input) => {
		if (typeof input !== 'object' || input === null) return false;
		const proto: unknown = Object.getPrototypeOf(input);
		return proto === Object.prototype || proto === null;
	}, 'Invalid type: Expected a record of strings'),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const input: Record<string, unknown> = dataset.value;
		for (const [key, value] of Object.entries(input)) {
			if (key === '__proto__' || typeof value === 'string') continue;
			addIssue({
				message: `Invalid type: Expected string but received ${describeReceived(value)}`,
				expected: 'string',
				input: value,
				path: [{ type: 'object', origin: 'value', input, key, value }]
			});
		}
	}),
	v.transform((input) => {
		const copy: Record<string, string> = {};
		for (const key of Object.keys(input)) {
			if (key !== '__proto__') copy[key] = input[key]!;
		}
		return copy;
	})
);

const describeReceived = (value: unknown): string => {
	if (value === null || value === undefined) return String(value);
	if (Array.isArray(value)) return 'Array';
	if (typeof value === 'object') return 'Object';
	if (typeof value === 'function' || typeof value === 'symbol') return typeof value;
	return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value);
};

export const ParameterJson = v.strictObject({
	name: v.string(),
	type: v.string(),
	typeInfo: v.optional(TypeJson),
	optional: v.optional(v.boolean(), false),
	rest: v.optional(v.boolean(), false),
	description: v.optional(v.string()),
	defaultValue: v.optional(v.string()),
	propertyDescriptions: v.optional(StringRecord)
});

const docFields = {
	examples: v.optional(v.array(v.string()), () => []),
	deprecatedMessage: v.optional(v.string()),
	seeAlso: v.optional(v.array(v.string()), () => []),
	throws: v.optional(
		v.array(v.strictObject({ type: v.optional(v.string()), description: v.string() })),
		() => []
	),
	since: v.optional(v.string()),
	internalMessage: v.optional(v.string()),
	mutates: v.optional(StringRecord)
} as const;

export const ComponentPropJson = v.strictObject({
	name: v.string(),
	type: v.string(),
	typeInfo: v.optional(TypeJson),
	optional: v.optional(v.boolean(), false),
	description: v.optional(v.string()),
	defaultValue: v.optional(v.string()),
	bindable: v.optional(v.boolean(), false),
	parameters: v.optional(v.array(ParameterJson)),
	returnType: v.optional(v.string()),
	returnTypeInfo: v.optional(TypeJson),
	...docFields
});

export const OverloadJson = v.strictObject({
	typeSignature: v.string(),
	parameters: v.optional(v.array(ParameterJson), () => []),
	returnType: v.optional(v.string()),
	returnTypeInfo: v.optional(TypeJson),
	genericParams: v.optional(v.array(GenericParamJson), () => []),
	docComment: v.optional(v.string()),
	returnDescription: v.optional(v.string())
});

export const MemberKind = v.picklist(['function', 'variable', 'constructor']);

const declarationSharedFields = {
	name: v.string(),
	kind: DeclarationKind,
	docComment: v.optional(v.string()),
	typeSignature: v.optional(v.string()),
	modifiers: v.optional(v.array(DeclarationModifier), () => []),
	sourceLine: v.optional(v.pipe(v.number(), v.finite())),
	genericParams: v.optional(v.array(GenericParamJson), () => []),
	...docFields,
	partial: v.optional(v.boolean(), false)
} as const;

const callableFields = {
	parameters: v.optional(v.array(ParameterJson), () => []),
	overloads: v.optional(v.array(OverloadJson), () => [])
} as const;

const returnFields = {
	returnType: v.optional(v.string()),
	returnTypeInfo: v.optional(TypeJson),
	returnDescription: v.optional(v.string())
} as const;

const functionLikeFields = {
	...callableFields,
	...returnFields
} as const;

export const FunctionMemberJson = v.strictObject({
	...declarationSharedFields,
	...functionLikeFields,
	kind: v.literal('function'),
	name: v.string(),
	optional: v.optional(v.boolean(), false),
	defaultValue: v.optional(v.string())
});

export const VariableMemberJson = v.strictObject({
	...declarationSharedFields,
	kind: v.literal('variable'),
	optional: v.optional(v.boolean(), false),
	reactivity: v.optional(Reactivity),
	defaultValue: v.optional(v.string()),
	typeInfo: v.optional(TypeJson)
});

export const ConstructorMemberJson = v.strictObject({
	...declarationSharedFields,
	...callableFields,
	kind: v.literal('constructor'),
	name: v.union([v.literal('constructor'), v.literal('(construct)')])
});

export const MemberJson = v.variant('kind', [
	FunctionMemberJson,
	VariableMemberJson,
	ConstructorMemberJson
]);

const declarationTopLevelFields = {
	alsoExportedFrom: v.optional(v.array(v.string()), () => []),
	aliasOf: v.optional(
		v.strictObject({
			module: v.string(),
			name: v.string()
		})
	)
} as const;

export const FunctionDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	...functionLikeFields,
	kind: v.literal('function')
});

export const ClassDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('class'),
	extends: v.optional(v.array(v.string()), () => []),
	externalTypes: v.optional(v.array(v.string()), () => []),
	implements: v.optional(v.array(v.string()), () => []),
	members: v.optional(v.array(MemberJson), () => [])
});

export const InterfaceDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('interface'),
	extends: v.optional(v.array(v.string()), () => []),
	externalTypes: v.optional(v.array(v.string()), () => []),
	members: v.optional(v.array(MemberJson), () => []),
	mergedValue: v.optional(v.boolean(), false)
});

export const TypeDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('type'),
	externalTypes: v.optional(v.array(v.string()), () => []),
	typeInfo: v.optional(TypeJson),
	members: v.optional(v.array(MemberJson), () => []),
	mergedValue: v.optional(v.boolean(), false)
});

export const VariableDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('variable'),
	reactivity: v.optional(Reactivity),
	defaultValue: v.optional(v.string()),
	typeInfo: v.optional(TypeJson)
});

export const EnumDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('enum'),
	members: v.optional(v.array(MemberJson), () => [])
});

export const ComponentDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('component'),
	externalTypes: v.optional(v.array(v.string()), () => []),
	props: v.optional(v.array(ComponentPropJson), () => []),
	acceptsChildren: v.optional(v.boolean(), false),
	lang: v.optional(v.picklist(['js']))
});

export const SnippetDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('snippet'),
	parameters: v.optional(v.array(ParameterJson), () => [])
});

export const NamespaceDeclarationJson = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('namespace'),
	module: v.string()
});

export const DeclarationJson = v.variant('kind', [
	FunctionDeclarationJson,
	ClassDeclarationJson,
	InterfaceDeclarationJson,
	TypeDeclarationJson,
	VariableDeclarationJson,
	EnumDeclarationJson,
	ComponentDeclarationJson,
	SnippetDeclarationJson,
	NamespaceDeclarationJson
]);

export const ReExportJson = v.strictObject({
	name: v.string(),
	module: v.string(),
	typeOnly: v.optional(v.boolean(), false),
	sourceLine: v.optional(v.pipe(v.number(), v.finite()))
});

export const ExternalReExportJson = v.strictObject({
	name: v.string(),
	specifier: v.string(),
	originalName: v.optional(v.string()),
	typeOnly: v.optional(v.boolean(), false),
	sourceLine: v.optional(v.pipe(v.number(), v.finite()))
});

export const ModuleJson = v.strictObject({
	path: v.string(),
	declarations: v.optional(v.array(DeclarationJson), () => []),
	moduleComment: v.optional(v.string()),
	dependencies: v.optional(v.array(v.string()), () => []),
	dependents: v.optional(v.array(v.string()), () => []),
	starExports: v.optional(v.array(v.string()), () => []),
	reExports: v.optional(v.array(ReExportJson), () => []),
	externalReExports: v.optional(v.array(ExternalReExportJson), () => []),
	externalStarExports: v.optional(v.array(v.string()), () => []),
	partial: v.optional(v.boolean(), false)
});

export const ModuleFixtureJson = v.strictObject({
	...ModuleJson.entries,
	diagnostics: v.optional(v.array(Diagnostic), () => [])
});
