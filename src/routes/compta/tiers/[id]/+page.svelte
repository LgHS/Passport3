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

	$effect(() => {
		if (!form) return;
		if (form.success) showToast('success', form.success);
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
		<button type="button" onclick={() => (cotisationFormOpen = !cotisationFormOpen)} class="text-xs underline">
			{cotisationFormOpen ? 'Fermer' : 'Ajouter'}
		</button>
	</h2>
	{#if cotisationFormOpen}
		<form method="POST" action="?/addCotisation" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
			<div>
				<label class={labelClass} for="type">Type</label>
				<select id="type" name="type" class={inputClass}>
					<option value={isOrganisation ? 'facturee' : 'libre'}>{isOrganisation ? 'Facturée' : 'Libre'}</option>
					{#if isOrganisation}<option value="sponsoring">Sponsoring</option>{/if}
					<option value={isOrganisation ? 'libre' : 'facturee'}>{isOrganisation ? 'Libre' : 'Facturée'}</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="debut">Du</label>
				<input id="debut" name="debut" type="date" required class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="fin">Au (dernier jour couvert)</label>
				<input id="fin" name="fin" type="date" required class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="montant">Montant (€)</label>
				<input id="montant" name="montant" type="text" inputmode="decimal" placeholder="0,00" required class={inputClass} />
			</div>
			{#if isOrganisation}
				<div>
					<label class={labelClass} for="sieges">Sièges</label>
					<input id="sieges" name="sieges" type="number" min="0" value="1" class={inputClass} />
				</div>
			{/if}
			<div>
				<label class={labelClass} for="statut">Statut</label>
				<select id="statut" name="statut" class={inputClass}>
					<option value="active">Payée</option>
					<option value="attendue">En attente de paiement</option>
				</select>
			</div>
			<div>
				<label class={labelClass} for="payeLe">Payée le</label>
				<input id="payeLe" name="payeLe" type="date" class={inputClass} />
			</div>
			<div class="sm:col-span-2">
				<label class={labelClass} for="note">Note</label>
				<input id="note" name="note" type="text" class={inputClass} />
			</div>
			<div class="sm:col-span-3"><button type="submit" class="btn-primary px-4 py-2">Ajouter</button></div>
		</form>
	{/if}
	{#if data.cotisations.length > 0}
		<div class="mb-8 overflow-x-auto">
			<table class="w-full border-collapse text-sm">
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
						<tr>
							<td class="border border-black px-3 py-2">{fmt(c.debut)}</td>
							<td class="border border-black px-3 py-2">{fmt(new Date(c.fin.getTime() - 86_400_000))}</td>
							<td class="border border-black px-3 py-2">{TYPE_LABEL[c.type]}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(c.montant)}</td>
							{#if isOrganisation}<td class="border border-black px-3 py-2 text-right">{c.sieges}</td>{/if}
							<td class="border border-black px-3 py-2 {STATUT_CLASS[c.statut]}">
								{STATUT_LABEL[c.statut]}{c.payeLe && c.statut === 'active' ? ` le ${fmt(c.payeLe)}` : ''}
							</td>
							<td class="border border-black px-3 py-2 text-gray-600">{c.note ?? ''}</td>
							<td class="border border-black px-2 py-1 whitespace-nowrap">
								{#if c.statut === 'attendue'}
									<form method="POST" action="?/setCotisationStatut" class="inline" use:enhance>
										<input type="hidden" name="cotisationId" value={c.id} />
										<input type="hidden" name="statut" value="active" />
										<button type="submit" class={smallBtn}>Marquer payée</button>
									</form>
								{/if}
								{#if c.statut !== 'annulee'}
									<form method="POST" action="?/setCotisationStatut" class="inline" use:enhance>
										<input type="hidden" name="cotisationId" value={c.id} />
										<input type="hidden" name="statut" value="annulee" />
										<button type="submit" class={smallBtn}>Annuler</button>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune cotisation.</p>
	{/if}

	<!-- Abonnement (organisations) -->
	{#if isOrganisation}
		<h2 class={h2Class}>
			Abonnement
			<button type="button" onclick={() => (abonnementFormOpen = !abonnementFormOpen)} class="text-xs underline">
				{abonnementFormOpen ? 'Fermer' : 'Ajouter'}
			</button>
		</h2>
		{#if abonnementFormOpen}
			<form method="POST" action="?/addAbonnement" class="mb-4 grid gap-3 border border-black p-4 sm:grid-cols-3" use:enhance>
				<div class="sm:col-span-3">
					<label class={labelClass} for="libelle">Libellé (ligne de facture)</label>
					<input id="libelle" name="libelle" type="text" required placeholder="Affiliation Hackerspace 12 mois" class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="prix">Prix par période (€)</label>
					<input id="prix" name="prix" type="text" inputmode="decimal" required class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="periodicite">Périodicité</label>
					<select id="periodicite" name="periodicite" class={inputClass}>
						<option value="annee">Annuelle</option>
						<option value="mois">Mensuelle</option>
					</select>
				</div>
				<div>
					<label class={labelClass} for="abo-sieges">Sièges par période</label>
					<input id="abo-sieges" name="sieges" type="number" min="0" value="1" class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="prochaineEcheance">Prochaine échéance à facturer</label>
					<input id="prochaineEcheance" name="prochaineEcheance" type="date" required class={inputClass} />
				</div>
				<div class="sm:col-span-3"><button type="submit" class="btn-primary px-4 py-2">Créer</button></div>
			</form>
		{/if}
		{#if data.abonnements.length > 0}
			<div class="mb-8 overflow-x-auto">
				<table class="w-full border-collapse text-sm">
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
							<tr class={a.actif ? '' : 'text-gray-400'}>
								<td class="border border-black px-3 py-2">{a.libelle}</td>
								<td class="border border-black px-3 py-2 text-right">{amountFormat.format(a.prix)}</td>
								<td class="border border-black px-3 py-2">{a.periodicite === 'mois' ? 'Mensuelle' : 'Annuelle'}</td>
								<td class="border border-black px-3 py-2 text-right">{a.sieges}</td>
								<td class="border border-black px-3 py-2">{fmt(a.prochaineEcheance)}</td>
								<td class="border border-black px-2 py-1">
									<form method="POST" action="?/toggleAbonnement" use:enhance>
										<input type="hidden" name="abonnementId" value={a.id} />
										<button type="submit" class={smallBtn}>{a.actif ? 'Suspendre' : 'Réactiver'}</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="mb-8 text-sm text-gray-600">
				La facturation automatique à chaque échéance arrive avec le module Factures (phase 2) — en attendant,
				ajoutez la cotisation à la main ci-dessus quand la facture est émise.
			</p>
		{:else}
			<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun abonnement.</p>
		{/if}
	{/if}

	<!-- Liens -->
	<h2 class={h2Class}>
		{isOrganisation ? 'Personnes liées' : 'Sociétés liées'}
		<button type="button" onclick={() => (lienFormOpen = !lienFormOpen)} class="text-xs underline">
			{lienFormOpen ? 'Fermer' : 'Ajouter'}
		</button>
	</h2>
	{#if lienFormOpen}
		<form method="POST" action="?/addLien" class="mb-4 border border-black p-4" use:enhance>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class={labelClass} for="autreId">{isOrganisation ? 'Personne' : 'Société'}</label>
					<select id="autreId" name="autreId" required class={inputClass}>
						<option value="">—</option>
						{#each data.candidats as c (c.id)}
							<option value={c.id}>{c.nom}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class={labelClass} for="depuis">Depuis</label>
					<input id="depuis" name="depuis" type="date" value={today} class={inputClass} />
				</div>
			</div>
			<div class="mt-3 flex flex-wrap gap-4 text-sm">
				<label class="flex items-center gap-2"><input type="checkbox" name="estEmploye" /> Employé·e</label>
				<label class="flex items-center gap-2" title="Preneur de décision : voit les factures de la société dans Passport">
					<input type="checkbox" name="estAdministrateur" /> Administrateur
				</label>
				<label class="flex items-center gap-2"><input type="checkbox" name="estContact" /> Contact</label>
				<label class="flex items-center gap-2"><input type="checkbox" name="destinataireFactures" /> Reçoit les factures</label>
				<label class="flex items-center gap-2" title="Consomme un siège de la cotisation de la société">
					<input type="checkbox" name="heriteAdhesion" checked /> Membre via la société
				</label>
			</div>
			<button type="submit" class="btn-primary mt-4 px-4 py-2">Lier</button>
		</form>
	{/if}
	{#if data.liens.length > 0}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
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
						<tr class={l.jusqua ? 'text-gray-400' : ''}>
							<td class="border border-black p-0">
								<a href="/compta/tiers/{autre.id}" class="no-underline-fx block px-3 py-2 hover:bg-black hover:text-white">
									{autre.nature === 'personne_physique' && autre.prenom ? `${autre.prenom} ${autre.nom}` : autre.nom}
								</a>
							</td>
							<td class="border border-black px-3 py-2">{lienRoles(l)}</td>
							<td class="border border-black px-3 py-2 text-center">{l.heriteAdhesion ? '✓' : '—'}</td>
							<td class="border border-black px-3 py-2">{fmt(l.depuis)}</td>
							<td class="border border-black px-3 py-2">{l.jusqua ? fmt(new Date(l.jusqua.getTime() - 86_400_000)) : '—'}</td>
							<td class="border border-black px-2 py-1">
								<form method="POST" action="?/closeLien" use:enhance>
									<input type="hidden" name="lienId" value={l.id} />
									{#if l.jusqua}<input type="hidden" name="reopen" value="1" />{/if}
									<button type="submit" class={smallBtn}>{l.jusqua ? 'Réouvrir' : 'Clore'}</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun lien.</p>
	{/if}
</section>
