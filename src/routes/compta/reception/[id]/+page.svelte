<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const d = $derived(data.document);
	const v = $derived(data.verification);
	const f = $derived(data.facture);

	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' });
	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const isoDate = (iso: string | null) => (iso ? dateFormat.format(new Date(`${iso}T00:00:00Z`)) : '—');

	let submitting = $state(false);

	$effect(() => {
		if (form && 'error' in form && form.error) showToast('error', form.error);
		else if (form && 'success' in form) showToast('success', 'Document remis à valider.');
	});

	const RESULTAT_LABEL: Record<string, string> = {
		pass: 'réussi',
		fail: 'échoué',
		softfail: 'échoué (souple)',
		neutral: 'neutre',
		none: 'absent',
		temperror: 'erreur temporaire',
		permerror: 'erreur'
	};
	const resultat = (r: string | null | undefined) => (r ? (RESULTAT_LABEL[r] ?? r) : 'non contrôlé');
	const couleur = (r: string | null | undefined) => (r === 'pass' ? 'text-green-700' : r ? 'text-red-700' : 'text-gray-600');

	const h2 = 'mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const dt = 'text-xs font-bold text-gray-600 uppercase';
	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
	const enhanceSubmit = () => {
		submitting = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			submitting = false;
		};
	};
</script>

<svelte:head>
	<title>Facture reçue — Réception Doccle — Passport</title>
</svelte:head>

<div class="flex flex-col gap-8 lg:flex-row lg:items-start">
	<section class="w-full lg:w-2/3">
		<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
			<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">
				{f ? `${f.type === 'note_de_credit' ? 'Note de crédit' : 'Facture'} ${f.numero}` : 'Document reçu'}
			</h1>
			<a href="/compta/reception" class="text-sm">← Réception Doccle</a>
		</div>

		<h2 class={h2}>Origine du mail</h2>
		<div class="mb-8 border border-black p-4 text-sm">
			<p class="mb-4 text-base font-bold {v.verifie ? 'text-green-700' : 'text-red-700'}">
				{v.verifie ? 'Origine prouvée' : 'Origine non prouvée'}
			</p>
			<dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
				<div>
					<dt class={dt}>Expéditeur affiché</dt>
					<dd class="break-all">{d.expediteur || '—'}</dd>
				</div>
				<div>
					<dt class={dt}>Adresse réelle</dt>
					<dd class="break-all font-mono">{v.adresse ?? '—'}</dd>
				</div>
				<div>
					<dt class={dt}>Domaine</dt>
					<dd>
						<span class="font-mono">{v.domaine ?? '—'}</span>
						{#if v.domaineAccepte}
							<span class="text-green-700">— accepté ({v.domaineAccepte})</span>
						{:else}
							<span class="text-red-700">— hors des domaines acceptés</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt class={dt}>Reçu le</dt>
					<dd>{dateTimeFormat.format(d.recuLe)}</dd>
				</div>
				<div>
					<dt class={dt}>DMARC — le domaine affiché est authentifié</dt>
					<dd class="font-bold {couleur(v.dmarc?.resultat)}">
						{resultat(v.dmarc?.resultat)}{v.dmarc?.domaine ? ` (${v.dmarc.domaine})` : ''}
					</dd>
				</div>
				<div>
					<dt class={dt}>DKIM — signature du domaine</dt>
					<dd>
						{#each v.dkim as k, i (i)}
							<span class="block font-bold {couleur(k.resultat)}">{resultat(k.resultat)}{k.domaine ? ` (${k.domaine})` : ''}</span>
						{:else}
							<span class="font-bold text-gray-600">non contrôlé</span>
						{/each}
					</dd>
				</div>
				<div>
					<dt class={dt}>SPF — serveur d'envoi autorisé</dt>
					<dd class="font-bold {couleur(v.spf)}">{resultat(v.spf)}</dd>
				</div>
				<div>
					<dt class={dt}>Contrôle enregistré par Gmail</dt>
					<dd class="font-bold {v.enteteGmail ? 'text-green-700' : 'text-red-700'}">{v.enteteGmail ? 'oui' : 'non'}</dd>
				</div>
				<div class="sm:col-span-2">
					<dt class={dt}>Sujet</dt>
					<dd>{d.sujet || '—'}</dd>
				</div>
			</dl>
			{#if v.raisons.length > 0}
				<ul class="mt-4 list-disc border-t border-black pt-4 pl-5 text-red-700">
					{#each v.raisons as r (r)}<li>{r}</li>{/each}
				</ul>
			{/if}
			{#if v.ecartes.length > 0}
				<p class="mt-4 border-t border-black pt-4 font-bold">Pièces jointes non retenues</p>
				<ul class="list-disc pl-5 text-gray-600">
					{#each v.ecartes as e (e)}<li>{e}</li>{/each}
				</ul>
			{/if}
		</div>

		<h2 class={h2}>Facture</h2>
		{#if f}
			<dl class="mb-4 grid gap-x-6 gap-y-3 border border-black p-4 text-sm sm:grid-cols-2">
				<div>
					<dt class={dt}>Fournisseur</dt>
					<dd>
						<span class="font-bold">{f.fournisseur.nom}</span>
						{#if f.fournisseur.numeroEntreprise ?? f.fournisseur.tva}
							<span class="block font-mono text-xs">{f.fournisseur.numeroEntreprise ?? f.fournisseur.tva}</span>
						{/if}
						<span class="block text-xs text-gray-600">
							{[f.fournisseur.adresse, [f.fournisseur.codePostal, f.fournisseur.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
						</span>
					</dd>
				</div>
				<div>
					<dt class={dt}>Dans les tiers</dt>
					<dd>
						{#if data.fournisseurConnu}
							<a href="/compta/tiers/{data.fournisseurConnu.id}">{data.fournisseurConnu.nom}</a>
						{:else}
							<span class="text-orange-600">Inconnu — sera créé à l'import</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt class={dt}>Date</dt>
					<dd>{isoDate(f.dateEmission)}</dd>
				</div>
				<div>
					<dt class={dt}>Échéance</dt>
					<dd>{isoDate(f.dateEcheance)}</dd>
				</div>
			</dl>
			<table class="table-cards mb-8 w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Libellé</th>
						<th class="border border-black px-3 py-2 text-right">Quantité</th>
						<th class="border border-black px-3 py-2 text-right">Prix (TVAC)</th>
					</tr>
				</thead>
				<tbody>
					{#each f.lignes as l, i (i)}
						<tr>
							<td class="border border-black px-3 py-2">{l.libelle}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Quantité">{l.quantite}</td>
							<td class="border border-black px-3 py-2 sm:text-right" data-label="Prix (TVAC)">{amountFormat.format(l.prixUnitaire)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="font-bold">
						<td class="hidden border border-black px-3 py-2 text-right sm:table-cell" colspan="2">Total à payer</td>
						<td class="border border-black px-3 py-2 sm:text-right" data-label="Total à payer">{amountFormat.format(f.total)}</td>
					</tr>
				</tfoot>
			</table>
		{:else if data.erreurLecture}
			<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-red-700">UBL illisible : {data.erreurLecture}</p>
		{:else}
			<p class="mb-8 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Ce mail ne contenait pas d'UBL lisible : la facture est à renseigner à partir du PDF.
			</p>
		{/if}
	</section>

	<section class="w-full lg:w-1/3">
		<h2 class={h2}>Pièces</h2>
		<ul class="mb-8 border border-black p-4 text-sm">
			{#if d.pdfNom}<li><a href="/compta/reception/{d.id}/pdf">{d.pdfNom}</a></li>{/if}
			{#if d.ublNom}<li><a href="/compta/reception/{d.id}/ubl">{d.ublNom}</a></li>{/if}
			{#if !d.pdfNom && f?.pdfIntegre}<li class="text-gray-600">PDF intégré à l'UBL (conservé à l'import)</li>{/if}
		</ul>

		{#if d.statut === 'importe'}
			<h2 class={h2}>Importée</h2>
			<p class="border border-black p-4 text-sm">
				{#if d.factureId}<a href="/compta/factures/{d.factureId}" class="font-bold">Voir la facture</a>{:else}Facture supprimée depuis.{/if}
				<span class="block text-gray-600">par {d.traitePar}{d.traiteLe ? `, le ${dateTimeFormat.format(d.traiteLe)}` : ''}</span>
			</p>
		{:else if d.statut === 'ignore'}
			<h2 class={h2}>Écartée</h2>
			<div class="border border-black p-4 text-sm">
				<p class="mb-4 text-gray-600">par {d.traitePar}{d.traiteLe ? `, le ${dateTimeFormat.format(d.traiteLe)}` : ''}</p>
				<form method="POST" action="?/retablir" use:enhance={enhanceSubmit}>
					<button type="submit" disabled={submitting} class="btn-primary px-4 py-2 disabled:opacity-50">Remettre à valider</button>
				</form>
			</div>
		{:else}
			<h2 class={h2}>Validation</h2>
			<form method="POST" action="?/importer" class="mb-4 border border-black p-4 text-sm" use:enhance={enhanceSubmit}>
				{#if f}
					<label class={labelClass} for="tiersId">Fournisseur</label>
					<select id="tiersId" name="tiersId" class="{inputClass} mb-4">
						<option value="">
							{data.fournisseurConnu ? `${data.fournisseurConnu.nom} (d'après l'UBL)` : `Créer « ${f.fournisseur.nom} »`}
						</option>
						{#each data.tiers as t (t.id)}
							{#if t.id !== data.fournisseurConnu?.id}<option value={t.id}>{t.nom}</option>{/if}
						{/each}
					</select>
				{:else if !data.erreurLecture}
					<label class={labelClass} for="tiersId">Fournisseur</label>
					<select id="tiersId" name="tiersId" required class="{inputClass} mb-3">
						<option value="">Choisir…</option>
						{#each data.tiers as t (t.id)}<option value={t.id}>{t.nom}</option>{/each}
					</select>
					<label class={labelClass} for="numero">Numéro de la facture</label>
					<input id="numero" name="numero" type="text" required class="{inputClass} mb-3" />
					<div class="mb-3 grid grid-cols-2 gap-3">
						<div>
							<label class={labelClass} for="dateEmission">Date</label>
							<input id="dateEmission" name="dateEmission" type="date" required class={inputClass} />
						</div>
						<div>
							<label class={labelClass} for="dateEcheance">Échéance</label>
							<input id="dateEcheance" name="dateEcheance" type="date" class={inputClass} />
						</div>
					</div>
					<label class={labelClass} for="ligne_libelle">Libellé</label>
					<input id="ligne_libelle" name="ligne_libelle" type="text" required class="{inputClass} mb-3" />
					<input type="hidden" name="ligne_quantite" value="1" />
					<label class={labelClass} for="ligne_prix">Montant à payer (TVAC)</label>
					<input id="ligne_prix" name="ligne_prix" type="text" inputmode="decimal" required placeholder="0,00" class="{inputClass} mb-4" />
				{/if}

				{#if data.doublonFactureId}
					<label class="mb-4 flex items-start gap-3 border border-black bg-gray-100 p-3">
						<input type="checkbox" name="doublonAccepte" required class="mt-1" />
						<span>
							Cette facture est <a href="/compta/factures/{data.doublonFactureId}">déjà enregistrée</a>. L'importer quand même,
							en double.
						</span>
					</label>
				{/if}
				{#if !v.verifie}
					<label class="mb-4 flex items-start gap-3 border border-red-700 p-3 text-red-700">
						<input type="checkbox" name="origineConfirmee" required class="mt-1" />
						<span>
							L'origine de ce mail n'est pas prouvée. J'ai vérifié moi-même, auprès du fournisseur ou sur Doccle, que cette
							facture est authentique.
						</span>
					</label>
				{/if}

				<button type="submit" disabled={submitting || (!f && !!data.erreurLecture)} class="btn-primary w-full px-4 py-2 disabled:opacity-50">
					{submitting ? 'Import…' : 'Importer dans les factures reçues'}
				</button>
			</form>
			<form method="POST" action="?/ecarter" use:enhance={enhanceSubmit}>
				<button type="submit" disabled={submitting} class="w-full border border-black px-4 py-2 font-bold uppercase hover:bg-gray-100 disabled:opacity-50">
					Écarter
				</button>
			</form>
		{/if}
	</section>
</div>
