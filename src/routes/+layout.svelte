<script lang="ts">
	import 'virtual:fuz.css';
	import '@fuzdev/fuz_code/theme.css';
	import './style.css';

	import ThemeRoot from '@fuzdev/fuz_ui/ThemeRoot.svelte';
	import { SiteState, site_context } from '@fuzdev/fuz_ui/site.svelte.ts';
	import pkg_json from 'virtual:pkg.json';

	import BenchmarksBanner from './docs/benchmarks/BenchmarksBanner.svelte';
	import type { LayoutProps } from './$types.js';

	const { children, data }: LayoutProps = $props();

	// `glyph` and `repo_url` derive from `pkg_json`.
	site_context.set(new SiteState({ pkg_json }));
</script>

<svelte:head>
	<title>fuz_schema</title>
</svelte:head>

<ThemeRoot>
	{@render children()}
	{#if data.benchmarks_source === 'fixture' || data.benchmarks_source === 'file'}
		<BenchmarksBanner source={data.benchmarks_source} />
	{/if}
</ThemeRoot>
