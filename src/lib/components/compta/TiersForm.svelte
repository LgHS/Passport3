<script lang="ts">
	import { enhance } from '$app/forms';

	// One form for creating and editing a tiers — the fields are the same, only the action and the
	// initial values differ. `values` uses the form field names (see tiersInputFromForm on the
	// server), so a failed submission's echoed values slot straight back in.
	let {
		action,
		values = {},
		submitLabel = 'Enregistrer'
	}: {
		action: string;
		values?: Record<string, string | boolean | null | undefined>;
		submitLabel?: string;
	} = $props();

	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let nature = $state(values.nature === 'personne_morale' ? 'personne_morale' : 'personne_physique');

	function str(key: string): string {
		const v = values[key];
		return typeof v === 'string' ? v : '';
	}
	function bool(key: string): boolean {
		const v = values[key];
		return v === true || v === 'on' || v === 'true';
	}

	const inputClass = 'w-full border border-black px-3 py-2 text-sm';
	const labelClass = 'mb-1 block text-sm font-bold uppercase';
</script>

<form
	method="POST"
	{action}
	class="border border-black p-4"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<fieldset class="mb-4 flex flex-wrap gap-4 text-sm">
		<legend class={labelClass}>Nature</legend>
		<label class="flex items-center gap-2">
			<input type="radio" name="nature" value="personne_physique" bind:group={nature} />
			Personne physique
		</label>
		<label class="flex items-center gap-2">
			<input type="radio" name="nature" value="personne_morale" bind:group={nature} />
			Personne morale (société, ASBL…)
		</label>
	</fieldset>

	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label class={labelClass} for="nom">{nature === 'personne_morale' ? 'Dénomination' : 'Nom'}</label>
			<input id="nom" name="nom" type="text" required value={str('nom')} class={inputClass} />
		</div>
		{#if nature === 'personne_physique'}
			<div>
				<label class={labelClass} for="prenom">Prénom</label>
				<input id="prenom" name="prenom" type="text" value={str('prenom')} class={inputClass} />
			</div>
		{:else}
			<div>
				<label class={labelClass} for="numeroEntreprise">N° d'entreprise (BCE)</label>
				<input
					id="numeroEntreprise"
					name="numeroEntreprise"
					type="text"
					placeholder="0123.456.789"
					value={str('numeroEntreprise')}
					class={inputClass}
				/>
			</div>
		{/if}
		<div>
			<label class={labelClass} for="email">Email</label>
			<input id="email" name="email" type="email" value={str('email')} class={inputClass} />
		</div>
		<div>
			<label class={labelClass} for="telephone">Téléphone</label>
			<input id="telephone" name="telephone" type="text" value={str('telephone')} class={inputClass} />
		</div>
		<div class="sm:col-span-2">
			<label class={labelClass} for="adresse">Adresse</label>
			<input id="adresse" name="adresse" type="text" value={str('adresse')} class={inputClass} />
		</div>
		<div class="grid grid-cols-3 gap-2 sm:col-span-2">
			<div>
				<label class={labelClass} for="codePostal">Code postal</label>
				<input id="codePostal" name="codePostal" type="text" value={str('codePostal')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="ville">Ville</label>
				<input id="ville" name="ville" type="text" value={str('ville')} class={inputClass} />
			</div>
			<div>
				<label class={labelClass} for="pays">Pays</label>
				<input id="pays" name="pays" type="text" maxlength="2" value={str('pays') || 'BE'} class="{inputClass} uppercase" />
			</div>
		</div>
		<div class="sm:col-span-2">
			<label class={labelClass} for="iban">IBAN</label>
			<input
				id="iban"
				name="iban"
				type="text"
				placeholder="BE71 0961 2345 6769"
				value={str('iban')}
				class="{inputClass} font-mono uppercase placeholder:normal-case"
			/>
		</div>
		<div class="sm:col-span-2">
			<label class={labelClass} for="notes">Notes internes</label>
			<textarea id="notes" name="notes" rows="2" class={inputClass}>{str('notes')}</textarea>
		</div>
	</div>

	<div class="mt-4 flex flex-wrap gap-4 text-sm">
		<label class="flex items-center gap-2">
			<input type="checkbox" name="estClient" checked={bool('estClient')} /> Client
		</label>
		<label class="flex items-center gap-2">
			<input type="checkbox" name="estFournisseur" checked={bool('estFournisseur')} /> Fournisseur
		</label>
		<label class="flex items-center gap-2" title="Membre d'honneur : membre sans cotisation">
			<input type="checkbox" name="exempteCotisation" checked={bool('exempteCotisation')} /> Exempté de cotisation
		</label>
		<label class="flex items-center gap-2">
			<input type="checkbox" name="inactif" checked={bool('inactif')} /> Inactif
		</label>
	</div>

	<button type="submit" disabled={submitting} class="btn-primary mt-4 px-4 py-2 disabled:opacity-50">
		{submitting ? 'Enregistrement…' : submitLabel}
	</button>
</form>
