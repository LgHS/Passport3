<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';
	import ProfileForm from '$lib/components/ProfileForm.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submittingOptin = $state(false);

	// Seeded once from the load/form result — same rationale as the badge UUID / cotisation IBAN
	// fields: the form owns its values once the admin starts toggling, not kept in sync afterwards.
	// svelte-ignore state_referenced_locally
	let visible = $state(form?.optin?.visible ?? data.optin.visible);

	const fieldOptins: { key: keyof typeof fieldOptinState; label: string }[] = [
		{ key: 'showAvatar', label: 'Avatar' },
		{ key: 'showChat', label: 'Pseudo Chat' },
		{ key: 'showFirstname', label: 'Prénom' },
		{ key: 'showLastname', label: 'Nom' },
		{ key: 'showMail', label: 'Mail' },
		{ key: 'showPhone', label: 'Téléphone' }
	];
	// svelte-ignore state_referenced_locally
	let fieldOptinState = $state({
		showAvatar: form?.optin?.showAvatar ?? data.optin.showAvatar,
		showChat: form?.optin?.showChat ?? data.optin.showChat,
		showFirstname: form?.optin?.showFirstname ?? data.optin.showFirstname,
		showLastname: form?.optin?.showLastname ?? data.optin.showLastname,
		showMail: form?.optin?.showMail ?? data.optin.showMail,
		showPhone: form?.optin?.showPhone ?? data.optin.showPhone
	});

	$effect(() => {
		if (form?.optinSuccess) {
			showToast('success', 'Visibilité trombinoscope mise à jour.');
		} else if (form?.optinError) {
			showToast('error', form.optinError);
		}
	});

	let submittingTag = $state(false);

	// svelte-ignore state_referenced_locally
	let tagValue = $state(form?.tag ?? data.tag.tag ?? '');
	// svelte-ignore state_referenced_locally
	let tagColorValue = $state(form?.tagColor ?? data.tag.tagColor ?? '');
	// Live preview swatch — falls back to the trombinoscope's default black badge (see
	// authentikAdmin.ts's HEX_COLOR_RE comment) when left empty or not yet valid.
	let tagColorPreview = $derived(/^[0-9a-fA-F]{6}$/.test(tagColorValue) ? `#${tagColorValue}` : '#000000');

	$effect(() => {
		if (form?.tagSuccess) {
			showToast('success', 'Rôle mis à jour.');
		} else if (form?.tagError) {
			showToast('error', form.tagError);
		}
	});
</script>

<svelte:head>
	<title>{data.profile.name} — Administration — Passport</title>
</svelte:head>

<section class="mx-auto max-w-2xl">
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

	<ProfileForm profile={data.profile} fields={data.fields} {form} collapsibleSocials={false} />

	<h2 class="mt-8 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Visibilité trombinoscope
	</h2>
	<form
		method="POST"
		action="?/updateOptin"
		class="border border-black p-4"
		use:enhance={() => {
			submittingOptin = true;
			return async ({ update }) => {
				await update({ reset: false });
				submittingOptin = false;
			};
		}}
	>
		<label class="flex w-fit cursor-pointer items-center gap-3 text-sm">
			<span
				class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {visible
					? 'bg-black'
					: 'bg-gray-300'}"
			>
				<input
					type="checkbox"
					name="visible"
					bind:checked={visible}
					class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
				/>
				<span
					class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {visible
						? 'translate-x-5'
						: ''}"
				></span>
			</span>
			Visible dans le trombinoscope
		</label>

		{#if visible}
			<p class="mt-4 mb-2 text-xs font-bold uppercase text-gray-600">Champs affichés</p>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
				<label class="flex cursor-not-allowed items-center gap-2 text-sm text-gray-400">
					<input type="checkbox" checked disabled />
					Username (obligatoire)
				</label>
				{#each fieldOptins as field (field.key)}
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input type="checkbox" name={field.key} bind:checked={fieldOptinState[field.key]} />
						{field.label}
					</label>
				{/each}
			</div>
		{/if}

		<p class="mt-4 text-xs text-gray-600">
			Avant d'activer un nouveau champ, assurez-vous du consentement du membre concerné — ces
			informations deviennent publiques dans le trombinoscope.
		</p>

		<button
			type="submit"
			disabled={submittingOptin}
			class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
		>
			{submittingOptin ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>

	<h2 class="mt-8 mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		Rôle affiché dans le trombinoscope
	</h2>
	<form
		method="POST"
		action="?/updateTag"
		class="border border-black p-4"
		use:enhance={() => {
			submittingTag = true;
			return async ({ update }) => {
				await update({ reset: false });
				submittingTag = false;
			};
		}}
	>
		<div class="mb-4">
			<label class="mb-1 block text-sm font-bold uppercase" for="tag">Rôle</label>
			<input
				id="tag"
				name="tag"
				type="text"
				placeholder="Prés. CA"
				bind:value={tagValue}
				class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
			/>
		</div>
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="tagColor">Couleur</label>
			<div class="flex items-center gap-2">
				<span
					class="h-9 w-9 shrink-0 border border-black"
					style="background-color: {tagColorPreview};"
					aria-hidden="true"
				></span>
				<div class="flex flex-1 items-stretch border border-black">
					<span class="flex items-center border-r border-black bg-gray-100 px-2 text-sm text-gray-500">
						#
					</span>
					<input
						id="tagColor"
						name="tagColor"
						type="text"
						placeholder="ffd800"
						pattern={'[0-9a-fA-F]{6}'}
						title="6 caractères hexadécimaux, sans le #, ex. ffd800"
						bind:value={tagColorValue}
						class="min-w-0 flex-1 px-2 py-2 font-mono text-sm placeholder:text-gray-300"
					/>
				</div>
			</div>
		</div>

		<button
			type="submit"
			disabled={submittingTag}
			class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
		>
			{submittingTag ? 'Enregistrement…' : 'Enregistrer'}
		</button>
	</form>
</section>
