<script lang="ts">
	// the classes the benchmarks components share, shipped with the routes that draw them
	import './docs/benchmarks/benchmarks.css';

	import { resolve } from '$app/paths';
	import { docs_slugify } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';
	import Svg from '@fuzdev/fuz_ui/Svg.svelte';
	import { logo_fuz_schema } from '@fuzdev/fuz_ui/logos.ts';

	import { format_date } from './docs/benchmarks/benchmark_format.ts';
	import { BENCHMARK_SECTION_TITLES } from './docs/benchmarks/benchmark_headline.ts';
	import { to_maintained_columns } from './docs/benchmarks/benchmark_matrix.ts';
	import BenchmarksChart from './docs/benchmarks/BenchmarksChart.svelte';
	import type { PageProps } from './$types.js';

	const { data }: PageProps = $props();

	const benchmarks = $derived(data.benchmarks);
	// the columns that are this library in another mode, which a file may have none of
	const modes = $derived(benchmarks ? to_maintained_columns(benchmarks.columns).modes : []);
</script>

<main class="px_lg pb_xl9">
	<section class="box width_atmost_md">
		<!-- the tagline sits to the right of the name, and wraps under it where they don't fit -->
		<header class="width_atmost_sm row_wrap justify-content:center gap_lg mt_xl2 mb_lg">
			<h1 class="row gap_sm mb_0">
				fuz_schema
				<Svg data={logo_fuz_schema} size="1lh" aria-hidden="true" />
			</h1>
			<p class="text-align:left">a performance-focused<br />schema library for JS</p>
		</header>
		<p>
			fuz_schema takes Valibot's approach, with a tree-shakeable function per schema, schemas as
			plain objects, <code>pipe</code> for refinement, and pushes it further on bundle size, speed,
			and memory, with simpler internals. It's published as
			<a href="https://www.npmjs.com/package/@fuzdev/fuz_schema"><code>@fuzdev/fuz_schema</code></a>
			and is pre-1.0; feedback is welcome in the
			<a href="https://github.com/fuzdev/fuz_schema/issues">issues</a> and
			<a href="https://github.com/fuzdev/fuz_schema/discussions">discussions</a>.
		</p>
		<p>
			For now this site has only benchmarks and the generated API reference docs. For usage docs,
			see the <a href="https://github.com/fuzdev/fuz_schema#readme">README</a>.
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
				{format_date(benchmarks.generated_at)}.
				{#each modes as { column, of } (column.id)}
					{column.label} is {of.label} in another mode, and not another library.
				{/each}
				Each heading links to the rows behind its figure, and
				<a href={resolve('/docs/benchmarks')}>the benchmarks page</a> says how each was measured.
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
