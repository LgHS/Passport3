<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';
	import type { GithubOrgMembershipStatus } from '$lib/server/githubApp';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let disconnecting = $state(false);

	// Same colored-dot status idiom as the cotisation page (COTISATION_STATUS_COLOR) — kept local
	// here rather than promoted to $lib/types since GitHub membership status isn't used anywhere
	// else in the app.
	const MEMBERSHIP_STATUS_LABEL: Record<GithubOrgMembershipStatus, string> = {
		member: "Membre de l'organisation",
		pending: 'Invitation en attente',
		none: "Pas encore membre de l'organisation"
	};
	const MEMBERSHIP_STATUS_COLOR: Record<GithubOrgMembershipStatus, string> = {
		member: '#22c55e',
		pending: '#f97316',
		none: '#6b7280'
	};

	$effect(() => {
		if (form?.disconnected) {
			showToast('success', 'Compte GitHub déconnecté. Tu peux en connecter un autre.');
		} else if (form?.success) {
			showToast('success', "Invitation envoyée ! Vérifie tes emails (ou tes notifications GitHub) pour l'accepter.");
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

<div>
	<p class="mb-6 text-sm text-gray-600">
		Pour rejoindre <a href={data.githubOrgUrl} target="_blank" rel="noopener"
			>l'organisation GitHub du Liège Hackerspace</a
		>, connecte ton compte GitHub ci-dessous.
	</p>

	{#if data.githubUsername}
		<div class="mx-auto max-w-2xl border-4 border-black p-4">
			<div class="flex items-center gap-3">
				<svg
					viewBox="0 0 20 20"
					class="h-8 w-8 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<circle cx="6" cy="14.5" r="2" />
					<circle cx="14" cy="5.5" r="2" />
					<circle cx="6" cy="5.5" r="2" />
					<path d="M6 7.5 V12.5" />
					<path d="M8 14.5 H10 C12.2 14.5 14 12.7 14 10.5 V7.5" stroke-linecap="round" />
				</svg>
				<div class="min-w-0">
					<p class="truncate text-sm font-bold">@{data.githubUsername}</p>
					{#if !data.githubUnavailable && data.membershipStatus}
						<p class="flex items-center gap-1.5 text-sm text-gray-600">
							<span
								class="inline-block h-2 w-2 shrink-0 rounded-full"
								style="background-color: {MEMBERSHIP_STATUS_COLOR[data.membershipStatus]};"
								aria-hidden="true"
							></span>
							{MEMBERSHIP_STATUS_LABEL[data.membershipStatus]}
						</p>
					{/if}
				</div>
			</div>

			{#if data.githubUnavailable}
				<p class="mt-4 text-sm text-gray-600">
					Impossible de vérifier ton statut dans l'organisation GitHub pour le moment. Réessaie
					plus tard.
				</p>
			{:else if data.membershipStatus === 'pending'}
				<p class="mt-4 text-sm text-gray-600">
					Vérifie tes emails ou tes notifications GitHub pour accepter l'invitation.
				</p>
			{:else if data.membershipStatus === 'none'}
				<form
					method="POST"
					action="?/invite"
					class="mt-4"
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
						class="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
					>
						{submitting ? 'Envoi…' : "Envoyer la demande d'invitation"}
					</button>
				</form>
			{/if}

			<form
				method="POST"
				action="?/disconnect"
				class="mt-4"
				use:enhance={() => {
					disconnecting = true;
					return async ({ update }) => {
						await update({ reset: false });
						disconnecting = false;
					};
				}}
			>
				<button
					type="submit"
					disabled={disconnecting}
					title="Ça n'annule ni une invitation déjà envoyée, ni ton adhésion à l'organisation : juste le lien enregistré ici. Utile si tu t'es trompé·e de compte."
					class="text-sm text-gray-500 underline disabled:opacity-50"
				>
					{disconnecting ? 'Déconnexion…' : 'Déconnecter mon compte GitHub'}
				</button>
			</form>
		</div>
	{:else}
		<div class="mx-auto max-w-2xl border-4 border-black p-4">
			<div class="mb-4 flex items-center gap-3">
				<svg
					viewBox="0 0 20 20"
					class="h-8 w-8 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<circle cx="6" cy="14.5" r="2" />
					<circle cx="14" cy="5.5" r="2" />
					<circle cx="6" cy="5.5" r="2" />
					<path d="M6 7.5 V12.5" />
					<path d="M8 14.5 H10 C12.2 14.5 14 12.7 14 10.5 V7.5" stroke-linecap="round" />
				</svg>
				<p class="text-sm font-bold text-gray-600">Aucun compte GitHub connecté</p>
			</div>
			<a href="/github/connect" class="no-underline-fx btn-primary inline-block px-4 py-2 text-sm">
				Se connecter avec GitHub
			</a>
		</div>
	{/if}

	<div class="mt-8">
		<p class="mb-2 text-sm font-bold uppercase">Comment ça marche</p>
		<ol class="list-decimal space-y-1 pl-5 text-sm text-gray-600">
			<li>Clique sur le bouton « Se connecter avec GitHub »,</li>
			<li>Confirme sur GitHub le compte à utiliser,</li>
			<li>Envoie la demande d'invitation depuis cette page,</li>
			<li>
				GitHub t'envoie une invitation par email et/ou notification GitHub, en attente de
				ton acceptation,
			</li>
			<li>Tu acceptes l'invitation sur GitHub,</li>
			<li>Tu deviens membre de l'organisation.</li>
		</ol>
	</div>
</div>
