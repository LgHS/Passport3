<script lang="ts">
	import type { PageData } from './$types';

	const PAGE_SIZE = 20;

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let page = $state(1);

	let filteredUsers = $derived(
		data.users.filter((user) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return (
				user.name.toLowerCase().includes(q) ||
				user.username.toLowerCase().includes(q) ||
				user.email.toLowerCase().includes(q)
			);
		})
	);

	let pageCount = $derived(Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE)));
	let pagedUsers = $derived(filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	function onSearch(value: string) {
		query = value;
		page = 1;
	}
</script>

<svelte:head>
	<title>Administration — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Membres</h1>

	<div class="mb-4 flex flex-wrap items-center gap-4">
		<input
			type="search"
			value={query}
			oninput={(e) => onSearch(e.currentTarget.value)}
			placeholder="Rechercher par nom, identifiant ou email…"
			class="min-w-0 flex-1 border border-black px-3 py-2 text-sm"
		/>
		<a
			href="/admin/invite"
			class="no-underline-fx btn-primary inline-block shrink-0 px-4 py-2"
		>
			Créer une invitation
		</a>
	</div>

	{#if pagedUsers.length > 0}
		<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
		<div class="space-y-2 sm:hidden">
			{#each pagedUsers as user (user.pk)}
				<a
					href="/admin/users/{user.pk}"
					class="no-underline-fx block border border-black p-3 text-sm transition-colors hover:bg-black hover:text-white"
				>
					<p class="font-bold">{user.name}</p>
					<p class="mt-1 opacity-70">{user.username}</p>
					<p class="mt-1 opacity-70">{user.email}</p>
					<p class="mt-1 text-xs font-bold uppercase">{user.is_active ? 'Actif' : 'Inactif'}</p>
				</a>
			{/each}
		</div>

		<div class="hidden overflow-x-auto sm:block">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Nom</th>
						<th class="border border-black px-3 py-2 text-left">Identifiant</th>
						<th class="border border-black px-3 py-2 text-left">Email</th>
						<th class="border border-black px-3 py-2 text-left">Statut</th>
					</tr>
				</thead>
				<tbody>
					{#each pagedUsers as user (user.pk)}
						<tr class="group">
							<td class="border border-black p-0">
								<a
									href="/admin/users/{user.pk}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{user.name}
								</a>
							</td>
							<td class="border border-black p-0">
								<a
									href="/admin/users/{user.pk}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{user.username}
								</a>
							</td>
							<td class="border border-black p-0">
								<a
									href="/admin/users/{user.pk}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{user.email}
								</a>
							</td>
							<td class="border border-black p-0">
								<a
									href="/admin/users/{user.pk}"
									class="no-underline-fx block px-3 py-2 transition-colors group-hover:bg-black group-hover:text-white"
								>
									{user.is_active ? 'Actif' : 'Inactif'}
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
			Aucun résultat.
		</p>
	{/if}

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
</section>
