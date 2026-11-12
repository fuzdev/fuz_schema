<script lang="ts">
	import { format_ratio } from './benchmark_format.ts';
	import type { MatrixColumn } from './benchmark_matrix.ts';
	import { to_ratio_color } from './benchmark_ratio.ts';
	import { SURVEY_ALL, type SurveySummaryRow } from './benchmark_sections.ts';
	import BenchmarksLabel from './BenchmarksLabel.svelte';

	const {
		rows,
		subject,
		others
	}: {
		rows: ReadonlyArray<SurveySummaryRow>;
		/** The library every row is of. */
		subject: MatrixColumn;
		/** The libraries it is compared with, in column order. */
		others: ReadonlyArray<MatrixColumn>;
	} = $props();
</script>

<div class="benchmarks-table-scroll">
	<table>
		<caption>
			The time of <BenchmarksLabel column={subject} /> over each other library's, as a geometric
			mean over the rows of one kind of work: under <code>1.00×</code> it is the faster of the two,
			and over it the other is. A mean marked <code>≈</code> has <code>1.00×</code> inside what its
			rows' spreads let it range over, printed under it, and names neither. Beside each mean is how
			many of the rows the other library is ahead on, by more than the two spreads together.
		</caption>
		<thead>
			<tr>
				<th scope="col">what a parse does</th>
				<th scope="col" class="benchmarks-num">rows</th>
				{#each others as other (other.id)}
					<th scope="col" class="benchmarks-num">over <BenchmarksLabel column={other} /></th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.does)}
				<tr class={{ summary: row.does === SURVEY_ALL }}>
					<th scope="row">{row.does === SURVEY_ALL ? 'every row' : row.does}</th>
					<td class="benchmarks-num">{row.rows}</td>
					{#each others as other (other.id)}
						{@const cell = row.others[other.id]}
						{#if !cell}
							<td class="benchmarks-num text_70"><small>no figure</small></td>
						{:else}
							{@const tinted = cell.ratio !== null && !cell.level}
							<td
								class={['benchmarks-num', { tinted }]}
								style:--ratio_color={tinted ? to_ratio_color(cell.ratio!) : undefined}
							>
								{cell.ratio === null
									? 'at the call floor'
									: (cell.level ? '≈' : '') + format_ratio(cell.ratio)}
								{#if cell.band !== null && cell.band.low !== cell.band.high}
									<small class="text_70">
										{format_ratio(cell.band.low)} to {format_ratio(cell.band.high)}
									</small>
								{/if}
								<small>ahead on {cell.ahead} of {cell.compared}</small>
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	table {
		width: 100%;
	}
	caption {
		text-align: left;
		margin-bottom: var(--space_xs);
	}
	tbody th {
		font-weight: inherit;
		text-align: left;
	}
	td small {
		display: block;
	}
	.summary :is(th, td) {
		font-weight: 700;
	}
	.tinted {
		background-color: color-mix(in hsl, var(--ratio_color) 24%, transparent);
	}
</style>
