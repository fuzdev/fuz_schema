import {
	load_site_benchmarks_for_build,
	type SiteBenchmarksSource
} from './docs/benchmarks/site_benchmarks.server.ts';

/**
 * Every page learns where the rendered benchmark results came from, so a
 * build over the fixture or an unpublished run is marked on all of them.
 */
export const load = (): { benchmarks_source: SiteBenchmarksSource } => ({
	benchmarks_source: load_site_benchmarks_for_build().source
});
