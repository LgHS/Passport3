<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let running = $state<'dry' | 'apply' | null>(null);

	$effect(() => {
		if (form?.error) showToast('error', form.error);
		else if (form?.report && !form.report.dryRun) showToast('success', 'Import appliqué.');
	});
</script>

<svelte:head>
	<title>Import Dolibarr — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Import Dolibarr</h1>

	<div class="mb-6 border border-black p-4 text-sm">
		<p>
			Source : <span class="font-mono">{data.dolibarrUrl ?? '(DOLIBARR_URL non configuré)'}</span>
		</p>
		<p class="mt-2 text-gray-600">
			Importe les tiers, adhérents et souscriptions (voir <span class="font-mono">docs/compta.md</span> pour la
			correspondance). Rejouable : les lignes déjà importées sont mises à jour, pas dupliquées. Les factures
			viendront avec le module Factures.
		</p>
		<p class="mt-2 text-gray-600">
			Actuellement : {data.counts.tiers} tiers ({data.counts.imported} venant de Dolibarr), {data.counts.cotisations}
			cotisations.
		</p>
	</div>

	<form
		method="POST"
		action="?/run"
		class="mb-6 flex flex-wrap gap-2"
		use:enhance={({ formData }) => {
			running = formData.get('mode') === 'apply' ? 'apply' : 'dry';
			return async ({ update }) => {
				await update({ reset: false });
				running = null;
			};
		}}
	>
		<button type="submit" name="mode" value="dry" disabled={running !== null} class="btn-primary px-4 py-2 disabled:opacity-50">
			{running === 'dry' ? 'Simulation…' : 'Simuler (rien n’est écrit)'}
		</button>
		<button
			type="submit"
			name="mode"
			value="apply"
			disabled={running !== null}
			onclick={(e) => {
				if (!confirm('Appliquer l’import dans la base Passport ?')) e.preventDefault();
			}}
			class="border border-black px-4 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:opacity-50"
		>
			{running === 'apply' ? 'Import…' : 'Appliquer'}
		</button>
	</form>

	{#if form?.report}
		{@const r = form.report}
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
			Résultat {r.dryRun ? '(simulation — annulée)' : ''}
		</h2>
		<div class="mb-4 grid gap-2 sm:grid-cols-4">
			{#each [{ label: 'Tiers', counts: r.tiers }, { label: 'Liens', counts: r.liens }, { label: 'Cotisations', counts: r.cotisations }] as row (row.label)}
				<div class="border border-black p-3 text-sm">
					<p class="font-bold uppercase">{row.label}</p>
					<p>{row.counts.created} créé(s), {row.counts.updated} mis à jour</p>
				</div>
			{/each}
			<div class="border border-black p-3 text-sm">
				<p class="font-bold uppercase">Comptes Authentik</p>
				<p>{r.authentikLinked} lié(s) par email</p>
			</div>
		</div>
		{#if r.warnings.length > 0}
			<h3 class="mb-2 text-sm font-bold uppercase">Avertissements ({r.warnings.length})</h3>
			<ul class="list-inside list-disc border border-black bg-gray-100 p-4 text-sm text-gray-700">
				{#each r.warnings as w, i (i)}
					<li>{w}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
