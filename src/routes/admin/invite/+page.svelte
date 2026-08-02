<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let copied = $state(false);

	async function copyLink() {
		if (!form?.inviteUrl) return;
		await navigator.clipboard.writeText(form.inviteUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function defaultExpiry(): string {
		const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}
</script>

<svelte:head>
	<title>Créer une invitation — Passport</title>
</svelte:head>

<section class="max-w-xl">
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Créer une invitation
	</h1>

	{#if form?.success}
		<div class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3">
			<p class="mb-2 font-bold">Invitation envoyée à {form.email} :</p>
			<div class="flex gap-2">
				<input
					type="text"
					readonly
					value={form.inviteUrl}
					class="w-full border border-black bg-white px-3 py-2 text-sm"
				/>
				<button type="button" onclick={copyLink} class="btn-primary shrink-0 px-4 py-2">
					{copied ? 'Copié !' : 'Copier'}
				</button>
			</div>
		</div>
	{/if}
	{#if form?.error}
		<p class="mb-6 border-4 border-black bg-white px-4 py-3 font-bold">
			{form.error}
		</p>
	{/if}

	<form method="POST" use:enhance>
		<div class="mb-4">
			<label class="mb-1 block text-sm font-bold uppercase" for="email">
				Email de la personne
			</label>
			<input
				id="email"
				name="email"
				type="email"
				required
				placeholder="prenom.nom@exemple.be"
				class="w-full border border-black px-3 py-2 text-sm"
			/>
		</div>

		<div class="mb-4">
			<label class="mb-1 block text-sm font-bold uppercase" for="expires"> Expire le </label>
			<input
				id="expires"
				name="expires"
				type="datetime-local"
				value={defaultExpiry()}
				class="w-full border border-black px-3 py-2 text-sm"
			/>
		</div>

		<div class="mb-6 flex items-center gap-2">
			<input id="single_use" name="single_use" type="checkbox" checked class="h-4 w-4" />
			<label for="single_use" class="text-sm font-bold uppercase">Usage unique</label>
		</div>

		<button type="submit" class="btn-primary px-6 py-3">
			Créer le lien et envoyer l'email
		</button>
	</form>
</section>
