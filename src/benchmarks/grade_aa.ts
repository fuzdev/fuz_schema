/**
 * Reads grades whose two versions were one file, and prints, for each line
 * rule 6 fails on and the warning reads, how its figure on the slower side
 * stood against its A/A in each grade: the evidence for or against the
 * multiplier the A/A is built with, `SUMMARY_BAND_DEVIATIONS` of
 * `grade_stats.ts`, and for the warning's rate. On two copies of one file a
 * line's figure is noise, so with the multiplier right it is slower past its
 * A/A rarely, and the more often it is, the narrower the A/A is for that line.
 *
 * It measures nothing. It reads a grade's record and jobs as `--replay` does,
 * by the rules as they are in the working tree, and only a grade whose
 * `identical` is true. Grades are put together only where they are alike in
 * what a line's A/A depends on: the same runs, instances, and cases.
 *
 * Usage: `node src/benchmarks/grade_aa.ts <dir>...`, each the directory of a
 * grade, `.gro/grade/<start>/`, or one that holds such directories, as
 * `.gro/grade/` does.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse_args, s } from './args.ts';
import { format_table } from './measure.ts';
import { load_grade, to_graded, to_summary_lines, type GradeRecord } from './grade_read.ts';

const Args = s.object({
	_: s.with_default_fn(s.array(s.string), () => [])
});

const args = parse_args(Args);
if (!args._.length) {
	console.error('give the directories of grades, or one that holds them, as `.gro/grade/`');
	process.exit(1);
}

// each grade's directory among those given: one with a record, or each below one that has one
const grade_dirs = args._.flatMap((given) => {
	const dir = resolve(given);
	if (!existsSync(dir)) {
		console.error(`there is no ${dir}`);
		process.exit(1);
	}
	if (existsSync(join(dir, 'record.json'))) return [dir];
	return readdirSync(dir)
		.map((name) => join(dir, name))
		.filter((sub) => statSync(sub).isDirectory() && existsSync(join(sub, 'record.json')));
});

// what a line's A/A depends on, which grades put together share
const to_group_key = (record: GradeRecord): string => {
	const names = createHash('sha256')
		.update(record.cases.map((c) => c.name).join('\n'))
		.digest('hex')
		.slice(0, 8);
	return (
		`${record.args.runs} ${record.args.runs === 1 ? 'run' : 'runs'}, ${record.instances} instances, ` +
		`${record.cases.length} ${record.cases.length === 1 ? 'case' : 'cases'} ` +
		`(${record.args.filter === undefined ? 'every case' : `--filter ${record.args.filter}`}, names ${names})`
	);
};

interface LineReadings {
	family: string;
	read: boolean;
	/** Each grade's figure over its A/A, both as logarithms, signed: past 1 is slower past it. */
	ratios: Array<number>;
}

// by group, then by line
const groups: Map<string, Map<string, LineReadings>> = new Map();
let read = 0;
let skipped = 0;
for (const dir of grade_dirs) {
	const loaded = load_grade((path) => {
		const file = join(dir, path);
		return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
	});
	if (!loaded.ok) {
		console.error(`${dir}: ${loaded.message}`);
		skipped++;
		continue;
	}
	if (!loaded.record.identical) continue;
	read++;
	const key = to_group_key(loaded.record);
	let lines = groups.get(key);
	if (!lines) groups.set(key, (lines = new Map()));
	const graded = to_graded(loaded.record, loaded.outputs).filter((g) => g.compared);
	for (const line of to_summary_lines(graded)) {
		let of_line = lines.get(line.name);
		if (!of_line) {
			lines.set(line.name, (of_line = { family: line.family, read: line.read, ratios: [] }));
		}
		of_line.ratios.push(line.summary.ratio / line.summary.band);
	}
}

console.log(
	`${read} of ${grade_dirs.length} grades of two copies of one file` +
		(skipped ? `, ${skipped} unreadable` : '') +
		'. Per line, its figure over its A/A in each grade, positive slower: how often it was slower past ' +
		'it, the mean, and the most. A line WARN does not read, on too few cases, is marked'
);
for (const [key, lines] of groups) {
	console.log(`\n${key}\n`);
	console.log(
		format_table([
			['line', 'family', 'grades', 'slower past', 'mean', 'most'],
			...[...lines].map(([name, { family, read: is_read, ratios }]) => [
				name,
				is_read ? family : `${family}, not read`,
				String(ratios.length),
				String(ratios.filter((r) => r > 1).length),
				(ratios.reduce((sum, r) => sum + r, 0) / ratios.length).toFixed(2),
				Math.max(...ratios).toFixed(2)
			])
		])
	);
}
