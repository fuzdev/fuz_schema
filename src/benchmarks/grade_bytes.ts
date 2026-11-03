/**
 * How `grade` reads bytes against rules 4 and 5 of `docs/grading.md`: the
 * class of each figure, the price a change of each class pays for it, and the
 * backstop against Valibot. Kept apart from `grade.ts`, which runs as it is
 * loaded, so a test can read it.
 *
 * A figure is core or opt-in. Core is what every consumer pays: the bundle of
 * the `strict_nested` scenario, and `parse` alone. Opt-in is what a consumer
 * pays who uses it: every other scenario's bundle, and each export's
 * `last in` and its `alone`. `last in` is what an export costs beside the
 * rest, so it can't see bytes added to a helper two exports share, which
 * stays for the other when one is removed. `alone` is what a consumer of the
 * one export pays over `parse`, and sees them. A change is of the speed class, by default, of the
 * correctness class, a fix of correctness or conformance, or of the security
 * class, a fix of over-acceptance, of denial of service on data-shaped input,
 * or of input leaking into issues. Speed pays for core
 * bytes with a return (rule 4) and for opt-in bytes by judgment (rule 3), so
 * here it only has its opt-in growth listed. Correctness has a price for each:
 * past it the user rules, which is not a failure. Security is priced as
 * correctness, and past the backstop the user rules too, where any other
 * class fails. A feature adds an export: core may not grow, every figure the
 * baseline has is priced as correctness, and the new export's own figures
 * are reported and not priced.
 *
 * The backstop reads the scenarios of one schema, and a scenario of many
 * schemas is reported beside it and not priced. It has pins: a scenario
 * standing over it by a ruling, held to the size it was ruled on at. A pin no
 * longer needed, or above its scenario's size, fails as stale.
 *
 * @module
 */

/** The scenario whose bundle is core: the one built from `object`, the default object schema. */
export const CORE_SCENARIO = 'strict_nested';

/** The kind of change a grade is of, by `--class`. */
export type ChangeClass = 'speed' | 'correctness' | 'security' | 'feature';

export const CHANGE_CLASSES: ReadonlyArray<ChangeClass> = [
	'speed',
	'correctness',
	'security',
	'feature'
];

/**
 * Whether a class pays the correctness price for its bytes, as every class but
 * speed does: a feature on the figures the baseline has.
 */
export const is_priced_as_correctness = (change_class: ChangeClass): boolean =>
	change_class !== 'speed';

/**
 * What a correctness change may add without a return, in gzipped bytes: to
 * core, read exactly, and to any one opt-in figure, read past `SIZE_JITTER`.
 */
export const CORRECTNESS_PRICE = { core: 4, opt_in: 50 };

/**
 * What an opt-in figure moves by with no change to what it measures: a byte
 * changed elsewhere in a bundle moves how the rest compresses. A rise this
 * size or less is not read as growth, and a price is read past it. Core is
 * read exactly, as rule 4 always was.
 */
export const SIZE_JITTER = 3;

/**
 * Every scenario of one schema has its bundle at or under this of Valibot's for
 * the same scenario. A scenario of many, `Scenario.many_schemas`, is reported
 * and not read.
 */
export const BACKSTOP_VS_VALIBOT = 0.75;

/** What a figure measures, see `SizeFigure`. */
export type SizeFigureKind = 'scenario' | 'export' | 'alone';

/** One figure of the bytes, in both versions. */
export interface SizeFigure {
	/** A scenario's name, or an export's. */
	name: string;
	/**
	 * A scenario's bundle, an export's `last in`, or an export's `alone`. The
	 * figure of `parse` is `export`, of `parse` alone.
	 */
	kind: SizeFigureKind;
	core: boolean;
	/**
	 * `NaN` when the baseline has no such export, as one added since, whose
	 * whole figure is then its growth. A scenario the baseline's scenario
	 * module lacks is compared on nothing, and is not a figure.
	 */
	base: number;
	/** `NaN` when the graded version has none, as an export removed. */
	new: number;
}

/** Whether the baseline has no such figure, as an export added since. */
export const is_new_figure = (f: SizeFigure): boolean => Number.isNaN(f.base);

/** What a figure grew by: a side that has none counts as 0. */
export const to_size_delta = (f: SizeFigure): number =>
	(Number.isNaN(f.new) ? 0 : f.new) - (Number.isNaN(f.base) ? 0 : f.base);

/**
 * Whether a figure grew: core by any byte, opt-in past `SIZE_JITTER`.
 */
export const is_size_growth = (f: SizeFigure): boolean =>
	to_size_delta(f) > (f.core ? 0 : SIZE_JITTER);

/**
 * Whether a correctness change's figure is over its price.
 */
export const is_over_correctness_price = (f: SizeFigure): boolean =>
	f.core
		? to_size_delta(f) > CORRECTNESS_PRICE.core
		: to_size_delta(f) > CORRECTNESS_PRICE.opt_in + SIZE_JITTER;

/** What a change's opt-in figures read as, against its class. */
export interface OptInVerdict {
	/** `pass`, `ask` when the user rules, or `read` when the rule is judgment. */
	verdict: 'pass' | 'ask' | 'read';
	/** The opt-in figures that grew, the most first. */
	grew: Array<SizeFigure>;
	/** Those over the correctness price, under every class but speed. */
	over: Array<SizeFigure>;
	/** Under the feature class, the figures the baseline lacks, reported and not priced. */
	added: Array<SizeFigure>;
}

const by_delta = (a: SizeFigure, b: SizeFigure): number =>
	to_size_delta(b) - to_size_delta(a) || (a.name < b.name ? -1 : 1);

/**
 * Reads the opt-in figures of a change against its class: under speed every
 * growth is for the reader to weigh by rule 3, and under correctness a figure
 * over its price goes to the user. Under feature the figures the baseline
 * lacks are set apart, and the rest are read as under correctness.
 */
export const judge_opt_in = (
	figures: ReadonlyArray<SizeFigure>,
	change_class: ChangeClass
): OptInVerdict => {
	const opt_in = figures.filter((f) => !f.core);
	const added = change_class === 'feature' ? opt_in.filter(is_new_figure) : [];
	const grew = opt_in.filter((f) => !added.includes(f) && is_size_growth(f)).sort(by_delta);
	if (change_class === 'speed') {
		return { verdict: grew.length ? 'read' : 'pass', grew, over: [], added };
	}
	const over = grew.filter(is_over_correctness_price);
	return { verdict: over.length ? 'ask' : 'pass', grew, over, added: added.toSorted(by_delta) };
};

/**
 * Reads a correctness change's core figures: over the price, the user rules.
 *
 * @returns the core figures over the price
 */
export const judge_core_correctness = (figures: ReadonlyArray<SizeFigure>): Array<SizeFigure> =>
	figures.filter((f) => f.core && is_over_correctness_price(f));

/**
 * Reads a feature's core figures: a feature brings no return, so core may not
 * grow by a byte.
 *
 * @returns the core figures that grew
 */
export const judge_core_feature = (figures: ReadonlyArray<SizeFigure>): Array<SizeFigure> =>
	figures.filter((f) => f.core && to_size_delta(f) > 0);

/** A scenario's bundle beside Valibot's. */
export interface BackstopRow {
	name: string;
	gzip: number;
	valibot: number;
}

/** A scenario that stands over the backstop by a ruling, held to the size it was ruled on at. */
export interface BackstopPin {
	/** The scenario's gzipped bytes when the ruling was made, which it may not grow past. */
	gzip: number;
	/** Why it stands over. */
	reason: string;
}

/**
 * The standing excesses over the backstop. A pinned scenario over it fails
 * only when it grows past its pin. A pin whose scenario is back at or under
 * the backstop, or that names no scenario, fails as stale, so the table holds
 * only what still stands over. So does a pin above its scenario's size, which
 * is lowered to it, so a pin never leaves room for a scenario to grow back.
 */
export const BACKSTOP_PINS: Readonly<Record<string, BackstopPin>> = {
	union: {
		gzip: 973,
		reason: 'the cap on issues, a fix of denial of service ruled on as one of security'
	}
};

/** The ratio of a scenario's bundle to Valibot's. */
export const to_vs_valibot = (row: BackstopRow): number => row.gzip / row.valibot;

/** A scenario's bundle in the graded version beside Valibot's, as `grade` measures it. */
export interface ScenarioBundleRow {
	name: string;
	new: number;
	valibot: number;
}

/**
 * The rows the backstop reads: every scenario of one schema. A scenario of
 * many, `Scenario.many_schemas`, is left out, reported beside other libraries
 * and not priced.
 *
 * @param rows - every scenario's bundle, beside Valibot's
 * @param many_schemas - the names of the scenarios of many schemas
 */
export const to_backstop_rows = (
	rows: ReadonlyArray<ScenarioBundleRow>,
	many_schemas: ReadonlyArray<string>
): Array<BackstopRow> =>
	rows
		.filter((r) => !many_schemas.includes(r.name))
		.map((r) => ({ name: r.name, gzip: r.new, valibot: r.valibot }));

/** What the backstop reads on every scenario it is given, with its pins. */
export interface BackstopVerdict {
	/** Over it and not pinned, or pinned and grown past the pin. */
	over: Array<BackstopRow>;
	/** Over it, pinned, and at or under the pin. */
	pinned: Array<BackstopRow>;
	/** Pins whose scenario is at or under the backstop, or is none of the rows: to remove. */
	stale: Array<string>;
	/** Of `pinned`, those under their pin, whose pin is stale too: to lower to the row's size. */
	lower: Array<BackstopRow>;
}

/**
 * Reads the backstop on every row given, against its pins.
 */
export const judge_backstop = (
	rows: ReadonlyArray<BackstopRow>,
	pins: Readonly<Record<string, BackstopPin>> = BACKSTOP_PINS
): BackstopVerdict => {
	const over_backstop = rows.filter((row) => to_vs_valibot(row) > BACKSTOP_VS_VALIBOT);
	const pinned = over_backstop.filter((row) => row.gzip <= (pins[row.name]?.gzip ?? -Infinity));
	return {
		over: over_backstop.filter((row) => !pinned.includes(row)),
		pinned,
		stale: Object.keys(pins).filter((name) => !over_backstop.some((row) => row.name === name)),
		lower: pinned.filter((row) => row.gzip < pins[row.name]!.gzip)
	};
};

/**
 * The verdict line of the backstop: a scenario over it fails, and under the
 * security class the user rules on it instead. A pinned scenario is named,
 * and a stale pin fails under any class, one to remove or one to lower.
 *
 * @param rows - every scenario of one schema, its bundle beside Valibot's, at least one
 * @param change_class - the class of the change
 * @param pins - the standing excesses
 */
export const format_backstop_line = (
	rows: ReadonlyArray<BackstopRow>,
	change_class: ChangeClass,
	pins: Readonly<Record<string, BackstopPin>> = BACKSTOP_PINS
): string => {
	const { over, pinned, stale, lower } = judge_backstop(rows, pins);
	const unpinned = rows.filter((r) => !pinned.includes(r));
	const most = (unpinned.length ? unpinned : rows).reduce((a, b) =>
		to_vs_valibot(b) > to_vs_valibot(a) ? b : a
	);
	const to_named = (r: BackstopRow): string =>
		`${r.name} ${to_vs_valibot(r).toFixed(3)}x` +
		(pins[r.name] ? ` at ${r.gzip}, past its pin ${pins[r.name]!.gzip}` : '');
	const named = over.map(to_named).join(', ');
	const stale_named = [
		stale.length
			? `stale ${stale.length === 1 ? 'pin' : 'pins'} ${stale.join(', ')}, ` +
					'at or under the backstop or no scenario: remove from `BACKSTOP_PINS`'
			: '',
		lower.length
			? `stale ${lower.length === 1 ? 'pin' : 'pins'} ` +
					lower
						.map((r) => `${r.name} at ${r.gzip}, under its pin ${pins[r.name]!.gzip}`)
						.join(', ') +
					': lower to the size in `BACKSTOP_PINS`'
			: ''
	]
		.filter(Boolean)
		.join('; ');
	const pinned_named = pinned.length
		? '; pinned: ' +
			pinned
				.map(
					(r) =>
						`${r.name} ${to_vs_valibot(r).toFixed(3)}x at ${r.gzip}, its pin ${pins[r.name]!.gzip}`
				)
				.join(', ')
		: '';
	const verdict =
		!over.length && !stale_named
			? `pass, the most ${pinned.length ? 'unpinned ' : ''}${most.name} ${to_vs_valibot(most).toFixed(3)}x`
			: !over.length
				? `FAIL, ${stale_named}`
				: change_class === 'security'
					? `ASK, ${named}, the user rules on a fix of security` +
						(stale_named ? `; FAIL, ${stale_named}` : '')
					: `FAIL, ${[named, stale_named].filter(Boolean).join('; ')}`;
	return `backstop, every scenario of one schema at most ${BACKSTOP_VS_VALIBOT.toFixed(2)}x valibot's: ${verdict}${pinned_named}`;
};

/** A figure as a signed delta, with `+` on growth and none. */
export const format_size_delta = (delta: number): string => `${delta >= 0 ? '+' : ''}${delta}`;

const SIZE_FIGURE_LABELS: Record<SizeFigureKind, string> = {
	scenario: 'scenarios',
	export: 'exports last in',
	alone: 'exports alone'
};

/**
 * Figures as `name +delta`, scenarios, then exports last in, then exports
 * alone, each kind named where it has any.
 */
export const format_size_figures = (figures: ReadonlyArray<SizeFigure>): string =>
	(['scenario', 'export', 'alone'] as const)
		.map((kind) => {
			const of_kind = figures.filter((f) => f.kind === kind);
			return of_kind.length
				? `${SIZE_FIGURE_LABELS[kind]} ` +
						of_kind.map((f) => `${f.name} ${format_size_delta(to_size_delta(f))}`).join(', ')
				: '';
		})
		.filter(Boolean)
		.join('; ');

/**
 * The verdict line of the opt-in bytes. The library's delta, every export in
 * one bundle, is in it reported and not priced: growth split across many
 * exports shows there and in no one figure.
 *
 * @param opt_in - what `judge_opt_in` read
 * @param change_class - the class it was read against
 * @param library_delta - what the bundle of every export grew by
 */
export const format_opt_in_line = (
	opt_in: OptInVerdict,
	change_class: ChangeClass,
	library_delta: number
): string => {
	const grew = opt_in.grew.length
		? `grew past ±${SIZE_JITTER}: ${format_size_figures(opt_in.grew)}`
		: `none grew past ±${SIZE_JITTER}`;
	const library = `; the library ${format_size_delta(library_delta)}, reported and not priced`;
	const added =
		change_class === 'feature'
			? '; new figures, reported and not priced: ' +
				(opt_in.added.length ? format_size_figures(opt_in.added) : 'none')
			: '';
	return is_priced_as_correctness(change_class)
		? `opt-in bytes, which may be up to +${CORRECTNESS_PRICE.opt_in}, read past ±${SIZE_JITTER}, ` +
				`on any one figure${change_class === 'feature' ? ' the baseline has' : ''}, last in or alone: ` +
				(opt_in.verdict === 'ask'
					? `ASK, ${format_size_figures(opt_in.over)} over it, the user rules; ${grew}`
					: `pass, ${grew}`) +
				added +
				library
		: `opt-in bytes, each to pay for itself in speed, by judgment: ${grew}${library}`;
};
