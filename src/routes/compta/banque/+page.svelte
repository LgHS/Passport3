<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const today = new Date().toLocaleDateString('en-CA');

	// svelte-ignore state_referenced_locally
	let compteFormOpen = $state(form?.section === 'compte' && !!form.error);
	// svelte-ignore state_referenced_locally
	let virementFormOpen = $state(form?.section === 'virement' && !!form.error);

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	const v = (key: string) => form?.values?.[key] ?? '';
	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const h2Class = 'mb-4 flex flex-wrap items-center justify-between gap-2 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const total = $derived(data.comptes.filter((c) => c.actif).reduce((a, c) => a + c.solde, 0));
</script>

<svelte:head>
	<title>Banque &amp; caisse — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Banque &amp; caisse</h1>

	<h2 class={h2Class}>
		Comptes <span class="text-xs font-normal normal-case opacity-80">total {amountFormat.format(total)}</span>
		<span class="flex gap-3">
			<button type="button" onclick={() => (virementFormOpen = !virementFormOpen)} class="text-xs underline">Virement interne</button>
			<button type="button" onclick={() => (compteFormOpen = !compteFormOpen)} class="text-xs underline">{compteFormOpen ? 'Fermer' : 'Nouveau compte'}</button>
		</span>
	</h2>

	{#if compteFormOpen}
		<form method="POST" action="?/createCompte" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-4" use:enhance>
			<div>
				<label class={labelClass} for="type">Type</label>
				<select id="type" name="type" class={inputClass}>
					<option value="banque" selected={v('type') !== 'caisse'}>Banque</option>
					<option value="caisse" selected={v('type') === 'caisse'}>Caisse</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="nom">Nom</label>
				<input id="nom" name="nom" type="text" required value={v('nom')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="iban">IBAN (banque)</label>
				<input id="iban" name="iban" type="text" value={v('iban')} class="{inputClass} font-mono uppercase" />
			</div>
			<div>
				<label class={labelClass} for="soldeOuverture">Solde d'ouverture (€)</label>
				<input id="soldeOuverture" name="soldeOuverture" type="text" inputmode="decimal" value={v('soldeOuverture') || '0'} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="dateOuverture">Date d'ouverture</label>
				<input id="dateOuverture" name="dateOuverture" type="date" value={v('dateOuverture') || today} class={inputClass} />
			</div>
			<div class="sm:col-span-4"><button type="submit" class="btn-primary px-4 py-2">Créer</button></div>
		</form>
	{/if}

	{#if virementFormOpen}
		<form method="POST" action="?/virement" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-5" use:enhance>
			<div>
				<label class={labelClass} for="deId">De</label>
				<select id="deId" name="deId" required class={inputClass}>
					{#each data.comptes.filter((c) => c.actif) as c (c.id)}<option value={c.id}>{c.nom}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelClass} for="versId">Vers</label>
				<select id="versId" name="versId" required class={inputClass}>
					{#each data.comptes.filter((c) => c.actif) as c (c.id)}<option value={c.id}>{c.nom}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelClass} for="montant">Montant (€)</label>
				<input id="montant" name="montant" type="text" inputmode="decimal" required value={v('montant')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="dateValeur">Date</label>
				<input id="dateValeur" name="dateValeur" type="date" value={v('dateValeur') || today} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="libelle">Libellé</label>
				<input id="libelle" name="libelle" type="text" placeholder="Dépôt caisse" value={v('libelle')} class={inputClass} />
			</div>
			<div class="sm:col-span-5"><button type="submit" class="btn-primary px-4 py-2">Enregistrer le virement</button></div>
		</form>
	{/if}

	{#if data.comptes.length > 0}
		<div class="mb-8 overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Compte</th>
						<th class="border border-black px-3 py-2 text-left">Type</th>
						<th class="border border-black px-3 py-2 text-left">IBAN</th>
						<th class="border border-black px-3 py-2 text-right">Solde</th>
						<th class="border border-black px-3 py-2 text-right">À lettrer</th>
					</tr>
				</thead>
				<tbody>
					{#each data.comptes as c (c.id)}
						<tr class="group {c.actif ? '' : 'text-gray-400'}">
							<td class="border border-black p-0">
								<a href="/compta/banque/{c.id}" class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white">{c.nom}</a>
							</td>
							<td class="border border-black px-3 py-2">{c.type === 'banque' ? 'Banque' : 'Caisse'}</td>
							<td class="border border-black px-3 py-2 font-mono text-xs">{c.iban ?? '—'}</td>
							<td class="border border-black px-3 py-2 text-right font-bold">{amountFormat.format(c.solde)}</td>
							<td class="border border-black px-3 py-2 text-right {c.nonLettres > 0 ? 'text-orange-600' : ''}">{c.nonLettres}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun compte — créez-en un ou lancez l'import Dolibarr.</p>
	{/if}

	<h2 class={h2Class}>Mouvements à lettrer</h2>
	{#if data.nonLettres.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Date</th>
						<th class="border border-black px-3 py-2 text-left">Compte</th>
						<th class="border border-black px-3 py-2 text-left">Libellé</th>
						<th class="border border-black px-3 py-2 text-left">Contrepartie</th>
						<th class="border border-black px-3 py-2 text-right">Montant</th>
						<th class="border border-black px-3 py-2 text-right">Reste</th>
					</tr>
				</thead>
				<tbody>
					{#each data.nonLettres as m (m.id)}
						<tr class="group">
							<td class="border border-black p-0">
								<a href="/compta/banque/mouvements/{m.id}" class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white">{dateFormat.format(m.dateValeur)}</a>
							</td>
							<td class="border border-black px-3 py-2">{m.compteNom}</td>
							<td class="border border-black px-3 py-2">{m.libelle}{m.communication ? ` — ${m.communication}` : ''}</td>
							<td class="border border-black px-3 py-2">{m.contrepartieNom ?? m.contrepartieIban ?? '—'}</td>
							<td class="border border-black px-3 py-2 text-right {m.montant < 0 ? 'text-red-700' : 'text-green-700'}">{amountFormat.format(m.montant)}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(m.reste)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Tout est lettré.</p>
	{/if}
</section>
