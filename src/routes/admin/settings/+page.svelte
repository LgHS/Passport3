<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let enabled = $state(form?.enabled ?? data.birthdaySettings.enabled);
	// svelte-ignore state_referenced_locally
	let hour = $state(form?.hour ?? data.birthdaySettings.hour);
	let refreshingMattermostCache = $state(false);

	$effect(() => {
		if (form?.birthdaySuccess) {
			showToast('success', 'Paramètres enregistrés.');
		} else if (form?.birthdayError) {
			showToast('error', form.birthdayError);
		} else if (form?.mattermostCacheRefreshed) {
			showToast('success', 'Cache Mattermost régénéré.');
		} else if (form?.mattermostCacheError) {
			showToast('error', form.mattermostCacheError);
		}
	});
</script>

<svelte:head>
	<title>Paramètres — Administration — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Paramètres</h1>

	<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Annonces d'anniversaire
	</h2>
	<form
		method="POST"
		action="?/updateBirthdaySettings"
		class="border border-black p-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<label class="flex w-fit cursor-pointer items-center gap-3 text-sm">
			<span
				class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {enabled
					? 'bg-black'
					: 'bg-gray-300'}"
			>
				<input
					type="checkbox"
					name="enabled"
					bind:checked={enabled}
					class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
				/>
				<span
					class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {enabled
						? 'translate-x-5'
						: ''}"
				></span>
			</span>
			Souhaiter automatiquement leur anniversaire aux membres sur Mattermost
		</label>

		<div class="mt-4">
			<label class="mb-1 block text-sm font-bold uppercase" for="hour">
				Heure d'envoi
				<span class="text-xs font-normal text-gray-500 normal-case"
					>(Heure de la République libre d'Outremeuse)</span
				>
			</label>
			<select
				id="hour"
				name="hour"
				bind:value={hour}
				class="border border-black px-3 py-2 text-sm"
			>
				{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
					<option value={h}>{h}h00</option>
				{/each}
			</select>
		</div>

		<button
			type="submit"
			disabled={submitting}
			class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
		>
			{submitting ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>

	<h2 class="mt-8 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mattermost</h2>
	<form
		method="POST"
		action="?/refreshMattermostCache"
		class="border border-black p-4"
		use:enhance={() => {
			refreshingMattermostCache = true;
			return async ({ update }) => {
				await update({ reset: false });
				refreshingMattermostCache = false;
			};
		}}
	>
		<p class="mb-4 text-sm text-gray-600">
			Passport garde en mémoire la correspondance entre emails et comptes Mattermost, régénérée
			automatiquement toutes les heures. Ce bouton force une mise à jour immédiate, par exemple
			juste après qu'un membre ait créé son compte Mattermost.
		</p>
		<button
			type="submit"
			disabled={refreshingMattermostCache}
			class="btn-primary px-4 py-2 text-sm disabled:opacity-50"
		>
			{refreshingMattermostCache ? 'Régénération…' : 'Régénérer le cache Mattermost'}
		</button>
	</form>
</section>
