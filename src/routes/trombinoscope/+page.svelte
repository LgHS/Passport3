<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let view = $state<'grid' | 'list'>('grid');

	// tagColor is a validated 6-digit hex (server-side), no color = classic black badge.
	// Text color is picked from the background's perceived brightness so an arbitrary admin-chosen
	// color (e.g. a light yellow) doesn't end up with unreadable white-on-light text.
	function tagBadgeStyle(tagColor: string | null): string {
		if (!tagColor) return 'background-color: #000; color: #fff;';
		const r = parseInt(tagColor.slice(0, 2), 16);
		const g = parseInt(tagColor.slice(2, 4), 16);
		const b = parseInt(tagColor.slice(4, 6), 16);
		const brightness = (r * 299 + g * 587 + b * 114) / 1000;
		const textColor = brightness > 150 ? '#000' : '#fff';
		return `background-color: #${tagColor}; color: ${textColor};`;
	}

	// Based on the username, never on firstName/lastName — those are opt-in and may be withheld,
	// and initials derived from a hidden name would leak it visually through the avatar fallback.
	function initials(username: string): string {
		return username.slice(0, 2).toUpperCase();
	}

	function fullName(member: { firstName: string | null; lastName: string | null }): string {
		return [member.firstName, member.lastName].filter(Boolean).join(' ');
	}

	let searchQuery = $state('');
	let tagFilter = $state<'all' | 'with' | 'without'>('all');

	// Strips accents so "loic" matches "Loïc" — NFD splits accented chars into base + combining
	// mark, then the combining marks (U+0300–U+036f) are dropped.
	function normalize(value: string): string {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
	}

	const filteredMembers = $derived(
		data.members
			.filter((member) => {
				if (tagFilter === 'with') return !!member.tag;
				if (tagFilter === 'without') return !member.tag;
				return true;
			})
			.filter((member) => {
				const query = normalize(searchQuery.trim());
				if (!query) return true;
				const haystack = normalize([member.username, fullName(member), member.tag ?? ''].join(' '));
				return haystack.includes(query);
			})
	);

	let visibilityPanelOpen = $state(false);
	let submittingOptin = $state(false);

	// Seeded once from the load result — same rationale as the badge UUID / cotisation IBAN
	// fields: the form owns its values once the member starts toggling, not kept in sync
	// afterwards.
	// svelte-ignore state_referenced_locally
	let wantsToBeDisplayed = $state(form?.optin?.visible ?? data.myOptin.visible);

	// Username reste toujours affiché — c'est l'ancrage minimal du trombinoscope (relier un pseudo
	// à une tête), donc pas de case décochable pour ce champ-là (et pas de clé correspondante côté
	// Authentik, voir TrombinoscopeOptin).
	const fieldOptins: { key: keyof typeof fieldOptinState; label: string }[] = [
		{ key: 'showAvatar', label: 'Avatar' },
		{ key: 'showChat', label: 'Pseudo Chat' },
		{ key: 'showFirstname', label: 'Prénom' },
		{ key: 'showLastname', label: 'Nom' },
		{ key: 'showMail', label: 'Mail' },
		{ key: 'showPhone', label: 'Téléphone' }
	];
	// svelte-ignore state_referenced_locally
	let fieldOptinState = $state({
		showAvatar: form?.optin?.showAvatar ?? data.myOptin.showAvatar,
		showChat: form?.optin?.showChat ?? data.myOptin.showChat,
		showFirstname: form?.optin?.showFirstname ?? data.myOptin.showFirstname,
		showLastname: form?.optin?.showLastname ?? data.myOptin.showLastname,
		showMail: form?.optin?.showMail ?? data.myOptin.showMail,
		showPhone: form?.optin?.showPhone ?? data.myOptin.showPhone
	});
</script>

<svelte:head>
	<title>Trombinoscope — Passport</title>
</svelte:head>

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Trombinoscope</h1>
<p class="mb-1 text-sm text-gray-600">
	Ce trombinoscope est accessible uniquement aux membres du Liège Hackerspace.
</p>
<p class="mb-6 text-sm text-gray-600">
	Chaque profil et chaque information sont affichés avec le consentement explicite du membre
	concerné.
</p>

<div class="mb-6 border border-black">
	<button
		type="button"
		onclick={() => (visibilityPanelOpen = !visibilityPanelOpen)}
		class="flex w-full items-center justify-between px-4 py-3 text-sm font-bold uppercase"
		aria-expanded={visibilityPanelOpen}
	>
		<span class="flex items-center gap-2">
			Ma visibilité
			<span class="text-xs font-normal normal-case text-gray-500">
				({wantsToBeDisplayed ? 'active' : 'inactive'})
			</span>
		</span>
		<svg
			viewBox="0 0 12 8"
			class="h-2.5 w-2.5 shrink-0 fill-current transition-transform {visibilityPanelOpen
				? 'rotate-180'
				: ''}"
			aria-hidden="true"
		>
			<path d="M0 0 L12 0 L6 8 Z" />
		</svg>
	</button>

	{#if visibilityPanelOpen}
		<form
			method="POST"
			action="?/updateOptin"
			class="border-t border-black p-4"
			use:enhance={() => {
				submittingOptin = true;
				return async ({ update }) => {
					try {
						await update({ reset: false });
						visibilityPanelOpen = false;
					} finally {
						submittingOptin = false;
					}
				};
			}}
		>
			<label class="flex w-fit cursor-pointer items-center gap-3 text-sm">
				<span
					class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {wantsToBeDisplayed
						? 'bg-black'
						: 'bg-gray-300'}"
				>
					<input
						type="checkbox"
						name="visible"
						bind:checked={wantsToBeDisplayed}
						class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					/>
					<span
						class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {wantsToBeDisplayed
							? 'translate-x-5'
							: ''}"
					></span>
				</span>
				Je veux être affiché·e dans le trombinoscope
			</label>

			{#if wantsToBeDisplayed}
				<p class="mt-4 mb-2 text-xs font-bold uppercase text-gray-600">Champs affichés</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<label class="flex cursor-not-allowed items-center gap-2 text-sm text-gray-400">
						<input type="checkbox" checked disabled />
						Username (obligatoire)
					</label>
					{#each fieldOptins as field (field.key)}
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" name={field.key} bind:checked={fieldOptinState[field.key]} />
							{field.label}
						</label>
					{/each}
				</div>
			{/if}

			<button
				type="submit"
				disabled={submittingOptin}
				class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
			>
				{submittingOptin ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</form>
	{/if}
	{#if form?.success}
		<p class="border-t border-black px-4 py-2 text-xs text-gray-500">Préférences enregistrées.</p>
	{/if}
	{#if form?.error}
		<p class="border-t border-black px-4 py-2 text-xs text-red-700">{form.error}</p>
	{/if}
</div>

<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<div class="flex border border-black">
		<button
			type="button"
			onclick={() => (view = 'grid')}
			class="px-3 py-2 text-sm font-bold uppercase transition-colors {view === 'grid'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Grille
		</button>
		<button
			type="button"
			onclick={() => (view = 'list')}
			class="border-l border-black px-3 py-2 text-sm font-bold uppercase transition-colors {view ===
			'list'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Liste
		</button>
	</div>

	<input
		type="search"
		bind:value={searchQuery}
		placeholder="Rechercher un pseudo, un nom, un tag…"
		class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-400 sm:max-w-xs"
	/>

	<div class="flex border border-black">
		<button
			type="button"
			onclick={() => (tagFilter = 'all')}
			class="px-3 py-2 text-sm font-bold uppercase transition-colors {tagFilter === 'all'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Tous
		</button>
		<button
			type="button"
			onclick={() => (tagFilter = 'with')}
			class="border-l border-black px-3 py-2 text-sm font-bold uppercase transition-colors {tagFilter ===
			'with'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Avec tag
		</button>
		<button
			type="button"
			onclick={() => (tagFilter = 'without')}
			class="border-l border-black px-3 py-2 text-sm font-bold uppercase transition-colors {tagFilter ===
			'without'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Sans tag
		</button>
	</div>
</div>

{#if filteredMembers.length === 0}
	<p class="border border-black px-4 py-6 text-center text-sm text-gray-500">
		Aucun membre ne correspond à cette recherche.
	</p>
{:else if view === 'grid'}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
		{#each filteredMembers as member (member.pk)}
			<div class="border border-black">
				<div class="relative">
					{#if member.avatar}
						<img src={member.avatar} alt="" class="aspect-square w-full object-cover" />
					{:else}
						<div
							class="flex aspect-square items-center justify-center bg-black text-2xl font-bold text-white"
						>
							{initials(member.username)}
						</div>
					{/if}
					{#if member.tag}
						<span
							class="absolute top-0 right-0 w-24 truncate px-2 py-1 text-center text-xs font-bold uppercase"
							style={tagBadgeStyle(member.tagColor)}
						>
							{member.tag}
						</span>
					{/if}
				</div>
				<div class="space-y-1 p-3 text-sm">
					<p class="font-bold uppercase">@{member.username}</p>
					{#if fullName(member)}
						<p>{fullName(member)}</p>
					{/if}
					{#if member.email}
						<p class="flex items-center gap-1.5 text-gray-600">
							<svg
								viewBox="0 0 20 20"
								class="h-3.5 w-3.5 shrink-0"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								aria-hidden="true"
							>
								<rect x="2" y="4" width="16" height="12" rx="1" />
								<path d="M2 5l8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span class="min-w-0 truncate">{member.email}</span>
						</p>
					{/if}
					{#if member.phone}
						<p class="flex items-center gap-1.5 text-gray-600">
							<svg
								viewBox="0 0 20 20"
								class="h-3.5 w-3.5 shrink-0"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								aria-hidden="true"
							>
								<path
									d="M4 3h3l2 4-2 1a9 9 0 0 0 5 5l1-2 4 2v3a2 2 0 0 1-2 2C9 18 2 11 2 5a2 2 0 0 1 2-2z"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
							{member.phone}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="divide-y divide-black border border-black">
		{#each filteredMembers as member (member.pk)}
			<div class="relative flex items-center gap-4 p-3">
				{#if member.tag}
					<span
						class="absolute top-0 right-0 w-24 truncate px-2 py-1 text-center text-xs font-bold uppercase"
						style={tagBadgeStyle(member.tagColor)}
					>
						{member.tag}
					</span>
				{/if}
				{#if member.avatar}
					<img src={member.avatar} alt="" class="h-16 w-16 shrink-0 object-cover" />
				{:else}
					<div
						class="flex h-16 w-16 shrink-0 items-center justify-center bg-black text-sm font-bold text-white"
					>
						{initials(member.username)}
					</div>
				{/if}
				<div class="space-y-1 text-sm">
					<p class="font-bold uppercase">@{member.username}</p>
					{#if fullName(member)}
						<p>{fullName(member)}</p>
					{/if}
					{#if member.email || member.phone}
						<p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
							{#if member.email}
								<span class="flex items-center gap-1.5">
									<svg
										viewBox="0 0 20 20"
										class="h-3.5 w-3.5 shrink-0"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										aria-hidden="true"
									>
										<rect x="2" y="4" width="16" height="12" rx="1" />
										<path d="M2 5l8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
									{member.email}
								</span>
							{/if}
							{#if member.phone}
								<span class="flex items-center gap-1.5">
									<svg
										viewBox="0 0 20 20"
										class="h-3.5 w-3.5 shrink-0"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										aria-hidden="true"
									>
										<path
											d="M4 3h3l2 4-2 1a9 9 0 0 0 5 5l1-2 4 2v3a2 2 0 0 1-2 2C9 18 2 11 2 5a2 2 0 0 1 2-2z"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									{member.phone}
								</span>
							{/if}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
