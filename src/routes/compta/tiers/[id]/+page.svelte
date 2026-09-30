<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import TiersForm from '$lib/components/compta/TiersForm.svelte';
	import CotisationStatusBlock from '$lib/components/CotisationStatusBlock.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const isOrganisation = $derived(data.tiers.nature === 'personne_morale');

	// Calendar days pinned to UTC midnight by the server — formatted in UTC, see compta/dates.ts.
	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const fmt = (d: Date | null) => (d ? dateFormat.format(d) : '—');
	// The reader's own calendar day for a form default — toISOString() would say yesterday between
	// midnight and 2am in Brussels.
	const today = new Date().toLocaleDateString('en-CA');

	// Sections collapsed by default, except the one whose action just answered.
	let tiersOpen = $state(false);
	let cotisationFormOpen = $state(false);
	let lienFormOpen = $state(false);
	let abonnementFormOpen = $state(false);

	// Each form adds or corrects: `id` null is a new row, otherwise the row being corrected, whose
	// values fill the form. Dates are the form's own (last covered day, not the exclusive end).
	const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
	const dernierJour = (fin: Date | null) => (fin ? isoDate(new Date(fin.getTime() - 86_400_000)) : '');
	const montantSaisi = (n: number) => n.toFixed(2).replace('.', ',');

	const cotisationVide = () => ({
		id: null as number | null,
		type: (data.tiers.nature === 'personne_morale' ? 'facturee' : 'libre') as 'libre' | 'facturee' | 'sponsoring',
		debut: '',
		fin: '',
		montant: '',
		sieges: 1,
		statut: 'active' as 'attendue' | 'active' | 'annulee',
		payeLe: '',
		note: '',
		deFacture: false
	});
	let cotisation = $state(cotisationVide());
	function corrigerCotisation(c: PageData['cotisations'][number]) {
		cotisation = {
			id: c.id,
			type: c.type,
			debut: isoDate(c.debut),
			fin: dernierJour(c.fin),
			montant: montantSaisi(c.montant),
			sieges: c.sieges,
			statut: c.statut,
			payeLe: isoDate(c.payeLe),
			note: c.note ?? '',
			deFacture: c.factureId !== null
		};
		cotisationFormOpen = true;
	}

	const abonnementVide = () => ({ id: null as number | null, libelle: '', prix: '', periodicite: 'annee' as 'mois' | 'annee', sieges: 1, prochaineEcheance: '' });
	let abonnement = $state(abonnementVide());
	function corrigerAbonnement(a: PageData['abonnements'][number]) {
		abonnement = { id: a.id, libelle: a.libelle, prix: montantSaisi(a.prix), periodicite: a.periodicite, sieges: a.sieges, prochaineEcheance: isoDate(a.prochaineEcheance) };
		abonnementFormOpen = true;
	}

	const lienVide = () => ({
		id: null as number | null,
		autreNom: '',
		depuis: today,
		jusqua: '',
		estEmploye: false,
		estAdministrateur: false,
		estContact: false,
		destinataireFactures: false,
		heriteAdhesion: true
	});
	let lien = $state(lienVide());
	function corrigerLien(l: PageData['liens'][number]) {
		const autre = data.tiers.nature === 'personne_morale' ? l.personne : l.organisation;
		lien = {
			id: l.id,
			autreNom: autre.nature === 'personne_physique' && autre.prenom ? `${autre.prenom} ${autre.nom}` : autre.nom,
			depuis: isoDate(l.depuis),
			jusqua: dernierJour(l.jusqua),
			estEmploye: l.estEmploye,
			estAdministrateur: l.estAdministrateur,
			estContact: l.estContact,
			destinataireFactures: l.destinataireFactures,
			heriteAdhesion: l.heriteAdhesion
		};
		lienFormOpen = true;
	}

	function confirmer(message: string) {
		return ({ cancel }: { cancel: () => void }) => {
			if (!confirm(message)) cancel();
			return async ({ update }: { update: () => Promise<void> }) => update();
		};
	}

	$effect(() => {
		if (!form) return;
		if (form.success) {
			showToast('success', form.success);
			// Saved: the form goes back to "add".
			if (form.section === 'cotisation') (cotisation = cotisationVide()), (cotisationFormOpen = false);
			if (form.section === 'abonnement') (abonnement = abonnementVide()), (abonnementFormOpen = false);
			if (form.section === 'lien') (lien = lienVide()), (lienFormOpen = false);
		}
		if (form.error) {
			showToast('error', form.error);
			if (form.section === 'tiers') tiersOpen = true;
			if (form.section === 'cotisation') cotisationFormOpen = true;
			if (form.section === 'lien') lienFormOpen = true;
			if (form.section === 'abonnement') abonnementFormOpen = true;
		}
	});

	// Initial values for the tiers form, in its field names; a failed submission's echo wins.
	const tiersValues = $derived(
		form?.section === 'tiers' && form.values
			? form.values
			: {
					nature: data.tiers.nature,
					nom: data.tiers.nom,
					prenom: data.tiers.prenom,
					email: data.tiers.email,
					telephone: data.tiers.telephone,
					adresse: data.tiers.adresse,
					codePostal: data.tiers.codePostal,
					ville: data.tiers.ville,
					pays: data.tiers.pays,
					numeroEntreprise: data.tiers.numeroEntreprise,
					iban: data.tiers.iban,
					notes: data.tiers.notes,
					estClient: data.tiers.estClient,
					estFournisseur: data.tiers.estFournisseur,
					exempteCotisation: data.tiers.exempteCotisation,
					inactif: !data.tiers.actif
				}
	);

	const TYPE_LABEL = { libre: 'Libre', facturee: 'Facturée', sponsoring: 'Sponsoring' } as const;
	const STATUT_LABEL = { attendue: 'En attente de paiement', active: 'Payée', annulee: 'Annulée' } as const;
	const STATUT_CLASS = { attendue: 'text-orange-600', active: 'text-green-700', annulee: 'text-gray-400 line-through' } as const;

	function lienRoles(l: PageData['liens'][number]): string {
		const r: string[] = [];
		if (l.estAdministrateur) r.push('administrateur');
		if (l.estEmploye) r.push('employé');
		if (l.estContact) r.push('contact');
		if (l.destinataireFactures) r.push('reçoit les factures');
		return r.join(', ') || '—';
	}

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const h2Class = 'mb-4 flex flex-wrap items-center justify-between gap-2 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const smallBtn = 'border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white disabled:opacity-40';
</script>

<svelte:head>
	<title>{data.tiers.displayName} — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">
			{data.tiers.displayName}
			<span class="ml-2 text-xs font-normal opacity-70">{isOrganisation ? 'Société' : 'Personne'}{data.tiers.actif ? '' : ' · inactif'}</span>
		</h1>
		<a href="/compta/tiers" class="text-sm">← Tous les tiers</a>
	</div>

	<div class="mb-8 grid gap-6 md:grid-cols-2">
		<div>
			<CotisationStatusBlock
				status={data.situation.status}
				datefin={data.situation.datefin}
				finGrace={data.situation.finGrace}
				isInactive={data.situation.isInactive}
			/>
			{#if data.situation.via}
				<p class="mt-2 text-sm text-gray-600">Couvert via <span class="font-bold">{data.situation.via}</span>.</p>
			{/if}
			{#if data.sieges}
				<p class="mt-2 text-sm text-gray-600">
					Sièges : <span class="font-bold">{data.sieges.utilises} / {data.sieges.total}</span> utilisés.
				</p>
			{/if}
		</div>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-black p-4 text-sm">
			<dt class="font-bold uppercase">Email</dt><dd>{data.tiers.email ?? '—'}</dd>
			<dt class="font-bold uppercase">Téléphone</dt><dd>{data.tiers.telephone ?? '—'}</dd>
			<dt class="font-bold uppercase">Adresse</dt>
			<dd>{[data.tiers.adresse, [data.tiers.codePostal, data.tiers.ville].filter(Boolean).join(' '), data.tiers.pays].filter(Boolean).join(', ') || '—'}</dd>
			{#if isOrganisation}
				<dt class="font-bold uppercase">N° BCE</dt><dd>{data.tiers.numeroEntreprise ?? '—'}</dd>
			{/if}
			<dt class="font-bold uppercase">IBAN</dt><dd class="font-mono">{data.tiers.iban ?? '—'}</dd>
			{#if !isOrganisation}
				<dt class="font-bold uppercase">Compte</dt>
				<dd>{data.tiers.authentikPk ? `Authentik #${data.tiers.authentikPk}` : 'Aucun compte Passport lié'}</dd>
			{/if}
			{#if data.tiers.dolibarrMemberId || data.tiers.dolibarrSocId}
				<dt class="font-bold uppercase">Dolibarr</dt>
				<dd class="text-gray-500">
					{[data.tiers.dolibarrMemberId && `adhérent ${data.tiers.dolibarrMemberId}`, data.tiers.dolibarrSocId && `tiers ${data.tiers.dolibarrSocId}`].filter(Boolean).join(', ')}
				</dd>
			{/if}
		</dl>
	</div>

	<!-- Fiche -->
	<h2 class={h2Class}>
		Fiche
		<button type="button" onclick={() => (tiersOpen = !tiersOpen)} class="text-xs underline">{tiersOpen ? 'Fermer' : 'Modifier'}</button>
	</h2>
	{#if tiersOpen}
		<div class="mb-8"><TiersForm action="?/update" values={tiersValues} /></div>
	{/if}

	<!-- Cotisations -->
	<h2 class={h2Class}>
		Cotisations
		<button
			type="button"
			onclick={() => {
				cotisationFormOpen = !cotisationFormOpen || cotisation.id !== null;
				cotisation = cotisationVide();
			}}
			class="text-xs underline"
		>
			{cotisationFormOpen && cotisation.id === null ? 'Fermer' : 'Ajouter'}
		</button>
	</h2>
	{#if cotisationFormOpen}
		<form method="POST" action="?/saveCotisation" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance={() => async ({ update }) => update({ reset: false })}>
			{#if cotisation.id !== null}
				<input type="hidden" name="cotisationId" value={cotisation.id} />
				<p class="text-sm font-bold sm:col-span-3">
					Correction d'une cotisation
					{#if cotisation.deFacture}
						<span class="block font-normal text-gray-600">
							Elle vient d'une facture : la facture elle-même ne change pas. Pour en changer le montant, passez par une note
							de crédit.
						</span>
					{/if}
				</p>
			{/if}
			<div>
				<label class={labelClass} for="type">Type</label>
				<select id="type" name="type" bind:value={cotisation.type} class={inputClass}>
					<option value="libre">Libre</option>
					<option value="facturee">Facturée</option>
					<option value="sponsoring">Sponsoring</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="debut">Du</label>
				<input id="debut" name="debut" type="date" required bind:value={cotisation.debut} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="fin">Au (dernier jour couvert)</label>
				<input id="fin" name="fin" type="date" required bind:value={cotisation.fin} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="montant">Montant (€)</label>
				<input id="montant" name="montant" type="text" inputmode="decimal" placeholder="0,00" required bind:value={cotisation.montant} class={inputClass} />
			</div>
			{#if isOrganisation}
				<div>
					<label class={labelClass} for="sieges">Sièges</label>
					<input id="sieges" name="sieges" type="number" min="0" bind:value={cotisation.sieges} class={inputClass} />
				</div>
			{/if}
			<div>
				<label class={labelClass} for="statut">Statut</label>
				<select id="statut" name="statut" bind:value={cotisation.statut} class={inputClass}>
					<option value="active">Payée</option>
					<option value="attendue">En attente de paiement</option>
					{#if cotisation.id !== null}<option value="annulee">Annulée</option>{/if}
				</select>
			</div>
			<div>
				<label class={labelClass} for="payeLe">Payée le</label>
				<input id="payeLe" name="payeLe" type="date" bind:value={cotisation.payeLe} class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="note">Note</label>
				<input id="note" name="note" type="text" bind:value={cotisation.note} class={inputClass} />
			</div>
			<div class="flex gap-3 sm:col-span-3">
				<button type="submit" class="btn-primary px-4 py-2">{cotisation.id === null ? 'Ajouter' : 'Enregistrer la correction'}</button>
				{#if cotisation.id !== null}
					<button type="button" onclick={() => ((cotisation = cotisationVide()), (cotisationFormOpen = false))} class="border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Annuler</button>
				{/if}
			</div>
		</form>
	{/if}
	{#if data.cotisations.length > 0}
		<table class="table-cards mb-8 w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class="border border-black px-3 py-2 text-left">Du</th>
					<th class="border border-black px-3 py-2 text-left">Au</th>
					<th class="border border-black px-3 py-2 text-left">Type</th>
					<th class="border border-black px-3 py-2 text-right">Montant</th>
					{#if isOrganisation}<th class="border border-black px-3 py-2 text-right">Sièges</th>{/if}
					<th class="border border-black px-3 py-2 text-left">Statut</th>
					<th class="border border-black px-3 py-2 text-left">Note</th>
					<th class="border border-black px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.cotisations as c (c.id)}
					<tr class={cotisation.id === c.id ? 'bg-lghs-yellow' : ''}>
						<td class="border border-black px-3 py-2" data-label="Du">{fmt(c.debut)}</td>
						<td class="border border-black px-3 py-2" data-label="Au">{fmt(new Date(c.fin.getTime() - 86_400_000))}</td>
						<td class="border border-black px-3 py-2" data-label="Type">
							<span>
								{TYPE_LABEL[c.type]}
								{#if c.factureId}<a href="/compta/factures/{c.factureId}" class="block text-xs">facture</a>{/if}
							</span>
						</td>
						<td class="border border-black px-3 py-2 sm:text-right" data-label="Montant">{amountFormat.format(c.montant)}</td>
						{#if isOrganisation}<td class="border border-black px-3 py-2 sm:text-right" data-label="Sièges">{c.sieges}</td>{/if}
						<td class="border border-black px-3 py-2 {STATUT_CLASS[c.statut]}" data-label="Statut">
							{STATUT_LABEL[c.statut]}{c.payeLe && c.statut === 'active' ? ` le ${fmt(c.payeLe)}` : ''}
						</td>
						<td class="border border-black px-3 py-2 text-gray-600" data-label={c.note ? 'Note' : undefined}>{c.note ?? ''}</td>
						<td class="border border-black px-2 py-1">
							<div class="flex flex-wrap gap-1">
								{#if c.statut === 'attendue'}
									<form method="POST" action="?/setCotisationStatut" use:enhance>
										<input type="hidden" name="cotisationId" value={c.id} />
										<input type="hidden" name="statut" value="active" />
										<button type="submit" class={smallBtn}>Marquer payée</button>
									</form>
								{/if}
								<button type="button" onclick={() => corrigerCotisation(c)} class={smallBtn}>Corriger</button>
								{#if c.statut !== 'annulee'}
									<form method="POST" action="?/setCotisationStatut" use:enhance>
										<input type="hidden" name="cotisationId" value={c.id} />
										<input type="hidden" name="statut" value="annulee" />
										<button type="submit" class={smallBtn}>Annuler</button>
									</form>
								{/if}
								{#if !c.factureId}
									<form method="POST" action="?/deleteCotisation" use:enhance={confirmer('Supprimer cette cotisation ? Elle disparaît de l’historique.')}>
										<input type="hidden" name="cotisationId" value={c.id} />
										<button type="submit" class={smallBtn}>Supprimer</button>
									</form>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune cotisation.</p>
	{/if}

	<!-- Abonnement (organisations) -->
	{#if isOrganisation}
		<h2 class={h2Class}>
			Abonnement
			<button
				type="button"
				onclick={() => {
					abonnementFormOpen = !abonnementFormOpen || abonnement.id !== null;
					abonnement = abonnementVide();
				}}
				class="text-xs underline"
			>
				{abonnementFormOpen && abonnement.id === null ? 'Fermer' : 'Ajouter'}
			</button>
		</h2>
		{#if abonnementFormOpen}
			<form method="POST" action="?/saveAbonnement" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance={() => async ({ update }) => update({ reset: false })}>
				{#if abonnement.id !== null}
					<input type="hidden" name="abonnementId" value={abonnement.id} />
					<p class="text-sm font-bold sm:col-span-3">
						Correction d'un abonnement
						<span class="block font-normal text-gray-600">Les factures déjà émises ne changent pas : la correction vaut pour les prochaines.</span>
					</p>
				{/if}
				<div class="sm:col-span-3">
					<label class={labelClass} for="libelle">Libellé (ligne de facture)</label>
					<input id="libelle" name="libelle" type="text" required placeholder="Affiliation Hackerspace 12 mois" bind:value={abonnement.libelle} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="prix">Prix par période (€)</label>
					<input id="prix" name="prix" type="text" inputmode="decimal" required bind:value={abonnement.prix} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="periodicite">Périodicité</label>
					<select id="periodicite" name="periodicite" bind:value={abonnement.periodicite} class={inputClass}>
						<option value="annee">Annuelle</option>
						<option value="mois">Mensuelle</option>
					</select>
				</div>
				<div>
					<label class={labelClass} for="abo-sieges">Sièges par période</label>
					<input id="abo-sieges" name="sieges" type="number" min="0" bind:value={abonnement.sieges} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="prochaineEcheance">Prochaine échéance à facturer</label>
					<input id="prochaineEcheance" name="prochaineEcheance" type="date" required bind:value={abonnement.prochaineEcheance} class={inputClass} />
				</div>
				<div class="flex gap-3 sm:col-span-3">
					<button type="submit" class="btn-primary px-4 py-2">{abonnement.id === null ? 'Créer' : 'Enregistrer la correction'}</button>
					{#if abonnement.id !== null}
						<button type="button" onclick={() => ((abonnement = abonnementVide()), (abonnementFormOpen = false))} class="border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Annuler</button>
					{/if}
				</div>
			</form>
		{/if}
		{#if data.abonnements.length > 0}
			<table class="table-cards mb-4 w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Libellé</th>
						<th class="border border-black px-3 py-2 text-right">Prix</th>
						<th class="border border-black px-3 py-2 text-left">Périodicité</th>
						<th class="border border-black px-3 py-2 text-right">Sièges</th>
						<th class="border border-black px-3 py-2 text-left">Prochaine échéance</th>
						<th class="border border-black px-3 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.abonnements as a (a.id)}
						<tr class="{a.actif ? '' : 'text-gray-400'} {abonnement.id === a.id ? 'bg-lghs-yellow' : ''}">
							<td class="border border-black px-3 py-2 font-bold sm:font-normal">{a.libelle}{a.actif ? '' : ' (suspendu)'}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Prix">{amountFormat.format(a.prix)}</td>
							<td class="border border-black px-3 py-2" data-label="Périodicité">{a.periodicite === 'mois' ? 'Mensuelle' : 'Annuelle'}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Sièges">{a.sieges}</td>
							<td class="border border-black px-3 py-2" data-label="Prochaine échéance">{fmt(a.prochaineEcheance)}</td>
							<td class="border border-black px-2 py-1">
								<div class="flex flex-wrap gap-1">
									<button type="button" onclick={() => corrigerAbonnement(a)} class={smallBtn}>Corriger</button>
									<form method="POST" action="?/toggleAbonnement" use:enhance>
										<input type="hidden" name="abonnementId" value={a.id} />
										<button type="submit" class={smallBtn}>{a.actif ? 'Suspendre' : 'Réactiver'}</button>
									</form>
									<form method="POST" action="?/deleteAbonnement" use:enhance={confirmer('Supprimer cet abonnement ?')}>
										<input type="hidden" name="abonnementId" value={a.id} />
										<button type="submit" class={smallBtn}>Supprimer</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="mb-8 text-sm text-gray-600">
				À chaque échéance, la facture de la période est émise automatiquement (et envoyée, si une boîte Gmail est connectée).
			</p>
		{:else}
			<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun abonnement.</p>
		{/if}
	{/if}

	<!-- Liens -->
	<h2 class={h2Class}>
		{isOrganisation ? 'Personnes liées' : 'Sociétés liées'}
		<button
			type="button"
			onclick={() => {
				lienFormOpen = !lienFormOpen || lien.id !== null;
				lien = lienVide();
			}}
			class="text-xs underline"
		>
			{lienFormOpen && lien.id === null ? 'Fermer' : 'Ajouter'}
		</button>
	</h2>
	{#if lienFormOpen}
		<form method="POST" action="?/saveLien" class="mb-4 border border-black p-4" use:enhance={() => async ({ update }) => update({ reset: false })}>
			{#if lien.id !== null}<input type="hidden" name="lienId" value={lien.id} />{/if}
			<div class="grid gap-3 sm:grid-cols-3">
				<div>
					<label class={labelClass} for="autreId">{isOrganisation ? 'Personne' : 'Société'}</label>
					{#if lien.id !== null}
						<p id="autreId" class="border border-black bg-gray-100 px-3 py-2 text-sm">{lien.autreNom}</p>
					{:else}
						<select id="autreId" name="autreId" required class={inputClass}>
							<option value="">—</option>
							{#each data.candidats as c (c.id)}
								<option value={c.id}>{c.nom}</option>
							{/each}
						</select>
					{/if}
				</div>
				<div>
					<label class={labelClass} for="depuis">Depuis</label>
					<input id="depuis" name="depuis" type="date" bind:value={lien.depuis} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="jusqua">Jusqu'au (dernier jour, vide = en cours)</label>
					<input id="jusqua" name="jusqua" type="date" bind:value={lien.jusqua} class={inputClass} />
				</div>
			</div>
			<div class="mt-3 flex flex-wrap gap-4 text-sm">
				<label class="flex items-center gap-2"><input type="checkbox" name="estEmploye" bind:checked={lien.estEmploye} /> Employé·e</label>
				<label class="flex items-center gap-2" title="Preneur de décision : voit la société et ses factures dans Passport">
					<input type="checkbox" name="estAdministrateur" bind:checked={lien.estAdministrateur} /> Administrateur
				</label>
				<label class="flex items-center gap-2"><input type="checkbox" name="estContact" bind:checked={lien.estContact} /> Contact</label>
				<label class="flex items-center gap-2"><input type="checkbox" name="destinataireFactures" bind:checked={lien.destinataireFactures} /> Reçoit les factures</label>
				<label class="flex items-center gap-2" title="Consomme un siège de la cotisation de la société">
					<input type="checkbox" name="heriteAdhesion" bind:checked={lien.heriteAdhesion} /> Membre via la société
				</label>
			</div>
			<div class="mt-4 flex gap-3">
				<button type="submit" class="btn-primary px-4 py-2">{lien.id === null ? 'Lier' : 'Enregistrer la correction'}</button>
				{#if lien.id !== null}
					<button type="button" onclick={() => ((lien = lienVide()), (lienFormOpen = false))} class="border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100">Annuler</button>
				{/if}
			</div>
		</form>
	{/if}
	{#if data.liens.length > 0}
		<table class="table-cards w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class="border border-black px-3 py-2 text-left">{isOrganisation ? 'Personne' : 'Société'}</th>
					<th class="border border-black px-3 py-2 text-left">Rôles</th>
					<th class="border border-black px-3 py-2 text-center">Siège</th>
					<th class="border border-black px-3 py-2 text-left">Depuis</th>
					<th class="border border-black px-3 py-2 text-left">Jusqu'au</th>
					<th class="border border-black px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.liens as l (l.id)}
					{@const autre = isOrganisation ? l.personne : l.organisation}
					<tr class="{l.jusqua ? 'text-gray-400' : ''} {lien.id === l.id ? 'bg-lghs-yellow' : ''}">
						<td class="border border-black px-3 py-2">
							<a href="/compta/tiers/{autre.id}" class="font-bold">
								{autre.nature === 'personne_physique' && autre.prenom ? `${autre.prenom} ${autre.nom}` : autre.nom}
							</a>
						</td>
						<td class="border border-black px-3 py-2" data-label="Rôles">{lienRoles(l)}</td>
						<td class="border border-black px-3 py-2 sm:text-center" data-label="Membre via la société">{l.heriteAdhesion ? '✓' : '—'}</td>
						<td class="border border-black px-3 py-2" data-label="Depuis">{fmt(l.depuis)}</td>
						<td class="border border-black px-3 py-2" data-label="Jusqu'au">{l.jusqua ? fmt(new Date(l.jusqua.getTime() - 86_400_000)) : '—'}</td>
						<td class="border border-black px-2 py-1">
							<div class="flex flex-wrap gap-1">
								<button type="button" onclick={() => corrigerLien(l)} class={smallBtn}>Corriger</button>
								<form method="POST" action="?/closeLien" use:enhance>
									<input type="hidden" name="lienId" value={l.id} />
									{#if l.jusqua}<input type="hidden" name="reopen" value="1" />{/if}
									<button type="submit" class={smallBtn}>{l.jusqua ? 'Réouvrir' : 'Clore'}</button>
								</form>
								<form method="POST" action="?/deleteLien" use:enhance={confirmer('Supprimer ce lien ? Pour une personne qui a quitté la société, clôturez-le plutôt : son historique reste expliqué.')}>
									<input type="hidden" name="lienId" value={l.id} />
									<button type="submit" class={smallBtn}>Supprimer</button>
								</form>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun lien.</p>
	{/if}
</section>
