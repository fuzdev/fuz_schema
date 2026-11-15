<script lang="ts">
	import { docs_slugify } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';

	import { BENCHMARK_SECTION_TITLES } from './benchmark_headline.ts';
	import { to_maintained_columns, type MatrixColumn } from './benchmark_matrix.ts';
	import BenchmarksLabel from './BenchmarksLabel.svelte';

	const {
		columns
	}: {
		/** The roster as columns, in its order. */
		columns: ReadonlyArray<MatrixColumn>;
	} = $props();

	// What the page compares with what, by the roster alone: the maintainer's library,
	// the columns that are it in another mode, and every other library. A file with no
	// such mode names none.
	const maintained = $derived(to_maintained_columns(columns));
	const compared = $derived(columns.filter((column) => !column.by_maintainer));
</script>

<p>
	This page compares
	{#each maintained.libs as column, i (column.id)}
		{i === 0 ? '' : ' and '}<BenchmarksLabel {column} />
	{/each}
	with
	{#each compared as column, i (column.id)}
		{i === 0 ? '' : i === compared.length - 1 ? ', and ' : ', '}{column.label}
	{/each}: the bytes each ships, how long a parse takes, what a fresh process pays before its first
	parse, what stays in memory, and what the types cost the compiler.
	{#each maintained.modes as { column, of } (column.id)}
		<BenchmarksLabel {column} /> is {of.label} in another mode and not another library, a column of
		its own beside it: what its figures include is under each table.
	{/each}
	The maintainer of these benchmarks also maintains
	{#each maintained.libs as column, i (column.id)}{i === 0 ? '' : ' and '}{column.label}{/each}, so
	that library is marked wherever it is named{maintained.modes.length ? ', in each mode' : ''}, and
	<a href="#{docs_slugify(BENCHMARK_SECTION_TITLES.method)}">how every number was measured</a> is
	published with the numbers.
</p>
