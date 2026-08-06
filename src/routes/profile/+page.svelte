<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import ProfileForm from '$lib/components/ProfileForm.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' });
	function formatDate(iso: string): string {
		return dateFormat.format(new Date(iso));
	}

	type Tab = 'info' | 'sessions' | 'mfa';
	const VALID_TABS: Tab[] = ['info', 'sessions', 'mfa'];
	const initialTab = page.url.searchParams.get('tab');
	let activeTab = $state<Tab>(
		VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'info'
	);

	let addMenuOpen = $state(false);
	function handleWindowClick(event: MouseEvent) {
		if (!(event.target as HTMLElement).closest('[data-add-mfa-menu]')) {
			addMenuOpen = false;
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<svelte:head>
	<title>Mon profil — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mon profil</h1>

{#if data.mfaDevices.length === 0}
	<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 text-sm font-bold">
		Vous n'avez aucun MFA de configuré.
		<button
			type="button"
			onclick={() => (activeTab = 'mfa')}
			class="underline underline-offset-2"
		>
			Ajoutez-en un
		</button>
		 pour sécuriser votre compte.
	</p>
{/if}

<div class="mb-6 flex flex-wrap border-b-4 border-black text-sm">
	<button
		type="button"
		onclick={() => (activeTab = 'info')}
		class="px-4 py-2 font-bold uppercase transition-colors {activeTab === 'info'
			? 'bg-black text-white'
			: 'hover:bg-black hover:text-white'}"
	>
		Mes Informations
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'sessions')}
		class="px-4 py-2 font-bold uppercase transition-colors {activeTab === 'sessions'
			? 'bg-black text-white'
			: 'hover:bg-black hover:text-white'}"
	>
		Mes Sessions ({data.sessions.length})
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'mfa')}
		class="px-4 py-2 font-bold uppercase transition-colors {activeTab === 'mfa'
			? 'bg-black text-white'
			: 'hover:bg-black hover:text-white'}"
	>
		Mes Appareils MFA ({data.mfaDevices.length})
	</button>
</div>

{#if activeTab === 'info'}
	<section class="max-w-2xl">
		<div class="mb-6 flex items-center gap-4">
			{#if data.profile.avatar}
				<img src={data.profile.avatar} alt="" class="h-16 w-16 object-cover" />
			{/if}
			<p class="text-sm">
				Votre photo est associée à votre adresse email via <a
					href="https://gravatar.com"
					target="_blank"
					rel="noopener">Gravatar</a
				>. Pour la changer, mettez à jour votre Gravatar avec la même adresse email.
			</p>
		</div>

		<div class="mb-4">
			<span class="mb-1 block text-sm font-bold uppercase">Email</span>
			<p class="border border-black bg-gray-100 px-3 py-2 text-sm">{data.profile.email}</p>
		</div>

		<ProfileForm profile={data.profile} fields={data.fields} {form} />

		<a href={data.authentikAccountUrl} target="_blank" rel="noopener" class="mt-4 inline-block text-sm">
			Changer mon mot de passe / gérer mon compte
		</a>
	</section>
{:else if activeTab === 'sessions'}
	<section class="max-w-3xl">
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Navigateur / OS</th>
						<th class="border border-black px-3 py-2 text-left">Localisation</th>
						<th class="border border-black px-3 py-2 text-left">Dernière activité</th>
						<th class="border border-black px-3 py-2 text-left">Expire le</th>
						<th class="border border-black px-3 py-2 text-left">Action</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sessions as session (session.uuid)}
						<tr>
							<td class="border border-black px-3 py-2">{session.os} — {session.browser}</td>
							<td class="border border-black px-3 py-2">{session.location ?? session.lastIp}</td>
							<td class="border border-black px-3 py-2">{formatDate(session.lastUsed)}</td>
							<td class="border border-black px-3 py-2">{formatDate(session.expires)}</td>
							<td class="border border-black px-3 py-2">
								{#if session.current}
									<span class="text-xs font-bold uppercase">Session actuelle</span>
								{:else}
									<form method="POST" action="?/revokeSession" use:enhance>
										<input type="hidden" name="uuid" value={session.uuid} />
										<button type="submit" class="text-xs font-bold uppercase underline">
											Révoquer
										</button>
									</form>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="border border-black px-3 py-4 text-center text-gray-500">
								Aucune session active.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{:else if activeTab === 'mfa'}
	<section class="max-w-3xl">
		<div class="relative mb-4 inline-block" data-add-mfa-menu>
			<button
				type="button"
				onclick={() => (addMenuOpen = !addMenuOpen)}
				class="btn-primary flex items-center gap-2 px-4 py-2"
				aria-expanded={addMenuOpen}
				aria-haspopup="menu"
			>
				Ajouter
				<svg
					viewBox="0 0 12 8"
					class="h-2.5 w-2.5 fill-current transition-transform {addMenuOpen ? 'rotate-180' : ''}"
					aria-hidden="true"
				>
					<path d="M0 0 L12 0 L6 8 Z" />
				</svg>
			</button>

			{#if addMenuOpen}
				<div role="menu" class="absolute left-0 z-10 mt-1 w-56 border-4 border-black bg-white text-black">
					<a
						href={data.mfaEnrollUrls.totp}
						target="_blank"
						rel="noopener"
						role="menuitem"
						onclick={() => (addMenuOpen = false)}
						class="no-underline-fx menu-item"
					>
						Application TOTP
					</a>
					<a
						href={data.mfaEnrollUrls.static}
						target="_blank"
						rel="noopener"
						role="menuitem"
						onclick={() => (addMenuOpen = false)}
						class="no-underline-fx menu-item"
					>
						Codes de secours
					</a>
				</div>
			{/if}
		</div>
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="border border-black px-3 py-2 text-left">Nom</th>
						<th class="border border-black px-3 py-2 text-left">Type</th>
						<th class="border border-black px-3 py-2 text-left">Ajouté le</th>
						<th class="border border-black px-3 py-2 text-left">Action</th>
					</tr>
				</thead>
				<tbody>
					{#each data.mfaDevices as device (device.pk)}
						<tr>
							<td class="border border-black px-3 py-2">{device.name}</td>
							<td class="border border-black px-3 py-2">{device.type}</td>
							<td class="border border-black px-3 py-2">{formatDate(device.created)}</td>
							<td class="border border-black px-3 py-2">
								<form method="POST" action="?/deleteMfaDevice" use:enhance>
									<input type="hidden" name="pk" value={device.pk} />
									<button type="submit" class="text-xs font-bold uppercase underline">
										Supprimer
									</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="border border-black px-3 py-4 text-center text-gray-500">
								Aucun appareil MFA configuré.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
