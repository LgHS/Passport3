<script lang="ts">
	import { displayName } from '$lib/types';

	let { data } = $props();
</script>

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
		<p class="max-w-2xl text-lg font-bold">
			Bienvenue, {displayName(data.user)} !
		</p>
	{/if}
</section>

{#if data.user}
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
