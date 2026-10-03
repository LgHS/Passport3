<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let uuid = $derived(form?.uuid ?? data.uuid);
	let showUuid = $state(false);
	let understood = $state(false);
	let submitting = $state(false);
	// Captured at submit time, before the action's response replaces `uuid` — decides which
	// success wording to show ("généré" the first time, "régénéré" after that).
	let wasEmpty = $state(false);

	// Placeholder until physical access authorisations exist (Authentik group per door, read by
	// Passport): shows what "Mes autorisations RFID" will look like, with made-up rows.
	const PLACEHOLDER_AUTHORIZATIONS = [
		{ name: "Porte d'entrée", description: 'Accès au hackerspace' },
		{ name: 'Atelier', description: 'Accès à l’atelier et aux machines' },
		{ name: 'Local technique', description: 'Réservé aux membres habilités' }
	];
</script>

<svelte:head>
	<title>Badge RFID — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Badge RFID</h1>

{#if form?.success}
	<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm font-bold">
		{wasEmpty ? 'Ton badge a été généré.' : 'Ton UUID a été régénéré : tes anciens badges ne fonctionnent plus.'}
	</p>
{:else if form?.error}
	<p class="mb-6 border-4 border-black bg-red-600 px-4 py-3 text-sm font-bold text-white">
		{form.error}
	</p>
{/if}

{#if uuid === null}
	<section class="mx-auto max-w-2xl text-center">
		<p class="mb-2 text-sm text-gray-600">
			Cet identifiant unique sert à sécuriser ton porte-clé ou ta carte d'accès RFID au
			hackerspace.
		</p>
		<p class="mb-6 text-sm text-gray-600">
			Tu n'en as pas encore : génère-le pour pouvoir l'utiliser.
		</p>
		<form
			method="POST"
			action="?/regenerate"
			use:enhance={() => {
				wasEmpty = true;
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<button
				type="submit"
				disabled={submitting}
				class="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
			>
				{submitting ? 'Génération…' : 'Générer mon badge'}
			</button>
		</form>
	</section>
{:else}
	<div class="flex flex-col gap-8 md:flex-row md:items-start">
		<section class="w-full md:w-2/3">
			<p class="mb-2 text-sm text-gray-600">
				Cet identifiant unique sert à sécuriser ton porte-clé ou ta carte d'accès RFID au
				hackerspace.
			</p>
			<p class="mb-2 text-sm text-gray-600">
				Cet identifiant est confidentiel et ne doit être communiqué à personne.
			</p>
			<p class="mb-6 text-sm text-gray-600">
				Il est possible de le régénérer en cas de doute, de copie ou de perte.
			</p>

			<div>
				<span class="mb-1 block text-sm font-bold uppercase">Identifiant (UUID)</span>
				<div class="flex items-center gap-2 border border-black bg-gray-100 px-3 py-2">
					<p class="flex-1 font-mono text-sm">{showUuid ? uuid : '•'.repeat(uuid.length)}</p>
					<button
						type="button"
						onclick={() => (showUuid = !showUuid)}
						aria-label={showUuid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
						title={showUuid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
						class="shrink-0 text-gray-600 hover:text-black"
					>
						{#if showUuid}
							<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5">
								<path
									d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<circle cx="10" cy="10" r="2.25" />
							</svg>
						{:else}
							<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5">
								<path
									d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<circle cx="10" cy="10" r="2.25" />
								<line x1="2" y1="17" x2="18" y2="3" stroke-linecap="round" />
							</svg>
						{/if}
					</button>
				</div>
			</div>

			<h2 class="mt-8 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
				Mes autorisations RFID
			</h2>
			<p class="mb-4 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Aperçu : bientôt, vous verrez ici les portes et zones auxquelles votre badge donne accès. Les
				lignes ci-dessous sont des exemples.
			</p>
			<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
			<div class="space-y-2 opacity-60 sm:hidden" aria-hidden="true">
				{#each PLACEHOLDER_AUTHORIZATIONS as authorization (authorization.name)}
					<div class="border border-black p-3 text-sm">
						<p class="font-bold">{authorization.name}</p>
						<p class="mt-1 text-gray-600">{authorization.description}</p>
					</div>
				{/each}
			</div>
			<div class="hidden overflow-x-auto opacity-60 sm:block" aria-hidden="true">
				<table class="w-full table-fixed border-collapse text-sm">
					<thead>
						<tr class="bg-black text-white uppercase">
							<th class="w-1/3 border border-black px-3 py-2 text-left">Autorisation</th>
							<th class="border border-black px-3 py-2 text-left">Description</th>
						</tr>
					</thead>
					<tbody>
						{#each PLACEHOLDER_AUTHORIZATIONS as authorization (authorization.name)}
							<tr>
								<td class="border border-black px-3 py-2 font-bold">{authorization.name}</td>
								<td class="border border-black px-3 py-2 text-gray-600">{authorization.description}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="w-full md:w-1/3">
			<div class="border-4 border-black">
				<div class="hazard-stripes h-2"></div>
				<div class="p-6">
					<p class="mb-3 text-sm font-bold uppercase">Attention, action irréversible</p>
					<p class="mb-4 text-sm text-gray-600">
						En régénérant ton UUID, tous tes badges actuels cesseront de fonctionner immédiatement.
						À n'utiliser qu'en cas de perte ou de copie d'un badge.
					</p>
					<form
						method="POST"
						action="?/regenerate"
						use:enhance={() => {
							wasEmpty = false;
							submitting = true;
							return async ({ update }) => {
								await update();
								submitting = false;
								understood = false;
							};
						}}
					>
						<label class="mb-4 flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								name="confirmRegenerate"
								value="yes"
								bind:checked={understood}
								class="mt-1"
							/>
							J'ai compris que mes badges actuels ne fonctionneront plus.
						</label>
						<div class="flex gap-3 pb-1">
							<button
								type="submit"
								disabled={!understood || submitting}
								class="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
							>
								{submitting ? 'Régénération…' : 'Confirmer la régénération'}
							</button>
						</div>
					</form>
				</div>
				<div class="hazard-stripes h-2"></div>
			</div>
		</section>
	</div>
{/if}
