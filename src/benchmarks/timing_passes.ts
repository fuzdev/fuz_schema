/**
 * Timing in a process per side, for the scripts that compare libraries.
 *
 * **A unit is what one process holds**: one library's rows of something. What
 * a library takes depends on what else its process ran. Call sites two
 * libraries share have seen both, the engine sizes the young generation from
 * what was allocated lately, and one library's objects change what the next
 * one's code is compiled for. So no two units share a process.
 *
 * **A process is a draw.** The same code settles at another speed from one
 * process to the next, and stays there. So the whole of the timing is repeated,
 * a pass at a time, each unit in a fresh process every pass, and a figure is
 * the median of its passes beside how far they spread. More samples inside one
 * process would only narrow the reading of that process's draw.
 *
 * **Order favors nothing.** Which unit's process starts a pass moves on by a
 * pass, forward and backward by turns, and which row a process measures first
 * moves on with it. Timed processes run one at a time.
 *
 * **Time and bytes come from different processes.** A timing runs under Node's
 * own flags, a consumer's. Bytes need a young generation sized by flag, which
 * moves what a parse takes, so they are read in a pass of their own, whose
 * processes are not timed and run several at once.
 *
 * `timing_child.ts` is one process, `timing.ts` the loops it times with, and
 * `timing_job.ts` what it is given.
 *
 * @module
 */

import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { map_concurrent } from '@fuzdev/fuz_util/async.ts';
import { stats_median } from '@fuzdev/fuz_util/stats.ts';

import { start_child, to_child_env } from './child.ts';
import { ALLOCATION_NODE_FLAGS } from './measure.ts';
import type { TimingChildOutput, TimingJob } from './timing_job.ts';

const CHILD_PATH = fileURLToPath(new URL('./timing_child.ts', import.meta.url));

/** What one process holds and measures. */
export interface TimingUnit {
	/** Names the unit in the readings and in an error. */
	id: string;
	/** What the rows module's `load_rows` is given. */
	of: unknown;
	/** The rows to measure, every row the unit holds when left out. */
	rows?: Array<string>;
}

/** What every process of a script is run with. */
export type TimingPlan = Pick<TimingJob, 'module' | 'prelude' | 'warm_ms' | 'duration_ms'>;

/** What the passes read of one row, a reading a pass in each list. */
export interface TimingRowPasses {
	/** Nanoseconds per call, the whole of a pass's timing over its calls: what a figure is of. */
	ns: Array<number>;
	/** Nanoseconds per call in the median batch of a pass's timing. */
	median_ns: Array<number>;
}

/** By unit id, then by row name. */
export type TimingReadings = Map<string, Map<string, TimingRowPasses>>;

/**
 * The name the readings of a unit hold its empty call under: what a function
 * that does nothing takes through the loop the rows are timed in. No row has it.
 */
export const TIMING_CALL_ROW = '\0call';

/** By unit id, then by row name: heap bytes per call. */
export type BytesReadings = Map<string, Map<string, number>>;

/** How many processes that are not timed run at once. */
const UNTIMED_CONCURRENCY = Math.max(1, Math.min(6, availableParallelism() >> 1));

const run_unit = async (
	unit: TimingUnit,
	plan: TimingPlan,
	mode: TimingJob['mode'],
	offset: number
): Promise<TimingChildOutput> => {
	const job: TimingJob = { ...plan, mode, of: unit.of, rows: unit.rows, offset };
	const start = (): Promise<unknown> =>
		start_child(CHILD_PATH, {
			flags: mode === 'bytes' ? ALLOCATION_NODE_FLAGS.split(' ') : [],
			args: [JSON.stringify(job)],
			env: to_child_env(process.env),
			label: `${unit.id}, ${mode}`
		});
	// a process of bytes now and then has a collection in too many samples, so
	// it gets one more process, and a timing never does
	const output =
		mode === 'bytes'
			? await start().catch((error: unknown) => {
					console.error(`${(error as Error).message.split('\n')[0]}: once more`);
					return start();
				})
			: await start();
	return output as TimingChildOutput;
};

/**
 * The order a pass starts its units' processes in: one later each second
 * pass, and backward on the passes between, so no unit always follows another.
 *
 * @returns indexes into the units
 */
export const to_pass_order = (count: number, pass: number): Array<number> => {
	const order = Array.from({ length: count }, (_, i) => (i + (pass >> 1)) % count);
	return pass % 2 ? order.reverse() : order;
};

/**
 * Times every unit in a fresh process of its own, `passes` times over, one
 * process at a time.
 *
 * @param on_pass - called as each pass ends, with its index and how long it took in milliseconds
 */
export const time_units = async (
	units: Array<TimingUnit>,
	plan: TimingPlan,
	passes: number,
	on_pass?: (pass: number, ms: number) => void
): Promise<TimingReadings> => {
	const readings: TimingReadings = new Map(units.map((unit) => [unit.id, new Map()]));
	for (let pass = 0; pass < passes; pass++) {
		const since = performance.now();
		for (const index of to_pass_order(units.length, pass)) {
			const unit = units[index]!;
			const of_unit = readings.get(unit.id)!;
			// timed, so one process at a time and nothing beside it
			const output = await run_unit(unit, plan, 'time', pass);
			// the call's median batch is not reported: its whole fills both, and nothing reads the second
			const call_row = { name: TIMING_CALL_ROW, ns: output.call_ns, median_ns: output.call_ns };
			for (const row of [...output.rows, call_row]) {
				let of_row = of_unit.get(row.name);
				if (!of_row) of_unit.set(row.name, (of_row = { ns: [], median_ns: [] }));
				of_row.ns.push(row.ns!);
				of_row.median_ns.push(row.median_ns!);
			}
		}
		on_pass?.(pass, performance.now() - since);
	}
	return readings;
};

/**
 * Reads the heap bytes of every unit's rows, each unit in one process under
 * the flags bytes need, several processes at once.
 */
export const measure_units_bytes = async (
	units: Array<TimingUnit>,
	plan: TimingPlan
): Promise<BytesReadings> => {
	const outputs = await map_concurrent(units, UNTIMED_CONCURRENCY, (unit) =>
		run_unit(unit, plan, 'bytes', 0)
	);
	return new Map(
		units.map((unit, i) => [
			unit.id,
			new Map(outputs[i]!.rows.map((row) => [row.name, row.bytes!]))
		])
	);
};

/** A figure pooled over passes. */
export interface PooledTiming {
	/** The median of the passes. */
	median: number;
	/** Half of what the passes range over, as a share of the median, and `NaN` of one pass. */
	spread: number;
}

/**
 * Pools the readings a row's passes gave into one figure and its spread.
 *
 * @param passes - a reading a pass, at least one
 */
export const to_pooled_timing = (passes: Array<number>): PooledTiming => {
	const median = stats_median(passes);
	return {
		median,
		spread: passes.length > 1 ? (Math.max(...passes) - Math.min(...passes)) / 2 / median : NaN
	};
};

/** Formats a spread as a percentage, as `±4%`, and as `-` when there was one pass. */
export const format_spread = (spread: number): string =>
	Number.isNaN(spread) ? '-' : `±${(spread * 100).toFixed(spread < 0.0095 ? 1 : 0)}%`;
