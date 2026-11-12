import { assert, describe, test } from 'vitest';

import {
	matrix_row_entry,
	matrix_row_is_at_floor,
	matrix_row_is_complete,
	matrix_row_value,
	to_matrix_ratios,
	type MatrixGroup
} from '#routes/docs/benchmarks/benchmark_matrix.ts';
import { to_geomean } from '#routes/docs/benchmarks/benchmark_ratio.ts';
import {
	ALLOCATION_TOLERANCE,
	HEAP_FURTHER_TOLERANCE_BYTES,
	HEAP_TOTAL_TOLERANCE_BYTES,
	INTERNED_MARK,
	SURVEY_ALL,
	to_allocation_groups,
	to_coldstart_groups,
	to_creation_group,
	to_harvest_sets,
	to_heap_groups,
	to_lib_columns,
	to_run_call_floor,
	to_section_data,
	to_size_group,
	to_survey_columns,
	to_survey_groups,
	to_survey_summary,
	to_time_groups,
	to_types_group
} from '#routes/docs/benchmarks/benchmark_sections.ts';
import {
	format_machine_state,
	format_run_regime,
	to_provenance_commands
} from '#routes/docs/benchmarks/benchmark_provenance.ts';
import { parse_benchmark_results } from '../benchmarks/results_schema.ts';
import { load_fixture, to_measured } from './results_test_helpers.ts';

const LIBS = load_fixture().meta.libs.map((lib) => lib.id);

const find_row = (groups: ReadonlyArray<MatrixGroup>, key: string) => {
	const row = groups.flatMap((group) => group.rows).find((r) => r.key === key);
	assert.ok(row, `no row ${key}`);
	return row;
};

describe('columns', () => {
	test('the roster in its order, each with a color of its own and the maintainer marked', () => {
		const columns = to_lib_columns(load_fixture().meta.libs);
		assert.deepStrictEqual(
			columns.map((column) => column.id),
			LIBS
		);
		assert.strictEqual(new Set(columns.map((column) => column.color)).size, columns.length);
		assert.deepStrictEqual(
			columns.filter((column) => column.by_maintainer).map((column) => column.id),
			['fuz_schema']
		);
	});
});

describe('to_size_group', () => {
	test('leads with every scenario in one bundle, then a row a scenario, in the measure asked', () => {
		const results = load_fixture();
		const data = to_measured(results, 'bundle');
		const group = to_size_group(results, 'gzip')!;
		assert.strictEqual(group.rows[0]!.kind, 'summary');
		assert.strictEqual(matrix_row_value(group.rows[0]!, 'zod'), data.all.zod!.gzip);
		assert.strictEqual(group.rows.length, data.rows.length + 1);
		assert.strictEqual(
			matrix_row_value(to_size_group(results, 'brotli')!.rows[1]!, 'valibot'),
			data.rows[0]!.libs.valibot!.brotli
		);
		assert.strictEqual(
			matrix_row_value(to_size_group(results, 'minified')!.rows[1]!, 'valibot'),
			data.rows[0]!.libs.valibot!.minified
		);
	});

	test('a file with no bundle section gives no group', () => {
		const results = load_fixture();
		results.bundle = { status: 'skipped', reason: 'left out' };
		assert.strictEqual(to_size_group(results, 'gzip'), null);
		assert.strictEqual(to_section_data(results, 'bundle'), null);
	});
});

describe('to_time_groups', () => {
	const results = load_fixture();
	const groups = to_time_groups(results);

	test('a group for valid input, invalid input, and the guard, each led by its mean', () => {
		assert.deepStrictEqual(
			groups.map((group) => group.key),
			['time:valid', 'time:invalid', 'time:guard']
		);
		for (const group of groups) assert.strictEqual(group.rows[0]!.kind, 'summary');
	});

	test('a cell with no figure is an entry that says what it is, never a number', () => {
		const row = find_row(groups, 'time:valid:type_json');
		const entry = matrix_row_entry(row, 'zod_compiled');
		assert.ok(entry.kind === 'none');
		assert.strictEqual(entry.text, 'not compiled');
		assert.include(entry.why, 'z.compile');
		assert.strictEqual(matrix_row_value(row, 'zod_compiled'), null);
	});

	// the rows of an input the mean covers: every library has a figure, and none at the call floor
	const to_covered = (input: 'valid' | 'invalid' | 'guard') => {
		const data = to_measured(results, 'run');
		const floor = to_run_call_floor(data);
		return data.rows.filter(
			(row) =>
				row.input === input &&
				Object.values(row.libs).every((cell) => !('none' in cell) && cell.ns > floor)
		);
	};

	test('the mean covers only the scenarios every library has a figure of, and says how many', () => {
		const data = to_measured(results, 'run');
		const mean = groups[0]!.rows[0]!;
		const complete = to_covered('valid');
		const valid = data.rows.filter((row) => row.input === 'valid');
		// the fixture leaves out one row for a library with no figure, and one at the call floor
		assert.strictEqual(complete.length, valid.length - 2);
		assert.include(mean.note, `${complete.length} of ${valid.length} rows`);
		const expected = to_geomean(complete.map((row) => (row.libs.valibot as { ns: number }).ns))!;
		assert.approximately(matrix_row_value(mean, 'valibot')!, expected, 1e-9);
	});

	test("a mean's band is the mean of its rows' fastest passes to the mean of their slowest", () => {
		const mean = groups[0]!.rows[0]!;
		const complete = to_covered('valid');
		const entry = matrix_row_entry(mean, 'zod');
		assert.ok(entry.kind === 'value' && entry.band !== null);
		assert.strictEqual(entry.spread, null);
		const cells = complete.map((row) => row.libs.zod as { min_ns: number; max_ns: number });
		assert.approximately(entry.band.low, to_geomean(cells.map((cell) => cell.min_ns))!, 1e-9);
		assert.approximately(entry.band.high, to_geomean(cells.map((cell) => cell.max_ns))!, 1e-9);
		assert.isBelow(entry.band.low, entry.value);
		assert.isAbove(entry.band.high, entry.value);
	});

	test('two means whose bands overlap are level, and are not ranked', () => {
		// the fixture makes TypeBox and ArkType level as guards
		const mean = find_row(groups, 'time:guard');
		const ratios = to_matrix_ratios(mean, LIBS, null);
		assert.ok(ratios.typebox!.baseline);
		assert.strictEqual(ratios.arktype!.level, 'spread');
		assert.strictEqual(ratios.zod_compiled!.level, null);
		assert.strictEqual(ratios.fuz_schema!.level, null);
		// with every pass of a row the same, the means are exact and the same gap is a difference
		const exact = load_fixture();
		for (const row of to_measured(exact, 'run').rows) {
			for (const cell of Object.values(row.libs)) {
				if (!('none' in cell)) cell.min_ns = cell.max_ns = cell.ns;
			}
		}
		const of_exact = to_matrix_ratios(find_row(to_time_groups(exact), 'time:guard'), LIBS, null);
		assert.strictEqual(of_exact.arktype!.level, null);
	});

	test('a row carries its spread, so a gap inside it is not a difference', () => {
		// the fixture makes ArkType's guard of a flat object level with the best
		const row = find_row(groups, 'time:guard:object_flat');
		const ratios = to_matrix_ratios(row, LIBS, null);
		assert.ok(ratios.typebox!.baseline);
		assert.strictEqual(ratios.arktype!.level, 'spread');
		assert.strictEqual(ratios.fuz_schema!.level, null);
	});

	test('a row carries the call floor, and one with a time at it is marked and in no mean', () => {
		const data = to_measured(results, 'run');
		const floor = to_run_call_floor(data);
		assert.strictEqual(floor, 2 * data.call.max_ns);
		const rows = groups.flatMap((group) => group.rows).filter((row) => row.kind === 'cell');
		assert.ok(rows.every((row) => row.call_floor === floor));
		// the fixture's guard of a string is at the floor for the fastest of them
		const row = find_row(groups, 'time:guard:string');
		assert.isAtMost(matrix_row_value(row, 'typebox')!, floor);
		const ratios = to_matrix_ratios(row, LIBS, null);
		assert.strictEqual(ratios.fuz_schema!.level, 'floor');
		assert.ok(matrix_row_is_at_floor(row, LIBS));
		assert.ok(!to_covered('guard').some((r) => r.scenario === 'string'));
		// the mean is of the covered rows alone
		const mean = find_row(groups, 'time:guard');
		assert.approximately(
			matrix_row_value(mean, 'typebox')!,
			to_geomean(to_covered('guard').map((r) => (r.libs.typebox as { ns: number }).ns))!,
			1e-9
		);
	});
});

describe('to_coldstart_groups', () => {
	const results = load_fixture();
	const groups = to_coldstart_groups(results);

	test('a group for each scenario and form, summarized by the work up to a first parse', () => {
		const data = to_measured(results, 'coldstart');
		assert.strictEqual(groups.length, data.rows.length);
		for (const group of groups) {
			assert.deepStrictEqual(
				group.rows.filter((row) => row.kind === 'summary').map((row) => row.key),
				[`${group.key}:first_parse`]
			);
		}
		const { scenario, form, libs } = data.rows[0]!;
		const row = find_row(groups, `coldstart:${scenario}:${form}:first_parse`);
		assert.strictEqual(matrix_row_value(row, 'zod'), libs.zod!.stages.first_parse.work_ms);
	});

	test('an addition inside the bare band, and memory no more than bare, are not ranked', () => {
		const changed = load_fixture();
		const data = to_measured(changed, 'coldstart');
		const figures = data.rows[0]!.libs.fuz_schema!;
		figures.added_ms = data.bare.band_ms / 2;
		figures.added_rss_kb = -40;
		const { scenario, form } = data.rows[0]!;
		const of_changed = to_coldstart_groups(changed);
		const process = matrix_row_entry(
			find_row(of_changed, `coldstart:${scenario}:${form}:process`),
			'fuz_schema'
		);
		assert.ok(process.kind === 'value' && process.unranked !== null);
		assert.match(process.text!, /^under /);
		const memory = matrix_row_entry(
			find_row(of_changed, `coldstart:${scenario}:${form}:memory`),
			'fuz_schema'
		);
		assert.ok(memory.kind === 'value' && memory.unranked !== null);
		assert.strictEqual(memory.text, '≈ bare');
		// so the row has no baseline of its own: the runner-up is not called the best
		assert.deepStrictEqual(
			to_matrix_ratios(find_row(of_changed, `coldstart:${scenario}:${form}:process`), LIBS, null),
			{}
		);
	});

	test('the parses after the first and peak memory are compared by the band of their samples', () => {
		const data = to_measured(results, 'coldstart');
		const { scenario, form, libs } = data.rows[0]!;
		const later = find_row(groups, `coldstart:${scenario}:${form}:later`);
		const memory = find_row(groups, `coldstart:${scenario}:${form}:memory`);
		assert.ok(later.compared && memory.compared);
		assert.strictEqual(later.note, null);
		const of_later = matrix_row_entry(later, 'zod');
		assert.ok(of_later.kind === 'value');
		assert.approximately(
			of_later.spread!,
			libs.zod!.later_band_ms! / 2 / libs.zod!.later_ms,
			1e-12
		);
		const of_memory = matrix_row_entry(memory, 'zod');
		assert.ok(of_memory.kind === 'value');
		assert.strictEqual(of_memory.value, libs.zod!.added_rss_kb * 1024);
		assert.approximately(
			of_memory.spread!,
			libs.zod!.rss_band_kb! / 2 / libs.zod!.added_rss_kb,
			1e-12
		);
		// so two libraries inside each other's bands are level, and two apart are not
		const close = load_fixture();
		const figures = to_measured(close, 'coldstart').rows[0]!.libs;
		figures.zod_mini!.added_rss_kb = figures.zod!.added_rss_kb + 100;
		figures.zod_mini!.later_ms = figures.zod!.later_ms * 1.02;
		for (const id of ['later', 'memory']) {
			const ratios = to_matrix_ratios(
				find_row(to_coldstart_groups(close), `coldstart:${scenario}:${form}:${id}`),
				LIBS,
				'zod'
			);
			assert.strictEqual(ratios.zod_mini!.level, 'spread', id);
			assert.strictEqual(ratios.arktype!.level, null, id);
		}
	});

	test('a file with no band for them shows those two rows and compares neither', () => {
		// what a file written before the script recorded the bands holds
		const older = load_fixture();
		const { scenario, form, libs } = to_measured(older, 'coldstart').rows[0]!;
		for (const figures of Object.values(libs)) {
			delete figures.later_band_ms;
			delete figures.rss_band_kb;
		}
		// the schema takes such a file
		parse_benchmark_results(older);
		const of_older = to_coldstart_groups(older);
		for (const id of ['later', 'memory']) {
			const row = find_row(of_older, `coldstart:${scenario}:${form}:${id}`);
			assert.ok(!row.compared, id);
			assert.include(row.note, 'shown, not compared', id);
			assert.ok(
				LIBS.every((lib) => matrix_row_value(row, lib) !== null),
				id
			);
			assert.deepStrictEqual(to_matrix_ratios(row, LIBS, null), {}, id);
			assert.deepStrictEqual(to_matrix_ratios(row, LIBS, 'zod'), {}, id);
		}
		// one library without it is enough: a row is compared whole or not at all
		const partial = load_fixture();
		delete to_measured(partial, 'coldstart').rows[0]!.libs.typebox!.rss_band_kb;
		const memory = find_row(to_coldstart_groups(partial), `coldstart:${scenario}:${form}:memory`);
		assert.ok(!memory.compared);
		// and the stages, which have always had a band, are compared either way
		assert.ok(find_row(of_older, `coldstart:${scenario}:${form}:first_parse`).compared);
	});

	test('an addition to the whole process past the bare band is read against that band', () => {
		const data = to_measured(results, 'coldstart');
		const { scenario, form, libs } = data.rows[0]!;
		const process = find_row(groups, `coldstart:${scenario}:${form}:process`);
		const lib = LIBS.find((id) => libs[id]!.added_ms >= data.bare.band_ms)!;
		const entry = matrix_row_entry(process, lib);
		assert.ok(entry.kind === 'value' && entry.unranked === null);
		assert.approximately(entry.spread!, data.bare.band_ms / 2 / libs[lib]!.added_ms, 1e-9);
	});

	test('a stage carries half of its band as its spread, so a gap inside two is level', () => {
		const changed = load_fixture();
		const data = to_measured(changed, 'coldstart');
		const { scenario, form, libs } = data.rows[0]!;
		const key = `coldstart:${scenario}:${form}:first_parse`;
		const stage = libs.zod!.stages.first_parse;
		const entry = matrix_row_entry(find_row(to_coldstart_groups(changed), key), 'zod');
		assert.ok(entry.kind === 'value');
		assert.approximately(entry.spread!, stage.band_ms / 2 / stage.work_ms, 1e-9);
		// Zod Mini a little slower than Zod, inside the two bands
		libs.zod_mini!.stages.first_parse = { work_ms: stage.work_ms + 0.02, band_ms: 0.05 };
		const ratios = to_matrix_ratios(find_row(to_coldstart_groups(changed), key), LIBS, 'zod');
		assert.strictEqual(ratios.zod_mini!.level, 'spread');
		// and with no band, the same gap is a difference
		libs.zod!.stages.first_parse.band_ms = 0;
		libs.zod_mini!.stages.first_parse.band_ms = 0;
		const exact = to_matrix_ratios(find_row(to_coldstart_groups(changed), key), LIBS, 'zod');
		assert.strictEqual(exact.zod_mini!.level, null);
	});
});

describe('memory', () => {
	const results = load_fixture();

	test('allocation is a group for a valid parse, an invalid one, and building a schema', () => {
		const groups = to_allocation_groups(results);
		assert.deepStrictEqual(
			groups.map((group) => group.key),
			['allocation:valid_bytes', 'allocation:invalid_bytes', 'allocation:create_bytes']
		);
		const data = to_measured(results, 'allocations');
		assert.strictEqual(
			matrix_row_value(find_row(groups, 'allocation:invalid_bytes:list'), 'zod'),
			data.rows.find((row) => row.scenario === 'list')!.libs.zod!.invalid_bytes
		);
	});

	test('a figure of one kept definition is marked and not ranked, only where it is one', () => {
		const groups = [
			...to_allocation_groups(results),
			to_creation_group(results)!,
			...to_heap_groups(results)
		];
		for (const key of [
			'allocation:create_bytes:string',
			'creation:string',
			'heap:further:object_flat'
		]) {
			const entry = matrix_row_entry(find_row(groups, key), 'arktype');
			assert.ok(entry.kind === 'value', key);
			assert.strictEqual(entry.mark, INTERNED_MARK, key);
			assert.ok(entry.unranked !== null, key);
		}
		// a recursive scenario is not kept, and what a parse allocates never is
		for (const key of [
			'allocation:create_bytes:type_json',
			'heap:further:type_json',
			'allocation:valid_bytes:string',
			'heap:total:object_flat'
		]) {
			const entry = matrix_row_entry(find_row(groups, key), 'arktype');
			assert.ok(entry.kind === 'value' && entry.mark === null && entry.unranked === null, key);
		}
	});

	test('a figure a parse allocates is read with a percent either side, so a closer one is level', () => {
		assert.strictEqual(ALLOCATION_TOLERANCE, 0.01);
		const groups = to_allocation_groups(results);
		const row = find_row(groups, 'allocation:invalid_bytes:list');
		const entry = matrix_row_entry(row, 'zod');
		assert.ok(entry.kind === 'value' && entry.spread === null);
		assert.deepStrictEqual(entry.band, {
			low: entry.value * (1 - ALLOCATION_TOLERANCE),
			high: entry.value * (1 + ALLOCATION_TOLERANCE)
		});
		// two figures 1.5% apart are inside the two tolerances, and two 2.5% apart are not
		for (const [factor, level] of [
			[1.015, 'spread'],
			[1.025, null]
		] as const) {
			const close = load_fixture();
			for (const id of ['valid_bytes', 'invalid_bytes', 'create_bytes'] as const) {
				const libs = to_measured(close, 'allocations').rows.find(
					(r) => r.scenario === 'list'
				)!.libs;
				libs.zod_mini![id] = libs.zod![id] * factor;
				const ratios = to_matrix_ratios(
					find_row(to_allocation_groups(close), `allocation:${id}:list`),
					LIBS,
					'zod'
				);
				assert.strictEqual(ratios.zod_mini!.level, level, `${id} ${factor}`);
			}
		}
		// a zero has no band to reach another figure with, and is not ranked
		const zero = matrix_row_entry(find_row(groups, 'allocation:valid_bytes:list'), 'typebox');
		assert.ok(zero.kind === 'value' && zero.value === 0);
		assert.deepStrictEqual(zero.band, { low: 0, high: 0 });
	});

	test('a retained total is read with a kilobyte either side, and a further schema with two bytes', () => {
		assert.strictEqual(HEAP_TOTAL_TOLERANCE_BYTES, 1000);
		assert.strictEqual(HEAP_FURTHER_TOLERANCE_BYTES, 2);
		const data = to_measured(results, 'heap');
		const { scenario, libs } = data.rows[0]!;
		const groups = to_heap_groups(results);
		const total = matrix_row_entry(find_row(groups, `heap:total:${scenario}`), 'zod');
		assert.ok(total.kind === 'value' && total.spread === null);
		assert.deepStrictEqual(total.band, {
			low: libs.zod!.total_bytes - 1000,
			high: libs.zod!.total_bytes + 1000
		});
		const further = matrix_row_entry(find_row(groups, `heap:further:${scenario}`), 'zod');
		assert.ok(further.kind === 'value');
		assert.deepStrictEqual(further.band, {
			low: libs.zod!.further_schema_bytes - 2,
			high: libs.zod!.further_schema_bytes + 2
		});
		// totals under two kilobytes apart are level, and further schemas under four bytes apart
		for (const [gap_total, gap_further, level] of [
			[1900, 3, 'spread'],
			[2100, 5, null]
		] as const) {
			const close = load_fixture();
			const figures = to_measured(close, 'heap').rows[0]!.libs;
			figures.zod_mini!.total_bytes = figures.zod!.total_bytes + gap_total;
			figures.zod_mini!.further_schema_bytes = figures.zod!.further_schema_bytes + gap_further;
			const of_close = to_heap_groups(close);
			assert.strictEqual(
				to_matrix_ratios(find_row(of_close, `heap:total:${scenario}`), LIBS, 'zod').zod_mini!.level,
				level
			);
			assert.strictEqual(
				to_matrix_ratios(find_row(of_close, `heap:further:${scenario}`), LIBS, 'zod').zod_mini!
					.level,
				level
			);
		}
		// a band never starts under zero
		const small = load_fixture();
		to_measured(small, 'heap').rows[0]!.libs.zod!.further_schema_bytes = 1;
		const entry = matrix_row_entry(
			find_row(to_heap_groups(small), `heap:further:${scenario}`),
			'zod'
		);
		assert.ok(entry.kind === 'value');
		assert.deepStrictEqual(entry.band, { low: 0, high: 3 });
	});

	test('the time to build a schema is shown and not compared: it is one timing', () => {
		const group = to_creation_group(results)!;
		assert.include(group.note, 'shown, not compared');
		for (const row of group.rows) {
			assert.ok(!row.compared, row.key);
			assert.ok(
				LIBS.every((lib) => matrix_row_value(row, lib) !== null),
				row.key
			);
			assert.deepStrictEqual(to_matrix_ratios(row, LIBS, null), {}, row.key);
			assert.deepStrictEqual(to_matrix_ratios(row, LIBS, 'zod'), {}, row.key);
		}
	});

	test('retained heap is the total, with what it is made of, then each further schema', () => {
		const groups = to_heap_groups(results);
		const data = to_measured(results, 'heap');
		const figures = data.rows[0]!.libs.typebox!;
		const total = matrix_row_entry(
			find_row(groups, `heap:total:${data.rows[0]!.scenario}`),
			'typebox'
		);
		assert.ok(total.kind === 'value');
		assert.strictEqual(total.value, figures.total_bytes);
		assert.lengthOf(total.details, 3);
		assert.include(groups[1]!.note, `${data.counts.few} schemas and ${data.counts.many}`);
	});
});

describe('to_types_group', () => {
	test('instantiations are compared, and check time is shown and not', () => {
		const results = load_fixture();
		const group = to_types_group(results)!;
		const data = to_measured(results, 'types');
		assert.strictEqual(
			matrix_row_value(find_row([group], 'types:module'), 'zod'),
			data.modules.zod!.instantiations
		);
		assert.strictEqual(
			matrix_row_value(find_row([group], 'types:reads'), 'zod'),
			data.with_reads.zod!.instantiations
		);
		const check = find_row([group], 'types:check');
		assert.ok(!check.compared);
		assert.deepStrictEqual(to_matrix_ratios(check, LIBS, null), {});
	});
});

describe('the survey', () => {
	const results = load_fixture();
	const data = to_measured(results, 'survey');
	const summary = to_survey_summary(data);

	test('a row for each kind of work in the order the script summarizes them, then one over every row', () => {
		assert.deepStrictEqual(
			summary.map((row) => row.does),
			[...data.kinds, SURVEY_ALL]
		);
		// which is not the order the rows come in
		assert.notDeepEqual(data.kinds, [...new Set(data.rows.map((row) => row.does))]);
		assert.strictEqual(summary.at(-1)!.rows, data.rows.length);
		// a kind with no row is left out, and the groups of rows take the same order
		const fewer = { ...data, rows: data.rows.filter((row) => row.does !== 'lazy') };
		assert.deepStrictEqual(
			to_survey_summary(fewer).map((row) => row.does),
			[...data.kinds.filter((kind) => kind !== 'lazy'), SURVEY_ALL]
		);
		assert.deepStrictEqual(
			to_survey_groups(load_fixture()).map((group) => group.label),
			data.kinds
		);
	});

	test('a mean is read with its band, and one whose band holds 1 names neither library', () => {
		const array = summary.find((row) => row.does === 'array')!;
		const cell = array.others.zod_compiled!;
		// one row: this library's least over the other's most, to its most over the other's least
		const row = data.rows.find((r) => r.does === 'array')!;
		const ours = row.libs.fuz_schema as { ns: number; spread: number };
		const theirs = row.libs.zod_compiled as { ns: number; spread: number };
		assert.approximately(
			cell.band!.low,
			(ours.ns * (1 - ours.spread)) / (theirs.ns * (1 + theirs.spread)),
			1e-9
		);
		assert.approximately(
			cell.band!.high,
			(ours.ns * (1 + ours.spread)) / (theirs.ns * (1 - theirs.spread)),
			1e-9
		);
		assert.ok(!cell.level);
		// a mean just under 1 with spreads that reach past it is level
		const close = structuredClone(data);
		(close.rows.find((r) => r.does === 'array')!.libs.zod_compiled as { ns: number }).ns =
			ours.ns * 1.02;
		const level = to_survey_summary(close).find((r) => r.does === 'array')!.others.zod_compiled!;
		assert.isBelow(level.ratio!, 1);
		assert.ok(level.level);
		// and with one pass there is no band to hold it
		for (const r of close.rows) {
			for (const c of Object.values(r.libs)) if (!('none' in c)) c.spread = null;
		}
		const exact = to_survey_summary(close).find((r) => r.does === 'array')!.others.zod_compiled!;
		assert.ok(!exact.level);
		assert.strictEqual(exact.band!.low, exact.band!.high);
	});

	test('a row a library has no figure of is compared on fewer, and is no zero in a mean', () => {
		const all = summary.at(-1)!;
		const count = (lib: string): number =>
			data.rows.filter((row) => !('none' in row.libs[lib]!)).length;
		for (const lib of data.others) assert.strictEqual(all.others[lib]!.compared, count(lib), lib);
		assert.isBelow(all.others.zod_compiled!.compared, all.others.valibot!.compared);
		// a kind of work no row of which a library has is no cell at all
		const union = to_survey_summary({
			...data,
			rows: data.rows.filter((row) => row.shape === 'memo_union')
		})[0]!;
		assert.strictEqual(union.others.valibot, null);
	});

	test('a row at the call floor is in no mean and is never counted as ahead', () => {
		const guard = summary.find((row) => row.does === 'guard')!;
		assert.strictEqual(guard.others.valibot!.ratio, null);
		assert.strictEqual(guard.others.valibot!.compared, 1);
		assert.strictEqual(guard.others.valibot!.ahead, 0);
	});

	test('ahead is a row the other library wins by more than the two spreads together', () => {
		const array = summary.find((row) => row.does === 'array')!;
		assert.strictEqual(array.others.zod_compiled!.ahead, 1);
		assert.strictEqual(array.others.valibot!.ahead, 0);
		assert.approximately(array.others.zod_compiled!.ratio!, 1 / 0.22, 1e-9);
		// inside the spreads it is not ahead, and with one pass nothing is
		const close = structuredClone(data);
		const row = close.rows.find((r) => r.does === 'array')!;
		const subject = row.libs.fuz_schema as { ns: number; spread: number | null };
		(row.libs.zod_compiled as { ns: number }).ns = subject.ns * 0.96;
		assert.strictEqual(
			to_survey_summary(close).find((r) => r.does === 'array')!.others.zod_compiled!.ahead,
			0
		);
		for (const r of data.rows) {
			for (const cell of Object.values(r.libs)) if (!('none' in cell)) cell.spread = null;
		}
		assert.strictEqual(to_survey_summary(data).at(-1)!.others.zod_compiled!.ahead, 0);
	});

	test('the rows are grouped by what a parse does, each with the call floor, in the survey columns', () => {
		const fresh = load_fixture();
		const groups = to_survey_groups(fresh);
		const floor = to_measured(fresh, 'survey').call_floor_ns;
		assert.ok(groups.flatMap((group) => group.rows).every((row) => row.call_floor === floor));
		const missing = matrix_row_entry(find_row(groups, 'survey:number/nan'), 'zod');
		assert.ok(missing.kind === 'none');
		assert.strictEqual(missing.text, 'other verdict');
		assert.deepStrictEqual(
			to_survey_columns(fresh).map((column) => column.id),
			['fuz_schema', 'valibot', 'zod', 'zod_compiled']
		);
	});
});

describe('to_harvest_sets', () => {
	const results = load_fixture();
	const sets = to_harvest_sets(results);

	test('a set has its sides as columns, a roster library with its own color and mark', () => {
		const lib_columns = to_lib_columns(results.meta.libs);
		const [status] = sets;
		assert.deepStrictEqual(
			status!.columns.map((column) => column.id),
			['zod', 'zod_jitless', 'zod_compiled', 'fuz_schema']
		);
		const ours = status!.columns.at(-1)!;
		assert.ok(ours.by_maintainer);
		assert.strictEqual(ours.color, lib_columns.find((column) => column.id === 'fuz_schema')!.color);
		// a mode that is no library of the roster takes a color none of them has
		const jitless = status!.columns[1]!;
		assert.strictEqual(jitless.label, 'Zod jitless');
		assert.ok(!lib_columns.some((column) => column.color === jitless.color));
		// every label is the roster's, or made of one: none is the script's lowercase name
		for (const set of sets) {
			for (const column of set.columns) assert.match(column.label, /^(?:[A-Z]|fuz_schema)/);
		}
	});

	test('each group leads with a row that summarizes it, shown while the group is folded', () => {
		const [status, analysis] = sets;
		for (const set of sets) {
			for (const group of set.groups) {
				assert.strictEqual(group.rows[0]!.kind, 'summary', group.key);
				assert.lengthOf(
					group.rows.filter((row) => row.kind === 'summary'),
					1,
					group.key
				);
			}
		}
		const side_ids = status!.columns.map((column) => column.id);
		const [bundle, time, bytes] = status!.groups;
		assert.strictEqual(bundle!.rows[0]!.label, 'minified and gzipped');
		// time: the mean over the rows every side has a time of, with how many
		const rows = time!.rows.slice(1);
		const complete = rows.filter((row) => matrix_row_is_complete(row, side_ids));
		assert.strictEqual(complete.length, rows.length - 1);
		assert.include(time!.rows[0]!.note, `${complete.length} of ${rows.length} rows`);
		assert.approximately(
			matrix_row_value(time!.rows[0]!, 'zod')!,
			to_geomean(complete.map((row) => matrix_row_value(row, 'zod')!))!,
			1e-9
		);
		// a time's mean has a band from its rows' spreads, and a mean of bytes is exact
		const time_mean = matrix_row_entry(time!.rows[0]!, 'zod');
		assert.ok(time_mean.kind === 'value' && time_mean.band !== null);
		// and a mean of heap bytes the tolerance of its rows, a percent either side
		const bytes_mean = matrix_row_entry(bytes!.rows[0]!, 'zod');
		assert.ok(bytes_mean.kind === 'value' && bytes_mean.band !== null);
		assert.approximately(bytes_mean.band.low, bytes_mean.value * (1 - ALLOCATION_TOLERANCE), 1e-6);
		assert.approximately(bytes_mean.band.high, bytes_mean.value * (1 + ALLOCATION_TOLERANCE), 1e-6);
		// the bytes of a bundle are exact
		const bundle_row = matrix_row_entry(bundle!.rows[0]!, 'zod');
		assert.ok(bundle_row.kind === 'value' && bundle_row.band === null);
		assert.include(analysis!.groups[1]!.rows[0]!.note, '2 of 2 rows');
	});

	test('a set is its bundle, its times, and its bytes, with the cells that are no number', () => {
		const [status] = sets;
		assert.deepStrictEqual(
			status!.groups.map((group) => group.key),
			['harvest:status_report:bundle', 'harvest:status_report:time', 'harvest:status_report:bytes']
		);
		const bundle = matrix_row_entry(status!.groups[0]!.rows[0]!, 'zod_jitless');
		assert.ok(bundle.kind === 'none');
		for (const group of status!.groups.slice(1)) {
			const entry = matrix_row_entry(
				group.rows.find((row) => row.label === 'an error')!,
				'zod_compiled'
			);
			assert.ok(entry.kind === 'none', group.key);
			assert.strictEqual(entry.text, 'not compiled');
		}
		assert.lengthOf(status!.asides, 1);
		assert.lengthOf(sets[1]!.asides, 0);
	});
});

describe('provenance', () => {
	test('the parse times say the regime the file has, and its passes', () => {
		assert.strictEqual(
			format_run_regime({ regime: 'shared', passes: 5 }),
			'Each library is timed in a process of its own that holds every scenario, and in another for its guards, the whole repeated in 5 passes of fresh processes.'
		);
		assert.strictEqual(
			format_run_regime({ regime: 'alone', passes: 1 }),
			'Each row of each library is timed in a process of its own, the whole repeated in 1 pass of fresh processes.'
		);
	});

	test('a machine state leaves out what the OS did not expose', () => {
		const { machine_start } = load_fixture().meta;
		assert.strictEqual(
			format_machine_state(machine_start),
			'load 0.10 0.20 0.30, CPUs at 4000 to 4300 MHz, performance governor, fixture-pstate driver, energy preference performance, boost on'
		);
		assert.strictEqual(
			format_machine_state({ node: 'v24.0.0', load: [1, 2, 3] }),
			'load 1.00 2.00 3.00'
		);
		assert.include(format_machine_state({ ...machine_start, boost: false }), 'boost off');
	});

	test('the commands are the measured sections, each as a reader would type it', () => {
		const results = load_fixture();
		results.wasm = { status: 'skipped', reason: 'not asked for' };
		assert.ok(results.run.status === 'measured');
		results.run.args = ['--passes', '9'];
		const commands = to_provenance_commands(results);
		assert.ok(!commands.some((command) => command.id === 'wasm'));
		const run = commands.find((command) => command.id === 'run')!;
		assert.strictEqual(run.command, 'npm run benchmark -- --passes 9');
		assert.strictEqual(run.runs, results.run.command);
	});
});
