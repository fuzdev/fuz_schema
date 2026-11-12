<script lang="ts">
	import type { MatrixColumn } from './benchmark_matrix.ts';

	const {
		column
	}: {
		column: Pick<MatrixColumn, 'label' | 'by_maintainer'>;
	} = $props();
</script>

{column.label}{#if column.by_maintainer}
	<small class="chip ml_sm" title="The maintainer of these benchmarks also maintains this library.">
		maintainer's
	</small>
{/if}
