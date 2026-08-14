<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let disconnecting = $state(false);

	$effect(() => {
		if (form?.disconnected) {
			showToast('success', 'Compte GitHub déconnecté. Vous pouvez en connecter un autre.');
		} else if (form?.success) {
			showToast('success', "Invitation envoyée ! Vérifiez vos emails (ou vos notifications GitHub) pour l'accepter.");
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});

	// The OAuth callback is a plain server redirect, not a form action — it has no `form` result to
	// hang a toast on, so it signals success via a query param instead. Stripped from the URL right
	// after so a refresh or back-navigation doesn't replay the toast. Uses the native History API
	// rather than SvelteKit's replaceState(): this effect runs during initial hydration, before
	// SvelteKit's router finishes initializing, and its replaceState() throws until then.
	$effect(() => {
		if (page.url.searchParams.get('connected')) {
			showToast('success', 'Compte GitHub connecté avec succès.');
			const url = new URL(page.url);
			url.searchParams.delete('connected');
			history.replaceState(history.state, '', url);
		}
	});
</script>

<svelte:head>
	<title>GitHub — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">GitHub</h1>

<div class="mx-auto max-w-xl">
	<p class="mb-6 text-sm leading-relaxed">
		Pour rejoindre l'organisation GitHub du Liège Hackerspace, connectez votre compte GitHub
		ci-dessous — ça confirme que le compte vous appartient vraiment avant d'envoyer une
		invitation.
	</p>

	{#if data.githubUsername}
		<p class="mb-4 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm font-bold">
			GitHub connecté : @{data.githubUsername}
		</p>

		{#if data.membershipStatus === 'member'}
			<p class="mt-6 border border-black bg-gray-100 px-4 py-3 text-sm">
				Vous êtes déjà membre de l'organisation GitHub du Liège Hackerspace.
			</p>
		{:else if data.membershipStatus === 'pending'}
			<p class="mt-6 border border-black bg-gray-100 px-4 py-3 text-sm">
				Une invitation a déjà été envoyée à @{data.githubUsername} et est en attente
				d'acceptation. Vérifiez vos emails ou vos notifications GitHub.
			</p>
		{:else}
			<form
				method="POST"
				action="?/invite"
				class="mt-6"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<button
					type="submit"
					disabled={submitting}
					class="btn-primary px-6 py-3 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{submitting ? 'Envoi…' : "Envoyer la demande d'invitation"}
				</button>
			</form>
		{/if}

		<form
			method="POST"
			action="?/disconnect"
			class="mt-6 border-t border-black pt-4"
			use:enhance={() => {
				disconnecting = true;
				return async ({ update }) => {
					await update({ reset: false });
					disconnecting = false;
				};
			}}
		>
			<p class="mb-2 text-xs text-gray-500">
				Ça n'annule ni une invitation déjà envoyée, ni votre adhésion à l'organisation — juste le
				lien enregistré ici. Utile si vous vous êtes trompé·e de compte.
			</p>
			<button type="submit" disabled={disconnecting} class="text-sm underline disabled:opacity-50">
				{disconnecting ? 'Déconnexion…' : 'Déconnecter mon compte GitHub'}
			</button>
		</form>
	{:else}
		<a href="/github/connect" class="no-underline-fx btn-primary inline-block px-6 py-3">
			Se connecter avec GitHub
		</a>
	{/if}
</div>
