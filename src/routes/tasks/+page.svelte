<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Task = PageData['tasks'][number];
	type Status = Task['status'];

	const COLUMNS: { status: Status; label: string }[] = [
		{ status: 'todo', label: 'À faire' },
		{ status: 'in_progress', label: 'En cours' },
		{ status: 'done', label: 'Fait' }
	];

	let view = $state<'board' | 'list'>('board');
	let onlyMine = $state(false);
	let formOpen = $state(false);

	$effect(() => {
		if (form?.error) showToast('error', form.error);
		else if (form?.created) showToast('success', 'Tâche ajoutée.');
	});

	const visibleTasks = $derived(
		onlyMine ? data.tasks.filter((t) => t.assigneeSub === data.mySub) : data.tasks
	);

	function tasksFor(status: Status): Task[] {
		return visibleTasks.filter((t) => t.status === status);
	}

	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
	}

	function isOverdue(task: Task): boolean {
		return task.status !== 'done' && !!task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);
	}

	const canDelete = (t: Task) => data.isAdmin || (t.authorSub === data.mySub && !t.assigneeSub);
	const isMine = (t: Task) => t.assigneeSub === data.mySub;
</script>

<svelte:head>
	<title>Tâches — Passport</title>
</svelte:head>

{#snippet taskCard(task: Task)}
	<div class="border border-black bg-white p-3 text-sm">
		<p class="font-bold">{task.title}</p>
		{#if task.description}
			<p class="mt-1 whitespace-pre-line text-gray-600">{task.description}</p>
		{/if}
		<p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
			{#if task.dueDate}
				<span class={isOverdue(task) ? 'font-bold text-red-600' : ''}>
					Pour le {formatDay(task.dueDate)}{isOverdue(task) ? ' (en retard)' : ''}
				</span>
			{/if}
			{#if task.assigneeLabel}
				<span>@{task.assigneeLabel}{task.imposed ? ' (assigné)' : ''}</span>
			{/if}
			<span>par @{task.authorLabel}</span>
		</p>

		<div class="mt-3 flex flex-wrap gap-2">
			{#if task.status === 'todo' && !task.assigneeSub}
				<form method="POST" action="?/take" use:enhance>
					<input type="hidden" name="taskId" value={task.id} />
					<button class="btn-primary px-2 py-1 text-xs">Je m'en occupe</button>
				</form>
			{/if}
			{#if task.status === 'in_progress' && (isMine(task) || data.isAdmin)}
				<form method="POST" action="?/done" use:enhance>
					<input type="hidden" name="taskId" value={task.id} />
					<button class="btn-primary px-2 py-1 text-xs">Fait</button>
				</form>
			{/if}
			{#if task.status === 'in_progress' && ((isMine(task) && !task.imposed) || data.isAdmin)}
				<form method="POST" action="?/release" use:enhance>
					<input type="hidden" name="taskId" value={task.id} />
					<button class="border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">
						{isMine(task) ? 'Je ne peux plus' : 'Désassigner'}
					</button>
				</form>
			{/if}
			{#if task.status === 'done' && (isMine(task) || data.isAdmin)}
				<form method="POST" action="?/reopen" use:enhance>
					<input type="hidden" name="taskId" value={task.id} />
					<button class="border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">
						Rouvrir
					</button>
				</form>
			{/if}
			{#if canDelete(task)}
				<form
					method="POST"
					action="?/delete"
					use:enhance={({ cancel }) => {
						if (!confirm('Supprimer cette tâche ?')) cancel();
					}}
				>
					<input type="hidden" name="taskId" value={task.id} />
					<button class="border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">
						Supprimer
					</button>
				</form>
			{/if}
		</div>

		{#if data.isAdmin && data.members && task.status !== 'done'}
			<form method="POST" action="?/assign" use:enhance class="mt-2 flex gap-2">
				<input type="hidden" name="taskId" value={task.id} />
				<select name="assigneePk" required class="min-w-0 flex-1 border border-black px-1 py-1 text-xs">
					<option value="">Assigner à…</option>
					{#each data.members as member (member.sub)}
						<option value={member.sub}>@{member.label}</option>
					{/each}
				</select>
				<button class="border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white">
					OK
				</button>
			</form>
		{/if}
	</div>
{/snippet}

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Tâches</h1>
<p class="mb-6 text-sm text-gray-600">
	Les tâches de l'atelier. Prenez-en une, ou proposez-en une nouvelle.
</p>

<div class="mb-6 border border-black">
	<button
		type="button"
		onclick={() => (formOpen = !formOpen)}
		class="w-full px-4 py-3 text-left text-sm font-bold uppercase"
		aria-expanded={formOpen}
	>
		+ Nouvelle tâche
	</button>
	{#if formOpen}
		<form
			method="POST"
			action="?/create"
			class="space-y-3 border-t border-black p-4"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') formOpen = false;
				}}
		>
			<input name="title" required maxlength="120" placeholder="Titre" class="w-full border border-black px-3 py-2 text-sm" />
			<textarea
				name="description"
				maxlength="2000"
				rows="3"
				placeholder="Détails (optionnel)"
				class="w-full border border-black px-3 py-2 text-sm"
			></textarea>
			<label class="block text-sm">
				<span class="mb-1 block text-xs font-bold uppercase text-gray-600">Échéance (optionnel)</span>
				<input name="dueDate" type="date" class="border border-black px-3 py-2 text-sm" />
			</label>
			<button class="btn-primary px-4 py-2 text-sm">Ajouter</button>
		</form>
	{/if}
</div>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="flex border border-black">
		<button
			type="button"
			onclick={() => (view = 'board')}
			class="px-3 py-2 text-sm font-bold uppercase {view === 'board' ? 'bg-black text-white' : 'hover:bg-black hover:text-white'}"
		>
			Tableau
		</button>
		<button
			type="button"
			onclick={() => (view = 'list')}
			class="border-l border-black px-3 py-2 text-sm font-bold uppercase {view === 'list'
				? 'bg-black text-white'
				: 'hover:bg-black hover:text-white'}"
		>
			Liste
		</button>
	</div>
	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" bind:checked={onlyMine} />
		Mes tâches
	</label>
</div>

{#if view === 'board'}
	<div class="grid gap-4 md:grid-cols-3">
		{#each COLUMNS as column (column.status)}
			<section class="border border-black bg-gray-50">
				<h2 class="bg-black px-3 py-2 text-sm font-bold text-white uppercase">
					{column.label} ({tasksFor(column.status).length})
				</h2>
				<div class="space-y-2 p-2">
					{#each tasksFor(column.status) as task (task.id)}
						{@render taskCard(task)}
					{:else}
						<p class="px-1 py-3 text-center text-xs text-gray-500">Rien ici.</p>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{:else}
	<div class="space-y-4">
		{#each COLUMNS as column (column.status)}
			{#if tasksFor(column.status).length > 0}
				<section>
					<h2 class="mb-2 text-sm font-bold uppercase">{column.label}</h2>
					<div class="space-y-2">
						{#each tasksFor(column.status) as task (task.id)}
							{@render taskCard(task)}
						{/each}
					</div>
				</section>
			{/if}
		{/each}
		{#if visibleTasks.length === 0}
			<p class="border border-black px-4 py-6 text-center text-sm text-gray-500">Aucune tâche.</p>
		{/if}
	</div>
{/if}
