<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	let releveEnCours = $state(false);

	$effect(() => {
		if (form?.error) showToast('error', form.error);
		else if (form?.releve) {
			const r = form.releve;
			if (r.erreurs.length > 0) showToast('error', `${r.erreurs.length} mail(s) n'ont pas pu être relevés.`);
			else if (r.messages === 0) showToast('success', 'Aucun nouveau mail.');
			else showToast('success', `${r.messages} mail(s) relevé(s), ${r.documents} facture(s) trouvée(s).`);
		}
	});

	const TABS = [
		{ statut: 'a_traiter', label: 'À valider' },
		{ statut: 'importe', label: 'Importées' },
		{ statut: 'ignore', label: 'Écartées' }
	] as const;
	const tabClass = 'no-underline-fx border border-black px-3 py-2 text-sm';
	const th = 'border border-black px-3 py-2 text-left';
	const td = 'border border-black px-3 py-2';
</script>

<svelte:head>
	<title>Réception Doccle — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Réception Doccle</h1>
		<form
			method="POST"
			action="?/relever"
			use:enhance={() => {
				releveEnCours = true;
				return async ({ update }) => {
					await update();
					releveEnCours = false;
				};
			}}
		>
			<button type="submit" disabled={releveEnCours || !data.boite} class="btn-primary px-4 py-2 disabled:opacity-50">
				{releveEnCours ? 'Relevé en cours…' : 'Relever la boîte'}
			</button>
		</form>
	</div>

	<p class="mb-6 border border-black bg-gray-100 px-4 py-3 text-sm">
		{#if data.boite}
			Boîte <span class="font-bold">{data.boite}</span> — mails de <span class="font-mono">{data.domaines}</span>, relevé
			{data.auto ? 'automatique toutes les heures' : 'à la demande'}. Rien n'entre dans les factures sans validation.
		{:else}
			Aucune boîte Gmail connectée : <a href="/compta/parametres#gmail">connectez-la dans les paramètres</a>.
		{/if}
	</p>

	<nav class="mb-4 flex gap-1">
		{#each TABS as t (t.statut)}
			<a href="/compta/reception?statut={t.statut}" class="{tabClass} {data.statut === t.statut ? 'bg-black text-white' : ''}">{t.label}</a>
		{/each}
	</nav>

	{#if data.documents.length > 0}
		<table class="table-cards w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class={th}>Reçu le</th>
					<th class={th}>Fournisseur</th>
					<th class={th}>Numéro</th>
					<th class="{th} text-right">Montant</th>
					<th class={th}>Pièces</th>
					<th class={th}>Origine</th>
					<th class={th}></th>
				</tr>
			</thead>
			<tbody>
				{#each data.documents as d (d.id)}
					<tr>
						<td class={td} data-label="Reçu le">{dateTimeFormat.format(d.recuLe)}</td>
						<td class={td} data-label="Fournisseur">
							<span>
								{d.fournisseur ?? '—'}
								<span class="block text-xs text-gray-600">{d.sujet}</span>
							</span>
						</td>
						<td class={td} data-label="Numéro">{d.numero ?? '—'}</td>
						<td class="{td} sm:text-right" data-label="Montant">{d.total === null ? '—' : amountFormat.format(d.total)}</td>
						<td class={td} data-label="Pièces">{[d.pdf && 'PDF', d.ubl && 'UBL'].filter(Boolean).join(' + ')}</td>
						<td class={td} data-label="Origine">
							{#if d.verifie}
								<span class="font-bold text-green-700">Prouvée</span>
							{:else}
								<span class="font-bold text-red-700">Non prouvée</span>
							{/if}
							<span class="block text-xs text-gray-600">{d.expediteur}</span>
						</td>
						<td class="{td} sm:text-center">
							<a href="/compta/reception/{d.id}" class="font-bold">{data.statut === 'a_traiter' ? 'Vérifier' : 'Voir'}</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			{data.statut === 'a_traiter' ? 'Aucune facture à valider.' : 'Rien ici.'}
		</p>
	{/if}
</section>
