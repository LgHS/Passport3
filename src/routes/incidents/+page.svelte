<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import {
		INCIDENT_KINDS,
		kindMeta,
		PEOPLE_MAX_LENGTH,
		WITNESSES_MAX_LENGTH,
		EQUIPMENT_MAX_LENGTH,
		DESCRIPTION_MAX_LENGTH,
		DETAILS_MAX_LENGTH,
		type IncidentKind
	} from '$lib/incidentDisplay';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `datetime-local` wants the member's own wall clock in YYYY-MM-DDTHH:mm, not an ISO/UTC string
	// — hence the manual build from the local parts rather than toISOString().
	function localNow(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
	}

	let kind = $state<IncidentKind>('incident');
	let occurredAt = $state(localNow());
	let descriptionValue = $state('');
	let firstAidUsed = $state(false);
	let fireDeviceUsed = $state(false);

	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', {
		dateStyle: 'short',
		timeStyle: 'short'
	});
	function formatDateTime(iso: string): string {
		return dateTimeFormat.format(new Date(iso));
	}

	$effect(() => {
		if (form?.created) {
			showToast('success', 'Déclaration enregistrée.');
			// Reset to a fresh form: a second declaration is a different event, and its time is now,
			// not whenever this page was first opened.
			kind = 'incident';
			occurredAt = localNow();
			descriptionValue = '';
			firstAidUsed = false;
			fireDeviceUsed = false;
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});
</script>

<svelte:head>
	<title>Déclarer un incident — Passport</title>
</svelte:head>

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Déclarer un incident</h1>
<p class="mb-6 text-sm text-gray-600">
	Ce formulaire sert à consigner ce qui s'est passé au hackerspace. Les déclarations sont
	transmises aux admins et ne sont pas visibles par les autres membres.
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
			<p class="mt-1 text-xs text-gray-500">Quand l'événement a eu lieu, pas quand vous le déclarez.</p>
		</div>
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="equipment">
				Matériel ou machine impliquée <span class="text-xs font-normal normal-case">(optionnel)</span>
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
		<input
			id="people"
			name="people"
			type="text"
			maxlength={PEOPLE_MAX_LENGTH}
			required
			placeholder="Prénoms ou pseudos, séparés par des virgules"
			class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
		/>
		<label class="mt-2 flex cursor-pointer items-center gap-2 text-sm">
			<input type="checkbox" name="visitorInvolved" />
			Un non-membre ou visiteur a été impliqué
		</label>
	</div>

	<div class="mb-4">
		<label class="mb-1 block text-sm font-bold uppercase" for="witnesses">
			Témoins <span class="text-xs font-normal normal-case">(optionnel)</span>
		</label>
		<input
			id="witnesses"
			name="witnesses"
			type="text"
			maxlength={WITNESSES_MAX_LENGTH}
			placeholder="Prénoms ou pseudos, séparés par des virgules"
			class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
		/>
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
			placeholder="Ce qui s'est passé, dans quelles circonstances, ce qui a été fait ensuite…"
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

	<button type="submit" class="btn-primary px-4 py-2 text-sm">Déclarer</button>
</form>

{#if data.incidents}
	<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Déclarations ({data.incidents.length})
	</h2>

	{#if data.incidents.length > 0}
		<div class="space-y-4">
			{#each data.incidents as incident (incident.id)}
				{@const meta = kindMeta(incident.kind)}
				<article class="border border-black p-4 {incident.kind === 'accident' ? 'border-l-8' : ''}">
					<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
						<p class="font-bold">{meta.icon} {meta.label}</p>
						<p class="text-sm text-gray-600">{formatDateTime(incident.occurredAt)}</p>
					</div>

					<p class="mb-3 text-sm whitespace-pre-wrap">{incident.description}</p>

					<dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
						<div>
							<dt class="inline font-bold">Personnes impliquées :</dt>
							<dd class="inline">
								{incident.people}{incident.visitorInvolved ? ' (dont un non-membre ou visiteur)' : ''}
							</dd>
						</div>
						{#if incident.witnesses}
							<div>
								<dt class="inline font-bold">Témoins :</dt>
								<dd class="inline">{incident.witnesses}</dd>
							</div>
						{/if}
						{#if incident.equipment}
							<div>
								<dt class="inline font-bold">Matériel :</dt>
								<dd class="inline">{incident.equipment}</dd>
							</div>
						{/if}
						{#if incident.emergencyServicesCalled}
							<div>
								<dt class="inline font-bold">Secours :</dt>
								<dd class="inline">contactés</dd>
							</div>
						{/if}
						{#if incident.firstAidUsed}
							<div>
								<dt class="inline font-bold">Trousse de secours :</dt>
								<dd class="inline">{incident.firstAidDetails}</dd>
							</div>
						{/if}
						{#if incident.fireDeviceUsed}
							<div>
								<dt class="inline font-bold">Dispositif anti-incendie :</dt>
								<dd class="inline">{incident.fireDeviceDetails}</dd>
							</div>
						{/if}
					</dl>

					<p class="mt-3 text-xs text-gray-500">
						Déclaré par {incident.authorLabel} le {formatDateTime(incident.createdAt)}
					</p>
				</article>
			{/each}
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			Aucune déclaration pour le moment.
		</p>
	{/if}
{/if}
