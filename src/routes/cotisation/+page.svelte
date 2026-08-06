<script lang="ts">
	import { enhance } from '$app/forms';
	import { COTISATION_STATUS_LABEL, COTISATION_STATUS_COLOR, type CotisationStatus } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submittingBankInfo = $state(false);

	// Seeded once from the load/form result — deliberately not kept in sync afterwards, same
	// rationale as the badge UUID field: the input owns its value once the user starts typing.
	// svelte-ignore state_referenced_locally
	let ibanPersoValue = $state(form?.ibanPerso ?? data.bankInfo?.perso ?? '');
	// svelte-ignore state_referenced_locally
	let ibanProValue = $state(form?.ibanPro ?? data.bankInfo?.pro ?? '');

	// Groups into 4-character blocks as you type (BE71 0961 2345 6769) so a long IBAN stays
	// readable — purely cosmetic, the server strips whitespace again before validating.
	function formatIbanInput(raw: string): string {
		const clean = raw.replace(/\s+/g, '').toUpperCase();
		return (clean.match(/.{1,4}/g) ?? []).join(' ');
	}

	// A classic member only has one account, so it covers both; a pro member splits the two —
	// consumption stays personal, cotisation/invoices go through the linked company.
	function ibanPersoTooltip(isPro: boolean): string {
		return isPro
			? 'Compte avec lequel vous payez vos consommations.'
			: 'Compte avec lequel vous payez vos cotisations et consommations.';
	}
	const IBAN_PRO_TOOLTIP =
		'Compte avec lequel vous payez vos cotisations et factures du hackerspace.';

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium' });
	function formatDate(date: Date | null): string {
		return date ? dateFormat.format(date) : '—';
	}

	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	// Merges the real subscriptions with the detected gaps into one chronological list so the
	// table can render "missing cotisation" rows interleaved at their correct position.
	type CotisationRow =
		| { kind: 'subscription'; date: number; subscription: PageData['subscriptions'][number] }
		| { kind: 'gap'; date: number; gap: PageData['gaps'][number] };
	const cotisationRows = $derived<CotisationRow[]>(
		[
			...data.subscriptions.map((subscription) => ({
				kind: 'subscription' as const,
				date: subscription.start?.getTime() ?? 0,
				subscription
			})),
			...data.gaps.map((gap) => ({ kind: 'gap' as const, date: gap.start.getTime(), gap }))
		].sort((a, b) => b.date - a.date)
	);

	// Years for which there's at least one row (subscription or gap), most recent first — used to
	// paginate the table one year at a time instead of dumping the whole history at once.
	const availableYears = $derived(
		Array.from(new Set(cotisationRows.map((row) => new Date(row.date).getFullYear()))).sort(
			(a, b) => b - a
		)
	);
	let selectedYear = $state<number | null>(null);
	const displayedYear = $derived(selectedYear ?? availableYears[0] ?? new Date().getFullYear());
	const yearIndex = $derived(availableYears.indexOf(displayedYear));
	// "Older" = further back in the array (years are sorted newest-first), "newer" = closer to the front.
	const olderYear = $derived(
		yearIndex >= 0 && yearIndex + 1 < availableYears.length ? availableYears[yearIndex + 1] : null
	);
	const newerYear = $derived(yearIndex > 0 ? availableYears[yearIndex - 1] : null);
	const yearRows = $derived(
		cotisationRows.filter((row) => new Date(row.date).getFullYear() === displayedYear)
	);
	const hasGapsOnPage = $derived(yearRows.some((row) => row.kind === 'gap'));

	function statusExplanation(status: CotisationStatus, datefin: Date | null): string {
		switch (status) {
			case 'a_jour':
				return `Votre cotisation est valide jusqu'au ${formatDate(datefin)}.`;
			case 'expiree':
				return datefin
					? `Votre cotisation a expiré le ${formatDate(datefin)}. Merci de la renouveler.`
					: 'Votre adhésion est résiliée.';
			case 'en_attente':
				return "Aucune cotisation n'a encore été enregistrée pour votre compte. Si vous venez de payer, comptez quelques jours pour que ce soit traité. Généralement le 1er mercredi du mois si cela ne passe pas automatiquement.";
			case 'non_applicable':
				return "En tant que membre d'honneur, vous n'êtes pas soumis·e à cotisation.";
		}
	}
</script>

{#snippet infoTooltip(text: string)}
	<span class="group relative inline-flex align-middle">
		<button
			type="button"
			aria-label={text}
			class="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none font-normal text-gray-400"
		>
			i
		</button>
		<span
			aria-hidden="true"
			class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 border-2 border-black bg-white px-3 py-2 text-xs leading-relaxed font-normal normal-case text-black opacity-0 shadow-[4px_4px_0_0_#000] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
		>
			{text}
		</span>
	</span>
{/snippet}

<svelte:head>
	<title>Ma cotisation — Passport</title>
</svelte:head>

<div class="flex flex-col gap-8 md:flex-row md:items-start">
	<section class="w-full md:w-2/3">
		<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma cotisation</h1>

		{#if data.status === null}
			<div class="flex items-start gap-3 border border-black bg-gray-100 px-4 py-3">
				<span
					class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full bg-gray-400"
					aria-hidden="true"
				></span>
				<div>
					<p class="text-sm font-bold uppercase">Compte introuvable</p>
					<p class="text-sm text-gray-600">
						Nous n'avons pas trouvé de compte correspondant à votre adresse email dans l'outil de
						gestion des membres. Cela peut simplement vouloir dire que votre inscription n'a pas
						encore été synchronisée, ou provenir d'une erreur. Si ça persiste, contactez une
						personne en charge de la trésorerie ou du registre des membres. Via le canal #support
						du chat ou par mail <a href="mailto:ping@lghs.be">ping@lghs.be</a>.
					</p>
				</div>
			</div>
		{:else}
			<div class="mb-6 flex items-start gap-3 border border-black bg-gray-100 px-4 py-3">
				<span
					class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
					style="background-color: {COTISATION_STATUS_COLOR[data.status]};"
					aria-hidden="true"
				></span>
				<div>
					<p class="text-sm font-bold uppercase">{COTISATION_STATUS_LABEL[data.status]}</p>
					<p class="text-sm text-gray-600">{statusExplanation(data.status, data.datefin)}</p>
					{#if data.isInactive}
						<p class="mt-2 text-sm font-bold">
							Après 3 mois sans cotisation, votre compte est considéré comme inactif.
						</p>
					{/if}
				</div>
			</div>

			{#if availableYears.length > 1}
				<div class="mb-3 flex items-center justify-between border border-black">
					<button
						type="button"
						onclick={() => (selectedYear = olderYear)}
						disabled={olderYear === null}
						class="px-3 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black"
					>
						‹ {olderYear ?? ''}
					</button>
					<span class="text-sm font-bold uppercase">{displayedYear}</span>
					<button
						type="button"
						onclick={() => (selectedYear = newerYear)}
						disabled={newerYear === null}
						class="px-3 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black"
					>
						{newerYear ?? ''} ›
					</button>
				</div>
			{/if}

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
						{#each yearRows as row (row.kind === 'subscription' ? `sub-${row.subscription.id}` : `gap-${row.gap.start.getTime()}`)}
							{#if row.kind === 'subscription'}
								<tr>
									<td class="border border-black px-3 py-2">{formatDate(row.subscription.start)}</td>
									<td class="border border-black px-3 py-2">{formatDate(row.subscription.end)}</td>
									<td class="border border-black px-3 py-2"
										>{amountFormat.format(row.subscription.amount)}</td
									>
								</tr>
							{:else}
								<tr class="bg-red-50 text-red-700">
									<td class="border border-black px-3 py-2">{formatDate(row.gap.start)}</td>
									<td class="border border-black px-3 py-2">{formatDate(row.gap.end)}</td>
									<td class="border border-black px-3 py-2">Non perçu</td>
								</tr>
							{/if}
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

			{#if hasGapsOnPage}
				<p class="mt-3 text-sm text-gray-600">
					<span class="font-bold text-red-700">Non perçu</span> signale un mois pour lequel nous
					n'avons trouvé aucune cotisation. Si ça vous semble être une erreur, contactez
					<a href="mailto:compta@lghs.be">compta@lghs.be</a>.
				</p>
			{/if}
		{/if}
	</section>

	<section class="w-full md:w-1/3">
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Infos Bancaires</h2>
		<p class="mb-6 text-sm leading-relaxed text-gray-600">
			Renseigner vos coordonnées bancaires facilite l'automatisation des tâches de comptabilité.
		</p>

		{#if data.bankInfo === null}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-500">
				Compte introuvable.
			</p>
		{:else}
			{#if form?.success}
				<p class="mb-4 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm font-bold">
					{data.bankInfo.isPro ? 'Les IBAN ont été mis à jour.' : "L'IBAN a été mis à jour."}
				</p>
			{/if}
			{#if form?.error}
				<p class="mb-4 border-4 border-black bg-white px-4 py-3 text-sm font-bold">
					{form.error}
				</p>
			{/if}

			<form
				method="POST"
				action="?/updateBankInfo"
				use:enhance={() => {
					submittingBankInfo = true;
					return async ({ update }) => {
						try {
							await update({ reset: false });
						} finally {
							submittingBankInfo = false;
						}
					};
				}}
			>
				<div class="mb-4">
					<label class="mb-1 flex items-center gap-1.5 text-sm font-bold uppercase" for="ibanPerso">
						IBAN personnel
						{@render infoTooltip(ibanPersoTooltip(data.bankInfo.isPro))}
					</label>
					<input
						id="ibanPerso"
						name="ibanPerso"
						type="text"
						placeholder="BE71 0961 2345 6769"
						value={ibanPersoValue}
						oninput={(e) => (ibanPersoValue = formatIbanInput(e.currentTarget.value))}
						class="w-full border border-black px-3 py-2 font-mono text-sm uppercase placeholder:text-gray-300 placeholder:normal-case"
					/>
				</div>

				{#if data.bankInfo.isPro}
					<div class="mb-4">
						<label class="mb-1 flex items-center gap-1.5 text-sm font-bold uppercase" for="ibanPro">
							IBAN professionnel
							{@render infoTooltip(IBAN_PRO_TOOLTIP)}
						</label>
						<input
							id="ibanPro"
							name="ibanPro"
							type="text"
							placeholder="BE71 0961 2345 6769"
							value={ibanProValue}
							oninput={(e) => (ibanProValue = formatIbanInput(e.currentTarget.value))}
							class="w-full border border-black px-3 py-2 font-mono text-sm uppercase placeholder:text-gray-300 placeholder:normal-case"
						/>
					</div>
				{/if}

				<button
					type="submit"
					disabled={submittingBankInfo}
					class="btn-primary px-4 py-2 disabled:opacity-50"
				>
					{submittingBankInfo ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			</form>
		{/if}
	</section>
</div>
