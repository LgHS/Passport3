<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Task = PageData['tasks'][number];
	type Status = Task['status'];

	const ALL_COLUMNS: { status: Status; label: string }[] = [
		{ status: 'todo', label: 'À faire' },
		{ status: 'in_progress', label: 'En cours' },
		{ status: 'blocked', label: 'Bloqué' },
		{ status: 'done', label: 'Fait' }
	];

	const BLOCKED_LABEL = { internal: 'interne', external: 'externe' } as const;

	let view = $state<'board' | 'list'>('board');
	let onlyMine = $state(false);
	// Hidden by default: blocked tasks are waiting on something, not up for grabs.
	let showBlocked = $state(false);
	const columns = $derived(ALL_COLUMNS.filter((c) => showBlocked || c.status !== 'blocked'));
	const blockedCount = $derived(data.tasks.filter((t) => t.status === 'blocked').length);
	let createOpen = $state(false);

	// Modal: derived from the id, so it shows fresh data after every action's reload.
	let selectedId = $state<number | null>(null);
	let selected = $derived(data.tasks.find((t) => t.id === selectedId) ?? null);
	let editing = $state(false);
	let dialog = $state<HTMLDialogElement | null>(null);

	function openTask(task: Task) {
		selectedId = task.id;
		editing = false;
		dialog?.showModal();
	}

	function closeTask() {
		dialog?.close();
	}

	$effect(() => {
		if (form?.error) showToast('error', form.error);
		else if (form?.created) showToast('success', 'Tâche ajoutée.');
		else if (form?.edited) showToast('success', 'Tâche modifiée.');
	});

	// A task deleted from the modal vanishes from the list: close the modal with it.
	$effect(() => {
		if (selectedId !== null && !selected) closeTask();
	});

	const isMember = (t: Task) => t.members.some((m) => m.sub === data.mySub);
	const myMembership = (t: Task) => t.members.find((m) => m.sub === data.mySub);
	const canEdit = (t: Task) => data.isAdmin || t.authorSub === data.mySub;
	const canDelete = (t: Task) => data.isAdmin || (t.authorSub === data.mySub && t.members.length === 0);
	const canFlagBlocked = (t: Task) => data.isAdmin || t.authorSub === data.mySub || isMember(t);

	const visibleTasks = $derived(onlyMine ? data.tasks.filter(isMember) : data.tasks);

	function tasksFor(status: Status): Task[] {
		return visibleTasks.filter((t) => t.status === status);
	}

	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
	}

	function isOverdue(task: Task): boolean {
		return task.status !== 'done' && !!task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);
	}

	const buttonClass = 'border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white';
	// Same yellow as the wishlist's admin-only buttons: used whenever the current user can only do
	// this because they're an admin.
	const adminButtonClass = 'border border-black bg-lghs-yellow px-2 py-1 text-xs font-bold uppercase';
	// Picks the admin look when the user's right to act comes only from being an admin.
	const buttonFor = (onlyAsAdmin: boolean, base = buttonClass) => (onlyAsAdmin ? adminButtonClass : base);

	// The open task's own history, fetched when its modal opens.
	type TaskEvent = { id: number; createdAt: string; actorLabel: string; action: string; details: Record<string, unknown> | null };
	let history = $state<TaskEvent[] | null>(null);
	let historyFailed = $state(false);

	async function loadHistory(taskId: number) {
		history = null;
		historyFailed = false;
		try {
			const res = await fetch(`/tasks/${taskId}/history`);
			if (!res.ok) throw new Error(String(res.status));
			history = (await res.json()) as TaskEvent[];
		} catch {
			historyFailed = true;
		}
	}

	// Reload the history after every action on the open task (the page data changes each time).
	$effect(() => {
		if (selected) {
			void data.tasks;
			loadHistory(selected.id);
		}
	});

	function describe(event: TaskEvent): string {
		const d = event.details ?? {};
		const who = typeof d.member === 'string' ? `@${d.member}` : 'un membre';
		switch (event.action) {
			case 'task.create': return 'a créé la tâche';
			case 'task.edit': return 'a modifié la tâche';
			case 'task.join': return 'participe';
			case 'task.leave': return "s'est retiré·e";
			case 'task.assign': return `a assigné ${who}`;
			case 'task.removeMember': return `a retiré ${who}`;
			case 'task.setLeader': return typeof d.leader === 'string' ? `a désigné @${d.leader} comme leader` : 'a retiré le leader';
			case 'task.start': return 'a démarré la tâche';
			case 'task.unstart': return 'a remis la tâche à faire';
			case 'task.block': {
				const after = d.after as { kind?: string; note?: string } | undefined;
				return `a signalé un blocage ${after?.kind === 'external' ? 'externe' : 'interne'}${after?.note ? ` : « ${after.note} »` : ''}`;
			}
			case 'task.unblock': return 'a débloqué la tâche';
			case 'task.done': return 'a marqué la tâche comme faite';
			case 'task.reopen': return 'a rouvert la tâche';
			default: return event.action;
		}
	}

	function formatWhen(iso: string): string {
		return new Date(iso).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Tâches — Passport</title>
</svelte:head>

{#snippet dueLabel(task: Task)}
	{#if task.dueDate}
		<span class={isOverdue(task) ? 'font-bold text-red-600' : ''}>
			Date limite : {formatDay(task.dueDate)}{isOverdue(task) ? ' (en retard)' : ''}
		</span>
	{/if}
{/snippet}

{#snippet taskCard(task: Task)}
	<button
		type="button"
		onclick={() => openTask(task)}
		class="block w-full cursor-pointer border border-black bg-white p-3 text-left text-sm hover:bg-gray-100"
	>
		<span class="block font-bold">{task.title}</span>
		<span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
			{#if task.blocked}
				<span class="font-bold text-orange-700">Bloqué ({BLOCKED_LABEL[task.blocked.kind]})</span>
			{/if}
			{@render dueLabel(task)}
			{#each task.members as member (member.sub)}
				<span
					class={member.sub === data.mySub ? 'font-bold text-black' : ''}
					title={member.imposed ? 'Assigné par un admin' : 'Participant (volontaire)'}
				>
					{member.isLeader ? '★ ' : ''}@{member.label}{member.imposed ? ' (assigné)' : ''}
				</span>
			{/each}
		</span>
	</button>
{/snippet}

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Tâches</h1>
<p class="mb-6 text-sm text-gray-600">
	Les tâches de l'atelier. Participez à une tâche, ou proposez-en une nouvelle.
</p>

<div class="mb-6 border border-black">
	<button
		type="button"
		onclick={() => (createOpen = !createOpen)}
		class="w-full px-4 py-3 text-left text-sm font-bold uppercase"
		aria-expanded={createOpen}
	>
		+ Nouvelle tâche
	</button>
	{#if createOpen}
		<form
			method="POST"
			action="?/create"
			class="space-y-3 border-t border-black p-4"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') createOpen = false;
				}}
		>
			{@render taskFields(null)}
			<button class="btn-primary px-4 py-2 text-sm">Ajouter</button>
		</form>
	{/if}
</div>

{#snippet taskFields(task: Task | null)}
	<input
		name="title"
		required
		maxlength="120"
		placeholder="Titre"
		value={task?.title ?? ''}
		class="w-full border border-black px-3 py-2 text-sm"
	/>
	<textarea
		name="description"
		maxlength="2000"
		rows="4"
		placeholder="Détails (optionnel)"
		value={task?.description ?? ''}
		class="w-full border border-black px-3 py-2 text-sm"
	></textarea>
	<label class="block text-sm">
		<span class="mb-1 block text-xs font-bold uppercase text-gray-600">Date limite (optionnel)</span>
		<input name="dueDate" type="date" value={task?.dueDate ?? ''} class="border border-black px-3 py-2 text-sm" />
	</label>
{/snippet}

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
	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" bind:checked={showBlocked} />
		Afficher les tâches bloquées ({blockedCount})
	</label>
</div>

{#if view === 'board'}
	<div class="grid gap-4 {showBlocked ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}">
		{#each columns as column (column.status)}
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
		{#each columns as column (column.status)}
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

<!-- Native <dialog> with showModal(): focus trap, Escape and the inert page behind come from the
     browser. A click on the backdrop lands on the <dialog> itself. -->
<dialog
	bind:this={dialog}
	onclick={(event) => {
		if (event.target === dialog) closeTask();
	}}
	onclose={() => {
		selectedId = null;
		editing = false;
	}}
	aria-labelledby="task-title"
	class="m-auto w-[calc(100%-2rem)] max-w-lg border border-black bg-white p-0 text-left backdrop:bg-black/60"
>
	{#if selected}
		{@const task = selected}
		<div class="flex items-start justify-between gap-2 bg-black px-4 py-3 text-white">
			<h2 id="task-title" class="font-bold break-words">{task.title}</h2>
			<button type="button" onclick={closeTask} aria-label="Fermer" class="shrink-0 px-1 font-bold">✕</button>
		</div>

		<div class="space-y-4 p-4 text-sm">
			{#if editing}
				<form
					method="POST"
					action="?/edit"
					class="space-y-3"
					use:enhance={() =>
						async ({ result, update }) => {
							await update({ reset: false });
							if (result.type === 'success') editing = false;
						}}
				>
					<input type="hidden" name="taskId" value={task.id} />
					{@render taskFields(task)}
					<div class="flex gap-2">
						<button class="btn-primary px-4 py-2 text-sm">Enregistrer</button>
						<button type="button" onclick={() => (editing = false)} class="{buttonClass} px-4 py-2 text-sm">
							Annuler
						</button>
					</div>
				</form>
			{:else}
				{#if task.description}
					<p class="whitespace-pre-line">{task.description}</p>
				{/if}
				<p class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
					{@render dueLabel(task)}
					<span>Proposée par @{task.authorLabel}</span>
				</p>
			{/if}

			{#if task.blocked}
				<div class="border border-orange-700 bg-orange-50 p-3">
					<p class="text-xs font-bold uppercase text-orange-700">
						Bloqué ({BLOCKED_LABEL[task.blocked.kind]})
					</p>
					<p class="mt-1 whitespace-pre-line">{task.blocked.note}</p>
					{#if canFlagBlocked(task)}
						<form method="POST" action="?/unblock" use:enhance class="mt-2">
							<input type="hidden" name="taskId" value={task.id} />
							<button class={buttonFor(task.authorSub !== data.mySub && !isMember(task))}>Débloquer</button>
						</form>
					{/if}
				</div>
			{:else if task.status !== 'done' && canFlagBlocked(task)}
				<details class="border border-black">
					<summary class="cursor-pointer px-3 py-2 text-xs font-bold uppercase">Signaler un blocage</summary>
					<form method="POST" action="?/block" use:enhance class="space-y-2 border-t border-black p-3">
						<input type="hidden" name="taskId" value={task.id} />
						<div class="flex gap-4 text-sm">
							<label class="flex items-center gap-1.5">
								<input type="radio" name="blockedKind" value="internal" checked />
								Interne
							</label>
							<label class="flex items-center gap-1.5">
								<input type="radio" name="blockedKind" value="external" />
								Externe
							</label>
						</div>
						<textarea
							name="blockedNote"
							required
							maxlength="500"
							rows="2"
							placeholder="Ce qui bloque (ex. en attente de la livraison des pièces)"
							class="w-full border border-black px-3 py-2 text-sm"
						></textarea>
						<button class="btn-primary px-3 py-1 text-xs">Marquer comme bloquée</button>
					</form>
				</details>
			{/if}

			<div>
				<p class="mb-1 text-xs font-bold uppercase text-gray-600">Participants et assignés</p>
				{#if task.members.length === 0}
					<p class="text-gray-500">Personne pour l'instant.</p>
				{:else}
					<ul class="space-y-1">
						{#each task.members as member (member.sub)}
							<li class="flex items-center justify-between gap-2">
								<span>
									{member.isLeader ? '★ ' : ''}@{member.label}
									<span class="text-xs text-gray-500">
										({member.imposed ? 'assigné' : 'participant'}{member.isLeader ? ', leader' : ''})
									</span>
								</span>
								{#if data.isAdmin}
									<form method="POST" action="?/removeMember" use:enhance>
										<input type="hidden" name="taskId" value={task.id} />
										<input type="hidden" name="memberSub" value={member.sub} />
										<button class="{adminButtonClass} px-1.5 py-0" aria-label="Retirer @{member.label}">✕</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if canEdit(task) && task.members.length > 0}
				<form method="POST" action="?/setLeader" use:enhance class="flex gap-2">
					<input type="hidden" name="taskId" value={task.id} />
					<select name="leaderSub" class="min-w-0 flex-1 border border-black px-2 py-1 text-xs">
						<option value="">Pas de leader</option>
						{#each task.members as member (member.sub)}
							<option value={member.sub} selected={member.isLeader}>★ @{member.label}</option>
						{/each}
					</select>
					<button class={buttonFor(task.authorSub !== data.mySub)}>Définir le leader</button>
				</form>
			{/if}

			{#if data.isAdmin && data.members && task.status !== 'done'}
				<details class="border border-black">
					<summary class="cursor-pointer bg-lghs-yellow px-3 py-2 text-xs font-bold uppercase">Assigner des membres</summary>
					<form method="POST" action="?/assign" use:enhance class="border-t border-black p-3">
						<input type="hidden" name="taskId" value={task.id} />
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each data.members.filter((m) => !task.members.some((tm) => tm.sub === String(m.pk))) as member (member.pk)}
								<label class="flex items-center gap-2">
									<input type="checkbox" name="assigneePk" value={member.pk} />
									@{member.label}
								</label>
							{/each}
						</div>
						<button class="{adminButtonClass} mt-2">Assigner</button>
					</form>
				</details>
			{/if}

			<div class="flex flex-wrap gap-2 border-t border-black pt-3">
				{#if task.status !== 'done' && !isMember(task)}
					<form method="POST" action="?/join" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class="btn-primary px-3 py-1 text-xs">Je participe</button>
					</form>
				{/if}
				{#if task.status !== 'done' && myMembership(task) && !myMembership(task)?.imposed}
					<form method="POST" action="?/leave" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class={buttonClass}>Je me retire</button>
					</form>
				{/if}
				{#if task.status !== 'done' && !task.startedAt && (isMember(task) || data.isAdmin)}
					<form method="POST" action="?/start" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class={buttonFor(!isMember(task), 'btn-primary px-3 py-1 text-xs')}>Démarrer</button>
					</form>
				{/if}
				{#if task.status !== 'done' && task.startedAt && (isMember(task) || data.isAdmin)}
					<form method="POST" action="?/unstart" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class={buttonFor(!isMember(task))}>Remettre à faire</button>
					</form>
				{/if}
				{#if task.status !== 'done' && (isMember(task) || data.isAdmin)}
					<form method="POST" action="?/done" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class={buttonFor(!isMember(task), 'btn-primary px-3 py-1 text-xs')}>Marquer comme faite</button>
					</form>
				{/if}
				{#if task.status === 'done' && (isMember(task) || data.isAdmin)}
					<form method="POST" action="?/reopen" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button class={buttonFor(!isMember(task))}>Rouvrir</button>
					</form>
				{/if}
				{#if canEdit(task) && !editing}
					<button type="button" onclick={() => (editing = true)} class={buttonFor(task.authorSub !== data.mySub)}>
						Modifier
					</button>
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
						<button class={buttonFor(task.authorSub !== data.mySub)}>Supprimer</button>
					</form>
				{/if}
			</div>

			<div class="border-t border-black pt-3">
				<p class="mb-2 text-xs font-bold uppercase text-gray-600">Historique</p>
				{#if historyFailed}
					<p class="text-xs text-gray-500">Historique indisponible pour le moment.</p>
				{:else if history === null}
					<p class="text-xs text-gray-500">Chargement…</p>
				{:else if history.length === 0}
					<p class="text-xs text-gray-500">Aucun événement.</p>
				{:else}
					<ol class="space-y-1.5 border-l-2 border-black pl-3 text-xs">
						{#each history as event (event.id)}
							<li>
								<span class="font-bold">@{event.actorLabel}</span>
								{describe(event)}
								<span class="text-gray-500">· {formatWhen(event.createdAt)}</span>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		</div>
	{/if}
</dialog>
