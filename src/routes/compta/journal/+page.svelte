<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const j = $derived(data.journal);

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	// Mirrors journal.ts's RUBRIQUE_LABEL / RECETTES / DEPENSES — kept here rather than imported so
	// no server module reaches the browser bundle.
	const LABEL: Record<string, string> = {
		cotisations: 'Cotisations',
		dons_sponsoring: 'Dons et sponsoring',
		ventes_prestations: 'Ventes et prestations',
		autres_recettes: 'Autres recettes',
		achats_services: 'Achats et services',
		remboursements_frais: 'Remboursements de frais',
		autres_depenses: 'Autres dépenses',
		non_lettre: 'Non lettré'
	};
	const RECETTES = ['cotisations', 'dons_sponsoring', 'ventes_prestations', 'autres_recettes'] as const;
	const DEPENSES = ['achats_services', 'remboursements_frais', 'autres_depenses'] as const;

	// Indexed by the string keys above, so the two Record<Rubrique, number> are widened here.
	const recettes = $derived(j.recettes as Record<string, number>);
	const depenses = $derived(j.depenses as Record<string, number>);
	let rubrique = $state<string | null>(null);
	const lignes = $derived(rubrique ? j.lignes.filter((l) => l.rubrique === rubrique) : j.lignes);
	const nonLettre = $derived(j.recettes.non_lettre + j.depenses.non_lettre);
	const h2Class = 'mb-4 flex flex-wrap items-center justify-between gap-2 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const tab = 'no-underline-fx border border-black px-3 py-2 text-sm';
</script>

<svelte:head>
	<title>Journal {j.annee} — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Journal &amp; comptes {j.annee}</h1>
		<div class="flex flex-wrap items-center gap-2">
			<nav class="flex gap-1">
				{#each data.annees as a (a)}
					<a href="/compta/journal?annee={a}" class="{tab} {a === j.annee ? 'bg-black text-white' : ''}">{a}</a>
				{/each}
			</nav>
			<a href="/compta/journal/csv?annee={j.annee}" class="no-underline-fx btn-primary inline-block px-4 py-2">Export CSV</a>
		</div>
	</div>

	{#if nonLettre > 0}
		<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm">
			<span class="font-bold">{amountFormat.format(nonLettre)}</span> de mouvements ne sont pas encore lettrés : ils apparaissent en
			« Non lettré » et ne sont rangés dans aucune rubrique. <a href="/compta/banque">Lettrer</a> avant de clôturer.
		</p>
	{/if}

	<div class="mb-8 grid gap-6 md:grid-cols-2">
		<div>
			<h2 class={h2Class}>Recettes <span class="text-xs normal-case">{amountFormat.format(j.totalRecettes)}</span></h2>
			<table class="w-full border-collapse text-sm">
				<tbody>
					{#each [...RECETTES, 'non_lettre'] as r (r)}
						{#if r !== 'non_lettre' || j.recettes.non_lettre > 0}
							<tr class="cursor-pointer hover:bg-gray-100 {rubrique === r ? 'bg-gray-100 font-bold' : ''}" onclick={() => (rubrique = rubrique === r ? null : r)}>
								<td class="border border-black px-3 py-2 {r === 'non_lettre' ? 'text-orange-600' : ''}">{LABEL[r]}</td>
								<td class="border border-black px-3 py-2 text-right">{amountFormat.format(recettes[r])}</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<div>
			<h2 class={h2Class}>Dépenses <span class="text-xs normal-case">{amountFormat.format(j.totalDepenses)}</span></h2>
			<table class="w-full border-collapse text-sm">
				<tbody>
					{#each [...DEPENSES, 'non_lettre'] as r (r)}
						{#if r !== 'non_lettre' || j.depenses.non_lettre > 0}
							<tr class="cursor-pointer hover:bg-gray-100 {rubrique === r ? 'bg-gray-100 font-bold' : ''}" onclick={() => (rubrique = rubrique === r ? null : r)}>
								<td class="border border-black px-3 py-2 {r === 'non_lettre' ? 'text-orange-600' : ''}">{LABEL[r]}</td>
								<td class="border border-black px-3 py-2 text-right">{amountFormat.format(depenses[r])}</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div class="mb-8 grid gap-6 md:grid-cols-2">
		<div class="border border-black p-4">
			<p class="text-xs font-bold uppercase">Résultat de l'exercice</p>
			<p class="text-2xl font-bold {j.resultat < 0 ? 'text-red-700' : 'text-green-700'}">{amountFormat.format(j.resultat)}</p>
			<p class="text-xs text-gray-600">recettes − dépenses, virements internes exclus</p>
		</div>
		<div class="border border-black p-4 text-sm">
			<p class="mb-2 text-xs font-bold uppercase">État du patrimoine au {dateFormat.format(j.patrimoine.date)}</p>
			<dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
				{#each j.patrimoine.comptes as c (c.nom)}
					<dt>{c.nom} <span class="text-gray-500">({c.type})</span></dt><dd class="text-right">{amountFormat.format(c.solde)}</dd>
				{/each}
				<dt class="font-bold">Avoirs (comptes et caisses)</dt><dd class="text-right font-bold">{amountFormat.format(j.patrimoine.totalComptes)}</dd>
				<dt>Créances (factures émises non payées)</dt><dd class="text-right">{amountFormat.format(j.patrimoine.creances)}</dd>
				<dt>Dettes fournisseurs (factures reçues non payées)</dt><dd class="text-right">{amountFormat.format(j.patrimoine.dettesFournisseurs)}</dd>
				<dt>Dettes envers les membres (notes de frais acceptées)</dt><dd class="text-right">{amountFormat.format(j.patrimoine.dettesFrais)}</dd>
			</dl>
		</div>
	</div>

	<h2 class={h2Class}>
		Livre journal {rubrique ? `— ${LABEL[rubrique]}` : ''}
		{#if rubrique}<button type="button" onclick={() => (rubrique = null)} class="text-xs underline">Tout afficher</button>{/if}
	</h2>
	{#if lignes.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Date</th>
						<th class="border border-black px-3 py-2 text-left">Compte</th>
						<th class="border border-black px-3 py-2 text-left">Libellé</th>
						<th class="border border-black px-3 py-2 text-left">Rubrique</th>
						<th class="border border-black px-3 py-2 text-right">Recette</th>
						<th class="border border-black px-3 py-2 text-right">Dépense</th>
					</tr>
				</thead>
				<tbody>
					{#each lignes as l, i (`${l.id}-${i}`)}
						<tr class={l.rubrique === 'non_lettre' ? 'text-orange-700' : ''}>
							<td class="border border-black px-3 py-2 whitespace-nowrap">
								<a href="/compta/banque/mouvements/{l.id}">{dateFormat.format(l.date)}</a>
							</td>
							<td class="border border-black px-3 py-2">{l.compte}</td>
							<td class="border border-black px-3 py-2">
								{l.libelle}{l.contrepartie ? ` — ${l.contrepartie}` : ''}
								{#if l.detail}<span class="block text-xs text-gray-500">{l.detail}</span>{/if}
							</td>
							<td class="border border-black px-3 py-2">{LABEL[l.rubrique]}</td>
							<td class="border border-black px-3 py-2 text-right">{l.montant >= 0 ? amountFormat.format(l.montant) : ''}</td>
							<td class="border border-black px-3 py-2 text-right">{l.montant < 0 ? amountFormat.format(-l.montant) : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun mouvement sur cet exercice.</p>
	{/if}
</section>
