<script lang="ts">
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { renderMiniMarkdown } from '$lib/renderMiniMarkdown';
	import { DEFAULT_TASK_PRIORITY, TASK_PRIORITIES, priorityMeta } from '$lib/taskPriority';
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

	// Deep link: /tasks?task=12 opens that task (used by the Mattermost messages), and the address
	// follows the open task so it can be shared.
	function setTaskParam(taskId: number | null) {
		const url = new URL(page.url);
		if (taskId === null) url.searchParams.delete('task');
		else url.searchParams.set('task', String(taskId));
		replaceState(url, {});
	}

	function openTask(task: Task) {
		selectedId = task.id;
		editing = false;
		dialog?.showModal();
		setTaskParam(task.id);
	}

	function closeTask() {
		dialog?.close();
	}

	onMount(() => {
		const linked = data.tasks.find((t) => t.id === Number(page.url.searchParams.get('task')));
		if (linked) openTask(linked);
	});

	async function copyTaskLink(task: Task) {
		try {
			await navigator.clipboard.writeText(`${location.origin}/tasks?task=${task.id}`);
			showToast('success', 'Lien copié.');
		} catch {
			showToast('error', 'Impossible de copier le lien.');
		}
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
	const isLeader = (t: Task) => t.members.some((m) => m.sub === data.mySub && m.isLeader);
	// Same rule as the server: the owner, or the leader unless an admin created the task.
	const canDeleteWithoutAdmin = (t: Task) => t.authorSub === data.mySub || (isLeader(t) && !t.createdByAdmin);
	const canDelete = (t: Task) => data.isAdmin || canDeleteWithoutAdmin(t);
	// The task's owner (author) and leader manage it alongside admins: assign members, block/unblock.
	const isOwnerOrLeader = (t: Task) =>
		t.authorSub === data.mySub || t.members.some((m) => m.sub === data.mySub && m.isLeader);
	const canFlagBlocked = (t: Task) => data.isAdmin || isOwnerOrLeader(t);
	const canAssign = (t: Task) => data.isAdmin || isOwnerOrLeader(t);

	let search = $state('');
	let priorityFilter = $state<number | 'all'>('all');
	let leaderFilter = $state<string>('all');

	// Leaders present on the board, for the leader filter.
	const leaders = $derived(
		[...new Map(data.tasks.flatMap((t) => t.members.filter((m) => m.isLeader)).map((m) => [m.sub, m])).values()].sort(
			(a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
		)
	);

	// Accent-insensitive, like the trombinoscope's search.
	function normalize(value: string): string {
		return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	}

	const visibleTasks = $derived(
		data.tasks.filter((t) => {
			if (onlyMine && !isMember(t)) return false;
			if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
			if (leaderFilter !== 'all' && !t.members.some((m) => m.isLeader && m.sub === leaderFilter)) return false;
			const query = normalize(search.trim());
			return !query || normalize(`${t.title} ${t.description ?? ''}`).includes(query);
		})
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

	// A bit of fun for the quick "+" on the cards.
	const QUICK_JOIN_QUESTIONS = [
		'« {t} » : tu signes, et pas avec le sang cette fois ?',
		"« {t} » : l'atelier compte sur toi. Pas de pression. Enfin, un peu.",
		'« {t} » : volontaire désigné·e par toi-même, on confirme ?',
		"« {t} » : les post-its au mur t'en seront éternellement reconnaissants. On y va ?",
		"« {t} » : c'est parti ? (« Je me retire » existe, on ne juge pas… trop.)"
	];
	const quickJoinQuestion = (t: Task) =>
		QUICK_JOIN_QUESTIONS[Math.floor(Math.random() * QUICK_JOIN_QUESTIONS.length)].replace('{t}', t.title);

	const buttonClass = 'border border-black px-3 py-1.5 text-xs font-bold uppercase hover:bg-black hover:text-white';
	// Same yellow as the wishlist's admin-only buttons: used whenever the current user can only do
	// this because they're an admin.
	const adminButtonClass = 'border border-black bg-lghs-yellow px-3 py-1.5 text-xs font-bold uppercase';
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
			case 'task.comment': return 'a commenté :';
			case 'task.remindDueSoon': return 'a envoyé un rappel (date limite demain)';
			case 'task.remindOverdue': return 'a signalé que la date limite est dépassée';
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

{#snippet priorityBadge(task: Task)}
	<span class="border border-black px-1.5 py-0.5 text-[10px] font-bold uppercase {priorityMeta(task.priority).badge}">
		{priorityMeta(task.priority).label}
	</span>
{/snippet}

{#snippet taskCard(task: Task)}
	<div class="relative">
		<button
			type="button"
			onclick={() => openTask(task)}
			class="block w-full cursor-pointer p-3 pr-10 text-left text-sm {isOverdue(task)
				? 'border-2 border-red-600 bg-red-50 hover:bg-red-100'
				: 'border border-black bg-white hover:bg-gray-100'}"
		>
			<span class="flex items-start justify-between gap-2">
				<span class="font-bold">{task.title}</span>
				{@render priorityBadge(task)}
			</span>
			<span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
				{#if task.blocked}
					<span class="font-bold text-orange-700">Bloqué ({BLOCKED_LABEL[task.blocked.kind]})</span>
				{/if}
				{@render dueLabel(task)}
				{#each task.members as member (member.sub)}
					<span
						class={member.sub === data.mySub ? 'font-bold text-black' : ''}
						title={member.imposed ? 'Assigné sur la tâche' : 'Participant (volontaire)'}
					>
						{member.isLeader ? '★ ' : ''}@{member.label}{member.imposed ? ' (assigné)' : ''}
					</span>
				{/each}
			</span>
		</button>
		<!-- Quick join, without opening the task. Outside the card's own button: a form can't sit
		     inside a <button>. -->
		{#if task.status !== 'done' && !isMember(task)}
			<form
				method="POST"
				action="?/join"
				class="absolute right-1.5 bottom-1.5"
				use:enhance={({ cancel }) => {
					if (!confirm(quickJoinQuestion(task))) return cancel();
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') showToast('success', `Bienvenue sur « ${task.title} » !`);
					};
				}}
			>
				<input type="hidden" name="taskId" value={task.id} />
				<button
					class="h-7 w-7 border border-black bg-white text-base leading-none font-bold hover:bg-black hover:text-white"
					title="Je participe"
					aria-label="Participer à « {task.title} »"
				>
					+
				</button>
			</form>
		{/if}
	</div>
{/snippet}

<h1 class="mb-2 bg-black px-4 py-3 text-base font-bold text-white uppercase">Tâches</h1>
<p class="mb-3 text-sm text-gray-600">
	Les tâches de l'atelier. Participez à une tâche, ou proposez-en une nouvelle.
</p>

<details class="mb-6 border border-black text-sm">
	<summary class="cursor-pointer px-4 py-2 font-bold uppercase">Comment ça marche ?</summary>
	<div class="space-y-2 border-t border-black p-4">
		<p>
			<strong>Proposer</strong> : tout membre peut ajouter une tâche, visible tout de suite. Vous en
			êtes alors le <strong>propriétaire</strong>. Sa <strong>priorité</strong> (Bas, Moyen, Normal,
			Élevé, Urgent) décide de sa place dans chaque colonne, les plus urgentes en haut.
		</p>
		<p>
			<strong>Participant</strong> : vous vous portez volontaire avec « Je participe » (ou le « + » en bas de la carte), et pouvez vous
			retirer quand vous voulez. Plusieurs personnes peuvent participer à la même tâche.
		</p>
		<p>
			<strong>Assigné</strong> : quelqu'un vous a mis sur la tâche (un admin, le propriétaire ou le
			leader). Vous êtes prévenu sur Mattermost et ne pouvez pas vous retirer vous-même.
		</p>
		<p>
			<strong>Leader</strong> (★) : la personne qui mène la tâche, choisie parmi les personnes dessus
			par le propriétaire ou un admin. Avec le propriétaire, le leader gère la tâche : il assigne ou
			retire des personnes, la bloque ou la débloque, et peut la supprimer (sauf si un admin l'a
			créée).
		</p>
		<p>
			<strong>Déroulé</strong> : « À faire » tant que personne ne l'a démarrée, « En cours » une fois
			démarrée, puis « Fait ». Une tâche <strong>bloquée</strong> (interne ou externe, avec une note
			sur ce qu'on attend) est masquée par défaut.
		</p>
		<p class="text-gray-600">Chaque action est gardée dans l'historique de la tâche.</p>
	</div>
</details>

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
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for="{task ? 'edit' : 'new'}-title">Titre</label>
		<input
			id="{task ? 'edit' : 'new'}-title"
			name="title"
			required
			maxlength="120"
			value={task?.title ?? ''}
			class="w-full border border-black px-3 py-2 text-sm"
		/>
	</div>
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for="{task ? 'edit' : 'new'}-priority">Priorité</label>
		<select
			id="{task ? 'edit' : 'new'}-priority"
			name="priority"
			class="border border-black px-3 py-2 text-sm"
		>
			{#each TASK_PRIORITIES as priority (priority.value)}
				<option value={priority.value} selected={(task?.priority ?? DEFAULT_TASK_PRIORITY) === priority.value}>
					{priority.label}
				</option>
			{/each}
		</select>
	</div>
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for="{task ? 'edit' : 'new'}-description">
			Description (optionnel)
		</label>
		<textarea
			id="{task ? 'edit' : 'new'}-description"
			name="description"
			maxlength="2000"
			rows="5"
			value={task?.description ?? ''}
			class="w-full border border-black px-3 py-2 text-sm"
		></textarea>
		<p class="mt-1 text-xs text-gray-500">**gras**, *italique*, __souligné__</p>
	</div>
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for="{task ? 'edit' : 'new'}-dueDate">
			Date limite (optionnel)
		</label>
		<input
			id="{task ? 'edit' : 'new'}-dueDate"
			name="dueDate"
			type="date"
			value={task?.dueDate ?? ''}
			class="border border-black px-3 py-2 text-sm"
		/>
	</div>
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
	<input
		type="search"
		bind:value={search}
		placeholder="Rechercher une tâche…"
		class="min-w-0 flex-1 border border-black px-3 py-2 text-sm placeholder:text-gray-400 sm:max-w-xs"
	/>
	<select bind:value={priorityFilter} aria-label="Filtrer par priorité" class="border border-black px-2 py-2 text-sm">
		<option value="all">Toutes priorités</option>
		{#each [...TASK_PRIORITIES].reverse() as priority (priority.value)}
			<option value={priority.value}>{priority.label}</option>
		{/each}
	</select>
	{#if leaders.length > 0}
		<select bind:value={leaderFilter} aria-label="Filtrer par leader" class="border border-black px-2 py-2 text-sm">
			<option value="all">Tous les leaders</option>
			{#each leaders as leader (leader.sub)}
				<option value={leader.sub}>★ @{leader.label}</option>
			{/each}
		</select>
	{/if}
	<!-- Stands out while blocked tasks exist, since they're hidden by default. -->
	<label
		class="flex items-center gap-2 text-sm {blockedCount > 0
			? 'border-2 border-orange-700 bg-orange-50 px-2 py-1 font-bold text-orange-700'
			: 'text-gray-500'}"
	>
		<input type="checkbox" bind:checked={showBlocked} disabled={blockedCount === 0} />
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

<!-- Same look as the wishlist's modal (thick frame, uppercase title, sections split by a rule,
     text links for Modifier/Supprimer at the bottom), on a native <dialog> opened with
     showModal(): focus trap, Escape and the inert page behind come from the browser. A click on
     the backdrop lands on the <dialog> itself. -->
<dialog
	bind:this={dialog}
	onclick={(event) => {
		if (event.target === dialog) closeTask();
	}}
	onclose={() => {
		selectedId = null;
		editing = false;
		setTaskParam(null);
	}}
	aria-labelledby="task-title"
	class="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto border-4 border-black bg-white p-4 text-left backdrop:bg-black/50"
>
	{#if selected}
		{@const task = selected}
		<div class="mb-3 flex items-start justify-between gap-4">
			<h2 id="task-title" class="text-base font-bold break-words uppercase">{task.title}</h2>
			<button
				type="button"
				onclick={closeTask}
				aria-label="Fermer"
				class="shrink-0 px-2 text-lg leading-none font-bold"
			>
				×
			</button>
		</div>

		{#if editing}
			<form
				method="POST"
				action="?/edit"
				class="space-y-4"
				use:enhance={() =>
					async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') editing = false;
					}}
			>
				<input type="hidden" name="taskId" value={task.id} />
				{@render taskFields(task)}
				<div class="flex items-center gap-4">
					<button type="submit" class="btn-primary px-4 py-2 text-sm">Enregistrer</button>
					<button type="button" onclick={() => (editing = false)} class="text-sm underline">Annuler</button>
				</div>
			</form>
		{:else}
			<!-- Wide screens: content on the left (status, description, history), management on the
			     right (people, actions, blocking). One column on phones. -->
			<div class="md:grid md:grid-cols-[3fr_2fr] md:gap-6">
				<div class="min-w-0">
					<p class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold uppercase">
						{@render priorityBadge(task)}
						{ALL_COLUMNS.find((c) => c.status === task.status)?.label}
						{#if task.dueDate}
							<span class="font-normal normal-case {isOverdue(task) ? 'font-bold text-red-600' : 'text-gray-600'}">
								— {@render dueLabel(task)}
							</span>
						{/if}
					</p>

					{#if task.description}
						<p class="mb-3 text-sm whitespace-pre-wrap">{@html renderMiniMarkdown(task.description)}</p>
					{/if}

					<p class="mb-3 text-xs text-gray-500">
						Proposée par @{task.authorLabel} le {formatWhen(task.createdAt)}
					</p>

					{#if task.blocked}
						<div class="mb-3 border border-orange-700 bg-orange-50 p-3 text-sm">
							<p class="text-xs font-bold uppercase text-orange-700">Bloqué ({BLOCKED_LABEL[task.blocked.kind]})</p>
							<p class="mt-1 whitespace-pre-wrap">{@html renderMiniMarkdown(task.blocked.note)}</p>
							{#if canFlagBlocked(task)}
								<form method="POST" action="?/unblock" use:enhance class="mt-2">
									<input type="hidden" name="taskId" value={task.id} />
									<button class={buttonFor(!isOwnerOrLeader(task))}>Débloquer</button>
								</form>
							{/if}
						</div>
					{/if}

					<div class="mb-3 border-t border-black pt-3">
						<p class="mb-2 text-sm font-bold">Historique et commentaires</p>
						<form
							method="POST"
							action="?/comment"
							class="mb-3 flex gap-2"
							use:enhance={() =>
								async ({ result, update }) => {
									await update();
									if (result.type === 'success') loadHistory(task.id);
								}}
						>
							<input type="hidden" name="taskId" value={task.id} />
							<textarea
								name="comment"
								required
								maxlength="1000"
								rows="1"
								placeholder="Ajouter un commentaire… (**gras**, *italique*, __souligné__)"
								class="min-w-0 flex-1 border border-black px-2 py-1 text-xs"
							></textarea>
							<button class="btn-primary px-3 py-1 text-xs">Envoyer</button>
						</form>
						{#if historyFailed}
							<p class="text-xs text-gray-500">Historique indisponible pour le moment.</p>
						{:else if history === null}
							<p class="text-xs text-gray-500">Chargement…</p>
						{:else if history.length === 0}
							<p class="text-xs text-gray-500">Aucun événement.</p>
						{:else}
							<!-- Newest first, in its own scroll area: a long history never stretches the modal. -->
							<ol class="max-h-40 space-y-1.5 overflow-y-auto border-l-2 md:max-h-80 border-black pl-3 text-xs">
								{#each [...history].reverse() as event (event.id)}
									<li>
										<span class="font-bold">@{event.actorLabel}</span>
										{describe(event)}
										<span class="text-gray-500">· {formatWhen(event.createdAt)}</span>
										{#if event.action === 'task.comment' && typeof event.details?.text === 'string'}
											<p class="mt-0.5 border border-gray-300 bg-gray-50 px-2 py-1 whitespace-pre-wrap">
												{@html renderMiniMarkdown(event.details.text)}
											</p>
										{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</div>

				</div>
				<div class="min-w-0">
					<div class="mb-3 border-t border-black pt-3 text-sm md:border-t-0 md:pt-0">
						<p class="mb-1 font-bold">Participants et assignés ({task.members.length})</p>
						{#if task.members.length === 0}
							<p class="text-gray-600">—</p>
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
										{#if canAssign(task)}
											<form method="POST" action="?/removeMember" use:enhance>
												<input type="hidden" name="taskId" value={task.id} />
												<input type="hidden" name="memberSub" value={member.sub} />
												<button
													class="{buttonFor(!isOwnerOrLeader(task))} px-1.5 py-0"
													aria-label="Retirer @{member.label}"
												>
													×
												</button>
											</form>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						<div class="mt-3 flex flex-wrap gap-2">
							{#if task.status !== 'done' && !isMember(task)}
								<form method="POST" action="?/join" use:enhance>
									<input type="hidden" name="taskId" value={task.id} />
									<button class="btn-primary px-3 py-1.5 text-xs">Je participe</button>
								</form>
							{/if}
							{#if task.status !== 'done' && myMembership(task) && !myMembership(task)?.imposed}
								<form method="POST" action="?/leave" use:enhance>
									<input type="hidden" name="taskId" value={task.id} />
									<button class={buttonClass}>Je me retire</button>
								</form>
							{/if}
						</div>

						{#if canEdit(task) && task.members.length > 0}
							<form method="POST" action="?/setLeader" use:enhance class="mt-3 flex gap-2">
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

						{#if canAssign(task) && data.members && task.status !== 'done'}
							<details class="mt-3 border border-black">
								<summary
									class="cursor-pointer px-3 py-1.5 text-xs font-bold uppercase {isOwnerOrLeader(task) ? '' : 'bg-lghs-yellow'}"
								>
									Assigner des membres
								</summary>
								<form method="POST" action="?/assign" use:enhance class="border-t border-black p-3">
									<input type="hidden" name="taskId" value={task.id} />
									<div class="max-h-40 space-y-1 overflow-y-auto">
										{#each data.members.filter((m) => !task.members.some((tm) => tm.sub === String(m.pk))) as member (member.pk)}
											<label class="flex items-center gap-2">
												<input type="checkbox" name="assigneePk" value={member.pk} />
												@{member.label}
											</label>
										{/each}
									</div>
									<button class="{buttonFor(!isOwnerOrLeader(task), 'btn-primary px-3 py-1.5 text-xs')} mt-2">
										Assigner
									</button>
								</form>
							</details>
						{/if}
					</div>

					{#if isMember(task) || data.isAdmin || (task.status !== 'done' && !task.blocked && canFlagBlocked(task))}
						<div class="mb-3 flex flex-wrap gap-2 border-t border-black pt-3">
							{#if task.status !== 'done' && !task.startedAt && (isMember(task) || data.isAdmin)}
								<form method="POST" action="?/start" use:enhance>
									<input type="hidden" name="taskId" value={task.id} />
									<button class={buttonFor(!isMember(task), 'btn-primary px-3 py-1.5 text-xs')}>Démarrer</button>
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
									<button class={buttonFor(!isMember(task), 'btn-primary px-3 py-1.5 text-xs')}>
										Marquer comme faite
									</button>
								</form>
							{/if}
							{#if task.status === 'done' && (isMember(task) || data.isAdmin)}
								<form method="POST" action="?/reopen" use:enhance>
									<input type="hidden" name="taskId" value={task.id} />
									<button class={buttonFor(!isMember(task))}>Rouvrir</button>
								</form>
							{/if}
						</div>
					{/if}

					{#if !task.blocked && task.status !== 'done' && canFlagBlocked(task)}
						<details class="mb-3 border border-black">
							<summary
								class="cursor-pointer px-3 py-1.5 text-xs font-bold uppercase {isOwnerOrLeader(task) ? '' : 'bg-lghs-yellow'}"
							>
								Signaler un blocage
							</summary>
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
								<button class={buttonFor(!isOwnerOrLeader(task), 'btn-primary px-3 py-1.5 text-xs')}>
									Marquer comme bloquée
								</button>
							</form>
						</details>
					{/if}

				</div>
			</div>

			<div class="flex gap-4 border-t border-black pt-3">
				<button type="button" onclick={() => copyTaskLink(task)} class="text-xs font-bold uppercase underline">
					🔗 Copier le lien
				</button>
				{#if canEdit(task) || canDelete(task)}
					{#if canEdit(task)}
						<button
							type="button"
							onclick={() => (editing = true)}
							class="text-xs font-bold uppercase underline {task.authorSub === data.mySub ? '' : 'bg-lghs-yellow px-1'}"
						>
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
							<button
								class="text-xs font-bold uppercase text-red-700 underline {canDeleteWithoutAdmin(task) ? '' : 'bg-lghs-yellow px-1'}"
							>
								Supprimer
							</button>
						</form>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</dialog>
