<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import FactureForm from '$lib/components/compta/FactureForm.svelte';
	import { FACTURE_STATUT_CLASS, factureStatutLabel } from '$lib/compta';
	import type { PageData } from './$types';

	// Typed by hand rather than through ActionData: the server funnels every action through a
	// generic helper (run<T>), which SvelteKit's inference flattens to {}.
	interface FormResult {
		success?: string;
		error?: string;
		values?: Record<string, string>;
		lignes?: { libelle: string; quantite: string; prix: string }[];
	}

	let { data, form }: { data: PageData; form: FormResult | null } = $props();

	const f = $derived(data.facture);
	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	const quantityFormat = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 3 });
	const fmt = (d: Date | null) => (d ? dateFormat.format(d) : '—');
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	// The reader's own calendar day for a form default — toISOString() would say yesterday between
	// midnight and 2am in Brussels.
	const today = new Date().toLocaleDateString('en-CA');

	$effect(() => {
		if (form?.success) showToast('success', form.success);
		else if (form?.error) showToast('error', form.error);
	});

	// Draft edit form: a failed submission's echo wins over the stored draft.
	const values = $derived(
		form?.values ?? {
			sens: f.sens,
			tiersId: String(f.tiersId),
			numero: f.numero,
			dateEmission: f.dateEmission ? iso(f.dateEmission) : '',
			dateEcheance: f.dateEcheance ? iso(f.dateEcheance) : '',
			objet: f.objet,
			note: f.note,
			cotisationType: f.cotisation?.type ?? '',
			cotisationDebut: f.cotisation ? iso(f.cotisation.debut) : '',
			cotisationFin: f.cotisation ? iso(new Date(f.cotisation.fin.getTime() - 86_400_000)) : '',
			cotisationSieges: f.cotisation ? String(f.cotisation.sieges) : '1'
		}
	);
	const lignesValues = $derived(
		form?.lignes ?? f.lignes.map((l) => ({ libelle: l.libelle, quantite: String(l.quantite), prix: String(l.prixUnitaire) }))
	);

	const title = $derived(
		f.type === 'note_de_credit' ? `Note de crédit ${f.numero ?? `(brouillon #${f.id})`}` : `Facture ${f.numero ?? `(brouillon #${f.id})`}`
	);
	const btn = 'border border-black px-3 py-2 text-sm font-bold uppercase hover:bg-black hover:text-white disabled:opacity-40';
</script>

<svelte:head>
	<title>{title} — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">
			{title}
			<span class="ml-2 text-xs font-normal opacity-70">{f.sens === 'emise' ? 'émise' : 'reçue'}</span>
		</h1>
		<a href="/compta/factures?sens={f.sens}" class="text-sm">← Factures</a>
	</div>

	<div class="mb-6 grid gap-6 md:grid-cols-2">
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-black p-4 text-sm">
			<dt class="font-bold uppercase">Statut</dt>
			<dd class="font-bold {FACTURE_STATUT_CLASS[f.statut]}">{factureStatutLabel(f.statut, f.type)}{f.payeeLe ? ` le ${fmt(f.payeeLe)}` : ''}</dd>
			<dt class="font-bold uppercase">{f.sens === 'emise' ? 'Client' : 'Fournisseur'}</dt>
			<dd><a href="/compta/tiers/{f.tiersId}">{f.tiers.nom}</a></dd>
			<dt class="font-bold uppercase">Date</dt><dd>{fmt(f.dateEmission)}</dd>
			<dt class="font-bold uppercase">Échéance</dt><dd>{fmt(f.dateEcheance)}</dd>
			<dt class="font-bold uppercase">Total</dt><dd class="font-bold">{amountFormat.format(f.total)}</dd>
			{#if f.communicationStructuree}
				<dt class="font-bold uppercase">Communication</dt><dd class="font-mono">{f.communicationStructuree}</dd>
			{/if}
			{#if f.factureOrigineId}
				<dt class="font-bold uppercase">Annule</dt>
				<dd><a href="/compta/factures/{f.factureOrigineId}">{f.factureOrigineNumero ?? `#${f.factureOrigineId}`}</a></dd>
			{/if}
			{#if f.referenceExterne}
				<dt class="font-bold uppercase">Réf. Dolibarr</dt><dd class="text-gray-500">{f.referenceExterne}</dd>
			{/if}
			{#if f.cotisation}
				<dt class="font-bold uppercase">Cotisation</dt>
				<dd>
					{f.cotisation.type === 'sponsoring' ? 'Sponsoring' : 'Cotisation'} du {fmt(f.cotisation.debut)} au
					{fmt(new Date(f.cotisation.fin.getTime() - 86_400_000))}, {f.cotisation.sieges} siège(s)
					{#if f.cotisationId}<span class="text-gray-500">(créée)</span>{/if}
				</dd>
			{/if}
		</dl>

		<div class="flex flex-col gap-2">
			{#if f.hasPdf}
				<a href="/compta/factures/{f.id}/pdf" class="no-underline-fx btn-primary inline-block px-4 py-2 text-center">Télécharger le PDF</a>
			{/if}
			{#if f.hasUbl}
				<a href="/compta/factures/{f.id}/ubl" class="no-underline-fx {btn} text-center" title="Peppol BIS 3.0 — à déposer sur Doccle">
					Télécharger l'UBL{f.sens === 'recue' ? ' du fournisseur' : ' (Peppol)'}
				</a>
			{/if}
			{#if f.sens === 'emise' && (f.statut === 'validee' || f.statut === 'payee')}
				<form method="POST" action="?/envoyer" class="border border-black p-3 text-sm" use:enhance>
					<p class="mb-2">
						{#if f.envoyeeLe}
							Envoyée le {new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(f.envoyeeLe)}
							à <span class="font-mono text-xs">{f.envoyeeA}</span>.
						{:else}
							<span class="text-orange-600">Pas encore envoyée.</span>
						{/if}
					</p>
					{#if data.destinataires.length > 0}
						<p class="mb-2 text-xs text-gray-600">Destinataires : <span class="font-mono">{data.destinataires.join(', ')}</span></p>
					{:else}
						<p class="mb-2 text-xs text-red-700">Aucune adresse email sur ce tiers ni sur une personne « reçoit les factures ».</p>
					{/if}
					<button type="submit" disabled={!data.mailConfigured || data.destinataires.length === 0} class="{btn} w-full" title={data.mailConfigured ? '' : 'Aucune boîte Gmail connectée'}>
						{f.envoyeeLe ? 'Renvoyer par email' : 'Envoyer par email'}
					</button>
				</form>
			{/if}
			{#if !f.hasPdf && f.sens === 'recue'}
				<form method="POST" action="?/attachPdf" enctype="multipart/form-data" class="border border-black p-3 text-sm" use:enhance>
					<label class="mb-1 block text-xs font-bold uppercase" for="pdf">Joindre le PDF du fournisseur</label>
					<input id="pdf" name="pdf" type="file" accept="application/pdf" required class="text-sm" />
					<button type="submit" class="{btn} mt-2">Enregistrer</button>
				</form>
			{/if}

			{#if f.statut === 'brouillon'}
				<form method="POST" action="?/valider" use:enhance>
					<button type="submit" class="btn-primary w-full px-4 py-2">Valider (numéroter et générer le PDF)</button>
				</form>
				<form method="POST" action="?/annuler" use:enhance>
					<button type="submit" class="{btn} w-full">Annuler le brouillon</button>
				</form>
			{:else if f.statut === 'validee'}
				<form method="POST" action="?/marquerPayee" class="flex gap-2" use:enhance>
					<input type="date" name="payeeLe" value={today} class="border border-black px-3 py-2 text-sm" />
					<button type="submit" class="{btn} flex-1">{f.type === 'note_de_credit' ? 'Marquer remboursée' : 'Marquer payée'}</button>
				</form>
			{/if}
			{#if f.sens === 'emise' && f.type === 'facture' && (f.statut === 'validee' || f.statut === 'payee')}
				<form method="POST" action="?/noteDeCredit" use:enhance>
					<button type="submit" class="{btn} w-full">Créer une note de crédit</button>
				</form>
			{/if}
		</div>
	</div>

	{#if f.statut === 'brouillon'}
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Modifier le brouillon</h2>
		<FactureForm action="?/update" tiers={data.tiers} {values} lignes={lignesValues} sensLocked={f.sens} />
	{:else}
		<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Lignes</h2>
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Description</th>
						<th class="border border-black px-3 py-2 text-right">Qté</th>
						<th class="border border-black px-3 py-2 text-right">P.U.</th>
						<th class="border border-black px-3 py-2 text-right">Total</th>
					</tr>
				</thead>
				<tbody>
					{#each f.lignes as l (l.id)}
						<tr>
							<td class="border border-black px-3 py-2">{l.libelle}</td>
							<td class="border border-black px-3 py-2 text-right">{quantityFormat.format(l.quantite)}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(l.prixUnitaire)}</td>
							<td class="border border-black px-3 py-2 text-right">{amountFormat.format(l.total)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if f.objet}<p class="mt-3 text-sm"><span class="font-bold uppercase">Objet :</span> {f.objet}</p>{/if}
		{#if f.note}<p class="mt-1 text-sm text-gray-600">{f.note}</p>{/if}
	{/if}
</section>
