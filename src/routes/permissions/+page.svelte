<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Permissions — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Permissions</h1>

<p class="mb-6 text-sm leading-relaxed">
	Liste des groupes auxquels votre compte appartient. Chaque groupe vous donne accès à un certain
	nombre de permissions.
</p>

{#if data.groups.length > 0}
	<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
	<div class="space-y-2 sm:hidden">
		{#each data.groups as group (group.name)}
			<div class="border border-black p-3 text-sm">
				<p class="flex flex-wrap items-center gap-2 font-bold">
					{group.name}
					{#if group.isSuperuser}
						<span class="bg-black px-1.5 py-0.5 text-xs text-lghs-yellow uppercase">Admin</span>
					{/if}
				</p>
				{#if group.note}
					<p class="mt-1 text-gray-600">{group.note}</p>
				{/if}
			</div>
		{/each}
	</div>

	<div class="hidden overflow-x-auto sm:block">
		<table class="w-full table-fixed border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class="w-1/3 border border-black px-3 py-2 text-left">Permission</th>
					<th class="border border-black px-3 py-2 text-left">Description</th>
				</tr>
			</thead>
			<tbody>
				{#each data.groups as group (group.name)}
					<tr>
						<td class="border border-black px-3 py-2 font-bold">
							{group.name}
							{#if group.isSuperuser}
								<span class="ml-1 bg-black px-1.5 py-0.5 text-xs text-lghs-yellow uppercase">
									Admin
								</span>
							{/if}
						</td>
						<td class="border border-black px-3 py-2 text-gray-600">{group.note ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
		Il y a un petit problème... Aucun groupe associé à votre compte.
	</p>
{/if}
