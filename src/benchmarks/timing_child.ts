/**
 * A process of `timing_passes.ts`: loads the rows of one job, measures them,
 * and prints one line of JSON.
 *
 * **A process holds one side.** What the job's `of` names is all that is
 * loaded, one library's rows, so nothing another library ran is in the engine's
 * feedback, its heap, or its sizing of the young generation.
 *
 * **Two modes.** `time` runs under Node's own flags and refuses the ones
 * allocation needs. `bytes` needs them. So a figure of one never comes from a
 * process set up for the other.
 *
 * **Timing.** With a prelude, every row the process holds is run before any is
 * measured. A row is then warmed for a set time and a floor of calls, through
 * the loop it is timed in, and timed for the job's duration. Its figure is the
 * whole of that time over its calls, so the collections its parses bring are in
 * it. They are not always small: what Zod's failing parse makes outlives a
 * collection of the young generation, and collecting it is around half of such a
 * row. A median of batches would leave that out, and flatter the library that
 * causes it, so it is printed beside the figure and is not the figure. Which
 * row goes first moves on by the job's offset.
 *
 * **A call is in every figure.** The loop has seen many functions, so the
 * engine inlines no row into it, and each call of a row is a real one. What
 * that costs is timed last, with a function that does nothing, and printed for
 * the smallest rows to be read against.
 *
 * Usage: `node src/benchmarks/timing_child.ts <a job as JSON>`
 *
 * @module
 */

import { pathToFileURL } from 'node:url';

import {
	has_some_allocation_node_flag,
	measure_bytes,
	require_allocation_node_flags
} from './measure.ts';
import { call, read_sink, time_slice, warm } from './timing.ts';
import {
	TIMING_BATCH_MAX,
	TIMING_BATCH_MS,
	TIMING_MIN_BATCHES,
	TIMING_PRELUDE_CALLS,
	TIMING_PRELUDE_MS,
	TIMING_WARM_CALLS,
	TIMING_WARM_SLICE_MS,
	type LoadTimingRows,
	type TimingChildOutput,
	type TimingChildRow,
	type TimingJob,
	type TimingRow
} from './timing_job.ts';

const job: TimingJob = JSON.parse(process.argv[2]!);

if (job.mode === 'bytes') {
	require_allocation_node_flags();
} else if (has_some_allocation_node_flag()) {
	console.error(
		'a timing must run under the flags a consumer has, not the ones allocation needs: ' +
			'take them off the command line and out of NODE_OPTIONS'
	);
	process.exit(1);
}

const to_rotated = <T>(list: Array<T>, by: number): Array<T> =>
	list.map((_, i) => list[(i + by) % list.length]!);

const { load_rows }: { load_rows: LoadTimingRows } = await import(pathToFileURL(job.module).href);
const rows = await load_rows(job.of);

const measured: Array<TimingRow> = job.rows
	? job.rows.map((name) => {
			const row = rows.find((r) => r.name === name);
			if (!row) throw new Error(`no row ${name}`);
			return row;
		})
	: rows;

if (job.prelude) {
	for (const { run } of to_rotated(rows, job.offset)) {
		const until = performance.now() + TIMING_PRELUDE_MS;
		for (let calls = 0; calls < TIMING_PRELUDE_CALLS || performance.now() < until; calls++) {
			call(run, 1);
		}
	}
}

const to_warm_batch = (run: () => unknown): number =>
	warm(run, {
		ms: job.warm_ms,
		min_calls: TIMING_WARM_CALLS,
		slice_ms: TIMING_WARM_SLICE_MS,
		batch_ms: TIMING_BATCH_MS,
		batch_max: TIMING_BATCH_MAX
	});

// Nanoseconds per call: `ns` over the whole of a timing, which is the figure,
// and `median_ns` in its median batch, which a collection is mostly not in.
const time = (run: () => unknown): { ns: number; median_ns: number } => {
	const batch = to_warm_batch(run);
	const samples = time_slice(run, batch, job.duration_ms, TIMING_MIN_BATCHES);
	let total = 0;
	for (const sample of samples) total += sample;
	samples.sort((a, b) => a - b);
	const middle = samples.length >> 1;
	const median =
		samples.length % 2 ? samples[middle]! : (samples[middle - 1]! + samples[middle]!) / 2;
	return { ns: (total / (samples.length * batch)) * 1e6, median_ns: (median / batch) * 1e6 };
};

const results: Map<string, TimingChildRow> = new Map();
for (const { name, run } of to_rotated(measured, job.offset)) {
	if (job.mode === 'time') {
		results.set(name, { name, ...time(run) });
	} else {
		to_warm_batch(run);
		results.set(name, { name, bytes: measure_bytes(run) });
	}
}

const output: TimingChildOutput = {
	rows: measured.map((row) => results.get(row.name)!),
	call_ns: job.mode === 'time' ? time(() => job).ns : undefined,
	sink: read_sink()
};
process.stdout.write(JSON.stringify(output) + '\n', (error) => process.exit(error ? 1 : 0));
