<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import CotisationStatusBlock from '$lib/components/CotisationStatusBlock.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const o = $derived(data.organisation);

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const fmt = (d: Date | null) => (d ? dateFormat.format(d) : '—');

	let submitting = $state(false);
	// Seeded once — the input owns its value once the administrator starts typing.
	// svelte-ignore state_referenced_locally
	let ibanValue = $state(form?.iban ?? data.organisation.iban ?? '');
	function formatIbanInput(raw: string): string {
		const clean = raw.replace(/\s+/g, '').toUpperCase();
		return (clean.match(/.{1,4}/g) ?? []).join(' ');
	}

	$effect(() => {
		if (form?.success) showToast('success', "L'IBAN de la société a été mis à jour.");
		else if (form?.error) showToast('error', form.error);
	});

	function invoiceStatusLabel(i: { paid: boolean; abandoned: boolean }): string {
		return i.abandoned ? 'Annulée' : i.paid ? 'Payée' : 'À payer';
	}
	function invoiceStatusColor(i: { paid: boolean; abandoned: boolean }): string {
		return i.abandoned ? 'text-gray-500' : i.paid ? 'text-green-700' : 'text-red-700';
	}
	const h2Class = 'mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase';
</script>

<svelte:head>
	<title>{o.nom} — Passport</title>
</svelte:head>

<div class="flex flex-col gap-8 md:flex-row md:items-start">
	<section class="w-full md:w-2/3">
		<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
			<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">{o.nom}</h1>
			<a href="/cotisation" class="text-sm">← Ma cotisation</a>
		</div>

		<dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-black p-4 text-sm">
			{#if o.numeroEntreprise}<dt class="font-bold uppercase">N° BCE</dt><dd>{o.numeroEntreprise}</dd>{/if}
			{#if o.adresse}<dt class="font-bold uppercase">Adresse</dt><dd>{o.adresse}</dd>{/if}
			{#if o.email}<dt class="font-bold uppercase">Email</dt><dd>{o.email}</dd>{/if}
			<dt class="font-bold uppercase">Sièges</dt>
			<dd>{data.sieges.utilises} / {data.sieges.total} utilisé(s)</dd>
		</dl>
		<p class="mb-6 text-sm text-gray-600">
			Pour modifier la fiche de la société (adresse, contacts, personnes liées), contactez
			<a href="mailto:compta@lghs.be">compta@lghs.be</a>.
		</p>

		<h2 class={h2Class}>Cotisation de la société</h2>
		<div class="mb-6">
			<CotisationStatusBlock
				status={data.situation.status}
				datefin={data.situation.datefin}
				finGrace={data.situation.finGrace}
				isInactive={data.situation.isInactive}
			/>
		</div>
		{#if data.situation.subscriptions.length > 0}
			<div class="mb-8 overflow-x-auto">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="bg-black text-white uppercase">
							<th class="border border-black px-3 py-2 text-left">Début</th>
							<th class="border border-black px-3 py-2 text-left">Fin</th>
							<th class="border border-black px-3 py-2 text-left">Montant</th>
						</tr>
					</thead>
					<tbody>
						{#each data.situation.subscriptions as s (s.id)}
							<tr>
								<td class="border border-black px-3 py-2">{fmt(s.start)}</td>
								<td class="border border-black px-3 py-2">{fmt(s.end)}</td>
								<td class="border border-black px-3 py-2">
									{amountFormat.format(s.amount)}
									{#if s.statut === 'attendue'}<span class="text-orange-600">(en attente de paiement)</span>
									{:else if s.statut === 'annulee'}<span class="text-gray-500">(annulée)</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<h2 class={h2Class}>Personnes liées</h2>
		<div class="mb-8 overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Nom</th>
						<th class="border border-black px-3 py-2 text-left">Rôles</th>
						<th class="border border-black px-3 py-2 text-center">Membre via la société</th>
					</tr>
				</thead>
				<tbody>
					{#each data.personnes as p (p.id)}
						<tr>
							<td class="border border-black px-3 py-2">{p.nom}{p.email ? ` · ${p.email}` : ''}</td>
							<td class="border border-black px-3 py-2">{p.roles.join(', ') || '—'}</td>
							<td class="border border-black px-3 py-2 text-center">{p.membre ? '✓' : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h2 class={h2Class}>Factures</h2>
		{#if data.invoices.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="bg-black text-white uppercase">
							<th class="border border-black px-3 py-2 text-left">Référence</th>
							<th class="border border-black px-3 py-2 text-left">Type</th>
							<th class="border border-black px-3 py-2 text-left">Date</th>
							<th class="border border-black px-3 py-2 text-left">Montant</th>
							<th class="border border-black px-3 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.invoices as i (i.id)}
							<tr>
								<td class="border border-black px-3 py-2">{i.ref}</td>
								<td class="border border-black px-3 py-2">{i.type}</td>
								<td class="border border-black px-3 py-2">{fmt(i.date)}</td>
								<td class="border border-black px-3 py-2 font-bold {invoiceStatusColor(i)}">{amountFormat.format(i.amount)} ({invoiceStatusLabel(i)})</td>
								<td class="border border-black px-3 py-2 text-center">
									{#if i.downloadable}<a href="/cotisation/invoice/{i.id}" class="text-xs">PDF</a>{:else}—{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune facture.</p>
		{/if}
	</section>

	<section class="w-full md:w-1/3">
		<h2 class={h2Class}>IBAN de la société</h2>
		<p class="mb-4 text-sm leading-relaxed text-gray-600">
			Compte avec lequel {o.nom} paie ses cotisations et factures au hackerspace. Il sert à reconnaître ses paiements.
		</p>
		<form
			method="POST"
			action="?/updateIban"
			class="border border-black p-4"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					try {
						await update({ reset: false });
					} finally {
						submitting = false;
					}
				};
			}}
		>
			<label class="mb-1 block text-sm font-bold uppercase" for="iban">IBAN</label>
			<input
				id="iban"
				name="iban"
				type="text"
				placeholder="BE71 0961 2345 6769"
				value={ibanValue}
				oninput={(e) => (ibanValue = formatIbanInput(e.currentTarget.value))}
				class="w-full border border-black px-3 py-2 font-mono text-sm uppercase placeholder:text-gray-300 placeholder:normal-case"
			/>
			<button type="submit" disabled={submitting} class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50">
				{submitting ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</form>
	</section>
</div>
