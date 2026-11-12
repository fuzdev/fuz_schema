<script lang="ts">
	import { format_ratio } from './benchmark_format.ts';
	import { to_matrix_bars, type MatrixColumn, type MatrixRow } from './benchmark_matrix.ts';
	import { to_ratio_color } from './benchmark_ratio.ts';
	import BenchmarksLabel from './BenchmarksLabel.svelte';
	import BenchmarksNotes from './BenchmarksNotes.svelte';

	const {
		columns,
		row,
		title,
		note = null,
		about = [],
		href = null
	}: {
		/** The libraries shown, in bar order. */
		columns: ReadonlyArray<MatrixColumn>;
		row: MatrixRow;
		/** What the chart measures, as a heading. */
		title: string;
		/** Under the bars, after which direction is better: the unit and what was measured. */
		note?: string | null;
		/**
		 * The kinds of figure the chart measures: what the roster says of a library's
		 * figure of any of them is printed under the bars.
		 */
		about?: ReadonlyArray<string>;
		/** Where every row behind the figure is, which the heading then links to. */
		href?: string | null;
	} = $props();

	// the column the ratios are taken against while the pointer is over its bar,
	// otherwise the best in the row, as in the tables
	let hovered: string | null = $state(null);

	const column_ids = $derived(columns.map((column) => column.id));
	const bars = $derived(to_matrix_bars(row, column_ids, hovered));
	const level = $derived(bars.some((bar) => bar.ratio?.level === 'spread'));
</script>

<figure class="bar-chart">
	<figcaption>
		<strong>
			{#if href}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a {href}>{title}</a>
			{:else}
				{title}
			{/if}
		</strong>
	</figcaption>
	{#if row.empty !== null}
		<p><small>{row.empty}</small></p>
	{:else}
		<!-- a table to assistive tech: each row is one library, its cells the name, the
			number, and the ratio; the bar only repeats the number, so it is hidden. Hovering
			a bar re-baselines the ratios on it, a pointer affordance over numbers that are
			all shown regardless -->
		<div
			class="bars"
			role="table"
			aria-label={title}
			onpointerover={(event) => {
				// one delegated listener: the bar under the pointer names its column, and one
				// without a ratio names none, so the baseline stays where it was
				const target = (event.target as Element).closest<HTMLElement>('[data-column]');
				if (target) hovered = target.dataset.column!;
			}}
			onpointerleave={() => (hovered = null)}
		>
			{#each bars as bar, i (bar.column)}
				{@const column = columns[i]!}
				<div
					class={['bar-row', { 'benchmarks-anchor': bar.ratio?.baseline, missing: !bar.has_value }]}
					role="row"
					data-column={bar.ratio === undefined ? undefined : bar.column}
				>
					<span class="bar-label" role="rowheader"><BenchmarksLabel {column} /></span>
					<div class="bar-track" aria-hidden="true">
						{#if bar.fraction > 0}
							<div
								class="bar-fill"
								style:width="{bar.fraction * 100}%"
								style:background={column.color}
							></div>
						{/if}
					</div>
					<span class="bar-value" role="cell" title={bar.why}>{bar.text}</span>
					<span
						class="bar-ratio"
						role="cell"
						style:color={bar.ratio === undefined || bar.ratio.level !== null
							? undefined
							: to_ratio_color(bar.ratio.ratio)}
					>
						{#if bar.ratio !== undefined}
							{bar.ratio.level === 'spread'
								? '≈'
								: bar.ratio.level === 'floor'
									? '~'
									: ''}{format_ratio(bar.ratio.ratio)}
						{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
	<p class="bar-notes">
		<small>
			{`${row.direction} is better${note ? ` — ${note}` : ''}`}{#if level}
				. A ratio marked <code>≈</code> is of two figures whose readings overlap: not a difference,
				and not ranked
			{/if}
		</small>
	</p>
	<BenchmarksNotes {columns} {about} />
</figure>

<style>
	.bar-chart {
		margin: 0 0 var(--space_xl4) 0;
	}
	figcaption {
		margin-bottom: var(--space_xs);
	}
	.bar-notes {
		margin: var(--space_xs) 0 0 0;
	}
	/* the chart is the grid and its rows are subgrids, so the columns size to their
	 * content; the ratio column is held at a fixed width so re-baselining shifts nothing */
	.bars {
		container: bar-chart / inline-size;
		display: grid;
		grid-template-columns:
			[label] max-content [track] minmax(0, 1fr) [value] max-content
			[ratio] 7ch;
		column-gap: var(--space_md);
	}
	.bar-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		align-items: center;
		padding: var(--space_xs) var(--space_xs) var(--space_xs) var(--space_md);
	}
	.bar-row.missing {
		opacity: 0.6;
	}
	.bar-row:global(.benchmarks-anchor) {
		background-color: var(--ink_05);
	}
	.bar-label,
	.bar-value,
	.bar-ratio {
		white-space: nowrap;
	}
	.bar-label {
		grid-column: label;
	}
	.bar-track {
		grid-column: track;
		height: 1.2rem;
		border-radius: var(--border_radius_xs);
		background: var(--ink_05);
	}
	.bar-fill {
		height: 100%;
		min-width: 2px;
		border-radius: var(--border_radius_xs);
	}
	.bar-value {
		grid-column: value;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.bar-ratio {
		grid-column: ratio;
		text-align: right;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* too narrow for a bar beside its label: the label takes a line of its own */
	@container bar-chart (max-width: 32rem) {
		.bar-label {
			grid-column: 1 / -1;
		}
	}
</style>
