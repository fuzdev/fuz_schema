<script lang="ts">
	import { to_text_segments } from './benchmark_format.ts';

	const {
		text
	}: {
		/** Text of the results file, with its names of code between backticks. */
		text: string;
	} = $props();
</script>

{#each to_text_segments(text) as segment, i (i)}
	{#if segment.code}<code>{segment.text}</code>{:else}{segment.text}{/if}
{/each}
