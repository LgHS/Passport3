<script lang="ts">
	import { COTISATION_STATUS_LABEL, COTISATION_STATUS_COLOR, type CotisationStatus } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium' });
	function formatDate(date: Date | null): string {
		return date ? dateFormat.format(date) : '—';
	}

	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	function statusExplanation(status: CotisationStatus, datefin: Date | null): string {
		switch (status) {
			case 'a_jour':
				return `Votre cotisation est valide jusqu'au ${formatDate(datefin)}.`;
			case 'expiree':
				return datefin
					? `Votre cotisation a expiré le ${formatDate(datefin)}. Merci de la renouveler.`
					: 'Votre adhésion est résiliée.';
			case 'en_attente':
				return "Aucune cotisation n'a encore été enregistrée pour votre compte. Si vous venez de payer, comptez quelques jours pour que ce soit traité.";
			case 'non_applicable':
				return "En tant que membre d'honneur, vous n'êtes pas soumis·e à cotisation.";
		}
	}
</script>

<svelte:head>
	<title>Ma cotisation — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma cotisation</h1>

<div class="mb-6 flex max-w-2xl items-start gap-3 border-2 border-black px-4 py-3">
	<span
		class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
		style="background-color: {COTISATION_STATUS_COLOR[data.status]};"
		aria-hidden="true"
	></span>
	<div>
		<p class="text-sm font-bold uppercase">{COTISATION_STATUS_LABEL[data.status]}</p>
		<p class="text-sm text-gray-600">{statusExplanation(data.status, data.datefin)}</p>
	</div>
</div>

<section class="max-w-3xl">
	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class="border border-black px-3 py-2 text-left">Début</th>
					<th class="border border-black px-3 py-2 text-left">Fin</th>
					<th class="border border-black px-3 py-2 text-left">Montant</th>
				</tr>
			</thead>
			<tbody>
				{#each data.subscriptions as subscription (subscription.id)}
					<tr>
						<td class="border border-black px-3 py-2">{formatDate(subscription.start)}</td>
						<td class="border border-black px-3 py-2">{formatDate(subscription.end)}</td>
						<td class="border border-black px-3 py-2">{amountFormat.format(subscription.amount)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="3" class="border border-black px-3 py-4 text-center text-gray-500">
							Aucune cotisation enregistrée.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
