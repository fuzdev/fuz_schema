<script lang="ts">
	// the classes the benchmarks components share, shipped with the routes that draw them
	import './docs/benchmarks/benchmarks.css';

	import { resolve } from '$app/paths';
	import { docs_slugify } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';

	import { format_date } from './docs/benchmarks/benchmark_format.ts';
	import { BENCHMARK_SECTION_TITLES } from './docs/benchmarks/benchmark_headline.ts';
	import BenchmarksChart from './docs/benchmarks/BenchmarksChart.svelte';
	import type { PageProps } from './$types.js';

	const { data }: PageProps = $props();

	const benchmarks = $derived(data.benchmarks);
</script>

<main class="px_lg pb_xl9">
	<section class="box width_atmost_sm">
		<!-- the tagline sits to the right of the name, and wraps under it where they don't fit -->
		<header class="row_wrap justify-content:center gap_lg mt_xl2 mb_lg">
			<h1>fuz_schema</h1>
			<p class="text-align:left">a performance-focused<br />schema library<br />for JS</p>
		</header>
		<p>
			Valibot's strategy pushed on bundle size, speed, and memory with simpler internals. It is
			published as <code>@fuzdev/fuz_schema</code> and is pre-1.0: its API still changes.
		</p>
		<p>
			<a href={resolve('/about')}>about</a> · <a href={resolve('/docs')}>docs</a> ·
			<a href={resolve('/docs/benchmarks')}>benchmarks</a> ·
			<a href="https://github.com/fuzdev/fuz_schema">source</a>
		</p>
	</section>
	{#if benchmarks && benchmarks.charts.length}
		<section class="width_atmost_md">
			<h2>Measured</h2>
			<p>
				Against
				{benchmarks.columns
					.filter((column) => !column.by_maintainer)
					.map((column) => column.label)
					.join(', ')}, from one run on {benchmarks.machine} on
				{format_date(benchmarks.generated_at)}. Each bar's ratio is to the least figure in its
				chart, which reads <code>1.00×</code>, and hovering a bar compares the others against it
				instead. A figure is read with what it ranges over, and two that overlap are marked
				<code>≈</code> and not ranked, the least among them too. The libraries don't all do the same
				work for a figure: under a chart is what sets a library's figure there apart from another's.
				These are summaries: each heading links to every row behind its figure, and
				<a href={resolve('/docs/benchmarks')}>the benchmarks page</a> says how each was measured and
				what it leaves out.
			</p>
			<div class="charts">
				{#each benchmarks.charts as chart (chart.row.key)}
					<BenchmarksChart
						columns={benchmarks.columns}
						row={chart.row}
						title={chart.title}
						note={chart.note}
						about={chart.about}
						href="{resolve('/docs/benchmarks')}#{docs_slugify(
							BENCHMARK_SECTION_TITLES[chart.section]
						)}"
					/>
				{/each}
			</div>
		</section>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0 auto;
	}
	/* two charts side by side where they fit, one per line where they don't */
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 36rem), 1fr));
		column-gap: var(--space_xl5);
	}
</style>
