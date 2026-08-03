<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import ProfileForm from '$lib/components/ProfileForm.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>{data.profile.name} — Administration — Passport</title>
</svelte:head>

<section class="max-w-2xl">
	<a href="/admin" class="mb-4 inline-block text-sm">← Retour à la liste</a>

	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		{data.profile.name}
	</h1>

	<div class="mb-6 flex items-center gap-4">
		{#if data.profile.avatar}
			<img src={data.profile.avatar} alt="" class="h-16 w-16 object-cover" />
		{/if}
		<div class="text-sm">
			<p><span class="font-bold uppercase">Identifiant :</span> {data.profile.username}</p>
			<p><span class="font-bold uppercase">Email :</span> {data.profile.email}</p>
		</div>
	</div>

	<ProfileForm profile={data.profile} fields={data.fields} {form} />
</section>
