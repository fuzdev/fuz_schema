<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const TOME_SLUG = 'introduction';

	const tome = tome_get_by_slug(TOME_SLUG);
</script>

<TomeContent {tome}>
	<section>
		<p>
			fuz_schema takes Valibot's approach - a tree-shakeable function per schema, schemas as plain
			objects, <code>pipe</code> for refinement - and pushes it further on bundle size, speed, and
			memory, with simpler internals. It's pre-1.0; feedback is welcome in the
			<a href="https://github.com/fuzdev/fuz_schema/issues">issues</a> and
			<a href="https://github.com/fuzdev/fuz_schema/discussions">discussions</a>.
		</p>
	</section>
	<TomeSection>
		<TomeSectionHeader text="Usage" />
		<Code lang={null} content="npm i @fuzdev/fuz_schema" />
		<p>
			For now the usage docs are in the
			<a href="https://github.com/fuzdev/fuz_schema#readme">README</a>. This site has the
			<TomeLink slug="benchmarks" /> and the generated <TomeLink slug="api" /> reference.
		</p>
	</TomeSection>
</TomeContent>
