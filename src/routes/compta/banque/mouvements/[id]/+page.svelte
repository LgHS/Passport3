<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import { RUBRIQUE_LABEL, RUBRIQUES_DEPENSES, RUBRIQUES_RECETTES } from '$lib/rubriques';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const m = $derived(data.mouvement);
	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const fmt = (d: Date) => dateFormat.format(d);

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	let editing = $state(false);
	$effect(() => {
		if (form?.success) editing = false;
	});
	const isoDate = (d: Date) => d.toISOString().slice(0, 10);
	const smallBtn = 'border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white';

	// Which allocation form is open: an invoice, a free-amount dues payment, or "something else".
	let mode = $state<'facture' | 'cotisation' | 'note_de_frais' | 'autre'>('facture');
	let noteId = $state<number | null>(null);
	const noteChoisie = $derived(data.notes.find((n) => n.id === noteId) ?? null);
	let factureId = $state<number | null>(null);
	const factureChoisie = $derived(data.factures.find((f) => f.id === factureId) ?? null);
	// Default allocation: what's left on the movement, capped by what the invoice still owes.
	const montantDefaut = $derived(factureChoisie ? Math.min(m.reste, Math.abs(factureChoisie.total)) : m.reste);

	// First day of the movement's month — the usual period a monthly payment is for.
	const debutDefaut = $derived(m.dateValeur.toISOString().slice(0, 8) + '01');

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const h2Class = 'mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const tab = 'border border-black px-3 py-2 text-sm font-bold uppercase';
</script>

<svelte:head>
	<title>Mouvement du {fmt(m.dateValeur)} — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Mouvement du {fmt(m.dateValeur)}</h1>
		<a href="/compta/banque/{m.compteId}" class="text-sm">← {m.compteNom}</a>
	</div>

	{#if editing}
		<form method="POST" action="?/modifier" class="mb-6 grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
			{#if data.importe}
				<p class="text-sm text-gray-600 sm:col-span-3">
					Ce mouvement vient d'un extrait : sa date et son montant sont ceux de la banque et ne se modifient pas.
				</p>
			{:else}
				<div>
					<label class={labelClass} for="dateValeur">Date</label>
					<input id="dateValeur" name="dateValeur" type="date" required value={isoDate(m.dateValeur)} class={inputClass} />
				</div>
				{#if m.transfertId === null}
					<div>
						<label class={labelClass} for="sens">Sens</label>
						<select id="sens" name="sens" class={inputClass}>
							<option value="entree" selected={m.montant > 0}>Entrée</option>
							<option value="sortie" selected={m.montant < 0}>Sortie</option>
						</select>
					</div>
				{/if}
				<div>
					<label class={labelClass} for="montant-edit">Montant (€)</label>
					<input id="montant-edit" name="montant" type="text" inputmode="decimal" required value={Math.abs(m.montant).toFixed(2)} class={inputClass} />
				</div>
			{/if}
			<div class="sm:col-span-3">
				<label class={labelClass} for="libelle-edit">Libellé</label>
				<input id="libelle-edit" name="libelle" type="text" required value={m.libelle} class={inputClass} />
			</div>
			{#if m.transfertId === null}
				<div>
					<label class={labelClass} for="contrepartieNom">Contrepartie</label>
					<input id="contrepartieNom" name="contrepartieNom" type="text" value={m.contrepartieNom ?? ''} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="contrepartieIban">IBAN de la contrepartie</label>
					<input id="contrepartieIban" name="contrepartieIban" type="text" value={m.contrepartieIban ?? ''} class="{inputClass} font-mono uppercase" />
				</div>
				<div>
					<label class={labelClass} for="communication">Communication</label>
					<input id="communication" name="communication" type="text" value={m.communication ?? ''} class={inputClass} />
				</div>
			{:else}
				<p class="text-sm text-gray-600 sm:col-span-3">Virement interne : l'autre compte est corrigé en même temps.</p>
			{/if}
			<div class="flex gap-3 sm:col-span-3">
				<button type="submit" class="btn-primary px-4 py-2">Enregistrer</button>
				<button type="button" onclick={() => (editing = false)} class="border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Annuler</button>
			</div>
		</form>
	{:else}
		<div class="mb-3 flex flex-wrap gap-2">
			<button type="button" onclick={() => (editing = true)} class={smallBtn}>Corriger</button>
			<form
				method="POST"
				action="?/supprimer"
				use:enhance={({ cancel }) => {
					const quoi = m.transfertId !== null ? 'ce virement interne (ses deux écritures)' : 'ce mouvement';
					if (!confirm(`Supprimer ${quoi} ?${data.importe ? ' Il vient d’un extrait : le solde ne correspondra plus à celui de la banque.' : ''}`)) cancel();
					return async ({ update }) => update();
				}}
			>
				<button type="submit" disabled={m.lettre > 0} title={m.lettre > 0 ? 'Délettrez d’abord ce mouvement' : ''} class="{smallBtn} disabled:opacity-40">Supprimer</button>
			</form>
		</div>
	{/if}

	<dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-black p-4 text-sm">
		<dt class="font-bold uppercase">Montant</dt>
		<dd class="text-lg font-bold {m.montant < 0 ? 'text-red-700' : 'text-green-700'}">{amountFormat.format(m.montant)}</dd>
		<dt class="font-bold uppercase">Libellé</dt><dd>{m.libelle}</dd>
		<dt class="font-bold uppercase">Contrepartie</dt>
		<dd>
			{m.contrepartieNom ?? '—'}{m.contrepartieIban ? ` · ${m.contrepartieIban}` : ''}
			{#if data.tiersSuggere}
				→ <a href="/compta/tiers/{data.tiersSuggere.id}">{data.tiersSuggere.nom}</a>
			{/if}
		</dd>
		<dt class="font-bold uppercase">Communication</dt><dd class="font-mono">{m.communication ?? '—'}</dd>
		<dt class="font-bold uppercase">Reste à lettrer</dt>
		<dd class="font-bold {m.reste > 0 ? 'text-orange-600' : 'text-green-700'}">{amountFormat.format(m.reste)}{m.transfertId !== null ? ' (virement interne)' : ''}</dd>
	</dl>

	<h2 class={h2Class}>Lettrages</h2>
	{#if data.lettrages.length > 0}
		<table class="table-cards mb-6 w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class="border border-black px-3 py-2 text-left">Lettré sur</th>
					<th class="border border-black px-3 py-2 text-left">Rubrique des comptes annuels</th>
					<th class="border border-black px-3 py-2 text-right">Montant</th>
					<th class="border border-black px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.lettrages as l (l.id)}
					<tr>
						<td class="border border-black px-3 py-2">
							{#if l.cibleHref}<a href={l.cibleHref}>{l.cibleLabel}</a>{:else}{l.cibleLabel}{/if}
						</td>
						<td class="border border-black px-3 py-1" data-label="Rubrique">
							<form method="POST" action="?/rubrique" use:enhance>
								<input type="hidden" name="lettrageId" value={l.id} />
								<select name="rubrique" aria-label="Rubrique" onchange={(e) => e.currentTarget.form?.requestSubmit()} class="border border-black px-2 py-1 text-sm">
									{#if !l.rubriqueChoisie}<option value="" selected>{RUBRIQUE_LABEL[l.rubrique]} (par défaut)</option>{/if}
									{#each l.rubriqueSens === 'recette' ? RUBRIQUES_RECETTES : RUBRIQUES_DEPENSES as r (r)}
										<option value={r} selected={l.rubriqueChoisie && l.rubrique === r}>{RUBRIQUE_LABEL[r]}</option>
									{/each}
									{#if l.rubriqueChoisie}<option value="">Revenir à la rubrique par défaut</option>{/if}
								</select>
							</form>
						</td>
						<td class="border border-black px-3 py-2 sm:text-right" data-label="Montant">{amountFormat.format(l.montant)}</td>
						<td class="border border-black px-2 py-1 sm:text-right">
							<form method="POST" action="?/delettrer" use:enhance>
								<input type="hidden" name="lettrageId" value={l.id} />
								<button type="submit" class={smallBtn}>Retirer</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="mb-6 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun lettrage.</p>
	{/if}

	{#if m.reste > 0 && m.transfertId === null}
		<h2 class={h2Class}>Lettrer {amountFormat.format(m.reste)}</h2>
		<div class="mb-3 flex gap-1">
			<button type="button" onclick={() => (mode = 'facture')} class="{tab} {mode === 'facture' ? 'bg-black text-white' : ''}">Facture</button>
			{#if m.montant > 0}
				<button type="button" onclick={() => (mode = 'cotisation')} class="{tab} {mode === 'cotisation' ? 'bg-black text-white' : ''}">Cotisation libre</button>
			{:else if data.notes.length > 0}
				<button type="button" onclick={() => (mode = 'note_de_frais')} class="{tab} {mode === 'note_de_frais' ? 'bg-black text-white' : ''}">Note de frais</button>
			{/if}
			<button type="button" onclick={() => (mode = 'autre')} class="{tab} {mode === 'autre' ? 'bg-black text-white' : ''}">Autre</button>
		</div>

		{#if mode === 'facture'}
			<form method="POST" action="?/lettrer" class="grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
				<input type="hidden" name="cibleType" value="facture" />
				<div class="sm:col-span-2">
					<label class={labelClass} for="cibleId">{m.montant > 0 ? 'Facture émise à payer' : 'Facture reçue à payer'}</label>
					<select id="cibleId" name="cibleId" required bind:value={factureId} class={inputClass}>
						<option value={null}>—</option>
						{#each data.factures as f (f.id)}
							<option value={f.id}>
								{f.numero}{f.type === 'note_de_credit' ? ' (NC)' : ''} — {f.tiersNom} — {amountFormat.format(f.total)}{data.tiersSuggere && f.tiersId === data.tiersSuggere.id ? ' ★' : ''}
							</option>
						{/each}
					</select>
				</div>
				<div>
					<label class={labelClass} for="montant">Montant (€)</label>
					<input id="montant" name="montant" type="text" inputmode="decimal" value={montantDefaut.toFixed(2)} class={inputClass} />
				</div>
				<div class="sm:col-span-3"><button type="submit" class="btn-primary px-4 py-2">Lettrer</button></div>
			</form>
		{:else if mode === 'note_de_frais'}
			<form method="POST" action="?/lettrer" class="grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
				<input type="hidden" name="cibleType" value="note_de_frais" />
				<div class="sm:col-span-2">
					<label class={labelClass} for="note-cible">Note de frais acceptée</label>
					<select id="note-cible" name="cibleId" required bind:value={noteId} class={inputClass}>
						<option value={null}>—</option>
						{#each data.notes as n (n.id)}
							<option value={n.id}>{n.tiersNom} — {n.libelle} — {amountFormat.format(n.montant)}{data.tiersSuggere && n.tiersId === data.tiersSuggere.id ? ' ★' : ''}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class={labelClass} for="montant-note">Montant (€)</label>
					<input id="montant-note" name="montant" type="text" inputmode="decimal" value={(noteChoisie ? Math.min(m.reste, noteChoisie.montant) : m.reste).toFixed(2)} class={inputClass} />
				</div>
				<div class="sm:col-span-3"><button type="submit" class="btn-primary px-4 py-2">Lettrer</button></div>
			</form>
		{:else if mode === 'cotisation'}
			<form method="POST" action="?/cotisationLibre" class="grid gap-3 border border-black p-4 sm:grid-cols-4" use:enhance>
				<p class="text-sm text-gray-600 sm:col-span-4">
					Crée une cotisation « libre » de {amountFormat.format(m.reste)} pour la personne, payée par ce mouvement — la
					durée est votre décision d'après la communication, le montant ou ce que le membre a dit.
				</p>
				<div class="sm:col-span-2">
					<label class={labelClass} for="tiersId">Personne</label>
					<select id="tiersId" name="tiersId" required class={inputClass}>
						<option value="">—</option>
						{#each data.personnes as p (p.id)}
							<option value={p.id} selected={data.tiersSuggere?.id === p.id}>{p.nom}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class={labelClass} for="debut">Du</label>
					<input id="debut" name="debut" type="date" required value={debutDefaut} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="duree">Durée</label>
					<select id="duree" name="duree" class={inputClass}>
						<option value="mois">1 mois</option>
						<option value="annee">1 an</option>
					</select>
				</div>
				<div class="sm:col-span-4">
					<label class={labelClass} for="note">Note</label>
					<input id="note" name="note" type="text" value={m.communication ?? ''} class={inputClass} />
				</div>
				<div class="sm:col-span-4"><button type="submit" class="btn-primary px-4 py-2">Créer la cotisation</button></div>
			</form>
		{:else}
			<form method="POST" action="?/lettrer" class="grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
				<input type="hidden" name="cibleType" value="autre" />
				<div class="sm:col-span-2">
					<label class={labelClass} for="libelle">À quoi correspond ce mouvement</label>
					<input id="libelle" name="libelle" type="text" required placeholder="Frais bancaires, don, …" class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="montant-autre">Montant (€)</label>
					<input id="montant-autre" name="montant" type="text" inputmode="decimal" value={m.reste.toFixed(2)} class={inputClass} />
				</div>
				<div class="sm:col-span-3"><button type="submit" class="btn-primary px-4 py-2">Lettrer</button></div>
			</form>
		{/if}
	{/if}
</section>
