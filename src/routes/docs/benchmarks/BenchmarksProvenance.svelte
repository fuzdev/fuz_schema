<script lang="ts">
	import { site_context } from '@fuzdev/fuz_ui/site.svelte.ts';

	import type { BenchmarkResults } from '../../../benchmarks/results_schema.ts';
	import { format_commit, format_date, format_duration } from './benchmark_format.ts';
	import { format_machine_state, to_provenance_commands } from './benchmark_provenance.ts';
	import BenchmarksText from './BenchmarksText.svelte';

	const {
		results
	}: {
		results: BenchmarkResults;
	} = $props();

	const site = site_context.get();

	const meta = $derived(results.meta);
	// whether the tree had changes its commit doesn't record, as the run started or as it ended
	const unrecorded = $derived(meta.dirty || meta.dirty_end);
	const commands = $derived(to_provenance_commands(results));
</script>

<p>
	Measured on <strong>{meta.machine.name}</strong> ({meta.machine.cpu}), Node {meta.node}, V8
	{meta.v8}, on {format_date(meta.generated_at)}, at commit
	{#if site.repo_url}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href="{site.repo_url}/commit/{meta.commit}" rel="external">
			<code>{format_commit(meta.commit)}</code>
		</a>
	{:else}
		<code>{format_commit(meta.commit)}</code>
	{/if}{unrecorded
		? ', from a tree with changes the commit does not record'
		: ''}{meta.commit_end === meta.commit
		? ''
		: `, which was at ${format_commit(meta.commit_end)} as the run ended`}.
	{meta.kind === 'smoke'
		? 'It is a smoke run: every script ran as briefly as it goes, and its numbers mean nothing.'
		: meta.kind === 'fixture'
			? 'It is a fixture and no run: every number is invented.'
			: ''}
</p>
<div class="provenance font_size_sm">
	<div>
		<h3 class="mt_0 mb_sm">libraries</h3>
		<ul class="unstyled">
			{#each meta.libs as lib (lib.id)}
				<li>
					{lib.label}: <code>{lib.package}</code>
					{lib.version}{#if lib.note}. <BenchmarksText text={lib.note} />{/if}
				</li>
			{/each}
		</ul>
	</div>
	<div>
		<h3 class="mt_0 mb_sm">tools</h3>
		<ul class="unstyled">
			{#each Object.entries(meta.tools) as [name, version] (name)}
				<li><code>{name}</code> {version}</li>
			{/each}
		</ul>
	</div>
	<div>
		<h3 class="mt_0 mb_sm">the machine</h3>
		<ul class="unstyled">
			<li>as the run started: {format_machine_state(meta.machine_start)}</li>
			<li>as it ended: {format_machine_state(meta.machine_end)}</li>
			<li>the run took {format_duration(meta.duration_ms)}</li>
		</ul>
	</div>
</div>
<details>
	<summary>What each script was started with</summary>
	<ul>
		{#each commands as command (command.id)}
			<li>
				<code>{command.command}</code>, which runs <code>{command.runs}</code>, in
				{command.duration}
			</li>
		{/each}
	</ul>
</details>

<style>
	/* labels for short lists of small print, not chart headings: an `h3` by rank
	 * under the section's `h2`, at the scale the lists can carry */
	h3 {
		--font_size: var(--font_size_lg);
		font-weight: 700;
	}
	.provenance {
		display: flex;
		gap: var(--space_xl);
		flex-wrap: wrap;
		margin-bottom: var(--space_lg);
	}
</style>
