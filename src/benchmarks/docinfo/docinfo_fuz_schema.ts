/**
 * svelte-docinfo's schemas in this library: `docinfo_valibot.ts` rewritten
 * call for call, in the same order, so the two can be compared. It takes the
 * library as a parameter so `grade` can build it against two versions.
 *
 * What differs from the original:
 *
 * - `StringRecord` is `record(string)`. svelte-docinfo wrote its own from
 *   `custom`, `rawCheck` and `transform` because valibot's `record` drops the
 *   `constructor` and `prototype` keys; this library's keeps them, and drops a
 *   `__proto__` key as the original does. The original also copies every
 *   record, refuses an object with another prototype, and doesn't look at the
 *   value of a `__proto__` key, where this refuses one that isn't a string.
 * - A default that the original makes afresh for every parse (`() => []`) is
 *   one shared value here, since `with_default` takes a value: every output
 *   holds the same array, and a consumer that pushes to one changes them all.
 *
 * And what differs between the libraries, on input that doesn't match: valibot
 * takes an array for a strict object and reports its keys, reports the first
 * unknown key only, and runs every check of a pipe, where this library reports
 * the array, every unknown key, and the first check to fail.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

type SchemaLib = typeof schema_lib;

/** The schemas `create_docinfo` returns, typed loosely: they are run, not inferred from. */
export type DocinfoSchemas = Record<
	| 'DeclarationKind'
	| 'DeclarationModifier'
	| 'Reactivity'
	| 'MemberKind'
	| 'DiagnosticSeverity'
	| 'DiagnosticKind'
	| 'TypeJson'
	| 'ParameterJson'
	| 'ComponentPropJson'
	| 'MemberJson'
	| 'DeclarationJson'
	| 'ModuleJson'
	| 'Diagnostic'
	| 'ModuleFixtureJson',
	schema_lib.AnySchema
>;

export const create_docinfo = (s: SchemaLib): DocinfoSchemas => {
	const DiagnosticSeverity = s.one_of(['error', 'warning']);

	const DiagnosticKind = s.one_of([
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
		file: s.string,
		line: s.optional(s.pipe(s.number, s.safe_integer, s.min_value(1))),
		column: s.optional(s.pipe(s.number, s.safe_integer, s.min_value(1))),
		message: s.string,
		severity: DiagnosticSeverity
	};
	const TypeExtractionDiagnostic = s.object({
		kind: s.literal('type_extraction_failed'),
		...baseDiagnosticFields,
		symbolName: s.string
	});

	const SignatureAnalysisDiagnostic = s.object({
		kind: s.literal('signature_analysis_failed'),
		...baseDiagnosticFields,
		functionName: s.string
	});

	const ClassMemberDiagnostic = s.object({
		kind: s.literal('class_member_failed'),
		...baseDiagnosticFields,
		className: s.string,
		memberName: s.string
	});

	const SveltePropDiagnostic = s.object({
		kind: s.literal('svelte_prop_failed'),
		...baseDiagnosticFields,
		componentName: s.string,
		propName: s.string
	});

	const LegacyPropsDiagnostic = s.object({
		kind: s.literal('legacy_props'),
		...baseDiagnosticFields,
		componentName: s.string,
		propNames: s.pipe(s.array(s.string), s.min_length(1))
	});

	const ModuleSkippedDiagnostic = s.object({
		kind: s.literal('module_skipped'),
		...baseDiagnosticFields,
		reason: s.one_of(['not_in_program', 'no_analyzer', 'requires_program'])
	});

	const ModuleUnreadableDiagnostic = s.object({
		kind: s.literal('module_unreadable'),
		...baseDiagnosticFields
	});

	const ImportParseDiagnostic = s.object({
		kind: s.literal('import_parse_failed'),
		...baseDiagnosticFields
	});

	const DuplicateCommentDiagnostic = s.object({
		kind: s.literal('duplicate_comment'),
		...baseDiagnosticFields,
		commentType: s.one_of(['module_comment', 'doc_comment'])
	});

	const MisplacedTagDiagnostic = s.object({
		kind: s.literal('misplaced_tag'),
		...baseDiagnosticFields,
		tagName: s.one_of([
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
		functionName: s.optional(s.string)
	});

	const UnknownParamDiagnostic = s.object({
		kind: s.literal('unknown_param'),
		...baseDiagnosticFields,
		paramName: s.string,
		functionName: s.string
	});

	const DuplicateDeclarationDiagnostic = s.object({
		kind: s.literal('duplicate_declaration'),
		...baseDiagnosticFields,
		declarationName: s.string,
		modules: s.pipe(s.array(s.string), s.min_length(2))
	});

	const SourceMapFailedDiagnostic = s.object({
		kind: s.literal('source_map_failed'),
		...baseDiagnosticFields
	});

	const TransformFailedDiagnostic = s.object({
		kind: s.literal('transform_failed'),
		...baseDiagnosticFields
	});

	const ResolverFailedDiagnostic = s.object({
		kind: s.literal('resolver_failed'),
		...baseDiagnosticFields,
		specifier: s.string
	});

	const AliasLostDiagnostic = s.object({
		kind: s.literal('alias_lost'),
		...baseDiagnosticFields,
		aliasName: s.string
	});
	const Diagnostic = s.variant('kind', [
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

	const DeclarationKind = s.one_of([
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

	const DeclarationModifier = s.one_of([
		'public',
		'protected',
		'readonly',
		'static',
		'abstract',
		'getter',
		'setter'
	]);

	const Reactivity = s.one_of(['$state', '$state.raw', '$derived', '$derived.by']);

	const GenericParamJson = s.object({
		name: s.string,
		constraint: s.optional(s.string),
		defaultType: s.optional(s.string)
	});

	const TypeJson: schema_lib.AnySchema = s.variant('kind', [
		s.object({ kind: s.literal('intrinsic'), text: s.string }),
		s.object({
			kind: s.literal('literal'),
			value: s.union([s.string, s.number, s.boolean]),
			text: s.string
		}),
		s.object({
			kind: s.literal('reference'),
			name: s.string,
			module: s.optional(s.string),
			typeArgs: s.optional(s.array(s.lazy(() => TypeJson)))
		}),
		s.object({
			kind: s.literal('array'),
			element: s.lazy(() => TypeJson),
			readonly: s.optional(s.boolean)
		}),
		s.object({
			kind: s.literal('tuple'),
			elements: s.optional(s.array(s.lazy(() => TupleElementJson))),
			readonly: s.optional(s.boolean)
		}),
		s.object({
			kind: s.literal('union'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		s.object({
			kind: s.literal('intersection'),
			alias: s.optional(s.string),
			members: s.array(s.lazy(() => TypeJson))
		}),
		s.object({ kind: s.literal('function'), text: s.string }),
		s.object({ kind: s.literal('object'), text: s.string }),
		s.object({ kind: s.literal('other'), text: s.string })
	]);
	const TupleElementJson: schema_lib.AnySchema = s.object({
		name: s.optional(s.string),
		type: TypeJson,
		optional: s.optional(s.boolean),
		rest: s.optional(s.boolean)
	});

	const StringRecord = s.record(s.string);

	const ParameterJson = s.object({
		name: s.string,
		type: s.string,
		typeInfo: s.optional(TypeJson),
		optional: s.with_default(s.boolean, false),
		rest: s.with_default(s.boolean, false),
		description: s.optional(s.string),
		defaultValue: s.optional(s.string),
		propertyDescriptions: s.optional(StringRecord)
	});

	const docFields = {
		examples: s.with_default(s.array(s.string), []),
		deprecatedMessage: s.optional(s.string),
		seeAlso: s.with_default(s.array(s.string), []),
		throws: s.with_default(
			s.array(s.object({ type: s.optional(s.string), description: s.string })),
			[]
		),
		since: s.optional(s.string),
		internalMessage: s.optional(s.string),
		mutates: s.optional(StringRecord)
	} as const;

	const ComponentPropJson = s.object({
		name: s.string,
		type: s.string,
		typeInfo: s.optional(TypeJson),
		optional: s.with_default(s.boolean, false),
		description: s.optional(s.string),
		defaultValue: s.optional(s.string),
		bindable: s.with_default(s.boolean, false),
		parameters: s.optional(s.array(ParameterJson)),
		returnType: s.optional(s.string),
		returnTypeInfo: s.optional(TypeJson),
		...docFields
	});

	const OverloadJson = s.object({
		typeSignature: s.string,
		parameters: s.with_default(s.array(ParameterJson), []),
		returnType: s.optional(s.string),
		returnTypeInfo: s.optional(TypeJson),
		genericParams: s.with_default(s.array(GenericParamJson), []),
		docComment: s.optional(s.string),
		returnDescription: s.optional(s.string)
	});

	const MemberKind = s.one_of(['function', 'variable', 'constructor']);

	const declarationSharedFields = {
		name: s.string,
		kind: DeclarationKind,
		docComment: s.optional(s.string),
		typeSignature: s.optional(s.string),
		modifiers: s.with_default(s.array(DeclarationModifier), []),
		sourceLine: s.optional(s.number),
		genericParams: s.with_default(s.array(GenericParamJson), []),
		...docFields,
		partial: s.with_default(s.boolean, false)
	} as const;

	const callableFields = {
		parameters: s.with_default(s.array(ParameterJson), []),
		overloads: s.with_default(s.array(OverloadJson), [])
	} as const;

	const returnFields = {
		returnType: s.optional(s.string),
		returnTypeInfo: s.optional(TypeJson),
		returnDescription: s.optional(s.string)
	} as const;

	const functionLikeFields = {
		...callableFields,
		...returnFields
	} as const;

	const FunctionMemberJson = s.object({
		...declarationSharedFields,
		...functionLikeFields,
		kind: s.literal('function'),
		name: s.string,
		optional: s.with_default(s.boolean, false),
		defaultValue: s.optional(s.string)
	});

	const VariableMemberJson = s.object({
		...declarationSharedFields,
		kind: s.literal('variable'),
		optional: s.with_default(s.boolean, false),
		reactivity: s.optional(Reactivity),
		defaultValue: s.optional(s.string),
		typeInfo: s.optional(TypeJson)
	});

	const ConstructorMemberJson = s.object({
		...declarationSharedFields,
		...callableFields,
		kind: s.literal('constructor'),
		name: s.union([s.literal('constructor'), s.literal('(construct)')])
	});

	const MemberJson = s.variant('kind', [
		FunctionMemberJson,
		VariableMemberJson,
		ConstructorMemberJson
	]);

	const declarationTopLevelFields = {
		alsoExportedFrom: s.with_default(s.array(s.string), []),
		aliasOf: s.optional(
			s.object({
				module: s.string,
				name: s.string
			})
		)
	} as const;

	const FunctionDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		...functionLikeFields,
		kind: s.literal('function')
	});

	const ClassDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('class'),
		extends: s.with_default(s.array(s.string), []),
		externalTypes: s.with_default(s.array(s.string), []),
		implements: s.with_default(s.array(s.string), []),
		members: s.with_default(s.array(MemberJson), [])
	});

	const InterfaceDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('interface'),
		extends: s.with_default(s.array(s.string), []),
		externalTypes: s.with_default(s.array(s.string), []),
		members: s.with_default(s.array(MemberJson), []),
		mergedValue: s.with_default(s.boolean, false)
	});

	const TypeDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('type'),
		externalTypes: s.with_default(s.array(s.string), []),
		typeInfo: s.optional(TypeJson),
		members: s.with_default(s.array(MemberJson), []),
		mergedValue: s.with_default(s.boolean, false)
	});

	const VariableDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('variable'),
		reactivity: s.optional(Reactivity),
		defaultValue: s.optional(s.string),
		typeInfo: s.optional(TypeJson)
	});

	const EnumDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('enum'),
		members: s.with_default(s.array(MemberJson), [])
	});

	const ComponentDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('component'),
		externalTypes: s.with_default(s.array(s.string), []),
		props: s.with_default(s.array(ComponentPropJson), []),
		acceptsChildren: s.with_default(s.boolean, false),
		lang: s.optional(s.one_of(['js']))
	});

	const SnippetDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('snippet'),
		parameters: s.with_default(s.array(ParameterJson), [])
	});

	const NamespaceDeclarationJson = s.object({
		...declarationSharedFields,
		...declarationTopLevelFields,
		kind: s.literal('namespace'),
		module: s.string
	});

	const DeclarationJson = s.variant('kind', [
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

	const ReExportJson = s.object({
		name: s.string,
		module: s.string,
		typeOnly: s.with_default(s.boolean, false),
		sourceLine: s.optional(s.number)
	});

	const ExternalReExportJson = s.object({
		name: s.string,
		specifier: s.string,
		originalName: s.optional(s.string),
		typeOnly: s.with_default(s.boolean, false),
		sourceLine: s.optional(s.number)
	});

	const ModuleJson = s.object({
		path: s.string,
		declarations: s.with_default(s.array(DeclarationJson), []),
		moduleComment: s.optional(s.string),
		dependencies: s.with_default(s.array(s.string), []),
		dependents: s.with_default(s.array(s.string), []),
		starExports: s.with_default(s.array(s.string), []),
		reExports: s.with_default(s.array(ReExportJson), []),
		externalReExports: s.with_default(s.array(ExternalReExportJson), []),
		externalStarExports: s.with_default(s.array(s.string), []),
		partial: s.with_default(s.boolean, false)
	});

	const ModuleFixtureJson = s.object({
		...ModuleJson.def,
		diagnostics: s.with_default(s.array(Diagnostic), [])
	});

	return {
		DeclarationKind,
		DeclarationModifier,
		Reactivity,
		MemberKind,
		DiagnosticSeverity,
		DiagnosticKind,
		TypeJson,
		ParameterJson,
		ComponentPropJson,
		MemberJson,
		DeclarationJson,
		ModuleJson,
		Diagnostic,
		ModuleFixtureJson
	};
};
