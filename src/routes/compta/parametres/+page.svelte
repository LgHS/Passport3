<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let delaiGraceJours = $state(form?.delaiGraceJours ?? data.settings.delaiGraceJours);

	$effect(() => {
		if (form?.success) showToast('success', 'Paramètres enregistrés.');
		else if (form?.error) showToast('error', form.error);
	});
</script>

<svelte:head>
	<title>Paramètres — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Paramètres compta</h1>

	<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Délai de grâce</h2>
	<form
		method="POST"
		action="?/update"
		class="border border-black p-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<p class="mb-4 text-sm text-gray-600">
			Nombre de jours pendant lesquels un membre garde son accès après la fin de sa dernière cotisation
			(statut « Cotisation à renouveler »). Passé ce délai, la cotisation est « expirée » et le compte est
			considéré comme inactif.
		</p>
		<label class="mb-1 block text-sm font-bold uppercase" for="delaiGraceJours">Jours</label>
		<input
			id="delaiGraceJours"
			name="delaiGraceJours"
			type="number"
			min="0"
			max="365"
			bind:value={delaiGraceJours}
			class="w-32 border border-black px-3 py-2 text-sm"
		/>
		<button type="submit" disabled={submitting} class="btn-primary mt-4 block px-4 py-2 disabled:opacity-50">
			{submitting ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>
</section>
