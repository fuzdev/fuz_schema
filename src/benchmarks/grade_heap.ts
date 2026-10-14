/**
 * How `grade` reads retained heap: the figure per further schema is priced,
 * beside the bytes of `grade_bytes.ts`, and the totals are reported. Kept apart
 * from `grade.ts`, which runs as it is loaded, so a test can read it.
 *
 * A figure is what each further schema of a scenario, or of one export alone,
 * holds after it has parsed once, read by `heap.ts`. It is what an app that
 * defines many schemas pays, schema by schema, for as long as it keeps them.
 * A total, the library's memory with one schema, is paid once, and is
 * reported and not priced.
 *
 * Any change, of either class, may grow any one figure by
 * `HEAP_ALLOWANCE`, and past it the user rules. Speed is not a class that
 * buys memory: a change for speed that holds more per schema says so.
 *
 * @module
 */

/**
 * What a change may grow any one figure by, in bytes per further schema,
 * read past `HEAP_JITTER`: two words of the 64-bit heap, room for a field
 * or a slot of a closure's context, and not for an object or a closure of
 * its own.
 */
export const HEAP_ALLOWANCE = 16;

/**
 * What a figure moves by with no change to what it measures, in bytes per
 * further schema: a reading repeats to within a byte, and a delta is of two.
 */
export const HEAP_JITTER = 2;

/** What a figure is of: a scenario, or a schema of one export alone. */
export type HeapFigureKind = 'scenario' | 'export';

/** One figure of the retained heap per further schema, in both versions. */
export interface HeapFigure {
	/** A scenario's name, or an export's. */
	name: string;
	kind: HeapFigureKind;
	/**
	 * `NaN` when the baseline has none, as a scenario its module lacks or an
	 * export it can't build: the figure is then compared on nothing.
	 */
	base: number;
	/** `NaN` when the graded version has none. */
	new: number;
}

/** Whether both versions have the figure, and so it is compared. */
export const is_heap_compared = (f: HeapFigure): boolean =>
	!Number.isNaN(f.base) && !Number.isNaN(f.new);

/** What a compared figure grew by, in bytes per further schema. */
export const to_heap_delta = (f: HeapFigure): number => f.new - f.base;

/** Whether a figure grew past `HEAP_JITTER`. */
export const is_heap_growth = (f: HeapFigure): boolean =>
	is_heap_compared(f) && to_heap_delta(f) > HEAP_JITTER;

/** Whether a figure grew past `HEAP_ALLOWANCE`, read past `HEAP_JITTER`. */
export const is_over_heap_allowance = (f: HeapFigure): boolean =>
	is_heap_compared(f) && to_heap_delta(f) > HEAP_ALLOWANCE + HEAP_JITTER;

/** What a change's figures read as. */
export interface HeapVerdict {
	/** `pass`, or `ask` when the user rules. */
	verdict: 'pass' | 'ask';
	/** The figures that grew, the most first. */
	grew: Array<HeapFigure>;
	/** Those over the allowance. */
	over: Array<HeapFigure>;
}

/**
 * Reads the figures of a change, of either class: one over the allowance goes
 * to the user.
 */
export const judge_heap = (figures: ReadonlyArray<HeapFigure>): HeapVerdict => {
	const grew = figures
		.filter(is_heap_growth)
		.sort((a, b) => to_heap_delta(b) - to_heap_delta(a) || (a.name < b.name ? -1 : 1));
	const over = grew.filter(is_over_heap_allowance);
	return { verdict: over.length ? 'ask' : 'pass', grew, over };
};

/** A delta with `+` on growth and none. */
export const format_heap_delta = (delta: number): string => `${delta >= 0 ? '+' : ''}${delta}`;

const HEAP_FIGURE_LABELS: Record<HeapFigureKind, string> = {
	scenario: 'scenarios',
	export: 'exports alone'
};

/**
 * Figures as `name +delta`, scenarios, then exports, each kind named where it
 * has any.
 */
export const format_heap_figures = (figures: ReadonlyArray<HeapFigure>): string =>
	(['scenario', 'export'] as const)
		.map((kind) => {
			const of_kind = figures.filter((f) => f.kind === kind);
			return of_kind.length
				? `${HEAP_FIGURE_LABELS[kind]} ` +
						of_kind.map((f) => `${f.name} ${format_heap_delta(to_heap_delta(f))}`).join(', ')
				: '';
		})
		.filter(Boolean)
		.join('; ');

/**
 * The verdict line of retained heap.
 *
 * @param verdict - what `judge_heap` read
 * @param totals_grew - the scenarios whose total grew past what a reading repeats to, reported and not priced
 */
export const format_heap_line = (
	verdict: HeapVerdict,
	totals_grew: ReadonlyArray<string>
): string => {
	const grew = verdict.grew.length
		? `grew past ±${HEAP_JITTER}: ${format_heap_figures(verdict.grew)}`
		: `none grew past ±${HEAP_JITTER}`;
	return (
		`retained heap per further schema, which may grow by up to +${HEAP_ALLOWANCE} B, read past ` +
		`±${HEAP_JITTER}, on any one figure, scenario or export, under either class: ` +
		(verdict.verdict === 'ask'
			? `ASK, ${format_heap_figures(verdict.over)} over it, the user rules; ${grew}`
			: `pass, ${grew}`) +
		`; totals retaining more: ${totals_grew.length ? totals_grew.join(', ') : 'none'}, ` +
		'reported and not priced'
	);
};
