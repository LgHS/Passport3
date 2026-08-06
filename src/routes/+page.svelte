<script lang="ts">
	import { displayName } from '$lib/types';

	let { data } = $props();

	const goals = [
		{ label: 'Voir et mettre à jour vos informations personnelles', href: '/profile' },
		{ label: 'Vérifier le statut de votre adhésion' },
		{ label: 'Consulter vos cotisations passées et en cours', href: '/cotisation' },
		{ label: 'Accéder aux informations de paiement et de comptabilité' },
		{ label: "Gérer l'authentification et la sécurité" },
		{ label: "Voir vos droits d'accès physiques au hackerspace" },
		{ label: 'Gérer vos badges ou identifiants d’accès' },
		{ label: "Accéder à l'annuaire des membres" }
	];
</script>

<svelte:head>
	<title>Passport</title>
</svelte:head>

<section class="mb-12">
	<h1 class="mb-4 text-3xl font-bold uppercase">Passport</h1>
	<p class="mb-6 max-w-2xl leading-relaxed">
		Passport est le portail des membres du <a href="https://lghs.be" target="_blank" rel="noopener"
			>Liège Hackerspace</a
		>. Un seul endroit pour gérer votre identité, votre adhésion, vos abonnements, vos droits
		d'accès, et plus encore.
	</p>

	{#if !data.user}
		<a href="/login" class="no-underline-fx btn-primary inline-block px-6 py-3">
			Se connecter avec le SSO
		</a>
	{:else}
		<p class="font-bold">
			Bienvenue, {displayName(data.user)} !
		</p>
	{/if}
</section>

<section>
	<h2 class="mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Ce que vous pourrez faire ici
	</h2>
	<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each goals as goal (goal.label)}
			<li>
				{#if goal.href}
					<a
						href={goal.href}
						class="no-underline-fx block border border-black px-4 py-3 text-sm leading-relaxed transition-colors hover:bg-black hover:text-white"
					>
						{goal.label}
					</a>
				{:else}
					<span class="block border border-black px-4 py-3 text-sm leading-relaxed">
						{goal.label}
					</span>
				{/if}
			</li>
		{/each}
	</ul>
</section>
