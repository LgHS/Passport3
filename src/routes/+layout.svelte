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

	// Bound from Sidebar purely so it can be read/set from here if ever needed — the content
	// column no longer needs to react to it (the sidebar's logo moved inside <aside> itself, so
	// there's nothing fixed left for a collapsed, full-width content column to render behind).
	let sidebarCollapsed = $state(false);

	// Shared with Header's mobile menu button so both it and Sidebar's own collapse toggle open
	// the same overlay drawer, instead of Header keeping a separate dropdown.
	let menuOverlayOpen = $state(false);
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon/favicon.svg" />
	<link rel="icon" type="image/png" sizes="96x96" href="/favicon/favicon-96x96.png" />
	<link rel="shortcut icon" href="/favicon/favicon.ico" />
	<link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
</svelte:head>

{#if data.user}
	<div class="flex h-dvh flex-col overflow-hidden pt-[5px] font-sans">
		<div class="flex flex-1 flex-col overflow-hidden md:flex-row">
			<Sidebar
				bind:collapsed={sidebarCollapsed}
				bind:overlayOpen={menuOverlayOpen}
				user={data.user}
				avatarUrl={data.avatarUrl}
				cotisationStatus={data.cotisationStatus}
			/>
			<div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
				<Header user={data.user} onOpenMenu={() => (menuOverlayOpen = true)} />
				<main class="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-10">
					{@render children()}
				</main>
				<Footer status={data.systemStatus} mattermostCacheStatus={data.mattermostCacheStatus} />
			</div>
		</div>
	</div>
{:else}
	<!-- Logged out: only the homepage ever renders through this branch (every other route either
	     requires a user or is a server-only redirect with no page of its own, e.g. /login), so
	     there's no sidebar/header chrome to show — just the centered welcome content and the
	     footer, no menu of any kind. -->
	<div class="flex h-dvh flex-col overflow-y-auto pt-[5px] font-sans">
		<main class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 pt-10 pb-10 text-center">
			{@render children()}
		</main>
		<Footer status={data.systemStatus} mattermostCacheStatus={data.mattermostCacheStatus} />
	</div>
{/if}

<Toast />
