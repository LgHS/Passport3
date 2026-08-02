<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import ProfileForm from '$lib/components/ProfileForm.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Mon profil — Passport</title>
</svelte:head>

<section class="max-w-2xl">
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mon profil</h1>

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
