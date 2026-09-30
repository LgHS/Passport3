<script lang="ts">
	import { enhance } from '$app/forms';

	// One form for creating an invoice and editing a draft. Lines are repeated fields
	// (ligne_libelle / ligne_quantite / ligne_prix) the server reads with getAll(); a blank trailing
	// row is always offered and ignored server-side. `values` uses the field names so a failed
	// submission's echo slots straight back in.
	interface LigneValue {
		libelle: string;
		quantite: string;
		prix: string;
	}
	let {
		action,
		tiers,
		values = {},
		lignes: initialLignes = [],
		sensLocked = null,
		submitLabel = 'Enregistrer'
	}: {
		action: string;
		tiers: { id: number; nom: string; nature: string }[];
		values?: Record<string, string | null | undefined>;
		lignes?: LigneValue[];
		// Set when editing: the direction can't change once the invoice exists.
		sensLocked?: 'emise' | 'recue' | null;
		submitLabel?: string;
	} = $props();

	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let sens = $state<'emise' | 'recue'>(sensLocked ?? (values.sens === 'recue' ? 'recue' : 'emise'));
	// svelte-ignore state_referenced_locally
	let lignes = $state<LigneValue[]>(initialLignes.length > 0 ? [...initialLignes] : [{ libelle: '', quantite: '1', prix: '' }]);
	// svelte-ignore state_referenced_locally
	let cotisationType = $state(values.cotisationType ?? '');

	function str(key: string): string {
		return values[key] ?? '';
	}
	function addLigne() {
		lignes.push({ libelle: '', quantite: '1', prix: '' });
	}
	function removeLigne(i: number) {
		lignes.splice(i, 1);
		if (lignes.length === 0) addLigne();
	}
	function toNumber(v: string): number {
		const n = Number.parseFloat(v.replace(',', '.'));
		return Number.isFinite(n) ? n : 0;
	}
	const total = $derived(lignes.reduce((acc, l) => acc + Math.round(toNumber(l.quantite) * toNumber(l.prix) * 100), 0) / 100);
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-xs font-bold uppercase';
</script>

<form
	method="POST"
	{action}
	enctype="multipart/form-data"
	class="border border-black p-4"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	{#if sensLocked}
		<input type="hidden" name="sens" value={sensLocked} />
	{:else}
		<fieldset class="mb-4 flex flex-wrap gap-4 text-sm">
			<legend class={labelClass}>Sens</legend>
			<label class="flex items-center gap-2"><input type="radio" name="sens" value="emise" bind:group={sens} /> Facture émise</label>
			<label class="flex items-center gap-2"><input type="radio" name="sens" value="recue" bind:group={sens} /> Facture reçue (fournisseur)</label>
		</fieldset>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2">
		<div class="sm:col-span-2">
			<label class={labelClass} for="tiersId">{sens === 'recue' ? 'Fournisseur' : 'Client'}</label>
			<select id="tiersId" name="tiersId" required class={inputClass}>
				<option value="">—</option>
				{#each tiers as t (t.id)}
					<option value={t.id} selected={String(t.id) === str('tiersId')}>{t.nom}</option>
				{/each}
			</select>
		</div>
		{#if sens === 'recue'}
			<div>
				<label class={labelClass} for="numero">Numéro de la facture fournisseur</label>
				<input id="numero" name="numero" type="text" required value={str('numero')} class={inputClass} />
			</div>
		{/if}
		<div>
			<label class={labelClass} for="dateEmission">{sens === 'recue' ? 'Date de la facture' : 'Date d’émission (vide = à la validation)'}</label>
			<input id="dateEmission" name="dateEmission" type="date" required={sens === 'recue'} value={str('dateEmission')} class={inputClass} />
		</div>
		<div>
			<label class={labelClass} for="dateEcheance">Échéance (vide = délai par défaut)</label>
			<input id="dateEcheance" name="dateEcheance" type="date" value={str('dateEcheance')} class={inputClass} />
		</div>
		<div class="sm:col-span-2">
			<label class={labelClass} for="objet">Objet</label>
			<input id="objet" name="objet" type="text" value={str('objet')} class={inputClass} />
		</div>
	</div>

	<h3 class="mt-4 mb-2 text-xs font-bold uppercase">Lignes</h3>
	<div class="space-y-2">
		{#each lignes as ligne, i (i)}
			<div class="grid grid-cols-[1fr_70px_100px_auto] gap-2">
				<input type="text" name="ligne_libelle" placeholder="Description" bind:value={ligne.libelle} class={inputClass} />
				<input type="text" name="ligne_quantite" inputmode="decimal" placeholder="Qté" bind:value={ligne.quantite} class="{inputClass} text-right" />
				<input type="text" name="ligne_prix" inputmode="decimal" placeholder="P.U. €" bind:value={ligne.prix} class="{inputClass} text-right" />
				<button type="button" onclick={() => removeLigne(i)} aria-label="Supprimer la ligne" class="border border-black px-2 text-sm hover:bg-black hover:text-white">×</button>
			</div>
		{/each}
	</div>
	<div class="mt-2 flex items-center justify-between">
		<button type="button" onclick={addLigne} class="border border-black px-3 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">+ Ligne</button>
		<p class="text-sm font-bold">Total : {amountFormat.format(total)}</p>
	</div>

	{#if sens === 'emise'}
		<h3 class="mt-4 mb-2 text-xs font-bold uppercase">Cotisation ouverte par cette facture</h3>
		<div class="grid gap-3 sm:grid-cols-4">
			<div>
				<label class={labelClass} for="cotisationType">Type</label>
				<select id="cotisationType" name="cotisationType" bind:value={cotisationType} class={inputClass}>
					<option value="">Aucune</option>
					<option value="facturee">Cotisation (société adhérente)</option>
					<option value="sponsoring">Sponsoring</option>
				</select>
			</div>
			{#if cotisationType}
				<div>
					<label class={labelClass} for="cotisationDebut">Du</label>
					<input id="cotisationDebut" name="cotisationDebut" type="date" required value={str('cotisationDebut')} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="cotisationFin">Au (dernier jour)</label>
					<input id="cotisationFin" name="cotisationFin" type="date" required value={str('cotisationFin')} class={inputClass} />
				</div>
				<div>
					<label class={labelClass} for="cotisationSieges">Sièges</label>
					<input id="cotisationSieges" name="cotisationSieges" type="number" min="0" value={str('cotisationSieges') || '1'} class={inputClass} />
				</div>
			{/if}
		</div>
	{:else}
		<div class="mt-4">
			<label class={labelClass} for="pdf">PDF de la facture (optionnel)</label>
			<input id="pdf" name="pdf" type="file" accept="application/pdf" class="text-sm" />
		</div>
	{/if}

	<div class="mt-4">
		<label class={labelClass} for="note">Note (imprimée en bas de la facture)</label>
		<textarea id="note" name="note" rows="2" class={inputClass}>{str('note')}</textarea>
	</div>

	<button type="submit" disabled={submitting} class="btn-primary mt-4 px-4 py-2 disabled:opacity-50">
		{submitting ? 'Enregistrement…' : submitLabel}
	</button>
</form>
