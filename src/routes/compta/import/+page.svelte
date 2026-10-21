<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let running = $state<'dry' | 'apply' | 'controle' | null>(null);

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
			Importe les tiers, adhérents, souscriptions, factures (clients et fournisseurs) avec leurs PDF, comptes
			bancaires et leurs écritures (voir
			<span class="font-mono">docs/compta.md</span> pour la correspondance). Rejouable : les lignes déjà importées
			sont mises à jour, pas dupliquées.
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

	<form
		method="POST"
		action="?/controle"
		class="mb-6 border border-black p-4 text-sm"
		use:enhance={() => {
			running = 'controle';
			return async ({ update }) => {
				await update({ reset: false });
				running = null;
			};
		}}
	>
		<p class="mb-3 text-gray-600">
			Une fois l’import appliqué, et avant de saisir quoi que ce soit dans Passport : compare Dolibarr et Passport chiffre par
			chiffre (tiers, factures, cotisations, soldes bancaires, adhérents en ordre aujourd’hui). Rien n’est écrit.
		</p>
		<button type="submit" disabled={running !== null} class="btn-primary px-4 py-2 disabled:opacity-50">
			{running === 'controle' ? 'Contrôle…' : 'Contrôler la reprise'}
		</button>
	</form>

	{#if form?.controle}
		{@const c = form.controle}
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
			Contrôle — {c.ecarts.length === 0 ? 'aucun écart' : `${c.ecarts.length} écart${c.ecarts.length > 1 ? 's' : ''}`}
		</h2>
		<table class="table-cards mb-4 w-full border-collapse text-sm">
			<thead>
				<tr class="bg-gray-100">
					<th class="border border-black px-3 py-2 text-left">Contrôle</th>
					<th class="border border-black px-3 py-2 text-right">Dolibarr</th>
					<th class="border border-black px-3 py-2 text-right">Passport</th>
					<th class="border border-black px-3 py-2 text-center">Résultat</th>
				</tr>
			</thead>
			<tbody>
				{#each c.lignes as l (l.domaine)}
					<tr>
						<td class="border border-black px-3 py-2 font-bold">{l.domaine}</td>
						<td class="border border-black px-3 py-2 text-right" data-label="Dolibarr">{l.dolibarr}</td>
						<td class="border border-black px-3 py-2 text-right" data-label="Passport">{l.passport}</td>
						<td class="border border-black px-3 py-2 text-center font-bold {l.ok ? '' : 'text-red-700'}" data-label="Résultat">
							{l.ok ? 'OK' : 'Écart'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if c.ecarts.length > 0}
			<h3 class="mb-2 text-sm font-bold uppercase">À vérifier</h3>
			<ul class="list-inside list-disc border border-black bg-gray-100 p-4 text-sm text-gray-700">
				{#each c.ecarts as e, i (i)}
					<li><span class="font-bold">{e.domaine}</span> — {e.detail}</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#if form?.report}
		{@const r = form.report}
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
			Résultat {r.dryRun ? '(simulation — annulée)' : ''}
		</h2>
		<div class="mb-4 grid gap-2 sm:grid-cols-3">
			{#each [{ label: 'Tiers', counts: r.tiers }, { label: 'Liens', counts: r.liens }, { label: 'Cotisations', counts: r.cotisations }, { label: 'Factures', counts: r.factures }, { label: 'Comptes', counts: r.comptes }, { label: 'Écritures bancaires', counts: r.mouvements }] as row (row.label)}
				<div class="border border-black p-3 text-sm">
					<p class="font-bold uppercase">{row.label}</p>
					<p>{row.counts.created} créé(s), {row.counts.updated} {row.label === 'Écritures bancaires' ? 'déjà connue(s)' : 'mis à jour'}</p>
				</div>
			{/each}
			<div class="border border-black p-3 text-sm">
				<p class="font-bold uppercase">Comptes Authentik</p>
				<p>{r.authentikLinked} lié(s) par email</p>
			</div>
			<div class="border border-black p-3 text-sm">
				<p class="font-bold uppercase">PDF archivés</p>
				<p>{r.pdfs}{r.dryRun ? ' (téléchargés seulement à l’application)' : ''}</p>
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
