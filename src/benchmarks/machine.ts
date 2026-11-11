/**
 * What the machine is and what it was doing, read where it can be: a timing
 * taken under load, or at another governor, reads otherwise. `grade.ts`
 * prints the machine's state at its start and its end, and every other script
 * prints `format_benchmark_header` first, so its output can be read on its own.
 *
 * Imported only by the scripts a benchmark is started from, never by a module
 * a measured process loads.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';

/** What the machine was doing, where it can be read: a timing taken under load reads wider. */
export interface MachineState {
	node: string;
	/** The load average over 1, 5, and 15 minutes. */
	load: Array<number>;
	/** Each CPU's clock in MHz, from `/proc/cpuinfo`, where there is one. */
	cpu_mhz?: Array<number>;
	/** The first CPU's frequency governor, from `/sys`, where there is one. */
	governor?: string;
	/** The first CPU's frequency driver, from `/sys`, where there is one. */
	scaling_driver?: string;
	/** The first CPU's energy-performance preference, from `/sys`, where its driver has one. */
	energy_performance_preference?: string;
	/** Whether the CPUs may boost past their base clock, from `/sys`, where it says. */
	boost?: boolean;
}

/** A file's text, trimmed, or `undefined` where it can't be read. */
export const read_text = (path: string): string | undefined => {
	try {
		return readFileSync(path, 'utf8').trim();
	} catch {
		return undefined;
	}
};

const CPUFREQ_DIR = '/sys/devices/system/cpu/cpu0/cpufreq';

/**
 * Reads what the machine is doing now: Node's version and the load average,
 * and, on Linux, each CPU's clock and the first CPU's frequency settings.
 */
export const read_machine_state = (): MachineState => {
	const state: MachineState = { node: process.version, load: loadavg() };
	const mhz = [...(read_text('/proc/cpuinfo') ?? '').matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map(
		(m) => Number(m[1])
	);
	if (mhz.length) state.cpu_mhz = mhz;
	const governor = read_text(`${CPUFREQ_DIR}/scaling_governor`);
	if (governor) state.governor = governor;
	const driver = read_text(`${CPUFREQ_DIR}/scaling_driver`);
	if (driver) state.scaling_driver = driver;
	const preference = read_text(`${CPUFREQ_DIR}/energy_performance_preference`);
	if (preference) state.energy_performance_preference = preference;
	const boost = read_text('/sys/devices/system/cpu/cpufreq/boost');
	if (boost) state.boost = boost === '1';
	return state;
};

/** The state on one line, as every script's header and `grade`'s start and end print it. */
export const format_machine_state = (state: MachineState): string =>
	`node ${state.node}, load ${state.load.map((l) => l.toFixed(2)).join(' ')}` +
	(state.cpu_mhz
		? `, cpu ${Math.round(Math.min(...state.cpu_mhz))} to ${Math.round(Math.max(...state.cpu_mhz))} MHz, ` +
			`mean ${Math.round(state.cpu_mhz.reduce((sum, m) => sum + m, 0) / state.cpu_mhz.length)}`
		: '') +
	(state.governor ? `, governor ${state.governor}` : '') +
	(state.scaling_driver ? `, driver ${state.scaling_driver}` : '') +
	(state.energy_performance_preference ? `, epp ${state.energy_performance_preference}` : '') +
	(state.boost === undefined ? '' : `, boost ${state.boost ? 'on' : 'off'}`);

/** The CPU's model, from `/proc/cpuinfo`, where there is one. */
export const read_cpu_model = (): string | undefined =>
	/^model name\s*:\s*(.+)$/m.exec(read_text('/proc/cpuinfo') ?? '')?.[1];

/**
 * The installed version of each package, from its `package.json` under
 * `node_modules`, `undefined` where it isn't installed.
 */
export const read_package_versions = (
	names: ReadonlyArray<string>
): Record<string, string | undefined> =>
	Object.fromEntries(
		names.map((name) => {
			const text = read_text(resolve('node_modules', name, 'package.json'));
			return [name, text && (JSON.parse(text) as { version?: string }).version];
		})
	);

/**
 * The lines a script prints first: Node and V8, the CPU, the installed version
 * of each package it measures or measures with, and the machine's state.
 *
 * @param packages - the comparison libraries and tools the script uses
 */
export const format_benchmark_header = (packages: ReadonlyArray<string>): string => {
	const versions = read_package_versions(packages);
	return (
		`${read_cpu_model() ?? 'an unknown cpu'}, v8 ${process.versions.v8}\n` +
		(packages.length
			? `packages: ${packages.map((name) => `${name} ${versions[name] ?? 'missing'}`).join(', ')}\n`
			: '') +
		`the machine: ${format_machine_state(read_machine_state())}`
	);
};

/** The comparison libraries, as `node_modules` names them. */
export const COMPARED_LIB_PACKAGES = ['valibot', 'zod', 'typebox', 'arktype'];
