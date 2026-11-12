<script lang="ts">
	import type { Component } from 'svelte';
	import { SiteState, site_context } from '@fuzdev/fuz_ui/site.svelte.ts';
	import pkg_json from 'virtual:pkg.json';

	// what the root layout sets for the components under it, so a test can render
	// one of them on its own
	const {
		component: Inner,
		props
	}: {
		component: Component<any>;
		props: Record<string, unknown>;
	} = $props();

	site_context.set(new SiteState({ pkg_json }));
</script>

<Inner {...props} />
