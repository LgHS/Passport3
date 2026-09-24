<script lang="ts">
	import { displayName } from '$lib/types';
	import CotisationStatusBlock from '$lib/components/CotisationStatusBlock.svelte';

	let { data } = $props();

	interface ChecklistEntry {
		href: string;
		done: boolean | null;
		doneLabel: string;
		todoLabel: string;
	}

	// Completed items sink to the bottom — what still needs attention (or couldn't be verified)
	// stays visible first, instead of getting buried under items already taken care of.
	let checklistItems = $derived<ChecklistEntry[]>(
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
		].sort((a, b) => (a.done === true ? 1 : 0) - (b.done === true ? 1 : 0))
	);
</script>

{#snippet checklistItem(href: string, done: boolean | null, doneLabel: string, todoLabel: string)}
	<a
		{href}
		class="no-underline-fx flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
	>
		<span
			class="flex h-5 w-5 shrink-0 items-center justify-center border text-xs font-bold {done
				? 'border-black bg-black text-white'
				: 'border-gray-400 text-transparent'}"
			aria-hidden="true"
		>
			✓
		</span>
		{#if done === null}
			<span class="text-gray-500">Impossible de vérifier pour le moment</span>
		{:else if done}
			<span>{doneLabel}</span>
		{:else}
			<span class="font-bold">{todoLabel}</span>
		{/if}
	</a>
{/snippet}

<svelte:head>
	<title>Passport</title>
</svelte:head>

<section class="mb-12">
	<h1 class="mb-2 text-3xl font-bold uppercase">Passport</h1>

	{#if !data.user}
		<p class="mb-4 max-w-2xl text-lg font-bold">
			Bienvenue sur l'extranet membres du <a
				href="https://lghs.be"
				target="_blank"
				rel="noopener">Liège Hackerspace</a
			>
		</p>
		<p class="mb-4 max-w-2xl leading-relaxed">
			Il centralise les informations et les services liés à votre adhésion afin de vous permettre
			de gérer facilement votre compte et vos accès au hackerspace.
		</p>
		<p class="mb-2 max-w-2xl leading-relaxed">Depuis Passport, vous pouvez notamment :</p>
		<ul class="mb-6 max-w-2xl list-disc space-y-1 pl-5 leading-relaxed">
			<li>consulter et modifier vos informations personnelles ;</li>
			<li>vérifier l’état de vos cotisations ;</li>
			<li>consulter vos droits d’accès au hackerspace ;</li>
			<li>gérer votre badge RFID.</li>
			<li>…</li>
		</ul>
		<a
			href="/login"
			data-sveltekit-preload-data="off"
			class="no-underline-fx btn-primary inline-block px-6 py-3"
		>
			Se connecter avec le SSO
		</a>
	{:else}
		<p class="mb-2 max-w-2xl text-lg font-bold">Bienvenue, {displayName(data.user)} sur Passport,</p>
		<p class="leading-relaxed">il centralise les informations et les services liés à votre adhésion afin de vous permettre de gérer facilement votre compte et vos accès au hackerspace. En cas de souci : noc@lghs.be</p>
	{/if}
</section>

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

		<section class="w-full md:w-1/2">
			<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">Ma check-list</h2>
			<div class="divide-y divide-black border border-black">
				{#each checklistItems as item, i (i)}
					{@render checklistItem(item.href, item.done, item.doneLabel, item.todoLabel)}
				{/each}
			</div>
		</section>
	</div>

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
