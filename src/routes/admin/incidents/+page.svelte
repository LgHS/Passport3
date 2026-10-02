<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import { kindMeta } from '$lib/incidentDisplay';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.deleted) showToast('success', 'Déclaration retirée de la liste.');
		else if (form?.error) showToast('error', form.error);
	});

	// A removed declaration is hidden, never destroyed, so it stays reachable here. Hidden by
	// default: the list is meant to show what happened at the hackerspace, not its corrections.
	let showDeleted = $state(false);
	const deletedCount = $derived(data.incidents.filter((i) => i.deletedAt !== null).length);
	const visible = $derived(data.incidents.filter((i) => showDeleted || i.deletedAt === null));

	// Pinned to Brussels so the server-rendered page (UTC) and the browser show the same time.
	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Brussels'
	});
	function formatDateTime(iso: string): string {
		return dateTimeFormat.format(new Date(iso));
	}
</script>

<svelte:head>
	<title>Incidents — Administration — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">
	Incidents ({data.incidents.length - deletedCount})
</h1>

{#if deletedCount > 0}
	<label class="mb-4 flex items-center gap-2 text-sm">
		<input type="checkbox" bind:checked={showDeleted} class="size-4 accent-black" />
		Afficher les {deletedCount} déclaration{deletedCount > 1 ? 's' : ''} retirée{deletedCount > 1
			? 's'
			: ''} de la liste
	</label>
{/if}

{#if visible.length > 0}
	<div class="space-y-4">
		{#each visible as incident (incident.id)}
			{@const meta = kindMeta(incident.kind)}
			<article
				class="border border-black p-4 {incident.kind === 'accident' ? 'border-l-8' : ''} {incident.deletedAt
					? 'opacity-60'
					: ''}"
			>
				{#if incident.deletedAt}
					<p class="mb-2 border border-black bg-gray-100 px-2 py-1 text-xs font-bold uppercase">
						Retirée de la liste par {incident.deletedByLabel} le {formatDateTime(incident.deletedAt)}
					</p>
				{/if}
				<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
					<p class="font-bold">{meta.icon} {meta.label}</p>
					<p class="text-sm text-gray-600">{formatDateTime(incident.occurredAt)}</p>
				</div>

				<p class="mb-3 text-sm whitespace-pre-wrap">{incident.description}</p>

				<dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
					<div class="sm:col-span-2">
						<dt class="font-bold">Personnes impliquées</dt>
						<dd class="mt-1 flex flex-wrap gap-1.5">
							{#each incident.people.split('\n').filter(Boolean) as person, i (i)}
								<span class="border border-black bg-gray-100 px-2 py-0.5">{person}</span>
							{/each}
						</dd>
					</div>
					{#if incident.visitorInvolved}
						<div class="sm:col-span-2">
							<dt class="inline font-bold">Tiers :</dt>
							<dd class="inline">un non-membre ou visiteur était impliqué</dd>
						</div>
					{/if}
					{#if incident.witnesses}
						<div class="sm:col-span-2">
							<dt class="font-bold">Témoins</dt>
							<dd class="mt-1 flex flex-wrap gap-1.5">
								{#each incident.witnesses.split('\n').filter(Boolean) as witness, i (i)}
									<span class="border border-black bg-gray-100 px-2 py-0.5">{witness}</span>
								{/each}
							</dd>
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

				{#if incident.photos.length > 0}
					<div class="mt-3 flex flex-wrap gap-2">
						{#each incident.photos as n (n)}
							<a
								href="/admin/incidents/{incident.id}/photos/{n}"
								target="_blank"
								rel="noopener"
								class="no-underline-fx block border border-black"
								title="Ouvrir la photo {n}"
							>
								<img
									src="/admin/incidents/{incident.id}/photos/{n}"
									alt="Photo {n} de la déclaration"
									loading="lazy"
									class="h-24 w-24 object-cover"
								/>
							</a>
						{/each}
					</div>
				{/if}

				<div class="mt-3 flex flex-wrap items-baseline justify-between gap-2">
					<p class="text-xs text-gray-500">
						Déclaré par {incident.authorLabel} le {formatDateTime(incident.createdAt)}
					</p>
					{#if !incident.deletedAt}
						<form
							method="POST"
							action="?/delete"
							use:enhance={({ cancel }) => {
								if (!confirm('Retirer cette déclaration de la liste ? Elle restera consultable ici.')) cancel();
							}}
						>
							<input type="hidden" name="incidentId" value={incident.id} />
							<button type="submit" class="text-xs font-bold text-red-700 uppercase underline">
								Retirer de la liste
							</button>
						</form>
					{/if}
				</div>
			</article>
		{/each}
	</div>
{:else}
	<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
		Aucune déclaration pour le moment.
	</p>
{/if}
