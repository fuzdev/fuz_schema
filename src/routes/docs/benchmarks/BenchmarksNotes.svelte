<script lang="ts">
	import { to_column_notes, type MatrixColumn } from './benchmark_matrix.ts';
	import BenchmarksText from './BenchmarksText.svelte';

	const {
		columns,
		about
	}: {
		/** The columns of the chart or table the notes are under. */
		columns: ReadonlyArray<MatrixColumn>;
		/** The kinds of figure the chart or table measures, as the roster's notes name them. */
		about: ReadonlyArray<string>;
	} = $props();

	// what qualifies a library's figure of these kinds beside another's, said in text
	// under the figures and not only on hover: a figure of another kind of work reads
	// as a like-for-like one without it, and a note about some other figure is noise
	const noted = $derived(to_column_notes(columns, about));
</script>

{#if noted.length}
	<ul class="benchmarks-notes unstyled">
		{#each noted as { column, texts } (column.id)}
			<li>
				<small>
					<strong>{column.label}:</strong>
					{#each texts as text (text)}<BenchmarksText {text} />{' '}{/each}
				</small>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.benchmarks-notes {
		margin: var(--space_xs) 0 var(--space_md) 0;
	}
	li {
		line-height: var(--line_height_sm);
	}
</style>
