<script lang="ts">
	import { page } from '$app/state';

	const TITLES: Record<number, string> = {
		404: 'Page introuvable',
		403: 'Accès refusé',
		500: 'Erreur serveur',
		503: 'Service indisponible'
	};

	const DESCRIPTIONS: Record<number, string> = {
		404: "La page que vous recherchez n'existe pas ou a été déplacée.",
		403: "Vous n'avez pas la permission d'accéder à cette page.",
		500: 'Une erreur inattendue est survenue. Réessayez plus tard.',
		503: 'Le service est temporairement indisponible. Réessayez dans quelques instants.'
	};

	// SvelteKit sets its own generic English message (not one we threw ourselves) when a route
	// simply doesn't match — prefer our French copy for those, but keep messages we did throw
	// ourselves (e.g. "Accès réservé aux administrateurs.") since those are more specific.
	const GENERIC_KIT_MESSAGES = new Set(['Not Found', 'Internal Error']);

	let description = $derived(
		(page.error?.message && !GENERIC_KIT_MESSAGES.has(page.error.message)
			? page.error.message
			: DESCRIPTIONS[page.status]) || 'Une erreur est survenue.'
	);
</script>

<svelte:head>
	<title>{page.status} — Passport</title>
</svelte:head>

<div class="relative left-1/2 w-screen -translate-x-1/2">
	<div class="bg-lghs-yellow h-2"></div>

	<section class="flex min-h-[60vh] flex-col items-center justify-center bg-black px-4 py-16 text-center text-white">
		<p class="text-9xl leading-none font-bold sm:text-[12rem]">
			{page.status}
		</p>
		<h1 class="mt-6 mb-4 text-2xl font-bold uppercase sm:text-3xl">
			{TITLES[page.status] ?? 'Erreur'}
		</h1>
		<p class="mb-8 max-w-md text-sm leading-relaxed text-gray-400">
			{description}
		</p>
		<a
			href="/"
			class="no-underline-fx inline-block bg-white px-6 py-3 font-bold text-black uppercase transition-colors hover:bg-lghs-yellow"
		>
			Retour à l'accueil
		</a>
	</section>

	<div class="bg-lghs-yellow h-2"></div>
</div>
