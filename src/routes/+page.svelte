<script lang="ts">
	import { displayName } from '$lib/types';
	import CotisationStatusBlock from '$lib/components/CotisationStatusBlock.svelte';
	import { priorityMeta } from '$lib/taskPriority';

	const today = new Date().toISOString().slice(0, 10);

	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
	}

	let { data } = $props();

	interface ChecklistEntry {
		href: string;
		done: boolean;
		doneLabel: string;
		todoLabel: string;
	}

	// Completed items sink to the bottom — what still needs attention stays visible first, instead
	// of getting buried under items already taken care of. An item that couldn't be checked right
	// now (done: null, e.g. Authentik or Mattermost unreachable) is left out rather than shown as a
	// cryptic "can't verify" line: it comes back on the next load.
	let checklistItems = $derived<ChecklistEntry[]>(
		(
			[
			{
				href: '/profile?tab=mfa',
				done: data.checklist.mfaConfigured,
				doneLabel: 'MFA configuré',
				todoLabel: 'Configurer un MFA'
			},
			{
				href: '/profile?tab=emergency',
				done: data.checklist.emergencyContactConfigured,
				doneLabel: 'Contact "d’urgence" renseigné',
				todoLabel: 'Renseigner au moins un contact "d’urgence"'
			},
			{
				href: '/profile',
				done: data.checklist.avatarUploaded,
				doneLabel: 'Photo de profil envoyée',
				todoLabel: 'Envoyer une photo de profil'
			},
			{
				href: data.mattermostUrl ?? '/profile',
				done: data.checklist.mattermostActivated,
				doneLabel: 'Compte Mattermost activé',
				todoLabel: 'Activer mon compte Mattermost'
			},
			{
				href: '/badge',
				done: data.checklist.badgeConfigured,
				doneLabel: 'Badge RFID généré',
				todoLabel: 'Générer mon UUID (badge) RFID'
			},
			{
				href: '/cotisation',
				done: data.checklist.ibanPersoConfigured,
				doneLabel: 'IBAN personnel renseigné',
				todoLabel: 'Renseigner un IBAN personnel'
			},
			...(data.checklist.ibanProApplicable
				? [
						{
							href: '/cotisation',
							done: data.checklist.ibanProConfigured,
							doneLabel: 'IBAN professionnel renseigné',
							todoLabel: 'Renseigner un IBAN professionnel'
						}
					]
				: [])
			] as (Omit<ChecklistEntry, 'done'> & { done: boolean | null })[]
		)
			.filter((item): item is ChecklistEntry => item.done !== null)
			.sort((a, b) => Number(a.done) - Number(b.done))
	);
</script>

{#snippet checklistItem(href: string, done: boolean, doneLabel: string, todoLabel: string)}
	<a
		{href}
		class="no-underline-fx flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
	>
		<span
			class="flex h-5 w-5 shrink-0 items-center justify-center border text-xs font-bold {done
				? 'border-black bg-black text-white'
				: 'border-gray-400 text-transparent'}"
			aria-hidden="true"
		>
			✓
		</span>
		{#if done}
			<span>{doneLabel}</span>
		{:else}
			<span class="font-bold">{todoLabel}</span>
		{/if}
	</a>
{/snippet}

<svelte:head>
	<title>Passport</title>
</svelte:head>

{#if !data.user}
	<img src="/logo.svg" alt="Liège Hackerspace" class="mb-6 h-20 w-auto" />
	<p class="mb-4 text-lg font-bold">
		Bienvenue sur l'extranet membres du
		<br><a href="https://lghs.be" target="_blank" rel="noopener">Liège Hackerspace</a>
	</p>
	<p class="mb-8 text-sm text-gray-600">
		Il centralise les informations et les services liés à votre adhésion afin de vous permettre de
		gérer facilement votre compte et vos accès au hackerspace.
	</p>
	<a
		href="/login"
		data-sveltekit-preload-data="off"
		class="no-underline-fx btn-primary inline-block px-6 py-3"
	>
		Se connecter
	</a>
{:else}
	<section class="mb-12">
		<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Passport</h1>
		<p class="mb-2 max-w-2xl text-lg font-bold">Bienvenue sur Passport, {displayName(data.user)} !</p>
		<p class="text-sm text-gray-600">
			Il centralise les informations et les services liés à votre adhésion afin de vous permettre
			de gérer facilement votre compte et vos accès au hackerspace. En cas de souci :
			<a href="mailto:noc@lghs.be">noc@lghs.be</a>
		</p>
	</section>
{/if}

{#if data.user}
	<div class="mb-10 flex flex-col gap-8 md:flex-row md:items-start">
		<section class="w-full md:w-1/2">
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma cotisation</h2>
			{#if data.cotisationUnavailable}
				<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
					Service de cotisation temporairement indisponible. Réessayez dans quelques instants.
				</p>
			{:else}
				<CotisationStatusBlock
					status={data.cotisation.status}
					datefin={data.cotisation.datefin}
					isInactive={data.cotisation.isInactive}
				/>
				<a href="/cotisation" class="mt-2 inline-block text-sm">Voir le détail →</a>
			{/if}
		</section>

		{#if checklistItems.length > 0}
			<section class="w-full md:w-1/2">
				<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma check-list</h2>
				<div class="border border-black">
					{#each checklistItems as item, i (i)}
						{@render checklistItem(item.href, item.done, item.doneLabel, item.todoLabel)}
					{/each}
				</div>
			</section>
		{/if}
	</div>

	{#if data.myTasks && data.myTasks.length > 0}
		<section class="mb-10">
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
				Mes tâches ({data.myTasks.length})
			</h2>
			<ul class="divide-y divide-black border border-black">
				{#each data.myTasks as task (task.id)}
					{@const overdue = !!task.dueDate && task.dueDate < today}
					<li>
						<a
							href="/tasks?task={task.id}"
							class="no-underline-fx flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-100 {overdue
								? 'bg-red-50'
								: ''}"
						>
							<span class="min-w-0">
								<span class="font-bold">{task.title}</span>
								<span class="ml-2 text-xs text-gray-500">
									{task.status === 'blocked' ? 'Bloquée' : task.status === 'in_progress' ? 'En cours' : 'À faire'}
								</span>
								{#if task.dueDate}
									<span class="ml-2 text-xs {overdue ? 'font-bold text-red-600' : 'text-gray-500'}">
										{overdue ? 'En retard' : 'Pour le'} {formatDay(task.dueDate)}
									</span>
								{/if}
							</span>
							<span
								class="shrink-0 border border-black px-1.5 py-0.5 text-[10px] font-bold uppercase {priorityMeta(task.priority).badge}"
							>
								{priorityMeta(task.priority).label}
							</span>
						</a>
					</li>
				{/each}
			</ul>
			<a href="/tasks" class="mt-2 inline-block text-sm">Voir toutes les tâches →</a>
		</section>
	{/if}

	{#if data.groups === null || data.groups.length === 0}
		<section>
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mes apps</h2>
			<p class="text-sm">Aucune application ne vous est accessible pour le moment.</p>
		</section>
	{:else}
		{#each data.groups as group (group.name)}
			<section class="mb-10">
				<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
					{group.name}
				</h2>
				<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each group.apps as app (app.slug)}
						<li>
							<a
								href={app.launchUrl}
								target={app.openInNewTab ? '_blank' : undefined}
								rel={app.openInNewTab ? 'noopener' : undefined}
								class="no-underline-fx flex items-center gap-3 border border-black px-4 py-3 transition-colors hover:bg-black hover:text-white"
							>
								{#if app.iconUrl}
									<img src={app.iconUrl} alt="" class="h-8 w-8 shrink-0 object-contain" />
								{:else}
									<span
										class="flex h-8 w-8 shrink-0 items-center justify-center bg-black text-sm text-white"
									>
										{app.name[0]}
									</span>
								{/if}
								<span class="min-w-0">
									<span class="block truncate text-sm font-bold">{app.name}</span>
									{#if app.description}
										<span class="block truncate text-xs leading-relaxed">{app.description}</span>
									{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
{/if}
