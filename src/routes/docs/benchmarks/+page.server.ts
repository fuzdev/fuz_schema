import { load_site_benchmarks_for_build, type SiteBenchmarks } from './site_benchmarks.server.ts';

/**
 * The benchmarks page gets the whole validated results file, or none when no
 * run is published, read once at build time.
 */
export const load = (): { benchmarks: SiteBenchmarks } => ({
	benchmarks: load_site_benchmarks_for_build()
});
