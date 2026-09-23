<script lang="ts">
	import type { PageData } from './$types';
	import { actionLabel, sourceLabel, detailRows } from '$lib/auditDisplay';

	let { data }: { data: PageData } = $props();

	type AuditEvent = PageData['events'][number];

	const PAGE_SIZE = 20;

	let selectedEvent = $state<AuditEvent | null>(null);
	let query = $state('');
	let page = $state(1);

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' });
	function formatDate(iso: string): string {
		return dateFormat.format(new Date(iso));
	}

	// Prénom + username (resolved server-side, once per unique target) with the pk in parens —
	// falls back to just the pk if the profile couldn't be resolved (deleted account, Authentik
	// hiccup) or there's no member target at all (an invitation's target is an email instead).
	function targetLabel(event: AuditEvent): string {
		if (event.targetPk) {
			const resolved = data.targetLabels[event.targetPk];
			return resolved ? `${resolved.firstName} (${resolved.username}) (#${event.targetPk})` : `#${event.targetPk}`;
		}
		return event.targetEmail ?? '—';
	}

	let filteredEvents = $derived(
		data.events.filter((event) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			const haystack = [
				event.actorLabel,
				sourceLabel(event.source),
				actionLabel(event.action),
				targetLabel(event)
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(q);
		})
	);

	let pageCount = $derived(Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE)));
	let pagedEvents = $derived(filteredEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	function onSearch(value: string) {
		query = value;
		page = 1;
	}

</script>

<svelte:head>
	<title>Historique d'audit — Administration — Passport</title>
</svelte:head>

<section>
	<a href="/admin" class="mb-4 inline-block text-sm">← Retour à la liste</a>

	<h1 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Historique d'audit
	</h1>

	<p class="mb-4 text-xs text-gray-500">
		Les 200 actions les plus récentes, admin comme membre (profil, trombinoscope, contacts
		d'urgence, invitations, GitHub, sessions, cotisation, badge). Cliquez une action pour voir le
		détail. Les contacts d'urgence et le badge RFID eux-mêmes ne sont jamais enregistrés ici.
		Certaines opérations menées directement dans nos autres outils internes (comme la
		comptabilité) n'y transitent pas encore.
	</p>

	<input
		type="search"
		value={query}
		oninput={(e) => onSearch(e.currentTarget.value)}
		placeholder="Rechercher par admin, action ou membre…"
		class="mb-4 w-full border border-black px-3 py-2 text-sm"
	/>

	{#if pagedEvents.length > 0}
		<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
		<div class="space-y-2 sm:hidden">
			{#each pagedEvents as event (event.id)}
				<div class="border border-black p-3 text-sm">
					<button
						type="button"
						onclick={() => (selectedEvent = event)}
						class="font-bold underline underline-offset-2"
					>
						{actionLabel(event.action)}
					</button>
					<p class="mt-1 text-gray-600">
						{formatDate(event.createdAt)} —
						<span
							class="inline-block w-16 border border-black px-1 py-0.5 text-center text-[10px] font-bold uppercase"
						>
							{sourceLabel(event.source)}
						</span>
						{event.actorLabel}
					</p>
					<p class="mt-1 text-gray-600">
						{#if event.targetPk}
							<a href="/admin/users/{event.targetPk}">{targetLabel(event)}</a>
						{:else}
							{targetLabel(event)}
						{/if}
					</p>
				</div>
			{/each}
		</div>

		<div class="hidden overflow-x-auto sm:block">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left whitespace-nowrap">Date</th>
						<th class="border border-black px-3 py-2 text-left whitespace-nowrap">Source</th>
						<th class="border border-black px-3 py-2 text-left whitespace-nowrap">Action</th>
						<th class="border border-black px-3 py-2 text-left">Cible</th>
					</tr>
				</thead>
				<tbody>
					{#each pagedEvents as event (event.id)}
						<tr>
							<td class="border border-black px-3 py-2 whitespace-nowrap">
								{formatDate(event.createdAt)}
							</td>
							<td class="border border-black px-3 py-2 whitespace-nowrap">
								<span
									class="inline-block w-16 border border-black px-1.5 py-0.5 text-center text-[10px] font-bold uppercase"
								>
									{sourceLabel(event.source)}
								</span>
								<span class="ml-1">{event.actorLabel}</span>
							</td>
							<td class="border border-black px-3 py-2 whitespace-nowrap">
								<button
									type="button"
									onclick={() => (selectedEvent = event)}
									class="font-bold underline underline-offset-2"
								>
									{actionLabel(event.action)}
								</button>
							</td>
							<td class="border border-black px-3 py-2">
								{#if event.targetPk}
									<a href="/admin/users/{event.targetPk}">{targetLabel(event)}</a>
								{:else}
									{targetLabel(event)}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if pageCount > 1}
			<div class="mt-4 flex items-center justify-between gap-4 text-sm">
				<button
					type="button"
					disabled={page <= 1}
					onclick={() => (page -= 1)}
					class="btn-primary px-4 py-2 disabled:opacity-50"
				>
					Précédent
				</button>
				<span>Page {page} / {pageCount}</span>
				<button
					type="button"
					disabled={page >= pageCount}
					onclick={() => (page += 1)}
					class="btn-primary px-4 py-2 disabled:opacity-50"
				>
					Suivant
				</button>
			</div>
		{/if}
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			Aucun résultat.
		</p>
	{/if}
</section>

{#if selectedEvent}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) selectedEvent = null;
		}}
		onkeydown={(e) => e.key === 'Escape' && (selectedEvent = null)}
		role="button"
		tabindex="-1"
	>
		<div
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			class="max-h-[80vh] w-full max-w-lg overflow-y-auto border-4 border-black bg-white p-4"
		>
			<div class="mb-3 flex items-start justify-between gap-4">
				<h2 class="text-base font-bold uppercase">{actionLabel(selectedEvent.action)}</h2>
				<button
					type="button"
					onclick={() => (selectedEvent = null)}
					aria-label="Fermer"
					class="shrink-0 px-2 text-lg font-bold leading-none"
				>
					×
				</button>
			</div>
			<p class="mb-3 text-sm text-gray-600">
				{formatDate(selectedEvent.createdAt)} —
				<span
					class="inline-block w-16 border border-black px-1 py-0.5 text-center text-[10px] font-bold uppercase"
				>
					{sourceLabel(selectedEvent.source)}
				</span>
				{selectedEvent.actorLabel} →
				{#if selectedEvent.targetPk}
					<a href="/admin/users/{selectedEvent.targetPk}">{targetLabel(selectedEvent)}</a>
				{:else}
					{targetLabel(selectedEvent)}
				{/if}
			</p>
			<div class="space-y-1 border-t border-black pt-3 font-mono text-xs">
				{#each detailRows(selectedEvent.details) as row (row.path)}
					{#if row.kind === 'same'}
						<p class="break-all text-gray-600"><span class="text-gray-400">{row.path}:</span> {row.value}</p>
					{:else if row.kind === 'changed'}
						<p class="break-all bg-red-50 px-1 text-red-700">− {row.path}: {row.before}</p>
						<p class="break-all bg-green-50 px-1 text-green-700">+ {row.path}: {row.after}</p>
					{:else if row.kind === 'added'}
						<p class="break-all bg-green-50 px-1 text-green-700">+ {row.path}: {row.after}</p>
					{:else}
						<p class="break-all bg-red-50 px-1 text-red-700">− {row.path}: {row.before}</p>
					{/if}
				{:else}
					<p class="text-gray-600">Aucun détail enregistré.</p>
				{/each}
			</div>
		</div>
	</div>
{/if}
