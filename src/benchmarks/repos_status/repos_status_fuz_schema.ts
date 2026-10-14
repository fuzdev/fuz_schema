/**
 * fuz_repos's status report schemas in this library: `repos_status_zod.ts`
 * rewritten call for call, in the same order. It takes the library as a
 * parameter so `grade` can build it against two versions.
 *
 * Every object is strict and every union but the last is discriminated, so
 * nothing differs in kind: `discriminatedUnion` is `variant`, `enum` is
 * `one_of`, and a count is `pipe(number, safe_integer, min_value(0))`,
 * since zod's `int` is an integer a double holds exactly.
 *
 * @module
 */

import type * as schema_lib from '#lib/schema.ts';

type SchemaLib = typeof schema_lib;

/** The schemas `create_repos_status` returns, typed loosely: they are run, not inferred from. */
export type ReposStatusSchemas = Record<
	| 'ReposSessionSource'
	| 'ReposSession'
	| 'ReposUnavailable'
	| 'ReposSessions'
	| 'ReposEntryKind'
	| 'ReposVisibility'
	| 'ReposCheckoutList'
	| 'ReposEntryName'
	| 'ReposRegistryIssue'
	| 'ReposBranchHold'
	| 'ReposRefreshHold'
	| 'ReposCloneHold'
	| 'ReposRefreshVerdict'
	| 'ReposPresence'
	| 'ReposCloneRecipe'
	| 'ReposCloneVerdict'
	| 'ReposSyncAction'
	| 'ReposBranchNeedsHuman'
	| 'ReposCleanupReason'
	| 'ReposVerdict'
	| 'ReposLayout'
	| 'ReposHead'
	| 'ReposUncommitted'
	| 'ReposInProgressOp'
	| 'ReposCheckout'
	| 'ReposRelation'
	| 'ReposBranchStatus'
	| 'ReposAtRest'
	| 'ReposUnprobedWhy'
	| 'ReposGitDirHolds'
	| 'ReposPruneLoss'
	| 'ReposPrune'
	| 'ReposUnprobedWorktree'
	| 'ReposUnprobedWorktreeStatus'
	| 'ReposOriginRemote'
	| 'ReposOriginByHand'
	| 'ReposOriginFix'
	| 'ReposUnreachableCause'
	| 'ReposRefGoneFix'
	| 'ReposFetchFailure'
	| 'ReposVisibilityCheck'
	| 'ReposProbeErrorKind'
	| 'ReposProbeError'
	| 'ReposNeedsHuman'
	| 'ReposEntryStatus'
	| 'ReposRepairBlock'
	| 'ReposUnregisteredClone'
	| 'ReposStatusReport'
	| 'ReposStatusErrorBody'
	| 'ReposStatusErrorReport'
	| 'ReposStatusDocument',
	schema_lib.AnySchema
>;

export const create_repos_status = (s: SchemaLib): ReposStatusSchemas => {
	const REPOS_STATUS_FORMAT_VERSION = 19;
	const Count = s.pipe(s.number, s.safe_integer, s.min_value(0));
	const UnixSeconds = s.pipe(s.number, s.safe_integer, s.min_value(0));

	const ReposSessionSource = s.one_of(['session_file', 'roster_worker']);

	const ReposSession = s.object({
		pid: Count,
		cwd: s.string,
		worktree: s.nullable(s.string),
		process_cwd: s.nullable(s.string),
		source: ReposSessionSource
	});

	const ReposUnavailable = s.variant('kind', [
		s.object({ kind: s.literal('home_unknown') }),
		s.object({ kind: s.literal('relative_config_dir'), path: s.string }),
		s.object({ kind: s.literal('unreadable'), path: s.string, error: s.string }),
		s.object({ kind: s.literal('unparseable'), path: s.string, error: s.string }),
		s.object({
			kind: s.literal('foreign_pid_domain'),
			path: s.string,
			pid_domain: s.string,
			source: ReposSessionSource
		})
	]);

	const ReposSessions = s.variant('kind', [
		s.object({ kind: s.literal('available'), unscoped: s.array(ReposSession) }),
		s.object({ kind: s.literal('unavailable'), reason: ReposUnavailable })
	]);

	const ReposEntryKind = s.one_of(['repo', 'reference']);

	const ReposVisibility = s.one_of(['public', 'private']);

	const ReposCheckoutList = s.one_of(['requires', 'consults']);

	const ReposEntryName = s.object({ kind: ReposEntryKind, key: s.string });

	const ReposRegistryIssue = s.variant('kind', [
		s.object({ kind: s.literal('repo_not_owned'), key: s.string, account: s.string }),
		s.object({ kind: s.literal('fork_not_owned'), key: s.string }),
		s.object({ kind: s.literal('dir_not_a_name'), entry: ReposEntryName, dir: s.string }),
		s.object({
			kind: s.literal('dir_claimed_twice'),
			dir: s.string,
			first: ReposEntryName,
			second: ReposEntryName
		}),
		s.object({ kind: s.literal('key_in_both'), key: s.string }),
		s.object({ kind: s.literal('key_is_other_dir'), key: s.string, entry: ReposEntryName }),
		s.object({
			kind: s.literal('unknown_checkout_ref'),
			key: s.string,
			field: ReposCheckoutList,
			target: s.string
		}),
		s.object({ kind: s.literal('self_ref'), key: s.string, field: ReposCheckoutList }),
		s.object({ kind: s.literal('requires_and_consults'), key: s.string, target: s.string })
	]);

	const ReposBranchHold = s.one_of([
		'pinned',
		'entry',
		'push_url',
		'fetch_failed',
		'dirty_checkout',
		'unprobed_worktree',
		'several_checkouts',
		'busy',
		'busy_unknown'
	]);

	const ReposRefreshHold = s.one_of(['pinned', 'entry', 'origin_not_https']);

	const ReposCloneHold = s.one_of(['entry', 'busy', 'unprobed_worktree']);

	const ReposRefreshVerdict = s.variant('kind', [
		s.object({ kind: s.literal('act') }),
		s.object({ kind: s.literal('held'), by: ReposRefreshHold })
	]);

	const ReposPresence = s.variant('kind', [
		s.object({ kind: s.literal('present') }),
		s.object({ kind: s.literal('missing') }),
		s.object({ kind: s.literal('not_a_repo') })
	]);

	const ReposCloneRecipe = s.object({
		url: s.string,
		branch: s.nullable(s.string),
		shallow: s.boolean,
		sparse: s.nullable(s.string)
	});

	const ReposCloneVerdict = s.variant('kind', [
		s.object({ kind: s.literal('act'), recipe: ReposCloneRecipe }),
		s.object({ kind: s.literal('held'), recipe: ReposCloneRecipe, by: ReposCloneHold })
	]);

	const ReposSyncAction = s.variant('kind', [
		s.object({ kind: s.literal('push'), commits: Count }),
		s.object({ kind: s.literal('fast_forward'), commits: Count }),
		s.object({ kind: s.literal('move') }),
		s.object({ kind: s.literal('rebase'), ahead: Count, behind: Count })
	]);

	const ReposBranchNeedsHuman = s.one_of([
		'diverged',
		'diverged_published',
		'diverged_merge',
		'diverged_tagged',
		'unmapped',
		'archived_ahead',
		'shallow_local_work',
		'upstream_not_a_branch'
	]);

	const ReposCleanupReason = s.one_of(['merged', 'upstream_gone']);

	const ReposVerdict = s.variant('kind', [
		s.object({ kind: s.literal('quiet') }),
		s.object({ kind: s.literal('act'), action: ReposSyncAction }),
		s.object({ kind: s.literal('held'), action: ReposSyncAction, by: ReposBranchHold }),
		s.object({ kind: s.literal('needs_human'), reason: ReposBranchNeedsHuman }),
		s.object({ kind: s.literal('local_only') }),
		s.object({
			kind: s.literal('cleanup'),
			reason: ReposCleanupReason,
			removable_worktree: s.nullable(s.string)
		})
	]);

	const ReposLayout = s.object({
		shallow: s.boolean,
		sparse: s.boolean,
		partial_filter: s.nullable(s.string)
	});

	const ReposHead = s.variant('kind', [
		s.object({ kind: s.literal('branch'), name: s.string }),
		s.object({ kind: s.literal('detached'), commit: s.string })
	]);

	const ReposUncommitted = s.object({
		staged: Count,
		unstaged: Count,
		untracked: Count,
		conflicted: Count
	});

	const ReposInProgressOp = s.one_of([
		'rebase',
		'merge',
		'cherry_pick',
		'revert',
		'bisect',
		'sequencer',
		'am'
	]);

	const ReposCheckout = s.object({
		path: s.string,
		primary: s.boolean,
		head: ReposHead,
		uncommitted: ReposUncommitted,
		in_progress: s.nullable(ReposInProgressOp),
		locked: s.boolean,
		linked: s.boolean,
		submodules: s.nullable(s.boolean),
		busy: s.array(ReposSession)
	});

	const ReposRelation = s.variant('kind', [
		s.object({ kind: s.literal('in_sync') }),
		s.object({ kind: s.literal('ahead'), commits: Count }),
		s.object({ kind: s.literal('behind'), commits: Count }),
		s.object({ kind: s.literal('diverged'), ahead: Count, behind: Count }),
		s.object({ kind: s.literal('shallow') }),
		s.object({ kind: s.literal('gone') }),
		s.object({ kind: s.literal('unmapped') }),
		s.object({ kind: s.literal('untracked') })
	]);

	const ReposBranchStatus = s.object({
		name: s.string,
		upstream: s.nullable(s.string),
		worktree: s.nullable(s.string),
		symref: s.nullable(s.string),
		unique_commits: Count,
		newest_commit_at: UnixSeconds,
		relation: ReposRelation,
		verdict: ReposVerdict
	});

	const ReposAtRest = s.object({
		on_branch: s.nullable(s.boolean),
		clean: s.boolean,
		idle: s.boolean,
		followed: s.nullable(ReposRelation)
	});

	const ReposUnprobedWhy = s.variant('kind', [
		s.object({ kind: s.literal('prunable') }),
		s.object({ kind: s.literal('missing') }),
		s.object({ kind: s.literal('failed'), error: s.string })
	]);

	const ReposGitDirHolds = s.object({
		submodules: s.boolean,
		worktree_refs: s.boolean,
		staged: s.nullable(s.boolean)
	});

	const ReposPruneLoss = s.variant('kind', [
		s.object({ kind: s.literal('operation'), op: ReposInProgressOp }),
		s.object({ kind: s.literal('detached_head') }),
		s.object({ kind: s.literal('unknown_head') }),
		s.object({ kind: s.literal('missing_branch'), name: s.string }),
		s.object({ kind: s.literal('submodules') }),
		s.object({ kind: s.literal('worktree_refs') }),
		s.object({ kind: s.literal('staged_changes') }),
		s.object({ kind: s.literal('unmatched_git_dir') }),
		s.object({ kind: s.literal('relative_gitdir'), git_dir: s.string })
	]);

	const ReposPrune = s.variant('kind', [
		s.object({ kind: s.literal('safe') }),
		s.object({ kind: s.literal('loses'), losses: s.array(ReposPruneLoss) }),
		s.object({ kind: s.literal('moved'), to: s.array(s.string) })
	]);

	const ReposUnprobedWorktree = s.object({
		path: s.string,
		git_dir: s.nullable(s.string),
		head: s.nullable(ReposHead),
		locked: s.boolean,
		in_progress: s.nullable(ReposInProgressOp),
		why: ReposUnprobedWhy,
		holds: s.nullable(ReposGitDirHolds)
	});

	const ReposUnprobedWorktreeStatus = s.object({
		...ReposUnprobedWorktree.def,
		...{
			prune: s.nullable(ReposPrune),
			busy: s.array(ReposSession)
		}
	});

	const ReposOriginRemote = s.variant('kind', [
		s.object({ kind: s.literal('url'), url: s.string }),
		s.object({ kind: s.literal('no_url') }),
		s.object({ kind: s.literal('missing') })
	]);

	const ReposOriginByHand = s.one_of([
		'outside_repo_file',
		'valueless_url',
		'empty_value',
		'several_urls'
	]);

	const ReposOriginFix = s.variant('kind', [
		s.object({ kind: s.literal('add') }),
		s.object({ kind: s.literal('set_url') }),
		s.object({ kind: s.literal('by_hand'), reason: ReposOriginByHand })
	]);

	const ReposUnreachableCause = s.one_of(['dns', 'connection', 'host_key', 'auth']);

	const ReposRefGoneFix = s.variant('kind', [
		s.object({ kind: s.literal('unset_refspec'), pattern: s.string }),
		s.object({ kind: s.literal('set_branches'), branch: s.nullable(s.string) }),
		s.object({ kind: s.literal('by_hand') })
	]);

	const ReposFetchFailure = s.variant('kind', [
		s.object({ kind: s.literal('ref_gone'), refname: s.string, fix: ReposRefGoneFix }),
		s.object({
			kind: s.literal('unreachable'),
			cause: ReposUnreachableCause,
			message: s.string
		}),
		s.object({ kind: s.literal('repo_not_found'), message: s.string }),
		s.object({
			kind: s.literal('timed_out'),
			after_secs: Count
		}),
		s.object({ kind: s.literal('failed'), message: s.string }),
		s.object({ kind: s.literal('refspec_outside_origin'), refspec: s.string }),
		s.object({
			kind: s.literal('origin_refs_shared'),
			remote: s.string,
			refspec: s.string
		}),
		s.object({ kind: s.literal('legacy_remotes_unreadable'), path: s.string })
	]);

	const ReposVisibilityCheck = s.variant('kind', [
		s.object({ kind: s.literal('leak') }),
		s.object({ kind: s.literal('private') }),
		s.object({ kind: s.literal('unknown'), failure: ReposFetchFailure })
	]);

	const ReposProbeErrorKind = s.one_of([
		'path_unreadable',
		'non_utf8_path',
		'config_unreadable',
		'fetch_url_unreadable',
		'push_urls_unreadable',
		'git_not_run',
		'git_timed_out',
		'git_failed',
		'unexpected_output'
	]);

	const ReposProbeError = s.object({
		kind: ReposProbeErrorKind,
		message: s.string
	});

	const ReposNeedsHuman = s.variant('kind', [
		s.object({ kind: s.literal('not_a_repo'), detail: s.string }),
		s.object({
			kind: s.literal('operation_in_progress'),
			checkout: s.string,
			op: ReposInProgressOp
		}),
		s.object({
			kind: s.literal('origin_mismatch'),
			origin: ReposOriginRemote,
			expected: s.string,
			fix: ReposOriginFix
		}),
		s.object({
			kind: s.literal('origin_not_https'),
			fetch_url: s.string,
			expected: s.string,
			fix: s.nullable(ReposOriginFix)
		}),
		s.object({
			kind: s.literal('fetch_url_mismatch'),
			fetch_url: s.string,
			expected: s.string,
			fix: s.nullable(ReposOriginFix)
		}),
		s.object({ kind: s.literal('worktree_unreadable'), path: s.string }),
		s.object({ kind: s.literal('default_branch_missing'), branch: s.string }),
		s.object({ kind: s.literal('default_branch_no_upstream'), branch: s.string }),
		s.object({ kind: s.literal('default_branch_gone'), branch: s.string }),
		s.object({ kind: s.literal('unexpected_detached'), checkout: s.string }),
		s.object({
			kind: s.literal('checkout_unresolvable'),
			checkout: s.string,
			path: s.string,
			error: s.string
		}),
		s.object({
			kind: s.literal('unlisted_git_dir'),
			git_dir: s.string,
			head: s.nullable(ReposHead),
			busy: s.array(ReposSession)
		}),
		s.object({
			kind: s.literal('push_url_mismatch'),
			push_urls: s.array(s.string),
			expected: s.string
		}),
		s.object({ kind: s.literal('clone_shares_repo'), with: s.string }),
		s.object({ kind: s.literal('cloned_unregistered'), dir: s.string })
	]);

	const ReposEntryStatus = s.object({
		key: s.string,
		kind: ReposEntryKind,
		dir: s.string,
		url: s.string,
		writable: s.boolean,
		archived: s.boolean,
		visibility: s.nullable(ReposVisibility),
		ci: s.boolean,
		branch: s.nullable(s.string),
		pinned: s.boolean,
		refresh: s.nullable(ReposRefreshVerdict),
		presence: ReposPresence,
		clone: s.nullable(ReposCloneVerdict),
		layout: s.nullable(ReposLayout),
		checkouts: s.array(ReposCheckout),
		branches: s.array(ReposBranchStatus),
		at_rest: s.nullable(ReposAtRest),
		stashes: Count,
		fetched_at: s.nullable(UnixSeconds),
		needs_human: s.array(ReposNeedsHuman),
		probe_error: s.nullable(ReposProbeError),
		unprobed_worktrees: s.array(ReposUnprobedWorktreeStatus),
		fetch_error: s.nullable(ReposFetchFailure),
		visibility_check: s.nullable(ReposVisibilityCheck)
	});

	const ReposRepairBlock = s.variant('kind', [
		s.object({ kind: s.literal('rewrites'), path: s.string, git_dir: s.string }),
		s.object({ kind: s.literal('claimed_dir'), git_dir: s.string }),
		s.object({ kind: s.literal('swapped'), git_dir: s.string, with: s.string }),
		s.object({ kind: s.literal('relative_gitdir'), git_dir: s.string }),
		s.object({ kind: s.literal('unreadable_gitdir'), git_dir: s.string }),
		s.object({ kind: s.literal('non_utf8_path') }),
		s.object({ kind: s.literal('nul_in_gitdir'), git_dir: s.string })
	]);
	const unregistered_clone_fields = {
		dir: s.string,
		origin: s.nullable(s.string),
		owned: s.boolean
	};

	const ReposUnregisteredClone = s.variant('kind', [
		s.object({ ...unregistered_clone_fields, kind: s.literal('clone') }),
		s.object({ ...unregistered_clone_fields, kind: s.literal('worktree') }),
		s.object({
			...unregistered_clone_fields,
			kind: s.literal('moved_worktree'),
			entry: s.string,
			blocked_by: s.nullable(ReposRepairBlock),
			exit_noise: s.nullable(s.string)
		}),
		s.object({
			...unregistered_clone_fields,
			kind: s.literal('orphaned_worktree'),
			entry: s.string
		}),
		s.object({
			...unregistered_clone_fields,
			kind: s.literal('shared_git_dir'),
			entry: s.string,
			with: s.nullable(s.string)
		}),
		s.object({ ...unregistered_clone_fields, kind: s.literal('unfinished_clone') })
	]);

	const ReposStatusReport = s.object({
		version: s.literal(REPOS_STATUS_FORMAT_VERSION),
		workspace: s.string,
		registry: s.string,
		fetched: s.boolean,
		sessions: ReposSessions,
		entries: s.array(ReposEntryStatus),
		unregistered: s.nullable(s.array(ReposUnregisteredClone))
	});
	const error_body_fields = {
		message: s.string,
		hint: s.nullable(s.string)
	};

	const ReposStatusErrorBody = s.variant('kind', [
		s.object({ ...error_body_fields, kind: s.literal('references_with_targets') }),
		s.object({ ...error_body_fields, kind: s.literal('root_not_found') }),
		s.object({ ...error_body_fields, kind: s.literal('registry_not_found') }),
		s.object({ ...error_body_fields, kind: s.literal('root_in_entry'), key: s.string }),
		s.object({ ...error_body_fields, kind: s.literal('registry_read') }),
		s.object({ ...error_body_fields, kind: s.literal('registry_parse') }),
		s.object({
			...error_body_fields,
			kind: s.literal('registry_invalid'),
			issues: s.array(ReposRegistryIssue)
		}),
		s.object({ ...error_body_fields, kind: s.literal('git_not_found') }),
		s.object({
			...error_body_fields,
			kind: s.literal('git_too_old'),
			found: s.string,
			required: s.string
		}),
		s.object({
			...error_body_fields,
			kind: s.literal('unknown_entry'),
			name: s.string,
			suggestions: s.array(s.string)
		}),
		s.object({ ...error_body_fields, kind: s.literal('io') })
	]);

	const ReposStatusErrorReport = s.object({
		version: s.literal(REPOS_STATUS_FORMAT_VERSION),
		error: ReposStatusErrorBody
	});

	const ReposStatusDocument = s.union([ReposStatusReport, ReposStatusErrorReport]);

	return {
		ReposSessionSource,
		ReposSession,
		ReposUnavailable,
		ReposSessions,
		ReposEntryKind,
		ReposVisibility,
		ReposCheckoutList,
		ReposEntryName,
		ReposRegistryIssue,
		ReposBranchHold,
		ReposRefreshHold,
		ReposCloneHold,
		ReposRefreshVerdict,
		ReposPresence,
		ReposCloneRecipe,
		ReposCloneVerdict,
		ReposSyncAction,
		ReposBranchNeedsHuman,
		ReposCleanupReason,
		ReposVerdict,
		ReposLayout,
		ReposHead,
		ReposUncommitted,
		ReposInProgressOp,
		ReposCheckout,
		ReposRelation,
		ReposBranchStatus,
		ReposAtRest,
		ReposUnprobedWhy,
		ReposGitDirHolds,
		ReposPruneLoss,
		ReposPrune,
		ReposUnprobedWorktree,
		ReposUnprobedWorktreeStatus,
		ReposOriginRemote,
		ReposOriginByHand,
		ReposOriginFix,
		ReposUnreachableCause,
		ReposRefGoneFix,
		ReposFetchFailure,
		ReposVisibilityCheck,
		ReposProbeErrorKind,
		ReposProbeError,
		ReposNeedsHuman,
		ReposEntryStatus,
		ReposRepairBlock,
		ReposUnregisteredClone,
		ReposStatusReport,
		ReposStatusErrorBody,
		ReposStatusErrorReport,
		ReposStatusDocument
	};
};
