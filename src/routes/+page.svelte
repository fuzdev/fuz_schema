<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main class="width_atmost_sm px_lg pb_xl9">
	<section class="box">
		<h1 class="mt_xl2">fuz_schema</h1>
		<p>a performance-focused Standard Schema library for JS</p>
		<p>
			An experiment in how far Valibot's strategy can be pushed on bundle size, speed, and memory
			with simpler internals. It is unpublished and unstable.
		</p>
		<p>
			<a href={resolve('/about')}>about</a> · <a href={resolve('/docs')}>docs</a> ·
			<a href="https://github.com/fuzdev/fuz_schema">source</a>
		</p>
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0 auto;
	}
</style>
