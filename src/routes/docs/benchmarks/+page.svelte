<script lang="ts">
	// the classes this page's components share, which scoped `<style>` can't reach
	// across, imported here so they ship with this route and not with every one
	import './benchmarks.css';

	import { page } from '$app/state';
	import Details from '@fuzdev/fuz_ui/Details.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import { DOCS_PATH, docs_slugify } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';
	import { site_context } from '@fuzdev/fuz_ui/site.svelte.ts';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	import { format_bytes, format_ns, format_percent } from './benchmark_format.ts';
	import { BENCHMARK_SECTION_TITLES as TITLES } from './benchmark_headline.ts';
	import {
		ALLOCATION_TOLERANCE,
		HEAP_FURTHER_TOLERANCE_BYTES,
		HEAP_TOTAL_TOLERANCE_BYTES,
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
	} from './benchmark_sections.ts';
	import { format_run_regime } from './benchmark_provenance.ts';
	import BenchmarksLabel from './BenchmarksLabel.svelte';
	import BenchmarksLegend from './BenchmarksLegend.svelte';
	import BenchmarksProvenance from './BenchmarksProvenance.svelte';
	import BenchmarksSurveySummary from './BenchmarksSurveySummary.svelte';
	import BenchmarksText from './BenchmarksText.svelte';
	import BenchmarksTable from './BenchmarksTable.svelte';
	import type { PageProps } from './$types.js';

	// the `/docs` index renders this component with no props, as it does every tome
	const { data }: Partial<PageProps> = $props();

	const LIBRARY_ITEM_NAME = 'benchmarks';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
	const site = site_context.get();

	// the `/docs` index renders every tome, so there this one is a link to itself
	const at_root = $derived(page.url.pathname === DOCS_PATH);

	const results = $derived(data?.benchmarks.results ?? null);
	const columns = $derived(results ? to_lib_columns(results.meta.libs) : []);
	const maintained = $derived(columns.filter((column) => column.by_maintainer));
	const compared = $derived(columns.filter((column) => !column.by_maintainer));

	const size_groups = $derived(
		results
			? (['gzip', 'brotli', 'minified'] as const).flatMap(
					(measure) => to_size_group(results, measure) ?? []
				)
			: []
	);
	const time_groups = $derived(results ? to_time_groups(results) : []);
	const run = $derived(results && to_section_data(results, 'run'));
	const coldstart_groups = $derived(results ? to_coldstart_groups(results) : []);
	const coldstart = $derived(results && to_section_data(results, 'coldstart'));
	const creation_group = $derived(results && to_creation_group(results));
	const allocation_groups = $derived(results ? to_allocation_groups(results) : []);
	const heap_groups = $derived(results ? to_heap_groups(results) : []);
	const types_group = $derived(results && to_types_group(results));
	const types = $derived(results && to_section_data(results, 'types'));
	const survey = $derived(results && to_section_data(results, 'survey'));
	const survey_columns = $derived(results ? to_survey_columns(results) : []);
	const survey_groups = $derived(results ? to_survey_groups(results) : []);
	const harvest_sets = $derived(results ? to_harvest_sets(results) : []);

	// the method, in the repository the site is of
	const docs_url = $derived(`${site.repo_url}/blob/main/docs/benchmarks.md`);
	const results_url = $derived(`${site.repo_url}/blob/main/results/latest.json`);
</script>

<TomeContent {tome}>
	{#if at_root}
		<section>
			<p>
				The <TomeLink slug="benchmarks" /> compare this library's size, speed, and memory with
				Valibot, Zod, TypeBox, and ArkType.
			</p>
		</section>
	{:else if !results}
		<section>
			<p>
				<strong>No run is published yet.</strong> This page renders one results file, of one run of
				every benchmark on one named machine, and shows no measured number without it.
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={docs_url}>The method</a> says what each benchmark measures and how to run it.
			</p>
		</section>
	{:else}
		<section>
			<p>
				This page compares
				{#each maintained as column (column.id)}<BenchmarksLabel {column} />{/each}
				with
				{#each compared as column, i (column.id)}
					{i === 0 ? '' : i === compared.length - 1 ? ', and ' : ', '}{column.label}
				{/each}: the bytes each ships, how long a parse takes, what a fresh process pays before its
				first parse, what stays in memory, and what the types cost the compiler. The maintainer of
				these benchmarks also maintains
				{#each maintained as column (column.id)}{column.label}{/each}, so that library is marked
				wherever it is named, and
				<a href="#{docs_slugify(TITLES.method)}">how every number was measured</a> is published with
				the numbers.
			</p>
			<p>
				Every figure here is rendered from one results file, of one run. Beside a number is its
				ratio to the least in its row, or the most where higher is better, which reads
				<code>1.00×</code>: <code>2.00×</code> is twice as slow or twice as large. Hover a number to
				compare its row against that library instead. A ratio marked <code>≈</code> is inside what
				the two numbers range over, and one marked <code>~</code> has a time at the call floor:
				neither is a difference, and neither is colored. Where a number is level with the row's
				least, the least is marked <code>≈</code> too: the readings don't tell the two apart, and
				neither is the better. For two numbers of a row, what they range over is the two spreads
				together, the <code>±</code> beside each. A geometric mean has a band in place of a spread,
				printed under it, from the mean of its rows' least readings to the mean of their most, and
				two means whose bands overlap are level. Each table says how its own figures are compared. A
				cell with no number says why it has none, and a number marked <code>†</code> is not ranked,
				nor is its row until a library is hovered. Bytes are in decimal units throughout:
				<code>1 kB</code> is 1,000 bytes.
			</p>
			<BenchmarksLegend />
		</section>

		<TomeSection>
			<TomeSectionHeader text={TITLES.size} />
			<p>
				What each library adds to a page that validates one thing: an entry that imports one
				scenario's schema and calls it, bundled and
				minified{results.meta.tools.rolldown ? ` by Rolldown ${results.meta.tools.rolldown}` : ''},
				then compressed. These are bytes, so they are exact: the same sources, bundler, and zlib
				give the same figures on any machine.
			</p>
			{#each size_groups.slice(0, 1) as group (group.key)}
				<BenchmarksTable
					{columns}
					groups={[group]}
					heading="scenario"
					label="Bundle size by scenario and library, {group.label.toLowerCase()}"
					bars
					about={['bundle']}
				>
					{group.label}, in bytes. Bytes of a bundle are exact, so any gap is a difference.
				</BenchmarksTable>
			{/each}
			<Details eager summary="The same in brotli's bytes, and uncompressed">
				{#each size_groups.slice(1) as group (group.key)}
					<BenchmarksTable
						{columns}
						groups={[group]}
						heading="scenario"
						label="Bundle size by scenario and library, {group.label.toLowerCase()}"
					>
						{group.label}, in bytes.
					</BenchmarksTable>
				{/each}
			</Details>
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						Most of a small bundle is the library's own code, paid once, so a ratio narrows as an
						app defines more schemas: <code>app</code> is several distinct schemas in one bundle,
						where every other scenario is one.
					</li>
					<li>
						The libraries do different amounts: a smaller bundle is fewer bytes for these scenarios,
						not the same features in fewer bytes.
					</li>
					<li>
						The compiled Zod rows carry the compiler <code>z.compile</code> needs, whether or not a
						scenario's schema compiles.
					</li>
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.time} />
			<p>
				A warm parse of each scenario: on its valid input, on its invalid input, and as a guard,
				which only answers whether the valid input matches.
				{#if run}{format_run_regime(run)}{/if}
				A time is the median of its passes, and the <code>±</code> beside it is half of what they
				range over.
			</p>
			<BenchmarksTable
				{columns}
				groups={time_groups}
				heading="scenario"
				label="Parse time by scenario and library"
				about={['valid', 'invalid', 'guard']}
			>
				Time per call. Each group leads with a geometric mean over the scenarios every library has a
				figure of, with its band: the mean of the scenarios' fastest passes to the mean of their
				slowest. Two times of a scenario are compared by the spreads of their passes, and two means
				by their bands.
			</BenchmarksTable>
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						The guard sets aside a difference the parse rows carry: on a valid input a strict schema
						of this library returns the input itself, where Valibot and Zod return a copy of it, so
						a parse row there compares a check with a check and a copy.
					</li>
					<li>
						TypeBox's rows are a <code>Check</code> of its compiled validator in every table: it
						stops at the first failure and builds no issues and no output.
					</li>
					<li>
						ArkType's parse of a scenario that drops unknown keys deep-clones its input before it
						runs. Its guard, <code>allows</code>, clones nothing.
					</li>
					<li>
						Compiled Zod is each scenario's root through <code>z.compile</code>, which generates a
						parser for a valid input and hands an invalid one to Zod's regular parser. A root it
						hands back uncompiled has no figure, and reads <em>not compiled</em>.
					</li>
					{#if run}
						<li>
							Every figure has a call in it: a function that does nothing took
							{format_ns(run.call.min_ns)} to {format_ns(run.call.max_ns)} through the loop the rows
							are timed in, across the processes. A time at or under
							{format_ns(to_run_call_floor(run))}, twice the slowest of those, is at the call floor
							and mostly the call: its ratio is marked <code>~</code>, and a scenario with such a
							time is in no mean.
						</li>
					{/if}
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.coldstart} />
			<p>
				What a fresh Node process pays before it has validated anything: one process a sample, in
				stages that each include the ones before, timed inside the process from its module's first
				line{#if coldstart}, as the median of {coldstart.samples} samples{/if}. A bundled entry is
				the minified chunk a bundler makes of one scenario, and an unbundled one imports the package
				from <code>node_modules</code>, as a server without a bundler does.
			</p>
			<BenchmarksTable
				{columns}
				groups={coldstart_groups}
				heading="work inside a fresh process"
				label="Cold start by scenario, form of entry, and library"
				fold
				about={['coldstart']}
			>
				Each group shows the work up to a first parse. Open one for every stage, the parses after
				the first, and what the process added over a bare one. A figure is the median of its samples
				and is compared by half of their p10 to p90 band, the <code>±</code> beside it.
			</BenchmarksTable>
			{#if creation_group}
				<BenchmarksTable
					{columns}
					groups={[creation_group]}
					heading="scenario"
					label="Time to build a schema by scenario and library"
					about={['creation']}
				>
					Building a scenario's schema again in a warm process, timed once in one process a library.
					One timing has no measure of what it ranges over, so the figures are shown and not
					compared.
				</BenchmarksTable>
			{/if}
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						A library that compiles a validator pays for it here, when the schema is built or on its
						first parse.
					</li>
					<li>
						The whole process over a bare one is read against the bare process's own band: an
						addition inside it can't be told from zero, and is not ranked.
					</li>
					<li>
						The parses after the first and the peak memory over a bare process are each compared by
						the band of their own samples. A results file without those bands shows the two rows
						without comparing them.
					</li>
					<li>
						A figure marked <code>†</code> builds one definition again and again, which a library
						that keeps the schema of a definition hands back. It is not what an app's distinct
						schemas cost that library.
					</li>
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.memory} />
			<p>
				What a parse allocates, and what a library still holds once its schemas are built.
				Allocation is the growth of V8's heap across a sample of calls, with no collection forced.
				It is exact for the code the engine is running when it is sampled, and which code that is is
				settled per process, and not always the same way: a row repeats within about a percent from
				process to process, and can settle at one of a few figures, tens of bytes to a couple of
				kilobytes apart, each process at one of them.
			</p>
			<BenchmarksTable
				{columns}
				groups={allocation_groups}
				heading="scenario"
				label="Heap bytes allocated by scenario and library"
				about={['allocation', 'creation']}
			>
				Heap bytes per call, one figure a process. Two figures are compared with
				{format_percent(ALLOCATION_TOLERANCE)} either side of each, what a row repeats within: two
				closer than that are level.
			</BenchmarksTable>
			<p>
				Retained heap is read in a fresh process that builds a scenario's schema, parses once, and
				collects until the heap settles, over a bare process holding the same input. The figures
				depend on Node's version and the machine's architecture.
			</p>
			<BenchmarksTable
				{columns}
				groups={heap_groups}
				heading="scenario"
				label="Retained heap by scenario and library"
				about={['heap']}
			>
				Bytes held, in decimal units, where the script prints its own in units of 1,024. The first
				group carries each library's own fixed memory, and the second is what an app that defines
				many schemas pays for each. A total is compared with
				{format_bytes(HEAP_TOTAL_TOLERANCE_BYTES)} either side of it and a figure per further schema
				with {format_bytes(HEAP_FURTHER_TOLERANCE_BYTES)}, what each repeats to.
			</BenchmarksTable>
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						A row with a zero in it has no ratios: nothing is a multiple of zero. A zero is a call
						that allocated nothing, as a check that builds no output can.
					</li>
					<li>Where a library returns a copy of its input, the copy is in its bytes.</li>
					<li>
						Every further schema is built from the scenario's one definition. A figure marked
						<code>†</code> is of a library that hands back the schema it built before for the same
						definition, so it reads far lower than an app's distinct schemas would, and is not
						ranked.
					</li>
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.types} />
			<p>
				What each library's types cost the TypeScript
				checker{results.meta.tools.typescript ? ` (${results.meta.tools.typescript})` : ''}:
				<code>tsc</code> over one module of every scenario, and over a file that reads properties of
				the types the schemas infer, as a consumer's code does. Instantiations are the same on every
				run. The scenarios are small, so this ranks the libraries and doesn't predict a large
				codebase.
			</p>
			{#if types_group}
				<BenchmarksTable
					{columns}
					groups={[types_group]}
					heading="measure"
					label="Type-checking cost by library"
					about={['types']}
				>
					{#if types}
						The reads are <code>{types.reads.join(', ')}</code>.
					{/if}
					Instantiations are exact, so any gap is a difference, and check time is shown and not
					compared.
				</BenchmarksTable>
			{/if}
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.survey} />
			<p>
				The scenarios give a library one figure for a match and one for a miss, on a few schemas,
				and a library that is ahead on one kind of work can hide in them. The survey times many
				small shapes, a row for each input of each, and summarizes them by what a parse does.
			</p>
			{#if survey && survey_columns.length}
				<BenchmarksSurveySummary
					rows={to_survey_summary(survey)}
					subject={survey_columns[0]!}
					others={survey_columns.slice(1)}
				/>
				<BenchmarksTable
					columns={survey_columns}
					groups={survey_groups}
					heading="shape and input"
					label="Survey rows by library"
					fold
					about={['valid', 'invalid', 'guard']}
				>
					Every row, time per call, by what its parse does, compared by the spreads of its passes. A
					time at or under {format_ns(survey.call_floor_ns)}, twice what a function that does
					nothing took through the timing loop, is at the call floor.
				</BenchmarksTable>
			{/if}
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						A shape is written once for each library, and every library must give the verdict each
						input names before anything is timed. A shape a library can't express reads
						<em>no equivalent</em>, and an input it answers otherwise <em>other verdict</em>:
						neither is timed for it.
					</li>
					<li>
						Objects are matched by what they do with a key the schema doesn't name: refuse it, drop
						it, or keep it.
					</li>
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.harvest} />
			<p>
				A harvested set is a consumer's own schemas and its own data, copied in as a snapshot: the
				schemas as the consumer wrote them, in Valibot or Zod, against the same schemas in this
				library, on that set's documents. Every row is held to one verdict and one output on both
				sides before it is measured.
			</p>
			{#each harvest_sets as set (set.name)}
				<TomeSection>
					<TomeSectionHeader text={set.name} />
					<p><BenchmarksText text={set.title} />.</p>
					<BenchmarksTable
						columns={set.columns}
						groups={set.groups}
						heading="row"
						label="The harvested set {set.name} by side"
						fold
						about={['bundle', 'valid', 'invalid', 'allocation']}
					>
						The bundle of a module that parses one document, then time per parse and heap bytes per
						parse over the set's documents, each summarized as a geometric mean over the rows every
						side has a number of. Open a group for its rows. Bundle bytes are exact, times are
						compared by the spreads of their passes, and heap bytes with
						{format_percent(ALLOCATION_TOLERANCE)} either side of each.
					</BenchmarksTable>
					{#if set.asides.length}
						<p>
							<small>
								Not all of a parse here is a library. Timed alone, in a process of their own:
								{#each set.asides as aside, i (aside.name)}
									{i ? '; ' : ' '}{aside.name}, {aside.time} and {aside.bytes}
								{/each}.
							</small>
						</p>
					{/if}
				</TomeSection>
			{/each}
			<aside>
				<p>Notes:</p>
				<ul>
					<li>
						It isn't like for like. Valibot and Zod return a fresh copy of what they read, and this
						library returns its input wherever nothing changed, so a matching row compares a copy
						with a check.
					</li>
					<li>
						Zod is up to three columns: as it is imported, where it generates a parser for each
						object schema on its first parse; its interpreter, which is all it has where the
						environment refuses eval; and each root through <code>z.compile</code>, which has no
						figure of a row whose root it hands back uncompiled.
					</li>
					<li>
						The sets are all from projects of this library's maintainer, not a sample of the
						ecosystem.
					</li>
				</ul>
			</aside>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text={TITLES.method} />
			<BenchmarksProvenance {results} />
			<ul>
				<li>
					<strong>Bundle bytes and instantiations are exact.</strong> Bundle sizes and
					<code>tsc</code>'s instantiations are the same on any machine for the same sources and
					tools. Allocation is exact for the code the engine is running, which a process settles and
					not always the same way, so a row repeats within about a percent, and a retained total to
					about a kilobyte: the tables compare each with that much either side.
				</li>
				<li>
					<strong>Times are one machine's.</strong> They come from the machine named above, on one
					version of Node, with nothing pinned or isolated: what it was doing as the run started and
					ended is above. Compare the ratios between libraries before the absolute times, and read a
					gap against the spreads beside it: one inside them is not a finding, and one just outside
					is not much of one.
				</li>
				<li>
					<strong>A process holds one library.</strong> What a library takes depends on what its
					process ran before, so no two share one, and a figure is what a library takes with the
					engine's attention to itself.
				</li>
				<li>
					<strong>The scenarios are few and small</strong>, and all but one are synthetic. A test
					holds every library to the same answer on each scenario's inputs, so the rows compare the
					same question, not the same work: what each library builds on the way to its answer
					differs, as the notes above say.
				</li>
				<li><strong>It is V8 only.</strong> No other engine is measured.</li>
			</ul>
			<p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={docs_url} rel="external">The benchmarks' documentation</a> has the method in full:
				what each script measures, how, and how far to trust each number.
				{#if data?.benchmarks.source === 'published'}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={results_url} rel="external">The results file</a> this page renders is in the
					repository.
				{/if}
			</p>
		</TomeSection>
	{/if}
</TomeContent>
