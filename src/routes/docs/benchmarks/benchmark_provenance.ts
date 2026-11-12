/**
 * Where a run came from, as the benchmarks page states it: the machine and
 * what it was doing, the versions measured, and what each script was started
 * with. Read from a results file's `meta` and its sections.
 *
 * @module
 */

import type {
	BenchmarkData,
	BenchmarkMachineState,
	BenchmarkResults
} from '../../../benchmarks/results_schema.ts';
import { format_duration } from './benchmark_format.ts';

/**
 * A machine's state on one line: the load average, the range of the CPUs'
 * clocks, and the frequency settings, leaving out what the OS didn't expose.
 */
export const format_machine_state = (state: BenchmarkMachineState): string =>
	[
		`load ${state.load.map((load) => load.toFixed(2)).join(' ')}`,
		state.cpu_mhz?.length
			? `CPUs at ${Math.round(Math.min(...state.cpu_mhz))} to ${Math.round(Math.max(...state.cpu_mhz))} MHz`
			: null,
		state.governor === undefined ? null : `${state.governor} governor`,
		state.scaling_driver === undefined ? null : `${state.scaling_driver} driver`,
		state.energy_performance_preference === undefined
			? null
			: `energy preference ${state.energy_performance_preference}`,
		state.boost === undefined ? null : `boost ${state.boost ? 'on' : 'off'}`
	]
		.filter((part) => part !== null)
		.join(', ');

/**
 * How the parse times were taken, as a sentence: the regime the file says the
 * script ran in, and how many passes of fresh processes.
 */
export const format_run_regime = (run: Pick<BenchmarkData['run'], 'regime' | 'passes'>): string =>
	(run.regime === 'alone'
		? 'Each row of each library is timed in a process of its own'
		: 'Each library is timed in a process of its own that holds every scenario, and in another for its guards') +
	`, the whole repeated in ${run.passes} ${run.passes === 1 ? 'pass' : 'passes'} of fresh processes.`;

/** One script of a run as the page lists it. */
export interface ProvenanceCommand {
	id: string;
	/** The npm script with the args the run gave it, as a reader would type it. */
	command: string;
	/** What that npm script runs, with its node flags. */
	runs: string;
	/** How long it took. */
	duration: string;
}

/**
 * The scripts a run started, in the order of the file's sections, each with
 * what it was started with and how long it took. A section the run didn't
 * measure is left out.
 */
export const to_provenance_commands = (results: BenchmarkResults): Array<ProvenanceCommand> => {
	const { meta: _, ...sections } = results;
	return Object.entries(sections).flatMap(([id, section]) =>
		section.status === 'measured'
			? [
					{
						id,
						command: `npm run ${section.script}${section.args.length ? ` -- ${section.args.join(' ')}` : ''}`,
						runs: section.command,
						duration: format_duration(section.duration_ms)
					}
				]
			: []
	);
};
