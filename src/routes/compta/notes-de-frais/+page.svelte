<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	const STATUTS = ['soumise', 'acceptee', 'refusee', 'remboursee'] as const;
	const LABEL = { soumise: 'À traiter', acceptee: 'À rembourser', refusee: 'Refusées', remboursee: 'Remboursées' } as const;
	const CLS = { soumise: 'text-orange-600', acceptee: 'text-blue-700', refusee: 'text-red-700', remboursee: 'text-green-700' } as const;
	const tab = 'no-underline-fx border border-black px-3 py-2 text-sm';
	const btn = 'border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white';

	// Which claim has its refusal form open (a refusal needs a reason). Seeded once from a failed
	// submission so the form reopens on the same claim.
	// svelte-ignore state_referenced_locally
	let refusing = $state<number | null>(form?.noteId ?? null);
	const aRembourser = $derived(data.notes.filter((n) => n.statut === 'acceptee').reduce((a, n) => a + n.montant, 0));
</script>

<svelte:head>
	<title>Notes de frais — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Notes de frais</h1>

	<div class="mb-4 flex flex-wrap items-center gap-4">
		<nav class="flex gap-1">
			<a href="/compta/notes-de-frais" class="{tab} {data.statut === null ? 'bg-black text-white' : ''}">Toutes</a>
			{#each STATUTS as s (s)}
				<a href="/compta/notes-de-frais?statut={s}" class="{tab} {data.statut === s ? 'bg-black text-white' : ''}">{LABEL[s]}</a>
			{/each}
		</nav>
		{#if data.statut === null || data.statut === 'acceptee'}
			<p class="ml-auto text-sm">À rembourser : <span class="font-bold">{amountFormat.format(aRembourser)}</span></p>
		{/if}
	</div>

	{#if data.notes.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Date</th>
						<th class="border border-black px-3 py-2 text-left">Membre</th>
						<th class="border border-black px-3 py-2 text-left">Dépense</th>
						<th class="border border-black px-3 py-2 text-right">Montant</th>
						<th class="border border-black px-3 py-2 text-left">Statut</th>
						<th class="border border-black px-3 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.notes as n (n.id)}
						<tr>
							<td class="border border-black px-3 py-2 whitespace-nowrap">{dateFormat.format(n.date)}</td>
							<td class="border border-black px-3 py-2">
								<a href="/compta/tiers/{n.tiersId}">{n.tiersNom}</a>
								{#if !n.tiersIban}<span class="text-xs text-red-700" title="Pas d'IBAN sur la fiche">· sans IBAN</span>{/if}
							</td>
							<td class="border border-black px-3 py-2">
								{n.libelle}
								{#if n.hasJustificatif}<a href="/compta/notes-de-frais/{n.id}/justificatif" class="ml-1 text-xs">justificatif</a>{/if}
								{#if n.motif}<p class="text-xs text-gray-600">Motif : {n.motif}</p>{/if}
							</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(n.montant)}</td>
							<td class="border border-black px-3 py-2 {CLS[n.statut]}">
								{LABEL[n.statut]}
								{#if n.decisionPar && n.statut !== 'soumise'}<span class="block text-xs text-gray-500">par {n.decisionPar}</span>{/if}
							</td>
							<td class="border border-black px-2 py-1 whitespace-nowrap">
								{#if n.statut === 'soumise'}
									{#if refusing === n.id}
										<form method="POST" action="?/decider" class="flex gap-1" use:enhance>
											<input type="hidden" name="noteId" value={n.id} />
											<input type="hidden" name="decision" value="refuser" />
											<input type="text" name="motif" required placeholder="Motif du refus" class="border border-black px-2 py-1 text-xs" />
											<button type="submit" class={btn}>Refuser</button>
											<button type="button" onclick={() => (refusing = null)} class={btn}>×</button>
										</form>
									{:else}
										<form method="POST" action="?/decider" class="inline" use:enhance>
											<input type="hidden" name="noteId" value={n.id} />
											<input type="hidden" name="decision" value="accepter" />
											<button type="submit" class={btn}>Accepter</button>
										</form>
										<button type="button" onclick={() => (refusing = n.id)} class={btn}>Refuser</button>
									{/if}
								{:else if n.statut === 'acceptee'}
									<a href="/compta/banque" class="text-xs">Lettrer le virement</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune note de frais.</p>
	{/if}
</section>
