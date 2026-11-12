import { to_headline_charts, type HeadlineChart } from './docs/benchmarks/benchmark_headline.ts';
import type { MatrixColumn } from './docs/benchmarks/benchmark_matrix.ts';
import { to_lib_columns } from './docs/benchmarks/benchmark_sections.ts';
import { load_site_benchmarks_for_build } from './docs/benchmarks/site_benchmarks.server.ts';

/** What the landing page shows of the benchmarks: the headline figures, and what names them. */
export interface LandingBenchmarks {
	/** The libraries, as the columns of every chart. */
	columns: Array<MatrixColumn>;
	charts: Array<HeadlineChart>;
	/** The machine the timed figures are from. */
	machine: string;
	/** When the run started, as an ISO timestamp. */
	generated_at: string;
}

/** The landing page gets the headline figures worked out, and not the file they are from. */
export const load = (): { benchmarks: LandingBenchmarks | null } => {
	const { results } = load_site_benchmarks_for_build();
	return {
		benchmarks: results && {
			columns: to_lib_columns(results.meta.libs),
			charts: to_headline_charts(results),
			machine: results.meta.machine.name,
			generated_at: results.meta.generated_at
		}
	};
};
