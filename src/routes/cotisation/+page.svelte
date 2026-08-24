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

	// A gap's bounds denote a calendar month the server pinned to UTC midnight, not an instant, so
	// they must be formatted in UTC. Run through the local formatter above, 01/01 00:00 UTC would
	// read "31 déc." for anyone at a negative offset.
	const gapDateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });

	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	// Dolibarr may return a subscription with either bound missing (see parseDolibarrDate: "", 0 and
	// "0" all mean "no date"). One that still has a start or an end can be placed on the timeline;
	// one with neither carries no chronological information at all and is listed apart. Pinning the
	// latter to epoch 0 instead would invent a phantom "1970" entry in the year pager — holding a row
	// nobody would ever page back far enough to reach.
	const datedSubscriptions = $derived(
		data.subscriptions.filter((s) => s.start !== null || s.end !== null)
	);
	const undatedSubscriptions = $derived(
		data.subscriptions.filter((s) => s.start === null && s.end === null)
	);

	// Merges the real subscriptions with the detected gaps into one chronological list so the table
	// can render "missing cotisation" rows interleaved at their correct position.
	//
	// `year` is stored per row rather than re-derived from `date` downstream, because the two kinds
	// don't live in the same clock: a subscription is an instant (rendered in the reader's timezone),
	// a gap is a calendar month the server pinned to UTC midnight. Reading a gap's year locally would
	// file January's gap under the previous year for any reader at a negative offset — the same slip
	// the UTC formatter above guards against, and the reason both must be handled at the source.
	type CotisationRow =
		| {
				kind: 'subscription';
				date: number;
				year: number;
				subscription: PageData['subscriptions'][number];
		  }
		| { kind: 'gap'; date: number; year: number; gap: PageData['gaps'][number] };
	const cotisationRows = $derived<CotisationRow[]>(
		[
			...datedSubscriptions.map((subscription) => {
				const anchor = (subscription.start ?? subscription.end) as Date;
				return {
					kind: 'subscription' as const,
					date: anchor.getTime(),
					year: anchor.getFullYear(),
					subscription
				};
			}),
			...data.gaps.map((gap) => ({
				kind: 'gap' as const,
				date: gap.start.getTime(),
				year: gap.start.getUTCFullYear(),
				gap
			}))
		].sort((a, b) => b.date - a.date)
	);

	// Years for which there's at least one row (subscription or gap), most recent first — used to
	// paginate the table one year at a time instead of dumping the whole history at once.
	const availableYears = $derived(
		Array.from(new Set(cotisationRows.map((row) => row.year))).sort((a, b) => b - a)
	);
	// `null` means "no explicit choice yet", which resolves to the newest year below.
	let selectedYear = $state<number | null>(null);
	// A stale selection — the data reloaded and that year lost all its rows — is discarded rather
	// than honoured. Kept, it would leave `yearIndex` at -1, which nulls out *both* neighbours below
	// and disables both nav buttons at once, stranding the reader on an empty page with no way back.
	// Self-healing here rather than in an $effect: this stays a pure derivation, so there's no
	// intermediate render showing the broken state.
	const displayedYear = $derived(
		selectedYear !== null && availableYears.includes(selectedYear)
			? selectedYear
			: (availableYears[0] ?? new Date().getFullYear())
	);
	const yearIndex = $derived(availableYears.indexOf(displayedYear));
	// "Older" = further back in the array (years are sorted newest-first), "newer" = closer to the front.
	const olderYear = $derived(
		yearIndex >= 0 && yearIndex + 1 < availableYears.length ? availableYears[yearIndex + 1] : null
	);
	const newerYear = $derived(yearIndex > 0 ? availableYears[yearIndex - 1] : null);
	const yearRows = $derived(cotisationRows.filter((row) => row.year === displayedYear));
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

			{#if yearRows.length > 0 || undatedSubscriptions.length > 0}
				<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
				<div class="space-y-2 sm:hidden">
					{#each yearRows as row (row.kind === 'subscription' ? `sub-${row.subscription.id}` : `gap-${row.gap.start.getTime()}`)}
						{#if row.kind === 'subscription'}
							<div class="border border-black p-3 text-sm">
								<p class="font-bold">
									{formatDate(row.subscription.start)} — {formatDate(row.subscription.end)}
								</p>
								<p class="mt-1 text-gray-600">{amountFormat.format(row.subscription.amount)}</p>
							</div>
						{:else}
							<div class="border border-black bg-red-50 p-3 text-sm text-red-700">
								<p class="font-bold">
									{gapDateFormat.format(row.gap.start)} — {gapDateFormat.format(row.gap.end)}
								</p>
								<p class="mt-1">Non perçu</p>
							</div>
						{/if}
					{/each}
					{#each undatedSubscriptions as subscription (`undated-${subscription.id}`)}
						<div class="border border-black p-3 text-sm">
							<p class="font-bold">
								{formatDate(subscription.start)} — {formatDate(subscription.end)}
							</p>
							<p class="mt-1 text-gray-600">{amountFormat.format(subscription.amount)}</p>
						</div>
					{/each}
				</div>

				<div class="hidden overflow-x-auto sm:block">
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
										<td class="border border-black px-3 py-2">{gapDateFormat.format(row.gap.start)}</td>
										<td class="border border-black px-3 py-2">{gapDateFormat.format(row.gap.end)}</td>
										<td class="border border-black px-3 py-2">Non perçu</td>
									</tr>
								{/if}
							{/each}
							<!-- Belonging to no year, these repeat on every page rather than becoming
							     unreachable. Both date cells render as "—", so a duplicate is recognisable
							     as the same row and not mistaken for a second subscription. -->
							{#each undatedSubscriptions as subscription (`undated-${subscription.id}`)}
								<tr>
									<td class="border border-black px-3 py-2">{formatDate(subscription.start)}</td>
									<td class="border border-black px-3 py-2">{formatDate(subscription.end)}</td>
									<td class="border border-black px-3 py-2"
										>{amountFormat.format(subscription.amount)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
					Aucune cotisation enregistrée.
				</p>
			{/if}

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
				<div class="mb-4 border-4 border-black bg-red-600 px-4 py-3 text-white">
					<p class="text-sm font-bold">{form.error}</p>
					{#if form.error === 'Cet IBAN est déjà utilisé.'}
						<p class="mt-1 text-sm">
							Contactez <a href="mailto:compta@lghs.be" class="no-underline-fx underline"
								>compta@lghs.be</a
							>.
						</p>
					{/if}
				</div>
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
					<label class="mb-1 block text-sm font-bold uppercase" for="ibanPerso">
						IBAN personnel
					</label>
					<p class="mb-1 text-xs text-gray-500">{ibanPersoTooltip(data.bankInfo.isPro)}</p>
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
						<label class="mb-1 block text-sm font-bold uppercase" for="ibanPro">
							IBAN professionnel
						</label>
						<p class="mb-1 text-xs text-gray-500">{IBAN_PRO_TOOLTIP}</p>
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
