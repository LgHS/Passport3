<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const today = new Date().toLocaleDateString('en-CA');
	let submitting = $state(false);

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	const STATUT = {
		soumise: { label: 'En attente', cls: 'text-orange-600' },
		acceptee: { label: 'Acceptée — remboursement en cours', cls: 'text-green-700' },
		refusee: { label: 'Refusée', cls: 'text-red-700' },
		remboursee: { label: 'Remboursée', cls: 'text-green-700' }
	} as const;

	const v = (key: 'date' | 'libelle' | 'montant') => form?.values?.[key] ?? '';
	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
</script>

<svelte:head>
	<title>Notes de frais — Passport</title>
</svelte:head>

<div class="flex flex-col gap-8 md:flex-row md:items-start">
	<section class="w-full md:w-2/3">
		<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mes notes de frais</h1>

		{#if data.tiers === null}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Nous n'avons pas trouvé votre fiche dans la comptabilité. Contactez la trésorerie via
				<a href="mailto:compta@lghs.be">compta@lghs.be</a>.
			</p>
		{:else if data.notes.length > 0}
			<div class="space-y-2">
				{#each data.notes as n (n.id)}
					<div class="border border-black p-3 text-sm">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<p class="font-bold">{n.libelle}</p>
								<p class="text-gray-600">{dateFormat.format(n.date)} · {amountFormat.format(n.montant)}</p>
							</div>
							<p class="font-bold {STATUT[n.statut].cls}">{STATUT[n.statut].label}</p>
						</div>
						{#if n.statut === 'refusee' && n.motif}
							<p class="mt-2 text-red-700">Motif : {n.motif}</p>
						{/if}
						{#if n.statut === 'remboursee' && n.rembourseeLe}
							<p class="mt-1 text-gray-600">Remboursée le {dateFormat.format(n.rembourseeLe)}.</p>
						{/if}
						<div class="mt-2 flex flex-wrap gap-3">
							{#if n.hasJustificatif}
								<a href="/notes-de-frais/{n.id}/justificatif" class="text-xs">Justificatif</a>
							{/if}
							{#if n.statut === 'soumise'}
								<form method="POST" action="?/retirer" use:enhance>
									<input type="hidden" name="noteId" value={n.id} />
									<button type="submit" class="text-xs underline">Retirer</button>
								</form>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune note de frais.</p>
		{/if}
	</section>

	{#if data.tiers}
		<section class="w-full md:w-1/3">
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Nouvelle note</h2>
			<p class="mb-4 text-sm leading-relaxed text-gray-600">
				Une dépense avancée pour le hackerspace, avec son ticket ou sa facture. La trésorerie la valide, puis
				rembourse sur votre IBAN{data.tiers.iban ? ` (${data.tiers.iban})` : ''}.
				{#if !data.tiers.iban}
					<a href="/cotisation">Renseignez votre IBAN</a> pour être remboursé·e.
				{/if}
			</p>
			<form
				method="POST"
				action="?/soumettre"
				enctype="multipart/form-data"
				class="border border-black p-4"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: true });
						submitting = false;
					};
				}}
			>
				<div class="mb-3">
					<label class={labelClass} for="date">Date de la dépense</label>
					<input id="date" name="date" type="date" max={today} value={v('date') || today} required class={inputClass} />
				</div>
				<div class="mb-3">
					<label class={labelClass} for="libelle">Dépense</label>
					<input id="libelle" name="libelle" type="text" required placeholder="Câbles pour l'atelier" value={v('libelle')} class={inputClass} />
				</div>
				<div class="mb-3">
					<label class={labelClass} for="montant">Montant (€)</label>
					<input id="montant" name="montant" type="text" inputmode="decimal" required placeholder="12,50" value={v('montant')} class={inputClass} />
				</div>
				<div class="mb-4">
					<label class={labelClass} for="justificatif">Justificatif (PDF ou photo)</label>
					<input id="justificatif" name="justificatif" type="file" accept="application/pdf,image/*" required class="text-sm" />
				</div>
				<button type="submit" disabled={submitting} class="btn-primary px-4 py-2 disabled:opacity-50">
					{submitting ? 'Envoi…' : 'Envoyer'}
				</button>
			</form>
		</section>
	{/if}
</div>
