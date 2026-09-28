<script lang="ts">
	import { page } from '$app/state';

	// Same look as the rest of Passport (black title bar, bordered block, yellow accents) rather
	// than a full-bleed black screen: an error page stays inside the app, with its sidebar, and
	// says what to do next, not just what went wrong.
	const CONTENT: Record<number, { title: string; description: string; hint: string }> = {
		404: {
			title: 'Page introuvable',
			description: "Cette page n'existe pas, ou plus.",
			hint: "Vérifiez l'adresse, ou repartez de l'accueil."
		},
		403: {
			title: 'Accès refusé',
			description: "Vous n'avez pas les droits pour voir cette page.",
			hint: "Si vous pensez que c'est une erreur, écrivez-nous."
		},
		500: {
			title: 'Erreur interne',
			description: "Quelque chose s'est mal passé de notre côté.",
			hint: 'Réessayez dans un instant. Si ça persiste, prévenez-nous.'
		},
		503: {
			title: 'Service indisponible',
			description: "Un service dont Passport dépend ne répond pas pour l'instant.",
			hint: 'Réessayez dans quelques instants.'
		}
	};

	const content = $derived(
		CONTENT[page.status] ?? {
			title: 'Erreur',
			description: 'Une erreur est survenue.',
			hint: "Réessayez, ou repartez de l'accueil."
		}
	);

	// SvelteKit sets its own generic English message when a route simply doesn't match — prefer
	// our French copy for those, but keep messages we threw ourselves (e.g. "Accès réservé aux
	// administrateurs.") since those are more specific.
	const GENERIC_KIT_MESSAGES = new Set(['Not Found', 'Internal Error', 'Forbidden', 'Service Unavailable']);
	const specificMessage = $derived(
		page.error?.message &&
			!GENERIC_KIT_MESSAGES.has(page.error.message) &&
			// error(status) thrown without a message comes through as "Error: <status>".
			!/^Error: \d+$/.test(page.error.message)
			? page.error.message
			: null
	);

	// Worth retrying only when the problem is on our side or a service's.
	const canRetry = $derived(page.status >= 500);
</script>

<svelte:head>
	<title>{content.title} — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">{content.title}</h1>

<section class="flex flex-col border-4 border-black sm:flex-row">
	<div
		class="flex shrink-0 items-center justify-center bg-lghs-yellow px-8 py-6 sm:border-r-4 sm:border-black"
		aria-hidden="true"
	>
		<span class="text-6xl leading-none font-bold sm:text-7xl">{page.status}</span>
	</div>

	<div class="flex-1 p-5 text-sm">
		<p class="mb-2 text-base font-bold">{specificMessage ?? content.description}</p>
		<p class="mb-5 text-gray-600">{content.hint}</p>

		<div class="flex flex-wrap items-center gap-3">
			<a href="/" class="no-underline-fx btn-primary inline-block px-4 py-2 text-sm">Retour à l'accueil</a>
			{#if canRetry}
				<button
					type="button"
					onclick={() => location.reload()}
					class="border border-black px-4 py-2 text-sm font-bold uppercase transition-colors hover:bg-black hover:text-white"
				>
					Réessayer
				</button>
			{:else}
				<button type="button" onclick={() => history.back()} class="text-sm font-bold uppercase underline">
					Page précédente
				</button>
			{/if}
		</div>

		<p class="mt-5 border-t border-black pt-3 text-xs text-gray-500">
			Un souci ? <a href="mailto:noc@lghs.be">noc@lghs.be</a> — erreur {page.status}
		</p>
	</div>
</section>
