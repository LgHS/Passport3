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
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Membres</h1>
		<a href="/admin/invite" class="no-underline-fx btn-primary inline-block px-4 py-2">
			Créer une invitation
		</a>
	</div>

	<input
		type="search"
		value={query}
		oninput={(e) => onSearch(e.currentTarget.value)}
		placeholder="Rechercher par nom, identifiant ou email…"
		class="mb-4 w-full border border-black px-3 py-2 text-sm"
	/>

	<div class="overflow-x-auto">
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
				{:else}
					<tr>
						<td colspan="4" class="border border-black px-3 py-4 text-center text-gray-500">
							Aucun résultat.
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
</section>
