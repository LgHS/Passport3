<script lang="ts">
	import type { PageData } from './$types';
	import { FACTURE_STATUT_CLASS, FACTURE_STATUT_LABEL, factureStatutLabel } from '$lib/compta';

	let { data }: { data: PageData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const fmt = (d: Date | null) => (d ? dateFormat.format(d) : '—');

	const STATUTS = ['brouillon', 'validee', 'payee', 'annulee'] as const;
	function href(sens: string, statut: string | null): string {
		return `/compta/factures?sens=${sens}${statut ? `&statut=${statut}` : ''}`;
	}
	const tabClass = 'no-underline-fx border border-black px-3 py-2 text-sm';
	const activeClass = 'bg-black text-white';

	// What's still owed, per direction: unpaid validated invoices.
	const enCours = $derived(data.factures.filter((f) => f.statut === 'validee').reduce((a, f) => a + f.total, 0));
</script>

<svelte:head>
	<title>Factures — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Factures</h1>
		<a href="/compta/factures/nouvelle" class="no-underline-fx btn-primary inline-block px-4 py-2">Nouvelle facture</a>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-4">
		<nav class="flex gap-1">
			<a href={href('emise', data.statut)} class="{tabClass} {data.sens === 'emise' ? activeClass : ''}">Émises</a>
			<a href={href('recue', data.statut)} class="{tabClass} {data.sens === 'recue' ? activeClass : ''}">Reçues</a>
		</nav>
		<nav class="flex gap-1">
			<a href={href(data.sens, null)} class="{tabClass} {data.statut === null ? activeClass : ''}">Toutes</a>
			{#each STATUTS as s (s)}
				{#if !(data.sens === 'recue' && s === 'brouillon')}
					<a href={href(data.sens, s)} class="{tabClass} {data.statut === s ? activeClass : ''}">{FACTURE_STATUT_LABEL[s]}</a>
				{/if}
			{/each}
		</nav>
		{#if data.statut === null || data.statut === 'validee'}
			<p class="ml-auto text-sm">
				{data.sens === 'emise' ? 'À encaisser' : 'À payer'} : <span class="font-bold">{amountFormat.format(enCours)}</span>
			</p>
		{/if}
	</div>

	{#if data.factures.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Numéro</th>
						<th class="border border-black px-3 py-2 text-left">{data.sens === 'emise' ? 'Client' : 'Fournisseur'}</th>
						<th class="border border-black px-3 py-2 text-left">Date</th>
						<th class="border border-black px-3 py-2 text-left">Échéance</th>
						<th class="border border-black px-3 py-2 text-right">Montant</th>
						<th class="border border-black px-3 py-2 text-left">Statut</th>
					</tr>
				</thead>
				<tbody>
					{#each data.factures as f (f.id)}
						<tr class="group {f.statut === 'annulee' ? 'text-gray-400' : ''}">
							<td class="border border-black p-0">
								<a href="/compta/factures/{f.id}" class="no-underline-fx block px-3 py-2 font-mono transition-colors group-hover:bg-black group-hover:text-white">
									{f.numero ?? `brouillon #${f.id}`}{f.type === 'note_de_credit' ? ' (NC)' : ''}
								</a>
							</td>
							<td class="border border-black px-3 py-2">{f.tiers.nom}</td>
							<td class="border border-black px-3 py-2">{fmt(f.dateEmission)}</td>
							<td class="border border-black px-3 py-2">{fmt(f.dateEcheance)}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(f.total)}</td>
							<td class="border border-black px-3 py-2 {FACTURE_STATUT_CLASS[f.statut]}">{factureStatutLabel(f.statut, f.type)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune facture.</p>
	{/if}
</section>
