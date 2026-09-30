<script lang="ts">
	import type { PageData } from './$types';
	import { COTISATION_STATUS_COLOR, COTISATION_STATUS_LABEL, type CotisationStatus } from '$lib/types';

	let { data }: { data: PageData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });

	const STATUS_ORDER: CotisationStatus[] = ['a_jour', 'en_grace', 'en_attente', 'expiree', 'non_applicable'];

	// Click a counter to filter the list to that status; click it again to clear.
	let filter = $state<CotisationStatus | null>(null);
	const shown = $derived(filter ? data.membres.filter((m) => m.status === filter) : data.membres);
</script>

<svelte:head>
	<title>Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Compta</h1>
		<div class="flex flex-wrap gap-2">
			<a href="/compta/tiers" class="no-underline-fx btn-primary inline-block px-4 py-2">Tiers</a>
		</div>
	</div>

	<div class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		{#each STATUS_ORDER as status (status)}
			<button
				type="button"
				onclick={() => (filter = filter === status ? null : status)}
				class="border border-black p-3 text-left transition-colors {filter === status
					? 'bg-black text-white'
					: 'hover:bg-gray-100'}"
			>
				<p class="flex items-center gap-2 text-2xl font-bold">
					<span
						class="inline-block h-3 w-3 shrink-0 rounded-full"
						style="background-color: {COTISATION_STATUS_COLOR[status]};"
						aria-hidden="true"
					></span>
					{data.counts[status]}
				</p>
				<p class="mt-1 text-xs uppercase">{COTISATION_STATUS_LABEL[status]}</p>
			</button>
		{/each}
		<a href="/compta/tiers?nature=personne_morale" class="no-underline-fx border border-black p-3 hover:bg-gray-100">
			<p class="text-2xl font-bold">{data.organisations}</p>
			<p class="mt-1 text-xs uppercase">Sociétés</p>
		</a>
	</div>

	<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Membres {filter ? `— ${COTISATION_STATUS_LABEL[filter]}` : ''}
	</h2>

	{#if shown.length > 0}
		<div class="overflow-x-auto">
			<table class="table-cards w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Nom</th>
						<th class="border border-black px-3 py-2 text-left">Email</th>
						<th class="border border-black px-3 py-2 text-left">Statut</th>
						<th class="border border-black px-3 py-2 text-left">Couvert jusqu'au</th>
						<th class="border border-black px-3 py-2 text-left">Via</th>
						<th class="border border-black px-3 py-2 text-center">Compte</th>
					</tr>
				</thead>
				<tbody>
					{#each shown as m (m.id)}
						<tr class="group">
							<td class="border border-black p-0">
								<a
									href="/compta/tiers/{m.id}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{m.nom}
								</a>
							</td>
							<td class="border border-black px-3 py-2" data-label="Email">{m.email ?? '—'}</td>
							<td class="border border-black px-3 py-2" data-label="Statut">
								<span class="inline-flex items-center gap-2">
									<span
										class="inline-block h-2 w-2 shrink-0 rounded-full"
										style="background-color: {COTISATION_STATUS_COLOR[m.status]};"
										aria-hidden="true"
									></span>
									{COTISATION_STATUS_LABEL[m.status]}
								</span>
							</td>
							<td class="border border-black px-3 py-2" data-label="Couvert jusqu'au">{m.datefin ? dateFormat.format(m.datefin) : '—'}</td>
							<td class="border border-black px-3 py-2" data-label="Via">{m.via ?? '—'}</td>
							<td class="border border-black px-3 py-2 sm:text-center" title={m.hasAccount ? 'Compte Authentik lié' : 'Aucun compte lié'} data-label="Compte">
								{m.hasAccount ? '✓' : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			{data.membres.length === 0
				? 'Aucun tiers pour le moment — commencez par un import Dolibarr ou créez un tiers.'
				: 'Aucun membre dans ce statut.'}
		</p>
	{/if}
</section>
