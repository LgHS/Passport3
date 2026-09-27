<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const c = $derived(data.compte);
	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const today = new Date().toLocaleDateString('en-CA');
	const iso = (d: Date) => d.toISOString().slice(0, 10);

	// svelte-ignore state_referenced_locally
	let importOpen = $state(form?.section === 'import');
	// svelte-ignore state_referenced_locally
	let mouvementOpen = $state(form?.section === 'mouvement' && !!form.error);
	// svelte-ignore state_referenced_locally
	let compteOpen = $state(form?.section === 'compte' && !!form.error);
	let importing = $state(false);

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	const v = (key: string) => form?.values?.[key] ?? '';
	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const h2Class = 'mb-4 flex flex-wrap items-center justify-between gap-2 bg-black px-4 py-3 text-base font-bold text-white uppercase';

	// Running balance, newest first: start from the current balance and walk back.
	const rows = $derived.by(() => {
		let solde = c.solde;
		return data.mouvements.map((m) => {
			const row = { m, solde };
			solde = Math.round((solde - m.montant) * 100) / 100;
			return row;
		});
	});
</script>

<svelte:head>
	<title>{c.nom} — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">
			{c.nom}
			<span class="ml-2 text-xs font-normal opacity-70">{c.type === 'banque' ? 'Banque' : 'Caisse'}{c.iban ? ` · ${c.iban}` : ''}</span>
		</h1>
		<a href="/compta/banque" class="text-sm">← Comptes</a>
	</div>

	<div class="mb-6 grid gap-4 sm:grid-cols-3">
		<div class="border border-black p-3">
			<p class="text-xs font-bold uppercase">Solde</p>
			<p class="text-2xl font-bold">{amountFormat.format(c.solde)}</p>
		</div>
		<div class="border border-black p-3">
			<p class="text-xs font-bold uppercase">À lettrer</p>
			<p class="text-2xl font-bold {c.nonLettres > 0 ? 'text-orange-600' : ''}">{c.nonLettres}</p>
		</div>
		<div class="flex flex-col gap-2 text-sm">
			{#if c.type === 'banque'}
				<button type="button" onclick={() => (importOpen = !importOpen)} class="btn-primary px-4 py-2">Importer un CSV Belfius</button>
			{/if}
			<button type="button" onclick={() => (mouvementOpen = !mouvementOpen)} class="border border-black px-4 py-2 font-bold uppercase hover:bg-black hover:text-white">Saisir un mouvement</button>
			<button type="button" onclick={() => (compteOpen = !compteOpen)} class="text-xs underline">Modifier le compte</button>
		</div>
	</div>

	{#if importOpen}
		<form
			method="POST"
			action="?/importer"
			enctype="multipart/form-data"
			class="mb-6 border border-black p-4"
			use:enhance={() => {
				importing = true;
				return async ({ update }) => {
					await update({ reset: true });
					importing = false;
				};
			}}
		>
			<p class="mb-3 text-sm text-gray-600">
				Export CSV de Belfius Direct Net (historique du compte → Exporter). Les lignes déjà importées sont ignorées ;
				les entrées portant la communication structurée d'une facture sont lettrées automatiquement.
			</p>
			<label class={labelClass} for="fichier">Fichier CSV</label>
			<input id="fichier" name="fichier" type="file" accept=".csv,text/csv" required class="text-sm" />
			<button type="submit" disabled={importing} class="btn-primary mt-3 block px-4 py-2 disabled:opacity-50">{importing ? 'Import…' : 'Importer'}</button>
			{#if form?.section === 'import' && form.erreurs && form.erreurs.length > 0}
				<ul class="mt-3 list-inside list-disc bg-gray-100 p-3 text-sm text-gray-700">
					{#each form.erreurs as e, i (i)}<li>{e}</li>{/each}
				</ul>
			{/if}
		</form>
	{/if}

	{#if mouvementOpen}
		<form method="POST" action="?/ajouter" class="mb-6 grid gap-3 border border-black p-4 sm:grid-cols-4" use:enhance>
			<div>
				<label class={labelClass} for="dateValeur">Date</label>
				<input id="dateValeur" name="dateValeur" type="date" value={v('dateValeur') || today} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="sens">Sens</label>
				<select id="sens" name="sens" class={inputClass}>
					<option value="entree" selected={v('sens') !== 'sortie'}>Entrée (+)</option>
					<option value="sortie" selected={v('sens') === 'sortie'}>Sortie (−)</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="montant">Montant (€)</label>
				<input id="montant" name="montant" type="text" inputmode="decimal" required value={v('montant')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="libelle">Libellé</label>
				<input id="libelle" name="libelle" type="text" required value={v('libelle')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="contrepartieNom">Contrepartie</label>
				<input id="contrepartieNom" name="contrepartieNom" type="text" value={v('contrepartieNom')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="contrepartieIban">IBAN contrepartie</label>
				<input id="contrepartieIban" name="contrepartieIban" type="text" value={v('contrepartieIban')} class="{inputClass} font-mono uppercase" />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="communication">Communication</label>
				<input id="communication" name="communication" type="text" value={v('communication')} class={inputClass} />
			</div>
			<div class="sm:col-span-4"><button type="submit" class="btn-primary px-4 py-2">Enregistrer</button></div>
		</form>
	{/if}

	{#if compteOpen}
		<form method="POST" action="?/update" class="mb-6 grid gap-3 border border-black p-4 sm:grid-cols-4" use:enhance>
			<div>
				<label class={labelClass} for="type">Type</label>
				<select id="type" name="type" class={inputClass}>
					<option value="banque" selected={c.type === 'banque'}>Banque</option>
					<option value="caisse" selected={c.type === 'caisse'}>Caisse</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="nom">Nom</label>
				<input id="nom" name="nom" type="text" required value={v('nom') || c.nom} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="iban">IBAN</label>
				<input id="iban" name="iban" type="text" value={v('iban') || c.iban || ''} class="{inputClass} font-mono uppercase" />
			</div>
			<div>
				<label class={labelClass} for="soldeOuverture">Solde d'ouverture (€)</label>
				<input id="soldeOuverture" name="soldeOuverture" type="text" inputmode="decimal" value={v('soldeOuverture') || String(c.soldeOuverture)} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="dateOuverture">Date d'ouverture</label>
				<input id="dateOuverture" name="dateOuverture" type="date" value={v('dateOuverture') || iso(c.dateOuverture)} class={inputClass} />
			</div>
			<label class="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="inactif" checked={!c.actif} /> Inactif</label>
			<div class="sm:col-span-4"><button type="submit" class="btn-primary px-4 py-2">Enregistrer</button></div>
		</form>
	{/if}

	<h2 class={h2Class}>Mouvements <span class="text-xs font-normal normal-case opacity-80">{data.mouvements.length} derniers</span></h2>
	{#if rows.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Date</th>
						<th class="border border-black px-3 py-2 text-left">Libellé</th>
						<th class="border border-black px-3 py-2 text-left">Contrepartie</th>
						<th class="border border-black px-3 py-2 text-right">Montant</th>
						<th class="border border-black px-3 py-2 text-right">Solde</th>
						<th class="border border-black px-3 py-2 text-center">Lettré</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as { m, solde } (m.id)}
						<tr class="group">
							<td class="border border-black p-0">
								<a href="/compta/banque/mouvements/{m.id}" class="no-underline-fx block px-3 py-2 whitespace-nowrap transition-colors group-hover:bg-black group-hover:text-white">{dateFormat.format(m.dateValeur)}</a>
							</td>
							<td class="border border-black px-3 py-2">{m.libelle}{m.communication ? ` — ${m.communication}` : ''}</td>
							<td class="border border-black px-3 py-2">{m.contrepartieNom ?? m.contrepartieIban ?? '—'}</td>
							<td class="border border-black px-3 py-2 text-right {m.montant < 0 ? 'text-red-700' : 'text-green-700'}">{amountFormat.format(m.montant)}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(solde)}</td>
							<td class="border border-black px-3 py-2 text-center">
								{#if m.transfertId !== null}<span class="text-gray-500" title="Virement interne">⇄</span>
								{:else if m.reste === 0}✓
								{:else if m.lettre > 0}<span class="text-orange-600" title="Partiellement">◐</span>
								{:else}<span class="text-orange-600">—</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun mouvement.</p>
	{/if}
</section>
