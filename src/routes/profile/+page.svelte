<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);

	function fieldLabel(key: string): string {
		return data.fields.find((f) => f.key === key)?.label ?? key;
	}

	function fieldValue(key: string): string {
		return form?.attributes?.[key] ?? data.profile.attributes[key] ?? '';
	}
</script>

{#snippet textField(key: string, opts?: { type?: string; pattern?: string; title?: string })}
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for={key}>{fieldLabel(key)}</label>
		<input
			id={key}
			name={key}
			type={opts?.type ?? 'text'}
			pattern={opts?.pattern}
			title={opts?.title}
			value={fieldValue(key)}
			class="w-full border border-black px-3 py-2 text-sm"
		/>
	</div>
{/snippet}

<svelte:head>
	<title>Mon profil — Passport3</title>
</svelte:head>

<section class="max-w-2xl">
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Mon profil</h1>

	{#if form?.success}
		<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 font-bold">
			Vos données ont été enregistrées.
		</p>
	{/if}
	{#if form?.error}
		<p class="mb-6 border-4 border-black bg-white px-4 py-3 font-bold">
			{form.error}
		</p>
	{/if}

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

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				// Don't let the native form reset wipe the fields back to their initial
				// (possibly empty) defaultValue on a successful submit.
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<div class="mb-4">
			<label class="mb-1 block text-sm font-bold uppercase" for="name">Nom</label>
			<input
				id="name"
				name="name"
				type="text"
				required
				value={form?.name ?? data.profile.name}
				class="w-full border border-black px-3 py-2 text-sm"
			/>
		</div>

		<div class="mb-4">
			{@render textField('phoneNumber', {
				type: 'tel',
				pattern: '[1-9][0-9]{7,14}',
				title: 'Format attendu : 32470000000 (sans "+" ni "0" initial)'
			})}
		</div>

		<div class="mb-4">
			{@render textField('street')}
		</div>

		<div class="mb-4 grid grid-cols-2 gap-4">
			{@render textField('postal_code')}
			{@render textField('locality')}
		</div>

		<div class="mb-4">
			{@render textField('country')}
		</div>

		<div class="mt-6 flex flex-wrap items-center gap-4">
			<button type="submit" disabled={submitting} class="btn-primary px-6 py-3 disabled:opacity-50">
				{submitting ? 'Enregistrement…' : 'Enregistrer mes données'}
			</button>

			<a href={data.authentikAccountUrl} target="_blank" rel="noopener" class="text-sm">
				Changer mon mot de passe / gérer mon compte
			</a>
		</div>
	</form>
</section>
