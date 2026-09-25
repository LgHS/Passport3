<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { showToast } from '$lib/stores/toast.svelte';
	import { WISHLIST_TYPES, STATUS_META, typeMeta, type WishlistType } from '$lib/wishlistDisplay';
	import { renderMiniMarkdown } from '$lib/renderMiniMarkdown';
	import type { ActionData, PageData } from './$types';

	const TITLE_MAX_LENGTH = 100;
	const DESCRIPTION_MAX_LENGTH = 2000;

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type WishlistItem = PageData['items'][number];
	type FilterValue = WishlistType | 'all' | 'exauce' | 'rejete';
	type SortBy = 'newest' | 'oldest' | 'up' | 'down';

	// Deep link support (?item=123) — lets a shared link (e.g. a future Mattermost notification)
	// open straight into a specific proposal's modal instead of just landing on the full list.
	const parsedInitialItemId = Number(page.url.searchParams.get('item'));

	// Derived from the id, not a standalone copy of the item — so voting from inside the modal
	// (or any other action) shows the fresh counts immediately once the load rerun comes back,
	// the same way the card grid already does via sortedItems.
	let selectedItemId = $state<number | null>(
		Number.isInteger(parsedInitialItemId) ? parsedInitialItemId : null
	);
	let selectedItem = $derived(data.items.find((i) => i.id === selectedItemId) ?? null);
	let isEditing = $state(false);
	let editDescriptionValue = $state('');
	// Quantity only means anything for a purchase — tracked so the field can be hidden for the
	// other types instead of showing a meaningless "quantity" on an idea or an action.
	let createType = $state<WishlistType>('achat');
	let editType = $state<WishlistType>('achat');
	let filterType = $state<FilterValue>('all');
	let sortBy = $state<SortBy>('newest');
	let formOpen = $state(false);
	let descriptionValue = $state('');

	// Same horizontal-scroll-with-edge-fade pattern as /profile's tab strip — 6 filter buttons
	// (4 types + 2 statuses) wrap into a ragged second row on a narrow phone otherwise.
	let filterScrollEl = $state<HTMLDivElement | null>(null);
	let canScrollFiltersLeft = $state(false);
	let canScrollFiltersRight = $state(false);

	function updateFilterScrollFade() {
		const el = filterScrollEl;
		if (!el) return;
		canScrollFiltersLeft = el.scrollLeft > 0;
		canScrollFiltersRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
	}

	$effect(() => {
		const el = filterScrollEl;
		if (!el) return;
		updateFilterScrollFade();
		el.addEventListener('scroll', updateFilterScrollFade, { passive: true });
		window.addEventListener('resize', updateFilterScrollFade);
		return () => {
			el.removeEventListener('scroll', updateFilterScrollFade);
			window.removeEventListener('resize', updateFilterScrollFade);
		};
	});

	// Same wheel/trackpad redirect as /profile's tab strip — a plain mouse's vertical wheel delta
	// scrolls this strip horizontally instead of the page, and a trackpad's own horizontal swipe
	// (arrives as deltaX) is left untouched since overflow-x-auto already handles it natively.
	function handleFilterScrollWheel(event: WheelEvent) {
		const el = filterScrollEl;
		if (!el) return;
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		if ((event.deltaY < 0 && !canScrollFiltersLeft) || (event.deltaY > 0 && !canScrollFiltersRight)) {
			return;
		}
		event.preventDefault();
		el.scrollLeft += event.deltaY;
	}

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium' });
	function formatDate(iso: string): string {
		return dateFormat.format(new Date(iso));
	}

	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
	function formatAmount(amount: number): string {
		return amountFormat.format(amount);
	}

	function upPercent(item: WishlistItem): number {
		const total = item.upVoters.length + item.downVoters.length;
		return total === 0 ? 50 : Math.round((item.upVoters.length / total) * 100);
	}

	function openItem(item: WishlistItem) {
		selectedItemId = item.id;
		isEditing = false;
	}

	function startEditing() {
		if (!selectedItem) return;
		editDescriptionValue = selectedItem.description ?? '';
		editType = selectedItem.type;
		isEditing = true;
	}

	async function copyItemLink(item: WishlistItem) {
		const url = `${page.url.origin}${page.url.pathname}?item=${item.id}`;
		try {
			await navigator.clipboard.writeText(url);
			showToast('success', 'Lien copié.');
		} catch {
			showToast('error', 'Impossible de copier le lien.');
		}
	}

	// "Tout (Actifs)" and the per-type filters only ever show still-pending items — once an admin
	// resolves one, it moves out of general browsing and only shows up under its own Exaucé/Rejeté
	// filter, so a decided item doesn't linger and clutter the active list forever.
	let filteredItems = $derived(
		filterType === 'exauce' || filterType === 'rejete'
			? data.items.filter((item) => item.status === filterType)
			: filterType === 'all'
				? data.items.filter((item) => item.status === 'pending')
				: data.items.filter((item) => item.type === filterType && item.status === 'pending')
	);

	// createdAt is ISO8601, so plain string comparison already sorts chronologically — no need to
	// parse into Date objects just to compare.
	let sortedItems = $derived(
		[...filteredItems].sort((a, b) => {
			switch (sortBy) {
				case 'oldest':
					return a.createdAt.localeCompare(b.createdAt);
				case 'up':
					return b.upVoters.length - a.upVoters.length;
				case 'down':
					return b.downVoters.length - a.downVoters.length;
				default:
					return b.createdAt.localeCompare(a.createdAt);
			}
		})
	);

	// `vote-pop` used to be driven straight off `item.myVote`, which is persisted data — every
	// page load/refresh re-renders an already-voted button with that class already present, so
	// the browser plays the pop animation as if it had just been clicked. This tracks which
	// item+direction was *actually* clicked in this client session (keyed by direction too, not
	// just the item — otherwise clicking one button would also animate its sibling, since both
	// share the same item id), so only the clicked button ever animates, on the click itself.
	let justVotedKeys = $state(new Set<string>());
	function markJustVoted(itemId: number, value: 'up' | 'down') {
		const key = `${itemId}-${value}`;
		justVotedKeys.add(key);
		justVotedKeys = new Set(justVotedKeys);
		setTimeout(() => {
			justVotedKeys.delete(key);
			justVotedKeys = new Set(justVotedKeys);
		}, 500);
	}

	$effect(() => {
		if (form?.created) {
			showToast('success', 'Proposition ajoutée.');
			formOpen = false;
			descriptionValue = '';
			createType = 'achat';
		} else if (form?.edited) {
			showToast('success', 'Proposition modifiée.');
			isEditing = false;
		} else if (form?.deleted) {
			showToast('success', 'Proposition supprimée.');
			selectedItemId = null;
		} else if (form?.resolved) {
			showToast('success', 'Statut mis à jour.');
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});
</script>

<svelte:head>
	<title>Wishlist — Passport</title>
</svelte:head>

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Wishlist</h1>
<p class="mb-1 text-sm text-gray-600">
	La wishlist permet à chaque membre de faire une proposition d'achat, de partager une idée ou une
	action à faire au sein du hackerspace. Les autres membres peuvent voter pour ou contre.
</p>
<p class="mb-6 text-sm text-gray-600">
	À chaque création, une notification sera envoyée vers Mattermost invitant les membres à voter.
</p>

<div class="mb-6 border border-black">
	<button
		type="button"
		onclick={() => (formOpen = !formOpen)}
		class="flex w-full items-center justify-between px-4 py-3 text-sm font-bold uppercase"
		aria-expanded={formOpen}
	>
		Faire une proposition
		<svg
			viewBox="0 0 12 8"
			class="h-2.5 w-2.5 shrink-0 fill-current transition-transform {formOpen ? 'rotate-180' : ''}"
			aria-hidden="true"
		>
			<path d="M0 0 L12 0 L6 8 Z" />
		</svg>
	</button>

	{#if formOpen}
		<form method="POST" action="?/create" use:enhance class="border-t border-black p-4">
			<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class={createType === 'achat' ? '' : 'md:col-span-2'}>
					<label class="mb-1 block text-sm font-bold uppercase" for="title">Titre</label>
					<input
						id="title"
						name="title"
						type="text"
						maxlength={TITLE_MAX_LENGTH}
						required
						class="w-full border border-black px-3 py-2 text-sm"
					/>
				</div>
				{#if createType === 'achat'}
					<div>
						<label class="mb-1 block text-sm font-bold uppercase" for="quantity">Quantité</label>
						<input
							id="quantity"
							name="quantity"
							type="number"
							min="1"
							value="1"
							required
							class="w-full border border-black px-3 py-2 text-sm"
						/>
					</div>
				{/if}
			</div>

			<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-bold uppercase" for="link">Lien (optionnel)</label>
					<input
						id="link"
						name="link"
						type="url"
						placeholder="https://…"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm font-bold uppercase" for="estimatedAmount">
						Montant estimé <span class="text-xs font-normal normal-case">(optionnel)</span>
					</label>
					<input
						id="estimatedAmount"
						name="estimatedAmount"
						type="text"
						inputmode="decimal"
						placeholder="Ex. 129,90"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
			</div>

			<div class="mb-4">
				<div class="mb-1 flex items-baseline justify-between">
					<label class="block text-sm font-bold uppercase" for="description">
						Description (optionnel)
					</label>
					<span class="text-xs text-gray-500">{descriptionValue.length}/{DESCRIPTION_MAX_LENGTH}</span>
				</div>
				<textarea
					id="description"
					name="description"
					rows="5"
					maxlength={DESCRIPTION_MAX_LENGTH}
					bind:value={descriptionValue}
					placeholder="Contexte, modèle souhaité, contraintes, alternatives…"
					class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
				></textarea>
				<p class="mt-1 text-xs text-gray-500">**gras**, *italique*, __souligné__</p>
			</div>

			<div class="mb-4">
				<span class="mb-1 block text-sm font-bold uppercase">Type</span>
				<div class="flex flex-wrap gap-4">
					{#each WISHLIST_TYPES as t (t.value)}
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" name="type" value={t.value} bind:group={createType} />
							{t.icon} {t.label}
						</label>
					{/each}
				</div>
			</div>

			<button type="submit" class="btn-primary px-6 py-3">Ajouter</button>
		</form>
	{/if}
</div>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<div class="relative min-w-0 flex-1">
		<div
			bind:this={filterScrollEl}
			onwheel={handleFilterScrollWheel}
			class="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto text-sm"
		>
			<button
				type="button"
				onclick={() => (filterType = 'all')}
				class="shrink-0 border border-black px-3 py-1.5 font-bold uppercase transition-colors {filterType ===
				'all'
					? 'bg-black text-white'
					: 'hover:bg-black hover:text-white'}"
			>
				Tout (Actifs)
			</button>
			{#each WISHLIST_TYPES as t (t.value)}
				<button
					type="button"
					onclick={() => (filterType = t.value)}
					class="shrink-0 border border-black px-3 py-1.5 font-bold uppercase transition-colors {filterType ===
					t.value
						? 'bg-black text-white'
						: 'hover:bg-black hover:text-white'}"
				>
					{t.icon} {t.label}
				</button>
			{/each}
			<button
				type="button"
				onclick={() => (filterType = 'exauce')}
				class="shrink-0 border border-black px-3 py-1.5 font-bold uppercase transition-colors {filterType ===
				'exauce'
					? 'bg-black text-white'
					: 'hover:bg-black hover:text-white'}"
			>
				{STATUS_META.exauce.icon} {STATUS_META.exauce.label}
			</button>
			<button
				type="button"
				onclick={() => (filterType = 'rejete')}
				class="shrink-0 border border-black px-3 py-1.5 font-bold uppercase transition-colors {filterType ===
				'rejete'
					? 'bg-black text-white'
					: 'hover:bg-black hover:text-white'}"
			>
				{STATUS_META.rejete.icon} {STATUS_META.rejete.label}
			</button>
		</div>
		{#if canScrollFiltersLeft}
			<div
				class="pointer-events-none absolute top-0 bottom-0 left-0 w-8 bg-gradient-to-r from-white to-transparent"
				aria-hidden="true"
			></div>
		{/if}
		{#if canScrollFiltersRight}
			<div
				class="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent"
				aria-hidden="true"
			></div>
		{/if}
	</div>

	<select bind:value={sortBy} class="shrink-0 border border-black px-3 py-1.5 text-sm font-bold">
		<option value="newest">Plus récent</option>
		<option value="oldest">Plus ancien</option>
		<option value="up">Plus de votes pour</option>
		<option value="down">Plus de votes contre</option>
	</select>
</div>

{#if sortedItems.length > 0}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		{#each sortedItems as item (item.id)}
			<div class="flex h-full flex-col border border-black p-4">
				<button type="button" onclick={() => openItem(item)} class="block w-full text-left">
					<div class="mb-2 flex items-start justify-between gap-2">
						<h3 class="font-bold">{item.title}</h3>
						<span
							class="inline-flex w-28 shrink-0 items-center justify-center gap-1 border border-black px-2 py-0.5 text-xs font-bold uppercase"
						>
							{typeMeta(item.type).icon} {typeMeta(item.type).label}
						</span>
					</div>
					{#if item.description}
						<p class="mb-3 line-clamp-2 text-sm text-gray-600">{@html renderMiniMarkdown(item.description)}</p>
					{/if}
				</button>

				<!-- Pinned to the bottom regardless of how long/short the description above is, so
				     cards in the same grid row don't end up with their vote bar at different heights. -->
				<div class="mt-auto">
					<div class="mb-3">
						<div class="mb-1 flex justify-between text-xs font-bold">
							<span class="text-green-700">{item.upVoters.length} pour</span>
							<span class="text-red-700">{item.downVoters.length} contre</span>
						</div>
						<div class="flex h-2 w-full overflow-hidden border border-black">
							{#if item.upVoters.length + item.downVoters.length > 0}
								<div class="bg-green-500" style="width: {upPercent(item)}%"></div>
								<div class="bg-red-500" style="width: {100 - upPercent(item)}%"></div>
							{:else}
								<div class="w-full bg-gray-200"></div>
							{/if}
						</div>
					</div>

					<div class="flex items-center justify-between text-xs text-gray-500">
						<span>{item.authorLabel} — {formatDate(item.createdAt)}</span>
						{#if item.status === 'pending'}
							<div class="flex gap-2">
								<form method="POST" action="?/vote" use:enhance={() => markJustVoted(item.id, 'up')}>
									<input type="hidden" name="itemId" value={item.id} />
									<input type="hidden" name="value" value="up" />
									<button
										type="submit"
										aria-label="Voter pour"
										class="border-2 border-green-600 px-2 py-1 font-bold text-green-700 transition-transform duration-150 hover:scale-110 active:scale-90 {item.myVote ===
										1
											? 'bg-green-600 text-white'
											: ''} {justVotedKeys.has(`${item.id}-up`) ? 'vote-pop' : ''}"
									>
										▲
									</button>
								</form>
								<form method="POST" action="?/vote" use:enhance={() => markJustVoted(item.id, 'down')}>
									<input type="hidden" name="itemId" value={item.id} />
									<input type="hidden" name="value" value="down" />
									<button
										type="submit"
										aria-label="Voter contre"
										class="border-2 border-red-600 px-2 py-1 font-bold text-red-700 transition-transform duration-150 hover:scale-110 active:scale-90 {item.myVote ===
										-1
											? 'bg-red-600 text-white'
											: ''} {justVotedKeys.has(`${item.id}-down`) ? 'vote-pop' : ''}"
									>
										▼
									</button>
								</form>
							</div>
						{:else}
							<span class="font-bold uppercase">
								{STATUS_META[item.status].icon} {STATUS_META[item.status].label}
								{#if item.resolvedAt}
									— {formatDate(item.resolvedAt)}
								{/if}
							</span>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
{:else}
	<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
		Aucune proposition pour l'instant.
	</p>
{/if}

{#if selectedItem}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) selectedItemId = null;
		}}
		onkeydown={(e) => e.key === 'Escape' && (selectedItemId = null)}
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
				<h2 class="text-base font-bold uppercase">{selectedItem.title}</h2>
				<button
					type="button"
					onclick={() => (selectedItemId = null)}
					aria-label="Fermer"
					class="shrink-0 px-2 text-lg font-bold leading-none"
				>
					×
				</button>
			</div>

			{#if isEditing}
				<form method="POST" action="?/edit" use:enhance>
					<input type="hidden" name="itemId" value={selectedItem.id} />

					<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						<div class={editType === 'achat' ? '' : 'md:col-span-2'}>
							<label class="mb-1 block text-sm font-bold uppercase" for="edit-title">Titre</label>
							<input
								id="edit-title"
								name="title"
								type="text"
								maxlength={TITLE_MAX_LENGTH}
								required
								value={selectedItem.title}
								class="w-full border border-black px-3 py-2 text-sm"
							/>
						</div>
						{#if editType === 'achat'}
							<div>
								<label class="mb-1 block text-sm font-bold uppercase" for="edit-quantity">
									Quantité
								</label>
								<input
									id="edit-quantity"
									name="quantity"
									type="number"
									min="1"
									required
									value={selectedItem.quantity}
									class="w-full border border-black px-3 py-2 text-sm"
								/>
							</div>
						{/if}
					</div>

					<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm font-bold uppercase" for="edit-link">
								Lien (optionnel)
							</label>
							<input
								id="edit-link"
								name="link"
								type="url"
								value={selectedItem.link ?? ''}
								class="w-full border border-black px-3 py-2 text-sm"
							/>
						</div>
						<div>
							<label class="mb-1 block text-sm font-bold uppercase" for="edit-estimatedAmount">
								Montant estimé <span class="text-xs font-normal normal-case">(optionnel)</span>
							</label>
							<input
								id="edit-estimatedAmount"
								name="estimatedAmount"
								type="text"
								inputmode="decimal"
								value={selectedItem.estimatedAmount ?? ''}
								class="w-full border border-black px-3 py-2 text-sm"
							/>
						</div>
					</div>

					<div class="mb-4">
						<div class="mb-1 flex items-baseline justify-between">
							<label class="block text-sm font-bold uppercase" for="edit-description">
								Description (optionnel)
							</label>
							<span class="text-xs text-gray-500">
								{editDescriptionValue.length}/{DESCRIPTION_MAX_LENGTH}
							</span>
						</div>
						<textarea
							id="edit-description"
							name="description"
							rows="5"
							maxlength={DESCRIPTION_MAX_LENGTH}
							bind:value={editDescriptionValue}
							class="w-full border border-black px-3 py-2 text-sm"
						></textarea>
					</div>

					<div class="mb-4">
						<span class="mb-1 block text-sm font-bold uppercase">Type</span>
						<div class="flex flex-wrap gap-4">
							{#each WISHLIST_TYPES as t (t.value)}
								<label class="flex items-center gap-2 text-sm">
									<input type="radio" name="type" value={t.value} bind:group={editType} />
									{t.icon} {t.label}
								</label>
							{/each}
						</div>
					</div>

					<div class="flex items-center gap-4">
						<button type="submit" class="btn-primary px-4 py-2 text-sm">Enregistrer</button>
						<button type="button" onclick={() => (isEditing = false)} class="text-sm underline">
							Annuler
						</button>
					</div>
				</form>
			{:else}
				<p class="mb-3 text-sm text-gray-600">
					{typeMeta(selectedItem.type).icon} {typeMeta(selectedItem.type).label}
					{#if selectedItem.type === 'achat'}
						— Quantité : {selectedItem.quantity}
					{/if}
					{#if selectedItem.estimatedAmount !== null}
						— {formatAmount(selectedItem.estimatedAmount)}
					{/if}
				</p>

				{#if selectedItem.status !== 'pending'}
					<p class="mb-3 text-sm font-bold uppercase">
						{STATUS_META[selectedItem.status].icon} {STATUS_META[selectedItem.status].label}
						{#if selectedItem.resolvedAt}
							— {formatDate(selectedItem.resolvedAt)}
						{/if}
					</p>
				{/if}

				{#if selectedItem.description}
					<p class="mb-3 text-sm whitespace-pre-wrap">{@html renderMiniMarkdown(selectedItem.description)}</p>
				{/if}

				{#if selectedItem.link}
					<p class="mb-3 text-sm">
						<a href={selectedItem.link} target="_blank" rel="noopener">{selectedItem.link}</a>
					</p>
				{/if}

				<p class="mb-3 text-xs text-gray-500">
					Proposé par {selectedItem.authorLabel} le {formatDate(selectedItem.createdAt)}
				</p>

				<div class="mb-3 border-t border-black pt-3 text-sm">
					{#if selectedItem.status === 'pending'}
						<div class="mb-3 flex items-center gap-3">
							<form method="POST" action="?/vote" use:enhance={() => markJustVoted(selectedItem.id, 'up')}>
								<input type="hidden" name="itemId" value={selectedItem.id} />
								<input type="hidden" name="value" value="up" />
								<button
									type="submit"
									aria-label="Voter pour"
									class="border-2 border-green-600 px-3 py-1.5 font-bold text-green-700 transition-transform duration-150 hover:scale-110 active:scale-90 {selectedItem.myVote ===
									1
										? 'bg-green-600 text-white'
										: ''} {justVotedKeys.has(`${selectedItem.id}-up`) ? 'vote-pop' : ''}"
								>
									▲
								</button>
							</form>
							<form method="POST" action="?/vote" use:enhance={() => markJustVoted(selectedItem.id, 'down')}>
								<input type="hidden" name="itemId" value={selectedItem.id} />
								<input type="hidden" name="value" value="down" />
								<button
									type="submit"
									aria-label="Voter contre"
									class="border-2 border-red-600 px-3 py-1.5 font-bold text-red-700 transition-transform duration-150 hover:scale-110 active:scale-90 {selectedItem.myVote ===
									-1
										? 'bg-red-600 text-white'
										: ''} {justVotedKeys.has(`${selectedItem.id}-down`) ? 'vote-pop' : ''}"
								>
									▼
								</button>
							</form>
						</div>
					{/if}
					<p class="mb-1 font-bold text-green-700">Pour ({selectedItem.upVoters.length})</p>
					<p class="mb-3 text-gray-600">
						{selectedItem.upVoters.length > 0 ? selectedItem.upVoters.join(', ') : '—'}
					</p>
					<p class="mb-1 font-bold text-red-700">Contre ({selectedItem.downVoters.length})</p>
					<p class="text-gray-600">
						{selectedItem.downVoters.length > 0 ? selectedItem.downVoters.join(', ') : '—'}
					</p>
				</div>

				{#if data.isAdmin}
					<div class="mb-3 flex gap-2 border-t border-black pt-3">
						{#if selectedItem.status === 'pending'}
							<form method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="itemId" value={selectedItem.id} />
								<input type="hidden" name="status" value="exauce" />
								<button
									type="submit"
									class="border border-black bg-lghs-yellow px-3 py-1.5 text-xs font-bold uppercase"
								>
									{STATUS_META.exauce.icon} Exaucer
								</button>
							</form>
							<form method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="itemId" value={selectedItem.id} />
								<input type="hidden" name="status" value="rejete" />
								<button
									type="submit"
									class="border border-black bg-lghs-yellow px-3 py-1.5 text-xs font-bold uppercase"
								>
									{STATUS_META.rejete.icon} Rejeter
								</button>
							</form>
						{:else}
							<form method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="itemId" value={selectedItem.id} />
								<input type="hidden" name="status" value="pending" />
								<button
									type="submit"
									class="border border-black bg-lghs-yellow px-3 py-1.5 text-xs font-bold uppercase"
								>
									↩️ Remettre en attente
								</button>
							</form>
						{/if}
					</div>
				{/if}

				<div class="flex gap-4 border-t border-black pt-3">
					<button
						type="button"
						onclick={() => selectedItem && copyItemLink(selectedItem)}
						class="text-xs font-bold uppercase underline"
					>
						🔗 Copier le lien
					</button>
					{#if selectedItem.canEdit}
						<button type="button" onclick={startEditing} class="text-xs font-bold uppercase underline">
							Modifier
						</button>
					{/if}
					{#if selectedItem.canDelete}
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="itemId" value={selectedItem.id} />
							<button type="submit" class="text-xs font-bold uppercase text-red-700 underline">
								Supprimer cette proposition
							</button>
						</form>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	@keyframes vote-pop {
		0% {
			transform: scale(1) rotate(0deg);
		}
		30% {
			transform: scale(1.3) rotate(-8deg);
		}
		60% {
			transform: scale(1.15) rotate(6deg);
		}
		100% {
			transform: scale(1) rotate(0deg);
		}
	}

	/* Square, not round, to match the button's own sharp corners — the rest of the app never
	   uses rounded corners on buttons, so a circular ripple would look out of place here. */
	@keyframes vote-ripple {
		0% {
			transform: scale(1);
			opacity: 0.6;
		}
		100% {
			transform: scale(1.8);
			opacity: 0;
		}
	}

	.vote-pop {
		position: relative;
		animation: vote-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.vote-pop::after {
		content: '';
		position: absolute;
		inset: 0;
		border: 2px solid currentColor;
		animation: vote-ripple 0.5s ease-out;
		pointer-events: none;
	}

	.no-scrollbar {
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* legacy Edge */
	}

	.no-scrollbar::-webkit-scrollbar {
		display: none; /* Chrome, Safari */
	}
</style>
