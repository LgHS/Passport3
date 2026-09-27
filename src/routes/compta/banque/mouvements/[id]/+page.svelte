<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
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

	// Which allocation form is open: an invoice, a free-amount dues payment, or "something else".
	let mode = $state<'facture' | 'cotisation' | 'autre'>('facture');
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
		<table class="mb-6 w-full border-collapse text-sm">
			<tbody>
				{#each data.lettrages as l (l.id)}
					<tr>
						<td class="border border-black px-3 py-2">
							{#if l.cibleHref}<a href={l.cibleHref}>{l.cibleLabel}</a>{:else}{l.cibleLabel}{/if}
						</td>
						<td class="border border-black px-3 py-2 text-right">{amountFormat.format(l.montant)}</td>
						<td class="border border-black px-2 py-1 text-right">
							<form method="POST" action="?/delettrer" use:enhance>
								<input type="hidden" name="lettrageId" value={l.id} />
								<button type="submit" class="border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">Retirer</button>
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
