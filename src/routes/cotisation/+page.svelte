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
				</div>
			</div>

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
								<td class="border border-black px-3 py-2"
									>{amountFormat.format(subscription.amount)}</td
								>
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
