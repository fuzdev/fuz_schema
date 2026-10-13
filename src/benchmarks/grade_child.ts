/**
 * A process of `grade.ts`: loads the versions of the library it is given as
 * arms, measures cases, and prints one line of JSON.
 *
 * **An arm is a module instance of everything it runs through.** Each arm's
 * library, its case matrix (`grade_arm.ts`), and its loops (`timing.ts`) are
 * loaded under a URL of that arm's own, by a resolve hook that passes the arm's query on to
 * what an arm's modules import. Two arms given the same file are then two
 * instances, with their own functions and their own feedback, which is what
 * lets one stand as the noise reference of the other. It is checked, not
 * assumed.
 *
 * **Three regimes.** In `matrix` every case of every arm is run before any is
 * measured, so each is measured in code that has seen every schema, whichever
 * cases are measured. In `alone` the process builds and runs one case, so the
 * engine can specialize all the way down. In `apart` the arms are of one
 * version, and one of them is there to use the library: the process builds one
 * case as `alone` does, runs the program of `program.ts`, which uses every
 * kind of schema, through that arm, and then times the case in the others,
 * for a set count of rounds. What using a version does to the state a process
 * shares is then in that version's processes and in none of the other's,
 * while the functions the case is timed in have run only the case.
 *
 * **Two modes.** `time` runs under Node's own flags and refuses the ones
 * allocation needs. `bytes` needs them. So a figure of one never comes from a
 * process set up for the other.
 *
 * **Timing.** A case's arms are warmed in turns for a set time and a floor of
 * calls, then timed a round at a time, every arm once a round, in orders that
 * put each arm in every position equally often (`to_balanced_orders`). A round
 * of the same is timed first and thrown away. Which order leads moves on by a
 * case, and by a run.
 *
 * Usage: `node src/benchmarks/grade_child.ts <path to a job's JSON>`
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { Case, SchemaLib } from './cases.ts';
import {
	GRADE_APART_ROUNDS,
	GRADE_BATCH_MAX,
	GRADE_BATCH_MS,
	GRADE_BYTES_SETTLE_MS,
	GRADE_MIN_BATCHES,
	GRADE_PRELUDE_CALLS,
	GRADE_PRELUDE_MS,
	GRADE_WARM_CALLS,
	GRADE_WARM_MS,
	GRADE_WARM_SLICE_MS,
	type GradeChildCase,
	type GradeChildOutput,
	type GradeJob
} from './grade_job.ts';
import {
	has_some_allocation_node_flag,
	measure_bytes,
	median,
	require_allocation_node_flags,
	to_balanced_orders
} from './measure.ts';

type ArmModule = typeof import('./grade_arm.ts');
type LoopsModule = typeof import('./timing.ts');

interface Arm {
	id: string;
	/** The arm's own instance of the loops its cases are called and timed from. */
	loops: LoopsModule;
	/** What tells the arm's instance of the case matrix from another's. */
	instance: unknown;
	cases: Map<string, Case>;
}

const job: GradeJob = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));

if (job.mode === 'bytes') {
	require_allocation_node_flags();
} else if (has_some_allocation_node_flag()) {
	console.error(
		'a timing must run under the flags a consumer has, not the ones allocation needs: ' +
			'take them off the command line and out of NODE_OPTIONS'
	);
	process.exit(1);
}

// an arm's modules import under the arm's query, so they are that arm's alone
registerHooks({
	resolve: (specifier, context, next_resolve) => {
		const resolved = next_resolve(specifier, context);
		if (!context.parentURL) return resolved;
		const { search } = new URL(context.parentURL);
		if (
			!search.startsWith('?arm=') ||
			!resolved.url.startsWith('file:') ||
			resolved.url.includes('/node_modules/') ||
			resolved.url.includes('?')
		) {
			return resolved;
		}
		return { ...resolved, url: resolved.url + search };
	}
});

const ARM_MODULE_URL = new URL('./grade_arm.ts', import.meta.url).href;
const LOOPS_MODULE_URL = new URL('./timing.ts', import.meta.url).href;

const to_rotated = <T>(list: Array<T>, by: number): Array<T> =>
	list.map((_, i) => list[(i + by) % list.length]!);

// Which arm is loaded first moves on by a run. The first loaded can settle in
// other code than the rest on some cases, and a version always loaded in the
// same place reads that as a change.
const libs: Array<SchemaLib> = [];
const arms: Array<Arm> = [];
// the instances that only use the library, by what runs their program
const users: Array<{ instance: unknown; run_program: () => number }> = [];
for (const { id, path, graded, program } of to_rotated(job.arms, job.offset)) {
	const query = `?arm=${id}`;
	const lib: SchemaLib = await import(pathToFileURL(path).href + query);
	const module: ArmModule = await import(ARM_MODULE_URL + query);
	libs.push(lib);
	if (program) {
		users.push({
			instance: module.instance,
			run_program: () => module.run_arm_program(lib, graded)
		});
		continue;
	}
	const loops: LoopsModule = await import(LOOPS_MODULE_URL + query);
	// a graded arm that lost a group would be graded on fewer cases, so it fails:
	// only another version's arm may lack what a group needs
	const built =
		job.regime === 'matrix'
			? module.build_cases(lib, graded)
			: [module.build_case(lib, job.cases[0]!, graded)].filter((c) => c !== undefined);
	arms.push({
		id,
		loops,
		instance: module.instance,
		cases: new Map(built.map((c) => [c.name, c]))
	});
}
// two arms that shared an instance would be one arm timed against itself, and
// a program run through a timed arm's instance would be run in its functions
for (const distinct of [
	libs,
	libs.map((lib) => lib.is),
	[...arms.map((a) => a.loops.time_slice), ...users],
	[...arms, ...users].map((a) => a.instance)
]) {
	if (new Set(distinct).size !== job.arms.length) {
		throw new Error('two arms share a module instance');
	}
}
// once every schema of the timed arms is made, and before any of them runs
const program_ran = users.map((user) => user.run_program());

const subject_job = job.arms.findLast((arm) => !arm.program)!;
const subject = arms.find((arm) => arm.id === subject_job.id)!;
const names = new Set(job.cases);
const found = [...subject.cases.values()].filter((c) => names.has(c.name));
// a process that holds only another version than the graded one goes without
// what that version lacks
if (subject_job.graded && found.length !== names.size) {
	throw new Error('a case to measure is not in the matrix');
}

// The arms of each case: the graded one, and each other that has it and agrees.
// Every arm's case is called the same way here, the graded one's no more than
// the rest: an arm that runs a case once more than the others before they are
// timed can settle in other code on it.
const disagreed: Array<string> = [];
const case_arms: Map<string, Array<Arm>> = new Map();
for (const [index, c] of [...subject.cases.values()].entries()) {
	const of_case: Array<Arm> = [];
	for (const arm of to_rotated(arms, index)) {
		const own = arm.cases.get(c.name);
		if (!own) continue;
		const ok = own.ok() === own.valid;
		// and that a case through `parse` that matches takes the path it names,
		// which is asked of the graded version alone: another may copy where it doesn't
		const same = own.run() === own.input;
		const on_path = !own.valid || own.path === 'probe' || same === (own.path === 'identity');
		if (arm === subject && subject_job.graded && !(ok && on_path)) {
			throw new Error(`${c.name} expected valid=${c.valid} and path=${c.path}`);
		}
		if (ok) of_case.push(arm);
		else if (!disagreed.includes(c.name)) disagreed.push(c.name);
	}
	case_arms.set(
		c.name,
		arms.filter((arm) => of_case.includes(arm))
	);
}

const to_batch = (ms_per_call: number): number =>
	Math.max(1, Math.min(GRADE_BATCH_MAX, Math.round(GRADE_BATCH_MS / ms_per_call)));

if (job.regime === 'matrix') {
	for (const [index, c] of [...subject.cases.values()].entries()) {
		// which arm runs a case first moves on by a case, so no arm is first to every one
		for (const arm of to_rotated(case_arms.get(c.name)!, index)) {
			const { run } = arm.cases.get(c.name)!;
			const until = performance.now() + GRADE_PRELUDE_MS;
			for (let calls = 0; calls < GRADE_PRELUDE_CALLS || performance.now() < until; calls++) {
				arm.loops.call(run, 1);
			}
		}
	}
}

// Runs a case's arms in turns, through the loops they are timed in, and
// returns the batch to time them at.
const warm = (of_case: Array<Arm>, name: string): number => {
	const until = performance.now() + GRADE_WARM_MS[job.regime];
	let batch = 1;
	let calls = 0;
	do {
		let fastest = Infinity;
		for (const arm of of_case) {
			const samples = arm.loops.time_slice(arm.cases.get(name)!.run, batch, GRADE_WARM_SLICE_MS, 1);
			fastest = Math.min(fastest, median(samples) / batch);
		}
		calls += batch;
		batch = to_batch(fastest);
	} while (calls < GRADE_WARM_CALLS || performance.now() < until);
	return batch;
};

const orders_by_count: Map<number, Array<Array<number>>> = new Map();
const to_orders = (count: number): Array<Array<number>> => {
	let orders = orders_by_count.get(count);
	if (!orders) orders_by_count.set(count, (orders = to_balanced_orders(count)));
	return orders;
};

const output: GradeChildOutput = { cases: [], disagreed, sink: 0 };
if (program_ran.length) output.program_ran = Math.min(...program_ran);

// a case no arm agrees on is one the process holds only another version's arms for
const measured = found.filter((c) => case_arms.get(c.name)!.length);

for (const [index, c] of measured.entries()) {
	const of_case = case_arms.get(c.name)!;
	const runs = of_case.map((arm) => arm.cases.get(c.name)!.run);
	const orders = to_orders(of_case.length);
	const rounds = job.regime === 'apart' ? GRADE_APART_ROUNDS : orders.length;
	const lead = index + job.offset;
	const result: GradeChildCase = {
		name: c.name,
		arms: of_case.map((arm) => arm.id),
		same: Object.fromEntries(
			of_case.map((arm, i) => [arm.id, runs[i]!() === arm.cases.get(c.name)!.input])
		)
	};
	const batch = warm(to_rotated(of_case, lead), c.name);
	if (job.mode === 'time') {
		const ns: Array<Array<number>> = of_case.map(() => []);
		// from -1: the round before the first is timed and thrown away
		for (let round = -1; round < rounds; round++) {
			for (const at of orders[(lead + round + orders.length) % orders.length]!) {
				const samples = of_case[at]!.loops.time_slice(
					runs[at]!,
					batch,
					job.slice_ms,
					GRADE_MIN_BATCHES
				);
				if (round >= 0) ns[at]!.push((median(samples) / batch) * 1e6);
			}
		}
		result.ns = Object.fromEntries(of_case.map((arm, i) => [arm.id, ns[i]!]));
	} else {
		const bytes: Array<number> = of_case.map(() => NaN);
		for (const at of orders[lead % orders.length]!) {
			bytes[at] = measure_bytes(runs[at]!, GRADE_BYTES_SETTLE_MS);
		}
		result.bytes = Object.fromEntries(of_case.map((arm, i) => [arm.id, bytes[i]!]));
	}
	output.cases.push(result);
}

output.sink = arms.reduce((sum, arm) => sum + arm.loops.read_sink(), 0);
process.stdout.write(JSON.stringify(output) + '\n', (error) => process.exit(error ? 1 : 0));
