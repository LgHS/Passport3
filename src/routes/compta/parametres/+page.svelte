<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	// Seeded once from the load/form result — the form owns its values once the treasurer types.
	// svelte-ignore state_referenced_locally
	let v = $state({ ...(form?.values ?? data.settings) });

	$effect(() => {
		if (form?.success) showToast('success', 'Paramètres enregistrés.');
		else if (form?.error) showToast('error', form.error);
	});

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
</script>

<svelte:head>
	<title>Paramètres — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Paramètres compta</h1>

	<form
		method="POST"
		action="?/update"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Adhésions</h2>
		<div class="mb-8 border border-black p-4">
			<p class="mb-4 text-sm text-gray-600">
				Nombre de jours pendant lesquels un membre garde son accès après la fin de sa dernière cotisation
				(statut « Cotisation à renouveler »). Passé ce délai, la cotisation est « expirée » et le compte est
				considéré comme inactif.
			</p>
			<label class={labelClass} for="delaiGraceJours">Délai de grâce (jours)</label>
			<input id="delaiGraceJours" name="delaiGraceJours" type="number" min="0" max="365" bind:value={v.delaiGraceJours} class="w-32 border border-black px-3 py-2 text-sm" />
		</div>

		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Factures émises</h2>
		<div class="mb-8 grid gap-3 border border-black p-4 sm:grid-cols-2">
			<div>
				<label class={labelClass} for="emetteurNom">Émetteur</label>
				<input id="emetteurNom" name="emetteurNom" type="text" required bind:value={v.emetteurNom} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="emetteurNumeroEntreprise">N° d'entreprise</label>
				<input id="emetteurNumeroEntreprise" name="emetteurNumeroEntreprise" type="text" bind:value={v.emetteurNumeroEntreprise} class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="emetteurAdresse">Adresse (une ligne par ligne d'adresse)</label>
				<textarea id="emetteurAdresse" name="emetteurAdresse" rows="3" bind:value={v.emetteurAdresse} class={inputClass}></textarea>
			</div>
			<div>
				<label class={labelClass} for="emetteurEmail">Email</label>
				<input id="emetteurEmail" name="emetteurEmail" type="email" bind:value={v.emetteurEmail} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="emetteurIban">IBAN à payer</label>
				<input id="emetteurIban" name="emetteurIban" type="text" bind:value={v.emetteurIban} class="{inputClass} font-mono uppercase" />
			</div>
			<div>
				<label class={labelClass} for="delaiPaiementJours">Délai de paiement par défaut (jours)</label>
				<input id="delaiPaiementJours" name="delaiPaiementJours" type="number" min="0" max="365" bind:value={v.delaiPaiementJours} class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="mentionTva">Mention TVA (imprimée sur chaque facture)</label>
				<input id="mentionTva" name="mentionTva" type="text" required bind:value={v.mentionTva} class={inputClass} />
			</div>
		</div>

		<button type="submit" disabled={submitting} class="btn-primary px-4 py-2 disabled:opacity-50">
			{submitting ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>
</section>
