<script lang="ts">
	import '@fontsource/open-sans/400.css';
	import '@fontsource/open-sans/400-italic.css';
	import '@fontsource/open-sans/700.css';
	import '@fontsource/open-sans/700-italic.css';
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon/favicon.svg" />
	<link rel="icon" type="image/png" sizes="96x96" href="/favicon/favicon-96x96.png" />
	<link rel="shortcut icon" href="/favicon/favicon.ico" />
	<link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
</svelte:head>

<div class="flex min-h-screen flex-col font-sans">
	<Header user={data.user} avatarUrl={data.avatarUrl} cotisationStatus={data.cotisationStatus} />
	<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
		{@render children()}
	</main>
	<Footer />
</div>
