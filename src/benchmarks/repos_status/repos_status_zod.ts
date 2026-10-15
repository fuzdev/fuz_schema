/**
 * fuz_repos's mirror of what its `repos status --json` prints, as it writes it
 * for zod: a report of every registered repo's state, or an error. A snapshot,
 * taken from https://github.com/fuzdev/fuz_repos at 07436b1bc167
 * (`src/lib/repos_status.ts`), 0BSD licensed, copyright fuz.dev. What is left
 * out is what doesn't validate: its comments, its type exports, and the
 * `.meta()` descriptions. What it accepts is what the zod installed here
 * accepts, which need not be the consumer's.
 *
 * `repos_status_fuz_schema.ts` is the same schemas in this library, and
 * `src/test/harvest.test.ts` holds the two to the same answers.
 *
 * @module
 */

import { z } from 'zod';

export const REPOS_STATUS_FORMAT_VERSION = 19;
const Count = z.number().int().nonnegative();
const UnixSeconds = z.number().int().nonnegative();

export const ReposSessionSource = z.enum(['session_file', 'roster_worker']);

export const ReposSession = z.strictObject({
	pid: Count,
	cwd: z.string(),
	worktree: z.string().nullable(),
	process_cwd: z.string().nullable(),
	source: ReposSessionSource
});

export const ReposUnavailable = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('home_unknown') }),
	z.strictObject({ kind: z.literal('relative_config_dir'), path: z.string() }),
	z.strictObject({ kind: z.literal('unreadable'), path: z.string(), error: z.string() }),
	z.strictObject({ kind: z.literal('unparseable'), path: z.string(), error: z.string() }),
	z.strictObject({
		kind: z.literal('foreign_pid_domain'),
		path: z.string(),
		pid_domain: z.string(),
		source: ReposSessionSource
	})
]);

export const ReposSessions = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('available'), unscoped: z.array(ReposSession) }),
	z.strictObject({ kind: z.literal('unavailable'), reason: ReposUnavailable })
]);

export const ReposEntryKind = z.enum(['repo', 'reference']);

export const ReposVisibility = z.enum(['public', 'private']);

export const ReposCheckoutList = z.enum(['requires', 'consults']);

export const ReposEntryName = z.strictObject({ kind: ReposEntryKind, key: z.string() });

export const ReposRegistryIssue = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('repo_not_owned'), key: z.string(), account: z.string() }),
	z.strictObject({ kind: z.literal('fork_not_owned'), key: z.string() }),
	z.strictObject({ kind: z.literal('dir_not_a_name'), entry: ReposEntryName, dir: z.string() }),
	z.strictObject({
		kind: z.literal('dir_claimed_twice'),
		dir: z.string(),
		first: ReposEntryName,
		second: ReposEntryName
	}),
	z.strictObject({ kind: z.literal('key_in_both'), key: z.string() }),
	z.strictObject({ kind: z.literal('key_is_other_dir'), key: z.string(), entry: ReposEntryName }),
	z.strictObject({
		kind: z.literal('unknown_checkout_ref'),
		key: z.string(),
		field: ReposCheckoutList,
		target: z.string()
	}),
	z.strictObject({ kind: z.literal('self_ref'), key: z.string(), field: ReposCheckoutList }),
	z.strictObject({ kind: z.literal('requires_and_consults'), key: z.string(), target: z.string() })
]);

export const ReposBranchHold = z.enum([
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

export const ReposRefreshHold = z.enum(['pinned', 'entry', 'origin_not_https']);

export const ReposCloneHold = z.enum(['entry', 'busy', 'unprobed_worktree']);

export const ReposRefreshVerdict = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('act') }),
	z.strictObject({ kind: z.literal('held'), by: ReposRefreshHold })
]);

export const ReposPresence = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('present') }),
	z.strictObject({ kind: z.literal('missing') }),
	z.strictObject({ kind: z.literal('not_a_repo') })
]);

export const ReposCloneRecipe = z.strictObject({
	url: z.string(),
	branch: z.string().nullable(),
	shallow: z.boolean(),
	sparse: z.string().nullable()
});

export const ReposCloneVerdict = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('act'), recipe: ReposCloneRecipe }),
	z.strictObject({ kind: z.literal('held'), recipe: ReposCloneRecipe, by: ReposCloneHold })
]);

export const ReposSyncAction = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('push'), commits: Count }),
	z.strictObject({ kind: z.literal('fast_forward'), commits: Count }),
	z.strictObject({ kind: z.literal('move') }),
	z.strictObject({ kind: z.literal('rebase'), ahead: Count, behind: Count })
]);

export const ReposBranchNeedsHuman = z.enum([
	'diverged',
	'diverged_published',
	'diverged_merge',
	'diverged_tagged',
	'unmapped',
	'archived_ahead',
	'shallow_local_work',
	'upstream_not_a_branch'
]);

export const ReposCleanupReason = z.enum(['merged', 'upstream_gone']);

export const ReposVerdict = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('quiet') }),
	z.strictObject({ kind: z.literal('act'), action: ReposSyncAction }),
	z.strictObject({ kind: z.literal('held'), action: ReposSyncAction, by: ReposBranchHold }),
	z.strictObject({ kind: z.literal('needs_human'), reason: ReposBranchNeedsHuman }),
	z.strictObject({ kind: z.literal('local_only') }),
	z.strictObject({
		kind: z.literal('cleanup'),
		reason: ReposCleanupReason,
		removable_worktree: z.string().nullable()
	})
]);

export const ReposLayout = z.strictObject({
	shallow: z.boolean(),
	sparse: z.boolean(),
	partial_filter: z.string().nullable()
});

export const ReposHead = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('branch'), name: z.string() }),
	z.strictObject({ kind: z.literal('detached'), commit: z.string() })
]);

export const ReposUncommitted = z.strictObject({
	staged: Count,
	unstaged: Count,
	untracked: Count,
	conflicted: Count
});

export const ReposInProgressOp = z.enum([
	'rebase',
	'merge',
	'cherry_pick',
	'revert',
	'bisect',
	'sequencer',
	'am'
]);

export const ReposCheckout = z.strictObject({
	path: z.string(),
	primary: z.boolean(),
	head: ReposHead,
	uncommitted: ReposUncommitted,
	in_progress: ReposInProgressOp.nullable(),
	locked: z.boolean(),
	linked: z.boolean(),
	submodules: z.boolean().nullable(),
	busy: z.array(ReposSession)
});

export const ReposRelation = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('in_sync') }),
	z.strictObject({ kind: z.literal('ahead'), commits: Count }),
	z.strictObject({ kind: z.literal('behind'), commits: Count }),
	z.strictObject({ kind: z.literal('diverged'), ahead: Count, behind: Count }),
	z.strictObject({ kind: z.literal('shallow') }),
	z.strictObject({ kind: z.literal('gone') }),
	z.strictObject({ kind: z.literal('unmapped') }),
	z.strictObject({ kind: z.literal('untracked') })
]);

export const ReposBranchStatus = z.strictObject({
	name: z.string(),
	upstream: z.string().nullable(),
	worktree: z.string().nullable(),
	symref: z.string().nullable(),
	unique_commits: Count,
	newest_commit_at: UnixSeconds,
	relation: ReposRelation,
	verdict: ReposVerdict
});

export const ReposAtRest = z.strictObject({
	on_branch: z.boolean().nullable(),
	clean: z.boolean(),
	idle: z.boolean(),
	followed: ReposRelation.nullable()
});

export const ReposUnprobedWhy = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('prunable') }),
	z.strictObject({ kind: z.literal('missing') }),
	z.strictObject({ kind: z.literal('failed'), error: z.string() })
]);

export const ReposGitDirHolds = z.strictObject({
	submodules: z.boolean(),
	worktree_refs: z.boolean(),
	staged: z.boolean().nullable()
});

export const ReposPruneLoss = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('operation'), op: ReposInProgressOp }),
	z.strictObject({ kind: z.literal('detached_head') }),
	z.strictObject({ kind: z.literal('unknown_head') }),
	z.strictObject({ kind: z.literal('missing_branch'), name: z.string() }),
	z.strictObject({ kind: z.literal('submodules') }),
	z.strictObject({ kind: z.literal('worktree_refs') }),
	z.strictObject({ kind: z.literal('staged_changes') }),
	z.strictObject({ kind: z.literal('unmatched_git_dir') }),
	z.strictObject({ kind: z.literal('relative_gitdir'), git_dir: z.string() })
]);

export const ReposPrune = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('safe') }),
	z.strictObject({ kind: z.literal('loses'), losses: z.array(ReposPruneLoss) }),
	z.strictObject({ kind: z.literal('moved'), to: z.array(z.string()) })
]);

export const ReposUnprobedWorktree = z.strictObject({
	path: z.string(),
	git_dir: z.string().nullable(),
	head: ReposHead.nullable(),
	locked: z.boolean(),
	in_progress: ReposInProgressOp.nullable(),
	why: ReposUnprobedWhy,
	holds: ReposGitDirHolds.nullable()
});

export const ReposUnprobedWorktreeStatus = ReposUnprobedWorktree.extend({
	prune: ReposPrune.nullable(),
	busy: z.array(ReposSession)
});

export const ReposOriginRemote = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('url'), url: z.string() }),
	z.strictObject({ kind: z.literal('no_url') }),
	z.strictObject({ kind: z.literal('missing') })
]);

export const ReposOriginByHand = z.enum([
	'outside_repo_file',
	'valueless_url',
	'empty_value',
	'several_urls'
]);

export const ReposOriginFix = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('add') }),
	z.strictObject({ kind: z.literal('set_url') }),
	z.strictObject({ kind: z.literal('by_hand'), reason: ReposOriginByHand })
]);

export const ReposUnreachableCause = z.enum(['dns', 'connection', 'host_key', 'auth']);

export const ReposRefGoneFix = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('unset_refspec'), pattern: z.string() }),
	z.strictObject({ kind: z.literal('set_branches'), branch: z.string().nullable() }),
	z.strictObject({ kind: z.literal('by_hand') })
]);

export const ReposFetchFailure = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('ref_gone'), refname: z.string(), fix: ReposRefGoneFix }),
	z.strictObject({
		kind: z.literal('unreachable'),
		cause: ReposUnreachableCause,
		message: z.string()
	}),
	z.strictObject({ kind: z.literal('repo_not_found'), message: z.string() }),
	z.strictObject({
		kind: z.literal('timed_out'),
		after_secs: Count
	}),
	z.strictObject({ kind: z.literal('failed'), message: z.string() }),
	z.strictObject({ kind: z.literal('refspec_outside_origin'), refspec: z.string() }),
	z.strictObject({
		kind: z.literal('origin_refs_shared'),
		remote: z.string(),
		refspec: z.string()
	}),
	z.strictObject({ kind: z.literal('legacy_remotes_unreadable'), path: z.string() })
]);

export const ReposVisibilityCheck = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('leak') }),
	z.strictObject({ kind: z.literal('private') }),
	z.strictObject({ kind: z.literal('unknown'), failure: ReposFetchFailure })
]);

export const ReposProbeErrorKind = z.enum([
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

export const ReposProbeError = z.strictObject({
	kind: ReposProbeErrorKind,
	message: z.string()
});

export const ReposNeedsHuman = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('not_a_repo'), detail: z.string() }),
	z.strictObject({
		kind: z.literal('operation_in_progress'),
		checkout: z.string(),
		op: ReposInProgressOp
	}),
	z.strictObject({
		kind: z.literal('origin_mismatch'),
		origin: ReposOriginRemote,
		expected: z.string(),
		fix: ReposOriginFix
	}),
	z.strictObject({
		kind: z.literal('origin_not_https'),
		fetch_url: z.string(),
		expected: z.string(),
		fix: ReposOriginFix.nullable()
	}),
	z.strictObject({
		kind: z.literal('fetch_url_mismatch'),
		fetch_url: z.string(),
		expected: z.string(),
		fix: ReposOriginFix.nullable()
	}),
	z.strictObject({ kind: z.literal('worktree_unreadable'), path: z.string() }),
	z.strictObject({ kind: z.literal('default_branch_missing'), branch: z.string() }),
	z.strictObject({ kind: z.literal('default_branch_no_upstream'), branch: z.string() }),
	z.strictObject({ kind: z.literal('default_branch_gone'), branch: z.string() }),
	z.strictObject({ kind: z.literal('unexpected_detached'), checkout: z.string() }),
	z.strictObject({
		kind: z.literal('checkout_unresolvable'),
		checkout: z.string(),
		path: z.string(),
		error: z.string()
	}),
	z.strictObject({
		kind: z.literal('unlisted_git_dir'),
		git_dir: z.string(),
		head: ReposHead.nullable(),
		busy: z.array(ReposSession)
	}),
	z.strictObject({
		kind: z.literal('push_url_mismatch'),
		push_urls: z.array(z.string()),
		expected: z.string()
	}),
	z.strictObject({ kind: z.literal('clone_shares_repo'), with: z.string() }),
	z.strictObject({ kind: z.literal('cloned_unregistered'), dir: z.string() })
]);

export const ReposEntryStatus = z.strictObject({
	key: z.string(),
	kind: ReposEntryKind,
	dir: z.string(),
	url: z.string(),
	writable: z.boolean(),
	archived: z.boolean(),
	visibility: ReposVisibility.nullable(),
	ci: z.boolean(),
	branch: z.string().nullable(),
	pinned: z.boolean(),
	refresh: ReposRefreshVerdict.nullable(),
	presence: ReposPresence,
	clone: ReposCloneVerdict.nullable(),
	layout: ReposLayout.nullable(),
	checkouts: z.array(ReposCheckout),
	branches: z.array(ReposBranchStatus),
	at_rest: ReposAtRest.nullable(),
	stashes: Count,
	fetched_at: UnixSeconds.nullable(),
	needs_human: z.array(ReposNeedsHuman),
	probe_error: ReposProbeError.nullable(),
	unprobed_worktrees: z.array(ReposUnprobedWorktreeStatus),
	fetch_error: ReposFetchFailure.nullable(),
	visibility_check: ReposVisibilityCheck.nullable()
});

export const ReposRepairBlock = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('rewrites'), path: z.string(), git_dir: z.string() }),
	z.strictObject({ kind: z.literal('claimed_dir'), git_dir: z.string() }),
	z.strictObject({ kind: z.literal('swapped'), git_dir: z.string(), with: z.string() }),
	z.strictObject({ kind: z.literal('relative_gitdir'), git_dir: z.string() }),
	z.strictObject({ kind: z.literal('unreadable_gitdir'), git_dir: z.string() }),
	z.strictObject({ kind: z.literal('non_utf8_path') }),
	z.strictObject({ kind: z.literal('nul_in_gitdir'), git_dir: z.string() })
]);
const unregistered_clone_fields = {
	dir: z.string(),
	origin: z.string().nullable(),
	owned: z.boolean()
};

export const ReposUnregisteredClone = z.discriminatedUnion('kind', [
	z.strictObject({ ...unregistered_clone_fields, kind: z.literal('clone') }),
	z.strictObject({ ...unregistered_clone_fields, kind: z.literal('worktree') }),
	z.strictObject({
		...unregistered_clone_fields,
		kind: z.literal('moved_worktree'),
		entry: z.string(),
		blocked_by: ReposRepairBlock.nullable(),
		exit_noise: z.string().nullable()
	}),
	z.strictObject({
		...unregistered_clone_fields,
		kind: z.literal('orphaned_worktree'),
		entry: z.string()
	}),
	z.strictObject({
		...unregistered_clone_fields,
		kind: z.literal('shared_git_dir'),
		entry: z.string(),
		with: z.string().nullable()
	}),
	z.strictObject({ ...unregistered_clone_fields, kind: z.literal('unfinished_clone') })
]);

export const ReposStatusReport = z.strictObject({
	version: z.literal(REPOS_STATUS_FORMAT_VERSION),
	workspace: z.string(),
	registry: z.string(),
	fetched: z.boolean(),
	sessions: ReposSessions,
	entries: z.array(ReposEntryStatus),
	unregistered: z.array(ReposUnregisteredClone).nullable()
});
const error_body_fields = {
	message: z.string(),
	hint: z.string().nullable()
};

export const ReposStatusErrorBody = z.discriminatedUnion('kind', [
	z.strictObject({ ...error_body_fields, kind: z.literal('references_with_targets') }),
	z.strictObject({ ...error_body_fields, kind: z.literal('root_not_found') }),
	z.strictObject({ ...error_body_fields, kind: z.literal('registry_not_found') }),
	z.strictObject({ ...error_body_fields, kind: z.literal('root_in_entry'), key: z.string() }),
	z.strictObject({ ...error_body_fields, kind: z.literal('registry_read') }),
	z.strictObject({ ...error_body_fields, kind: z.literal('registry_parse') }),
	z.strictObject({
		...error_body_fields,
		kind: z.literal('registry_invalid'),
		issues: z.array(ReposRegistryIssue)
	}),
	z.strictObject({ ...error_body_fields, kind: z.literal('git_not_found') }),
	z.strictObject({
		...error_body_fields,
		kind: z.literal('git_too_old'),
		found: z.string(),
		required: z.string()
	}),
	z.strictObject({
		...error_body_fields,
		kind: z.literal('unknown_entry'),
		name: z.string(),
		suggestions: z.array(z.string())
	}),
	z.strictObject({ ...error_body_fields, kind: z.literal('io') })
]);

export const ReposStatusErrorReport = z.strictObject({
	version: z.literal(REPOS_STATUS_FORMAT_VERSION),
	error: ReposStatusErrorBody
});

export const ReposStatusDocument = z.union([ReposStatusReport, ReposStatusErrorReport]);
