<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// svelte-ignore state_referenced_locally
	let enabled = $state(form?.enabled ?? data.birthdaySettings.enabled);
	// svelte-ignore state_referenced_locally
	let hour = $state(form?.hour ?? data.birthdaySettings.hour);
	// svelte-ignore state_referenced_locally
	let wishlistAnnounce = $state({ ...data.wishlistAnnounce });
	// svelte-ignore state_referenced_locally
	let tasksAnnounce = $state({ ...data.tasksAnnounce });
	const TASK_TOGGLES = [
		['announceCreated', 'Annoncer les nouvelles tâches sur Mattermost'],
		['announceDone', 'Annoncer les tâches terminées sur Mattermost'],
		['announceBlocked', 'Annoncer les tâches bloquées sur Mattermost'],
		['announceUrgent', 'Annoncer les tâches urgentes sur Mattermost'],
		['weeklyRecap', 'Récap chaque lundi à 9h : tâches en retard et sans participant']
	] as const;

	let savingBirthday = $state(false);
	let savingWishlist = $state(false);
	let savingTasks = $state(false);
	let refreshingMattermostCache = $state(false);
	let generatingAvatars = $state(false);

	$effect(() => {
		if (form?.birthdaySuccess) {
			showToast('success', 'Réglages des anniversaires enregistrés.');
		} else if (form?.birthdayError) {
			showToast('error', form.birthdayError);
		} else if (form?.wishlistSaved) {
			showToast('success', 'Réglages de la wishlist enregistrés.');
		} else if (form?.wishlistError) {
			showToast('error', form.wishlistError);
		} else if (form?.tasksSaved) {
			showToast('success', 'Réglages de la todolist enregistrés.');
		} else if (form?.tasksError) {
			showToast('error', form.tasksError);
		} else if (form?.mattermostCacheRefreshed) {
			showToast('success', 'Cache Mattermost régénéré.');
		} else if (form?.mattermostCacheError) {
			showToast('error', form.mattermostCacheError);
		} else if (form?.avatarsGenerated) {
			const { generated, alreadyCached, withPhoto } = form.avatarsGenerated;
			showToast(
				'success',
				`${generated} avatar(s) généré(s), ${alreadyCached} déjà en cache, ${withPhoto} membre(s) avec photo.`
			);
		} else if (form?.avatarsError) {
			showToast('error', form.avatarsError);
		}
	});

	// Keeps a block's submit button busy for the form's round-trip.
	function busy(set: (v: boolean) => void) {
		return () => {
			set(true);
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				await update({ reset: false });
				set(false);
			};
		};
	}
</script>

{#snippet toggle(name: string, checked: boolean, onchange: (v: boolean) => void, label: string)}
	<label class="flex w-fit cursor-pointer items-center gap-3 text-sm">
		<span
			class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {checked
				? 'bg-black'
				: 'bg-gray-300'}"
		>
			<input
				type="checkbox"
				{name}
				{checked}
				onchange={(e) => onchange(e.currentTarget.checked)}
				class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
			/>
			<span
				class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {checked
					? 'translate-x-5'
					: ''}"
			></span>
		</span>
		{label}
	</label>
{/snippet}

{#snippet channelField(id: string, current: string)}
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for={id}>Canal Mattermost</label>
		<input
			{id}
			name={id}
			value={current}
			placeholder="Identifiant du canal (26 caractères)"
			class="w-full border border-black px-3 py-2 font-mono text-sm placeholder:text-gray-300"
		/>
		<p class="mt-1 text-xs text-gray-500">
			Menu du canal → « Afficher les infos », en bas de la fenêtre. Le bot doit être membre du canal.
		</p>
	</div>
{/snippet}

{#snippet submit(pending: boolean, idle: string, working: string)}
	<button type="submit" disabled={pending} class="btn-primary mt-auto w-fit px-4 py-2 text-sm disabled:opacity-50">
		{pending ? working : idle}
	</button>
{/snippet}

<svelte:head>
	<title>Paramètres — Administration — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Paramètres</h1>

	<div class="grid gap-6 md:grid-cols-2">
		<form
			method="POST"
			action="?/updateBirthdaySettings"
			class="flex flex-col border border-black"
			use:enhance={busy((v) => (savingBirthday = v))}
		>
			<h2 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Anniversaires</h2>
			<div class="flex flex-1 flex-col gap-4 p-4">
				{@render toggle(
					'enabled',
					enabled,
					(v) => (enabled = v),
					'Souhaiter automatiquement leur anniversaire aux membres sur Mattermost'
				)}
				<div>
					<label class="mb-1 block text-sm font-bold uppercase" for="hour">
						Heure d'envoi
						<span class="text-xs font-normal text-gray-500 normal-case"
							>(Heure de la République libre d'Outremeuse)</span
						>
					</label>
					<select id="hour" name="hour" bind:value={hour} class="w-full border border-black px-3 py-2 text-sm">
						{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
							<option value={h}>{h}h00</option>
						{/each}
					</select>
				</div>
				{@render channelField('birthdayChannel', data.mattermostChannels.birthday)}
				{@render submit(savingBirthday, 'Enregistrer', 'Enregistrement…')}
			</div>
		</form>

		<form
			method="POST"
			action="?/updateWishlistSettings"
			class="flex flex-col border border-black"
			use:enhance={busy((v) => (savingWishlist = v))}
		>
			<h2 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Wishlist</h2>
			<div class="flex flex-1 flex-col gap-4 p-4">
				{@render toggle(
					'announce',
					wishlistAnnounce.announce,
					(v) => (wishlistAnnounce.announce = v),
					'Annoncer les nouvelles propositions sur Mattermost'
				)}
				{@render toggle(
					'announceGranted',
					wishlistAnnounce.announceGranted,
					(v) => (wishlistAnnounce.announceGranted = v),
					'Annoncer les propositions exaucées sur Mattermost'
				)}
				{@render toggle(
					'announceRejected',
					wishlistAnnounce.announceRejected,
					(v) => (wishlistAnnounce.announceRejected = v),
					'Annoncer les propositions refusées sur Mattermost'
				)}
				{@render channelField('wishlistChannel', data.mattermostChannels.wishlist)}
				{@render submit(savingWishlist, 'Enregistrer', 'Enregistrement…')}
			</div>
		</form>

		<form
			method="POST"
			action="?/updateTaskSettings"
			class="flex flex-col border border-black"
			use:enhance={busy((v) => (savingTasks = v))}
		>
			<h2 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Todolist</h2>
			<div class="flex flex-1 flex-col gap-4 p-4">
				{#each TASK_TOGGLES as [field, label] (field)}
					{@render toggle(field, tasksAnnounce[field], (v) => (tasksAnnounce[field] = v), label)}
				{/each}
				{@render channelField('tasksChannel', data.mattermostChannels.tasks)}
				{@render submit(savingTasks, 'Enregistrer', 'Enregistrement…')}
			</div>
		</form>

		<form
			method="POST"
			action="?/refreshMattermostCache"
			class="flex flex-col border border-black"
			use:enhance={busy((v) => (refreshingMattermostCache = v))}
		>
			<h2 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Cache Mattermost</h2>
			<div class="flex flex-1 flex-col gap-4 p-4">
				<p class="text-sm text-gray-600">
					Passport garde en mémoire la correspondance entre emails et comptes Mattermost, régénérée
					automatiquement toutes les heures. Ce bouton force une mise à jour immédiate, par exemple
					juste après qu'un membre ait créé son compte Mattermost.
				</p>
				{@render submit(refreshingMattermostCache, 'Régénérer le cache Mattermost', 'Régénération…')}
			</div>
		</form>

		<form
			method="POST"
			action="?/pregenerateAvatars"
			class="flex flex-col border border-black"
			use:enhance={busy((v) => (generatingAvatars = v))}
		>
			<h2 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Avatars</h2>
			<div class="flex flex-1 flex-col gap-4 p-4">
				<p class="text-sm text-gray-600">
					Les membres sans photo ont un avatar généré à partir de leur nom d'utilisateur, créé
					automatiquement la première fois qu'il est affiché. Ce bouton les génère tous d'un coup, par
					exemple avant de brancher Authentik ou BookStack sur Passport. Les avatars déjà générés ne
					sont pas refaits.
				</p>
				{@render submit(generatingAvatars, 'Générer les avatars manquants', 'Génération…')}
			</div>
		</form>
	</div>
</section>
