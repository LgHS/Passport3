<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import CotisationStatusBlock from '$lib/components/CotisationStatusBlock.svelte';

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

	// Separate year pager from the one above, deliberately not shared with it: an invoice doesn't
	// necessarily fall in a year that has a subscription or gap (see project_invoice-downloads-todo),
	// so deriving this pager's years from cotisationRows would make those invoices' years
	// unreachable — never offered as a choice, never shown. Same self-healing pattern otherwise.
	const datedInvoices = $derived(data.invoices.filter((i) => i.date !== null));
	const undatedInvoices = $derived(data.invoices.filter((i) => i.date === null));
	const invoiceYears = $derived(
		Array.from(new Set(datedInvoices.map((i) => (i.date as Date).getFullYear()))).sort(
			(a, b) => b - a
		)
	);
	let selectedInvoiceYear = $state<number | null>(null);
	const displayedInvoiceYear = $derived(
		selectedInvoiceYear !== null && invoiceYears.includes(selectedInvoiceYear)
			? selectedInvoiceYear
			: (invoiceYears[0] ?? new Date().getFullYear())
	);
	const invoiceYearIndex = $derived(invoiceYears.indexOf(displayedInvoiceYear));
	const olderInvoiceYear = $derived(
		invoiceYearIndex >= 0 && invoiceYearIndex + 1 < invoiceYears.length
			? invoiceYears[invoiceYearIndex + 1]
			: null
	);
	const newerInvoiceYear = $derived(invoiceYearIndex > 0 ? invoiceYears[invoiceYearIndex - 1] : null);
	const yearInvoices = $derived(
		datedInvoices.filter((i) => (i.date as Date).getFullYear() === displayedInvoiceYear)
	);
	// Undated invoices belong to no year, so they repeat on every page rather than becoming
	// unreachable — same reasoning as undatedSubscriptions above.
	const displayedInvoices = $derived([...yearInvoices, ...undatedInvoices]);
</script>

{#snippet downloadIcon()}
	<svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.75">
		<path d="M10 3v10.5m0 0-3.25-3.25M10 13.5l3.25-3.25" stroke-linecap="round" stroke-linejoin="round" />
		<path d="M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
{/snippet}

<svelte:head>
	<title>Ma cotisation — Passport</title>
</svelte:head>

<div class="flex flex-col gap-8 md:flex-row md:items-start">
	<section class="w-full md:w-2/3">
		<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma cotisation</h1>

		{#if data.unavailable}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Service de cotisation temporairement indisponible. Réessayez dans quelques instants.
			</p>
		{:else if data.status === null}
			<CotisationStatusBlock status={null} datefin={null} />
		{:else}
			<div class="mb-6">
				<CotisationStatusBlock status={data.status} datefin={data.datefin} isInactive={data.isInactive} />
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

			{#if data.invoices.length > 0}
				<h2 class="mt-8 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
					Factures
				</h2>

				{#if invoiceYears.length > 1}
					<div class="mb-3 flex items-center justify-between border border-black">
						<button
							type="button"
							onclick={() => (selectedInvoiceYear = olderInvoiceYear)}
							disabled={olderInvoiceYear === null}
							class="px-3 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black"
						>
							‹ {olderInvoiceYear ?? ''}
						</button>
						<span class="text-sm font-bold uppercase">{displayedInvoiceYear}</span>
						<button
							type="button"
							onclick={() => (selectedInvoiceYear = newerInvoiceYear)}
							disabled={newerInvoiceYear === null}
							class="px-3 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black"
						>
							{newerInvoiceYear ?? ''} ›
						</button>
					</div>
				{/if}

				<!-- Its own table, separate from the subscription one above: an invoice doesn't always
				     line up with a cotisation period (see project_invoice-downloads-todo), so it can't be
				     folded into that table as just another column. -->
				<div class="space-y-2 sm:hidden">
					{#each displayedInvoices as invoice (invoice.id)}
						<div class="border border-black p-3 text-sm">
							<div class="flex items-center justify-between gap-2">
								<p class="font-bold">{invoice.ref} <span class="text-gray-500">({invoice.type})</span></p>
								{#if invoice.abandoned}
									<span
										title="Facture abandonnée, contactez compta@lghs.be"
										class="shrink-0 text-gray-400"
									>
										{@render downloadIcon()}
									</span>
								{:else if invoice.documentPath}
									<a
										href="/cotisation/invoice/{invoice.id}"
										aria-label="Télécharger la facture {invoice.ref}"
										title="Télécharger"
										class="no-underline-fx shrink-0 text-gray-600 hover:text-black"
									>
										{@render downloadIcon()}
									</a>
								{/if}
							</div>
							<p class="mt-1 text-gray-600">{formatDate(invoice.date)}</p>
							<p class="mt-1 font-bold {invoice.paid ? 'text-green-700' : 'text-red-700'}">
								{amountFormat.format(invoice.amount)}
							</p>
						</div>
					{/each}
				</div>

				<div class="hidden overflow-x-auto sm:block">
					<table class="w-full border-collapse text-sm">
						<thead>
							<tr class="bg-black text-white uppercase">
								<th class="border border-black px-3 py-2 text-left">Référence</th>
								<th class="border border-black px-3 py-2 text-left">Type</th>
								<th class="border border-black px-3 py-2 text-left">Date</th>
								<th class="border border-black px-3 py-2 text-left">Montant</th>
								<th class="border border-black px-3 py-2 text-left"></th>
							</tr>
						</thead>
						<tbody>
							{#each displayedInvoices as invoice (invoice.id)}
								<tr>
									<td class="border border-black px-3 py-2">{invoice.ref}</td>
									<td class="border border-black px-3 py-2">{invoice.type}</td>
									<td class="border border-black px-3 py-2">{formatDate(invoice.date)}</td>
									<td
										class="border border-black px-3 py-2 font-bold {invoice.paid
											? 'text-green-700'
											: 'text-red-700'}"
									>
										{amountFormat.format(invoice.amount)}
									</td>
									<td class="border border-black px-3 py-2 text-center">
										{#if invoice.abandoned}
											<span
												title="Facture abandonnée, contactez compta@lghs.be"
												class="inline-flex text-gray-400"
											>
												{@render downloadIcon()}
											</span>
										{:else if invoice.documentPath}
											<a
												href="/cotisation/invoice/{invoice.id}"
												aria-label="Télécharger la facture {invoice.ref}"
												title="Télécharger"
												class="no-underline-fx inline-flex text-gray-600 hover:text-black"
											>
												{@render downloadIcon()}
											</a>
										{:else}
											—
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</section>

	<section class="w-full md:w-1/3">
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Infos Bancaires</h2>
		<p class="mb-6 text-sm leading-relaxed text-gray-600">
			Renseigner vos coordonnées bancaires facilite l'automatisation des tâches de comptabilité.
		</p>

		{#if data.unavailable}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-500">
				Service temporairement indisponible. Réessayez dans quelques instants.
			</p>
		{:else if data.bankInfo === null}
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
