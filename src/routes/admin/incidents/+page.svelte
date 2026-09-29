<script lang="ts">
	import { kindMeta } from '$lib/incidentDisplay';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
	Incidents ({data.incidents.length})
</h1>

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
