<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { format_percent, format_ratio } from './benchmark_format.ts';
	import {
		format_matrix_entry,
		format_matrix_value,
		matrix_row_baseline,
		matrix_row_entry,
		matrix_row_value,
		matrix_rows_max,
		to_matrix_ratios,
		type MatrixColumn,
		type MatrixEntry,
		type MatrixGroup,
		type MatrixRatio,
		type MatrixRow
	} from './benchmark_matrix.ts';
	import { to_ratio_color } from './benchmark_ratio.ts';
	import BenchmarksLabel from './BenchmarksLabel.svelte';
	import BenchmarksNotes from './BenchmarksNotes.svelte';

	const {
		columns,
		groups,
		heading,
		label,
		colored = true,
		bars = false,
		fold = false,
		about = [],
		children
	}: {
		/** The libraries shown, in column order. */
		columns: ReadonlyArray<MatrixColumn>;
		groups: ReadonlyArray<MatrixGroup>;
		/** The heading of the first column: what a row is. */
		heading: string;
		/** The accessible name of the table's scrolling region. */
		label: string;
		/** Whether ratios tint their cells. */
		colored?: boolean;
		/**
		 * Whether each number draws a bar beneath it, on one scale across its row,
		 * so a row's libraries compare by eye as well as by ratio.
		 */
		bars?: boolean;
		/**
		 * Whether a group with a summary row shows only that until it is opened, or
		 * a group without one only its heading. A lone group is shown open.
		 */
		fold?: boolean;
		/**
		 * The kinds of figure the table measures: what the roster says of a library's
		 * figure of any of them is printed under the table.
		 */
		about?: ReadonlyArray<string>;
		/** The caption: what the table shows. */
		children?: Snippet;
	} = $props();

	const column_ids = $derived(columns.map((column) => column.id));

	// the cell the pointer is over: its row's ratios are taken against its column, and
	// every other row keeps its own best
	let hovered: { row: string; column: string } | null = $state(null);

	// the folding groups that are open
	const opened: SvelteSet<string> = new SvelteSet();

	const count_cells = (group: MatrixGroup): number =>
		group.rows.filter((row) => row.kind === 'cell').length;

	const folds = (group: MatrixGroup): boolean =>
		fold && groups.length > 1 && count_cells(group) > 0;

	const toggle_group = (key: string): void => {
		if (!opened.delete(key)) opened.add(key);
	};

	// a hovered cell anchors its row only when its number can be ranked, so the pointer
	// over a cell with none leaves the row as it was
	const to_anchor = (row: MatrixRow): string | null =>
		hovered?.row === row.key && matrix_row_baseline(row, column_ids, hovered.column) !== null
			? hovered.column
			: null;

	const to_title = (entry: MatrixEntry): string | undefined => {
		const lines =
			entry.kind === 'value'
				? [
						...(entry.mark ? [entry.mark.title] : entry.unranked ? [entry.unranked] : []),
						...entry.details
					]
				: entry.why === null
					? []
					: [entry.why];
		return lines.join('\n') || undefined;
	};

	const format_cell_ratio = (ratio: MatrixRatio): string =>
		(ratio.level === 'spread' ? '≈' : ratio.level === 'floor' ? '~' : '') +
		format_ratio(ratio.ratio);

	const to_ratio_title = (ratio: MatrixRatio): string | undefined =>
		ratio.level === 'spread'
			? 'inside what the two numbers range over: not a difference'
			: ratio.level === 'floor'
				? 'a time here is at the call floor, so the ratio is mostly of two calls: not a difference'
				: undefined;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="benchmarks-table-scroll" tabindex="0" role="region" aria-label={label}>
	<table>
		{#if children}
			<caption>{@render children()}</caption>
		{/if}
		<thead>
			<tr>
				<th scope="col">{heading}</th>
				{#each columns as column (column.id)}
					<th scope="col" class="benchmarks-num" title={column.note}>
						<BenchmarksLabel {column} />
					</th>
				{/each}
			</tr>
		</thead>
		{#each groups as group (group.key)}
			{@const group_folds = folds(group)}
			{@const group_open = !group_folds || opened.has(group.key)}
			<!-- hovering a cell re-baselines its row on it, and leaving the group restores every
				row's own best: a pointer affordance over numbers that are all shown regardless -->
			<tbody
				onpointerover={(event) => {
					const cell = (event.target as Element).closest<HTMLElement>('[data-column]');
					const row = cell?.closest<HTMLElement>('[data-row]');
					hovered = cell && row ? { row: row.dataset.row!, column: cell.dataset.column! } : null;
				}}
				onpointerleave={() => (hovered = null)}
			>
				{#if groups.length > 1 || group.note}
					<tr class="group">
						<th scope="rowgroup" colspan={columns.length + 1}>
							{group.label}
							{#if group.note}<small>{group.note}</small>{/if}
							{#if group_folds}
								<button
									type="button"
									class="plain"
									aria-expanded={group_open}
									aria-label="{group_open ? 'hide' : 'show'} the rows of {group.label}"
									onclick={() => toggle_group(group.key)}
								>
									{group_open
										? 'hide'
										: `show ${count_cells(group)} ${count_cells(group) === 1 ? 'row' : 'rows'}`}
								</button>
							{/if}
						</th>
					</tr>
				{/if}
				{#each group.rows as row (row.key)}
					{#if group_open || row.kind === 'summary'}
						{@const anchor = to_anchor(row)}
						{@const ratios = to_matrix_ratios(row, column_ids, anchor)}
						{@const max = bars ? matrix_rows_max([row], column_ids) : 0}
						<tr class={{ summary: row.kind === 'summary' }} data-row={row.key}>
							<th scope="row">
								{row.label}
								{#if row.note}<small>{row.note}</small>{/if}
							</th>
							{#if row.empty !== null}
								<td colspan={columns.length}>{row.empty}</td>
							{:else}
								{#each columns as column (column.id)}
									{@const entry = matrix_row_entry(row, column.id)}
									{@const ratio = ratios[column.id]}
									{@const tinted = colored && ratio !== undefined && ratio.level === null}
									<td
										class={[
											'benchmarks-num',
											{
												tinted,
												'benchmarks-anchor': ratio?.baseline,
												text_70: entry.kind === 'none'
											}
										]}
										style:--ratio_color={tinted ? to_ratio_color(ratio.ratio) : undefined}
										data-column={entry.kind === 'value' ? column.id : undefined}
										title={to_title(entry)}
									>
										{#if entry.kind === 'value'}
											{format_matrix_entry(entry, row.unit)}
											{#if entry.spread !== null && entry.text === null}
												<small class="text_70">±{format_percent(entry.spread)}</small>
											{:else if entry.band !== null && row.kind === 'summary'}
												<small class="text_70">
													{format_matrix_value(entry.band.low, row.unit)} to
													{format_matrix_value(entry.band.high, row.unit)}
												</small>
											{/if}
											{#if ratio !== undefined}
												<small class="ratio" title={to_ratio_title(ratio)}>
													{format_cell_ratio(ratio)}
												</small>
											{/if}
											{#if bars && max > 0}
												<!-- repeats the number for the eye, so it is hidden from assistive tech -->
												<span class="bar" aria-hidden="true">
													{#if (matrix_row_value(row, column.id) ?? 0) > 0}
														<span
															class="bar-fill"
															style:width="{(matrix_row_value(row, column.id)! / max) * 100}%"
															style:background={column.color}
														></span>
													{/if}
												</span>
											{/if}
										{:else}
											<small>{entry.text}</small>
										{/if}
									</td>
								{/each}
							{/if}
						</tr>
					{/if}
				{/each}
			</tbody>
		{/each}
	</table>
</div>
<BenchmarksNotes {columns} {about} />

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
	th small,
	td small {
		display: block;
	}
	.group th {
		font-weight: 700;
		background-color: var(--ink_05);
	}
	.group button {
		font-size: var(--font_size_sm);
		min-height: 0;
		padding: 0 var(--space_xs);
	}
	.summary :is(th, td) {
		font-weight: 700;
	}
	.tinted {
		background-color: color-mix(in hsl, var(--ratio_color) 24%, transparent);
	}
	.ratio {
		font-weight: 700;
	}
	/* one width in every column, so a bar's length compares across the libraries */
	.bar {
		display: block;
		width: 8rem;
		max-width: 100%;
		margin-left: auto;
		height: 0.4rem;
		margin-top: var(--space_xs3);
		border-radius: var(--border_radius_xs);
		background: var(--ink_05);
	}
	.bar-fill {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: var(--border_radius_xs);
	}
</style>
