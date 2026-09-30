<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import TiersForm from '$lib/components/compta/TiersForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let query = $state('');
	// svelte-ignore state_referenced_locally
	let creating = $state(!!form?.error);

	const filtered = $derived(
		data.tiers.filter((t) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return (
				t.displayName.toLowerCase().includes(q) ||
				(t.email ?? '').toLowerCase().includes(q) ||
				(t.numeroEntreprise ?? '').toLowerCase().includes(q)
			);
		})
	);

	$effect(() => {
		if (form?.error) showToast('error', form.error);
	});

	function roles(t: PageData['tiers'][number]): string {
		const r: string[] = [];
		if (t.estClient) r.push('client');
		if (t.estFournisseur) r.push('fournisseur');
		if (t.exempteCotisation) r.push("membre d'honneur");
		if (!t.actif) r.push('inactif');
		return r.join(', ') || '—';
	}
</script>

<svelte:head>
	<title>Tiers — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Tiers</h1>
		<button type="button" onclick={() => (creating = !creating)} class="btn-primary px-4 py-2">
			{creating ? 'Annuler' : 'Nouveau tiers'}
		</button>
	</div>

	{#if creating}
		<div class="mb-6">
			<TiersForm action="?/create" values={form?.values ?? {}} submitLabel="Créer" />
		</div>
	{/if}

	<div class="mb-4 flex flex-wrap items-center gap-4">
		<input
			type="search"
			bind:value={query}
			placeholder="Rechercher par nom, email ou n° d'entreprise…"
			class="min-w-0 flex-1 border border-black px-3 py-2 text-sm"
		/>
		<nav class="flex gap-1 text-sm">
			<a href="/compta/tiers" class="no-underline-fx border border-black px-3 py-2 {data.nature === null ? 'bg-black text-white' : ''}">Tous</a>
			<a
				href="/compta/tiers?nature=personne_physique"
				class="no-underline-fx border border-black px-3 py-2 {data.nature === 'personne_physique' ? 'bg-black text-white' : ''}"
			>
				Personnes
			</a>
			<a
				href="/compta/tiers?nature=personne_morale"
				class="no-underline-fx border border-black px-3 py-2 {data.nature === 'personne_morale' ? 'bg-black text-white' : ''}"
			>
				Sociétés
			</a>
		</nav>
	</div>

	{#if filtered.length > 0}
		<div class="overflow-x-auto">
			<table class="table-cards w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Nom</th>
						<th class="border border-black px-3 py-2 text-left">Nature</th>
						<th class="border border-black px-3 py-2 text-left">Email</th>
						<th class="border border-black px-3 py-2 text-left">Rôles</th>
						<th class="border border-black px-3 py-2 text-left">IBAN</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as t (t.id)}
						<tr class="group {t.actif ? '' : 'text-gray-400'}">
							<td class="border border-black p-0">
								<a
									href="/compta/tiers/{t.id}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{t.displayName}
								</a>
							</td>
							<td class="border border-black px-3 py-2" data-label="Nature">{t.nature === 'personne_morale' ? 'Société' : 'Personne'}</td>
							<td class="border border-black px-3 py-2" data-label="Email">{t.email ?? '—'}</td>
							<td class="border border-black px-3 py-2" data-label="Rôles">{roles(t)}</td>
							<td class="border border-black px-3 py-2 font-mono text-xs" data-label="IBAN">{t.iban ? `••••${t.iban.slice(-4)}` : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun tiers.</p>
	{/if}
</section>
