<script lang="ts">
	import { COTISATION_STATUS_LABEL, COTISATION_STATUS_COLOR, type CotisationStatus } from '$lib/types';

	let {
		status,
		datefin,
		isInactive = false
	}: {
		status: CotisationStatus | null;
		datefin: Date | null;
		isInactive?: boolean;
	} = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium' });
	function formatDate(date: Date | null): string {
		return date ? dateFormat.format(date) : '—';
	}

	function statusExplanation(status: CotisationStatus, datefin: Date | null): string {
		switch (status) {
			case 'a_jour':
				return `Votre cotisation est valide jusqu'au ${formatDate(datefin)}.`;
			case 'expiree':
				return datefin
					? `Votre cotisation a expiré le ${formatDate(datefin)}. Merci de la renouveler. Si vous avez déjà payé ou si vous avez un ordre permanent, comptez quelques jours pour que ce soit traité. Généralement le 1er mercredi du mois si cela ne passe pas automatiquement.`
					: 'Votre adhésion est résiliée.';
			case 'en_attente':
				return "Aucune cotisation n'a encore été enregistrée pour votre compte. Si vous venez de payer, comptez quelques jours pour que ce soit traité. Généralement le 1er mercredi du mois si cela ne passe pas automatiquement.";
			case 'non_applicable':
				return "En tant que membre d'honneur, vous n'êtes pas soumis·e à cotisation.";
		}
	}
</script>

{#if status === null}
	<div class="flex items-start gap-3 border border-black bg-gray-100 px-4 py-3">
		<span class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full bg-gray-400" aria-hidden="true"
		></span>
		<div>
			<p class="text-sm font-bold uppercase">Compte introuvable</p>
			<p class="text-sm text-gray-600">
				Nous n'avons pas trouvé de compte correspondant à votre adresse email dans l'outil de
				gestion des membres. Cela peut simplement vouloir dire que votre inscription n'a pas
				encore été synchronisée, ou provenir d'une erreur. Si ça persiste, contactez une personne
				en charge de la trésorerie ou du registre des membres. Via le canal #support du chat ou
				par mail <a href="mailto:ping@lghs.be">ping@lghs.be</a>.
			</p>
		</div>
	</div>
{:else}
	<div class="flex items-start gap-3 border border-black bg-gray-100 px-4 py-3">
		<span
			class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
			style="background-color: {COTISATION_STATUS_COLOR[status]};"
			aria-hidden="true"
		></span>
		<div>
			<p class="text-sm font-bold uppercase">{COTISATION_STATUS_LABEL[status]}</p>
			<p class="text-sm text-gray-600">{statusExplanation(status, datefin)}</p>
			{#if isInactive}
				<p class="mt-2 text-sm font-bold">
					Après 3 mois sans cotisation, votre compte est considéré comme inactif.
				</p>
			{/if}
		</div>
	</div>
{/if}
