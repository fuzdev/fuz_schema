<script lang="ts">
	import { to_ratio_legend } from './benchmark_ratio.ts';

	const legend = to_ratio_legend();
</script>

<!-- the key to the one color scale the tables tint their cells with -->
<figure>
	<figcaption><small>Cell tint, by ratio to the row's baseline:</small></figcaption>
	<ul class="unstyled">
		{#each legend as entry (entry.label)}
			<li style:--ratio_color={entry.color}>
				<small>
					{entry.label}{#if entry.note}<span class="text_70">, {entry.note}</span>{/if}
				</small>
			</li>
		{/each}
	</ul>
</figure>

<style>
	figure {
		margin: 0 0 var(--flow_margin, var(--space_lg));
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space_xs);
	}
	/* tinted as a table tints a cell, and edged in the color a ratio is printed in */
	li {
		padding: var(--space_xs3) var(--space_sm);
		background-color: color-mix(in hsl, var(--ratio_color) 24%, transparent);
		border-left: var(--border_width_4) var(--border_style) var(--ratio_color);
		white-space: nowrap;
	}
</style>
