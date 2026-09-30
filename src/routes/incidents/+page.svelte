<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import { brusselsNowInput } from '$lib/brusselsTime';
	import {
		INCIDENT_KINDS,
		EQUIPMENT_MAX_LENGTH,
		DESCRIPTION_MAX_LENGTH,
		DETAILS_MAX_LENGTH,
		type IncidentKind
	} from '$lib/incidentDisplay';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `datetime-local` wants a wall-clock time; it's the hackerspace's (Brussels), which is also how
	// the server reads it back — see brusselsTime.ts.
	const localNow = () => brusselsNowInput();

	let kind = $state<IncidentKind>('incident');
	let occurredAt = $state(localNow());
	let people = $state<string[]>([]);
	let witnesses = $state<string[]>([]);
	let descriptionValue = $state('');
	let firstAidUsed = $state(false);
	let fireDeviceUsed = $state(false);
	let certified = $state(false);

	$effect(() => {
		if (form?.created) {
			showToast('success', 'Déclaration enregistrée.');
			// Reset to a fresh form: a second declaration is a different event, and its time is now,
			// not whenever this page was first opened.
			kind = 'incident';
			occurredAt = localNow();
			people = [];
			witnesses = [];
			descriptionValue = '';
			firstAidUsed = false;
			fireDeviceUsed = false;
			certified = false;
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});
</script>

<svelte:head>
	<title>Déclarer un incident — Passport</title>
</svelte:head>

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Déclarer un incident</h1>
<p class="mb-1 text-sm text-gray-600">
	Ce formulaire sert à consigner ce qui s'est passé au hackerspace. Ces déclarations sont
	obligatoires pour des raisons de législation et d'assurance : merci de les remplir sérieusement
	et le plus précisément possible. <em>Plusieurs déclarations peuvent être faites pour un même
		incident, à la discrétion de chacun.</em>
</p>
<p class="mb-6 text-sm text-gray-600">
	Les informations de cette déclaration sont traitées de manière strictement confidentielle. Seuls
	les admins peuvent la consulter ; les autres membres n'y ont jamais accès. Elles ne sont
	communiquées à un tiers (assureur, autorités) que lorsque c'est nécessaire, par exemple pour une
	déclaration d'assurance, et uniquement dans la mesure requise. Pour toute question :
	<a href="mailto:admin@lghs.be">admin@lghs.be</a>.
</p>

<form method="POST" action="?/create" use:enhance class="mb-8 border border-black p-4">
	<fieldset class="mb-4">
		<legend class="mb-1 block text-sm font-bold uppercase">Type de déclaration</legend>
		<div class="flex flex-col gap-2">
			{#each INCIDENT_KINDS as k (k.value)}
				<label class="flex cursor-pointer items-start gap-2 text-sm">
					<input type="radio" name="kind" value={k.value} bind:group={kind} class="mt-1" />
					<span>
						<span class="font-bold">{k.icon} {k.label}</span>
						<span class="block text-gray-600">{k.definition}</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="occurredAt">Date et heure</label>
			<input
				id="occurredAt"
				name="occurredAt"
				type="datetime-local"
				required
				bind:value={occurredAt}
				class="w-full border border-black px-3 py-2 text-sm"
			/>
			<p class="mt-1 text-xs text-gray-500">Quand l'événement a eu lieu, pas quand tu le déclares.</p>
		</div>
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="equipment">
				Matériel ou machine impliqués <span class="text-xs font-normal normal-case">(optionnel)</span>
			</label>
			<input
				id="equipment"
				name="equipment"
				type="text"
				maxlength={EQUIPMENT_MAX_LENGTH}
				placeholder="Ex. découpeuse laser"
				class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
			/>
		</div>
	</div>

	<div class="mb-4">
		<label class="mb-1 block text-sm font-bold uppercase" for="people">Personnes impliquées</label>
		<TagInput id="people" name="people" bind:tags={people} placeholder="Un nom, puis Entrée" />
		<p class="mt-1 text-xs text-gray-500">Tape un nom puis Entrée pour l'ajouter.</p>
		<label class="mt-2 flex cursor-pointer items-center gap-2 text-sm">
			<input type="checkbox" name="visitorInvolved" />
			Un non-membre ou visiteur a été impliqué
		</label>
	</div>

	<div class="mb-4">
		<label class="mb-1 block text-sm font-bold uppercase" for="witnesses">
			Témoins <span class="text-xs font-normal normal-case">(optionnel)</span>
		</label>
		<TagInput id="witnesses" name="witnesses" bind:tags={witnesses} placeholder="Un nom, puis Entrée" />
	</div>

	<div class="mb-4">
		<div class="mb-1 flex items-baseline justify-between">
			<label class="block text-sm font-bold uppercase" for="description">Description</label>
			<span class="text-xs text-gray-500">{descriptionValue.length}/{DESCRIPTION_MAX_LENGTH}</span>
		</div>
		<textarea
			id="description"
			name="description"
			rows="6"
			maxlength={DESCRIPTION_MAX_LENGTH}
			required
			bind:value={descriptionValue}
			placeholder="Ce qui s'est passé, dans quelles circonstances, ce qui a été fait ensuite… En cas de blessure, précise la partie du corps touchée."
			class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
		></textarea>
	</div>

	<div class="mb-4 space-y-2">
		<label class="flex cursor-pointer items-center gap-2 text-sm">
			<input type="checkbox" name="emergencyServicesCalled" />
			Les secours ont été contactés
		</label>

		{#if kind === 'accident'}
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input type="checkbox" name="firstAidUsed" bind:checked={firstAidUsed} />
				La trousse de secours a été utilisée
			</label>
			{#if firstAidUsed}
				<div class="pl-6">
					<label class="mb-1 block text-sm font-bold uppercase" for="firstAidDetails">
						Ce qui a été utilisé
					</label>
					<input
						id="firstAidDetails"
						name="firstAidDetails"
						type="text"
						maxlength={DETAILS_MAX_LENGTH}
						required
						placeholder="Ex. compresses, désinfectant"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
			{/if}
		{/if}

		<label class="flex cursor-pointer items-center gap-2 text-sm">
			<input type="checkbox" name="fireDeviceUsed" bind:checked={fireDeviceUsed} />
			Un dispositif anti-incendie a été utilisé
		</label>
		{#if fireDeviceUsed}
			<div class="pl-6">
				<label class="mb-1 block text-sm font-bold uppercase" for="fireDeviceDetails">
					Lequel
				</label>
				<input
					id="fireDeviceDetails"
					name="fireDeviceDetails"
					type="text"
					maxlength={DETAILS_MAX_LENGTH}
					required
					placeholder="Ex. extincteur CO2, couverture anti-feu"
					class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
				/>
			</div>
		{/if}
	</div>

	<label class="mb-4 flex cursor-pointer items-start gap-2 border-t border-black pt-4 text-sm">
		<input type="checkbox" name="certified" bind:checked={certified} required class="mt-1" />
		Je certifie sur l'honneur que cette déclaration est sincère et, à ma connaissance, exacte et
		complète.
	</label>

	<button type="submit" disabled={!certified} class="btn-primary px-4 py-2 text-sm disabled:opacity-50">
		Déclarer
	</button>
</form>
