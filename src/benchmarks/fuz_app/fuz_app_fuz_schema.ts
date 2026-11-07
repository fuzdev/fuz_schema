/**
 * fuz_app's wire schemas, the ones its server and every frontend parse on a
 * request's way through, copied from fuz_app at e89e66081ec9 and from zzz at
 * 5aafb254ebff. fuz_app writes them in this library already, so this is its
 * code call for call, in its order, with the library taken as a parameter so
 * `grade` can build it against two versions.
 *
 * From fuz_app's `src/lib/`: `primitive_schemas.ts` (`bounded_string`,
 * `UsernameCanonical`, `Email` with `is_email_within_length_max`, `Uuid`,
 * `Timestamp`, `FactHashSchema`, `ActingActor`), `auth/name_schema.ts`
 * (`create_name_schema`, for `RoleName` and `ScopeKindName`),
 * `auth/cell_data_schema.ts`, `auth/cell_grant_action_specs.ts`,
 * `auth/cell_field_action_specs.ts`, `auth/cell_item_action_specs.ts`,
 * `auth/cell_action_specs.ts`, `auth/account_schema.ts`,
 * `auth/account_route_schema.ts`, `auth/token_scope.ts`, and
 * `http/jsonrpc.ts`. From fuz_util: `FACT_HASH_EXACT` (`hash_schemas.ts`),
 * and `FRACTIONAL_INDEX_REGEX` and `FRACTIONAL_INDEX_LENGTH_MAX`
 * (`fractional_index.ts`). From zzz's `src/lib/`: `ProgressMeta` and
 * `CompletionProgressInput` (`action_specs.ts`), and `CompletionMessage`
 * (`completion_types.ts`).
 *
 * What is left out: every `meta`, which returns a copy of its schema with the
 * same `run` and keeps the metadata in one registry on `globalThis`, which
 * every instance of the library in a process shares, so a `create` case
 * through it would share state between the versions a grade compares. The
 * messages of the name schemas are fuz_app's.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

type SchemaLib = typeof schema_lib;

/** The schemas `create_fuz_app` returns, typed loosely: they are run, not inferred from. */
export type FuzAppSchemas = Record<
	| 'Uuid'
	| 'Timestamp'
	| 'FactHashSchema'
	| 'ActingActor'
	| 'UsernameCanonical'
	| 'Email'
	| 'RoleName'
	| 'ScopeKindName'
	| 'CellData'
	| 'CellGrantLevel'
	| 'CellGrantPrincipalInput'
	| 'GrantJson'
	| 'CellFieldName'
	| 'FieldJson'
	| 'CellItemPosition'
	| 'ItemJson'
	| 'CellVisibility'
	| 'CellPolicy'
	| 'CellPath'
	| 'CellModeration'
	| 'CellJson'
	| 'CellCreateInput'
	| 'CellCreateOutput'
	| 'CellGetInput'
	| 'CellGetOutput'
	| 'CellUpdateInput'
	| 'CellUpdateOutput'
	| 'CellDeleteInput'
	| 'CellDeleteOutput'
	| 'CellListInput'
	| 'CellListOutput'
	| 'SessionAccountJson'
	| 'RoleGrantSummaryJson'
	| 'ActorSummaryJson'
	| 'AccountStatusOutput'
	| 'TokenScope'
	| 'AuditStreamQuery'
	| 'JsonrpcRequestId'
	| 'JsonrpcRequest'
	| 'JsonrpcNotification'
	| 'JsonrpcResponse'
	| 'ProgressMeta'
	| 'CompletionMessage'
	| 'CompletionProgressInput',
	schema_lib.AnySchema
>;

// fuz_util's
const FACT_HASH_EXACT = /^blake3:[0-9a-f]{64}$/;
const FRACTIONAL_INDEX_REGEX = /^[0-9A-Za-z]+$/;
const FRACTIONAL_INDEX_LENGTH_MAX = 200;

// fuz_app's, made once as its modules do
const USERNAME_LENGTH_MIN = 3;
const USERNAME_LENGTH_MAX = 39;
const USERNAME_CANONICAL_REGEX = /^[a-z][0-9a-z_-]*[0-9a-z]$/;
const EMAIL_LENGTH_MAX = 254;
const EMAIL_REGEX = /^[^\s\u0085@]+@[^\s\u0085@.]+\.[^\s\u0085@]*[^\s\u0085@.]$/;
const EMAIL_LENGTH_MESSAGE = `Email must be at most ${EMAIL_LENGTH_MAX} bytes`;
const utf8_encoder = new TextEncoder();
const is_email_within_length_max = (s: string): boolean =>
	s.length <= EMAIL_LENGTH_MAX && utf8_encoder.encode(s).length <= EMAIL_LENGTH_MAX;
const NAME_LENGTH_MAX = 64;
const NAME_REGEX = /^[a-z]+(?:_[a-z]+)*$/;
const format_name_length_message = (label: string): string =>
	`${label} names must be at most ${NAME_LENGTH_MAX} characters`;
const format_name_pattern_message = (label: string): string =>
	`${label} names must be lowercase letters and underscores (a-z_), no leading, trailing or consecutive underscores`;
const CELL_FIELD_NAME_REGEX = /^[a-z][a-z0-9_]{0,63}$/;
const CELL_PATH_LENGTH_MAX = 256;
const CELL_KIND_LENGTH_MAX = 64;
const CELL_LIST_LIMIT_MAX = 200;
const TOKEN_SCOPE_VERSION = 1;
const JSONRPC_VERSION = '2.0';

export const create_fuz_app = (s: SchemaLib): FuzAppSchemas => {
	// primitive_schemas.ts

	const bounded_string = (options: {
		min?: number;
		max: number;
		max_message?: string;
	}): schema_lib.AnySchema => {
		const { min, max, max_message } = options;
		const max_step =
			max_message === undefined ? s.max_length(max) : s.message(s.max_length(max), max_message);
		return min === undefined
			? s.pipe(s.string, max_step)
			: s.pipe(s.string, s.min_length(min), max_step);
	};

	const UsernameCanonical = s.pipe(
		bounded_string({ min: USERNAME_LENGTH_MIN, max: USERNAME_LENGTH_MAX }),
		s.regex(USERNAME_CANONICAL_REGEX)
	);

	const Email = s.pipe(
		s.string,
		s.message(s.max_length(EMAIL_LENGTH_MAX), EMAIL_LENGTH_MESSAGE),
		s.regex(EMAIL_REGEX),
		s.message(s.check(is_email_within_length_max), EMAIL_LENGTH_MESSAGE)
	);

	const Uuid = s.brand(s.pipe(s.string, s.uuid, s.to_lower_case), 'Uuid');

	const Timestamp = s.pipe(s.string, s.iso_datetime);

	const FactHashSchema = s.brand(s.pipe(s.string, s.regex(FACT_HASH_EXACT)), 'FactHash');

	const ActingActor = s.optional(Uuid);

	// auth/name_schema.ts

	const create_name_schema = (label: string): schema_lib.AnySchema =>
		s.pipe(
			bounded_string({ max: NAME_LENGTH_MAX, max_message: format_name_length_message(label) }),
			s.message(s.regex(NAME_REGEX), format_name_pattern_message(label))
		);

	const RoleName = create_name_schema('Role');

	const ScopeKindName = create_name_schema('Scope-kind');

	// auth/cell_data_schema.ts

	const CellData = s.loose_object({
		label: s.optional(s.string),
		summary: s.optional(s.string)
	});

	// auth/cell_grant_action_specs.ts

	const CellGrantLevel = s.one_of(['viewer', 'editor']);

	const CellGrantPrincipalInput = s.variant('kind', [
		s.object({
			kind: s.literal('actor'),
			actor_id: Uuid
		}),
		s.object({
			kind: s.literal('role'),
			role: RoleName,
			scope_id: s.optional(s.nullable(Uuid))
		})
	]);

	const GrantJson = s.object({
		id: Uuid,
		cell_id: Uuid,
		level: CellGrantLevel,
		actor_id: s.nullable(Uuid),
		role: s.nullable(RoleName),
		scope_id: s.nullable(Uuid),
		granted_by: s.nullable(Uuid),
		created_at: Timestamp
	});

	// auth/cell_field_action_specs.ts

	const CellFieldName = s.brand(s.pipe(s.string, s.regex(CELL_FIELD_NAME_REGEX)), 'CellFieldName');

	const FieldJson = s.object({
		source_id: Uuid,
		name: CellFieldName,
		target_id: Uuid,
		created_at: Timestamp
	});

	// auth/cell_item_action_specs.ts

	const CellItemPosition = s.brand(
		s.pipe(
			bounded_string({ min: 1, max: FRACTIONAL_INDEX_LENGTH_MAX }),
			s.regex(FRACTIONAL_INDEX_REGEX)
		),
		'CellItemPosition'
	);

	const ItemJson = s.object({
		parent_id: Uuid,
		position: CellItemPosition,
		child_id: Uuid,
		created_at: Timestamp
	});

	// auth/cell_action_specs.ts

	const CellVisibility = s.one_of(['private', 'public']);

	const CellPolicy = s.loose_object({});

	const CellPath = s.brand(bounded_string({ min: 1, max: CELL_PATH_LENGTH_MAX }), 'CellPath');

	const CellModeration = s.one_of(['pending', 'approved', 'rejected']);

	const CellJson = s.object({
		id: Uuid,
		path: s.nullable(CellPath),
		data: CellData,
		kind: s.nullable(bounded_string({ max: CELL_KIND_LENGTH_MAX })),
		visibility: CellVisibility,
		refs: s.nullable(s.array(FactHashSchema)),
		parent_id: s.nullable(Uuid),
		root_id: s.nullable(Uuid),
		moderation: s.nullable(CellModeration),
		policy: s.nullable(CellPolicy),
		created_by: s.nullable(Uuid),
		updated_by: s.nullable(Uuid),
		created_at: Timestamp,
		updated_at: s.nullable(Timestamp),
		deleted_at: s.nullable(Timestamp),
		grant_count: s.pipe(s.number, s.safe_integer, s.min_value(0))
	});

	const CellCreateInput = s.object({
		data: CellData,
		kind: s.optional(s.nullable(bounded_string({ max: CELL_KIND_LENGTH_MAX }))),
		visibility: s.optional(CellVisibility),
		path: s.optional(s.nullable(CellPath)),
		parent_id: s.optional(s.nullable(Uuid)),
		policy: s.optional(s.nullable(CellPolicy)),
		acting: ActingActor
	});

	const CellCreateOutput = s.object({ cell: CellJson });

	const CellGetInput = s.object({
		id: s.optional(Uuid),
		path: s.optional(CellPath),
		acting: ActingActor
	});

	const CellGetOutput = s.object({
		cell: CellJson,
		fields: s.array(FieldJson),
		fields_truncated: s.boolean,
		items: s.array(ItemJson),
		items_truncated: s.boolean,
		can_edit: s.boolean,
		can_grant: s.boolean
	});

	const CellUpdateInput = s.object({
		cell_id: Uuid,
		data: s.optional(CellData),
		visibility: s.optional(CellVisibility),
		path: s.optional(s.nullable(CellPath)),
		acting: ActingActor
	});

	const CellUpdateOutput = s.object({ cell: CellJson });

	const CellDeleteInput = s.object({
		cell_id: Uuid,
		acting: ActingActor
	});

	const CellDeleteOutput = s.object({
		ok: s.literal(true),
		deleted: s.boolean
	});

	const CellListInput = s.with_default_fn(
		s.object({
			ids: s.optional(s.pipe(s.array(Uuid), s.max_length(CELL_LIST_LIMIT_MAX))),
			kind: s.optional(bounded_string({ max: CELL_KIND_LENGTH_MAX })),
			visibility: s.optional(CellVisibility),
			ref: s.optional(FactHashSchema),
			created_by: s.optional(Uuid),
			path_prefix: s.optional(CellPath),
			root_id: s.optional(Uuid),
			moderation: s.optional(CellModeration),
			shared_with: s.optional(s.literal('me')),
			order_by: s.optional(s.one_of(['created_at', 'updated_at'])),
			order_direction: s.optional(s.one_of(['asc', 'desc'])),
			limit: s.optional(
				s.pipe(s.number, s.integer, s.min_value(1), s.max_value(CELL_LIST_LIMIT_MAX))
			),
			offset: s.optional(s.pipe(s.number, s.safe_integer, s.min_value(0))),
			acting: ActingActor
		}),
		() => ({})
	);

	const CellListOutput = s.object({
		cells: s.array(CellJson),
		cell_grants: s.optional(s.record(s.array(GrantJson)))
	});

	// auth/account_schema.ts

	const SessionAccountJson = s.object({
		id: Uuid,
		username: UsernameCanonical,
		email: s.nullable(Email),
		email_verified: s.boolean,
		created_at: Timestamp
	});

	const RoleGrantSummaryJson = s.object({
		id: Uuid,
		role: RoleName,
		scope_kind: s.nullable(ScopeKindName),
		scope_id: s.nullable(Uuid),
		created_at: Timestamp,
		expires_at: s.nullable(Timestamp),
		granted_by: s.nullable(Uuid)
	});

	const ActorSummaryJson = s.object({
		id: Uuid,
		name: s.string
	});

	// auth/account_route_schema.ts

	const AccountStatusOutput = s.object({
		account: SessionAccountJson,
		actor: s.nullable(ActorSummaryJson),
		role_grants: s.array(RoleGrantSummaryJson)
	});

	// auth/token_scope.ts

	const TokenScope = s.variant('kind', [
		s.object({
			version: s.literal(TOKEN_SCOPE_VERSION),
			kind: s.literal('full'),
			grandfathered: s.optional(s.boolean)
		}),
		s.object({
			version: s.literal(TOKEN_SCOPE_VERSION),
			kind: s.literal('methods'),
			methods: s.array(s.string),
			grandfathered: s.optional(s.boolean)
		})
	]);

	// auth/audit_log_route_schema.ts, the one query a route of fuz_app's declares

	const AuditStreamQuery = s.object({ acting: ActingActor });

	// http/jsonrpc.ts

	const JsonrpcRequestId = s.union([s.string, s.number]);

	const JsonrpcRequestParams = s.loose_object({});

	const JsonrpcNotificationParams = s.loose_object({});

	const JsonrpcRequest = s.loose_object({
		jsonrpc: s.literal(JSONRPC_VERSION),
		id: JsonrpcRequestId,
		method: s.string,
		params: s.optional(JsonrpcRequestParams)
	});

	const JsonrpcNotification = s.loose_object({
		jsonrpc: s.literal(JSONRPC_VERSION),
		method: s.string,
		params: s.optional(JsonrpcNotificationParams)
	});

	const JsonrpcResponse = s.loose_object({
		jsonrpc: s.literal(JSONRPC_VERSION),
		id: JsonrpcRequestId,
		result: s.unknown
	});

	// zzz's completion_types.ts and action_specs.ts

	const CompletionMessage = s.loose_object({
		role: s.string,
		content: s.string
	});

	const ProgressMeta = s.loose_object({ progressToken: s.optional(Uuid) });

	const CompletionProgressInput = s.object({
		chunk: s.optional(
			s.loose_object({
				model: s.optional(s.string),
				created_at: s.optional(s.string),
				done: s.optional(s.boolean),
				message: s.optional(CompletionMessage)
			})
		),
		_meta: s.optional(ProgressMeta)
	});

	return {
		Uuid,
		Timestamp,
		FactHashSchema,
		ActingActor,
		UsernameCanonical,
		Email,
		RoleName,
		ScopeKindName,
		CellData,
		CellGrantLevel,
		CellGrantPrincipalInput,
		GrantJson,
		CellFieldName,
		FieldJson,
		CellItemPosition,
		ItemJson,
		CellVisibility,
		CellPolicy,
		CellPath,
		CellModeration,
		CellJson,
		CellCreateInput,
		CellCreateOutput,
		CellGetInput,
		CellGetOutput,
		CellUpdateInput,
		CellUpdateOutput,
		CellDeleteInput,
		CellDeleteOutput,
		CellListInput,
		CellListOutput,
		SessionAccountJson,
		RoleGrantSummaryJson,
		ActorSummaryJson,
		AccountStatusOutput,
		TokenScope,
		AuditStreamQuery,
		JsonrpcRequestId,
		JsonrpcRequest,
		JsonrpcNotification,
		JsonrpcResponse,
		ProgressMeta,
		CompletionMessage,
		CompletionProgressInput
	};
};
