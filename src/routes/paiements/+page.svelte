<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	const MODE = {
		banque: 'Virement',
		caisse: 'Caisse',
		manuel: 'Enregistré par la trésorerie',
		dolibarr: 'Historique Dolibarr'
	} as const;

	// Grouped by year, newest first, each with what was paid and what was paid back.
	const annees = $derived.by(() => {
		if (!data.found) return [];
		const groups = new Map<number, typeof data.paiements>();
		for (const p of data.paiements) {
			const y = p.date.getUTCFullYear();
			const list = groups.get(y);
			if (list) list.push(p);
			else groups.set(y, [p]);
		}
		return [...groups.entries()].map(([annee, paiements]) => ({
			annee,
			paiements,
			verse: paiements.filter((p) => p.montant > 0).reduce((a, p) => a + p.montant, 0),
			rembourse: paiements.filter((p) => p.montant < 0).reduce((a, p) => a - p.montant, 0)
		}));
	});
</script>

<svelte:head>
	<title>Mes paiements — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mes paiements</h1>

	{#if !data.found}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			Nous n'avons pas trouvé ta fiche dans la comptabilité. Contacte la trésorerie via
			<a href="mailto:compta@lghs.be">compta@lghs.be</a>.
		</p>
	{:else}
		{#if data.resteDu.length > 0}
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">À payer</h2>
			<div class="mb-8 space-y-2">
				{#each data.resteDu as d (d.factureId)}
					<div class="border border-black p-3 text-sm">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<p class="font-bold">Facture {d.numero}{d.pour ? ` — ${d.pour}` : ''}</p>
								<p class="text-gray-600">
									{d.reste < d.total ? `${amountFormat.format(d.reste)} restant sur ${amountFormat.format(d.total)}` : amountFormat.format(d.total)}
									{#if d.echeance}· échéance le {dateFormat.format(d.echeance)}{/if}
								</p>
							</div>
							<p class="font-bold">{amountFormat.format(d.reste)}</p>
						</div>
						{#if d.communication}
							<p class="mt-2 text-gray-600">
								Virement{data.iban ? ` sur ${data.iban}` : ''} avec la communication
								<span class="font-mono font-bold text-black">{d.communication}</span>.
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if annees.length === 0}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun paiement enregistré pour l’instant.</p>
		{:else}
			{#each annees as a (a.annee)}
				<h2 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">{a.annee}</h2>
				<p class="mb-3 text-sm text-gray-600">
					{amountFormat.format(a.verse)} versés{a.rembourse > 0 ? ` · ${amountFormat.format(a.rembourse)} remboursés par le hackerspace` : ''}
				</p>
				<table class="table-cards mb-8 w-full border-collapse text-sm">
					<thead>
						<tr class="bg-gray-100">
							<th class="border border-black px-3 py-2 text-left">Date</th>
							<th class="border border-black px-3 py-2 text-left">Pour</th>
							<th class="border border-black px-3 py-2 text-left">Moyen</th>
							<th class="border border-black px-3 py-2 text-right">Montant</th>
						</tr>
					</thead>
					<tbody>
						{#each a.paiements as p, i (i)}
							<tr>
								<td class="border border-black px-3 py-2 font-bold">{dateFormat.format(p.date)}</td>
								<td class="border border-black px-3 py-2" data-label="Pour">
									{p.objet}{#if p.pour}<span class="text-gray-600"> — {p.pour}</span>{/if}
								</td>
								<td class="border border-black px-3 py-2" data-label="Moyen">{MODE[p.mode]}</td>
								<td class="border border-black px-3 py-2 text-right {p.montant < 0 ? 'text-green-700' : ''}" data-label="Montant">
									{p.montant < 0 ? `+ ${amountFormat.format(-p.montant)} reçus` : amountFormat.format(p.montant)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/each}
			{#if data.paiements.some((p) => p.mode === 'dolibarr')}
				<p class="text-xs text-gray-500">
					Les paiements repris de Dolibarr sont datés du début de la cotisation ou de la date de la facture : Dolibarr ne
					gardait pas le jour du virement.
				</p>
			{/if}
		{/if}
	{/if}
</section>
