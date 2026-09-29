<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import { RUBRIQUE_LABEL, RUBRIQUES_DEPENSES, RUBRIQUES_RECETTES } from '$lib/rubriques';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const c = $derived(data.comptes);
	const p = $derived(data.patrimoine);
	let submitting = $state(false);

	$effect(() => {
		if (form?.success) showToast('success', 'Annexe enregistrée.');
		else if (form?.error) showToast('error', form.error);
	});

	const numberFormat = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
	const saisi = (n: number) => (n ? numberFormat.format(n) : '');
	const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const j = $derived(data.journal);

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	const LABEL: Record<string, string> = RUBRIQUE_LABEL;
	const RECETTES = RUBRIQUES_RECETTES;
	const DEPENSES = RUBRIQUES_DEPENSES;

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
			<a href="/compta/journal/csv?annee={j.annee}" class="no-underline-fx inline-block border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Journal CSV</a>
			<a href="/compta/journal/comptes-annuels?annee={j.annee}" class="no-underline-fx btn-primary inline-block px-4 py-2">Comptes annuels PDF</a>
		</div>
	</div>

	{#if nonLettre > 0}
		<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm">
			<span class="font-bold">{amountFormat.format(nonLettre)}</span> de mouvements ne sont pas encore lettrés : ils apparaissent en
			« Non lettré » et ne sont rangés dans aucune rubrique. <a href="/compta/banque">Lettrer</a> avant de clôturer : d'ici là, le PDF des comptes
			annuels porte la mention « Projet ».
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
			<p class="mb-2 text-xs font-bold uppercase">Comptes et caisses au {dateFormat.format(j.patrimoine.date)}</p>
			<dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
				{#each j.patrimoine.comptes as cpt (cpt.nom)}
					<dt>{cpt.nom} <span class="text-gray-500">({cpt.type})</span></dt><dd class="text-right">{amountFormat.format(cpt.solde)}</dd>
				{/each}
				<dt class="font-bold">Liquidités</dt><dd class="text-right font-bold">{amountFormat.format(j.patrimoine.totalComptes)}</dd>
			</dl>
		</div>
	</div>

	<h2 class={h2Class}>Annexe des comptes annuels {j.annee}</h2>
	<form
		method="POST"
		action="?/annexe&annee={j.annee}"
		class="mb-10 border border-black p-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<p class="mb-4 text-sm text-gray-600">
			Modèle minimum des petites associations (AR du 29 avril 2019, annexe 8). Les liquidités, créances et dettes viennent
			des comptes, factures et notes de frais ; le reste vient de l'inventaire et se renseigne ici. Sur une ligne calculée,
			le montant saisi est un ajustement qui s'ajoute.
		</p>
		<div class="mb-6 grid gap-4 md:grid-cols-2">
			<div>
				<label class={labelClass} for="reglesEvaluation">1. Résumé des règles d'évaluation</label>
				<textarea id="reglesEvaluation" name="reglesEvaluation" rows="4" class={inputClass}>{c.reglesEvaluation}</textarea>
			</div>
			<div>
				<label class={labelClass} for="adaptationRegles">2. Adaptation des règles d'évaluation</label>
				<textarea id="adaptationRegles" name="adaptationRegles" rows="4" class={inputClass}>{c.adaptationRegles}</textarea>
			</div>
			<div class="md:col-span-2">
				<label class={labelClass} for="informationsComplementaires">3. Informations complémentaires</label>
				<textarea id="informationsComplementaires" name="informationsComplementaires" rows="3" class={inputClass}>{c.informationsComplementaires}</textarea>
			</div>
		</div>

		{#snippet lignes(titre: string, rows: typeof p.avoirs, total: number | null)}
			<table class="table-cards mb-6 w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">{titre}</th>
						<th class="border border-black px-3 py-2 text-right">D'après les livres</th>
						<th class="border border-black px-3 py-2 text-right">Saisi</th>
						<th class="border border-black px-3 py-2 text-right">Montant</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as l (l.key)}
						<tr>
							<td class="border border-black px-3 py-2 {l.sousLigne ? 'sm:pl-8' : ''} {l.titre ? 'font-bold' : ''}">{l.sousLigne ? '– ' : ''}{l.label}</td>
							{#if l.titre}
								<td class="hidden border border-black sm:table-cell" colspan="3"></td>
							{:else}
								<td class="border border-black px-3 py-2 sm:text-right" data-label="D'après les livres">{l.calculeMontant === null ? '' : amountFormat.format(l.calculeMontant)}</td>
								<td class="border border-black px-3 py-1 sm:text-right" data-label={l.calcule ? 'Ajustement' : 'Saisi'}>
									<input name="montant_{l.key}" type="text" inputmode="decimal" value={saisi(l.saisi)} placeholder="0,00" aria-label="{l.label} — montant saisi" class="w-28 border border-black px-2 py-1 text-right text-sm" />
								</td>
								<td class="border border-black px-3 py-2 font-bold sm:text-right" data-label="Montant">{amountFormat.format(l.montant)}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
				{#if total !== null}
					<tfoot>
						<tr class="font-bold">
							<td class="hidden border border-black px-3 py-2 text-right sm:table-cell" colspan="3">Total</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Total">{amountFormat.format(total)}</td>
						</tr>
					</tfoot>
				{/if}
			</table>
		{/snippet}

		<p class="mb-2 text-xs font-bold uppercase">4. État du patrimoine au 31 décembre {j.annee}</p>
		{@render lignes('Avoirs', p.avoirs, p.totalAvoirs)}
		{@render lignes('Dettes', p.dettes, p.totalDettes)}

		<p class="mb-2 text-xs font-bold uppercase">5. Droits et engagements</p>
		{@render lignes('Droits', p.droits, null)}
		{@render lignes('Engagements', p.engagements, null)}
		<label class={labelClass} for="droitsEngagementsTexte">Droits et engagements importants qui ne sont pas susceptibles d'être quantifiés</label>
		<textarea id="droitsEngagementsTexte" name="droitsEngagementsTexte" rows="3" class="{inputClass} mb-6">{c.droitsEngagementsTexte}</textarea>

		<div class="flex flex-wrap items-end gap-4">
			<div>
				<label class={labelClass} for="approuvesLe">Approuvés par l'assemblée générale le</label>
				<input id="approuvesLe" name="approuvesLe" type="date" value={isoDate(c.approuvesLe)} class="border border-black px-3 py-2 text-sm" />
			</div>
			<button type="submit" disabled={submitting} class="btn-primary px-4 py-2 disabled:opacity-50">{submitting ? 'Enregistrement…' : 'Enregistrer l’annexe'}</button>
			{#if c.updatedBy && c.updatedAt}
				<p class="text-xs text-gray-600">Dernière modification par {c.updatedBy}, le {dateFormat.format(c.updatedAt)}</p>
			{/if}
		</div>
	</form>

	<h2 class={h2Class}>
		Livre journal {rubrique ? `— ${LABEL[rubrique]}` : ''}
		{#if rubrique}<button type="button" onclick={() => (rubrique = null)} class="text-xs underline">Tout afficher</button>{/if}
	</h2>
	{#if lignes.length > 0}
		<div>
			<table class="table-cards w-full border-collapse text-sm">
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
							<td class="border border-black px-3 py-2 whitespace-nowrap" data-label="Date">
								<a href="/compta/banque/mouvements/{l.id}">{dateFormat.format(l.date)}</a>
							</td>
							<td class="border border-black px-3 py-2" data-label="Compte">{l.compte}</td>
							<td class="border border-black px-3 py-2">
								{l.libelle}{l.contrepartie ? ` — ${l.contrepartie}` : ''}
								{#if l.detail}<span class="block text-xs text-gray-500">{l.detail}</span>{/if}
							</td>
							<td class="border border-black px-3 py-2" data-label="Rubrique">{LABEL[l.rubrique]}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Recette">{l.montant >= 0 ? amountFormat.format(l.montant) : ''}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Dépense">{l.montant < 0 ? amountFormat.format(-l.montant) : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun mouvement sur cet exercice.</p>
	{/if}
</section>
