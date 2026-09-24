<script lang="ts">
	import '@fontsource/open-sans/400.css';
	import '@fontsource/open-sans/400-italic.css';
	import '@fontsource/open-sans/700.css';
	import '@fontsource/open-sans/700-italic.css';
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { children, data } = $props();

	// Bound from Sidebar so the content column can reserve top padding matching the fixed logo's
	// footprint once the sidebar collapses (it goes to zero width then, so the content column
	// would otherwise render underneath the still-visible fixed logo).
	let sidebarCollapsed = $state(false);
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon/favicon.svg" />
	<link rel="icon" type="image/png" sizes="96x96" href="/favicon/favicon-96x96.png" />
	<link rel="shortcut icon" href="/favicon/favicon.ico" />
	<link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden pt-[5px] font-sans">
	<div class="flex flex-1 flex-col overflow-hidden md:flex-row">
		<Sidebar
			bind:collapsed={sidebarCollapsed}
			user={data.user}
			avatarUrl={data.avatarUrl}
			cotisationStatus={data.cotisationStatus}
		/>
		<div
			class="flex min-w-0 flex-1 flex-col overflow-y-auto {sidebarCollapsed ? 'md:pt-28' : ''}"
		>
			<Header user={data.user} avatarUrl={data.avatarUrl} cotisationStatus={data.cotisationStatus} />
			<main class="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-10">
				{@render children()}
			</main>
			<Footer status={data.systemStatus} mattermostCacheStatus={data.mattermostCacheStatus} />
		</div>
	</div>
</div>

<Toast />
