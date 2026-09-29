<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	// Seeded once from the load/form result — the form owns its values once the treasurer types.
	// svelte-ignore state_referenced_locally
	let v = $state({ ...(form?.values ?? data.settings) });

	$effect(() => {
		if (form?.success) showToast('success', form.gmailDeconnecte ? 'Boîte Gmail déconnectée.' : 'Paramètres enregistrés.');
		else if (form?.error) showToast('error', form.error);
	});
	// Back from Google's consent screen.
	$effect(() => {
		if (data.gmail.resultat === 'ok') showToast('success', 'Boîte Gmail connectée.');
		else if (data.gmail.resultat === 'erreur') showToast('error', data.gmail.raison ?? 'Connexion Gmail impossible.');
	});

	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' });

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
</script>

<svelte:head>
	<title>Paramètres — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Paramètres compta</h1>

	<form
		method="POST"
		action="?/update"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Adhésions</h2>
		<div class="mb-8 border border-black p-4">
			<p class="mb-4 text-sm text-gray-600">
				Nombre de jours pendant lesquels un membre garde son accès après la fin de sa dernière cotisation
				(statut « Cotisation à renouveler »). Passé ce délai, la cotisation est « expirée » et le compte est
				considéré comme inactif.
			</p>
			<label class={labelClass} for="delaiGraceJours">Délai de grâce (jours)</label>
			<input id="delaiGraceJours" name="delaiGraceJours" type="number" min="0" max="365" bind:value={v.delaiGraceJours} class="w-32 border border-black px-3 py-2 text-sm" />

			<label class="mt-4 flex items-start gap-3 text-sm">
				<input type="checkbox" name="desactivationAuto" bind:checked={v.desactivationAuto} class="mt-1" />
				<span>
					<span class="font-bold">Désactiver automatiquement le compte Authentik</span> des membres dont la cotisation est
					expirée (délai de grâce dépassé), et le réactiver dès qu'ils sont à nouveau en ordre. Vérifié toutes les six
					heures ; les admins et trésoriers ne sont jamais désactivés ; chaque action est journalisée dans l'audit.
				</span>
			</label>
		</div>

		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Factures émises</h2>
		<div class="mb-8 grid gap-3 border border-black p-4 sm:grid-cols-2">
			<div>
				<label class={labelClass} for="emetteurNom">Émetteur</label>
				<input id="emetteurNom" name="emetteurNom" type="text" required bind:value={v.emetteurNom} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="emetteurNumeroEntreprise">N° d'entreprise</label>
				<input id="emetteurNumeroEntreprise" name="emetteurNumeroEntreprise" type="text" bind:value={v.emetteurNumeroEntreprise} class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="emetteurAdresse">Adresse (une ligne par ligne d'adresse)</label>
				<textarea id="emetteurAdresse" name="emetteurAdresse" rows="3" bind:value={v.emetteurAdresse} class={inputClass}></textarea>
			</div>
			<div>
				<label class={labelClass} for="emetteurEmail">Email</label>
				<input id="emetteurEmail" name="emetteurEmail" type="email" bind:value={v.emetteurEmail} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="emetteurIban">IBAN à payer</label>
				<input id="emetteurIban" name="emetteurIban" type="text" bind:value={v.emetteurIban} class="{inputClass} font-mono uppercase" />
			</div>
			<div>
				<label class={labelClass} for="delaiPaiementJours">Délai de paiement par défaut (jours)</label>
				<input id="delaiPaiementJours" name="delaiPaiementJours" type="number" min="0" max="365" bind:value={v.delaiPaiementJours} class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="mentionTva">Mention TVA (imprimée sur chaque facture)</label>
				<input id="mentionTva" name="mentionTva" type="text" required bind:value={v.mentionTva} class={inputClass} />
			</div>
		</div>

		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Rappels de paiement</h2>
		<div class="mb-8 border border-black p-4">
			<p class="mb-4 text-sm text-gray-600">
				Une facture émise est proposée au rappel ce nombre de jours après son échéance, puis à nouveau le même
				nombre de jours après chaque rappel. Rien ne part sans qu'un trésorier l'ait choisi
				(<a href="/compta/rappels">Rappels</a>).
			</p>
			<label class={labelClass} for="rappelDelaiJours">Délai avant rappel (jours)</label>
			<input id="rappelDelaiJours" name="rappelDelaiJours" type="number" min="0" max="365" bind:value={v.rappelDelaiJours} class="w-32 border border-black px-3 py-2 text-sm" />
		</div>

		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Réception des factures (Doccle)</h2>
		<div class="mb-8 border border-black p-4">
			<p class="mb-4 text-sm text-gray-600">
				Les mails reçus de ces domaines dans la boîte Gmail connectée sont relevés, avec leurs pièces jointes
				(PDF, UBL), dans <a href="/compta/reception">Réception Doccle</a>. Un mail dont l'origine n'est pas prouvée
				(DKIM / DMARC) est signalé, et rien n'entre dans les factures sans validation.
			</p>
			<label class={labelClass} for="receptionDomaines">Domaines d'expéditeur acceptés (séparés par des virgules)</label>
			<input id="receptionDomaines" name="receptionDomaines" type="text" bind:value={v.receptionDomaines} class="{inputClass} font-mono" />
			<label class="mt-4 flex items-start gap-3 text-sm">
				<input type="checkbox" name="receptionAuto" bind:checked={v.receptionAuto} class="mt-1" />
				<span><span class="font-bold">Relever la boîte automatiquement</span> toutes les heures. Sinon, le relevé se fait à la demande.</span>
			</label>
		</div>

		<button type="submit" disabled={submitting} class="btn-primary px-4 py-2 disabled:opacity-50">
			{submitting ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>

	<h2 id="gmail" class="mt-10 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Boîte Gmail</h2>
	<div class="border border-black p-4 text-sm">
		<p class="mb-4 text-gray-600">
			La boîte de la trésorerie : les factures et les rappels en partent, et les factures envoyées par Doccle y sont
			lues. Passport peut envoyer et lire, jamais modifier ni supprimer un mail.
		</p>
		{#if !data.gmail.clientConfigured}
			<p class="border border-black bg-gray-100 px-4 py-3">
				Le client OAuth n'est pas configuré : renseignez <code>GMAIL_CLIENT_ID</code> et
				<code>GMAIL_CLIENT_SECRET</code> dans l'environnement (voir <code>.env.example</code>), avec pour URI de
				redirection autorisée <code class="break-all">{data.gmail.redirectUri}</code>.
			</p>
		{:else if data.gmail.connexion}
			<p class="mb-4">
				Connectée : <span class="font-bold">{data.gmail.connexion.email}</span>
				<span class="text-gray-600">
					— par {data.gmail.connexion.connectePar}, le {dateTimeFormat.format(data.gmail.connexion.connecteLe)}
				</span>
			</p>
			<div class="flex flex-wrap gap-3">
				<form method="POST" action="?/connecterGmail">
					<button type="submit" class="btn-primary px-4 py-2">Reconnecter</button>
				</form>
				<form method="POST" action="?/deconnecterGmail" use:enhance>
					<button type="submit" class="border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Déconnecter</button>
				</form>
			</div>
		{:else}
			<p class="mb-4">Aucune boîte connectée : aucun email ne part, aucune facture n'est relevée.</p>
			<!-- No use:enhance: the action redirects to Google, a full page navigation. -->
			<form method="POST" action="?/connecterGmail">
				<button type="submit" class="btn-primary px-4 py-2">Connecter Gmail</button>
			</form>
			<p class="mt-3 text-xs text-gray-600">
				URI de redirection à déclarer dans la console Google : <code class="break-all">{data.gmail.redirectUri}</code>
			</p>
		{/if}
	</div>
</section>
